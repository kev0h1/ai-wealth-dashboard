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
    # G334: moving money between own accounts goes to plan_consolidation, never raw balances.
    dict(id="route-15-move-into-account", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="How much can I move into my Barclays account from the other accounts?", expect_any=["200"]),
    dict(id="route-16-move-out-of-left-to-spend", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Out of what's left to spend, how much should I move from the other current accounts into Barclays?", expect_any=["200"]),
    dict(id="route-17-move-graphic", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Can you draw a graphic of the money moves into Barclays?", expect_any=["200"]),
    # G336: Kevin's own phrasings from the stored thread (2026-10-24), verbatim. The corpus is
    # single-turn, so the three follow-ups (route-19, route-20, route-23) carry their context in the
    # question; the multi-turn replay lives in tests/test_penny_move_replay_g336.py.
    dict(id="route-18-kevin-consolidate-premier", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Which accounts have the left to spend and how can I consolidate it in my premier account", expect_any=["200"]),
    dict(id="route-19-kevin-not-savings", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="No I don't want to touch my savings, which accounts should I move from into my Barclays account", expect_any=["200"]),
    dict(id="route-20-kevin-monzo-in-plan", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Isn't the Monzo money already account for in a plan, which accounts can I move to my Barclays premier account", expect_any=["200"]),
    dict(id="route-21-kevin-visualise", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Visualise that move to my Barclays account", expect_any=["200"]),
    dict(id="route-22-kevin-rather-spend-barclays", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="I know I can spend a certain amount from certain accounts which have some money left to spend, but I'd rather spend from my Barclays premier account, how much can I move to it from the other accounts", expect_any=["200"]),
    dict(id="route-23-kevin-where-414", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Where does the 414 come from, which accounts can I move money from into my Barclays account", expect_any=["200"]),
    dict(id="route-24-kevin-spend-from-barclays", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Okay if I want to spend what's left to spend from my Barclays account, how can I move the money", expect_any=["200"]),
    dict(id="route-25-kevin-which-236", screen="home", first="plan_consolidation", required=["plan_consolidation"],
         question="Which accounts should I move the 236 from into my Barclays account", expect_any=["200"]),
    # B59: Kevin's set-aside and recategorise thread (2026-10-25). Single-turn stand-ins carry the
    # context the follow-ups had; the multi-turn replay lives in tests/test_penny_b59_replay.py.
    dict(id="route-26-kevin-set-asides", screen="upcoming", first="get_set_asides", required=["get_set_asides"],
         question="What are my set asides for the month", expect_any=["Holiday", "Digital saver"]),
    dict(id="route-27-kevin-edit-set-aside", screen="upcoming", first="propose_update_allocation", required=["propose_update_allocation"],
         question="Can I edit my Holiday set-aside", expect_any=None),
    dict(id="route-28-kevin-edit-it-here", screen="upcoming", first="propose_update_allocation", required=["propose_update_allocation"],
         question="Can I edit my Holiday set-aside here, in this chat", expect_any=None),
    dict(id="route-29-kevin-put-under-software", screen="spend", first="propose_recategorise_transaction", required=["propose_recategorise_transaction"],
         question="Put the British Gas payment under Software, just this one", expect_any=None),
    # B60: the safety buffer, view and update.
    dict(id="route-30-safety-buffer", screen="planning", first="get_savings_position", required=["get_savings_position"],
         question="What's my safety buffer", expect_any=None),
    dict(id="route-31-buffer-months", screen="planning", first="propose_set_savings_goal", required=["propose_set_savings_goal"],
         question="Change my buffer to 3 months", expect_any=None),
    dict(id="route-32-buffer-amount", screen="planning", first="propose_set_savings_goal", required=["propose_set_savings_goal"],
         question="Set my emergency fund to £2,000", expect_any=None),
    # B60: connect a bank, proposal first.
    dict(id="route-33-connect-monzo", screen="accounts", first="propose_connect_bank", required=["propose_connect_bank"],
         question="Connect my Monzo account", expect_any=None),
    dict(id="route-34-add-another-bank", screen="accounts", first="propose_connect_bank", required=["propose_connect_bank"],
         question="Add another bank", expect_any=None),
    # G351: a goal whose contribution changes each step, previewed by the server first.
    dict(id="route-35-four-p-challenge", screen="planning", first="preview_goal_schedule", required=["preview_goal_schedule"],
         question="I'm doing the 4p challenge, starting at 4p and adding 4p a day for a year", expect_any=None),
    dict(id="route-36-set-that-up-as-a-goal", screen="planning", first="propose_create_scheduled_goal", required=["propose_create_scheduled_goal"],
         question="Yes, set that up as a goal, it leaves from my Monzo current account", expect_any=None),
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
        if name == "plan_consolidation":
            return {"summary": "You could move up to £200.00 into your Barclays account: £146.00 from NatWest and £54.00 from Starling. Each account keeps enough for its own bills and set-asides. Moving money between your own accounts does not change your left to spend.",
                    "left_to_spend_unchanged": True, "pool": _money(236, 2), "total": _money(200, 2), "legs": [{"name": "NatWest", "amount": _money(146, 2)},
                                                      {"name": "Starling", "amount": _money(54, 2)}]}
        if name == "preview_goal_schedule":
            return {"schedule_label": "4p a day, rising by 4p a day, from 28 Oct 2026 for 365 days", "total": _money(2671.80, 2),
                    "this_period_amount": _money(30.20, 2), "next_periods": [], "summary": "Quote the server's summary.",
                    "source": {"name": "Monzo current account", "basis": "recent-transfers"}}
        if name == "get_set_asides":
            pots = [("a1", "Saving Challenge (2026)", 50), ("a2", "Holiday", 120), ("a3", "Digital saver", 30)]
            return {"set_asides": [{"id": i, "name": n, "target": _money(v, 2), "filled": _money(0, 2), "remaining": _money(v, 2),
                                    "status": "active"} for i, n, v in pots], "count": 3,
                    "how_to_edit": "Ask me to change it, or open Upcoming in the app."}
        if name.startswith("propose_"):
            return {"proposal": True, "proposal_id": "eval", "kind": name[len("propose_"):], "summary": "Proposed for the user to confirm.",
                    "consequence": "Nothing changes until they confirm.", "params": {}}
        if name in base_fixtures:
            return base_fixtures[name]
        return {"error": "no data available for that in this evaluation"}
    return _fake
