"""Regression coverage for A86 (pentest A51-2026-09-20, case API-08):
commitments.py's status state machine and POST /commitments both had gaps,
live-confirmed against production 2026-09-20 (see
docs/security/pentest-runs/A51-2026-09-20/records.md, API-08):

  1. No allowed-transition guard on commitment status — a `done` commitment
     could be cancelled (`DELETE`), and `contribute_delta` was accepted on
     an already-cancelled commitment (money silently applied to a terminal
     goal).
  2. `POST /commitments` had no idempotency or duplicate guard — an
     identical resend created a second, distinct active goal.

The fix (this item) adds `_ALLOWED_STATUS_TRANSITIONS` /
`_check_status_transition` (the one place legal transitions are defined,
applied by both `update_commitment`'s `status` handling and
`delete_commitment`'s cancel), a `current_status != "active"` guard on
`contribute_delta`, and a duplicate-create guard on `create_commitment`
(same-user + same normalised title + same amount ACTIVE commitment, or a
repeat `Idempotency-Key` header) that returns the existing document instead
of creating a new one.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following this suite's established
convention (test_allocations.py, test_pentest_a50_cross_tenant_ownership.py)
that FakeCol is not shared across test files. `_cashflow` and
`get_debt_plan_cached` (commitments.py's feasibility/debt context inputs)
are monkeypatched to raise, exactly the "degrades to None" path both
`_feasibility_ctx`/`_debt_ctx` already document for any failure — feasibility
is decorative and irrelevant to this item's own transition/dedupe fix, so
this keeps the tests hermetic without faking the whole cashflow/debt-plan
machinery.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.commitments as commitments

UID = "kevin@example.com"
USER = {"email": UID}
FUTURE_DATE = (date.today() + timedelta(days=200)).isoformat()


# ── Generic fake-Mongo plumbing (subset matcher + collection) ───────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict) and "$ne" in cond:
            if val == cond["$ne"]:
                return False
        elif val != cond:
            return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class FakeCol:
    """Stand-in for a Motor collection — enough of find()/find_one()/
    insert_one()/update_one() to drive the real router code."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        if "_id" not in doc:
            doc["_id"] = ObjectId()
        self.docs.append(doc)
        return _InsertResult(doc["_id"])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            new_doc = dict(filt)
            for k, v in (update.get("$set") or {}).items():
                new_doc[k] = v
            self.docs.append(new_doc)


class _FakeHeaders(dict):
    """Case-insensitive-enough stand-in for Starlette's Headers — this
    suite only ever looks up "idempotency-key"."""

    def get(self, key, default=None):
        return super().get(key.lower(), default)


class _FakeRequest:
    """Duck-typed stand-in for fastapi.Request — create_commitment only
    ever calls `request.headers.get(...)`, and (per the can_i.py convention
    this router already follows for billing.py's `_reject_native_platform`)
    `request=None` over a direct call is itself a supported shape too."""

    def __init__(self, headers=None):
        self.headers = _FakeHeaders({k.lower(): v for k, v in (headers or {}).items()})


async def _boom(*args, **kwargs):
    """Stands in for `_cashflow` / `get_debt_plan_cached` — both callers
    (`_feasibility_ctx`, `_debt_ctx`) catch broadly and degrade to `None`
    on any failure, which is exactly what this item's own tests want:
    feasibility/debt context is decorative and irrelevant to the
    transition-guard and dedupe fix under test here."""
    raise RuntimeError("not needed for this test")


