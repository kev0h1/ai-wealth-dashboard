"""A171: SESSION_SECRET rotation window. Previous key verifies only, and only
until SESSION_SECRET_PREVIOUS_UNTIL (inclusive, UTC)."""
from datetime import datetime, timezone

import pytest
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import RotatingSessionSerializer

OLD, NEW = "old-secret-for-tests", "new-secret-for-tests"


def _clock(y, m, d):
    return lambda: datetime(y, m, d, 12, 0, tzinfo=timezone.utc)


def _old_token():
    return URLSafeTimedSerializer(OLD).dumps({"email": "a@example.com"})


def test_previous_verifies_before_and_on_the_until_date():
    for day in (20, 31):
        s = RotatingSessionSerializer(NEW, OLD, "2026-10-31", clock=_clock(2026, 10, day))
        assert s.loads(_old_token(), max_age=60)["email"] == "a@example.com"


def test_previous_rejected_after_the_until_date():
    s = RotatingSessionSerializer(NEW, OLD, "2026-10-31", clock=_clock(2026, 11, 1))
    with pytest.raises(BadSignature):
        s.loads(_old_token(), max_age=60)


@pytest.mark.parametrize("until", ["", "not-a-date"])
def test_previous_ignored_without_a_valid_date(until):
    s = RotatingSessionSerializer(NEW, OLD, until, clock=_clock(2026, 10, 22))
    with pytest.raises(BadSignature):
        s.loads(_old_token(), max_age=60)


def test_previous_ignored_when_unset():
    s = RotatingSessionSerializer(NEW, "", "2099-01-01", clock=_clock(2026, 10, 22))
    with pytest.raises(BadSignature):
        s.loads(_old_token(), max_age=60)


def test_nothing_is_ever_signed_with_previous():
    s = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 22))
    tok = s.dumps({"email": "a@example.com"})
    assert URLSafeTimedSerializer(NEW).loads(tok)["email"] == "a@example.com"
    with pytest.raises(BadSignature):
        URLSafeTimedSerializer(OLD).loads(tok)


def test_current_key_tokens_always_verify():
    s = RotatingSessionSerializer(NEW, OLD, "2000-01-01", clock=_clock(2026, 10, 22))
    assert s.loads(s.dumps({"email": "b@example.com"}), max_age=60)["email"] == "b@example.com"


def test_expired_previous_token_still_expires_inside_window():
    s = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 22))
    with pytest.raises(SignatureExpired):
        s.loads(_old_token(), max_age=-1)


def test_return_timestamp_passthrough():
    s = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 22))
    data, issued = s.loads(_old_token(), max_age=60, return_timestamp=True)
    assert data["email"] == "a@example.com" and issued is not None


def test_far_future_until_is_clamped_to_seven_days(caplog):
    with caplog.at_level("WARNING"):
        early = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 22))
    assert "clamped" in caplog.text
    assert OLD not in caplog.text
    inside = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 29))
    assert inside.previous_active() is True
    assert early._until.isoformat() == "2026-10-29"
    outside = RotatingSessionSerializer(NEW, OLD, "2099-01-01", clock=_clock(2026, 10, 22))
    outside._clock = _clock(2026, 10, 30)
    assert outside.previous_active() is False
