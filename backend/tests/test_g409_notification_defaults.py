"""G409: notification categories default on without overriding saved choices."""
import asyncio

import app.routers.preferences as preferences
import app.services.notifications as notifications


UID = "user@example.com"


class _Preferences:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, query, projection=None):
        assert query == {"user_id": UID}
        return self.doc


def _patch_preferences(monkeypatch, doc=None):
    store = _Preferences(doc)
    monkeypatch.setattr(preferences, "preferences_col", store)
    monkeypatch.setattr(notifications, "preferences_col", store)


def test_fresh_user_get_and_sender_default_every_notification_category_on(monkeypatch):
    _patch_preferences(monkeypatch)

    response = asyncio.run(preferences.get_preferences({"email": UID}))

    assert response["notification_prefs"] == notifications.NOTIF_DEFAULTS
    assert all(response["notification_prefs"].values())
    for key in notifications.NOTIF_DEFAULTS:
        assert asyncio.run(notifications.notif_pref(UID, key)) is True


def test_partial_saved_preferences_keep_transactions_default_on_and_opt_outs_off(monkeypatch):
    _patch_preferences(monkeypatch, {
        "user_id": UID,
        "notification_prefs": {
            "bill_alerts": False,
            "future_category": False,
        },
    })

    response = asyncio.run(preferences.get_preferences({"email": UID}))

    # A legacy/partial save has no transactions key, so the new default
    # applies in both the API response and the sender's direct DB lookup.
    assert response["notification_prefs"]["transactions"] is True
    assert asyncio.run(notifications.notif_pref(UID, "transactions")) is True
    # Saved opt-outs for known categories stay authoritative.
    assert response["notification_prefs"]["bill_alerts"] is False
    assert asyncio.run(notifications.notif_pref(UID, "bill_alerts")) is False
    # An off-screen/future category is not accidentally enabled by the
    # default change: sender fallback remains false for keys without defaults.
    assert asyncio.run(notifications.notif_pref(UID, "future_category")) is False


def test_explicit_transactions_opt_out_stays_off_in_api_and_sender(monkeypatch):
    _patch_preferences(monkeypatch, {
        "user_id": UID,
        "notification_prefs": {"transactions": False},
    })

    response = asyncio.run(preferences.get_preferences({"email": UID}))

    assert response["notification_prefs"]["transactions"] is False
    assert asyncio.run(notifications.notif_pref(UID, "transactions")) is False
