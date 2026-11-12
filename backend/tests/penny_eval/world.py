"""G459 synthetic world: one invented user, invented banks and amounts. Never real data.

`World.execute(uid, name, args)` stands in for `penny_agent.execute_tool`: `calculate` and
`explain` run for real (pure code), the schedule preview runs the real pure schedule engine,
every other data tool answers from the fixtures below, propose tools return a proposal.
Every call and result is recorded so the scorer can check tools and figures.
"""
from datetime import date

TODAY = "2026-11-12"
BANK = "Northbank"
GOAL = "Stack Challenge"
GARDEN = "Garden Pot"
CUSTOM_CATEGORIES = ["Archery"]  # seeded into the scratch DB so the prompt lists it, as production does for a user category


def money(v, decimals=2):
    return {"raw": round(float(v), 2), "formatted": ("-" if v < 0 else "") + f"£{abs(v):,.{decimals}f}"}


_m = money
OPEN_GOAL_TARGET = 1098.20


def _goals(tracking: str) -> dict:
    goal = {
        "name": GOAL, "amount": _m(OPEN_GOAL_TARGET), "progress": _m(0), "remaining": _m(OPEN_GOAL_TARGET),
        "target_date": "2027-02-05", "per_period_slice": _m(30.20), "usual_slice": _m(30.20),
        "periods_left": 2, "on_track": True, "status": "active",
    }
    if tracking == "none":
        goal["tracked_payment"] = None
        goal["tracking_status"] = "Not tracking a payment"
    elif tracking == "daily":
        goal["tracked_payment"] = {"from": f"{BANK} Current", "into": GOAL, "cadence": "daily"}
        goal["tracking_status"] = f"Tracking daily payments from {BANK} Current"
    # tracking == "hidden" reproduces production: get_goals carries no tracking field at all
    return {"goals": [goal]}


def bills_list():
    return [("Rent", 780.00, "2026-11-14"), ("Broadband", 29.99, "2026-11-15"), ("Water", 41.20, "2026-11-17"),
            ("Council tax", 138.00, "2026-11-18"), ("Gym", 32.00, "2026-11-19"), ("Phone", 19.50, "2026-11-20")]


def base_fixtures(opts: dict) -> dict:
    degraded = bool(opts.get("degraded"))
    return {
        "get_safe_to_spend": {
            "state": "tight" if degraded else "comfortable",
            "safe_to_spend": _m(0 if degraded else 268.40),
            "payday": {"next_payday": "2026-11-25", "days_to_payday": 13}, "card_growth": _m(0),
            **({"calculation_status": "degraded", "unavailable_components": ["one connected account could not be refreshed"]}
               if degraded else {"calculation_status": "complete"}),
        },
        "get_goals": _goals(opts.get("goal_tracking", "hidden")),
        "get_accounts": {"accounts": [
            {"id": "n1", "name": f"{BANK} Current", "kind": "Current", "balance": _m(1840.20)},
            {"id": "n2", "name": f"{BANK} Savings", "kind": "Savings", "balance": _m(3200.00)},
            {"id": "n3", "name": GOAL, "kind": "Savings pot", "parent": f"{BANK} Current", "balance": _m(468.00)},
            {"id": "n4", "name": "Skyline Card", "kind": "Credit", "balance": _m(-640.00)},
        ]},
        "get_set_asides": {"set_asides": [
            {"id": "sa1", "name": GARDEN, "target": _m(35), "filled": _m(0), "remaining": _m(35), "status": "active"},
            {"id": "sa2", "name": "Rainy Fund", "target": _m(60), "filled": _m(20), "remaining": _m(40), "status": "active"},
        ], "count": 2, "how_to_edit": "Ask me to change it, or open Upcoming in the app."},
        "get_upcoming_bills": {"bills": [{"name": n, "amount": _m(a), "date": d} for n, a, d in bills_list()]},
        "get_category_spend": {
            "category": "Archery", "category_recognised": True, "period": {"start": "2026-10-25", "end": "2026-11-24"},
            "this_period": {"spent": _m(96.00), "payments_count": 4}, "top_merchants": [],
        },
        "check_affordability": {"verdict": "Yes, £40 fits.", "amount": _m(40), "safe_to_spend": _m(268.40), "remaining_after": _m(228.40)},
    }


def _preview(args: dict) -> dict:
    """The real pure schedule engine, so the figures are the server's, not invented."""
    from app.services import goal_schedule as gs
    from app.services import penny_goal_schedule as pgs

    today = date.fromisoformat(TODAY)
    cfg = {"type": "calendar_month"}
    parsed = pgs.merge_fields({k: v for k, v in args.items() if not k.startswith("_")}, today, None, None)
    raw, needs = pgs.build_schedule(parsed["fields"], today)
    if raw is None:
        return {"needs": needs or ["description"], "assumptions": parsed["assumptions"]}
    clean, problem = pgs._check(raw)
    if clean is None:
        return {"error": problem}
    out = {"assumptions": parsed["assumptions"], **pgs._figures(clean, cfg, today)}
    out.pop("_total_pence", None)
    out.pop("_this_period_pence", None)
    out["source"] = {"name": f"{BANK} Current", "basis": "recent-transfers"}
    out["today"] = {"date": TODAY, "weekday": "Thursday"}
    return out


class World:
    def __init__(self, real_execute, opts: dict | None = None):
        self.real = real_execute
        self.opts = opts or {}
        self.fixtures = base_fixtures(self.opts)
        self.calls: list[tuple[str, dict]] = []
        self.results: list = []

    def reset_turn(self):
        self.calls, self.results = [], []

    async def execute(self, uid, name, args):
        args = {k: v for k, v in (args or {}).items() if not str(k).startswith("_")}
        self.calls.append((name, args))
        out = await self._run(uid, name, args)
        self.results.append(out)
        return out

    async def _run(self, uid, name, args):
        if name in ("calculate", "explain"):
            return await self.real(uid, name, args)
        if name == "preview_goal_schedule":
            return _preview(args)
        if name in self.fixtures:
            return self.fixtures[name]
        if name.startswith("propose_"):
            bits = ", ".join(f"{k} {v}" for k, v in args.items() if isinstance(v, (str, int, float)))
            return {"proposal": True, "proposal_id": "eval", "kind": name[len("propose_"):],
                    "summary": f"Proposed: {name[len('propose_'):].replace('_', ' ')} ({bits})",
                    "consequence": "Nothing changes until they confirm.", "params": args}
        return {"error": "no data available for that in this evaluation"}
