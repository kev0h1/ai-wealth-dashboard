"""Tests for A30: Yapily consent tokens must be encrypted at rest, on the
same terms as TrueLayer's access/refresh tokens (app.core.crypto).

Yapily's consent token is a harder case than TrueLayer's: the value Yapily
hands back is used BOTH as the bearer credential (sent verbatim as the
`consent` header on every accounts/transactions call) AND, in the
pre-A30 code, as our own Mongo `_id` / join key across yapily_consents_col
and yapily_accounts_col. Fernet ciphertext is randomised per call, so it
can't be used as an exact-match `_id` directly — the fix (app.services.
yapily_sync) keys documents by a non-reversible SHA-256 fingerprint of the
token instead, and stores the recoverable value Fernet-encrypted in a
separate `token` field, decrypted only when actually calling Yapily's API.

No mongomock is available in this environment (see test_notifications.py's
own note), so DB-touching collections are replaced with a tiny in-memory
fake, following the same pattern already established in
test_internal_inflows.py / test_transfer_pairs.py.
"""

import asyncio

from cryptography.fernet import Fernet

import app.services.yapily_sync as yapily_sync
from app.core.crypto import encrypt_token, decrypt_token, is_encrypted, token_fingerprint


# ── Generic fake-Mongo plumbing, same minimal subset as
# test_internal_inflows.py's FakeCol, plus insert_one/delete_one/
# count_documents which this file's tests need and that one didn't. ───────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict) and "$exists" in cond:
            if (key in doc) != cond["$exists"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _ModifiedResult:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor([d for d in self.docs if _match(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _match(d, query or {}):
                return d
        return None

    async def count_documents(self, query=None):
        return len([d for d in self.docs if _match(d, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def delete_one(self, query):
        for i, d in enumerate(self.docs):
            if _match(d, query):
                del self.docs[i]
                return

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def update_many(self, filt, update):
        n = 0
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                n += 1
        return _ModifiedResult(n)

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v


RAW_TOKEN = "yap-consent-abc123-super-secret"
UID = "kevin"


# ── app.core.crypto: the encryption primitive itself ─────────────────────

def test_token_roundtrips_through_encrypt_and_decrypt():
    enc = encrypt_token(RAW_TOKEN)
    assert enc != RAW_TOKEN
    assert decrypt_token(enc) == RAW_TOKEN


def test_stored_value_not_readable_as_plaintext():
    enc = encrypt_token(RAW_TOKEN)
    # Ticket's own proof-by-shape: encrypted values carry Fernet's gAAAAA
    # version prefix; the raw secret must not appear anywhere in the
    # ciphertext (Fernet base64-encodes an AES-CBC + HMAC envelope, so this
    # also rules out it being trivially recoverable by inspection).
    assert is_encrypted(enc)
    assert enc.startswith("gAAAAA")
    assert RAW_TOKEN not in enc


def test_wrong_key_fails_closed_not_garbage():
    # A value encrypted under a DIFFERENT Fernet key than the one this
    # process resolved at import (app.core.crypto._fernet) — simulates a
    # lost/rotated TOKEN_ENCRYPTION_KEY. decrypt_token must return None,
    # never raise, and never hand back corrupted "garbage" plaintext.
    foreign_key = Fernet.generate_key()
    foreign_ciphertext = Fernet(foreign_key).encrypt(RAW_TOKEN.encode()).decode()
    assert foreign_ciphertext.startswith("gAAAAA")  # still looks encrypted
    assert decrypt_token(foreign_ciphertext) is None


def test_token_fingerprint_deterministic_and_non_reversible():
    fp1 = token_fingerprint(RAW_TOKEN)
    fp2 = token_fingerprint(RAW_TOKEN)
    assert fp1 == fp2  # same input -> same lookup key, every time
    assert fp1 != token_fingerprint(RAW_TOKEN + "x")
    assert RAW_TOKEN not in fp1
    assert fp1 != RAW_TOKEN


# ── app.services.yapily_sync: the legacy-upgrade / resolve path ──────────

def test_upgrade_legacy_consent_rekeys_and_encrypts(monkeypatch):
    """A pre-A30 row (raw token as `_id`, no `token` field) must end up
    keyed by the fingerprint, with the raw token recoverable only via
    decrypt_token, and must not still carry the raw value as `_id`."""
    consents = FakeCol([{"_id": RAW_TOKEN, "user_id": UID, "status": "AUTHORIZED"}])
    accounts = FakeCol([{"_id": "acc1", "user_id": UID, "consent": RAW_TOKEN}])
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", consents)
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", accounts)

    doc = asyncio.run(
        yapily_sync.upgrade_legacy_consent(consents.docs[0])
    )

    expected_id = token_fingerprint(RAW_TOKEN)
    assert doc["_id"] == expected_id
    assert doc["_id"] != RAW_TOKEN
    assert is_encrypted(doc["token"])
    assert decrypt_token(doc["token"]) == RAW_TOKEN

    # Old plaintext-keyed doc is gone; only the rekeyed one remains.
    ids = [d["_id"] for d in consents.docs]
    assert RAW_TOKEN not in ids
    assert expected_id in ids
    for d in consents.docs:
        assert d["_id"] != RAW_TOKEN
        # the raw value must not linger anywhere in the stored doc except
        # inside the encrypted `token` field
        for k, v in d.items():
            if k != "token":
                assert v != RAW_TOKEN

    # The account doc that joined on the old plaintext consent id is
    # repointed to the new fingerprinted id, so accounts keep resolving.
    assert accounts.docs[0]["consent"] == expected_id


def test_upgrade_legacy_consent_idempotent_on_already_upgraded_doc(monkeypatch):
    fp = token_fingerprint(RAW_TOKEN)
    already = {"_id": fp, "user_id": UID, "token": encrypt_token(RAW_TOKEN)}
    consents = FakeCol([already])
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", consents)
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))

    doc = asyncio.run(yapily_sync.upgrade_legacy_consent(already))
    assert doc is already
    assert len(consents.docs) == 1


def test_resolve_consent_token_upgrades_legacy_row_on_read(monkeypatch):
    """The read side (used before every Yapily API call) must transparently
    read a legacy plaintext-`_id` row, hand back the correct raw token to
    call Yapily with, AND leave the row re-written encrypted for next time —
    exactly the 'read legacy plaintext, re-write encrypted' contract."""
    consents = FakeCol([{"_id": RAW_TOKEN, "user_id": UID, "status": "AUTHORIZED"}])
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", consents)
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))

    raw, effective_id = asyncio.run(
        yapily_sync._resolve_consent_token(RAW_TOKEN)
    )
    assert raw == RAW_TOKEN
    assert effective_id == token_fingerprint(RAW_TOKEN)

    # Row is now upgraded in place: fetch by the NEW id finds an encrypted doc.
    upgraded = [d for d in consents.docs if d["_id"] == effective_id]
    assert len(upgraded) == 1
    assert is_encrypted(upgraded[0]["token"])
    assert RAW_TOKEN not in [v for k, v in upgraded[0].items() if k != "token"]


def test_resolve_consent_token_reads_already_upgraded_row(monkeypatch):
    fp = token_fingerprint(RAW_TOKEN)
    consents = FakeCol([{"_id": fp, "user_id": UID, "token": encrypt_token(RAW_TOKEN)}])
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", consents)
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))

    raw, effective_id = asyncio.run(
        yapily_sync._resolve_consent_token(fp)
    )
    assert raw == RAW_TOKEN
    assert effective_id == fp


def test_resolve_consent_token_missing_row_returns_none(monkeypatch):
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", FakeCol([]))
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))

    raw, effective_id = asyncio.run(
        yapily_sync._resolve_consent_token("no-such-id")
    )
    assert raw is None
    assert effective_id is None


