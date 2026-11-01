"""A184: a reconnect keeps the LOCAL account id. Finexer is mocked at the client
level; no network, no real DB. Every reference in the app points at the account
doc's `_id`, so a new Finexer bank account id must never become a new local id."""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.accounts as accounts_router
import app.services.account_refresh as ar
import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw
from tests.test_a176_bank_sync import Client, ExcludedCol, Resp, IDLE, CONSENT, UID

FP = "AbC123xyz789AbC123xyz789"  # 24 alphanumerics
OTHER_FP = "ZzZ123xyz789AbC123xyz789"
NEW_CONSENT = "fx-a184-new"


def _cmp(value, cond):
    for op, arg in cond.items():
        if op == "$gte" and not (value is not None and value >= arg):
            return False
        if op == "$lt" and not (value is not None and value < arg):
            return False
        if op == "$ne" and value == arg:
            return False
        if op == "$exists" and (value is not None) != arg:
            return False
        if op == "$in" and value not in arg:
            return False
    return True


def _match(d, q):
    for k, v in (q or {}).items():
        if isinstance(v, dict) and any(x.startswith("$") for x in v):
            if not _cmp(d.get(k), v):
                return False
        elif d.get(k) != v:
            return False
    return True


class Store:
    class _Res:
        def __init__(self, n):
            self.matched_count = n
            self.modified_count = n

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def _apply(self, d, update):
        d.update(update.get("$set") or {})
        for k in (update.get("$unset") or {}):
            d.pop(k, None)
        for k, spec in (update.get("$push") or {}).items():
            cur = d.setdefault(k, [])
            cur.extend(spec["$each"])
            if "$slice" in spec:
                d[k] = cur[spec["$slice"]:]

    async def find_one(self, q=None, projection=None):
        return next((dict(d) for d in self.docs if _match(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [dict(d) for d in self.docs if _match(d, q)]

        class _It:
            def __aiter__(s):
                s.i = 0
                return s

            async def __anext__(s):
                if s.i >= len(rows):
                    raise StopAsyncIteration
                s.i += 1
                return rows[s.i - 1]
        return _It()

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return self._Res(1)
        if upsert:
            nd = {k: v for k, v in filt.items() if not k.startswith("$") and not isinstance(v, dict)}
            nd.update(update.get("$setOnInsert") or {})
            self._apply(nd, update)
            self.docs.append(nd)
        return self._Res(0)

    async def update_many(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)

    async def find_one_and_update(self, filt, update, upsert=False, projection=None, return_document=None):
        for d in self.docs:
            if _match(d, filt):
                before = dict(d)
                self._apply(d, update)
                return before
        if upsert:
            nd = {k: v for k, v in filt.items() if not isinstance(v, dict)}
            nd.update(update.get("$setOnInsert") or {})
            self._apply(nd, update)
            self.docs.append(nd)
        return None


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    async def _noop(now=None, **kw):
        return None
    monkeypatch.setattr(fxw, "bump_daily_counters", _noop)
    monkeypatch.setattr(accounts_router, "bump_daily_counters", _noop)
    monkeypatch.setattr(fs, "_auto_sync_warned", False)

    async def _bulk(*a, **k):
        return None
    for mod, name in (("app.services.categorisation", "apply_rules_bulk"),
                      ("app.services.categorisation", "categorise_others_bg"),
                      ("app.services.manual_account_rules", "apply_rules")):
        monkeypatch.setattr(f"{mod}.{name}", _bulk)

    async def _sleep(s):
        return None
    monkeypatch.setattr(fs.asyncio, "sleep", _sleep)


class FpClient(Client):
    """List accounts returns one account under `bank_id` carrying `fingerprint`."""

    def __init__(self, bank_id, fingerprint=FP, **kw):
        super().__init__(post_responses=[Resp(200, IDLE)], booked=kw.pop("booked", [{"id": "t1"}]), **kw)
        self.bank_id = bank_id
        self.fingerprint = fingerprint

    async def get(self, url, params=None):
        if url == "/bank_accounts":
            row = {"id": self.bank_id, "class": "current", "provider": "monzo"}
            if self.fingerprint:
                row["fingerprint"] = self.fingerprint
            return Resp(200, {"data": [row]})
        return await super().get(url, params)


def _world(monkeypatch, accounts, consent_id=CONSENT, client=None, consent_last_synced=None):
    accts = Store(accounts)
    consents = Store([
        {"_id": CONSENT, "user_id": UID, "status": "revoked", "last_synced": datetime(2026, 9, 1)},
        {"_id": NEW_CONSENT, "user_id": UID, "status": "authorized", "last_synced": consent_last_synced},
    ])
    monkeypatch.setattr(fs, "finexer_consents_col", consents)
    monkeypatch.setattr(fs, "accounts_col", accts)
    monkeypatch.setattr("app.db.collections.excluded_accounts_col", ExcludedCol())
    upserts: list = []

    async def _identity(uid):
        return None

    async def _providers(counter=None):
        return []

    async def _upsert(txns, account_id, user_id, identity=None, dedupe=None):
        upserts.append((account_id, dedupe))
        return ([t for t in txns if t.get("status") != "pending"], [])

    async def _replace(rows, account_id, user_id, provider=None, account_currency=None):
        return None

    async def _auto_hours(key, env=None):
        return 6
    monkeypatch.setattr(fs, "user_identity", _identity)
    monkeypatch.setattr(fs, "list_providers", _providers)
    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    monkeypatch.setattr(fs, "replace_pending_for_account", _replace)
    from app.services import runtime_settings
    monkeypatch.setattr(runtime_settings, "asetting", _auto_hours)
    c = client or FpClient("fx_new")
    monkeypatch.setattr(fs, "_client", lambda: c)
    return accts, c, upserts


def _sync(consent=NEW_CONSENT, **kw):
    return asyncio.run(fs.sync_finexer_consent(consent, UID, **kw))


OLD = {"_id": "fx_old", "user_id": UID, "connection_id": CONSENT, "finexer": True, "source": "finexer",
       "fingerprint": FP, "finexer_account_id": "fx_old", "status": "expired", "name": "Old",
       "display_name": "Joint bills", "include_in_safe_to_spend": False, "class_unknown": False,
       "updated_at": datetime(2026, 9, 1)}


def test_first_connect_stores_the_fingerprint_and_the_finexer_id(monkeypatch):
    accts, c, _ = _world(monkeypatch, [], client=FpClient("fx_first"))
    fetched, _n = _sync()
    assert fetched == ["fx_first"]
    d = accts.docs[0]
    assert d["_id"] == "fx_first" and d["fingerprint"] == FP and d["finexer_account_id"] == "fx_first"
    assert "reconnected_at" not in d


def test_a_malformed_fingerprint_is_never_stored_or_matched(monkeypatch):
    accts, c, _ = _world(monkeypatch, [dict(OLD)], client=FpClient("fx_new", fingerprint="short"))
    fetched, _n = _sync()
    assert fetched == ["fx_new"]
    assert {d["_id"] for d in accts.docs} == {"fx_old", "fx_new"}
    assert "fingerprint" not in next(d for d in accts.docs if d["_id"] == "fx_new")


def test_reconnect_reuses_the_doc_and_keeps_every_reference(monkeypatch):
    # References that live in other collections point at the local id fx_old.
    refs = {
        "commitment_pot": {"funding_pot": {"account_id": "fx_old"}},
        "allocation": {"fill_account_id": "fx_old", "destination_id": "fx_old"},
        "learned_destination": {"destination_account_id": "fx_old"},
        "income_stream": {"account_id": "fx_old", "confirmed": True},
        "transaction": {"_id": "trn_old", "account_id": "fx_old"},
    }
    accts, c, upserts = _world(monkeypatch, [dict(OLD)])
    fetched, _n = _sync()
    # One doc, same _id, re-pointed at the new consent and Finexer id.
    assert fetched == ["fx_old"]
    assert len(accts.docs) == 1
    d = accts.docs[0]
    assert d["_id"] == "fx_old"
    assert d["finexer_account_id"] == "fx_new"
    assert d["connection_id"] == NEW_CONSENT and d["status"] == "connected"
    assert d["fingerprint"] == FP and isinstance(d["reconnected_at"], datetime)
    # Fields the user or the app set survive.
    assert d["display_name"] == "Joint bills" and d["include_in_safe_to_spend"] is False
    # Transactions are written under the local id.
    assert upserts and all(aid == "fx_old" for aid, _ in upserts)
    # No reference had to move: they all still resolve to this doc.
    for ref in refs.values():
        ids = [v for v in (ref.get("account_id"), ref.get("fill_account_id"), ref.get("destination_id"),
                           ref.get("destination_account_id"), (ref.get("funding_pot") or {}).get("account_id"))
               if v]
        assert all(any(x["_id"] == i for x in accts.docs) for i in ids)


def test_every_finexer_call_uses_the_new_finexer_id(monkeypatch):
    accts, c, _ = _world(monkeypatch, [dict(OLD)])
    _sync(request_bank_sync=True)
    urls = [u for u, _ in c.gets] + [u for u, _ in c.posts]
    bank = [u for u in urls if u.startswith("/bank_accounts/")]
    assert bank and all(u.startswith("/bank_accounts/fx_new/") for u in bank)
    assert not any("fx_old" in u for u in urls)
    kinds = {u.split("/")[-1].split("?")[0] for u in bank}
    assert {"balance", "transactions", "sync"} <= kinds


def test_a_different_users_identical_fingerprint_never_matches(monkeypatch):
    theirs = dict(OLD, user_id="someone-else", _id="fx_theirs", finexer_account_id="fx_theirs")
    accts, c, _ = _world(monkeypatch, [theirs])
    fetched, _n = _sync()
    assert fetched == ["fx_new"]
    other = next(d for d in accts.docs if d["_id"] == "fx_theirs")
    assert other["connection_id"] == CONSENT and other["finexer_account_id"] == "fx_theirs"
    assert next(d for d in accts.docs if d["_id"] == "fx_new")["user_id"] == UID


def test_two_docs_sharing_a_fingerprint_pick_the_most_recent_and_log(monkeypatch, caplog):
    older = dict(OLD, _id="fx_a", finexer_account_id="fx_a", updated_at=datetime(2026, 8, 1))
    newer = dict(OLD, _id="fx_b", finexer_account_id="fx_b", updated_at=datetime(2026, 10, 1))
    accts, c, _ = _world(monkeypatch, [older, newer])
    with caplog.at_level("WARNING", logger="app.services.finexer_sync"):
        fetched, _n = _sync()
    assert fetched == ["fx_b"]
    assert any("share one fingerprint" in r.getMessage() for r in caplog.records)
    assert "fx_a" not in " ".join(r.getMessage() for r in caplog.records)
    assert next(d for d in accts.docs if d["_id"] == "fx_a")["connection_id"] == CONSENT


def test_the_same_finexer_id_again_is_not_a_reconnect(monkeypatch):
    accts, c, _ = _world(monkeypatch, [dict(OLD)], client=FpClient("fx_old"))
    _sync()
    d = accts.docs[0]
    assert d["_id"] == "fx_old" and "reconnected_at" not in d


def test_pre_a184_doc_without_a_fingerprint_matches_on_its_own_id(monkeypatch):
    legacy = {k: v for k, v in OLD.items() if k not in ("fingerprint", "finexer_account_id")}
    accts, c, _ = _world(monkeypatch, [legacy], client=FpClient("fx_old"))
    _sync()
    assert len(accts.docs) == 1 and accts.docs[0]["fingerprint"] == FP
    assert accts.docs[0]["finexer_account_id"] == "fx_old"


def test_remote_id_helper_prefers_the_finexer_id_and_falls_back_to_the_local_one():
    assert fs.finexer_remote_id({"_id": "loc", "finexer_account_id": "fx"}) == "fx"
    assert fs.finexer_remote_id({"_id": "loc"}) == "loc"
    assert fs.finexer_remote_id({"_id": "loc", "finexer_account_id": None}) == "loc"


def test_per_account_refresh_on_a_rekeyed_account_uses_the_new_id(monkeypatch):
    rekeyed = dict(OLD, connection_id=NEW_CONSENT, finexer_account_id="fx_new", status="connected")
    accts, c, upserts = _world(monkeypatch, [rekeyed], consent_last_synced=datetime(2026, 10, 1))
    monkeypatch.setattr(ar, "accounts_col", accts)
    monkeypatch.setattr(ar, "finexer_consents_col", fs.finexer_consents_col)

    async def _rc(uid):
        return None
    monkeypatch.setattr(ar, "_recompute", _rc)
    out = asyncio.run(ar._refresh_finexer(UID, dict(rekeyed)))
    assert out["refreshed"] is True
    walked = {u for u, _ in c.gets if "/transactions" in u}
    assert walked == {"/bank_accounts/fx_new/transactions"}
    assert c.posts == [("/bank_accounts/fx_new/sync", None)]
    assert upserts and upserts[0][0] == "fx_old"


def test_delete_of_a_rekeyed_account_calls_finexer_with_the_new_id(monkeypatch):
    from tests.test_a179_account_refresh import DelClient, _delete, _delete_world
    c = DelClient(204)
    _delete_world(monkeypatch, c)
    # Re-key the doc the world seeded: local id stays, Finexer knows it by a new id.
    next(d for d in accounts_router.accounts_col.docs if d["_id"] == "ba_acc1xyz")["finexer_account_id"] = "ba_new999"
    out = _delete("ba_acc1xyz")
    assert out == {"deleted": "ba_acc1xyz"}
    assert c.deletes == ["/bank_accounts/ba_new999"]


# ── dedupe at upsert ──────────────────────────────────────────────────────

RECONNECT = datetime(2026, 11, 1, 9, 0, 0)


def _row(tid, amount=4.5, day=10, merchant="Costa", typ="debit"):
    return {"id": tid, "amount": amount if typ == "credit" else -amount, "currency": "GBP",
            "description": merchant, "merchant_name": merchant,
            "booking_date": f"2026-10-{day:02d}T08:30:00Z"}


def _old_row(tid, amount=4.5, day=10, merchant="Costa", typ="debit", first_seen=datetime(2026, 10, 11)):
    return {"_id": tid, "account_id": "fx_old", "user_id": UID, "date": datetime(2026, 10, day, 8, 30),
            "amount": amount, "transaction_type": typ,
            "merchant_key": fs.canonical_merchant_key(merchant, merchant), "first_seen": first_seen,
            "provider": "Finexer"}


def _dedupe_world(monkeypatch, old_rows):
    txns = Store(old_rows)
    accts = Store([dict(OLD)])
    monkeypatch.setattr(fs, "transactions_col", txns)
    monkeypatch.setattr(fs, "accounts_col", accts)

    async def _stale(uid):
        return None
    monkeypatch.setattr(fs, "mark_stale", _stale)
    return txns, accts


def _upsert(rows, dedupe):
    return asyncio.run(fs._upsert_finexer_transactions(rows, "fx_old", UID, dedupe=dedupe))


def _dd(skipped=()):
    return {"reconnected_at": RECONNECT, "skipped": set(skipped), "count": 0}


def test_true_duplicates_are_skipped_counted_and_remembered(monkeypatch):
    txns, accts = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    dd = _dd()
    new, _p = _upsert([_row("trn_new1")], dd)
    assert new == [] and dd["count"] == 1
    assert not any(d["_id"] == "trn_new1" for d in txns.docs)
    assert [d["_id"] for d in txns.docs] == ["trn_old1"], "existing rows are never deleted"
    assert accts.docs[0]["dedupe_skipped_ids"] == ["trn_new1"]
    # A later sync sends the same new id again: still skipped, not recounted, not inserted.
    dd2 = _dd(accts.docs[0]["dedupe_skipped_ids"])
    new2, _p = _upsert([_row("trn_new1")], dd2)
    assert new2 == [] and dd2["count"] == 0 and len(txns.docs) == 1


@pytest.mark.parametrize("variant", [
    dict(amount=4.6), dict(day=11), dict(merchant="Pret"), dict(typ="credit"),
])
def test_near_misses_are_inserted(monkeypatch, variant):
    txns, _a = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    dd = _dd()
    new, _p = _upsert([_row("trn_new1", **variant)], dd)
    assert len(new) == 1 and dd["count"] == 0
    assert any(d["_id"] == "trn_new1" for d in txns.docs)


def test_two_genuine_identical_purchases_are_not_both_swallowed_by_one_old_row(monkeypatch):
    txns, _a = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    dd = _dd()
    new, _p = _upsert([_row("trn_n1"), _row("trn_n2")], dd)
    assert dd["count"] == 1 and len(new) == 1
    assert sum(1 for d in txns.docs if d.get("account_id") == "fx_old") == 2


def test_rows_outside_the_window_or_after_the_reconnect_or_first_seen_after_are_kept(monkeypatch):
    txns, _a = _dedupe_world(monkeypatch, [
        _old_row("trn_ancient", day=10, first_seen=datetime(2026, 10, 11)),
    ])
    # window: only dates within RECONNECT_DEDUPE_DAYS before the reconnect are compared
    dd = {"reconnected_at": datetime(2027, 3, 1), "skipped": set(), "count": 0}
    new, _p = _upsert([_row("trn_n1")], dd)
    assert len(new) == 1 and dd["count"] == 0
    # an old candidate first seen AFTER the reconnect is not an old-consent row
    txns2, _a2 = _dedupe_world(monkeypatch, [_old_row("trn_o2", first_seen=datetime(2026, 11, 2))])
    dd2 = _dd()
    new2, _p = _upsert([_row("trn_n2")], dd2)
    assert len(new2) == 1 and dd2["count"] == 0


def test_a_row_with_the_same_id_is_updated_not_deduped(monkeypatch):
    txns, _a = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    dd = _dd()
    new, _p = _upsert([_row("trn_old1")], dd)
    assert new == [] and dd["count"] == 0 and len(txns.docs) == 1


def test_other_accounts_rows_are_never_candidates(monkeypatch):
    other = _old_row("trn_o")
    other["account_id"] = "fx_other"
    txns, _a = _dedupe_world(monkeypatch, [other])
    new, _p = _upsert([_row("trn_n")], _dd())
    assert len(new) == 1


def test_no_dedupe_object_means_the_old_behaviour(monkeypatch):
    txns, _a = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    new, _p = asyncio.run(fs._upsert_finexer_transactions([_row("trn_new1")], "fx_old", UID))
    assert len(new) == 1


def test_sync_passes_a_dedupe_object_only_for_a_reconnected_account(monkeypatch):
    accts, c, upserts = _world(monkeypatch, [dict(OLD)])
    _sync()
    assert upserts and upserts[0][1] is not None and upserts[0][1]["reconnected_at"] is not None
    accts2, c2, upserts2 = _world(monkeypatch, [], client=FpClient("fx_fresh"))
    _sync()
    assert upserts2 and all(dd is None for _a, dd in upserts2)


# ── review fixes ──────────────────────────────────────────────────────────

def test_a_class_mismatch_refuses_the_fingerprint_match(monkeypatch):
    accts, c, _ = _world(monkeypatch, [dict(OLD, finexer_class="savings")])
    fetched, _n = _sync()
    assert fetched == ["fx_new"]
    assert {d["_id"] for d in accts.docs} == {"fx_old", "fx_new"}
    assert next(d for d in accts.docs if d["_id"] == "fx_old")["connection_id"] == CONSENT


def test_an_unset_class_on_either_side_still_matches(monkeypatch):
    accts, c, _ = _world(monkeypatch, [dict(OLD)])
    assert _sync()[0] == ["fx_old"]


def test_dedupe_window_stays_closed_while_the_previous_consent_is_still_authorised(monkeypatch, caplog):
    accts, c, upserts = _world(monkeypatch, [dict(OLD)])
    fs.finexer_consents_col.docs[0]["status"] = "authorized"
    with caplog.at_level("WARNING", logger="app.services.finexer_sync"):
        _sync()
    d = accts.docs[0]
    assert d["finexer_account_id"] == "fx_new" and "reconnected_at" not in d
    assert upserts and all(dd is None for _a, dd in upserts)
    assert any("still authorised" in r.getMessage() for r in caplog.records)


def test_rows_outside_the_window_make_no_query(monkeypatch):
    txns, _a = _dedupe_world(monkeypatch, [])
    calls: list = []
    orig = txns.find_one

    async def spy(q=None, projection=None):
        calls.append(q)
        return await orig(q, projection)
    txns.find_one = spy
    dd = {"reconnected_at": datetime(2027, 3, 1), "skipped": set(), "count": 0}
    _upsert([_row("trn_far")], dd)
    # the only find_one is the upsert's own (find_one_and_update is separate)
    assert calls == []


def test_the_cap_is_logged(monkeypatch, caplog):
    monkeypatch.setattr(fs, "DEDUPE_SKIPPED_CAP", 1)
    txns, _a = _dedupe_world(monkeypatch, [_old_row("trn_old1")])
    with caplog.at_level("WARNING", logger="app.services.finexer_sync"):
        _upsert([_row("trn_new1")], _dd())
    assert any("reached its cap" in r.getMessage() for r in caplog.records)


def test_a_stale_deleted_event_for_the_old_remote_id_does_not_close_the_live_account(monkeypatch):
    import app.routers.webhooks as wh
    live = dict(OLD, finexer_account_id="fx_new", connection_id=NEW_CONSENT, status="connected")
    accts = Store([live])
    monkeypatch.setattr(wh, "accounts_col", accts)
    asyncio.run(wh._mark_account_closed("fx_old"))
    assert "closed_at" not in accts.docs[0]
    asyncio.run(wh._mark_account_closed("fx_new"))
    assert "closed_at" in accts.docs[0]


def test_a_deleted_event_still_closes_an_account_never_rekeyed(monkeypatch):
    import app.routers.webhooks as wh
    plain = {"_id": "fx_plain", "source": "finexer", "user_id": UID}
    accts = Store([plain])
    monkeypatch.setattr(wh, "accounts_col", accts)
    asyncio.run(wh._mark_account_closed("fx_plain"))
    assert "closed_at" in accts.docs[0]
