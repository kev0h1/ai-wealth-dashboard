"""G243 — tool-routing questions for the model comparison, plus the synthetic
fixture world they run against. Never real data: every figure is invented.

Consumers:
* `scripts/penny_model_eval.py` (live OpenRouter, run by hand, never in CI)
  runs G241's `penny_arithmetic_corpus.CASES` plus `ROUTING_CASES` below.
* `tests/test_penny_routing_corpus.py` (offline) checks the corpus is
  well-formed: every required tool exists in the real catalogue and every
  expected figure is derivable from the fixtures.

Each routing case has ONE correct tool (`first`): the tool a correct model
must call first. `expect_any` is the figure that must appear in the reply.
The Padel row is Kevin's reported failure (2026-10-08), run against a
synthetic custom category holding 11 transactions totalling 225.00.
"""
import re

TODAY = "2026-10-08"
# Synthetic user's custom categories (seeded into the scratch DB per case).
CUSTOM_CATEGORIES = ["Padel", "Golf"]


def _money(v, decimals=0):
    # Same shape as penny_tools._money: {"raw": float, "formatted": str}
    from app.services import penny_tools
    return penny_tools._money(v, decimals)


ROUTING_CASES = [
    dict(id="route-01-padel-custom-category", screen="spend", first="get_category_spend", required=["get_category_spend"],
         question="How much did I spend on Padel this last month?", expect_any=["225"]),
    dict(id="route-02-golf-custom-3m", screen="spend", first="get_category_spend", required=["get_category_spend"],
         question="How much have I spent on Golf over the last 3 months?", expect_any=["410"]),
    dict(id="route-03-groceries-builtin", screen="spend", first="get_category_spend", required=["get_category_spend"],
         question="How much have I spent on Groceries this pay period?", expect_any=["286"]),
    dict(id="route-04-merchant-tesco", screen="spend", first="search_transactions", required=["search_transactions"],
         question="How much have I spent at Tesco in total?", expect_any=["87.45"]),
    dict(id="route-05-merchant-costa", screen="spend", first="search_transactions", required=["search_transactions"],
         question="Show my Costa payments and what they come to", expect_any=["42.80", "42.8"]),
    dict(id="route-06-goal-remaining", screen="planning", first="get_goals", required=["get_goals"],
         question="How much is left to save for my Japan goal?", expect_any=["750"]),
    dict(id="route-07-upcoming-bills", screen="upcoming", first="get_upcoming_bills", required=["get_upcoming_bills"],
         question="What bills have I got coming up before payday?", expect_any=["Rent", "850"]),
    dict(id="route-08-safe-to-spend", screen="home", first="get_safe_to_spend", required=["get_safe_to_spend"],
         question="How much can I safely spend before payday?", expect_any=["412"]),
    dict(id="route-09-explain-safe", screen="home", first="explain", required=["explain"],
         question="What does safe to spend mean?", expect_any=None),
    dict(id="route-10-calc-percent", screen="home", first="calculate", required=["calculate"],
         question="What is 18% of £2,350?", expect_any=["423"]),
    dict(id="route-11-calc-split", screen="other", first="calculate", required=["calculate"],
         question="Split £243 between three people", expect_any=["81"]),
    dict(id="route-12-card-balance", screen="accounts", first="get_accounts", required=["get_accounts"],
         question="What do I owe on my Visa card?", expect_any=["380"]),
    dict(id="route-13-affordability", screen="home", first="check_affordability", required=["check_affordability"],
         question="Can I afford a £60 night out?", expect_any=["352"]),
    dict(id="route-14-prior-period", screen="spend", first="get_spend_verdict", required=["get_spend_verdict"],
         question="How much did I spend last pay period compared with this one?", expect_any=["1,764", "1764"]),
]

# category -> {this period, last-n-months} fixtures
_CAT = {
    "padel": dict(name="Padel", period=(225.0, 11), months=(225.0, 11, 30)),
    "golf": dict(name="Golf", period=(120.0, 2), months=(410.0, 6, 90)),
    "groceries": dict(name="Groceries", period=(286.40, 14), months=(1020.0, 41, 90)),
}
_MERCHANT = {
    "tesco": dict(spent=87.45, count=6),
    "costa": dict(spent=42.80, count=9),
}


def _category_spend(args, base):
    key = re.sub(r"\s+", " ", str(args.get("category") or "")).strip().lower()
    cat = _CAT.get(key)
    if not args.get("category"):
        return base
    if not cat:
        return {"category": args["category"], "category_recognised": False,
                "note": "No category by that name. If it is a merchant or shop, use search_transactions instead.",
                "available_categories": ["Padel", "Golf", "Groceries"]}
    spent, n = cat["period"]
    out = {"category": cat["name"], "period": {"start": "2026-09-18", "end": "2026-10-17"},
           "this_period": {"spent": _money(spent), "payments_count": n}, "top_merchants": []}
    if args.get("months"):
        ms, mn, days = cat["months"]
        out["last_n_months"] = {"months": int(args["months"]), "spent": _money(ms), "payments_count": mn,
                                "window": {"from": "2026-07-10", "to": TODAY, "days": days},
                                "average_per_week": _money(ms / (days / 7), 2)}
    return out


def _search(args, category_fallback: bool):
    text = " ".join(str(args.get(k) or "") for k in ("q", "merchants", "category")).lower()
    for key, m in _MERCHANT.items():
        if key in text:
            return {"transactions": [], "count": min(m["count"], 20), "match_kind": "text",
                    "matched_count": m["count"], "matched_spent": _money(m["spent"], 2),
                    "matched_received": _money(0, 2), "truncated": False}
    for key, cat in _CAT.items():
        if key in text and key != "groceries":
            if category_fallback or str(args.get("category") or "").lower() == key:
                spent, n = cat["months"][0], cat["months"][1]
                return {"transactions": [], "count": min(n, 20), "match_kind": "category",
                        "matched_category": cat["name"], "match_note": "These rows are the user's own category, not payments to a merchant of that name.",
                        "matched_count": n, "matched_spent": _money(spent, 2), "matched_received": _money(0, 2)}
    return {"transactions": [], "count": 0, "match_kind": "text", "matched_count": 0,
            "matched_spent": _money(0, 2), "matched_received": _money(0, 2), "truncated": False}


def fake_execute_factory(real_execute, base_fixtures, verdict_by_offset, category_fallback: bool):
    """Return an async `execute_tool(uid, name, args)`: calculate and explain
    run for real (pure code), search/category tools answer from the routing
    fixtures, everything else from G241's fixtures."""
    async def _fake(uid, name, args):
        args = args or {}
        if name in ("calculate", "explain"):
            return await real_execute(uid, name, args)
        if name == "get_spend_verdict":
            return verdict_by_offset.get(int(args.get("period_offset") or 0), verdict_by_offset[0])
        if name == "get_category_spend":
            return _category_spend(args, base_fixtures["get_category_spend"])
        if name == "search_transactions":
            return _search(args, category_fallback)
        if name == "check_affordability":
            try:
                amount = float(re.sub(r"[^\d.]", "", str(args.get("amount"))))
            except ValueError:
                amount = 0.0
            return {"verdict": f"Yes, £{amount:,.0f} fits, with £{412 - amount:,.0f} of safe to spend left.",
                    "amount": _money(amount), "safe_to_spend": _money(412), "remaining_after": _money(412 - amount)}
        if name in base_fixtures:
            return base_fixtures[name]
        return {"error": "no data available for that in this evaluation"}
    return _fake
