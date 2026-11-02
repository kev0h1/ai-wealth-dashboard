"""A187: Finexer naive timestamps are London local time; Z and offsets are honoured."""
import logging
from datetime import datetime, timedelta

from app.services import finexer_sync as fs

LOGGER = "app.services.finexer_sync"


def test_naive_bst_converts_to_utc():
    assert fs.parse_finexer_timestamp("2026-11-02T07:25:55") == datetime(2026, 11, 2, 7, 25, 55)  # GMT in Nov
    assert fs.parse_finexer_timestamp("2026-07-02T07:25:55") == datetime(2026, 7, 2, 6, 25, 55)


def test_naive_gmt_unchanged():
    assert fs.parse_finexer_timestamp("2026-01-15T10:00:00") == datetime(2026, 1, 15, 10, 0, 0)


def test_z_and_offset_unchanged():
    assert fs.parse_finexer_timestamp("2026-07-02T07:25:55Z") == datetime(2026, 7, 2, 7, 25, 55)
    assert fs.parse_finexer_timestamp("2026-07-02T07:25:55+01:00") == datetime(2026, 7, 2, 6, 25, 55)
    assert fs.parse_finexer_timestamp("2026-07-02T07:25:55+00:00") == datetime(2026, 7, 2, 7, 25, 55)


def test_junk_and_empty():
    assert fs.parse_finexer_timestamp(None) is None
    assert fs.parse_finexer_timestamp("nope") is None


def test_own_stamps_stay_utc():
    assert fs._parse_iso_utc("2026-07-02T07:25:55") == datetime(2026, 7, 2, 7, 25, 55)


def test_sync_fields_naive_in_bst():
    out = fs._sync_fields(
        {"synced_from": "2026-07-01T00:00:00", "synced_to": "2026-07-02T07:25:55"},
        requested_at=datetime(2026, 7, 2, 6, 25, 55),
    )
    assert out["bank_synced_to"] == datetime(2026, 7, 2, 6, 25, 55)
    assert out["bank_synced_from"] == datetime(2026, 6, 30, 23, 0, 0)


def test_consent_expiry_and_renewed_naive_convert_same_way():
    from app.services.finexer_consent import consent_sync_fields
    out = consent_sync_fields(
        {"status": "authorized", "renewed_at": "2026-07-02T12:00:00", "expiry_date": "2027-07-02T12:00:00"},
        {"authed_at": datetime(2026, 1, 1)},
    )
    assert out["renewed_at"] == datetime(2026, 7, 2, 11, 0, 0)
    assert out["next_reconfirm_by"] == datetime(2026, 7, 2, 11, 0, 0) + timedelta(days=90)
    assert fs.parse_finexer_timestamp("2026-07-02T12:00:00") == datetime(2026, 7, 2, 11, 0, 0)


def test_shape_log_carries_no_value(caplog):
    raw = "2026-07-02T07:25:55"
    with caplog.at_level(logging.INFO, logger=LOGGER):
        fs._sync_fields({"synced_to": raw}, requested_at=datetime(2026, 7, 2, 6, 25, 55))
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "naive len=19" in text
    assert "07:25" not in text and "2026" not in text


def test_shape_kinds():
    assert fs.timestamp_shape("2026-07-02T07:25:55Z").startswith("z ")
    assert fs.timestamp_shape("2026-07-02T07:25:55+01:00").startswith("offset ")
    assert fs.timestamp_shape("2026-07-02T07:25:55").startswith("naive ")


def test_future_clamp_logs_once_and_stores(caplog):
    with caplog.at_level(logging.INFO, logger=LOGGER):
        out = fs._sync_fields({"synced_to": "2026-07-02T09:00:00Z"}, requested_at=datetime(2026, 7, 2, 6, 25, 55))
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1 and "2026" not in warns[0].getMessage()
    assert out["bank_synced_to"] == datetime(2026, 7, 2, 9, 0, 0)


def test_no_future_warning_when_close(caplog):
    with caplog.at_level(logging.INFO, logger=LOGGER):
        fs._sync_fields({"synced_to": "2026-07-02T06:27:00Z"}, requested_at=datetime(2026, 7, 2, 6, 25, 55))
    assert not [r for r in caplog.records if r.levelno == logging.WARNING]