def _setup(monkeypatch, *, commitments_docs=None):
    monkeypatch.setattr(commitments, "commitments_col", FakeCol(commitments_docs or []))
    monkeypatch.setattr(commitments, "accounts_col", FakeCol([]))
    monkeypatch.setattr(commitments, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(commitments, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(commitments, "preferences_col", FakeCol([]))
    monkeypatch.setattr(commitments, "savings_goals_col", FakeCol([]))
    monkeypatch.setattr(commitments, "_cashflow", _boom)
    monkeypatch.setattr(commitments, "get_debt_plan_cached", _boom)
    return commitments.commitments_col


def _doc(name="Holiday Fund", amount=500.0, status="active", uid=UID, **extra):
    d = {
        "_id":          ObjectId(),
        "user_id":      uid,
        "name":         name,
        "amount":       amount,
        "target_date":  FUTURE_DATE,
        "funding_pots": [],
        "contributed":  0.0,
        "source":       "manual",
        "status":       status,
        "created_at":   datetime.now(timezone.utc),
    }
    d.update(extra)
    return d


# ── 1. Status transition guard ───────────────────────────────────────────────

def test_done_to_cancelled_is_rejected_409(monkeypatch):
    """The exact bug A51-2026-09-20 confirmed live: DELETE (cancel) on an
    already-done commitment used to return 200 and flip it to cancelled.
    It must now 409."""
    doc = _doc(status="done")
    _setup(monkeypatch, commitments_docs=[doc])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.delete_commitment(str(doc["_id"]), user=USER))
    assert exc.value.status_code == 409
    assert "done" in str(exc.value.detail)
    assert "cancelled" in str(exc.value.detail)
    # Untouched — the rejected transition never wrote anything.
    assert doc["status"] == "done"


def test_done_to_cancelled_via_patch_status_is_also_rejected_409(monkeypatch):
    """Same transition, reached through PATCH status instead of DELETE —
    both entry points share the one allowed-transition map."""
    doc = _doc(status="done")
    _setup(monkeypatch, commitments_docs=[doc])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            commitments.update_commitment(str(doc["_id"]), {"status": "cancelled"}, user=USER)
        )
    assert exc.value.status_code == 409
    assert doc["status"] == "done"


def test_contribute_delta_on_cancelled_commitment_is_rejected_409(monkeypatch):
    """The "reordered steps" half of API-08: contribute_delta used to be
    accepted, and actually applied, against an already-cancelled
    commitment."""
    doc = _doc(status="cancelled", contributed=10.0)
    _setup(monkeypatch, commitments_docs=[doc])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            commitments.update_commitment(
                str(doc["_id"]), {"contribute_delta": 0.01}, user=USER
            )
        )
    assert exc.value.status_code == 409
    assert "cancelled" in str(exc.value.detail)
    # Contribution never applied.
    assert doc["contributed"] == 10.0


def test_contribute_delta_on_done_commitment_is_also_rejected_409(monkeypatch):
    doc = _doc(status="done", contributed=500.0)
    _setup(monkeypatch, commitments_docs=[doc])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            commitments.update_commitment(
                str(doc["_id"]), {"contribute_delta": 1.0}, user=USER
            )
        )
    assert exc.value.status_code == 409


def test_active_commitment_still_accepts_contribute_delta(monkeypatch):
    """Happy path preserved: contributing to a still-active commitment
    (the only status CommitmentSheet's flows ever contribute against) still
    works."""
    doc = _doc(status="active", contributed=10.0)
    _setup(monkeypatch, commitments_docs=[doc])

    result = asyncio.run(
        commitments.update_commitment(
            str(doc["_id"]), {"contribute_delta": 5.0}, user=USER
        )
    )
    assert result["id"] == str(doc["_id"])
    assert doc["contributed"] == 15.0


def test_active_to_cancelled_via_delete_still_works(monkeypatch):
    """The transition CommitmentSheet's cancel control and
    propose_delete_commitment actually perform every day — must keep
    working under the new guard."""
    doc = _doc(status="active")
    _setup(monkeypatch, commitments_docs=[doc])

    result = asyncio.run(commitments.delete_commitment(str(doc["_id"]), user=USER))
    assert result == {"id": str(doc["_id"]), "status": "cancelled"}
    assert doc["status"] == "cancelled"


def test_active_to_done_via_patch_status_still_works(monkeypatch):
    """active -> done is a legitimate forward transition (the schema's own
    documented status set) even though no current frontend/Penny call site
    exercises it yet — must not be collateral damage from closing the
    done -> cancelled hole."""
    doc = _doc(status="active")
    _setup(monkeypatch, commitments_docs=[doc])

    result = asyncio.run(
        commitments.update_commitment(str(doc["_id"]), {"status": "done"}, user=USER)
    )
    assert result["status"] == "done"
    assert doc["status"] == "done"


def test_double_cancel_is_an_idempotent_no_op_not_an_error(monkeypatch):
    """cancelled -> cancelled is on the allowed map by design, so a
    double-cancel (e.g. a retried DELETE) is a harmless 200, not a 409."""
    doc = _doc(status="cancelled")
    _setup(monkeypatch, commitments_docs=[doc])

    result = asyncio.run(commitments.delete_commitment(str(doc["_id"]), user=USER))
    assert result == {"id": str(doc["_id"]), "status": "cancelled"}


