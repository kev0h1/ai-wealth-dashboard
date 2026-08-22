"""THROWAWAY manual verification script — NOT part of the automatic test
suite (lives outside tests/, and its name doesn't match test_*.py / *_test.py
so a plain `pytest` invocation would never collect it even if it were moved
there).

Exercises the real /scenario/parse and /scenario/run endpoints in-process
against real data via fastapi.testclient.TestClient, with the auth
dependency (app.core.auth.current_user) overridden to return Kevin's user
dict directly — no bearer token, no secret read, no network hop to the
running service. Also hits GET /debt-plan for cross-checking.

Run with the backend venv:
    cd /root/ai-wealth-dashboard/backend
    ./venv/bin/python manual_scenario_check.py

Leave this file in place; it is meant to be re-run.
"""
import json
import re
import sys
import traceback

from fastapi.testclient import TestClient

from app.main import app
from app.core.auth import current_user, auth_middleware

USER = {"email": "kevin.maingi12@gmail.com"}


async def _fake_current_user():
    return USER


app.dependency_overrides[current_user] = _fake_current_user

# `auth_middleware` is raw Starlette middleware (app.middleware("http")), not
# a FastAPI dependency — it never consults app.dependency_overrides, so it
# would 401 every request before the route (and its overridden `current_user`
# dependency) is ever reached. Strip it from the middleware stack for this
# in-process test run only (this script never touches the running service);
# the route-level auth dependency override above is what actually stands in
# for authentication.
app.user_middleware = [
    m for m in app.user_middleware
    if getattr(m, "kwargs", {}).get("dispatch") is not auth_middleware
]
app.middleware_stack = None  # force FastAPI to rebuild the stack on next request

EM_DASH = "—"
EN_DASH = "–"
MINUS = "−"
HYPHEN = "-"


def pp(label, obj):
    print(f"\n{'=' * 80}\n{label}\n{'=' * 80}")
    print(json.dumps(obj, indent=2, default=str))


