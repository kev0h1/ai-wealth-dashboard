"""B45: prove the trial / renewal / failed-payment / cancellation lifecycle on
Stripe TEST mode using a test clock, with no real-time waits.

What it does
  1. Reads STRIPE_SECRET_KEY and STRIPE_PRICE_IDS from backend/.env INTO
     VARIABLES (never printed). Refuses to run unless the key is a test key.
  2. Points the app at a THROWAWAY Mongo database (b45_proof_<timestamp>),
     never "wealth", and drops it at the end.
  3. Creates a disposable customer on a Stripe test clock, creates real test
     subscriptions, advances the clock, and after each step pulls the REAL
     events Stripe generated and feeds them through the app's own
     handle_event (app.services.billing). Signature verification is not in
     play here: handle_event is called directly with the already-fetched
     event, which is the only bypass, and it exists only in this script.
  4. Records the resulting subscription document state per step into
     docs/pricing/trial-lifecycle-proof-b45.md (no ids, no keys).
  5. Deletes the test clock (which deletes its customers) and drops the DB.

Push notifications are captured in memory, never sent.

Usage (from backend/):  .venv/bin/python scripts/stripe_trial_lifecycle_proof.py
"""
import asyncio
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
ENV_CANDIDATES = [BACKEND / ".env", Path("/root/ai-wealth-dashboard/backend/.env")]
OUT_DOC = REPO / "docs" / "pricing" / "trial-lifecycle-proof-b45.md"


def _read_env() -> dict:
    for path in ENV_CANDIDATES:
        if path.exists():
            text = path.read_text()
            break
    else:
        sys.exit("no backend/.env found")
    out = {}
    for key in ("STRIPE_SECRET_KEY", "STRIPE_PRICE_IDS"):
        m = re.search(rf"^{key}=(.*)$", text, re.M)
        out[key] = m.group(1).strip().strip("\"'") if m else ""
    return out


_env = _read_env()
_key = _env["STRIPE_SECRET_KEY"]
_mode = "test" if _key.startswith("sk_test_") else ("live" if _key.startswith("sk_live_") else "unknown")
print(f"stripe key mode: {_mode}")
if _mode != "test":
    sys.exit("refusing to run: not a Stripe TEST key")

PROOF_DB = f"b45_proof_{int(time.time())}"
assert PROOF_DB != "wealth"
os.environ["MONGO_DB"] = PROOF_DB
os.environ["STRIPE_SECRET_KEY"] = _key
os.environ["STRIPE_PRICE_IDS"] = _env["STRIPE_PRICE_IDS"]
os.environ["REVOKE_CONSENT_ON_DOWNGRADE"] = "false"
sys.path.insert(0, str(BACKEND))

import stripe  # noqa: E402

from app.core import subscription as sub_module  # noqa: E402
from app.core.config import STRIPE_PRICE_IDS  # noqa: E402
from app.db import collections as db  # noqa: E402
from app.services import billing  # noqa: E402

assert db.db.name == PROOF_DB, "app is not pointed at the throwaway database"

stripe.api_key = _key
stripe.api_version = billing.STRIPE_API_VERSION

DAY = 86400
UID = f"b45-proof-{int(time.time())}@example.com"
PUSHES: list[tuple[str, str]] = []
ROWS: list[dict] = []
PROCESSED: set[str] = set()
START = int(time.time()) - 5


async def _fake_push(user_id, title, body, url="/"):
    PUSHES.append((title, body))
    return {}


import app.core.push as push_module  # noqa: E402

push_module.send_push_to_user = _fake_push