def test_editing_name_and_amount_is_unaffected_by_status_guard(monkeypatch):
    """The transition guard only gates `status`/`contribute_delta` — plain
    field edits (CommitmentSheet's ordinary save) are untouched regardless
    of status."""
    doc = _doc(status="active", name="Old name", amount=500.0)
    _setup(monkeypatch, commitments_docs=[doc])

    result = asyncio.run(
        commitments.update_commitment(
            str(doc["_id"]), {"name": "New name", "amount": 600.0}, user=USER
        )
    )
    assert result["name"] == "New name"
    assert result["amount"] == 600.0


# ── 2. Duplicate-create guard ────────────────────────────────────────────────

def test_exact_duplicate_post_returns_existing_commitment_not_a_new_one(monkeypatch):
    """The live-confirmed duplicate-submit finding: two identical POSTs used
    to both return 200 with distinct ids. The second must now return the
    SAME document, and the user's total commitment count stays at 1."""
    col = _setup(monkeypatch)

    body = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    first = asyncio.run(commitments.create_commitment(body, user=USER))
    assert len(col.docs) == 1

    # Same normalised title (different case/whitespace) + same amount.
    dup_body = {"name": "  holiday   FUND ", "amount": 500.0, "target_date": FUTURE_DATE}
    second = asyncio.run(commitments.create_commitment(dup_body, user=USER))

    assert second["id"] == first["id"]
    assert len(col.docs) == 1  # no second document was inserted


def test_post_with_different_title_creates_a_genuine_second_commitment(monkeypatch):
    col = _setup(monkeypatch)

    body_a = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    first = asyncio.run(commitments.create_commitment(body_a, user=USER))

    body_b = {"name": "Car", "amount": 500.0, "target_date": FUTURE_DATE}
    second = asyncio.run(commitments.create_commitment(body_b, user=USER))

    assert second["id"] != first["id"]
    assert len(col.docs) == 2


def test_repeat_post_with_same_idempotency_key_returns_same_document(monkeypatch):
    """Idempotency-Key header takes priority over (and doesn't require) the
    title/amount match — a resend with a different body but the same key
    still returns the original document."""
    col = _setup(monkeypatch)
    req = _FakeRequest({"Idempotency-Key": "retry-abc-123"})

    body = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    first = asyncio.run(commitments.create_commitment(body, request=req, user=USER))
    assert len(col.docs) == 1

    retry_body = {"name": "Holiday Fund (retry)", "amount": 500.0, "target_date": FUTURE_DATE}
    second = asyncio.run(commitments.create_commitment(retry_body, request=req, user=USER))

    assert second["id"] == first["id"]
    assert len(col.docs) == 1


def test_different_idempotency_key_creates_a_new_commitment(monkeypatch):
    col = _setup(monkeypatch)

    body_a = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    first = asyncio.run(
        commitments.create_commitment(
            body_a, request=_FakeRequest({"Idempotency-Key": "key-1"}), user=USER
        )
    )
    body_b = {"name": "Different Goal", "amount": 700.0, "target_date": FUTURE_DATE}
    second = asyncio.run(
        commitments.create_commitment(
            body_b, request=_FakeRequest({"Idempotency-Key": "key-2"}), user=USER
        )
    )

    assert second["id"] != first["id"]
    assert len(col.docs) == 2


def test_duplicate_dedupe_is_scoped_to_the_requesting_user(monkeypatch):
    """A same-title, same-amount ACTIVE commitment belonging to a DIFFERENT
    user must never be treated as a duplicate."""
    other_doc = _doc(name="Holiday Fund", amount=500.0, status="active", uid="someone-else@example.com")
    col = _setup(monkeypatch, commitments_docs=[other_doc])

    body = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    result = asyncio.run(commitments.create_commitment(body, user=USER))

    assert result["id"] != str(other_doc["_id"])
    assert len(col.docs) == 2


def test_duplicate_dedupe_ignores_a_cancelled_commitment_of_the_same_title(monkeypatch):
    """Only an ACTIVE commitment blocks a duplicate — a cancelled one with
    the same title/amount does not, since the user may legitimately want to
    restart the same goal."""
    cancelled = _doc(name="Holiday Fund", amount=500.0, status="cancelled")
    col = _setup(monkeypatch, commitments_docs=[cancelled])

    body = {"name": "Holiday Fund", "amount": 500.0, "target_date": FUTURE_DATE}
    result = asyncio.run(commitments.create_commitment(body, user=USER))

    assert result["id"] != str(cancelled["_id"])
    assert len(col.docs) == 2