def scan_dashes(obj, path="$"):
    """Return list of (path, string) for any string anywhere in obj containing
    an em-dash or en-dash."""
    hits = []
    if isinstance(obj, str):
        if EM_DASH in obj or EN_DASH in obj:
            hits.append((path, obj))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            hits.extend(scan_dashes(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(scan_dashes(v, f"{path}[{i}]"))
    return hits


def scan_negative_currency(obj, path="$"):
    """Return list of (path, string) for any string that looks like a negative
    currency figure using a hyphen-minus instead of the Unicode minus."""
    hits = []
    hyphen_neg_re = re.compile(r"-\s*£\d")
    if isinstance(obj, str):
        if hyphen_neg_re.search(obj):
            hits.append((path, obj))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            hits.extend(scan_negative_currency(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hits.extend(scan_negative_currency(v, f"{path}[{i}]"))
    return hits


def find_nulls(obj, path="$"):
    """Return list of (path,) for every key whose value is null, dict-only
    (top-level scenario blocks are what we care about)."""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if v is None:
                hits.append(f"{path}.{k}")
            else:
                hits.extend(find_nulls(v, f"{path}.{k}"))
    return hits


def main():
    results = {}
    with TestClient(app) as client:
        # ---- Call 1: /scenario/parse ----
        print("\n\n########## CALL 1: POST /scenario/parse ##########")
        try:
            r1 = client.post(
                "/scenario/parse",
                json={"question": "what if I start paying £450 a month for a car from October?"},
            )
            print("status:", r1.status_code)
            body1 = r1.json()
            pp("CALL 1 RESPONSE (/scenario/parse)", body1)
            results["call1"] = {"status": r1.status_code, "body": body1}
        except Exception:
            print("EXCEPTION during call 1:")
            traceback.print_exc()
            results["call1"] = {"exception": traceback.format_exc()}
            body1 = None

        # ---- Call 2: /scenario/run using call 1's items (or explicit fallback) ----
        print("\n\n########## CALL 2: POST /scenario/run (from call 1 items) ##########")
        items_for_run = None
        if body1 and isinstance(body1, dict):
            if body1.get("clarify"):
                print("CALL 1 RETURNED A CLARIFY (verbatim):", repr(body1.get("clarify")))
                print("Full call-1 body was:", json.dumps(body1, indent=2, default=str))
            if body1.get("items"):
                items_for_run = body1["items"]

        if not items_for_run:
            print("Falling back to explicit body per spec.")
            items_for_run = [
                {
                    "label": "Car payment",
                    "amount": 450,
                    "direction": "out",
                    "cadence": "monthly",
                    "starts": "2026-10-01",
                    "ends": None,
                    "kind": "new_outgoing",
                    "category": None,
                }
            ]

        try:
            r2 = client.post("/scenario/run", json={"items": items_for_run})
            print("status:", r2.status_code)
            body2 = r2.json()
            pp("CALL 2 RESPONSE (/scenario/run, car payment)", body2)
            results["call2"] = {"status": r2.status_code, "body": body2}
        except Exception:
            print("EXCEPTION during call 2:")
            traceback.print_exc()
            results["call2"] = {"exception": traceback.format_exc()}
            body2 = None

        # ---- Call 3: annual-cadence regression check ----
        print("\n\n########## CALL 3: POST /scenario/run (annual regression) ##########")
        try:
            r3 = client.post(
                "/scenario/run",
                json={
                    "items": [
                        {
                            "label": "Car insurance",
                            "amount": 1200,
                            "direction": "in",
                            "cadence": "annual",
                            "starts": "2026-10-01",
                            "ends": None,
                            "kind": "removal",
                            "category": None,
                        }
                    ]
                },
            )
            print("status:", r3.status_code)
            body3 = r3.json()
            pp("CALL 3 RESPONSE (/scenario/run, annual removal)", body3)
            results["call3"] = {"status": r3.status_code, "body": body3}
        except Exception:
            print("EXCEPTION during call 3:")
            traceback.print_exc()
            results["call3"] = {"exception": traceback.format_exc()}
            body3 = None

        # ---- Call 4: income-change path ----
        print("\n\n########## CALL 4: POST /scenario/run (income change) ##########")
        try:
            r4 = client.post(
                "/scenario/run",
                json={
                    "items": [
                        {
                            "label": "Pay rise",
                            "amount": 300,
                            "direction": "in",
                            "cadence": "monthly",
                            "starts": "2026-10-01",
                            "ends": None,
                            "kind": "income_change",
                            "category": None,
                        }
                    ]
                },
            )
            print("status:", r4.status_code)
            body4 = r4.json()
            pp("CALL 4 RESPONSE (/scenario/run, income change)", body4)
            results["call4"] = {"status": r4.status_code, "body": body4}
        except Exception:
            print("EXCEPTION during call 4:")
            traceback.print_exc()
            results["call4"] = {"exception": traceback.format_exc()}
            body4 = None

        # ---- Call 5: GET /debt-plan (real path, cross-check) ----
        print("\n\n########## CALL 5: GET /debt-plan ##########")
        try:
            r5 = client.get("/debt-plan")
            print("status:", r5.status_code)
            body5 = r5.json()
            pp("CALL 5 RESPONSE (/debt-plan)", body5)
            results["call5"] = {"status": r5.status_code, "body": body5}
        except Exception:
            print("EXCEPTION during call 5:")
            traceback.print_exc()
            results["call5"] = {"exception": traceback.format_exc()}
            body5 = None

    # ============================================================
    # CHECKS
    # ============================================================
    print("\n\n" + "#" * 80)
    print("CHECKS")
    print("#" * 80)

    # ---- Check: canonical debt date ----
    print("\n--- Check: canonical debt date (call2.debt.debt_free_month_now vs call5.totals.debt_free_month) ---")
    try:
        scen_debt = (body2 or {}).get("debt") or {}
        scen_now = scen_debt.get("debt_free_month_now")
        plan_totals = (body5 or {}).get("totals") or {}
        plan_dfm = plan_totals.get("debt_free_month")
        print(f"scenario debt.debt_free_month_now = {scen_now!r}")
        print(f"debt-plan totals.debt_free_month  = {plan_dfm!r}")
        # scenario's field is human-formatted ("Mon YYYY"); debt-plan's own
        # totals.debt_free_month is a raw 'YYYY-MM' label per debt_plan.py.
        # Compare after normalising both to the same representation, but
        # None==None must PASS regardless.
        if scen_now is None and plan_dfm is None:
            print("PASS: both null. See debt block reasoning below.")
        elif scen_now is None or plan_dfm is None:
            print(f"FAIL (or at least MISMATCH): one is null and the other is not -> scen={scen_now!r} plan={plan_dfm!r}")
        else:
            from datetime import datetime as _dt
            try:
                plan_human = _dt.strptime(plan_dfm, "%Y-%m").strftime("%b %Y")
            except Exception:
                plan_human = plan_dfm
            if plan_human == scen_now:
                print(f"PASS: {scen_now!r} == {plan_human!r}")
            else:
                print(f"FAIL: scenario says {scen_now!r}, debt-plan canonical says {plan_human!r} (raw {plan_dfm!r})")
        if not scen_debt:
            print("(scenario debt block was null/empty entirely, see 'assumptions' in call 2 for the stated reason.)")
    except Exception:
        print("EXCEPTION while checking canonical debt date:")
        traceback.print_exc()

    # ---- Check: no fabricated interest ----
    print("\n--- Check: no fabricated interest on 0% cards ---")
    try:
        cards = (body5 or {}).get("cards") or []
        zero_rate_cards = [c.get("name") for c in cards if not (c.get("projection_rate_schedule") or [])]
        print(f"Cards with projection_rate_schedule == []: {zero_rate_cards}")
        scen_debt = (body2 or {}).get("debt") or {}
        extra_interest = scen_debt.get("extra_interest")
        print(f"scenario call2 debt.extra_interest = {extra_interest!r}")
        if extra_interest in (None, 0, 0.0):
            print("PASS: extra_interest is null/zero (nothing to fabricate).")
        else:
            if zero_rate_cards:
                print(
                    f"FAIL-CANDIDATE: extra_interest={extra_interest!r} is non-zero while these cards "
                    f"project at 0% (empty projection_rate_schedule): {zero_rate_cards}. Needs manual "
                    f"read of which cards were pooled to know if this is fabricated interest or interest "
                    f"correctly attributed to a non-zero-rate card."
                )
            else:
                print(f"PASS (non-zero interest, but no 0%-projected cards exist in this user's plan): {extra_interest!r}")
    except Exception:
        print("EXCEPTION while checking fabricated interest:")
        traceback.print_exc()

    # ---- Check: annual regression ----
    print("\n--- Check: annual regression (call 3) ---")
    try:
        recurring_delta = (body3 or {}).get("recurring_delta")
        print(f"call3 recurring_delta = {recurring_delta!r} (expect ~+100, i.e. 1200/12)")
        if recurring_delta is not None and abs(recurring_delta - 100.0) < 0.5:
            print("PASS: recurring_delta is ~+100.")
        else:
            print(f"FAIL: recurring_delta was {recurring_delta!r}, expected ~+100.")

        cash3 = (body3 or {}).get("cash") or {}
        per_month = cash3.get("per_month") or []
        baseline_surplus = ((body3 or {}).get("baseline") or {}).get("monthly_surplus")
        print(f"call3 baseline.monthly_surplus = {baseline_surplus!r}")
        print(f"call3 cash.per_month = {per_month}")
        if per_month and baseline_surplus is not None:
            deltas = [round(v - baseline_surplus, 2) for v in per_month]
            print(f"per-month delta vs baseline = {deltas}")
            months_with_1200 = [i for i, d in enumerate(deltas) if abs(d - 1200.0) < 0.5]
            months_smeared = [i for i, d in enumerate(deltas) if 0.5 < abs(d) < 1199.5]
            print(f"Months where the full +1200 lands: {months_with_1200}")
            print(f"Months with a partial/smeared delta (should be empty): {months_smeared}")
            if months_with_1200 and not months_smeared:
                print("PASS: 1200 lands only on anniversary months, no smearing.")
            else:
                print("FAIL: either no month got the full 1200, or some months show a smeared partial delta.")
        else:
            print("Could not check per-month smearing: cash block or baseline missing (see assumptions).")
    except Exception:
        print("EXCEPTION while checking annual regression:")
        traceback.print_exc()

    # ---- Check: income change ----
    print("\n--- Check: income change path (call 4) ---")
    try:
        assumptions4 = (body4 or {}).get("assumptions") or []
        print(f"call4 assumptions = {assumptions4}")
        mentions_payday_rhythm = any(
            ("payday" in a.lower() and "rhythm" in a.lower()) for a in assumptions4
        )
        if mentions_payday_rhythm:
            print("PASS: assumptions list mentions payday and rhythm assumed unchanged.")
        else:
            print("FAIL: no assumption line mentions payday/rhythm staying unchanged.")

        baseline4 = (body4 or {}).get("baseline") or {}
        recurring4 = (body4 or {}).get("recurring_delta")
        print(f"call4 baseline = {baseline4}, recurring_delta = {recurring4!r} (expect +300)")
        cash4 = (body4 or {}).get("cash") or {}
        if cash4:
            print(f"call4 cash.surplus_now={cash4.get('surplus_now')!r} surplus_after={cash4.get('surplus_after')!r}")
            expected_after = round((baseline4.get("monthly_surplus") or 0) + (recurring4 or 0), 2)
            if cash4.get("surplus_after") == expected_after:
                print("PASS: surplus_after == baseline surplus + recurring_delta, no corruption visible.")
            else:
                print(
                    f"FAIL: surplus_after={cash4.get('surplus_after')!r} != expected "
                    f"baseline+delta={expected_after!r}"
                )
        else:
            print("cash block was null for call 4 (see assumptions above for reason).")
    except Exception:
        print("EXCEPTION while checking income change:")
        traceback.print_exc()

    # ---- Check: copy rules (dashes + minus) across ALL responses ----
    print("\n--- Check: copy rules (em-dash / en-dash / hyphen-minus-before-£) across ALL responses ---")
    try:
        all_dash_hits = []
        all_neg_hits = []
        for name, body in [("call1", body1), ("call2", body2), ("call3", body3), ("call4", body4), ("call5", body5)]:
            if body is None:
                continue
            dash_hits = scan_dashes(body, path=name)
            neg_hits = scan_negative_currency(body, path=name)
            all_dash_hits.extend(dash_hits)
            all_neg_hits.extend(neg_hits)
        print(f"Em-dash/en-dash hits: {all_dash_hits}")
        print(f"Hyphen-before-£ hits (should use − instead): {all_neg_hits}")
        if not all_dash_hits:
            print("PASS: no em-dash or en-dash found anywhere.")
        else:
            print(f"FAIL: found {len(all_dash_hits)} string(s) with em-dash/en-dash.")
        if not all_neg_hits:
            print("PASS: no hyphen-minus-before-£ found (either no negative currency, or it correctly uses −).")
        else:
            print(f"FAIL: found {len(all_neg_hits)} string(s) with a hyphen instead of the Unicode minus before £.")
    except Exception:
        print("EXCEPTION while scanning copy rules:")
        traceback.print_exc()

    # ---- Check: honest nulls ----
    print("\n--- Check: honest nulls (every null block + its assumption line) ---")
    try:
        for name, body in [("call2", body2), ("call3", body3), ("call4", body4)]:
            if body is None:
                continue
            print(f"\n{name}:")
            top_level_blocks = ["cash", "debt", "plans", "grow", "absorb"]
            assumptions = body.get("assumptions") or []
            print(f"  assumptions: {assumptions}")
            for block in top_level_blocks:
                val = body.get(block)
                if val is None:
                    print(f"  BLOCK '{block}' is null. Assumption lines present: {len(assumptions)} total (see above) -- "
                          f"manually match one to '{block}' by content.")
                else:
                    print(f"  BLOCK '{block}' is populated (not null).")
    except Exception:
        print("EXCEPTION while checking honest nulls:")
        traceback.print_exc()

    print("\n\nDONE.")


if __name__ == "__main__":
    main()