def test_resolve_consent_token_wrong_key_fails_closed(monkeypatch):
    """A row encrypted under a key this process no longer has must fail
    closed (no token to sync with), not raise or hand back garbage."""
    fp = token_fingerprint(RAW_TOKEN)
    foreign_ciphertext = Fernet(Fernet.generate_key()).encrypt(RAW_TOKEN.encode()).decode()
    consents = FakeCol([{"_id": fp, "user_id": UID, "token": foreign_ciphertext}])
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", consents)
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))

    raw, effective_id = asyncio.run(
        yapily_sync._resolve_consent_token(fp)
    )
    assert raw is None
    assert effective_id is None


async def _no_op_sync_returns_when_unresolvable(monkeypatch):
    monkeypatch.setattr(yapily_sync, "yapily_consents_col", FakeCol([]))
    monkeypatch.setattr(yapily_sync, "yapily_accounts_col", FakeCol([]))
    # Should return quietly (no HTTP call attempted) when the consent can't
    # be resolved, rather than sending an empty/garbage `consent` header.
    await yapily_sync.sync_yapily_consent("missing-id", UID)


def test_sync_yapily_consent_noop_when_consent_unresolvable(monkeypatch):
    asyncio.run(_no_op_sync_returns_when_unresolvable(monkeypatch))
