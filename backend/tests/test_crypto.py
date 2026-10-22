from app.core.crypto import encrypt_token, decrypt_token, is_encrypted


def test_roundtrip():
    token = "tl-access-token-abc123"
    enc = encrypt_token(token)
    assert enc != token
    assert is_encrypted(enc)
    assert decrypt_token(enc) == token


def test_plaintext_passthrough():
    # Legacy unencrypted tokens must survive decrypt unchanged
    assert decrypt_token("plain-legacy-token") == "plain-legacy-token"
    assert not is_encrypted("plain-legacy-token")


def test_none_and_empty():
    assert encrypt_token(None) is None
    assert decrypt_token(None) is None
    assert encrypt_token("") == ""
    assert decrypt_token("") == ""


# ── A171: key rotation ───────────────────────────────────────────────────────
import asyncio

import pytest
from cryptography.fernet import Fernet

from app.core.crypto import KeyRing
from scripts import reencrypt_tokens as rt


def _keys():
    return Fernet.generate_key(), Fernet.generate_key()


def test_old_ciphertext_readable_with_new_plus_previous():
    old, new = _keys()
    ct = KeyRing(old).encrypt("secret-token")
    ring = KeyRing(new, old)
    assert ring.classify(ct) == "previous"
    assert ring.decrypt(ct) == "secret-token"


def test_encrypts_with_primary_only():
    old, new = _keys()
    ring = KeyRing(new, old)
    ct = ring.encrypt("abc")
    assert ring.classify(ct) == "primary"
    # the previous key alone cannot open it
    assert KeyRing(old).decrypt(ct) is None
    assert KeyRing(new).decrypt(ct) == "abc"


def test_reencrypt_moves_to_primary_and_is_idempotent_per_value():
    old, new = _keys()
    ring = KeyRing(new, old)
    ct = KeyRing(old).encrypt("tok")
    moved = ring.reencrypt_if_previous(ct)
    assert moved and KeyRing(new).decrypt(moved) == "tok"
    assert ring.reencrypt_if_previous(moved) is None


def test_unknown_key_fails_closed():
    old, new = _keys()
    stranger = KeyRing(Fernet.generate_key()).encrypt("x")
    ring = KeyRing(new, old)
    assert ring.classify(stranger) == "unknown"
    assert ring.decrypt(stranger) is None
    assert ring.reencrypt_if_previous(stranger) is None


def test_no_previous_key_means_old_ciphertext_unreadable():
    old, new = _keys()
    ct = KeyRing(old).encrypt("x")
    assert KeyRing(new).decrypt(ct) is None


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield dict(d)
        return gen()


class _Res:
    def __init__(self, n):
        self.modified_count = n


class _Col:
    def __init__(self, docs):
        self.docs = docs
        self.writes = 0

    def find(self, query, projection=None):
        (field,) = query.keys()
        return _Cursor([d for d in self.docs if field in d])

    async def update_one(self, filt, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                d.update(update["$set"])
                self.writes += 1
                return _Res(1)
        return _Res(0)


def _fixture():
    old, new = _keys()
    oldr = KeyRing(old)
    ring = KeyRing(new, old)
    col = _Col([
        {"_id": 1, "access_token": oldr.encrypt("a1"), "refresh_token": oldr.encrypt("r1")},
        {"_id": 2, "access_token": ring.encrypt("a2"), "refresh_token": "legacy-plain"},
        {"_id": 3, "access_token": KeyRing(Fernet.generate_key()).encrypt("zz")},
    ])
    return ring, col, [("connections_col", col, ("access_token", "refresh_token"))]


def test_script_dry_run_writes_nothing():
    ring, col, targets = _fixture()
    report = asyncio.run(rt.reencrypt(targets, ring, apply=False))
    assert col.writes == 0
    assert report[("connections_col", "access_token")]["previous"] == 1
    assert report[("connections_col", "access_token")]["unknown"] == 1
    assert report[("connections_col", "refresh_token")]["plaintext"] == 1
    text = rt.format_report(report, False)
    assert "a1" not in text and "gAAAAA" not in text


def test_script_apply_is_idempotent_and_leaves_unknown_alone():
    ring, col, targets = _fixture()
    unknown_before = col.docs[2]["access_token"]
    first = asyncio.run(rt.reencrypt(targets, ring, apply=True))
    assert first[("connections_col", "access_token")]["rewritten"] == 1
    assert first[("connections_col", "refresh_token")]["rewritten"] == 1
    assert ring.decrypt(col.docs[0]["access_token"]) == "a1"
    assert ring.classify(col.docs[0]["refresh_token"]) == "primary"
    assert col.docs[1]["refresh_token"] == "legacy-plain"
    assert col.docs[2]["access_token"] == unknown_before
    writes = col.writes
    second = asyncio.run(rt.reencrypt(targets, ring, apply=True))
    assert col.writes == writes
    assert second[("connections_col", "access_token")]["previous"] == 0
    # unknown still blocks the "safe to remove previous" signal
    assert rt.remaining(second, True) == 1


def test_script_targets_cover_every_call_site():
    assert ("connections_col", ("access_token", "refresh_token")) in rt.TARGETS
    assert ("yapily_consents_col", ("token",)) in rt.TARGETS
