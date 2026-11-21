"""C48: an Apple purchase already owned by another Sorted account.

The server refusal was always right; what was missing is the explanation. The
403 now carries a masked hint of the owning account (and nothing else about
it), the mismatch is logged for /ops, and nothing is ever moved or re-bound.
Fake signed payloads only; Apple is never called.
"""
import pytest
from fastapi import HTTPException

import app.core.config as config
import app.routers.billing as billing_router
import app.services.apple_billing as apple_billing
from tests.test_apple_billing import (  # noqa: F401  (fixtures are used by name)
    OTHER, UID, _doc, _run, _signed_tx, _token, env, pki,
)

OWNER = "kevin.maingi12@gmail.com"


def _mismatch(env_, **kw):
    """The route called as UID with a transaction OWNER's token signed."""
    _token(env_, UID)
    body = {"signed_transaction": _signed_tx(env_, uid=OWNER, **kw)}
    with pytest.raises(HTTPException) as exc:
        _run(billing_router.apple_verify(body, {"email": UID}))
    return exc.value


def test_mask_email_hint_shows_one_letter_each_and_the_suffix_only():
    assert config.mask_email_hint(OWNER) == "k•••@g•••.com"
    assert config.mask_email_hint("a.b@mail.example.co.uk") == "a•••@m•••.uk"
    for bad in (None, "", "no-at-sign", "@x.com", "a@"):
        assert config.mask_email_hint(bad) is None
    masked = config.mask_email_hint(OWNER)
    assert "maingi" not in masked and "gmail" not in masked


def test_mismatch_is_a_403_with_only_a_masked_hint(env):
    err = _mismatch(env)
    assert err.status_code == 403
    assert err.detail["code"] == "APPLE_ACCOUNT_MISMATCH"
    assert err.detail["owner_hint"] == "k•••@g•••.com"
    blob = repr(err.detail)
    assert OWNER not in blob and "maingi" not in blob and "gmail" not in blob
    assert set(err.detail) == {"code", "message", "owner_hint"}


def test_mismatch_with_an_unknown_owner_has_no_hint(env):
    _token(env, UID)
    body = {"signed_transaction": _signed_tx(env, token=None, original="nobody-holds-this")}
    with pytest.raises(HTTPException) as exc:
        _run(billing_router.apple_verify(body, {"email": UID}))
    assert exc.value.status_code == 403 and exc.value.detail["owner_hint"] is None


def test_mismatch_never_rebinds_or_grants(env):
    owner_token = _token(env, OWNER)
    _mismatch(env)
    assert env["subscriptions_col"].docs == []  # nothing granted to either account
    tokens = {d["user_id"]: d["app_account_token"] for d in env["apple_account_tokens_col"].docs}
    assert tokens[OWNER] == owner_token and tokens[UID] != owner_token  # tokens untouched


def test_mismatch_is_logged_for_ops_with_count_and_masked_owner(env):
    _mismatch(env)
    _mismatch(env, original="orig-2")
    doc = next(d for d in env["apple_account_tokens_col"].docs if d["user_id"] == UID)
    assert doc["mismatch_count"] == 2
    assert [m["owner_hint"] for m in doc["mismatches"]] == ["k•••@g•••.com"] * 2
    assert all(m["at"] is not None for m in doc["mismatches"])
    assert OWNER not in repr(doc["mismatches"])
    owner_doc = next(d for d in env["apple_account_tokens_col"].docs if d["user_id"] == OWNER)
    assert "mismatch_count" not in owner_doc  # logged against the person who hit it only


def test_mismatch_log_is_capped(env):
    _mismatch(env)
    for _ in range(apple_billing.MISMATCH_LOG_LIMIT + 5):
        _run(apple_billing.record_account_mismatch(UID, "k•••@g•••.com"))
    doc = next(d for d in env["apple_account_tokens_col"].docs if d["user_id"] == UID)
    assert len(doc["mismatches"]) == apple_billing.MISMATCH_LOG_LIMIT
    assert doc["mismatch_count"] == apple_billing.MISMATCH_LOG_LIMIT + 6


def test_a_logging_fault_does_not_change_the_refusal(env, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(env["apple_account_tokens_col"], "update_one", boom)
    assert _mismatch(env).status_code == 403


def test_ops_person_detail_shows_mismatches(env):
    from app.routers import ops_people_subscription as ops
    _mismatch(env)
    summary = _run(ops.apple_mismatch_summary(UID))
    assert summary["count"] == 1
    assert summary["recent"][0]["owner_hint"] == "k•••@g•••.com"
    assert OWNER not in repr(summary)
    assert _run(ops.apple_mismatch_summary(OTHER)) == {"count": 0, "recent": []}
    src = open(ops.__file__).read()
    assert '"apple_mismatch": await apple_mismatch_summary(uid)' in src  # wired into the person detail