def _wait_clock(clock_id: str, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        c = stripe.test_helpers.TestClock.retrieve(clock_id)
        if c.status == "ready":
            return c
        time.sleep(2)
    raise TimeoutError("test clock did not become ready")


def _advance(clock_id: str, to_ts: int):
    stripe.test_helpers.TestClock.advance(clock_id, frozen_time=int(to_ts))
    return _wait_clock(clock_id)


def _relevant(obj: dict, customer_ids: set, sub_ids: set) -> bool:
    if obj.get("customer") in customer_ids:
        return True
    return obj.get("id") in sub_ids


async def _drain_events(customer_ids: set, sub_ids: set, note: str) -> list[str]:
    """Fetch every new Stripe event for our customers, oldest first, and
    run it through the app's handler. Returns the handled event types."""
    await asyncio.sleep(4)  # let Stripe finish emitting events for the advance
    events = []
    for ev in stripe.Event.list(created={"gte": START}, limit=100).auto_paging_iter():
        events.append(ev)
    handled = []
    for ev in reversed(events):
        if ev.id in PROCESSED:
            continue
        d = ev.to_dict()
        obj = (d.get("data") or {}).get("object") or {}
        if not _relevant(obj, customer_ids, sub_ids):
            continue
        PROCESSED.add(ev.id)
        res = await billing.handle_event(d)
        handled.append(f"{d['type']} -> {((res.get('result') or {}).get('action') or 'ignored')}")
    return handled


async def _state(label: str, clock_ts: int, handled: list[str], extra: str = ""):
    doc = await db.subscriptions_col.find_one({"user_id": UID}) or {}
    sub = await sub_module.get_subscription(UID)
    paused = await sub_module.open_banking_paused(UID)

    def rel(v, base=None):
        if not v:
            return "-"
        v = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return f"{round((v.timestamp() - (clock_ts if base is None else base)) / DAY):+d}d"

    ROWS.append({
        "step": label,
        "events": "; ".join(handled) or "-",
        "status": doc.get("status", "-"),
        "tier_in_doc": doc.get("tier", "-"),
        "effective_tier": sub.tier_name,
        "trial_ends": rel(doc.get("trial_ends_at")),
        "expires": rel(doc.get("expires_at")),
        "cancel_at_period_end": bool(doc.get("cancel_at_period_end")),
        "grace_until": rel(doc.get("grace_until"), base=time.time()),
        "bank_sync_paused": paused,
        "notes": extra,
    })
    print(f"[{label}] status={doc.get('status')} effective={sub.tier_name} paused={paused} events={len(handled)}")


async def _new_customer(clock_id: str, pm_token: str, tag: str):
    cust = stripe.Customer.create(
        email=f"b45-{tag}-{int(time.time())}@example.com", test_clock=clock_id,
        metadata={"uid": UID},
    )
    pm = stripe.PaymentMethod.attach(pm_token, customer=cust.id)
    stripe.Customer.modify(cust.id, invoice_settings={"default_payment_method": pm.id})
    return cust, pm


def _create_sub(cust_id: str, *, trial: bool):
    kwargs = dict(
        customer=cust_id,
        items=[{"price": STRIPE_PRICE_IDS["standard"]}],
        metadata={"uid": UID, "kind": "subscription", "target": "standard",
                  "billing_period": "monthly", "trial": "true" if trial else "false"},
    )
    if trial:
        kwargs["trial_period_days"] = 14
        kwargs["trial_settings"] = {"end_behavior": {"missing_payment_method": "cancel"}}
    return stripe.Subscription.create(**kwargs)


async def main():
    clock_id = None
    try:
        t0 = int(time.time())
        clock = stripe.test_helpers.TestClock.create(frozen_time=t0, name="b45-proof")
        clock_id = clock.id
        now = t0
        await db.billing_customers_col.delete_many({})

        # 1. Start a trial (what a completed Checkout produces).
        cust, pm = await _new_customer(clock_id, "pm_card_visa", "main")
        await db.billing_customers_col.insert_one({"user_id": UID, "stripe_customer_id": cust.id})
        sub = _create_sub(cust.id, trial=True)
        handled = await _drain_events({cust.id}, {sub.id}, "trial start")
        await _state("1. Trial starts (card on file, 14 days)", now, handled)

        # 2. Three days before trial end: reminder.
        trial_end = int(sub.trial_end)
        now = trial_end - 3 * DAY + 600
        _advance(clock_id, now)
        handled = await _drain_events({cust.id}, {sub.id}, "reminder")
        await _state("2. Trial ends in 3 days: reminder", now, handled,
                     f"push sent: {len(PUSHES)} ({PUSHES[-1][0] if PUSHES else 'none'})")

        # 3. Trial ends: first charge succeeds, subscription converts.
        now = trial_end + 600
        _advance(clock_id, now)
        now = trial_end + 3 * 3600
        _advance(clock_id, now)
        handled = await _drain_events({cust.id}, {sub.id}, "conversion")
        await _state("3. Trial ends, first payment succeeds (conversion)", now, handled)

        # 4. Renewal one month later.
        period_end = int(stripe.Subscription.retrieve(sub.id)["items"]["data"][0]["current_period_end"])
        now = period_end + 3 * 3600
        _advance(clock_id, now)
        handled = await _drain_events({cust.id}, {sub.id}, "renewal")
        await _state("4. First renewal succeeds", now, handled)

        # 5. Payment method starts failing; next renewal fails.
        bad = stripe.PaymentMethod.attach("pm_card_chargeCustomerFail", customer=cust.id)
        stripe.Customer.modify(cust.id, invoice_settings={"default_payment_method": bad.id})
        stripe.Subscription.modify(sub.id, default_payment_method=bad.id)
        period_end = int(stripe.Subscription.retrieve(sub.id)["items"]["data"][0]["current_period_end"])
        now = period_end + 3 * 3600
        _advance(clock_id, now)
        handled = await _drain_events({cust.id}, {sub.id}, "failed payment")
        await _state("5. Renewal payment fails (past due, grace)", now, handled,
                     f"push sent: {PUSHES[-1][0] if PUSHES else 'none'}; access kept through grace")

        # 6. Customer fixes the card; Stripe collects the open invoice.
        good = stripe.PaymentMethod.attach("pm_card_visa", customer=cust.id)
        stripe.Customer.modify(cust.id, invoice_settings={"default_payment_method": good.id})
        stripe.Subscription.modify(sub.id, default_payment_method=good.id)
        open_invoices = stripe.Invoice.list(customer=cust.id, status="open", limit=5).data
        for inv in open_invoices:
            stripe.Invoice.pay(inv.id, payment_method=good.id)
        handled = await _drain_events({cust.id}, {sub.id}, "recovery")
        await _state("6. Card fixed, open invoice paid (recovery)", now, handled)

        # 7. Cancel at period end via the portal's mechanism.
        stripe.Subscription.modify(sub.id, cancel_at_period_end=True)
        handled = await _drain_events({cust.id}, {sub.id}, "cancel scheduled")
        await _state("7. Cancel at period end scheduled (access kept)", now, handled)

        # 8. Period ends: subscription deleted, lands on Statements.
        period_end = int(stripe.Subscription.retrieve(sub.id)["items"]["data"][0]["current_period_end"])
        now = period_end + 3 * 3600
        _advance(clock_id, now)
        handled = await _drain_events({cust.id}, {sub.id}, "ended")
        await _state("8. Period ends: lands on Statements, bank sync paused", now, handled)

        # 9. Resubscribe (new subscription, no second trial): re-enables.
        sub2 = _create_sub(cust.id, trial=False)
        handled = await _drain_events({cust.id}, {sub2.id}, "resubscribe")
        await _state("9. Resubscribe (new Checkout, paid): sync re-enabled", now, handled)
        stripe.Subscription.cancel(sub2.id)
        await _drain_events({cust.id}, {sub2.id}, "cleanup")

        # 10. Cancel during a trial: access to trial end, then Statements.
        await db.subscriptions_col.delete_many({"user_id": UID})
        cust2, pm2 = await _new_customer(clock_id, "pm_card_visa", "trialcancel")
        sub3 = _create_sub(cust2.id, trial=True)
        stripe.Subscription.modify(sub3.id, cancel_at_period_end=True)
        handled = await _drain_events({cust2.id}, {sub3.id}, "trial cancel")
        await _state("10. Cancelled during trial (access kept to trial end)", now, handled)
        trial_end3 = int(sub3.trial_end)
        now = trial_end3 + 3 * 3600
        _advance(clock_id, now)
        handled = await _drain_events({cust2.id}, {sub3.id}, "trial cancel end")
        charged = stripe.Invoice.list(customer=cust2.id, limit=5).data
        paid_total = sum(i.amount_paid for i in charged)
        await _state("11. Trial end after cancel: Statements, no charge", now, handled,
                     f"total ever charged on this customer: {paid_total} (pence)")

        _write_doc()
    finally:
        if clock_id:
            try:
                stripe.test_helpers.TestClock.delete(clock_id)
                print("test clock deleted")
            except Exception as exc:  # noqa: BLE001
                print("clock delete failed:", type(exc).__name__)
        await db._mongo.drop_database(PROOF_DB)
        print("throwaway database dropped")


def _write_doc():
    cols = ["step", "events", "status", "effective_tier", "trial_ends", "expires",
            "cancel_at_period_end", "grace_until", "bank_sync_paused", "notes"]
    lines = [
        "# B45 trial lifecycle: Stripe test-mode proof",
        "",
        f"Generated by `backend/scripts/stripe_trial_lifecycle_proof.py` on {datetime.now(timezone.utc):%Y-%m-%d} "
        "against Stripe TEST mode, using a Stripe test clock (no real-time waits) and a throwaway Mongo database "
        "that was dropped afterwards. Real Stripe events were fetched after each clock advance and fed through the "
        "app's own `handle_event`. No ids or keys are recorded here.",
        "",
        "Offsets are days relative to the test clock at that step. `effective_tier` is what the app would serve "
        "(`get_subscription`), `bank_sync_paused` is `open_banking_paused`. `grace_until` is stamped from the server's real clock "
        "(a test clock cannot advance it), so its offset is against real time; grace expiry is covered by unit tests. "
        "Plan used: Standard, monthly. "
        "A completed Checkout is simulated by creating the subscription directly with the same arguments "
        "`create_checkout_session` passes (14-day trial, `trial_settings.end_behavior.missing_payment_method=cancel`).",
        "",
        "| " + " | ".join(cols) + " |",
        "|" + "---|" * len(cols),
    ]
    for r in ROWS:
        lines.append("| " + " | ".join(str(r[c]).replace("|", "/") for c in cols) + " |")
    lines += ["", f"Pushes captured in memory (never sent): {len(PUSHES)}", ""]
    for title, body in PUSHES:
        lines.append(f"- {title}: {body}")
    OUT_DOC.parent.mkdir(parents=True, exist_ok=True)
    OUT_DOC.write_text("\n".join(lines) + "\n")
    print("wrote", OUT_DOC)


if __name__ == "__main__":
    asyncio.run(main())
