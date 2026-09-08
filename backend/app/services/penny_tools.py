"""Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md) — the
read-only tool catalog the Penny agent loop (app.services.penny_agent) can
call for EVERY question now, not just the fallback the original Phase 1
plan scoped this to. `check_affordability`/`get_category_spend`/
`get_insights`/`get_page_explainer` joined the original eight tools the same
day the deterministic ladder in app.routers.can_i was deleted outright: the
motivating bug was a confident deterministic route (a category-name synonym
match) answering "How can I improve my entertainment spending" with a
current-period total when the actual question was advice-shaped and never
reached the loop at all. Loop-first means every question but a greeting,
the length gate, or a scenario-simulation ask now goes through this catalog.

Catalog expanded 2026-08-27 (screen-by-screen question inventory,
docs/penny/question-inventory/) from 13 to 17 tools: four new tools
(`get_today_brief`, `get_recurring_payments`, `get_account_activity`,
`get_mirror`), `get_page_explainer` replaced by a single `explain(topic)`
covering three registries (terms/numbers/actions) in addition to the
original page/topic copy, and an enrichment pass wiring through why-fields
six existing tools were dropping (`get_debt_position`, `get_upcoming_bills`,
`get_insights`, `get_accounts`, `get_goals`, `get_spend_verdict`).

Every tool wraps an EXISTING deterministic engine (analytics/transactions/
savings/spend_verdict/debt_plan/affordability/companion/behaviour/
checkpoints/commitments) — with one marked exception (see
`_exec_get_savings_position`'s `pct_funded` line below, a twin of the same
inline arithmetic the Savings page's own route computes, never re-derived
from scratch here), this module never re-derives a figure those engines
already compute, it only shapes their output into a compact, LLM-friendly
dict. `get_recurring_payments`'s `_cadence_label` is the one other marked
exception: not a financial figure, a plain-English label built from the
exact weekly/fortnightly/monthly day-count bands `_detect_recurring`
(app.routers.analytics) itself already uses to pick a projection strategy,
so the label can never describe a cadence the detector disagrees with.

Never MUTATES user-visible state: no tool here writes a transaction,
account, goal, or preference. It is not, however, a zero-side-effect read —
`get_savings_position` calls `app.services.cashflow.monthly_cashflow_cached`
(via `app.routers.savings._cashflow`), which memoises its result with an
upsert into the user's `cashflow_cache` document on a cache miss (see that
function's own docstring, app/services/cashflow.py). That write is
invisible to the user (a 6h TTL cache blob, not a fact they see) and
identical to what happens on every OTHER existing caller of that same
helper — nothing new this module introduces — so "read-only" here means
"never writes anything the user would recognise as their data changing",
not "issues zero Mongo writes of any kind". `get_mirror` deliberately does
NOT extend this precedent: unlike the router's own `GET /mirror`, it never
persists a freshly computed portrait back to `behaviour_portrait_col`, it
only merges the user's already-persisted keep/change choices onto an
in-memory recompute. `get_today_brief` is the other tool that had to be
kept off this precedent rather than added to it (audit finding,
2026-08-27): `app.services.companion.compute_today_items` is NOT a
zero-side-effect read either, it upserts item-state on
`companion_items_col` throughout AND stamps two one-time "burn" markers
(`celebrated_at`/`last_streak_celebrated`) the instant a celebration is
computed, so a real Home load never shows the same celebration twice. Both
`get_today_brief` calls pass the engine's own `persist=False` flag (added
for this reason), which gates every write in that call chain while still
computing and returning the same in-memory items — no new write type
beyond the existing cashflow-cache memoisation is introduced anywhere in
this module.

IMPORT RULE: this module must NEVER import from app.routers.can_i (that
module imports the agent that imports this one — a cycle). Anything can_i.py
already has that this module also needs (the £-formatting helper, the active
goals summary) is reimplemented here in miniature, each marked with a
"twin of" comment pointing at its original.
"""
import asyncio
import difflib
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from app.db.collections import (
    accounts_col, behaviour_portrait_col, card_terms_col, cashflow_cache_col,
    connections_col, finexer_consents_col, manual_account_rules_col,
    manual_accounts_col, mono_transactions_col, mpesa_transactions_col,
    penny_proposals_col, preferences_col, savings_goals_col,
    savings_insights_col, statement_transactions_col, transactions_col,
    yapily_accounts_col, yapily_transactions_col,
)
from app.routers.analytics import (
    PATTERNS_VERSION, _build_cashflow_response, _compute_cashflow_patterns,
    compute_safe_to_spend,
)
from app.routers.savings import _cashflow, _current_savings, _target_amount
from app.routers.grow import _period_gate as _grow_period_gate
from app.routers.transactions import (
    _doc_to_tx, _merge_paginate, _parse_date_bound, _search_query,
)
from app.routers.chat import build_tax_fact_pack
from app.content.money_basics import MONEY_BASICS, TAX_YEAR as _BASICS_TAX_YEAR
from app.services.affordability import check_affordability as _check_affordability
from app.services.categories import get_category_kinds, is_non_spend
from app.services.companion import compute_today_items
from app.services.behaviour import compute_portrait as _compute_portrait
from app.services.checkpoints import list_active as _list_active_checkpoints
from app.services.debt_plan import get_debt_plan_cached
from app.services.region import get_user_region
from app.services.safe_calc import evaluate as _safe_calc_evaluate
from app.services.spend_verdict import compute_spend_verdict
from app.services.sync_freshness import last_bank_sync

logger = logging.getLogger(__name__)


# ── £ formatting — twin of app.routers.can_i._fmt_gbp ────────────────────────
# Copied rather than imported (see the IMPORT RULE in the module docstring):
# same Unicode minus (−), never a hyphen, for negative money.
def _fmt_gbp(amount: float, decimals: int = 0) -> str:
    amount = amount or 0.0
    return f"−£{abs(amount):,.{decimals}f}" if amount < 0 else f"£{amount:,.{decimals}f}"


def _money(amount, decimals: int = 0) -> dict:
    """Every money value the tool layer hands the model appears both raw and
    pre-formatted, per the brief — one shared shape so no executor below
    has to remember to do both. `decimals` defaults to the app-wide
    whole-pound headline convention; callers pass 2 for an individual
    transaction's own amount, where the pence ARE the answer (a single
    small credit like a daily savings-challenge payment rounds away to
    nothing useful at whole-pound precision — audit fix, 2026-08-30)."""
    val = float(amount or 0.0)
    return {"raw": round(val, 2), "formatted": _fmt_gbp(val, decimals)}


# ── Tool catalog ───────────────────────────────────────────────────────────
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_safe_to_spend",
            "description": (
                "The user's current safe-to-spend figure: the money that is genuinely "
                "free to spend before their next payday, already net of upcoming bills "
                "and any unpaid credit-card growth. Use this for ANY question about "
                "how much the user can afford, has spare, or has left until payday. "
                "The returned figures are authoritative, never estimate your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_bills",
            "description": (
                "The user's upcoming recurring bills and expected income in the next "
                "35 days, each with an amount and days away. Use this when the "
                "question is about what's due, what's coming up, or when the next "
                "bill/payment lands. Figures are authoritative, never estimate your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": (
                "Search the user's own transaction history. Use this to answer "
                "questions naming a specific merchant, category, date range, or "
                "transaction type ('how much did I spend at X', 'show my Tesco "
                "payments', 'what did I spend on eating out in April'). Returns at "
                "most 20 rows, most recent first. Figures are authoritative, never "
                "estimate your own. Does NOT match account or pot names — `q` only "
                "searches each row's own description/merchant/category. If the "
                "question instead NAMES a specific account or pot and asks about "
                "ITS transactions ('what was the first payment into my Saving "
                "Challenge pot', 'what came into my ISA'), call get_account_activity "
                "with that account/pot name instead, never this tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string", "description": "Free-text match against description/merchant/category."},
                    "category": {"type": "string", "description": "Exact spend category name, e.g. 'Eating Out'."},
                    "merchants": {"type": "string", "description": "Comma-separated merchant names to match."},
                    "date_from": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive lower bound."},
                    "date_to": {"type": "string", "description": "ISO date (YYYY-MM-DD), inclusive upper bound."},
                    "txn_type": {"type": "string", "enum": ["debit", "credit"], "description": "Restrict to money out (debit) or money in (credit)."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_accounts",
            "description": (
                "The user's connected accounts: id, name, provider, type/subtype "
                "and current balance for each. Use this for questions about which "
                "accounts the user has, or a specific account's balance — and to "
                "look up an account's id before calling get_account_activity when "
                "two accounts might share a similar name. Never returns "
                "credentials, account numbers or sort codes."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_spend_verdict",
            "description": (
                "The user's spend verdict for one pay period: whether they're running "
                "over or under their usual pace, the reading sentence, and any money "
                "moved between own accounts. Use this for 'how is my spending going', "
                "'am I overspending', or 'was I over usual on X'. period_offset 0 is "
                "the current period, negative values are prior closed periods (-1 = "
                "last period). Figures are authoritative, never estimate your own."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "period_offset": {
                        "type": "integer",
                        "description": "0 = current pay period (default), -1 = previous period, etc.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_savings_position",
            "description": (
                "The user's savings buffer: current savings, target, percent funded, "
                "and monthly income/spending/surplus. Use this for questions about "
                "savings progress, safety net size, or monthly surplus. Figures are "
                "authoritative, never estimate your own. monthly_surplus is a 90-day "
                "smoothed typical-month median, it can read positive even while the "
                "CURRENT pay period is short — always check the returned period_gate "
                "field before suggesting the user has money spare to move or stash; "
                "when period_gate.short is true, tell them the period needs covering "
                "first (period_gate.to_cover, by period_gate.period_end), never lead "
                "with the monthly surplus as spare money that payday."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_debt_position",
            "description": (
                "The user's credit-card debt position: total debt, monthly interest "
                "being charged, projected debt-free month, and a per-card breakdown. "
                "Use this for any question about debt, cards owed on, or interest "
                "being paid. Figures are authoritative, never estimate your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_goals",
            "description": (
                "The user's active savings/spending goals (e.g. a named pot like "
                "'Japan'), with target amount and target date where set. Use this "
                "when the question names a goal or asks about progress toward one."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_affordability",
            "description": (
                "Check whether the user can afford a specific £ amount, right now "
                "or by a future date. Call this for ANY 'can I afford/spend X' "
                "question once you have extracted a £ amount from the question "
                "yourself, this tool never guesses the amount for you and never "
                "does the arithmetic twice. `timeframe` is optional free text "
                "naming a future date/month/year the spend is FOR (e.g. "
                "'December', 'October 2027', 'next year'), omit it for a "
                "same-pay-period question. The returned `verdict` is a complete, "
                "final, already-decided sentence (e.g. '£35 leaves £149 free' or "
                "'That doesn't fit'): quote it verbatim as your HEADLINE, never "
                "invent a different verdict word (Yes/No/Tight) of your own. If "
                "the result carries `ask_when: true`, it judged this amount "
                "against the CURRENT pay period only because no timeframe was "
                "given and the amount is large, your reply must ask when the "
                "spend is actually for alongside the current-period fact."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "The £ amount asked about, extracted from the question."},
                    "timeframe": {"type": "string", "description": "Optional future date/month/year this spend is for, as free text, e.g. 'December' or 'next year'."},
                },
                "required": ["amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_category_spend",
            "description": (
                "Per-category spend totals: this pay period, optionally the last "
                "N months too, with payment count and the top 3 merchants by "
                "spend in that category. Omit `category` to get the top spending "
                "categories this period instead of one category's detail. Use "
                "this for 'how much did I spend on X', 'what's driving my X "
                "spend', or any advice-shaped question ('how can I cut my X "
                "spending') where the facts (the total, how it compares, what's "
                "driving it) make the answer obvious without you prescribing "
                "anything. Figures are authoritative, never estimate your own."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Exact spend category name, e.g. 'Entertainment'. Omit for the top categories this period."},
                    "months": {"type": "integer", "description": "Optional: also total this category over the last N calendar months (rolling window)."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_insights",
            "description": (
                "The user's savings insights: general-information tips generated "
                "from their own transactions (a bill that's crept up, a cheaper "
                "alternative, a pattern worth knowing about), the same list shown "
                "on their Insights page, ranked the same way. Use this for "
                "questions about insights, tips, saving ideas, or 'what's the "
                "best insight'. Rank 1 IS the top/best insight, never re-rank."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain",
            "description": (
                "Fixed, pre-written explanations the model must use instead of "
                "answering from its own understanding of the app. Four kinds "
                "of topic, all in one flat namespace: "
                "(a) a SCREEN or general-information topic ('what does this "
                "page show') — home, spend, planning, insights, tax, grow, "
                "debt, accounts, isa_capability, saving_vs_investing, "
                "categorisation. "
                "(b) a JARGON TERM the app uses ('what does X mean', 'what is "
                "an aim') — moved, carried_vs_float, aim, reserved, dormant, "
                "unplaced, usual_pace, one_off_vs_new_normal, "
                "demonstrated_movement, buffer, pay_period, "
                "red_amber_doctrine, offset_shadow, pinned_dismissal. "
                "(c) a HEADLINE NUMBER's definition and which sibling figure "
                "it disagrees with and why ('why don't these numbers agree') "
                "— safe_to_spend_free, planning_runway, grow_surplus_monthly, "
                "spend_out, spend_majority_header, over_time_chart, "
                "month_end_cash, moved_total. "
                "(d) a HOW-DO-I walkthrough for an app action — change_bill, "
                "stop_prediction, skip_occurrence, set_cancel_aim, "
                "recategorise_and_rule, review_transfers, confirm_payday, "
                "set_pay_period, reconnect_bank, add_card_rates, pin_account, "
                "add_offline_account, plan_oneoff_vs_commitment. "
                "(e) a UK MONEY-BASICS explainer, general information not "
                "personal to the user ('what is an ISA', 'should I pay off "
                "debt before investing') — isa-allowance, cash-vs-ss-isa, "
                "lisa, personal-savings-allowance, emergency-fund, "
                "high-interest-debt-first, pension-match, "
                "pension-tax-relief, compound-interest, investment-fees, "
                "diversification, dividend-allowance, cgt-allowance, "
                "tax-year-dates, premium-bonds, marriage-allowance, "
                "conscious-spending-plan, fifty-thirty-twenty, "
                "pay-yourself-first. "
                "Call this for ANY of these question shapes. An unknown topic "
                "returns the full list of valid keys to pick from. The "
                "returned text is complete and final, follow it closely "
                "rather than inventing your own explanation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "One topic key from the list in this tool's description.",
                    },
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tax_position",
            "description": (
                "The user's OWN UK tax figures for this tax year (2026/27): "
                "income, pension contributions, adjusted net income, and "
                "personal allowance remaining (the taper above £100,000, lost "
                "entirely by £125,140), plus whether they receive Child "
                "Benefit. Call this for any UK tax question about the user's "
                "OWN numbers ('how much personal allowance do I have left', "
                "'what's my adjusted net income') rather than estimating from "
                "general knowledge. Figures are authoritative, never estimate "
                "your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_today_brief",
            "description": (
                "Everything Penny is currently asking/suggesting on Home: "
                "recommended money moves and why, cliffs (promo rates "
                "ending), celebrations, asks (like confirming payday), the "
                "monthly rhythm/needle invitations, and the payday plan split "
                "(live if it's payday, or a preview otherwise). Use this for "
                "'what is Penny suggesting/asking', 'why is this move "
                "recommended', 'what happens if I ignore it', 'what's my "
                "payday plan'. Figures are authoritative, never estimate your "
                "own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recurring_payments",
            "description": (
                "The user's detected recurring/subscription payments: name, "
                "cadence, typical amount, next expected date, and which "
                "account/bank each bills from. Use this for 'what "
                "subscriptions am I paying', 'when does X renew', 'which "
                "account does X bill from', or any question naming a "
                "specific recurring bill rather than the whole upcoming-bills "
                "list. Figures are authoritative, never estimate your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_activity",
            "description": (
                "Server-computed money in/out for one account or POT (or "
                "every account if none is named) over a recent window: "
                "money in, money out split into spend vs money moved to "
                "other own accounts, net, the largest transactions "
                "(`top_transactions`), and the chronologically FIRST and "
                "LAST transaction in the window (`first_transaction`/"
                "`last_transaction` — always correct even when the window "
                "holds more rows than `top_transactions` shows). Use this "
                "any time a question NAMES a specific account or pot (a "
                "Monzo pot, a savings challenge, an ISA, a current account) "
                "and asks about its own activity or transactions — 'why did "
                "my balance change', 'what moved through X account', 'what "
                "was the first/earliest/latest payment into X pot' — this is "
                "the only tool that can answer that, the app itself keeps no "
                "balance-history chart, and search_transactions cannot match "
                "an account/pot NAME at all. `account_id_or_name` accepts a "
                "loose, everyday version of the name (plurals, missing "
                "words in parentheses), it does not need to be exact. All "
                "totals are server-aggregated, never sum rows yourself. If "
                "two accounts share a name, this returns `{ambiguous: true, "
                "matches: [...]}` with each candidate's id instead of "
                "guessing, call get_accounts first to see every account's id "
                "and re-call with the right one. For a question scoped to "
                "'this period'/'this pay period' rather than a plain number "
                "of days, call get_spend_verdict first for period.start and "
                "pass it as date_from here, don't guess a days value for it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id_or_name": {
                        "type": "string",
                        "description": (
                            "An account's id (from get_accounts, always unambiguous) or a "
                            "(partial, case-insensitive) name. Omit for every account. "
                            "Prefer the id when get_accounts shows more than one account "
                            "with a similar name."
                        ),
                    },
                    "days": {
                        "type": "integer",
                        "description": "How many days back to look. Defaults to 30. Ignored when date_from is given.",
                    },
                    "date_from": {
                        "type": "string",
                        "description": (
                            "ISO date (YYYY-MM-DD), inclusive lower bound. Use this (not "
                            "`days`) for a 'this period'/'this pay period' question — pass "
                            "get_spend_verdict's period.start. Takes priority over `days` "
                            "when given."
                        ),
                    },
                    "date_to": {
                        "type": "string",
                        "description": "ISO date (YYYY-MM-DD), inclusive upper bound. Defaults to today.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_mirror",
            "description": (
                "The user's behavioural portrait (the Mirror): named traits "
                "with a narrative and evidence drawn from their own "
                "transactions, plus any active aims (spending checkpoints "
                "they set) with progress and whether they're on track. Use "
                "this for 'what is the Mirror', 'why do you say this about "
                "me', 'how is my aim going', 'what have I kept/changed'. "
                "Figures are authoritative, never estimate your own."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fill_candidates",
            "description": (
                "Recent (90 day) credit payments landing in one account, "
                "grouped by recurring series, most recent first — the same "
                "picker data the Allocation sheet's 'which payment fills "
                "it?' step uses. Use this to find the exact payment that "
                "should fill an envelope/allocation BEFORE calling "
                "propose_create_allocation, so match_value names a real, "
                "recent payment rather than a guess."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id_or_name": {
                        "type": "string",
                        "description": (
                            "An account's id (from get_accounts, always unambiguous) or a "
                            "(partial, case-insensitive) name."
                        ),
                    },
                },
                "required": ["account_id_or_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": (
                "A generic arithmetic calculator, owner-approved 2026-08-30, for any "
                "multi-step maths you must never do in your head: totals, running "
                "series, percentages, date spans. ALWAYS fetch the real figures you "
                "need from another tool first (get_safe_to_spend, "
                "search_transactions, get_recurring_payments, ...), never guess or "
                "invent a number, then pass them into an expression here. Supports "
                "+ - * / // % ** with parentheses and unary minus, and exactly these "
                "functions: round(x[, ndigits]), abs(x), min(a, b, ...), "
                "max(a, b, ...), series_sum(first, step, count) for a value that "
                "rises or falls by a fixed step each period (count of payments, up "
                "to 5000), and days_between(\"YYYY-MM-DD\", \"YYYY-MM-DD\") (counts "
                "the whole days from the first date up to but not including the "
                "second), and pct(x, p) for p percent of x. Worked example: a daily "
                "savings-challenge payment starting at 8.96, rising 0.04 (4p) a day "
                "for 27 days: series_sum(8.96, 0.04, 27). No variable names and no "
                "other functions are understood. Expressions over 400 characters are "
                "rejected. The result is exact and authoritative, quote it verbatim "
                "and show your working in the reply rather than restating the raw "
                "expression."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": (
                            "The arithmetic expression to evaluate, e.g. "
                            "'series_sum(8.96, 0.04, 27)' or '(120 + 45) * 0.5'."
                        ),
                    },
                },
                "required": ["expression"],
            },
        },
    },
]


# ── Write tools (propose-only) — Penny Agent Mode v1, owner decision
# 2026-08-30 (see PENNY_TOOLS.md's "Write tools (propose-only)" table). Only
# ever offered to the model when the user has granted `penny_agent_consent`
# (app.services.penny_agent gates this — these schemas are appended to
# TOOL_SCHEMAS only in that case; app.routers.can_i also checks consent
# before treating any of these as a real proposal). Every executor below
# builds a validated PROPOSAL, it never mutates real data — see
# `_create_proposal` and each `_exec_propose_*` function's own doctrine
# comment for the anti-injection rule every one of them follows.
PROPOSE_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "propose_mirror_choice",
            "description": (
                "Propose recording the user's keep/change choice on one "
                "Mirror trait ('this is me, keep it' or 'this isn't me, "
                "change it'). Call only when the user has clearly asked "
                "you to record this, not merely discussed the trait. "
                "`trait_id` may be the trait's id (from get_mirror) or its "
                "title, an ambiguous title returns a list to disambiguate "
                "from rather than guessing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "trait_id": {"type": "string", "description": "A trait id or title from get_mirror."},
                    "choice": {"type": "string", "enum": ["keep", "change"]},
                },
                "required": ["trait_id", "choice"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_dismiss_recurring",
            "description": (
                "Propose marking a recurring series as 'not a bill', so it "
                "stops appearing in upcoming bills and predictions. `key` "
                "may be the exact series key/name (from "
                "get_recurring_payments) or a partial name, an ambiguous "
                "name returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "A recurring series key or name from get_recurring_payments."},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_restore_recurring",
            "description": (
                "Propose undoing a previous 'not a bill' dismissal, "
                "letting a series back into predictions. `key` may be the "
                "exact series key or a partial name matched against the "
                "user's currently-dismissed series, an ambiguous name "
                "returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "A dismissed recurring series key or name."},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_add_planned",
            "description": (
                "Propose adding a one-off planned expense (a single dated "
                "payment from one account) to the user's projection, the "
                "same thing '+ Plan a one-off' on Planning does. Date must "
                "be today or in the future."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A short label for the expense."},
                    "amount": {"type": "number", "description": "The £ amount, must be positive."},
                    "date": {"type": "string", "description": "ISO date (YYYY-MM-DD), today or later."},
                    "account_id": {
                        "type": "string",
                        "description": "Optional: an account id or name (from get_accounts) this will be paid from.",
                    },
                },
                "required": ["name", "amount", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_create_allocation",
            "description": (
                "Propose a new per-pay-period allocation (envelope): a "
                "fixed amount reserved from safe-to-spend each period, "
                "filled by a specific recurring credit payment landing in "
                "one account. Call get_fill_candidates first to find the "
                "real payment name for `match_value` rather than guessing "
                "it. `match_type` 'description_equals' needs the payment's "
                "exact description; 'description_contains' matches a "
                "substring of it, more forgiving. `recurrence` 'once' "
                "applies only to the current pay period; 'every_period' "
                "repeats indefinitely."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A short label for the allocation."},
                    "amount_per_period": {"type": "number", "description": "The £ amount reserved each period, must be positive."},
                    "fill_account_id": {"type": "string", "description": "An account id or name (from get_accounts) the fill payment lands in."},
                    "match_type": {"type": "string", "enum": ["description_equals", "description_contains"]},
                    "match_value": {"type": "string", "description": "The payment description (or substring of it) that fills this allocation."},
                    "recurrence": {"type": "string", "enum": ["every_period", "once"]},
                    "effective_from": {
                        "type": "string",
                        "description": "Optional ISO date (YYYY-MM-DD) fills start counting from. Defaults to the start of the current pay period.",
                    },
                },
                "required": ["name", "amount_per_period", "fill_account_id", "match_type", "match_value", "recurrence"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_create_commitment",
            "description": (
                "Propose a new commitment (a named future big expense, "
                "e.g. a holiday or a car, saved toward a slice at a time "
                "each pay period until a target date), the same thing "
                "'+ Plan a big expense' on Planning does. Optionally fund "
                "it from one or more of the user's own pots/accounts. The "
                "returned consequence line states whether the per-period "
                "slice fits comfortably or is a stretch, from the same "
                "feasibility check the Planning sheet itself shows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A short label for the commitment."},
                    "amount": {"type": "number", "description": "The total £ amount needed, must be positive."},
                    "target_date": {"type": "string", "description": "ISO date (YYYY-MM-DD) this is needed by, today or later."},
                    "funding_pots": {
                        "type": "array",
                        "description": "Optional: accounts (id or name, from get_accounts) whose balance contributes toward this commitment.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "account_id": {"type": "string", "description": "An account id or name."},
                                "count_existing": {
                                    "type": "boolean",
                                    "description": "True to count the pot's whole current balance now; false (default) to count only future growth.",
                                },
                            },
                        },
                    },
                },
                "required": ["name", "amount", "target_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_planned",
            "description": (
                "Propose changing a planned one-off's name, amount, and/or "
                "date, the same thing PlannedEditSheet's save does. "
                "`planned_ref` may be an id or a name from get_upcoming_bills "
                "(its `planned`/`planned_id` fields), an ambiguous name "
                "returns a list to disambiguate from. At least one of name, "
                "amount, date must be given. A new date must be today or "
                "later, unless it equals the item's current date."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "planned_ref": {"type": "string", "description": "A planned expense's id or name."},
                    "name": {"type": "string", "description": "Optional: a new short label."},
                    "amount": {"type": "number", "description": "Optional: a new £ amount, must be positive."},
                    "date": {"type": "string", "description": "Optional: a new ISO date (YYYY-MM-DD), today or later."},
                },
                "required": ["planned_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_planned",
            "description": (
                "Propose removing a planned one-off from the projection "
                "entirely, the same thing the delete control on Planning "
                "does. `planned_ref` may be an id or a name from "
                "get_upcoming_bills, an ambiguous name returns a list to "
                "disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "planned_ref": {"type": "string", "description": "A planned expense's id or name."},
                },
                "required": ["planned_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_allocation",
            "description": (
                "Propose changing an allocation's (envelope's) name, "
                "amount per period, recurrence, or pausing/resuming it, "
                "the same fields AllocationSheet's pause/resume and its "
                "own save cover, EXCEPT which account or payment fills it "
                "(that still needs the app's own sheet). `allocation_ref` "
                "may be an id or a name from get_fill_candidates or a "
                "prior get_accounts/allocations mention, an ambiguous name "
                "returns a list to disambiguate from. At least one of "
                "name, amount_per_period, recurrence, paused must be given."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "allocation_ref": {"type": "string", "description": "An allocation's id or name."},
                    "name": {"type": "string", "description": "Optional: a new short label."},
                    "amount_per_period": {"type": "number", "description": "Optional: a new £ amount reserved each period, must be positive."},
                    "recurrence": {"type": "string", "enum": ["every_period", "once"], "description": "Optional: a new recurrence."},
                    "paused": {"type": "boolean", "description": "Optional: true to pause it, false to resume it."},
                },
                "required": ["allocation_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_allocation",
            "description": (
                "Propose deleting an allocation (envelope) entirely, the "
                "same thing AllocationSheet's delete control does. "
                "`allocation_ref` may be an id or a name, an ambiguous "
                "name returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "allocation_ref": {"type": "string", "description": "An allocation's id or name."},
                },
                "required": ["allocation_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_commitment",
            "description": (
                "Propose changing a commitment/goal's name, total amount, "
                "and/or target date, the same fields CommitmentSheet's "
                "edit covers EXCEPT its funding pots (that still needs the "
                "app's own sheet). `commitment_ref` may be an id or a name "
                "from get_goals, an ambiguous name returns a list to "
                "disambiguate from. At least one of name, amount, "
                "target_date must be given."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "commitment_ref": {"type": "string", "description": "A commitment's id or name."},
                    "name": {"type": "string", "description": "Optional: a new short label."},
                    "amount": {"type": "number", "description": "Optional: a new total £ amount needed, must be positive."},
                    "target_date": {"type": "string", "description": "Optional: a new ISO date (YYYY-MM-DD), today or later."},
                },
                "required": ["commitment_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_commitment",
            "description": (
                "Propose cancelling a commitment/goal, the same thing "
                "CommitmentSheet's cancel control does (the record is kept "
                "as cancelled, not erased, so history stays honest). "
                "`commitment_ref` may be an id or a name from get_goals, "
                "an ambiguous name returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "commitment_ref": {"type": "string", "description": "A commitment's id or name."},
                },
                "required": ["commitment_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_checkpoint",
            "description": (
                "Propose cancelling an active aim/checkpoint on a spend "
                "category, the same thing cancelling an aim on Spend or "
                "Mirror does. There is no separate edit tool for this, "
                "cancel and (if wanted) set a new one via `get_mirror`'s "
                "own aim-setting surface in the app. `checkpoint_ref` may "
                "be an id or the category name it's set on (from "
                "get_mirror's active aims), an ambiguous name returns a "
                "list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "checkpoint_ref": {"type": "string", "description": "An aim's id or the category name it's set on."},
                },
                "required": ["checkpoint_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_skip_occurrence",
            "description": (
                "Propose skipping ONE upcoming occurrence of a recurring "
                "bill or income (it stops appearing in that one date's "
                "projection only, the series itself keeps recurring "
                "afterwards), the same thing UpcomingEditSheet's skip "
                "control does. Reversible via propose_clear_override with "
                "the same key_or_name and date. `key_or_name` may be the "
                "exact series key/name (from get_recurring_payments or "
                "get_upcoming_bills) or a partial name, an ambiguous name "
                "returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key_or_name": {"type": "string", "description": "A recurring series key or name."},
                    "date": {"type": "string", "description": "ISO date (YYYY-MM-DD) of the specific occurrence to skip."},
                },
                "required": ["key_or_name", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_edit_occurrence",
            "description": (
                "Propose overriding ONE upcoming occurrence's date and/or "
                "amount, the same thing UpcomingEditSheet's edit control "
                "does. `scope` 'one' changes only the occurrence on `date`; "
                "'future' also changes every later occurrence of this same "
                "series. Reversible via propose_clear_override with the "
                "same key_or_name and date. At least one of new_date, "
                "new_amount must be given. `key_or_name` may be the exact "
                "series key/name (from get_recurring_payments or "
                "get_upcoming_bills) or a partial name, an ambiguous name "
                "returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key_or_name": {"type": "string", "description": "A recurring series key or name."},
                    "date": {"type": "string", "description": "ISO date (YYYY-MM-DD) of the specific occurrence to change."},
                    "new_date": {"type": "string", "description": "Optional: a new ISO date (YYYY-MM-DD) for this occurrence."},
                    "new_amount": {"type": "number", "description": "Optional: a new £ amount for this occurrence, must be positive."},
                    "scope": {"type": "string", "enum": ["one", "future"], "description": "'one' changes just this occurrence, 'future' also changes every later one in the series."},
                },
                "required": ["key_or_name", "date", "scope"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_clear_override",
            "description": (
                "Propose clearing a previous skip or edit on ONE upcoming "
                "occurrence, reverting it to the engine's own predicted "
                "date and amount, the same thing UpcomingEditSheet's "
                "'Clear override' control does. `key_or_name` may be the "
                "exact series key/name or a partial name, an ambiguous "
                "name returns a list to disambiguate from."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "key_or_name": {"type": "string", "description": "A recurring series key or name."},
                    "date": {"type": "string", "description": "ISO date (YYYY-MM-DD) of the specific occurrence to revert."},
                },
                "required": ["key_or_name", "date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_recategorise_transaction",
            "description": (
                "Propose refiling ONE transaction under a different "
                "category, the same thing tapping a transaction and "
                "choosing a category does. Owner amendment, 2026-08-30: "
                "user-initiated recategorisation only, never propose this "
                "for a row from the miscategorised-guardrail queue (a "
                "transfer-pair suggestion, a flagged own-transfer), that "
                "domain still needs the app's own evidence-side-by-side "
                "review sheet.\n\n"
                "Resolve the transaction with transaction_id when you "
                "already have one from search_transactions or "
                "get_account_activity's rows (including its "
                "first_transaction/last_transaction/top_transactions); "
                "otherwise pass merchant plus date (amount narrows further "
                "and is recommended whenever you have it). Ambiguous or "
                "unresolvable returns matches to disambiguate from or an "
                "error, never a guess.\n\n"
                "scope MUST be resolved before you call this tool: if the "
                "conversation hasn't already said whether this is a "
                "one-off fix or should apply to this merchant going "
                "forward, ASK the user first ('just this once, or always "
                "file <merchant> as <category>?') rather than assuming. "
                "just_once changes only this one transaction. always sets "
                "a rule for this merchant AND refiles matching past "
                "transactions, the returned consequence line states "
                "exactly how many."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {
                        "type": "string",
                        "description": "A transaction id from search_transactions or get_account_activity. Preferred over the merchant/date/amount triple when you have it.",
                    },
                    "merchant": {
                        "type": "string",
                        "description": "The transaction's merchant or description text. Required with date when transaction_id isn't known.",
                    },
                    "date": {
                        "type": "string",
                        "description": "ISO date (YYYY-MM-DD) the transaction happened. Required with merchant when transaction_id isn't known.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "The transaction's £ amount, positive. Optional but recommended alongside merchant/date to narrow to one match.",
                    },
                    "new_category": {
                        "type": "string",
                        "description": "The category to file it under, one of the user's real categories (built-in or their own custom one), never a movement/income category (Transfer, Savings, Investment, Debt, Income, Other).",
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["just_once", "always"],
                        "description": "'just_once' changes only this transaction. 'always' also sets a rule refiling matching past transactions. Ask the user which they want if the conversation hasn't said.",
                    },
                },
                "required": ["new_category", "scope"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_card_apr",
            "description": (
                "Propose setting one credit card's STANDARD APR (the "
                "ongoing interest rate once any 0% promo period has "
                "ended), the same thing typing a rate into that card's "
                "own terms sheet in the app does.\n\n"
                "Owner doctrine amendment #2, 2026-08-30: VERBATIM "
                "PROVENANCE ONLY. apr_pct must be the exact number the "
                "user themselves typed in this conversation, this turn "
                "or an earlier one, never a number you infer, estimate, "
                "round, or paraphrase from vaguer language ('about 25%', "
                "'whatever the average card charges'). If the user "
                "hasn't actually typed a number, do not guess one and do "
                "not call this tool with a made-up figure, ask them to "
                "type the number first. The tool independently refuses "
                "any apr_pct that doesn't appear literally in the user's "
                "own words and hands back a clarifying question instead "
                "of a proposal, so calling it with an invented figure "
                "only wastes a round.\n\n"
                "Scope v1: STANDARD APR only. This tool cannot set a 0% "
                "promo window (purchases or balance transfer) or a "
                "balance-transfer offer, for those tell the user to use "
                "the card's own terms sheet in the app instead of trying "
                "to mangle a promo request into an APR figure.\n\n"
                "card_ref resolves to ONE of the user's owned credit-card "
                "accounts, by id (from get_accounts) or a loose name/bank "
                "match ('my amex', 'the natwest mastercard'). If more "
                "than one card matches (the user may hold near-identical "
                "cards, e.g. two different cards both called "
                "'Mastercard'), this returns {ambiguous: true, matches: "
                "[...]} with each candidate's balance and last 4 digits, "
                "relay THOSE distinguishing details to the user when "
                "asking which one they mean, a bare card name is not "
                "enough to tell them apart."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "card_ref": {
                        "type": "string",
                        "description": "A credit card's account id (from get_accounts) or a loose name/bank match, e.g. 'my amex' or 'the natwest mastercard'.",
                    },
                    "apr_pct": {
                        "type": "number",
                        "description": "The standard APR, 0-100, as a number the user literally typed in this conversation. Never invent, estimate, or round this figure yourself.",
                    },
                },
                "required": ["card_ref", "apr_pct"],
            },
        },
    },
    # ── B15 (2026-09-08, B12 stage 2) — preferences that change money maths.
    # All eight tools below replay through app.routers.preferences's own
    # `update_preferences` (the SAME function PATCH /preferences calls, so
    # the response-cache wipe and the pay-period cashflow recompute happen
    # identically to a Settings edit, never a second write path), each
    # wrapped in validation this module owns because the router itself
    # barely validates its body (see `_exec_propose_set_pay_period`'s own
    # comment). Doctrine unchanged: every one of these BUILDS A PROPOSAL,
    # never writes preferences directly.
    {
        "type": "function",
        "function": {
            "name": "propose_set_pay_period",
            "description": (
                "Propose changing how the user's pay period is worked "
                "out, the same thing the Pay Period sheet in Settings "
                "does. This changes the period window Safe-to-Spend, "
                "Upcoming and Planning all use, so only call it when the "
                "user has clearly asked to change their pay period or "
                "payday pattern, not merely mentioned a date.\n\n"
                "`config.type` must be one of: 'calendar_month' (1st to "
                "last day of each month, no other fields), "
                "'monthly_pay_date' (needs `config.day`, 1-28), "
                "'biweekly' (needs `config.weekday` 0-6, Sunday=0, and "
                "`config.referenceDate`, an ISO date the user was "
                "actually paid on), 'last_weekday_of_month' (needs "
                "`config.weekday` 0-6). These are the only four options "
                "the Settings sheet itself offers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "config": {
                        "type": "object",
                        "description": (
                            "The new pay period config, e.g. "
                            "{\"type\": \"monthly_pay_date\", \"day\": 25}."
                        ),
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "calendar_month", "monthly_pay_date",
                                    "biweekly", "last_weekday_of_month",
                                ],
                            },
                            "day": {"type": "integer", "description": "1-28, only for 'monthly_pay_date'."},
                            "weekday": {"type": "integer", "description": "0 (Sunday) to 6 (Saturday)."},
                            "referenceDate": {"type": "string", "description": "ISO date (YYYY-MM-DD), only for 'biweekly'."},
                        },
                        "required": ["type"],
                    },
                },
                "required": ["config"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_income",
            "description": (
                "Propose setting the user's approximate annual income on "
                "file, the same field Settings' 'Financial profile' "
                "saves. Feeds the tax position (personal allowance, "
                "Child Benefit charge check). `amount_annual` must be a "
                "real £/yr figure the user has told you, never "
                "estimated. `bracket` (one of 'under_100k', "
                "'100k_125k', '125k_plus') is accepted only as a way to "
                "recognise the user naming a band rather than a figure, "
                "it can never set income by itself, if only a bracket is "
                "given this asks for an approximate number instead of "
                "inventing one."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount_annual": {"type": "number", "description": "The user's approximate annual income in GBP, must not be negative."},
                    "bracket": {
                        "type": "string",
                        "enum": ["under_100k", "100k_125k", "125k_plus"],
                        "description": "A named income band, only when the user hasn't given an exact figure.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_pension_contributions",
            "description": (
                "Propose setting the user's annual pension contribution "
                "figure on file, the same field Settings' 'Financial "
                "profile' saves. Feeds adjusted net income and the "
                "personal allowance taper. `amount_annual` must be a "
                "real £/yr figure the user has told you, never "
                "estimated, and must not be negative."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount_annual": {"type": "number", "description": "The user's approximate annual pension contribution in GBP, must not be negative."},
                },
                "required": ["amount_annual"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_child_benefit",
            "description": (
                "Propose recording whether the user is currently "
                "receiving Child Benefit, the same toggle Settings' "
                "'Financial profile' has. Feeds the High Income Child "
                "Benefit Charge check in the tax position."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "receiving": {"type": "boolean", "description": "True if the user is receiving Child Benefit, false otherwise."},
                },
                "required": ["receiving"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_debt_target",
            "description": (
                "Propose setting how many months the user is targeting "
                "to clear their debt in. Feeds the repayment timelines "
                "shown on Cards and Planning."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {"type": "integer", "description": "A whole number of months, 1-360."},
                },
                "required": ["months"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_debt_tracking_start",
            "description": (
                "Propose setting the reference date the user's debt "
                "movement is measured from on Cards and Planning."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "An ISO date (YYYY-MM-DD) or year-month (YYYY-MM)."},
                },
                "required": ["date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_cover_plan_exclusions",
            "description": (
                "Propose which of the user's own accounts should NEVER "
                "be pulled from to cover a bill shortfall, the same list "
                "Settings' cover-plan section keeps. Changes which "
                "accounts count towards covering bills. `account_refs` "
                "replaces the whole list; pass an empty list to stop "
                "excluding any accounts. Each entry may be an account id "
                "(from get_accounts) or a name, an unknown or ambiguous "
                "name refuses rather than guessing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_refs": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Account ids or names to exclude from the cover plan. Empty list clears all exclusions.",
                    },
                },
                "required": ["account_refs"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_set_hide_balances",
            "description": (
                "Propose turning the app's 'hide balances' privacy mode "
                "on or off, the same toggle available elsewhere in the "
                "app. Only changes what is shown on screen, never what's "
                "included in any calculation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "hidden": {"type": "boolean", "description": "True to hide balances, false to show them."},
                },
                "required": ["hidden"],
            },
        },
    },
    # ── B16 (B12 stage 3) — accounts, ledger, mirror rules, connections ──
    {
        "type": "function",
        "function": {
            "name": "propose_create_offline_account",
            "description": (
                "Propose adding a new offline (manually-tracked) account, "
                "the same as the Accounts page's 'Add offline account' "
                "form. Use for a cash pot, a bank the app can't connect "
                "to, or anything the user wants to track by hand."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A name for the account, up to 60 characters."},
                    "account_type": {
                        "type": "string",
                        "enum": ["savings", "current", "credit_card"],
                    },
                    "balance": {"type": "number", "description": "The starting balance, must not be negative. Defaults to 0 if not given."},
                },
                "required": ["name", "account_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_offline_account",
            "description": (
                "Propose changing an offline account's name, type, or "
                "balance. `account_ref` may be the account's id (from "
                "get_accounts) or its name, an unknown or ambiguous name "
                "returns a list to disambiguate from. At least one of "
                "name/account_type/balance must be given."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_ref": {"type": "string", "description": "The offline account's id or name."},
                    "name": {"type": "string", "description": "A new name, up to 60 characters."},
                    "account_type": {
                        "type": "string",
                        "enum": ["savings", "current", "credit_card"],
                    },
                    "balance": {"type": "number", "description": "A new balance, must not be negative."},
                },
                "required": ["account_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_offline_account",
            "description": (
                "Propose deleting an offline account entirely, along with "
                "every ledger entry recorded on it and any mirror rule "
                "that targets it. `account_ref` may be the account's id "
                "or its name, an unknown or ambiguous name returns a list "
                "to disambiguate from rather than guessing. This is "
                "destructive and cannot be undone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_ref": {"type": "string", "description": "The offline account's id or name."},
                },
                "required": ["account_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_add_ledger_entry",
            "description": (
                "Propose adding a hand-entered transaction to an offline "
                "account's ledger, the same as the Accounts page's own "
                "'Add entry' form. `account_ref` may be the account's id "
                "or its name."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_ref": {"type": "string", "description": "The offline account's id or name."},
                    "amount": {"type": "number", "description": "A positive amount in GBP."},
                    "description": {"type": "string", "description": "What the entry is for, up to 120 characters."},
                    "date": {"type": "string", "description": "An ISO date/datetime, optional, defaults to now."},
                    "direction": {
                        "type": "string",
                        "enum": ["credit", "debit"],
                        "description": "'credit' if money came in, 'debit' if money went out.",
                    },
                },
                "required": ["account_ref", "amount", "description", "direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_ledger_entry",
            "description": (
                "Propose changing a hand-entered ledger entry's amount, "
                "description, date, or direction. `account_ref` resolves "
                "the offline account, `entry_ref` resolves the entry "
                "within it by id or by its description and date — a "
                "rule-posted (mirror) entry can never be edited this way, "
                "only entries the user (or Penny) added by hand. At "
                "least one field to change must be given."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_ref": {"type": "string", "description": "The offline account's id or name."},
                    "entry_ref": {"type": "string", "description": "The ledger entry's id, or its description (matched together with its date)."},
                    "amount": {"type": "number", "description": "A new positive amount in GBP."},
                    "description": {"type": "string", "description": "A new description, up to 120 characters."},
                    "date": {"type": "string", "description": "A new ISO date/datetime."},
                    "direction": {"type": "string", "enum": ["credit", "debit"]},
                },
                "required": ["account_ref", "entry_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_ledger_entry",
            "description": (
                "Propose deleting one hand-entered ledger entry from an "
                "offline account. `account_ref`/`entry_ref` resolve the "
                "same way as propose_update_ledger_entry — a rule-posted "
                "(mirror) entry can never be deleted this way."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "account_ref": {"type": "string", "description": "The offline account's id or name."},
                    "entry_ref": {"type": "string", "description": "The ledger entry's id, or its description (matched together with its date)."},
                },
                "required": ["account_ref", "entry_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_create_account_rule",
            "description": (
                "Propose creating a transaction-mirror rule: whenever a "
                "matching transaction happens on a real (connected) "
                "account, it's posted onto an offline account too, "
                "keeping a hand-tracked pot in sync automatically. The "
                "rule's target must be an offline account. "
                "`source_account_ref` optionally scopes matching to one "
                "connected account only (any account if left out)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "A name for the rule, up to 60 characters."},
                    "target_account_ref": {"type": "string", "description": "The offline account id or name this rule posts onto."},
                    "match_type": {
                        "type": "string",
                        "enum": ["description_contains", "description_equals", "category"],
                    },
                    "match_value": {"type": "string", "description": "The text or category to match, up to 120 characters."},
                    "sign": {
                        "type": "string",
                        "enum": ["same", "opposite"],
                        "description": "'same' mirrors the amount as-is, 'opposite' flips its sign.",
                    },
                    "match_field": {
                        "type": "string",
                        "enum": ["description", "merchant"],
                        "description": "Only used when match_type is 'description_equals'.",
                    },
                    "source_account_ref": {"type": "string", "description": "A connected account id or name to scope matching to, optional."},
                    "backfill": {
                        "type": "boolean",
                        "description": "True to also copy past matching transactions, false to only apply from today onwards.",
                    },
                },
                "required": ["name", "target_account_ref", "match_type", "match_value", "sign"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_update_account_rule",
            "description": (
                "Propose changing a mirror rule's name, match condition, "
                "sign, source account scope, active state, or backfill "
                "choice. `rule_ref` may be the rule's id or its name. At "
                "least one field to change must be given."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "rule_ref": {"type": "string", "description": "The rule's id or name."},
                    "name": {"type": "string", "description": "A new name, up to 60 characters."},
                    "match_type": {
                        "type": "string",
                        "enum": ["description_contains", "description_equals", "category"],
                    },
                    "match_value": {"type": "string", "description": "A new match text or category, up to 120 characters."},
                    "sign": {"type": "string", "enum": ["same", "opposite"]},
                    "match_field": {"type": "string", "enum": ["description", "merchant"]},
                    "source_account_ref": {"type": "string", "description": "A connected account id or name to scope matching to, or empty to allow any account."},
                    "active": {"type": "boolean", "description": "False pauses the rule, true resumes it."},
                    "backfill": {"type": "boolean", "description": "True to reopen its full history, false to pin it to now."},
                },
                "required": ["rule_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_account_rule",
            "description": (
                "Propose deleting a mirror rule. Its past postings onto "
                "the target offline account are reversed. `rule_ref` may "
                "be the rule's id or its name."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "rule_ref": {"type": "string", "description": "The rule's id or name."},
                },
                "required": ["rule_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_disconnect_bank",
            "description": (
                "Propose disconnecting a whole bank connection (TrueLayer "
                "or Finexer), removing every account and transaction it "
                "brought in. `connection_or_account_ref` may be a "
                "connection id or the bank's display name (e.g. "
                "'Monzo'). This is destructive, irreversible from Penny, "
                "and only ever proposed when the user has clearly asked "
                "to disconnect or remove a specific bank."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_or_account_ref": {"type": "string", "description": "A connection id, or the bank's display name."},
                },
                "required": ["connection_or_account_ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_sync_now",
            "description": (
                "Propose refreshing every connected bank account now, "
                "pulling the latest transactions and balances. No "
                "parameters."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]

PROPOSE_TOOL_NAMES = frozenset(t["function"]["name"] for t in PROPOSE_TOOL_SCHEMAS)


def _tool_error(reason: str) -> dict:
    return {"error": reason}


# ── Executors ────────────────────────────────────────────────────────────────

async def _exec_get_safe_to_spend(uid: str) -> dict:
    try:
        sts = await compute_safe_to_spend(uid)
    except Exception as e:
        logger.exception("penny_tools: get_safe_to_spend failed for %s", uid)
        return _tool_error(f"safe-to-spend lookup failed: {e}")
    if sts.get("status") != "ok":
        return {"insufficient_data": True, "reason": "no account data connected yet"}
    return {
        "safe_to_spend": _money(sts.get("safe_to_spend")),
        "next_payday": sts.get("next_payday"),
        "days_until_payday": sts.get("days_until_payday"),
        "state": sts.get("state"),
        "short_reason": sts.get("short_reason"),
        "bills_total": _money(sts.get("bills_total")),
        "card_debt": _money(sts.get("card_debt")),
        "estimated": sts.get("estimated"),
    }


# Audit fix, 2026-08-26: a cache miss used to be treated as "no account
# data connected yet" outright, but GET /cashflow (analytics.py, the
# Planning page's own endpoint) never does that on a miss -- it computes
# LIVE via _compute_cashflow_patterns, stores the result, and returns
# real bills. A newly-connected user (synced, but no cache doc written
# yet) got a false refusal from Penny while Planning showed real bills
# for the same account. Mirrored here: compute live on miss, exactly the
# same three-line sequence the endpoint's own miss branch uses. Only a
# genuine "no accounts connected at all" is still insufficient_data,
# checked directly rather than inferred from cache presence. Shared by
# `get_upcoming_bills` and `get_recurring_payments` — both read the same
# cashflow-cache document, so the miss-handling only needs to live once.
async def _load_cashflow_cache(uid: str) -> dict | None:
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if cached:
        return cached
    has_accounts = bool(
        await accounts_col.find_one({"user_id": uid}, {"_id": 1})
        or await yapily_accounts_col.find_one({"user_id": uid}, {"_id": 1})
    )
    if not has_accounts:
        return None
    cached = await _compute_cashflow_patterns(uid)
    cached["computed_at"] = datetime.now()
    cached["patterns_version"] = PATTERNS_VERSION
    await cashflow_cache_col.update_one({"_id": uid}, {"$set": cached}, upsert=True)
    return cached


async def _exec_get_upcoming_bills(uid: str) -> dict:
    try:
        cached = await _load_cashflow_cache(uid)
        if cached is None:
            return {"insufficient_data": True, "reason": "no account data connected yet"}
        resp = await _build_cashflow_response(cached, uid=uid)
    except Exception as e:
        logger.exception("penny_tools: get_upcoming_bills failed for %s", uid)
        return _tool_error(f"upcoming bills lookup failed: {e}")
    bills = resp.get("upcoming_bills") or []
    income = resp.get("upcoming_income") or []
    return {
        "upcoming_bills": [
            {
                "name": b.get("name"),
                "amount": _money(b.get("amount")),
                "expected_date": b.get("expected_date"),
                "days_away": b.get("days_away"),
                "kind": b.get("kind"),
                # Enrichment pass, 2026-08-27: the engine already computes
                # these per occurrence (analytics.py's `_build_cashflow_response`
                # entries), the tool used to drop them on the floor.
                "account_name": b.get("account_name"),
                "account_bank": b.get("account_bank"),
                "account_balance": (
                    _money(b.get("account_balance")) if b.get("account_balance") is not None else None
                ),
                "pending": b.get("pending", False),
                "days_past_due": b.get("days_past_due", 0),
                "original_date": b.get("original_date"),
                "edited": b.get("edited", False),
                "rule_label": b.get("rule_label"),
                # Destination of a MOVEMENT-kind occurrence (self-transfer or
                # card repayment) -- None for every other bill. Passed through
                # verbatim from `_build_cashflow_response` so a caller (e.g.
                # penny_chips.py's home_payday_due) can name WHERE a movement
                # is going without a second engine call. See the doctrine on
                # `card_dest_account_id`/`dest_account_id` in analytics.py's
                # `_serialise_pattern` for why these are two separate pairs.
                "dest_account_name": b.get("dest_account_name"),
                "dest_account_bank": b.get("dest_account_bank"),
                "card_dest_account_name": b.get("card_dest_account_name"),
                "card_dest_account_bank": b.get("card_dest_account_bank"),
            }
            for b in bills[:10]
        ],
        "upcoming_income": [
            {
                "name": i.get("name"),
                "amount": _money(i.get("amount")),
                "expected_date": i.get("expected_date"),
                "days_away": i.get("days_away"),
                "account_name": i.get("account_name"),
                "account_bank": i.get("account_bank"),
                "edited": i.get("edited", False),
                "rule_label": i.get("rule_label"),
            }
            for i in income[:10]
        ],
    }


# ── get_recurring_payments ────────────────────────────────────────────────
_RECURRING_CAP = 15


def _cadence_label(avg_interval: float | None) -> str:
    """Human cadence label from a pattern's avg_interval (days) — the exact
    same weekly/fortnightly/monthly day-count bands `_detect_recurring`
    (app.routers.analytics, ~line 887) itself uses to pick a projection
    strategy, copied rather than re-derived, so this label can never
    describe a cadence the detector disagrees with. Not a financial figure:
    the amount/date themselves always come straight from the engine."""
    if avg_interval is None:
        return "irregular"
    if 6 <= avg_interval <= 10:
        return "weekly"
    if 11 <= avg_interval <= 18:
        return "fortnightly"
    if 26 <= avg_interval <= 35:
        return "monthly"
    return f"about every {round(avg_interval)} days"


async def _exec_get_recurring_payments(uid: str) -> dict:
    try:
        cached = await _load_cashflow_cache(uid)
        if cached is None:
            return {"insufficient_data": True, "reason": "no account data connected yet"}
        patterns = cached.get("recurring_spend") or []
        occ_by_name: dict[str, dict] = {}
        if patterns:
            # Pending/edited/days_past_due/rule_label only exist on the
            # OCCURRENCE-level dicts _build_cashflow_response resolves from
            # these patterns (the cached pattern itself only carries the
            # series-level avg_amount/avg_interval/next_date) — one extra
            # read of the same cache doc, not a second engine call.
            resp = await _build_cashflow_response(cached, uid=uid)
            for b in resp.get("upcoming_bills") or []:
                key = b.get("name")
                if key and key not in occ_by_name:
                    occ_by_name[key] = b
    except Exception as e:
        logger.exception("penny_tools: get_recurring_payments failed for %s", uid)
        return _tool_error(f"recurring payments lookup failed: {e}")
    if not patterns:
        return {"series": [], "count": 0}
    ranked = sorted(patterns, key=lambda r: -(r.get("avg_amount") or 0))
    series = []
    for p in ranked[:_RECURRING_CAP]:
        occ = occ_by_name.get(p.get("key")) or {}
        series.append({
            "name": p.get("key"),
            "cadence": occ.get("rule_label") or _cadence_label(p.get("avg_interval")),
            "typical_amount": _money(p.get("avg_amount")),
            "next_expected_date": p.get("next_date"),
            "account_name": p.get("account_name"),
            "account_bank": p.get("account_bank"),
            "kind": occ.get("kind"),
            "pending": occ.get("pending", False),
            "edited": occ.get("edited", False),
            "days_past_due": occ.get("days_past_due", 0),
        })
    result = {"series": series, "count": len(series)}
    capped = len(patterns) - len(series)
    if capped > 0:
        result["capped"] = capped
        logger.info("penny_tools: get_recurring_payments capped %d series for %s", capped, uid)
    return result


# Same five source collections GET /transactions/search gathers across —
# reused verbatim rather than a new hardcoded tuple, so a new source added to
# that endpoint is automatically picked up here too.
_SEARCH_COLLECTIONS = (
    transactions_col, yapily_transactions_col, statement_transactions_col,
    mono_transactions_col, mpesa_transactions_col,
)
_SEARCH_CAP = 20


async def _exec_search_transactions(
    uid: str, q: str | None, category: str | None, merchants: str | None,
    date_from: str | None, date_to: str | None, txn_type: str | None,
) -> dict:
    try:
        query = _search_query(uid, q, category, None, merchants, date_from, date_to, txn_type)
        per_collection = await asyncio.gather(*(
            c.find(query).sort("date", -1).limit(_SEARCH_CAP).to_list(_SEARCH_CAP)
            for c in _SEARCH_COLLECTIONS
        ))
        items = _merge_paginate(list(per_collection), 1, _SEARCH_CAP)
    except Exception as e:
        logger.exception("penny_tools: search_transactions failed for %s", uid)
        return _tool_error(f"transaction search failed: {e}")

    rows = []
    for d in items:
        tx = _doc_to_tx(d)
        raw_date = getattr(tx, "date", None)
        date_str = raw_date.isoformat() if isinstance(raw_date, (datetime, date)) else str(raw_date or "")
        rows.append({
            "id": tx.id,
            "date": date_str,
            "description": tx.merchant_name or tx.description,
            "amount": _money(tx.amount),
            "transaction_type": tx.transaction_type,
            "category": tx.category,
        })
    return {"transactions": rows, "count": len(rows)}


# ── Fuzzy name resolution, shared by every account/pot/trait/series
# resolver in this module (get_account_activity below, plus
# _resolve_account_for_propose/_resolve_mirror_trait/_resolve_recurring_key
# further down) ───────────────────────────────────────────────────────────
def _normalize_name_words(text: str) -> list[str]:
    """Lowercase, alphanumeric-only word split with a trailing-s strip
    (words over 3 characters only, so short words like 'vs'/'isa' are never
    mangled) — the plural/singular stem `_name_matches` below falls back
    to."""
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]


def _name_matches(needle: str, name: str) -> bool:
    """Fuzzy candidate match used by every account/pot/trait/series
    resolver in this module: exact case-insensitive substring first (the
    original, fast, exact-phrasing path), falling back to a word-level,
    plural/singular-tolerant match ONLY when that fails.

    Bug this fixes (2026-08-30): a Monzo pot literally named "Saving
    Challenge (2026)" was never findable by the ordinary way a user types
    it, "savings challenge" — the extra 's' meant the old plain substring
    check ('savings challenge' in 'saving challenge (2026)') never
    matched, so the only tool that could have resolved the pot came back
    empty and the whole question fell through to the generic refusal.
    Deliberately loose: every caller keeps its own >1-match 'ambiguous,
    never guess' safety net around this function, so a looser match here
    can only ever ADD a candidate to a clarifying question, never silently
    pick the wrong single account."""
    needle_l = (needle or "").strip().lower()
    name_l = (name or "").strip().lower()
    if not needle_l:
        return False
    if needle_l in name_l:
        return True
    needle_words = _normalize_name_words(needle_l)
    if not needle_words:
        return False
    name_words = set(_normalize_name_words(name_l))
    return all(w in name_words for w in needle_words)


# ── get_account_activity ─────────────────────────────────────────────────
_ACTIVITY_DAYS_DEFAULT = 30
_ACTIVITY_TOP_N = 5
_ACTIVITY_ACCOUNT_CAP = 15
_ACTIVITY_PROJ = {
    "amount": 1, "transaction_type": 1, "category": 1, "custom_category": 1,
    "merchant_name": 1, "description": 1, "currency": 1, "date": 1, "account_id": 1,
}


def _activity_date_str(d) -> str:
    return d.isoformat() if isinstance(d, (datetime, date)) else str(d or "")


async def _account_activity_rows(uid: str, account_id: str, start: datetime, end: datetime, home_currency: str) -> list[dict]:
    """Same multi-collection union `search_transactions` reads (see
    `_SEARCH_COLLECTIONS`), scoped to one account and home-currency filtered
    the same way `_category_txn_rows` filters below — reused, not
    reimplemented, so a per-account total can never disagree with a search
    over the same rows."""
    rows: list[dict] = []
    for col in _SEARCH_COLLECTIONS:
        async for doc in col.find(
            {"user_id": uid, "account_id": account_id, "date": {"$gte": start, "$lte": end}},
            _ACTIVITY_PROJ,
        ):
            txn_currency = doc.get("currency")
            if txn_currency and txn_currency != home_currency:
                continue
            rows.append(doc)
    return rows


def _summarise_account_activity(acc, rows: list[dict], kind_map) -> dict:
    """Server-side aggregation only — the model must never sum these rows
    itself. Money out is split spend vs movement using the same declared
    category kind (`app.services.categories.is_non_spend`) every other
    spend/movement split in this codebase already uses."""
    money_in = 0.0
    money_out_spend = 0.0
    money_out_movement = 0.0
    for d in rows:
        amt = abs(float(d.get("amount") or 0))
        ttype = d.get("transaction_type")
        if ttype == "credit":
            money_in += amt
        elif ttype == "debit":
            cat = d.get("custom_category") or d.get("category") or "Other"
            if is_non_spend(kind_map, cat):
                money_out_movement += amt
            else:
                money_out_spend += amt
    money_out = money_out_spend + money_out_movement
    top = sorted(rows, key=lambda d: abs(float(d.get("amount") or 0)), reverse=True)[:_ACTIVITY_TOP_N]

    def _row_to_txn(d: dict) -> dict:
        return {
            "id": str(d.get("_id")),
            "date": _activity_date_str(d.get("date")),
            "description": d.get("merchant_name") or d.get("description"),
            "amount": _money(d.get("amount"), decimals=2),
            "transaction_type": d.get("transaction_type"),
        }

    # first/last_transaction, independent of top_transactions (audit fix,
    # 2026-08-30): top_transactions is ranked by SIZE, so a "what was the
    # first/earliest transaction" question against a series whose amount
    # grows over time (the owner's own daily savings-challenge credits, 4p
    # more each day) would silently drop the earliest, smallest-amount row
    # once the window holds more than _ACTIVITY_TOP_N rows — the earliest
    # day is exactly the one most likely to be cut. Chronological, always
    # correct regardless of how many rows the window holds.
    by_date = sorted(rows, key=lambda d: d.get("date") or datetime.min)
    return {
        "account_id": acc.id,
        "name": acc.name,
        "balance": _money(acc.balance),
        "money_in": _money(money_in),
        "money_out": _money(money_out),
        "money_out_spend": _money(money_out_spend),
        "money_out_movement": _money(money_out_movement),
        "net": _money(money_in - money_out),
        "top_transactions": [_row_to_txn(d) for d in top],
        "first_transaction": _row_to_txn(by_date[0]) if by_date else None,
        "last_transaction": _row_to_txn(by_date[-1]) if by_date else None,
    }


async def _exec_get_account_activity(
    uid: str, account_id_or_name: str | None, days,
    date_from: str | None = None, date_to: str | None = None,
) -> dict:
    try:
        days = max(1, min(365, int(days or _ACTIVITY_DAYS_DEFAULT)))
    except (TypeError, ValueError):
        days = _ACTIVITY_DAYS_DEFAULT
    # date_from/date_to (audit fix, 2026-08-30): explicit bounds, same
    # convention search_transactions already uses via the shared
    # _parse_date_bound, so a "this period" question can be anchored to the
    # real pay-period start (get_spend_verdict's own period.start) instead
    # of the approximate, relative `days` window — a `days=30` default
    # window that happens to reach back past the current period's start
    # into the PREVIOUS period silently answered "first transaction this
    # period" with a transaction from before the period even began. Bounds
    # take priority over `days` when present, mirroring _search_query's own
    # documented precedence.
    from_dt = _parse_date_bound(date_from)
    to_dt = _parse_date_bound(date_to, end_of_day=True)
    try:
        from app.routers.accounts import get_accounts as _route_get_accounts
        accs = await _route_get_accounts(user={"email": uid})
    except Exception as e:
        logger.exception("penny_tools: get_account_activity failed for %s", uid)
        return _tool_error(f"accounts lookup failed: {e}")
    if not accs:
        return {"insufficient_data": True, "reason": "no accounts connected"}

    target = None
    if account_id_or_name:
        # Audit fix, 2026-08-27 (MEDIUM): an id match is always unambiguous
        # (ids are unique), so it's checked first and short-circuits the
        # name search entirely. A NAME match, however, used to silently
        # take the first substring hit — two accounts both named "Savings"
        # meant the model could be shown one account's activity while
        # believing it was looking at the other. Every matching account is
        # now collected; more than one match returns an explicit
        # `ambiguous` result (never guesses), naming each candidate's id so
        # the model can re-call with that id.
        target = next((a for a in accs if a.id == account_id_or_name), None)
        if target is None:
            name_matches = [a for a in accs if _name_matches(account_id_or_name, a.name)]
            if len(name_matches) > 1:
                return {
                    "ambiguous": True,
                    "matches": [
                        {
                            "id": a.id, "name": a.name, "provider": a.provider,
                            "balance_formatted": _money(a.balance)["formatted"],
                        }
                        for a in name_matches
                    ],
                }
            target = name_matches[0] if name_matches else None
        if target is None:
            return {
                "error": f"no account matching '{account_id_or_name}'",
                "available": [a.name for a in accs],
            }

    try:
        region = await get_user_region(uid)
        kind_map = await get_category_kinds(uid)
        home_currency = "KES" if region == "Kenya" else "GBP"
        end_dt = to_dt or datetime.now()
        start_dt = from_dt or (end_dt - timedelta(days=days))
        targets = [target] if target else accs[:_ACTIVITY_ACCOUNT_CAP]
        summaries = []
        for acc in targets:
            rows = await _account_activity_rows(uid, acc.id, start_dt, end_dt, home_currency)
            summaries.append(_summarise_account_activity(acc, rows, kind_map))
    except Exception as e:
        logger.exception("penny_tools: get_account_activity aggregation failed for %s", uid)
        return _tool_error(f"account activity lookup failed: {e}")

    # Echo the window actually queried (not just the input `days`) so the
    # model can see it explicitly used date_from/date_to rather than the
    # relative fallback, and can quote the real start date in its reply.
    window = {"from": start_dt.date().isoformat(), "to": end_dt.date().isoformat()}
    if target:
        result = summaries[0]
        result["days"] = days
        result["window"] = window
        return result
    result = {"accounts": summaries, "days": days, "window": window}
    capped = len(accs) - len(targets)
    if capped > 0:
        result["accounts_capped"] = capped
        logger.info("penny_tools: get_account_activity capped %d accounts for %s", capped, uid)
    return result


# ── account-kind classification — twin of frontend/lib/accountKind.ts ───────
# The backend Account model (app.core.models) never carries a "kind" field
# at all — "Current"/"Savings"/"Credit"/"Investment"/"Offline" is a purely
# frontend classification, substring-matched off type/subtype. Reimplemented
# here (TypeScript, so it could never be imported regardless) rather than
# left out, so a kind question here can never disagree with the Accounts
# page's own row.
def _account_kind(a) -> str:
    if getattr(a, "manual", False):
        return "Offline"
    type_ = (a.type or "").lower()
    sub = (a.subtype or "").lower()
    if "credit" in type_ or "credit" in sub:
        return "Credit"
    if any(s in sub for s in ("isa", "sipp", "pension", "invest", "stocks")):
        return "Investment"
    if "saving" in type_ or "saving" in sub:
        return "Savings"
    return "Current"


def _account_is_dormant(a, kind: str) -> bool:
    """Twin of accountKind.ts's isDormant: balance exactly £0, credit cards
    exempt (a £0 card usually means paid off, not unused)."""
    return (a.balance or 0) == 0 and kind != "Credit"


async def _exec_get_accounts(uid: str) -> dict:
    try:
        from app.routers.accounts import get_accounts as _route_get_accounts
        accs = await _route_get_accounts(user={"email": uid})
    except Exception as e:
        logger.exception("penny_tools: get_accounts failed for %s", uid)
        return _tool_error(f"accounts lookup failed: {e}")
    try:
        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        pinned_ids = {str(x) for x in (prefs.get("home_pinned_accounts") or [])}
    except Exception:
        logger.exception("penny_tools: get_accounts pin lookup failed for %s", uid)
        pinned_ids = set()
    try:
        last_synced = await last_bank_sync(uid)
    except Exception:
        logger.exception("penny_tools: get_accounts sync-freshness lookup failed for %s", uid)
        last_synced = None
    rows = []
    for a in accs:
        kind = _account_kind(a)
        rows.append({
            # Audit fix, 2026-08-27 (MEDIUM): exposed so the model can
            # address an account precisely with get_account_activity's
            # `account_id_or_name` when two accounts share a name (that
            # tool returns an explicit `ambiguous` result with each
            # candidate's id in exactly that case).
            "id": a.id,
            "name": a.name,
            "provider": a.provider,
            "type": a.type,
            "subtype": a.subtype,
            "balance": _money(a.balance),
            "kind": kind,
            "status": a.status,
            "dormant": _account_is_dormant(a, kind),
            "pinned": a.id in pinned_ids,
        })
    result = {"accounts": rows}
    if last_synced:
        result["last_synced"] = last_synced.isoformat()
    return result


# ── "Move" jargon translation — carried over from the deleted can_i.py
# spend-domain handler (owner-feedback fix, 2026-08). compose_reading's own
# consequence sentence (spend_verdict.py) says "Your move could be about £X
# bigger this payday" / "your payday move shrinks to about £X" — "move" is
# Spend-page vocabulary (the payday transfer, this product's core-loop
# needle) that has surrounding context THERE it doesn't have dropped into a
# chat reply; the owner himself didn't know what it meant. Applied here,
# inside the tool itself, rather than left to the loop's system prompt to
# work around per-question, so `reading` never reaches the model in the
# confusing form in the first place — same "tools return facts a person
# would actually understand" doctrine every other shaping in this module
# already follows.
_MOVE_PERMISSION_RE = re.compile(r"Your move could be about (£[\d,]+) bigger this payday\.")
_MOVE_SHRINK_RE = re.compile(r"If this holds, your payday move shrinks to about (£[\d,]+)\.")
_MOVE_NOTHING_SPARE = "If this holds, there may be nothing spare to move this payday."


def _translate_move_jargon(reading: str) -> str:
    """Rewrites the ONE jargon "move" sentence compose_reading can produce
    into a self-contained line; everything else in `reading` passes through
    untouched. If that wording ever drifts in spend_verdict.py, this simply
    stops matching and the original sentence passes through unchanged."""
    text = _MOVE_PERMISSION_RE.sub(
        lambda m: (
            f"You could put about {m.group(1)} more toward savings, cards "
            "or investments this payday than usual."
        ),
        reading,
    )
    text = _MOVE_SHRINK_RE.sub(
        lambda m: (
            f"Your regular payday transfer to savings, cards or investments "
            f"could shrink to about {m.group(1)} if this holds."
        ),
        text,
    )
    return text.replace(
        _MOVE_NOTHING_SPARE,
        "If this holds, there may be nothing spare for savings, cards or investments this payday.",
    )


_QUIET_FLAG_CAP = 10


async def _exec_get_spend_verdict(uid: str, period_offset: int) -> dict:
    off = max(-60, min(0, int(period_offset or 0)))
    try:
        verdict = await compute_spend_verdict(uid, offset=off)
    except Exception as e:
        logger.exception("penny_tools: get_spend_verdict failed for %s", uid)
        return _tool_error(f"spend verdict lookup failed: {e}")
    reading = verdict.get("reading")
    period = verdict.get("period") or {}
    unresolved = verdict.get("unresolved") or {}
    largest = unresolved.get("largest")
    all_quiet_flags = verdict.get("quiet_flags") or []
    result = {
        "period_offset": off,
        # Enrichment pass, 2026-08-27: `closed`/`days_left` already live on
        # this dict (pace.py's compute_category_signals builds `period`,
        # spend_verdict.py only forwards it) — the tool used to strip them.
        "period": {
            "start": period.get("start"),
            "end": period.get("end"),
            "days_elapsed": period.get("days_elapsed"),
            "days_left": period.get("days_left"),
            "closed": period.get("closed"),
        },
        "state": verdict.get("state"),
        "reading": _translate_move_jargon(reading) if reading else reading,
        "moved_total": _money(verdict.get("moved_total")),
        "unresolved_total": _money(verdict.get("unresolved_total")),
        "unresolved_material": verdict.get("unresolved_material"),
        # `unresolved` (the "Other" bucket) already carries a count, a
        # materiality weight and the largest unplaced payment — dropped
        # before, now surfaced (field renamed count/materiality per the
        # brief; the engine itself calls them payments_count/weight).
        "unresolved": {
            "count": unresolved.get("payments_count", 0),
            "materiality": unresolved.get("weight"),
            "ask_worthy": bool(unresolved.get("ask_worthy", False)),
            "largest": (
                {
                    "display_name": largest.get("display_name"),
                    "amount": _money(largest.get("amount")),
                    "date": largest.get("date"),
                }
                if largest else None
            ),
        },
        # Categories that qualified as "running hot" but overflowed the
        # 3-card notable cap — still real, just not given their own card.
        "quiet_flags": [
            {
                "category": q.get("category"),
                "spent": _money(q.get("spent")),
                "multiple": q.get("multiple"),
                "excess": _money(q.get("excess")),
            }
            for q in all_quiet_flags[:_QUIET_FLAG_CAP]
        ],
        "moved": [
            {
                "kind": m.get("kind"),
                "label": m.get("label"),
                "amount": _money(m.get("amount")),
                "payments_count": m.get("payments_count"),
            }
            for m in (verdict.get("moved") or [])
        ],
        "notables": [
            {
                "category": n.get("category"),
                "spent": _money(n.get("spent")),
                "multiple": n.get("multiple"),
                "cause": n.get("cause") or [],
                "consequence_line": (n.get("consequence_line") or {}).get("text"),
            }
            for n in (verdict.get("notables") or [])
        ],
    }
    capped = len(all_quiet_flags) - len(result["quiet_flags"])
    if capped > 0:
        result["quiet_flags_capped"] = capped
        logger.info("penny_tools: get_spend_verdict capped %d quiet flags for %s", capped, uid)
    return result


async def _exec_get_savings_position(uid: str) -> dict:
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        goal = await savings_goals_col.find_one({"_id": uid})
        monthly_income, monthly_spending, monthly_surplus = await _cashflow(uid, region, cutoff)
        current = await _current_savings(uid, goal)
        target = _target_amount(goal, monthly_spending)
    except Exception as e:
        logger.exception("penny_tools: get_savings_position failed for %s", uid)
        return _tool_error(f"savings lookup failed: {e}")
    if not goal and monthly_spending <= 0 and monthly_income <= 0:
        return {"insufficient_data": True, "reason": "not enough transaction history yet"}
    # Twin of app.routers.savings.savings_insights's own inline pct_funded
    # (savings.py line ~99) — that figure has never lived inside an engine
    # function, it's computed straight in the route so the Savings page can
    # show it, so there is no shared helper to import here. Kept identical
    # rather than restructured, so this tool can never drift from what the
    # Savings page itself displays.
    pct = round(min(100.0, current / target * 100), 1) if target > 0 else 0.0

    # Period gate — owner decision, 2026-08-30: "if I'm short and to say I
    # have money to stash away doesn't make sense." monthly_surplus above is
    # a 90-day smoothed median and can read positive while the CURRENT pay
    # period is short, so this tool must not hand the model an unconditional
    # "£X/month spare" fact. Reuses grow.py's own `_period_gate` derivation
    # against the same compute_safe_to_spend fact Home's Safe-to-Spend hero
    # and Grow's hero already read (never re-derived here — see this
    # module's own docstring on that rule); failure-tolerant, matching the
    # pattern every other reserve/lookup in this codebase uses.
    try:
        _sts = await compute_safe_to_spend(uid)
    except Exception:
        logger.exception("penny_tools: get_savings_position period-gate lookup failed for %s", uid)
        _sts = {"status": "insufficient_data"}
    _gate = _grow_period_gate(_sts)
    period_gate = {
        "short": _gate["short"],
        "to_cover": _money(_gate["to_cover"]),
        "period_end": _gate["period_end"],
    }
    if _gate["short"]:
        period_gate["note"] = (
            "The current pay period is short — do not tell the user "
            "monthly_surplus is spare to move or stash this payday, the "
            "period needs covering first."
        )

    return {
        "configured": bool(goal),
        "current_savings": _money(current),
        "target_amount": _money(target),
        "pct_funded": pct,
        "monthly_income": _money(monthly_income),
        "monthly_spending": _money(monthly_spending),
        "monthly_surplus": _money(monthly_surplus),
        "period_gate": period_gate,
    }


_DEBT_CARD_CAP = 10
_DEBT_ROUTE_CAP = 5


async def _exec_get_debt_position(uid: str) -> dict:
    try:
        plan = await get_debt_plan_cached(uid)
    except Exception as e:
        logger.exception("penny_tools: get_debt_position failed for %s", uid)
        return _tool_error(f"debt plan lookup failed: {e}")
    if plan.get("status") != "ok":
        return {"insufficient_data": True, "reason": "no credit-card accounts connected"}
    totals = plan.get("totals") or {}
    all_cards = plan.get("cards") or []
    cards = []
    for c in all_cards[:_DEBT_CARD_CAP]:
        movement = c.get("movement") or {}
        cards.append({
            "name": c.get("name"),
            "debt": _money(c.get("debt")),
            "payoff_month": c.get("payoff_month"),
            "monthly_interest_now": _money(c.get("monthly_interest_now")),
            "potential_monthly_interest": _money(c.get("potential_monthly_interest")),
            "classification": c.get("classification"),
            "classification_evidence": c.get("classification_evidence") or [],
            "usage": c.get("usage"),
            "usage_conflict": bool(c.get("usage_conflict", False)),
            "movement": {
                "monthly": (
                    _money(movement.get("monthly")) if movement.get("monthly") is not None else None
                ),
                "basis": movement.get("basis"),
                "periods_used": movement.get("periods_used"),
            },
            # Rate segments already computed by _compute_rate_schedule
            # (debt_plan.py): promo end dates + kind (purchases/balance
            # transfers) plus the standard rate once promos lapse.
            "rate_schedule": [
                {
                    "from": seg.get("from"),
                    "until": seg.get("until"),
                    "apr_pct": seg.get("apr_pct"),
                    "source": seg.get("source"),
                    "kind": seg.get("kind"),
                }
                for seg in (c.get("rate_schedule") or [])
            ],
        })
    scenario_b = plan.get("scenario_b") or {}
    extra_to_clear = plan.get("extra_to_clear")
    all_routes = plan.get("refinance_options") or []
    result = {
        "total_debt": _money(totals.get("debt")),
        "debt_free_month": totals.get("debt_free_month"),
        "monthly_interest_now": _money(totals.get("monthly_interest_now")),
        "potential_monthly_interest": _money(totals.get("potential_monthly_interest")),
        "verdict": totals.get("verdict"),
        "cards": cards,
        # Scenario B: same total demonstrated movement, dearest-card-first
        # (avalanche) instead of the as-is order — what it would save.
        "scenario_b": {
            "months_sooner": scenario_b.get("months_sooner"),
            "interest_saved": (
                _money(scenario_b.get("interest_saved"))
                if scenario_b.get("interest_saved") is not None else None
            ),
            "debt_free_month": scenario_b.get("debt_free_month"),
            "note": scenario_b.get("note"),
        },
    }
    if extra_to_clear:
        result["extra_to_clear"] = {
            "amount": _money(extra_to_clear.get("amount")),
            "debt_free_month": extra_to_clear.get("debt_free_month"),
            "horizon_months": extra_to_clear.get("horizon_months"),
        }
    if all_routes:
        result["transfer_routes"] = [
            {
                "source_name": r.get("source_name"),
                "destination_name": r.get("destination_name"),
                "transferable": _money(r.get("transferable")),
                "fee": _money(r.get("fee")),
                "interest_saved": _money(r.get("interest_saved")),
                "net_saving": _money(r.get("net_saving")),
                "window_months": r.get("window_months"),
                "break_even_weeks": r.get("break_even_weeks"),
            }
            for r in all_routes[:_DEBT_ROUTE_CAP]
        ]
    capped = len(all_cards) - len(cards)
    if capped > 0:
        result["cards_capped"] = capped
        logger.info("penny_tools: get_debt_position capped %d cards for %s", capped, uid)
    return result


_GOALS_CAP = 15


# Enrichment pass, 2026-08-27: this used to read commitments_col directly
# (name/amount/target_date only, active-only) — a twin of the deleted
# can_i.py ladder's own goals summary. `app.routers.commitments.
# list_commitments` is the SAME route the Planning page's Commitments block
# calls, and already computes every richer field (progress, feasibility,
# pace, funding pots) this tool used to drop; calling it directly (same
# pattern as `get_accounts`/`_route_get_accounts` below) means a goal here
# can never disagree with what the Commitments block itself shows for the
# same commitment.
async def _exec_get_goals(uid: str) -> dict:
    try:
        from app.routers.commitments import list_commitments as _route_list_commitments
        resp = await _route_list_commitments(user={"email": uid})
    except Exception as e:
        logger.exception("penny_tools: get_goals failed for %s", uid)
        return _tool_error(f"goals lookup failed: {e}")
    items = resp.get("items") or []
    goals = []
    for g in items[:_GOALS_CAP]:
        pace_note = g.get("pace_note") or {}
        goals.append({
            "name": g.get("name"),
            "status": g.get("status"),
            "amount": _money(g.get("amount")) if g.get("amount") is not None else None,
            "target_date": g.get("target_date"),
            "progress": _money(g.get("progress")) if g.get("progress") is not None else None,
            "per_period_slice": (
                _money(g.get("per_period_slice")) if g.get("per_period_slice") is not None else None
            ),
            "periods_left": g.get("periods_left"),
            "on_track": g.get("on_track"),
            "feasibility": g.get("feasibility"),
            "feasibility_note": g.get("feasibility_note"),
            "pace_note": pace_note.get("text"),
            "shared_pot_goals": g.get("shared_pot_goals") or [],
            "funding_pots": [
                {
                    "name": p.get("name"),
                    "contributing_balance": _money(p.get("contributing_balance")),
                    "count_existing": bool(p.get("count_existing")),
                }
                for p in (g.get("funding_pots") or [])
            ],
        })
    result = {"goals": goals}
    capped = len(items) - len(goals)
    if capped > 0:
        result["capped"] = capped
        logger.info("penny_tools: get_goals capped %d goals for %s", capped, uid)
    return result


# ── check_affordability ──────────────────────────────────────────────────
async def _exec_check_affordability(uid: str, amount, timeframe) -> dict:
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return _tool_error("amount must be a number")
    try:
        return await _check_affordability(uid, amount, timeframe)
    except Exception as e:
        logger.exception("penny_tools: check_affordability failed for %s", uid)
        return _tool_error(f"affordability check failed: {e}")


# ── get_category_spend ───────────────────────────────────────────────────
# Same two-collection, debit-only, custom_category-or-category resolution
# app.services.spend_verdict._load_period_txns and the deleted can_i.py
# category-history handler both already used, so a category total here can
# never disagree with what the Spend page itself shows for the same rows.
#
# Audit fix, 2026-08-26: this used to have no currency filter at all, while
# _load_period_txns (spend_verdict.py) drops any row whose `currency` isn't
# the user's home currency (a foreign-currency row, e.g. a KES M-Pesa line on
# a UK account, must never inflate a total beyond what the Spend page's own
# tiles show — that module's own docstring, "fix-round LOW finding"). Without
# the same filter here, `last_n_months`/`top_merchants` could disagree with
# `this_period` (which DOES go through the engine's filtered aggregate) for
# the exact same category — reusing the identical region-aware mechanism
# _load_period_txns uses, not a re-derived approximation of it.
async def _category_txn_rows(uid: str, category: str, start: datetime, end: datetime) -> list[dict]:
    region = await get_user_region(uid)
    home_currency = "KES" if region == "Kenya" else "GBP"
    rows: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        async for doc in col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": start, "$lte": end}},
            {"amount": 1, "category": 1, "custom_category": 1, "merchant_name": 1, "description": 1, "currency": 1},
        ):
            txn_currency = doc.get("currency")
            if txn_currency and txn_currency != home_currency:
                continue
            doc_category = doc.get("custom_category") or doc.get("category") or "Other"
            if doc_category == category:
                rows.append(doc)
    return rows


def _top_merchants(rows: list[dict], n: int = 3) -> list[dict]:
    totals: dict[str, float] = {}
    for d in rows:
        name = d.get("merchant_name") or d.get("description") or "Unknown"
        totals[name] = totals.get(name, 0.0) + abs(float(d.get("amount") or 0))
    ranked = sorted(totals.items(), key=lambda kv: -kv[1])[:n]
    return [{"merchant": name, "spent": _money(total)} for name, total in ranked]


async def _exec_get_category_spend(uid: str, category: str | None, months) -> dict:
    try:
        verdict = await compute_spend_verdict(uid, offset=0)
    except Exception as e:
        logger.exception("penny_tools: get_category_spend verdict lookup failed for %s", uid)
        return _tool_error(f"spend lookup failed: {e}")

    period = verdict.get("period") or {}
    # Current-period totals are ALWAYS read from the engine's own already-
    # computed per-category split (notables ∪ majority — the same two lists
    # the Spend page itself renders from), never re-summed from raw
    # transactions, per the brief: the model must never see a category total
    # this tool didn't already aggregate.
    rows = (verdict.get("notables") or []) + (verdict.get("majority") or [])
    by_cat = {r.get("category"): r for r in rows if r.get("category")}

    if not category:
        top = sorted(by_cat.values(), key=lambda r: -(r.get("spent") or 0))[:5]
        return {
            "period": {"start": period.get("start"), "end": period.get("end")},
            "top_categories": [
                {
                    "category": r["category"],
                    "spent": _money(r.get("spent")),
                    "payments_count": r.get("payments_count", 0),
                }
                for r in top
            ],
        }

    cur = by_cat.get(category)
    result: dict = {
        "category": category,
        "period": {"start": period.get("start"), "end": period.get("end")},
        "this_period": {
            "spent": _money((cur or {}).get("spent")),
            "payments_count": (cur or {}).get("payments_count", 0),
        },
    }

    # Raw-transaction window for merchant ranking and the optional last-N-
    # months total: the rolling months window when requested (it naturally
    # covers the current pay period too, at most ~31 days), else just the
    # current period's own bounds — one query, never two.
    today = date.today()
    try:
        if months:
            months = max(1, min(24, int(months)))
            start_d = today - timedelta(days=30 * months)
            end_d = today
        else:
            start_d = date.fromisoformat(period["start"]) if period.get("start") else today
            end_d = date.fromisoformat(period["end"]) if period.get("end") else today
        start_dt = datetime(start_d.year, start_d.month, start_d.day)
        end_dt = datetime(end_d.year, end_d.month, end_d.day, 23, 59, 59)
        rows_raw = await _category_txn_rows(uid, category, start_dt, end_dt)
    except Exception:
        logger.exception("penny_tools: get_category_spend raw lookup failed for %s", uid)
        rows_raw = []
        months = None

    if months:
        total = sum(abs(float(d.get("amount") or 0)) for d in rows_raw)
        result["last_n_months"] = {
            "months": months,
            "spent": _money(total),
            "payments_count": len(rows_raw),
        }

    result["top_merchants"] = _top_merchants(rows_raw, 3)
    return result


# ── get_insights ──────────────────────────────────────────────────────────
def _insights_rank_key(d: dict) -> tuple:
    """Byte-for-byte the same tie-break GET /savings-insights uses
    (savings_insights.py's own nested `_rank_key`, not importable — pinned,
    then verified, then the largest parsed £ estimate, then the largest
    triggering monthly spend) so "the best insight" here can never disagree
    with what the Insights page shows first."""
    from app.routers.analytics import _parse_saving_amount

    estimate = _parse_saving_amount(d.get("savings_estimate")) or 0.0
    spend = sum(float(t.get("monthly_amount") or 0) for t in d.get("triggered_by") or [])
    # `and not d.get("substituted_at")`: same precedence
    # `_derive_insight_state` resolves (incoherence A) — kept in lockstep
    # with GET /savings-insights' own `_rank_key`, see that function.
    is_verified = bool(d.get("verified_savings")) and not d.get("substituted_at")
    return (bool(d.get("pinned")), is_verified, estimate, spend)


_INSIGHT_TRIGGER_CAP = 5
_VALUE_DELIVERED_CAP = 10


def _fmt_insight_deadline(value) -> str | None:
    if isinstance(value, (datetime, date)):
        return value.isoformat() + "Z"
    return value


async def _exec_get_insights(uid: str) -> dict:
    try:
        # Evidence-gone retirement (savings_insights.py's `retired_at`) must
        # exclude a card from Penny's narration too, same as GET
        # /savings-insights — Penny reads this same collection directly, not
        # through that endpoint, so it needs its own exclusion.
        docs = await savings_insights_col.find(
            {"user_id": uid, "retired_at": {"$exists": False}}
        ).to_list(None)
    except Exception as e:
        logger.exception("penny_tools: get_insights failed for %s", uid)
        return _tool_error(f"insights lookup failed: {e}")
    result: dict = {"insights": []}
    if docs:
        docs.sort(key=_insights_rank_key, reverse=True)
        # Insights honesty review, Package C (and the 2026-09-01 cost-driven
        # reversal to weekly-push + a displayed TTL for every category —
        # see CATEGORY_LIFECYCLE / content_valid_until in
        # savings_insights.py): title/body/savings_estimate go through the
        # same freshness gate GET /savings-insights uses (_serialize_insight
        # nulls them once a category's `content_valid_until` has passed), so
        # Penny can never narrate a stale researched body the Insights page
        # itself would already be showing as a quiet, compact row.
        from app.routers.savings_insights import _serialize_insight
        result["insights"] = [
            {
                "rank": i + 1,
                "title": (s := _serialize_insight(d))["title"] or "",
                "summary": s["body"] or "",
                "estimated_saving": s["savings_estimate"],
                # Enrichment pass, 2026-08-27: why-fields the insights
                # engine already computes (savings_insights.py's own
                # serializer) that this tool used to drop.
                "triggered_by": [
                    {
                        "merchant": t.get("display_name"),
                        "monthly_amount": t.get("monthly_amount"),
                        "occurrences": t.get("occurrences"),
                    }
                    for t in (d.get("triggered_by") or [])[:_INSIGHT_TRIGGER_CAP]
                ],
                # Read off `s` (the serialized doc), not `d` (the raw one):
                # `_serialize_insight` resolves the verified-vs-substituted
                # precedence (see `_derive_insight_state` in
                # savings_insights.py) before these fields are ever set, so
                # Penny can't narrate a "verified saving" for a category the
                # engine actually resolved as `substituted` (incoherence A —
                # owner phone report 2026-09-01, confirmed live for exactly
                # this document shape: both `verified_savings` and
                # `substituted_at` set on the same raw doc).
                "verified_savings": (
                    _money(s["verified_savings"]) if s["verified_savings"] else None
                ),
                "verified_merchant": s["verified_merchant"],
                # STRUCTURAL FIX — the same single-source state every other
                # consumer now switches on (see `_derive_insight_state`):
                # "verified" | "substituted" | "fresh" | "quiet". Lets Penny
                # distinguish a real win from a substitution ("that spend
                # just moved elsewhere, not a saving") instead of only ever
                # seeing a raw £ figure.
                "state": s["state"],
                "substituted": s["substituted"],
                "substituted_merchant": s["substituted_merchant"],
                "deadline_at": _fmt_insight_deadline(d.get("deadline_at")),
                "is_new": bool(d.get("is_new", False)),
                # Stored with a leading underscore (`_return_reason`), served
                # without one — same mapping GET /savings-insights uses.
                "return_reason": d.get("_return_reason"),
            }
            for i, d in enumerate(docs[:5])
        ]
    try:
        from app.routers.analytics import get_value_delivered as _route_get_value_delivered
        vd = await _route_get_value_delivered(user={"email": uid})
        result["value_delivered"] = {
            "insights_acted_on": vd.get("insights_acted_on"),
            "total_monthly_saving": _money(vd.get("total_monthly_saving")),
            "verified_monthly_saving": _money(vd.get("verified_monthly_saving")),
            "breakdown": [
                {
                    "title": b.get("title"),
                    "monthly_saving": _money(b.get("monthly_saving")),
                    "estimate_label": b.get("estimate_label"),
                }
                for b in (vd.get("breakdown") or [])[:_VALUE_DELIVERED_CAP]
            ],
        }
    except Exception:
        logger.exception("penny_tools: get_insights value-delivered lookup failed for %s", uid)
    return result


# ── get_today_brief ───────────────────────────────────────────────────────
# Backs onto app.services.companion.compute_today_items — the exact engine
# behind GET /today. Every field name below is quoted straight from that
# function's own dict construction (companion.py), never guessed: `move`
# items carry `plan_dest{account_id,name,provider,balance,needs_total,
# needs_by,bills[],is_overdraft}`, per-leg `moves[].move_map.from{name,
# balance,safe_note}`, `covered`, `sources_safe`, `assumed_incomes`, and
# optionally `residual`/`income_note`/`overflow_note`; `payday_plan` items
# carry `total`/`trimmed`/`covered`/`salary{name,amount,stays}`/`dests[]`.
def _shape_plan_dest(dest: dict | None) -> dict | None:
    if not dest:
        return None
    return {
        "name": dest.get("name"),
        "balance": _money(dest.get("balance")),
        "needs_total": _money(dest.get("needs_total")),
        "needs_by": dest.get("needs_by"),
        "bills": [
            {"label": b.get("label"), "amount": _money(b.get("amount"))}
            for b in (dest.get("bills") or [])
        ],
        "is_overdraft": bool(dest.get("is_overdraft", False)),
    }


def _shape_leg_account(acc: dict | None) -> dict | None:
    if not acc:
        return None
    return {"name": acc.get("name"), "balance": _money(acc.get("balance"))}


def _shape_payday_plan(item: dict) -> dict:
    salary = item.get("salary") or {}
    return {
        "total": _money(item.get("total")),
        "trimmed": bool(item.get("trimmed")),
        "covered": item.get("covered"),
        "preview": bool(item.get("preview")),
        "salary": {
            "name": salary.get("name"),
            "amount": _money(salary.get("amount")),
            "stays": _money(salary.get("stays")),
        },
        "dests": [
            {
                "name": d.get("name"),
                "bills_total": _money(d.get("bills_total")),
                "bill_count": d.get("bill_count"),
                "spend_typical": _money(d.get("spend_typical")),
                "buffer": _money(d.get("buffer")),
                "move": _money(d.get("move")),
                "usual": _money(d.get("usual")) if d.get("usual") is not None else None,
            }
            for d in (item.get("dests") or [])
        ],
    }


def _shape_action(action: dict | None) -> dict | None:
    if not action:
        return None
    return {"label": action.get("label"), "route": action.get("route")}


def _shape_companion_item(item: dict) -> dict:
    shaped: dict = {
        "id": item.get("id"),
        "type": item.get("type"),
        "headline": item.get("headline"),
        "body": item.get("body"),
        "estimated": bool(item.get("estimated", False)),
    }
    action = _shape_action(item.get("action"))
    if action:
        shaped["action"] = action
    secondary = _shape_action(item.get("secondary_action"))
    if secondary:
        shaped["secondary_action"] = secondary

    t = item.get("type")
    if t == "move":
        # Uncovered "move" items (no funding source found) carry only the
        # base fields above (action: None is the distinguishing signal) —
        # `plan_dest`/`moves`/`covered`/`sources_safe` are genuinely absent
        # on that variant, not stripped by this shaping.
        if item.get("plan_dest") is not None:
            shaped["plan_dest"] = _shape_plan_dest(item.get("plan_dest"))
            shaped["moves"] = [
                {
                    "amount": _money(m.get("amount")),
                    "from": _shape_leg_account((m.get("move_map") or {}).get("from")),
                }
                for m in (item.get("moves") or [])
            ]
            shaped["covered"] = item.get("covered")
            shaped["amount"] = _money(item.get("amount"))
            shaped["sources_safe"] = item.get("sources_safe")
            if item.get("residual") is not None:
                shaped["residual"] = item["residual"]
            if item.get("income_note") is not None:
                shaped["income_note"] = item["income_note"]
            if item.get("overflow_note") is not None:
                shaped["overflow_note"] = item["overflow_note"]
    elif t == "payday_plan":
        shaped.update(_shape_payday_plan(item))
    return shaped


async def _exec_get_today_brief(uid: str) -> dict:
    # Audit finding, 2026-08-27 (HIGH): compute_today_items is NOT a
    # zero-side-effect read -- besides the item-state upserts on
    # companion_items_col, it stamps two ONE-TIME "burn" markers
    # (celebrated_at on a savings_insights_col doc, last_streak_celebrated
    # on behaviour_portrait_col) the instant a celebration is computed, so
    # the REAL Home page never shows the same celebration twice. Calling it
    # with the default persist=True from here would let a user asking
    # "what's Penny suggesting today" BEFORE ever opening Home silently
    # consume a one-time surprise they never actually saw, or start a
    # dismiss/7-day-hide window ticking with nothing rendered. persist=False
    # (both calls below) skips every write in that call chain while still
    # computing and returning the same in-memory items, so this tool stays
    # genuinely read-only -- see the module docstring's no-new-write-type
    # claim, which this preserves rather than adds an exception to.
    try:
        items = await compute_today_items(uid, payday_preview=False, persist=False)
    except Exception as e:
        logger.exception("penny_tools: get_today_brief failed for %s", uid)
        return _tool_error(f"today brief lookup failed: {e}")

    live_payday = next((i for i in items if i.get("type") == "payday_plan"), None)
    payday_plan = _shape_payday_plan(live_payday) if live_payday else None
    if payday_plan is None:
        # Not currently in the payday window — the same `?payday_preview=1`
        # path PaydayPlanCard's teaser calls on tap ("live or previewable"
        # per the brief), never persisted, never suppresses the move cards.
        try:
            preview_items = await compute_today_items(uid, payday_preview=True, persist=False)
            preview_payday = next((i for i in preview_items if i.get("type") == "payday_plan"), None)
            if preview_payday:
                payday_plan = _shape_payday_plan(preview_payday)
        except Exception:
            logger.exception("penny_tools: get_today_brief payday preview failed for %s", uid)

    if not items and payday_plan is None:
        return {"insufficient_data": True, "reason": "no cashflow data yet"}

    result: dict = {"items": [_shape_companion_item(i) for i in items]}
    if payday_plan is not None:
        result["payday_plan"] = payday_plan
    return result


# ── get_mirror ────────────────────────────────────────────────────────────
# Backs onto app.services.behaviour.compute_portrait (the engine behind
# GET /mirror) plus app.services.checkpoints.list_active (the engine behind
# GET /checkpoints). Deliberately does NOT replicate the router's own
# behaviour_portrait_col write-back (see the module docstring): the user's
# already-persisted keep/change choice is merged onto a fresh in-memory
# compute instead, so this tool introduces no new write of its own.
async def _exec_get_mirror(uid: str) -> dict:
    try:
        cached = await behaviour_portrait_col.find_one({"_id": uid})
        fresh_cache_hit = None
        if cached:
            computed_at = cached.get("computed_at")
            if computed_at:
                try:
                    ca = datetime.fromisoformat(str(computed_at).replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) - ca < timedelta(days=7):
                        fresh_cache_hit = cached
                except Exception:
                    fresh_cache_hit = None
        portrait = fresh_cache_hit or await _compute_portrait(uid)
        if fresh_cache_hit is None and portrait.get("status") == "ok" and cached:
            old_choices = {t["id"]: t.get("choice") for t in cached.get("traits", [])}
            for trait in portrait["traits"]:
                if trait["id"] in old_choices and old_choices[trait["id"]]:
                    trait["choice"] = old_choices[trait["id"]]
    except Exception as e:
        logger.exception("penny_tools: get_mirror failed for %s", uid)
        return _tool_error(f"mirror lookup failed: {e}")

    if portrait.get("status") != "ok":
        return {"insufficient_data": True, "reason": "not enough transaction history yet (needs 60+ days)"}

    try:
        aims = await _list_active_checkpoints(uid)
    except Exception:
        logger.exception("penny_tools: get_mirror aims lookup failed for %s", uid)
        aims = []

    return {
        "computed_at": portrait.get("computed_at"),
        "window_days": portrait.get("window_days"),
        "traits": [
            {
                "id": t.get("id"),
                "title": t.get("title"),
                "narrative": t.get("narrative"),
                "evidence": t.get("evidence") or [],
                "kind": t.get("kind"),
                "choice": t.get("choice"),
            }
            for t in (portrait.get("traits") or [])
        ],
        "active_aims": [
            {
                "category": a.get("ref"),
                "aim_amount": _money(a.get("aim_amount")),
                "spent_so_far": _money(a.get("spent_so_far")),
                "days_left": a.get("days_left"),
                "on_track": a.get("on_track"),
            }
            for a in aims
        ],
    }


# ── get_page_explainer ───────────────────────────────────────────────────
# Fixed per-screen copy, moved VERBATIM from the deleted can_i.py
# `_PAGE_EXPLAINER_COPY` (owner-approved shape: 2-4 calm sentences, no
# em-dash, every future-looking claim hedged, deliberately no personal
# figures — this describes what the PAGE shows, the page itself is where the
# user's own numbers already live).
_PAGE_EXPLAINER_COPY: dict[str, str] = {
    "home": (
        "This is your Home brief. It leads with your Safe to Spend verdict, "
        "worked out from your live account balances and what's still due "
        "before payday. The figure updates as new transactions come in, so "
        "it reflects where things stand right now, not a forecast."
    ),
    "spend": (
        "This is Spend. It shows what you've spent this pay period, broken "
        "down by category and compared with your own usual pace. Money "
        "moved to savings, cards or investments doesn't count as spending, "
        "so it's kept out of these figures."
    ),
    "planning": (
        "This is Planning. It lays out what's coming before your next "
        "payday, upcoming bills and expected income, and the runway that "
        "leaves you. Anything that hasn't happened yet is an expectation "
        "based on your own patterns, never a certainty."
    ),
    "insights": (
        "These are Insights. They're spotlights generated from your own "
        "transactions, things like a bill that's crept up in price or a "
        "pattern worth knowing about. This page also holds your Tax and "
        "Receipts tabs alongside the spending spotlights."
    ),
    "tax": (
        "This is Tax. It works from figures you've told it about your "
        "income and allowances, not your bank feed, so it's only as "
        "accurate as what you've entered. You can also ask general UK tax "
        "questions here."
    ),
    "grow": (
        "This is Grow. It sets out a priority ladder for spare money, "
        "essentials first, then a buffer, then pension, then investing, "
        "with any debt repayments accounted for ahead of all of it. It's a "
        "general order to consider, not a fixed instruction."
    ),
    "debt": (
        "This is your Debt page. It separates what you carry on cards from "
        "month to month from spending you clear in full, and tracks the "
        "pace you're clearing the carried balance at. It also flags 0% "
        "deals so you can see when a promotional rate might be worth "
        "watching."
    ),
    "accounts": (
        "This is Accounts. It lists every account you've connected through "
        "open banking with its live balance, alongside any manual or "
        "investment accounts you've added yourself. You can pin the ones "
        "you use most to Home, and accounts you rarely touch collapse out "
        "of the way to keep the list manageable. Investments and ISAs "
        "update from statements you upload, not a live bank feed."
    ),
}

# Moved verbatim from can_i.py's own `_ISA_CAPABILITY_REPLY` — verified
# against the actual code before writing it (owner instruction: never invent
# a capability the app doesn't have). See that deleted constant's own
# comment history for how it was checked against investments.py/pdf.py.
_ISA_CAPABILITY_REPLY = (
    "Investment ISAs cannot be connected through open banking the way "
    "current accounts are, so live automatic tracking isn't available for "
    "them. You can still keep one on your Accounts page though, use Add, "
    "then Investment, to upload your ISA provider's statement and it sets "
    "the balance from that document. Upload a fresh statement whenever you "
    "want the figure to catch up."
)

# Moved verbatim from can_i.py's own `_SAVE_INVEST_REPLY` — general
# information only, no personal figures, framed explicitly so the model
# never recommends either option.
_SAVE_INVEST_REPLY = (
    "This is general information, not a personal recommendation. Savings "
    "kept as cash, in an account or a cash ISA, stay accessible and are "
    "protected up to the FSCS limit, which suits money you might need "
    "before too long. Investing means buying assets such as funds or "
    "shares in the hope of growing them over a longer period, but values "
    "can fall as well as rise and your capital is at risk. As a general "
    "principle, money you may need soon is usually kept accessible, and "
    "money you won't touch for years is where growth potential matters "
    "more, though the right balance is a personal decision, not one I'll "
    "make for you."
)

# Moved verbatim from can_i.py's own `_CATEGORISATION_EXPLAINER_REPLY` —
# drawn from ENGINE.md's own doctrine (The Engine Owns It Rule, The Two
# Inputs Rule, the miscategorised guardrail / review-transfers flow).
_CATEGORISATION_EXPLAINER_REPLY = (
    "Categorising your transactions isn't something you manage, the engine "
    "does it for you automatically. Deterministic rules place most "
    "transactions straight away, and trickier merchant names get more "
    "careful judgement so they land in the right place. Transfers between "
    "your own accounts are detected and kept out of your spending, so "
    "moving money to savings or cards never counts as a purchase. If "
    "something looks wrong, rename or recategorise it and the engine "
    "remembers your correction for next time, and suspected own-transfers "
    "sitting in a spending category also show up in the review-transfers "
    "flow so you can fix those there too."
)

_TOPIC_COPY: dict[str, str] = {
    "isa_capability": _ISA_CAPABILITY_REPLY,
    "saving_vs_investing": _SAVE_INVEST_REPLY,
    "categorisation": _CATEGORISATION_EXPLAINER_REPLY,
}

# ── explain(topic) — terms registry ──────────────────────────────────────
# Every entry below is derived from the actual backend/frontend code, not
# invented (owner instruction, 2026-08-27 catalog expansion). Grounded
# against: app/services/spend_verdict.py, app/services/categories.py,
# app/services/debt_plan.py, app/services/checkpoints.py,
# app/routers/analytics.py (compute_safe_to_spend, commitments reserve,
# card-growth reserve), frontend/lib/accountKind.ts (isDormant), app/
# services/pace.py (thin_history/usual pace), app/services/pay_period.py,
# frontend/app/planning/PlanningPage.tsx (atRiskWalks/conservative-
# optimistic red-amber doctrine), app/services/manual_account_rules.py
# (Offset/Shadow sign), app/services/companion.py (dismiss_item) and
# frontend/lib/homeDismissedAdvice.ts (7-day local hide).
_TERMS_COPY: dict[str, str] = {
    "moved": (
        "Moved and spent are different things. Spending is money that "
        "leaves for someone else, a shop, a biller, a person. Moved is "
        "money that goes to another account you own, savings, credit "
        "cards, investments, or a plain transfer between your own "
        "accounts, and none of it counts as spending because nothing left "
        "your household. The engine tells these apart from the category a "
        "transaction lands in: Savings, Investment, Debt and Transfer are "
        "all treated as movement, everything else is spend."
    ),
    "carried_vs_float": (
        "On a credit card, float is a balance you pay off in full each "
        "statement, so it's floating rather than costing you anything, "
        "classified cleared_monthly. Carried is everything else, a "
        "balance sitting on a 0% deal (carried_zero), one that's actually "
        "charging interest (carried_interest), or one the engine can't "
        "yet classify confidently (unclear). The split is evidence-based, "
        "whether interest charges are actually appearing and whether "
        "payments match prior spending, never just the balance you happen "
        "to be looking at today."
    ),
    "aim": (
        "An aim, also called a checkpoint, is a spending limit you set "
        "for one category for the rest of the current pay period, never "
        "something the app proposes on its own, you always start it "
        "yourself. Its progress is real, drawn from the same transactions "
        "your Spend page counts, and it resolves automatically once the "
        "period closes, either met or missed, based on what actually "
        "happened. Cancelling an aim just stops tracking it, it doesn't "
        "undo anything you've already spent."
    ),
    "reserved": (
        "Reserved money is notional, not physically moved. Two things get "
        "reserved before your Safe to Spend figure is worked out: the "
        "per-period slice for any active commitment you've set up, and "
        "any credit-card growth this period that hasn't been paid off "
        "yet, so spending you're quietly funding on a card doesn't get "
        "counted as spare cash. Neither reservation transfers a penny "
        "anywhere, they're simply subtracted from the figure so it "
        "doesn't hand out permission the money isn't really free to use."
    ),
    "dormant": (
        "An account is marked dormant when its balance is exactly £0 and "
        "it isn't a credit card. Credit cards are deliberately exempt, a "
        "card sitting at £0 usually just means it was paid off, not that "
        "it's unused, so it stays out of the dormant bucket. A dormant "
        "account still counts toward your net worth, it's just tucked "
        "out of the way since you're unlikely to be checking it often."
    ),
    "unplaced": (
        "Other isn't really a spending category, it's the engine's "
        "honest way of saying it hasn't confidently placed a payment yet, "
        "so it's kept out of your usual-pace comparisons and never given "
        "a baseline or a multiple the way a real category would be. It's "
        "still counted in your Out total though, since the money did "
        "leave your account, it's just labelled as still being worked "
        "out. A payment lands here when its merchant name is unfamiliar "
        "or ambiguous, telling Penny what it was helps place it and any "
        "future payments like it."
    ),
    "usual_pace": (
        "Your usual pace is a learned daily baseline for how you "
        "typically spend in a category, built from your own transaction "
        "history. It needs at least two full closed pay periods of "
        "history before the app trusts it enough to compare against, "
        "before that it says it's still learning rather than guessing. "
        "Once there's a baseline, spending gets compared to a shaped "
        "curve for where you'd typically be by this point in the period, "
        "not a straight daily average."
    ),
    "one_off_vs_new_normal": (
        "When a category runs hot, you can tell Penny whether that was a "
        "one-off or your new normal. Either answer stops it asking again "
        "about that same spike this period. Marking it your new normal "
        "is meant to signal a lasting change, though today that answer "
        "is stored rather than used to recalculate your usual baseline, "
        "so don't expect the comparison figure itself to move "
        "immediately."
    ),
    "demonstrated_movement": (
        "Demonstrated movement is how fast a card balance is coming down "
        "in practice, not a promise or a scheduled payment. It's worked "
        "out from at least two of your own closed pay periods, taking "
        "the median of payments in minus spending out each period and "
        "converting that to a monthly figure. If there isn't enough "
        "closed-period history yet, movement is left unknown rather than "
        "guessed, and the projection assumes flat."
    ),
    "buffer": (
        "A buffer is a cash safety-net target, normally three months of "
        "your typical spending unless you've set a fixed amount "
        "yourself. It's separate from the smaller day-to-day buffer used "
        "inside Safe to Spend, which is a flat number you set yourself "
        "rather than a savings target, so the word means slightly "
        "different things depending which screen you're on."
    ),
    "pay_period": (
        "A pay period is the window the app measures everything against. "
        "By default it's simply the calendar month, but you can set it "
        "to your actual payday, a fortnightly cycle, or the last weekday "
        "of the month instead. Whichever you choose drives the runway "
        "figure, the payday divider, and when your spending comparisons "
        "reset, it's a personal setting, not something the app infers "
        "from your bank feed."
    ),
    "red_amber_doctrine": (
        "Red is reserved for a genuine shortfall, an account that's "
        "still short even under the more generous of two ways of "
        "ordering the day's money in and money out. Amber means timing "
        "risk, the account would be fine if the money lands before the "
        "bill leaves, but there's a real chance it doesn't. Only a "
        "shortfall that survives both orderings ever earns red, so red "
        "always means the money due in wouldn't have saved it either "
        "way."
    ),
    "offset_shadow": (
        "Offset and Shadow are the two ways an offline account rule can "
        "mirror a real transaction. Offset posts the opposite sign, "
        "useful when a payment on a real account should reduce a balance "
        "you're tracking manually. Shadow posts the same sign instead, "
        "mirroring the transaction as-is. Which one you want depends on "
        "what the offline account represents."
    ),
    "pinned_dismissal": (
        "There are two separate ways a card can stop showing. Dismissing "
        "it is permanent and server-side, it's recorded against your "
        "account and Penny still keeps a record of it. Hiding a card "
        "locally on Home is different and temporary, it comes back "
        "automatically after 7 days, and never affects whether Penny "
        "remembers it. Pinning is unrelated to either, that's a "
        "separate, deliberate choice to keep an account visible on Home, "
        "capped at 3 accounts at a time."
    ),
}
# "checkpoint" is the same concept as "aim", named both ways in the app.
_TERMS_COPY["checkpoint"] = _TERMS_COPY["aim"]

# ── explain(topic) — numbers registry ────────────────────────────────────
# Each entry states what the figure includes/excludes and ends with which
# sibling figure it will disagree with and why (per the brief). Grounded
# against app/routers/analytics.py (compute_safe_to_spend), frontend/app/
# planning/PlanningPage.tsx (runway, isPooledNoOp), app/routers/grow.py +
# app/routers/savings.py (_cashflow), app/services/spend_verdict.py (Out,
# majority header, moved_total), frontend/components/SpendTrends.tsx
# (Over Time's Transfer-only exclusion), app/services/scenario.py
# (_build_cash_block, the what-if simulator's month-end cash).
_NUMBERS_COPY: dict[str, str] = {
    "safe_to_spend_free": (
        "Safe to Spend's FREE figure is the money that's genuinely yours "
        "to spend before payday. It starts from the lowest point your "
        "spendable balance is projected to hit between now and payday "
        "(after bills and expected income), then subtracts your buffer, "
        "any reserved commitment slices, and any unpaid credit-card "
        "growth this period. NOW minus BILLS doesn't equal FREE because "
        "FREE also walks the whole period rather than just today, and "
        "subtracts the buffer and both reserves on top, so it will "
        "usually read lower than a simple subtraction."
    ),
    "planning_runway": (
        "Planning's runway is what's spendable right now minus the bills "
        "still due before your next payday. It deliberately excludes "
        "pooled no-op transfers, money moving between two of your own "
        "spendable accounts nets to nothing for this total, so it "
        "doesn't shrink the runway for a transfer that isn't really "
        "costing you anything. It differs from Safe to Spend's FREE "
        "figure because runway doesn't subtract your buffer or reserved "
        "commitment slices, those only apply to FREE."
    ),
    "grow_surplus_monthly": (
        "Grow's monthly surplus is your typical monthly income minus "
        "your typical everyday spending minus your committed debt "
        "repayments. It excludes money moved to savings, cards or "
        "investments, since it's working out how much room is left to "
        "allocate down the ladder, not spend. It will usually read "
        "differently to Spend's In minus Out for a period, since Spend "
        "is scoped to one pay period's real transactions while "
        "surplus_monthly is a smoothed typical month averaged from your "
        "own history."
    ),
    "spend_out": (
        "Spend's Out figure is your engine-reconciled real spending for "
        "the period. It excludes anything classified as movement "
        "(Savings, Investment, Debt, Transfer categories) and includes "
        "Other, the still-unplaced payments, since that money did leave "
        "your account even though it hasn't been filed yet. It's the "
        "authoritative total: notables, the majority list and Other "
        "together always add up to exactly Out."
    ),
    "spend_majority_header": (
        "The majority section's header total is the sum of everything "
        "in that list only, it deliberately excludes the notable cards "
        "above it (categories running hot enough to earn their own card) "
        "and excludes Other entirely. That's why it never equals Out: "
        "Out is notables plus majority plus Other added together, the "
        "majority header is only the middle piece."
    ),
    "over_time_chart": (
        "The Over Time chart excludes only transactions literally "
        "categorised as Transfer, it does not exclude Savings, "
        "Investment or Debt spending the way Out does. That means it can "
        "include genuine savings or debt payments Out treats as "
        "movement, so its totals over a longer window won't match Out "
        "for the same period, it's answering a different question, what "
        "left your accounts at all, not what counts as spending."
    ),
    "month_end_cash": (
        "Month-end cash is a what-if scenario projection: your current "
        "typical monthly surplus plus whatever change the scenario "
        "you're testing adds, carried forward month by month. It's a "
        "hypothetical, not a live account balance or a promise, and it's "
        "built from the same surplus formula Grow uses (income minus "
        "everyday spending minus debt repayments), so it moves in step "
        "with Grow's surplus_monthly rather than with your actual bank "
        "balance."
    ),
    "moved_total": (
        "Moved total is the sum of everything sent to your pots, credit "
        "cards, investments, and plain transfers between your own "
        "accounts this period. It's shown separately from Out because "
        "none of it is spending, though it can look large next to a "
        "smaller change in your actual savings balance if some of it is "
        "just shuffling between your own accounts rather than genuinely "
        "new saving."
    ),
}

# ── explain(topic) — actions registry ────────────────────────────────────
# How-to walkthroughs, grounded against the actual sheets/components:
# UpcomingEditSheet, PlannedEditSheet, PlanOneOffSheet, CommitmentSheet,
# AimSheet, TeachingSheet, MiscategorisedReviewSheet, HomeBrief's
# AskPaydayCard, PayPeriodSettingsSheet, AccountsPage's reconnect/pin/add
# flows, CardTermsSheet.
_ACTIONS_COPY: dict[str, str] = {
    "change_bill": (
        "Tap a bill or income row on Planning to open its edit sheet. "
        "You can change the date or amount, and choose whether the "
        "change applies to just this one occurrence or to every future "
        "one until a real payment replaces the prediction. If the row "
        "has a repeating schedule set, you can also edit or clear that "
        "schedule from the same sheet. None of this touches the actual "
        "direct debit at your bank, it only changes what Penny predicts."
    ),
    "stop_prediction": (
        "Swipe a bill or income row left on Planning and choose Not "
        "recurring, also reachable inside the edit sheet as 'Not a "
        "bill'/'Not income'. This only stops Penny predicting future "
        "occurrences of it, it does not cancel the real subscription or "
        "payment at your bank, you'd still need to do that with the "
        "provider directly."
    ),
    "skip_occurrence": (
        "Inside a bill's edit sheet on Planning there's a separate "
        "'Skip this month' action, bills only. Unlike Not recurring, "
        "this drops just the one upcoming occurrence and leaves the "
        "rest of the recurring series and future predictions untouched."
    ),
    "set_cancel_aim": (
        "Set an aim from a trait card on the Mirror page (choosing "
        "'This isn't me, change it' on a category-backed trait offers to "
        "set one), or from the Set an aim link on a hot category card on "
        "Spend. Aims run to the end of the current pay period. Cancel "
        "one from its progress line, either on Mirror under 'What you're "
        "working on' or on the Spend category card, cancelling just "
        "stops tracking it."
    ),
    "recategorise_and_rule": (
        "Tap any transaction to open its recategorise sheet. Pick a "
        "category, or 'This was money I moved' if it's actually a "
        "transfer, and if the same merchant has matched past payments "
        "you'll be offered 'Always file X as Y', which also rewrites "
        "those past payments and catches future ones automatically. "
        "Choosing 'Just this once' recategorises only that one "
        "transaction."
    ),
    "review_transfers": (
        "Open Review transfers from the banner on Spend, or from "
        "Penny's 'Review transfers' chip. It lists transactions that "
        "look like your own money moving between accounts but landed in "
        "a spending category, overstating your spending. Confirm a "
        "same-transfer pairing, or recategorise a flagged series "
        "directly from the sheet."
    ),
    "confirm_payday": (
        "When Penny asks 'Is this your payday?' on Home, tap 'Yes, "
        "that's it' to confirm the detected date and amount, or 'No, "
        "set it myself' to set your pay period boundaries manually "
        "instead."
    ),
    "set_pay_period": (
        "Open Pay period settings from the period dropdown on Spend's "
        "header. Choose calendar month, your actual monthly pay date, "
        "every two weeks, or the last weekday of the month, whichever "
        "matches how you're actually paid. This changes when your "
        "spending comparisons and runway reset."
    ),
    "reconnect_bank": (
        "An expired bank connection shows a Reconnect button, both in "
        "the account's own detail view and in the 'Needs reconnecting' "
        "section on Accounts. Tapping it takes you back through your "
        "bank's login to refresh access, it doesn't create a duplicate "
        "account, it reconnects the same one."
    ),
    "add_card_rates": (
        "Open a credit card's detail view on Accounts and tap 'Add "
        "rates' (or the existing rate pill to update it). You'll be "
        "asked for the card's standard rate and any 0% deals currently "
        "on it, including which balance they cover and when they end. "
        "This is what lets the debt plan work out real interest and "
        "payoff dates instead of assuming a rate."
    ),
    "pin_account": (
        "Tap the star on an account's detail view to pin it to Home, up "
        "to 3 accounts at a time. A pinned account can still drop out of "
        "the pinned band on its own if it becomes dormant or its "
        "connection expires, it'll show in that section instead until "
        "it's active again."
    ),
    "add_offline_account": (
        "Use Add, then Offline, on Accounts to track a balance the app "
        "can't connect to directly, cash, a store card, an account at a "
        "bank you haven't linked. You give it a name, a starting "
        "balance, and a type, then update the balance yourself whenever "
        "it changes, there's no automatic sync for it."
    ),
    "plan_oneoff_vs_commitment": (
        "Use '+ Plan a one-off' on Planning for a single dated payment "
        "from one account, it just adds a bill to your projection. Use "
        "'+ Plan a big expense' for a commitment, a goal you're saving "
        "toward over several pay periods, optionally funded from savings "
        "pots, which reserves a slice of your money each period and "
        "tracks progress toward the target."
    ),
}

# ── explain(topic) — money-basics registry ───────────────────────────────
# The 19 curated UK personal-finance explainers that used to rotate on the
# retired "Money basics" Home card (app/content/money_basics.py), now
# grounding here instead so the education arrives when asked rather than on
# a fixed rotation. Built from MONEY_BASICS by import, never copy-pasted, so
# the two can never drift apart. Keyed by each card's own `id` exactly as
# written there (hyphenated, unlike the underscored keys elsewhere in this
# file) since `_exec_explain` lowercases the lookup key but does not
# normalise separators.
_BASICS_COPY: dict[str, str] = {
    c["id"]: (
        f"{c['title']}. {c['body']} {c['takeaway']} "
        f"(UK {_BASICS_TAX_YEAR} figures, general information, not "
        "financial advice.)"
    )
    for c in MONEY_BASICS
}

_ALL_EXPLAIN_COPY: dict[str, str] = {
    **_PAGE_EXPLAINER_COPY, **_TOPIC_COPY,
    **_TERMS_COPY, **_NUMBERS_COPY, **_ACTIONS_COPY, **_BASICS_COPY,
}


async def _exec_explain(topic: str | None) -> dict:
    key = (topic or "").strip().lower()
    text = _ALL_EXPLAIN_COPY.get(key)
    if not text:
        return {"error": f"no explanation for '{key}'", "available_topics": sorted(_ALL_EXPLAIN_COPY.keys())}
    return {"topic": key, "text": text}


# ── get_tax_position ─────────────────────────────────────────────────────
# Audit fix, 2026-08-26: the deleted can_i.py tax-routing branch always
# called chat.answer_tax_question, which injects the user's OWN figures
# (income, pension, adjusted net income, personal allowance remaining, Child
# Benefit) from preferences_col. The loop's system prompt only ever carried
# GENERAL tax mechanics, so a "how much personal allowance do I have left"
# question lost its real, personal answer entirely. `build_tax_fact_pack`
# (app.routers.chat) is the SAME arithmetic `answer_tax_question` itself
# still uses, extracted so this tool and that function can never drift apart
# on the same user's own figures.
async def _exec_get_tax_position(uid: str) -> dict:
    try:
        fact_pack = await build_tax_fact_pack(uid)
    except Exception as e:
        logger.exception("penny_tools: get_tax_position failed for %s", uid)
        return _tool_error(f"tax position lookup failed: {e}")
    if not fact_pack.get("income_known"):
        return {
            "insufficient_data": True,
            "reason": "exact income not entered in preferences yet",
            "income_bracket": fact_pack.get("income_bracket") or None,
        }
    return {
        "tax_year": "2026/27",
        "income": _money(fact_pack["income"]),
        "pension_contributions_this_year": _money(fact_pack["pension_annual"]),
        "adjusted_net_income": _money(fact_pack["adjusted_net_income"]),
        "personal_allowance_remaining": _money(fact_pack["personal_allowance_remaining"]),
        "personal_allowance_line": fact_pack["allowance_line"],
        "has_child_benefit": fact_pack["has_child_benefit"],
    }


# ── get_fill_candidates ───────────────────────────────────────────────────
async def _exec_get_fill_candidates(uid: str, account_id_or_name: str | None) -> dict:
    resolved = await _resolve_account_for_propose(uid, account_id_or_name)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    account = resolved.get("account")
    if account is None:
        return _tool_error("account_id_or_name required")
    try:
        from app.routers.allocations import fill_candidates as _route_fill_candidates
        resp = await _route_fill_candidates(account_id=account.id, user={"email": uid})
    except HTTPException as e:
        return _tool_error(str(e.detail))
    except Exception as e:
        logger.exception("penny_tools: get_fill_candidates failed for %s", uid)
        return _tool_error(f"fill candidates lookup failed: {e}")
    items = resp.get("items") or []
    return {
        "account_id": account.id,
        "account_name": account.name,
        "candidates": [
            {
                "display_name": c.get("display_name"),
                "last_amount": _money(c.get("last_amount")),
                "last_date": c.get("last_date"),
                "occurrences_90d": c.get("occurrences_90d"),
            }
            for c in items[:15]
        ],
    }


# ── calculate ──────────────────────────────────────────────────────────────
# Owner-approved 2026-08-30 (see PENNY_TOOLS.md's `calculate` row and
# app.services.safe_calc's own module docstring for the full whitelist and
# bounds). A read-tier tool: no side effects, no consent gate, always
# offered. The expression is echoed back on every outcome (success or
# rejection) so a reply or a propose-tool's consequence line can show its
# working ("£8.96 first payment plus 4p a day for 27 days comes to
# £258.66") without having to reconstruct the expression from memory.
async def _exec_calculate(uid: str, expression: str | None) -> dict:
    outcome = _safe_calc_evaluate(expression or "")
    return {
        "expression": expression,
        "ok": outcome["ok"],
        "result": outcome["result"],
        "error": outcome["error"],
    }


# ── Penny Agent Mode v1 — propose-only write tools ───────────────────────
#
# ANTI-INJECTION RULE, followed by every `_exec_propose_*` function below:
# every account/series/trait parameter the model supplies must resolve to an
# entity that EXISTS and is OWNED by the calling user, via the SAME lookups
# the read tools already use (`get_accounts`'s account list,
# `get_recurring_payments`'s series, `get_mirror`'s traits) — never a raw id
# the model invented and never trusted as-is. Ambiguity (a name matching more
# than one candidate) always returns `{"ambiguous": True, "matches": [...]}`
# instead of a proposal, exactly the same shape `get_account_activity`
# already uses for the same situation, so the model asks a clarifying
# question rather than guessing. This is entity-existence-and-ownership
# hardening only; deeper injection hardening (verifying a param traces back
# to something the USER actually said earlier in the conversation, not just
# something that exists) is a flagged follow-up, not built here — see
# PENNY_TOOLS.md's "Write tools (propose-only)" section.
_PROPOSAL_TTL_MINUTES = 15


async def _create_proposal(
    uid: str, kind: str, params: dict, summary: str, consequence: str, *, destructive: bool = False,
) -> dict:
    """The ONE place a proposal doc is built. Never mutates real user data —
    inserts a row into penny_proposals_col only. `_id` is a uuid4 string
    (not an ObjectId) so the id is directly usable in a URL path with no
    encoding step. See app.routers.can_i's POST /penny/proposals/{id}/execute
    for the only code path that ever turns this into a real write.

    `destructive` (B16, 2026-09-08): flags a proposal whose action removes
    data irreversibly from Penny's own reach (deleting an offline account,
    disconnecting a bank connection) rather than merely changing a figure.
    Defaults False for every existing kind; only
    `_exec_propose_delete_offline_account` and `_exec_propose_disconnect_bank`
    pass True. No frontend styling hook consumes this yet (checked,
    2026-09-08 — PennyConversation.tsx's proposal card has none), it's
    carried on the stored doc and returned dict so one can be added without
    a second migration of every past proposal shape."""
    now = datetime.now()
    doc = {
        "_id": str(uuid.uuid4()),
        "user_id": uid,
        "kind": kind,
        "params": params,
        "summary": summary,
        "consequence": consequence,
        "destructive": destructive,
        "created_at": now,
        "expires_at": now + timedelta(minutes=_PROPOSAL_TTL_MINUTES),
        "executed_at": None,
        "result": None,
        "cancelled_at": None,
    }
    await penny_proposals_col.insert_one(doc)
    return {
        "proposal": True,
        "proposal_id": doc["_id"],
        "kind": kind,
        "summary": summary,
        "consequence": consequence,
        "params": params,
        "destructive": destructive,
    }


async def revoke_agent_consent(uid: str) -> dict:
    """The ONE place Penny's agent mode is actually turned off for `uid` —
    shared by app.routers.can_i's DELETE /penny/agent-consent (Settings'
    "Turn off" control) and app.services.penny_agent's deterministic
    "stop setting things up" phrase match, so both paths do the exact same
    thing rather than one of them drifting into a partial revoke. Lives
    here (not in can_i.py, where the original revoke endpoint was) so
    penny_agent.py — which can_i.py imports FROM — can call it without a
    circular import; penny_agent.py already imports this module for the
    propose-tool schemas and dispatch.

    Two effects, in the same call: (1) clears `penny_agent_consent` back to
    falsy, exactly as before — app.services.penny_agent reads this live on
    every call, so the very next question excludes the propose-tool
    schemas again; execute_proposal also re-checks consent at EXECUTE time,
    so nothing already-built can slip through after this fires. (2) cancels
    every one of the user's still-pending proposals (never executed, never
    already cancelled) in the same stroke — a proposal sitting unactioned
    in its 15-minute window represents an action the user is no longer
    trusting Penny to take, revoking consent should mean exactly that,
    not "revoke consent AND separately still let this one specific
    envelope/goal/APR-change go through if I happen to tap Confirm before
    it expires." Confirmed/executed proposals are historical record and are
    left untouched — there's nothing left to cancel about a write that
    already happened.

    Idempotent — revoking when already not consented, with nothing
    pending, just confirms the off state: `proposals_cancelled` is 0."""
    now = datetime.now()
    await preferences_col.update_one(
        {"user_id": uid}, {"$set": {"penny_agent_consent": None, "user_id": uid}}, upsert=True,
    )
    result = await penny_proposals_col.update_many(
        {"user_id": uid, "executed_at": None, "cancelled_at": None},
        {"$set": {"cancelled_at": now}},
    )
    cancelled = getattr(result, "modified_count", 0) or 0
    return {"penny_agent_consent": None, "proposals_cancelled": cancelled}


async def _resolve_account_for_propose(uid: str, account_id_or_name: str | None) -> dict:
    """Same id-or-name resolution `get_account_activity` already uses,
    reused here (not reimplemented) for every write tool that takes an
    account: id match short-circuits (ids are unique, always unambiguous),
    then a case-insensitive substring name match, more than one hit returns
    `{"ambiguous": True, "matches": [...]}` rather than guessing.
    `{"account": None}` (not an error) when `account_id_or_name` was empty —
    some callers (propose_add_planned) allow an unassigned account."""
    if not account_id_or_name or not str(account_id_or_name).strip():
        return {"account": None}
    from app.routers.accounts import get_accounts as _route_get_accounts
    accs = await _route_get_accounts(user={"email": uid})
    target = next((a for a in accs if a.id == account_id_or_name), None)
    if target is None:
        matches = [a for a in accs if _name_matches(account_id_or_name, a.name)]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [{"id": a.id, "name": a.name, "provider": a.provider} for a in matches],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no account matching '{account_id_or_name}'", "available": [a.name for a in accs]}
    return {"account": target}


async def _resolve_mirror_trait(uid: str, trait_id_or_title: str) -> dict:
    """Resolves against the SAME data get_mirror reads (`_exec_get_mirror`),
    never a raw id the model invented. Exact id match short-circuits; a
    case-insensitive substring match against each trait's title otherwise, an
    ambiguous title returns every candidate to disambiguate from."""
    mirror = await _exec_get_mirror(uid)
    if mirror.get("error"):
        return {"error": mirror["error"]}
    if mirror.get("insufficient_data"):
        return {"error": mirror.get("reason") or "not enough transaction history yet"}
    traits = mirror.get("traits") or []
    exact = next((t for t in traits if t.get("id") == trait_id_or_title), None)
    if exact:
        return {"trait": exact}
    matches = [t for t in traits if _name_matches(trait_id_or_title, t.get("title"))]
    if len(matches) > 1:
        return {"ambiguous": True, "matches": [{"id": t["id"], "title": t["title"]} for t in matches]}
    if len(matches) == 1:
        return {"trait": matches[0]}
    return {
        "error": f"no trait matching '{trait_id_or_title}'",
        "available": [{"id": t["id"], "title": t["title"]} for t in traits],
    }


async def _resolve_recurring_key(uid: str, key_or_name: str, *, dismissed: bool) -> dict:
    """`dismissed=False` resolves against the user's currently ACTIVE
    recurring series (`get_recurring_payments`'s own data — a series already
    dismissed isn't a candidate to dismiss again); `dismissed=True` resolves
    against the user's currently DISMISSED series (`GET /dismissed-series`'s
    own "user" rows — a series that was never dismissed isn't a candidate to
    restore). Same exact-then-substring, ambiguous-returns-matches pattern as
    every other resolver in this section."""
    if dismissed:
        try:
            from app.routers.analytics import dismissed_series as _route_dismissed_series
            resp = await _route_dismissed_series(user={"email": uid})
        except Exception as e:
            return {"error": f"dismissed series lookup failed: {e}"}
        candidates = [
            {"key": r["key"], "name": r.get("display_name") or r["key"]}
            for r in (resp.get("user") or [])
        ]
    else:
        recurring = await _exec_get_recurring_payments(uid)
        if recurring.get("error"):
            return {"error": recurring["error"]}
        candidates = [{"key": s["name"], "name": s["name"]} for s in (recurring.get("series") or [])]
    if not candidates:
        return {"error": f"no {'dismissed' if dismissed else 'recurring'} series matching '{key_or_name}'", "available": []}
    exact = next((c for c in candidates if c["key"] == key_or_name), None)
    if exact:
        return {"key": exact["key"]}
    matches = [c for c in candidates if _name_matches(key_or_name, c["name"])]
    if len(matches) > 1:
        return {"ambiguous": True, "matches": [{"key": m["key"], "name": m["name"]} for m in matches]}
    if len(matches) == 1:
        return {"key": matches[0]["key"]}
    return {
        "error": f"no {'dismissed' if dismissed else 'recurring'} series matching '{key_or_name}'",
        "available": [c["name"] for c in candidates],
    }


# ── B14 (B12 stage 1) resolvers — edit/delete twins for the covered
# creates ────────────────────────────────────────────────────────────────
# Same doctrine as every resolver above: id short-circuits, otherwise
# case-insensitive (then word-level) name match against the SAME list the
# app's own screen reads, ambiguous returns candidates rather than
# guessing. Each of these lists the user's OWN records only (the router
# list functions are already user-scoped by `user_id`), so this is also
# the ownership check.
async def _resolve_planned_for_propose(uid: str, planned_ref: str) -> dict:
    """Resolves against GET /planned's own list (active planned one-offs
    only, matching what PlannedEditSheet and the Planning page itself show
    — a `status != "planned"` row, e.g. already matched to a transaction,
    is not a candidate here)."""
    from app.routers.planned import list_planned_expenses as _route_list_planned

    items = await _route_list_planned(user={"email": uid})
    if not items:
        return {"error": f"no planned expense matching '{planned_ref}'", "available": []}
    target = next((p for p in items if p["id"] == planned_ref), None)
    if target is None:
        matches = [p for p in items if _name_matches(planned_ref, p["name"])]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [
                    {"id": p["id"], "name": p["name"], "amount": _money(p["amount"]), "date": p["date"]}
                    for p in matches
                ],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no planned expense matching '{planned_ref}'", "available": [p["name"] for p in items]}
    return {"planned": target}


async def _resolve_allocation_for_propose(uid: str, allocation_ref: str) -> dict:
    """Resolves against GET /allocations' own list, active AND paused (a
    paused allocation is still a legitimate target to rename, resume, or
    delete)."""
    from app.routers.allocations import list_allocations as _route_list_allocations

    resp = await _route_list_allocations(user={"email": uid})
    items = resp.get("items") or []
    if not items:
        return {"error": f"no allocation matching '{allocation_ref}'", "available": []}
    target = next((a for a in items if a["id"] == allocation_ref), None)
    if target is None:
        matches = [a for a in items if _name_matches(allocation_ref, a.get("name") or "")]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [
                    {"id": a["id"], "name": a["name"], "amount_per_period": _money(a["amount_per_period"])}
                    for a in matches
                ],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no allocation matching '{allocation_ref}'", "available": [a["name"] for a in items]}
    return {"allocation": target}


async def _resolve_commitment_for_propose(uid: str, commitment_ref: str) -> dict:
    """Resolves against GET /commitments' own list (non-cancelled plans —
    the same set list_commitments itself returns; an already-cancelled
    commitment is not a candidate to edit or cancel again)."""
    from app.routers.commitments import list_commitments as _route_list_commitments

    resp = await _route_list_commitments(user={"email": uid})
    items = resp.get("items") or []
    if not items:
        return {"error": f"no commitment matching '{commitment_ref}'", "available": []}
    target = next((c for c in items if c["id"] == commitment_ref), None)
    if target is None:
        matches = [c for c in items if _name_matches(commitment_ref, c.get("name") or "")]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [{"id": c["id"], "name": c["name"], "amount": _money(c.get("amount"))} for c in matches],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no commitment matching '{commitment_ref}'", "available": [c["name"] for c in items]}
    return {"commitment": target}


async def _resolve_checkpoint_for_propose(uid: str, checkpoint_ref: str) -> dict:
    """Resolves against the user's own active aims (`list_active`, the
    same data GET /checkpoints and get_mirror both read) by id or by `ref`
    (the category name the aim is set on, e.g. 'Groceries')."""
    items = await _list_active_checkpoints(uid)
    if not items:
        return {"error": f"no active aim matching '{checkpoint_ref}'", "available": []}
    target = next((c for c in items if c["id"] == checkpoint_ref), None)
    if target is None:
        matches = [c for c in items if _name_matches(checkpoint_ref, c.get("ref") or "")]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [{"id": c["id"], "ref": c["ref"], "aim_amount": _money(c.get("aim_amount"))} for c in matches],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no active aim matching '{checkpoint_ref}'", "available": [c["ref"] for c in items]}
    return {"checkpoint": target}


async def _find_occurrence_detail(uid: str, key: str, date_str: str) -> dict | None:
    """Best-effort lookup of ONE upcoming-bill occurrence's current
    display fields (name/amount) for a nicer proposal summary. Never
    required for a skip/edit/clear-override proposal to be valid — the
    routers themselves perform no existence check either (they upsert an
    override doc for key+date unconditionally) — so a miss here (a
    further-future occurrence outside the projection window, or one
    already past) just falls back to a plainer summary, never blocks the
    proposal."""
    try:
        cached = await _load_cashflow_cache(uid)
        if cached is None:
            return None
        resp = await _build_cashflow_response(cached, uid=uid)
    except Exception:
        return None
    for b in resp.get("upcoming_bills") or []:
        if b.get("name") == key and (b.get("expected_date") == date_str or b.get("original_date") == date_str):
            return b
    return None


def _last4(account_number: str | None) -> str | None:
    """Only ever the trailing 4 characters of the stored account_number
    field, never the full value — this module's other resolvers never
    expose account_number at all (get_accounts' own doctrine: "never
    returns credentials, account numbers or sort codes", since some
    connections store it unmasked, see app.services.finexer_sync). A
    trailing-4 mask can never route a payment on its own; it exists purely
    so a human can tell two identically-named cards apart when
    propose_set_card_apr's resolver returns an ambiguous match, mirroring
    how the app's own card UI already shows a masked number."""
    digits = re.sub(r"[^0-9A-Za-z]", "", str(account_number or ""))
    return digits[-4:] if len(digits) >= 4 else None


def _card_candidate_summary(a) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "bank": a.provider,
        "balance_formatted": _money(a.balance)["formatted"],
        "last4": _last4(getattr(a, "account_number", None)),
    }


async def _resolve_credit_card_for_propose(uid: str, card_ref: str) -> dict:
    """Resolves card_ref to ONE owned CREDIT-CARD account, scoped the same
    way `_account_kind` already classifies "Credit" for get_accounts'
    own `kind` field (so the model's understanding of "which of my
    accounts are cards" from a prior get_accounts call always agrees with
    what this resolver will accept) — never a bank/savings account. Same
    id-short-circuit, then fuzzy exact-then-substring name match,
    ambiguous-returns-matches pattern every other resolver in this module
    follows (`_name_matches`), matched against "<name> <provider>" so a
    bank-qualified ref ('the natwest mastercard') narrows correctly. Every
    ambiguous match carries balance + last-4 (`_card_candidate_summary`)
    so a human can tell apart two identically-named cards — the owner
    holds two accounts both literally named 'MASTERCARD' at NatWest."""
    from app.routers.accounts import get_accounts as _route_get_accounts

    accs = await _route_get_accounts(user={"email": uid})
    cards = [a for a in accs if _account_kind(a) == "Credit"]
    if not cards:
        return {"error": "no credit-card accounts connected"}

    def _match_text(a) -> str:
        return f"{a.name} {a.provider or ''}".strip()

    target = next((a for a in cards if a.id == card_ref), None)
    if target is None:
        matches = [a for a in cards if _name_matches(card_ref, _match_text(a))]
        if len(matches) > 1:
            return {"ambiguous": True, "matches": [_card_candidate_summary(a) for a in matches]}
        target = matches[0] if matches else None
    if target is None:
        return {
            "error": f"no credit card matching '{card_ref}'",
            "available": [_match_text(a) for a in cards],
        }
    return {"account": target}


async def _exec_propose_mirror_choice(uid: str, trait_id, choice) -> dict:
    choice = str(choice or "").strip().lower()
    if choice not in ("keep", "change"):
        return _tool_error("choice must be 'keep' or 'change'")
    if not trait_id or not str(trait_id).strip():
        return _tool_error("trait_id required")
    resolved = await _resolve_mirror_trait(uid, str(trait_id))
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    trait = resolved["trait"]
    verb = "keep it as-is" if choice == "keep" else "flag it as something to change"
    summary = f"Record '{trait['title']}' as: {verb}"
    consequence = "This only records your choice on the Mirror, nothing else about your data changes."
    params = {"trait_id": trait["id"], "choice": choice}
    return await _create_proposal(uid, "mirror_choice", params, summary, consequence)


async def _exec_propose_dismiss_recurring(uid: str, key) -> dict:
    key = str(key or "").strip()
    if not key:
        return _tool_error("key required")
    resolved = await _resolve_recurring_key(uid, key, dismissed=False)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    resolved_key = resolved["key"]
    summary = f"Mark '{resolved_key}' as not a bill"
    consequence = f"'{resolved_key}' stops appearing in your upcoming bills and predictions."
    params = {"key": resolved_key}
    return await _create_proposal(uid, "dismiss_recurring", params, summary, consequence)


async def _exec_propose_restore_recurring(uid: str, key) -> dict:
    key = str(key or "").strip()
    if not key:
        return _tool_error("key required")
    resolved = await _resolve_recurring_key(uid, key, dismissed=True)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    resolved_key = resolved["key"]
    summary = f"Restore '{resolved_key}' to predictions"
    consequence = f"'{resolved_key}' returns to your upcoming bills and predictions."
    params = {"key": resolved_key}
    return await _create_proposal(uid, "restore_recurring", params, summary, consequence)


async def _exec_propose_add_planned(uid: str, name, amount, date_str, account_id) -> dict:
    name = str(name or "").strip()
    if not name:
        return _tool_error("name is required and must not be blank")
    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return _tool_error("amount must be a positive number")
    try:
        expense_date = date.fromisoformat(str(date_str))
    except (TypeError, ValueError):
        return _tool_error("date must be an ISO date string (YYYY-MM-DD)")
    if expense_date < date.today():
        return _tool_error("date must be today or in the future")
    resolved_account = await _resolve_account_for_propose(uid, account_id)
    if resolved_account.get("ambiguous"):
        return resolved_account
    if resolved_account.get("error"):
        return _tool_error(resolved_account["error"])
    account = resolved_account.get("account")

    amount_fmt = _money(amount)["formatted"]
    summary = f"Plan '{name}' for {amount_fmt} on {expense_date.isoformat()}"
    consequence = "Reduces what's shown as spendable from that date onward."
    params = {
        "name": name,
        "amount": round(amount, 2),
        "date": expense_date.isoformat(),
        "account_id": account.id if account else None,
    }
    return await _create_proposal(uid, "add_planned", params, summary, consequence)


async def _exec_propose_create_allocation(
    uid: str, name, amount_per_period, fill_account_id, match_type, match_value,
    recurrence, effective_from=None,
) -> dict:
    # Owner instruction: import allocations.py's own validators rather than
    # re-implementing them, so a proposal can never accept something the
    # real POST /allocations endpoint would itself reject.
    from app.routers.allocations import (
        _account_owned as _alloc_account_owned,
        _conflicts as _alloc_conflicts,
        _pay_cfg as _alloc_pay_cfg,
        _validate_amount as _alloc_validate_amount,
        _validate_display_name as _alloc_validate_display_name,
        _validate_effective_from as _alloc_validate_effective_from,
        _validate_match_type as _alloc_validate_match_type,
        _validate_match_value as _alloc_validate_match_value,
        _validate_name as _alloc_validate_name,
        _validate_recurrence as _alloc_validate_recurrence,
    )
    from app.services.pay_period import get_pay_period_for_date

    try:
        name = _alloc_validate_name(name)
        amount = _alloc_validate_amount(amount_per_period)
        match_type = _alloc_validate_match_type(match_type)
        match_value = _alloc_validate_match_value(match_value)
        fill_display_name = _alloc_validate_display_name(None, match_value)
        recurrence = _alloc_validate_recurrence(recurrence)
    except HTTPException as e:
        return _tool_error(str(e.detail))

    resolved_account = await _resolve_account_for_propose(uid, fill_account_id)
    if resolved_account.get("ambiguous"):
        return resolved_account
    if resolved_account.get("error"):
        return _tool_error(resolved_account["error"])
    account = resolved_account.get("account")
    if account is None:
        return _tool_error("fill_account_id required")
    if not await _alloc_account_owned(uid, account.id):
        return _tool_error("fill account not found")
    if await _alloc_conflicts(uid, account.id, match_type, match_value):
        return _tool_error("an active allocation already fills from this payment")

    cfg = await _alloc_pay_cfg(uid)
    start, _end = get_pay_period_for_date(date.today(), cfg)
    try:
        eff_from = _alloc_validate_effective_from(effective_from, start)
    except HTTPException as e:
        return _tool_error(str(e.detail))

    amount_fmt = _money(amount)["formatted"]
    summary = f"Create allocation '{name}' for {amount_fmt} per period from {account.name}"
    consequence = (
        f"Reduces safe to spend by about {amount_fmt} this period, "
        "less anything already paid in."
    )
    params = {
        "name": name,
        "amount_per_period": amount,
        "fill_account_id": account.id,
        "match_type": match_type,
        "match_value": match_value,
        "fill_display_name": fill_display_name,
        "recurrence": recurrence,
        "effective_from": eff_from.isoformat(),
    }
    return await _create_proposal(uid, "create_allocation", params, summary, consequence)


async def _exec_propose_create_commitment(uid: str, name, amount, target_date, funding_pots=None) -> dict:
    # Owner instruction: mirror createCommitment, and reuse previewCommitment's
    # own feasibility maths for the consequence line rather than re-deriving it.
    from app.routers.commitments import (
        _validate_amount as _cm_validate_amount,
        _validate_name as _cm_validate_name,
        _validate_target_date as _cm_validate_target_date,
        preview_commitment as _route_preview_commitment,
    )

    try:
        name = _cm_validate_name(name)
        amount = _cm_validate_amount(amount)
        target_date = _cm_validate_target_date(target_date)
    except HTTPException as e:
        return _tool_error(str(e.detail))

    resolved_pots: list[dict] = []
    for entry in (funding_pots or [])[:8]:
        if not isinstance(entry, dict):
            continue
        aid_or_name = entry.get("account_id") or entry.get("name")
        resolved_account = await _resolve_account_for_propose(uid, aid_or_name)
        if resolved_account.get("ambiguous"):
            return resolved_account
        if resolved_account.get("error"):
            return _tool_error(resolved_account["error"])
        account = resolved_account.get("account")
        if account is None:
            continue
        resolved_pots.append({"account_id": account.id, "count_existing": bool(entry.get("count_existing"))})

    try:
        preview = await _route_preview_commitment(
            {"amount": amount, "target_date": target_date, "funding_pots": resolved_pots},
            user={"email": uid},
        )
    except HTTPException as e:
        return _tool_error(str(e.detail))
    except Exception as e:
        logger.exception("penny_tools: propose_create_commitment preview failed for %s", uid)
        return _tool_error(f"commitment preview failed: {e}")

    feasibility_note = preview.get("feasibility_note")
    slice_amount = preview.get("per_period_slice") or 0
    if feasibility_note:
        consequence = feasibility_note
    elif slice_amount:
        consequence = f"Needs about {_money(slice_amount)['formatted']} each pay period."
    else:
        consequence = "This is already funded from the pots you linked."

    amount_fmt = _money(amount)["formatted"]
    summary = f"Plan '{name}' for {amount_fmt} by {target_date}"
    params = {"name": name, "amount": amount, "target_date": target_date, "funding_pots": resolved_pots}
    return await _create_proposal(uid, "create_commitment", params, summary, consequence)


# ── B14 (B12 stage 1) — edit/delete twins for the covered creates ────────
# Owner spec, 2026-09-08: every one of the six write-capable objects Penny
# can already CREATE (planned one-offs, allocations, commitments) or ACT ON
# (checkpoints, recurring occurrences) gets a matching update/delete
# propose tool, still entirely propose-only through `_create_proposal` —
# the consent gate above is untouched, these are just more `kind`s in the
# same `penny_proposals_col` row shape. Every validator below is IMPORTED
# from the router it mirrors wherever one exists as a module-level function
# (allocations.py's and commitments.py's `_validate_*`); planned.py,
# checkpoints.py and analytics.py's cashflow-override endpoints validate
# inline with no extracted function to import, so those are mirrored
# line-for-line instead, each call site noting which router lines it
# mirrors so the two can never quietly drift apart.
async def _exec_propose_update_planned(uid: str, planned_ref, name=None, amount=None, date_str=None) -> dict:
    if not planned_ref or not str(planned_ref).strip():
        return _tool_error("planned_ref required")
    resolved = await _resolve_planned_for_propose(uid, str(planned_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["planned"]

    # Mirrors app.routers.planned.update_planned_expense's own per-field
    # validation exactly (that router has no extracted `_validate_*`
    # functions to import).
    updates: dict = {}
    if name is not None:
        new_name = str(name).strip()
        if not new_name:
            return _tool_error("name is required and must not be blank")
        updates["name"] = new_name
    if amount is not None:
        try:
            amt = float(amount)
            if amt <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return _tool_error("amount must be a positive number")
        updates["amount"] = round(amt, 2)
    if date_str is not None:
        try:
            new_date = date.fromisoformat(str(date_str))
        except (TypeError, ValueError):
            return _tool_error("date must be an ISO date string (YYYY-MM-DD)")
        stored_date = date.fromisoformat(doc["date"])
        # Grandfathering: an unchanged date is always accepted even if it
        # has since rolled into the past, exactly like the router.
        if new_date != stored_date and new_date < date.today():
            return _tool_error("date must be today or in the future")
        updates["date"] = new_date.isoformat()

    # A propose tool with nothing to change is a wasted round-trip — the
    # router itself tolerates an empty body (returns the item unchanged),
    # but a proposal claiming to change nothing would be a confusing card
    # to confirm, so this refuses it before it ever becomes one.
    if not updates:
        return _tool_error("at least one of name, amount, or date is required")

    before_amount_fmt = _money(doc["amount"])["formatted"]
    before_date = doc["date"]
    label = doc["name"]
    bits = []
    if "amount" in updates:
        bits.append(f"from {before_amount_fmt} to {_money(updates['amount'])['formatted']}")
    if "date" in updates and updates["date"] != before_date:
        new_date_label = date.fromisoformat(updates["date"]).strftime("%-d %b")
        bits.append(f"on {new_date_label}" if "amount" in updates else f"date to {new_date_label}")
    if "name" in updates and updates["name"] != label:
        bits.append(f"name to '{updates['name']}'")
    summary = f"Change the {label} one-off " + " ".join(bits) if bits else f"Update the {label} one-off"
    consequence = "Adjusts what's shown as spendable around that date, nothing else changes."
    params = {"planned_id": doc["id"], **updates}
    return await _create_proposal(uid, "update_planned", params, summary, consequence)


async def _exec_propose_delete_planned(uid: str, planned_ref) -> dict:
    if not planned_ref or not str(planned_ref).strip():
        return _tool_error("planned_ref required")
    resolved = await _resolve_planned_for_propose(uid, str(planned_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["planned"]

    amount_fmt = _money(doc["amount"])["formatted"]
    date_label = date.fromisoformat(doc["date"]).strftime("%-d %b")
    summary = f"Delete the {doc['name']} one-off ({amount_fmt} on {date_label})"
    consequence = "This stops reducing what's shown as spendable around that date."
    params = {"planned_id": doc["id"]}
    return await _create_proposal(uid, "delete_planned", params, summary, consequence)


async def _exec_propose_update_allocation(
    uid: str, allocation_ref, name=None, amount_per_period=None, recurrence=None, paused=None,
) -> dict:
    # Owner scope, 2026-09-08: only name/amount_per_period/recurrence/paused
    # are exposed here — fill_account_id/match_type/match_value/
    # effective_from stay UI-only for this stage (re-pointing WHAT fills an
    # envelope is a bigger trust step than renaming or resizing one).
    from app.routers.allocations import (
        _conflicts as _alloc_conflicts,
        _validate_amount as _alloc_validate_amount,
        _validate_name as _alloc_validate_name,
        _validate_recurrence as _alloc_validate_recurrence,
    )

    if not allocation_ref or not str(allocation_ref).strip():
        return _tool_error("allocation_ref required")
    resolved = await _resolve_allocation_for_propose(uid, str(allocation_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["allocation"]

    updates: dict = {}
    if name is not None:
        try:
            updates["name"] = _alloc_validate_name(name)
        except HTTPException as e:
            return _tool_error(str(e.detail))
    if amount_per_period is not None:
        try:
            updates["amount_per_period"] = _alloc_validate_amount(amount_per_period)
        except HTTPException as e:
            return _tool_error(str(e.detail))
    if recurrence is not None:
        try:
            updates["recurrence"] = _alloc_validate_recurrence(recurrence)
        except HTTPException as e:
            return _tool_error(str(e.detail))
    if paused is not None:
        updates["active"] = not bool(paused)

    if not updates:
        return _tool_error("at least one of name, amount_per_period, recurrence, or paused is required")

    # Same re-check the router itself runs whenever the effective
    # (fill_account_id, match_type, match_value, active, recurrence) tuple
    # changes: toggling paused->active, or switching recurrence, can revive
    # a rule another allocation has since claimed. fill_account_id/
    # match_type/match_value are never touched by this tool, so only
    # "active"/"recurrence" can trigger it here.
    eff_active = updates.get("active", doc["active"])
    if eff_active and ("active" in updates or "recurrence" in updates):
        from bson import ObjectId as _ObjectId
        from bson.errors import InvalidId as _InvalidId

        try:
            exclude_id = _ObjectId(doc["id"])
        except (_InvalidId, TypeError):
            exclude_id = doc["id"]
        if await _alloc_conflicts(
            uid, doc["fill_account_id"], doc["match_type"], doc["match_value"], exclude_id=exclude_id,
        ):
            return _tool_error("an active allocation already fills from this payment")

    label = doc["name"]
    amount_fmt = _money(doc["amount_per_period"])["formatted"]
    if paused is True:
        summary = f"Pause the {label} allocation ({amount_fmt} per period)"
        consequence = "Frees up its unfilled remainder in safe to spend until you resume it."
    elif paused is False:
        summary = f"Resume the {label} allocation ({amount_fmt} per period)"
        consequence = "Reserves its unfilled remainder from safe to spend again."
    else:
        bits = []
        if "amount_per_period" in updates:
            bits.append(f"to {_money(updates['amount_per_period'])['formatted']} per period")
        if "name" in updates:
            bits.append(f"name to '{updates['name']}'")
        if "recurrence" in updates:
            bits.append("to a one-off this period" if updates["recurrence"] == "once" else "to repeat every period")
        summary = f"Change the {label} allocation " + ", ".join(bits) if bits else f"Update the {label} allocation"
        consequence = "Changes how much this allocation reserves from safe to spend."
    params = {"allocation_id": doc["id"], **updates}
    return await _create_proposal(uid, "update_allocation", params, summary, consequence)


async def _exec_propose_delete_allocation(uid: str, allocation_ref) -> dict:
    if not allocation_ref or not str(allocation_ref).strip():
        return _tool_error("allocation_ref required")
    resolved = await _resolve_allocation_for_propose(uid, str(allocation_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["allocation"]

    amount_fmt = _money(doc["amount_per_period"])["formatted"]
    summary = f"Delete the {doc['name']} envelope ({amount_fmt} per pay period)"
    consequence = "Its unfilled remainder stops being reserved from safe to spend."
    params = {"allocation_id": doc["id"]}
    return await _create_proposal(uid, "delete_allocation", params, summary, consequence)


async def _exec_propose_update_commitment(uid: str, commitment_ref, name=None, amount=None, target_date=None) -> dict:
    from app.routers.commitments import (
        _validate_amount as _cm_validate_amount,
        _validate_name as _cm_validate_name,
        _validate_target_date as _cm_validate_target_date,
    )

    if not commitment_ref or not str(commitment_ref).strip():
        return _tool_error("commitment_ref required")
    resolved = await _resolve_commitment_for_propose(uid, str(commitment_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["commitment"]

    updates: dict = {}
    if name is not None:
        try:
            updates["name"] = _cm_validate_name(name)
        except HTTPException as e:
            return _tool_error(str(e.detail))
    if amount is not None:
        try:
            updates["amount"] = _cm_validate_amount(amount)
        except HTTPException as e:
            return _tool_error(str(e.detail))
    if target_date is not None:
        try:
            updates["target_date"] = _cm_validate_target_date(target_date)
        except HTTPException as e:
            return _tool_error(str(e.detail))

    if not updates:
        return _tool_error("at least one of name, amount, or target_date is required")

    label = doc["name"]
    bits = []
    if "amount" in updates:
        bits.append(f"from {_money(doc.get('amount'))['formatted']} to {_money(updates['amount'])['formatted']}")
    if "target_date" in updates and updates["target_date"] != doc.get("target_date"):
        bits.append(f"target date to {updates['target_date']}")
    if "name" in updates and updates["name"] != label:
        bits.append(f"name to '{updates['name']}'")
    summary = f"Change the {label} plan " + ", ".join(bits) if bits else f"Update the {label} plan"
    consequence = "This changes how much it needs each pay period, re-worked from the new figures."
    params = {"commitment_id": doc["id"], **updates}
    return await _create_proposal(uid, "update_commitment", params, summary, consequence)


async def _exec_propose_delete_commitment(uid: str, commitment_ref) -> dict:
    if not commitment_ref or not str(commitment_ref).strip():
        return _tool_error("commitment_ref required")
    resolved = await _resolve_commitment_for_propose(uid, str(commitment_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["commitment"]

    amount_fmt = _money(doc.get("amount"))["formatted"]
    target = doc.get("target_date")
    label = doc["name"]
    summary = f"Cancel the {label} plan ({amount_fmt} by {target})" if target else f"Cancel the {label} plan ({amount_fmt})"
    consequence = "Its per-period slice stops being reserved from safe to spend."
    params = {"commitment_id": doc["id"]}
    return await _create_proposal(uid, "delete_commitment", params, summary, consequence)


async def _exec_propose_delete_checkpoint(uid: str, checkpoint_ref) -> dict:
    if not checkpoint_ref or not str(checkpoint_ref).strip():
        return _tool_error("checkpoint_ref required")
    resolved = await _resolve_checkpoint_for_propose(uid, str(checkpoint_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["checkpoint"]

    amount_fmt = _money(doc.get("aim_amount"))["formatted"]
    summary = f"Cancel your {doc['ref']} aim ({amount_fmt} this period)"
    consequence = "Stops tracking progress against this aim for the rest of the period."
    params = {"checkpoint_id": doc["id"]}
    return await _create_proposal(uid, "delete_checkpoint", params, summary, consequence)


async def _exec_propose_skip_occurrence(uid: str, key_or_name, date_str) -> dict:
    # Mirrors app.routers.analytics.skip_occurrence's own validation
    # (key/date required, date must be ISO) exactly.
    if not key_or_name or not str(key_or_name).strip():
        return _tool_error("key_or_name required")
    date_str = str(date_str or "").strip()
    if not date_str:
        return _tool_error("date required")
    try:
        date.fromisoformat(date_str)
    except ValueError:
        return _tool_error("invalid date format, use ISO 8601 (YYYY-MM-DD)")

    resolved = await _resolve_recurring_key(uid, str(key_or_name).strip(), dismissed=False)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    key = resolved["key"]

    occ = await _find_occurrence_detail(uid, key, date_str)
    date_label = date.fromisoformat(date_str).strftime("%-d %b")
    if occ and occ.get("amount") is not None:
        amount_fmt = _money(occ["amount"])["formatted"]
        summary = f"Skip the {key} payment of {amount_fmt} on {date_label}"
    else:
        summary = f"Skip the {key} payment on {date_label}"
    consequence = "This occurrence stops counting in your upcoming bills and predictions. You can undo it from Upcoming."
    params = {"key": key, "date": date_str}
    return await _create_proposal(uid, "skip_occurrence", params, summary, consequence)


async def _exec_propose_edit_occurrence(
    uid: str, key_or_name, date_str, new_date=None, new_amount=None, scope=None,
) -> dict:
    # Mirrors app.routers.analytics.edit_upcoming's own validation exactly,
    # including its scope enum ("one" | "future" — never "all").
    if not key_or_name or not str(key_or_name).strip():
        return _tool_error("key_or_name required")
    date_str = str(date_str or "").strip()
    if not date_str:
        return _tool_error("date required")
    scope = str(scope or "").strip()
    if scope not in ("one", "future"):
        return _tool_error("scope must be 'one' or 'future'")
    try:
        date.fromisoformat(date_str)
        if new_date:
            date.fromisoformat(str(new_date))
    except (TypeError, ValueError):
        return _tool_error("invalid date format, use ISO 8601 (YYYY-MM-DD)")
    if new_amount is not None:
        try:
            new_amount = float(new_amount)
            if new_amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return _tool_error("new_amount must be a positive number")
    if new_date is None and new_amount is None:
        return _tool_error("at least one of new_date or new_amount must be provided")

    resolved = await _resolve_recurring_key(uid, str(key_or_name).strip(), dismissed=False)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    key = resolved["key"]

    occ = await _find_occurrence_detail(uid, key, date_str)
    date_label = date.fromisoformat(date_str).strftime("%-d %b")
    bits = []
    if new_amount is not None:
        if occ and occ.get("amount") is not None:
            bits.append(
                f"from {_money(occ['amount'])['formatted']} to {_money(new_amount)['formatted']}"
            )
        else:
            bits.append(f"to {_money(new_amount)['formatted']}")
    if new_date is not None:
        new_date_label = date.fromisoformat(str(new_date)).strftime("%-d %b")
        bits.append(f"date to {new_date_label}")
    scope_note = "" if scope == "one" else " and every future occurrence"
    summary = f"Change the {key} payment on {date_label} " + ", ".join(bits) + scope_note
    consequence = (
        "This changes what's expected in your upcoming bills and predictions, "
        "it doesn't move any money itself."
    )
    params = {
        "key": key, "date": date_str, "scope": scope,
        "new_date": str(new_date) if new_date is not None else None,
        "new_amount": round(new_amount, 2) if new_amount is not None else None,
    }
    return await _create_proposal(uid, "edit_occurrence", params, summary, consequence)


async def _exec_propose_clear_override(uid: str, key_or_name, date_str) -> dict:
    # Mirrors app.routers.analytics.clear_override's own validation exactly
    # — that endpoint only requires key/date to be non-blank, it never
    # checks the date is a valid ISO date, so this doesn't either.
    if not key_or_name or not str(key_or_name).strip():
        return _tool_error("key_or_name required")
    date_str = str(date_str or "").strip()
    if not date_str:
        return _tool_error("date required")

    resolved = await _resolve_recurring_key(uid, str(key_or_name).strip(), dismissed=False)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    key = resolved["key"]

    try:
        date_label = date.fromisoformat(date_str).strftime("%-d %b")
    except ValueError:
        date_label = date_str
    summary = f"Clear the change on the {key} payment's {date_label} occurrence"
    consequence = "Reverts to the predicted date and amount for that occurrence."
    params = {"key": key, "date": date_str}
    return await _create_proposal(uid, "clear_override", params, summary, consequence)


# ── propose_recategorise_transaction ─────────────────────────────────────
# Owner amendment, 2026-08-30 (see PENNY_TOOLS.md "Write tools" section):
# user-initiated recategorisation joins the propose/confirm write set. The
# miscategorised-guardrail queue (transfer-pair suggestions, dismiss-
# miscategorised, resolve-movement) stays EXCLUDED — that domain still
# needs the app's own evidence-side-by-side review sheet, never Penny.
_RECAT_PROJ = {
    "amount": 1, "transaction_type": 1, "category": 1, "custom_category": 1,
    "merchant_name": 1, "description": 1, "date": 1, "account_id": 1, "merchant_key": 1,
}


async def _find_transaction_doc_by_id(uid: str, transaction_id: str) -> dict | None:
    """Looks `transaction_id` up across the SAME 5 source collections
    search_transactions/get_account_activity read from (see
    `_SEARCH_COLLECTIONS`), so an id either of those tools handed back
    always resolves to SOMETHING here — but only a hit in `transactions_col`
    is ACTIONABLE: `PATCH /transactions/{id}` and the rule-application
    machinery (`apply_single_rule`/`count_rule_matches`,
    app.services.categorisation) both only ever touch `transactions_col`,
    never the other 4 (Yapily/statement/Mono/M-Pesa). A hit there is real
    but out of reach for this tool; returns the sentinel dict
    `{"_out_of_reach": True}` so the caller can return an honest error
    instead of silently building a proposal that would no-op on execute."""
    doc = await transactions_col.find_one({"_id": transaction_id, "user_id": uid}, _RECAT_PROJ)
    if doc is not None:
        return doc
    for col in (yapily_transactions_col, statement_transactions_col, mono_transactions_col, mpesa_transactions_col):
        other = await col.find_one({"_id": transaction_id, "user_id": uid}, {"_id": 1})
        if other is not None:
            return {"_out_of_reach": True}
    return None


def _recat_candidate_summary(d: dict) -> dict:
    return {
        "id": str(d.get("_id")),
        "description": d.get("merchant_name") or d.get("description"),
        "amount": _money(d.get("amount"), decimals=2),
        "date": _activity_date_str(d.get("date")),
        "category": d.get("custom_category") or d.get("category") or "Other",
    }


async def _resolve_transaction_for_propose(
    uid: str, transaction_id, merchant, date_str, amount,
) -> dict:
    """Resolves `transaction_ref` to ONE `transactions_col` row this tool can
    actually act on. `transaction_id` short-circuits (see
    `_find_transaction_doc_by_id`'s own doctrine comment on why only
    `transactions_col` is actionable); otherwise `merchant` + `date`
    (`amount`, when given, narrows further) resolve the same
    exact-then-fuzzy, ambiguous-returns-matches way every other resolver in
    this module does (`_name_matches`) — never guesses."""
    if transaction_id and str(transaction_id).strip():
        doc = await _find_transaction_doc_by_id(uid, str(transaction_id).strip())
        if doc is None:
            return {"error": f"no transaction found with id '{transaction_id}'"}
        if doc.get("_out_of_reach"):
            return {"error": "this transaction's account isn't one Penny can recategorise yet, use the app's transaction sheet instead"}
        return {"doc": doc}

    merchant = str(merchant or "").strip()
    if not merchant or not date_str:
        return {"error": "either transaction_id, or both merchant and date, are required to find the transaction"}
    try:
        day = date.fromisoformat(str(date_str)[:10])
    except (TypeError, ValueError):
        return {"error": "date must be an ISO date string (YYYY-MM-DD)"}
    start = datetime.combine(day, datetime.min.time())
    end = datetime.combine(day, datetime.max.time())

    candidates: list[dict] = []
    async for d in transactions_col.find({"user_id": uid, "date": {"$gte": start, "$lte": end}}, _RECAT_PROJ):
        text = d.get("merchant_name") or d.get("description") or ""
        if _name_matches(merchant, text):
            candidates.append(d)

    if amount is not None:
        try:
            amount_f = abs(float(amount))
            candidates = [
                d for d in candidates
                if abs(abs(float(d.get("amount") or 0)) - amount_f) < 0.005
            ]
        except (TypeError, ValueError):
            pass  # an unparseable amount just doesn't narrow further

    if not candidates:
        return {"error": f"no transaction found matching '{merchant}' on {day.isoformat()}"}
    if len(candidates) > 1:
        return {"ambiguous": True, "matches": [_recat_candidate_summary(d) for d in candidates[:10]]}
    return {"doc": candidates[0]}


async def _recat_valid_categories(uid: str) -> tuple[list[str], dict]:
    """Same source the app's own recategorise sheet populates its picker
    from (`GET /categories`), filtered the exact same way
    `TeachingSheet.tsx`'s `spendPickable` filters it: never "Other", never
    "Income", never a movement/income-kind category — under ENGINE.md's
    Destination Rule, movement resolves to a pot-ledger destination via the
    app's own resolve-movement flow, never a category correction, spend or
    otherwise. Returns (valid_names, kinds_map)."""
    from app.routers.categories import get_categories as _route_get_categories

    cats = await _route_get_categories(user={"email": uid})
    kinds = cats.get("kinds") or {}
    valid = [
        c for c in (cats.get("all") or [])
        if c not in ("Other", "Income") and kinds.get(c) not in ("movement", "income")
    ]
    return valid, kinds


async def _exec_propose_recategorise_transaction(
    uid: str, transaction_id=None, merchant=None, date_str=None, amount=None,
    new_category=None, scope=None,
) -> dict:
    scope = str(scope or "").strip().lower()
    if scope not in ("just_once", "always"):
        return _tool_error("scope must be 'just_once' or 'always', ask the user which they want if the conversation hasn't said")
    new_category = str(new_category or "").strip()
    if not new_category:
        return _tool_error("new_category is required")

    resolved = await _resolve_transaction_for_propose(uid, transaction_id, merchant, date_str, amount)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["doc"]

    valid_categories, _kinds = await _recat_valid_categories(uid)
    if new_category not in valid_categories:
        suggestions = difflib.get_close_matches(new_category, valid_categories, n=3)
        detail = (
            f"nearest matches: {', '.join(suggestions)}" if suggestions
            else f"your categories are: {', '.join(valid_categories)}"
        )
        return _tool_error(f"'{new_category}' isn't one of the user's categories, {detail}")

    current_category = doc.get("custom_category") or doc.get("category") or "Other"
    if current_category == new_category:
        return _tool_error(f"this transaction is already filed as {new_category}")

    txn_id = str(doc["_id"])
    merchant_label = doc.get("merchant_name") or doc.get("description") or "this transaction"
    amount_fmt = _money(doc.get("amount"), decimals=2)["formatted"]
    try:
        date_label = doc.get("date").strftime("%-d %b") if isinstance(doc.get("date"), (date, datetime)) else str(doc.get("date"))
    except ValueError:
        date_label = _activity_date_str(doc.get("date"))

    if scope == "just_once":
        summary = f"File the {merchant_label} {amount_fmt} on {date_label} as {new_category} instead of {current_category}."
        consequence = "Changes only this transaction."
        params = {
            "transaction_id": txn_id, "new_category": new_category, "scope": "just_once",
            "previous_category": current_category,
        }
        return await _create_proposal(uid, "recategorise_transaction", params, summary, consequence)

    # scope == "always" — blast radius via count_rule_matches
    # (app.services.categorisation), the SAME matching definition
    # apply_single_rule itself uses when the rule actually runs, extracted
    # alongside it specifically so this preview can never disagree with
    # what executing the proposal really does (ENGINE.md: rules are
    # engine-proposed with blast radius shown, never auto-applied).
    from app.services.categorisation import (
        build_rule_pattern as _build_rule_pattern,
        canonical_merchant_key as _canonical_merchant_key,
        count_rule_matches as _count_rule_matches,
    )

    merchant_key = doc.get("merchant_key") or _canonical_merchant_key(
        doc.get("merchant_name") or "", doc.get("description") or "",
    )
    pattern = _build_rule_pattern(merchant_key) if merchant_key else ""
    if not pattern:
        return _tool_error("can't build a reliable rule from this transaction's merchant text")

    # exclude_id=txn_id: the primary transaction gets PATCHed directly at
    # execute time (see app.routers.can_i._execute_recategorise_transaction,
    # same two-step PATCH-then-rule sequence TeachingSheet's own commitSpend
    # + handleAlways already follow), so it is naturally excluded from the
    # rule's OWN bulk pass by the time that runs — excluded here too so this
    # preview count states only the OTHER past transactions the rule will
    # actually refile, never double-counting the one this proposal is
    # already about.
    matches_past = await _count_rule_matches(uid, pattern, new_category, exclude_id=txn_id)
    summary = f"Always file {merchant_label} as {new_category} instead of {current_category}."
    if matches_past > 0:
        consequence = (
            f"Sets a rule for this merchant and refiles {matches_past} "
            f"past transaction{'s' if matches_past != 1 else ''}."
        )
    else:
        consequence = "Sets a rule for this merchant. No past transactions match it yet."
    params = {
        "transaction_id": txn_id, "new_category": new_category, "scope": "always",
        "previous_category": current_category, "pattern": pattern, "merchant_label": merchant_label,
    }
    return await _create_proposal(uid, "recategorise_transaction", params, summary, consequence)


# ── propose_set_card_apr ──────────────────────────────────────────────────
# Owner doctrine amendment #2, 2026-08-30 (verbatim quote, see
# PENNY_TOOLS.md): "we probably want to add an agent skill to add Apr to
# credit cards too" — card terms were EXCLUDED from Penny Agent Mode v1
# because an LLM mishearing a rate has no independent check. The owner
# overrode that exclusion, and the mitigation is the VERBATIM-PROVENANCE
# RULE below: the numeric rate in any card-terms proposal MUST appear
# literally as a number in the user's own words (this turn or an earlier
# user turn in the conversation), never inferred or paraphrased. This is
# enforced HERE, server-side, in the builder — never left to the system
# prompt alone (see `_provenance_apr_present`), exactly as the amendment
# requires.
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")


def _provenance_apr_present(apr_pct: float, user_texts: list[str] | None) -> bool:
    """True only when `apr_pct` appears as an EXACT number somewhere in
    `user_texts` (the current question plus every prior user turn in the
    conversation, server-computed from the loop's own message history in
    app.services.penny_agent — never something the model's tool-call JSON
    can influence). Accepts '24.9', '24.9%', '24.9 percent' identically:
    the % sign / word 'percent' is never part of the number itself, so a
    plain digit-run extraction already handles all three forms without
    special-casing them. Deliberately an EXACT match, not "close to" — a
    user who typed 'roughly 25' has not typed '24.9', so a model that
    invents that decimal must be refused, even though '25' itself is
    literally present."""
    target = round(float(apr_pct), 4)
    for text in user_texts or []:
        for m in _NUMBER_RE.findall(text or ""):
            try:
                if round(float(m), 4) == target:
                    return True
            except ValueError:
                continue
    return False


def _fmt_pct(value: float) -> str:
    """'24.90' -> '24.9%', '20.00' -> '20%' — trims trailing zeros so a
    whole-number APR never grows a spurious '.0' the user never typed."""
    s = f"{float(value):.2f}".rstrip("0").rstrip(".")
    return f"{s}%"


async def _exec_propose_set_card_apr(uid: str, card_ref, apr_pct, user_texts=None) -> dict:
    try:
        apr = float(apr_pct)
    except (TypeError, ValueError):
        return _tool_error("apr_pct is required and must be a number")
    if not (0 <= apr <= 100):
        return _tool_error("apr_pct must be between 0 and 100")
    if not card_ref or not str(card_ref).strip():
        return _tool_error("card_ref required")

    resolved = await _resolve_credit_card_for_propose(uid, str(card_ref))
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    account = resolved["account"]

    # THE gate: an unprovenanced number never becomes a proposal, no
    # exceptions — see the module comment above _NUMBER_RE for why this is
    # implemented here rather than trusted to prompt instructions.
    if not _provenance_apr_present(apr, user_texts):
        return {
            "needs_input": True,
            "ask": f"What APR is {account.name}? Type the number and I'll set it.",
        }

    apr_rounded = round(apr, 2)
    try:
        existing = await card_terms_col.find_one({"_id": f"{uid}:{account.id}"})
    except Exception:
        logger.exception("penny_tools: propose_set_card_apr existing-terms lookup failed for %s", uid)
        existing = None
    before_apr = existing.get("apr_pct") if existing else None

    summary = f"Set {account.name} ({account.provider}) standard APR to {_fmt_pct(apr_rounded)}."
    consequence = "Used for your card plan and interest projections."
    if before_apr is not None:
        consequence += f" Currently recorded: {_fmt_pct(before_apr)}."
    params = {"account_id": account.id, "apr_pct": apr_rounded}
    return await _create_proposal(uid, "set_card_apr", params, summary, consequence)


# ── B15 (2026-09-08, B12 stage 2) — preferences that change money maths ────
#
# app.routers.preferences's `PATCH /preferences` barely validates its own
# body: most fields are `$set` straight from the client dict with no shape
# check at all (only income_value/pension_annual are coerced to a number,
# only cover_plan_excluded_accounts is de-duped). Mirroring "the router's
# validation" therefore means mirroring the UI's own rules (Settings /
# PayPeriodSettingsSheet), which is what every validator below actually
# does, each with a comment pointing at the UI control it mirrors. Every
# executor still ends by replaying `update_preferences` (see
# `can_i._execute_update_preferences` below) so the response-cache wipe and
# pay-period cashflow recompute happen exactly as a Settings edit would,
# never a second write path.
_PAY_PERIOD_WEEKDAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]


def _ordinal(n: int) -> str:
    """1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th', 11-13 -> 'th'."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


async def _current_prefs(uid: str) -> dict:
    return await preferences_col.find_one({"user_id": uid}) or {}


def _describe_pay_period_config(cfg: dict) -> str:
    """Human words for a pay_period_config dict, mirroring
    PayPeriodSettingsSheet.tsx's own MODES labels. Used both for the new
    config (required, per the build brief) and, where known, the old one,
    so a proposal summary never states a bare enum value like
    'monthly_pay_date' the user never sees anywhere in the app."""
    t = (cfg or {}).get("type", "calendar_month")
    if t == "calendar_month":
        return "calendar month (1st to last day of each month)"
    if t == "monthly_pay_date":
        day = cfg.get("day", 1)
        return f"monthly, paid on the {_ordinal(int(day))} of each month"
    if t == "biweekly":
        wd = _PAY_PERIOD_WEEKDAY_NAMES[cfg.get("weekday", 5) % 7]
        ref = cfg.get("referenceDate", "")
        ref_label = ""
        try:
            ref_label = f", from {date.fromisoformat(ref).strftime('%-d %b %Y')}"
        except (TypeError, ValueError):
            pass
        return f"every two weeks, paid on {wd}s{ref_label}"
    if t == "last_weekday_of_month":
        wd = _PAY_PERIOD_WEEKDAY_NAMES[cfg.get("weekday", 4) % 7]
        return f"monthly, paid on the last {wd} of each month"
    if t == "last_friday":
        return "monthly, paid on the last Friday of each month"
    return t


def _validate_pay_period_config(config) -> tuple[dict | None, str | None]:
    """Mirrors PayPeriodSettingsSheet.tsx's `buildConfig()`: only the four
    types that sheet actually offers are accepted (last_friday/weekly/
    custom exist in the TS union and/or the pay-period engine but have no
    live control to set them from, so a Penny proposal doesn't invent a
    reachable-only-by-API state), and only the fields each type uses are
    kept — an extra field the model hallucinated onto the dict is silently
    dropped rather than stored, exactly like the sheet's own switch."""
    if not isinstance(config, dict):
        return None, "config must be an object"
    t = config.get("type")
    if t not in ("calendar_month", "monthly_pay_date", "biweekly", "last_weekday_of_month"):
        return None, (
            "config.type must be one of 'calendar_month', 'monthly_pay_date', "
            "'biweekly', 'last_weekday_of_month' (the options Settings' own "
            "Pay Period sheet offers)"
        )
    if t == "calendar_month":
        return {"type": "calendar_month"}, None
    if t == "monthly_pay_date":
        try:
            day = int(config.get("day"))
        except (TypeError, ValueError):
            return None, "config.day is required for 'monthly_pay_date' and must be a whole number"
        if not (1 <= day <= 28):
            return None, "config.day must be between 1 and 28"
        return {"type": "monthly_pay_date", "day": day}, None
    if t == "last_weekday_of_month":
        try:
            weekday = int(config.get("weekday"))
        except (TypeError, ValueError):
            return None, "config.weekday is required for 'last_weekday_of_month' and must be 0-6"
        if not (0 <= weekday <= 6):
            return None, "config.weekday must be between 0 (Sunday) and 6 (Saturday)"
        return {"type": "last_weekday_of_month", "weekday": weekday}, None
    # biweekly
    try:
        weekday = int(config.get("weekday"))
    except (TypeError, ValueError):
        return None, "config.weekday is required for 'biweekly' and must be 0-6"
    if not (0 <= weekday <= 6):
        return None, "config.weekday must be between 0 (Sunday) and 6 (Saturday)"
    ref = config.get("referenceDate")
    try:
        date.fromisoformat(str(ref))
    except (TypeError, ValueError):
        return None, "config.referenceDate is required for 'biweekly' and must be an ISO date (YYYY-MM-DD)"
    return {"type": "biweekly", "weekday": weekday, "referenceDate": str(ref)}, None


async def _exec_propose_set_pay_period(uid: str, config) -> dict:
    clean, err = _validate_pay_period_config(config)
    if err:
        return _tool_error(err)
    prefs = await _current_prefs(uid)
    old_cfg = prefs.get("pay_period_config")
    new_label = _describe_pay_period_config(clean)
    if old_cfg and old_cfg != clean:
        old_label = _describe_pay_period_config(old_cfg)
        summary = f"Change your pay period from {old_label} to {new_label}"
    else:
        summary = f"Set your pay period to {new_label}"
    consequence = (
        "Resets your current pay period window, Safe-to-Spend recalculates "
        "against it, this can change what Home, Upcoming and Planning show."
    )
    params = {"pay_period_config": clean}
    return await _create_proposal(uid, "set_pay_period", params, summary, consequence)


async def _exec_propose_set_income(uid: str, amount_annual=None, bracket=None) -> dict:
    if amount_annual is None and bracket:
        return {
            "needs_input": True,
            "ask": "What's your approximate annual income? I can only set an exact figure, not just a band.",
        }
    if amount_annual is None:
        return _tool_error("amount_annual is required")
    try:
        amount = float(amount_annual)
    except (TypeError, ValueError):
        return _tool_error("amount_annual must be a number")
    if amount < 0:
        return _tool_error("amount_annual must not be negative")
    amount = round(amount)
    prefs = await _current_prefs(uid)
    before = prefs.get("income_value")
    if before:
        summary = f"Change your income on file from {_money(before)['formatted']} to {_money(amount)['formatted']}"
    else:
        summary = f"Set your income on file to {_money(amount)['formatted']}"
    consequence = "Changes your tax position figures: personal allowance and the Child Benefit charge check use this number."
    params = {"income_value": amount}
    return await _create_proposal(uid, "set_income", params, summary, consequence)


async def _exec_propose_set_pension_contributions(uid: str, amount_annual=None) -> dict:
    if amount_annual is None:
        return _tool_error("amount_annual is required")
    try:
        amount = float(amount_annual)
    except (TypeError, ValueError):
        return _tool_error("amount_annual must be a number")
    if amount < 0:
        return _tool_error("amount_annual must not be negative")
    amount = round(amount)
    prefs = await _current_prefs(uid)
    before = prefs.get("pension_annual")
    if before:
        summary = f"Change your pension contributions on file from {_money(before)['formatted']} to {_money(amount)['formatted']} a year"
    else:
        summary = f"Set your pension contributions on file to {_money(amount)['formatted']} a year"
    consequence = "Changes your adjusted net income and personal allowance taper figures."
    params = {"pension_annual": amount}
    return await _create_proposal(uid, "set_pension", params, summary, consequence)


async def _exec_propose_set_child_benefit(uid: str, receiving=None) -> dict:
    if not isinstance(receiving, bool):
        return _tool_error("receiving must be true or false")
    prefs = await _current_prefs(uid)
    before = bool(prefs.get("has_child_benefit", False))
    new_label = "receiving" if receiving else "not receiving"
    if "has_child_benefit" in prefs and before != receiving:
        old_label = "receiving" if before else "not receiving"
        summary = f"Change your Child Benefit record from {old_label} to {new_label}"
    else:
        summary = f"Record that you are {new_label} Child Benefit"
    consequence = "Changes whether the High Income Child Benefit Charge check applies to your tax position."
    params = {"has_child_benefit": receiving}
    return await _create_proposal(uid, "set_child_benefit", params, summary, consequence)


async def _exec_propose_set_debt_target(uid: str, months=None) -> dict:
    try:
        n = int(months)
    except (TypeError, ValueError):
        return _tool_error("months is required and must be a whole number")
    if not (1 <= n <= 360):
        return _tool_error("months must be between 1 and 360")
    prefs = await _current_prefs(uid)
    before = prefs.get("debt_target_months")
    if before and before != n:
        summary = f"Change your debt payoff target from {before} to {n} months"
    else:
        summary = f"Set your debt payoff target to {n} months"
    consequence = "Changes the repayment timelines shown on Cards and Planning."
    params = {"debt_target_months": n}
    return await _create_proposal(uid, "set_debt_target", params, summary, consequence)


def _parse_tracking_date(raw: str):
    """Accepts either a full ISO date (YYYY-MM-DD) or a year-month
    (YYYY-MM) — the only two shapes the app itself ever writes here
    (PreferencesContext.tsx's own `todayYM()` default is YYYY-MM, but the
    field is a free string with no backend consumer today, see this
    module's docstring note in PENNY_TOOLS.md). Returns a human label or
    None if unparsable."""
    s = str(raw or "").strip()
    try:
        d = date.fromisoformat(s)
        return d.strftime("%-d %b %Y")
    except (TypeError, ValueError):
        pass
    try:
        d = datetime.strptime(s, "%Y-%m")
        return d.strftime("%b %Y")
    except (TypeError, ValueError):
        return None


async def _exec_propose_set_debt_tracking_start(uid: str, date_str=None) -> dict:
    if not date_str or not str(date_str).strip():
        return _tool_error("date is required")
    label = _parse_tracking_date(date_str)
    if label is None:
        return _tool_error("date must be an ISO date (YYYY-MM-DD) or year-month (YYYY-MM)")
    prefs = await _current_prefs(uid)
    before = prefs.get("debt_tracking_start")
    before_label = _parse_tracking_date(before) if before else None
    if before_label and before_label != label:
        summary = f"Change your debt tracking start from {before_label} to {label}"
    else:
        summary = f"Set your debt tracking start to {label}"
    consequence = "Changes the reference point your debt movement is measured from on Cards and Planning."
    params = {"debt_tracking_start": str(date_str).strip()}
    return await _create_proposal(uid, "set_debt_tracking_start", params, summary, consequence)


async def _exec_propose_set_cover_plan_exclusions(uid: str, account_refs=None) -> dict:
    if account_refs is None or not isinstance(account_refs, list):
        return _tool_error("account_refs is required and must be a list (an empty list clears all exclusions)")
    resolved_ids: list[str] = []
    resolved_names: list[str] = []
    for ref in account_refs:
        ref = str(ref or "").strip()
        if not ref:
            continue
        found = await _resolve_account_for_propose(uid, ref)
        if found.get("ambiguous"):
            return found
        if found.get("error") or not found.get("account"):
            return _tool_error(found.get("error") or f"no account matching '{ref}'")
        acc = found["account"]
        if acc.id not in resolved_ids:
            resolved_ids.append(acc.id)
            resolved_names.append(acc.name)
    prefs = await _current_prefs(uid)
    before_ids = sorted({str(a) for a in (prefs.get("cover_plan_excluded_accounts") or [])})
    new_ids = sorted(resolved_ids)
    if not resolved_names:
        summary = "Stop excluding any accounts from the cover plan (all connected accounts count towards covering bills again)"
    else:
        label = ", ".join(resolved_names)
        summary = f"Exclude {label} from the cover plan (never pulled from to cover a bill shortfall)"
    if before_ids == new_ids:
        summary += ", unchanged from today"
    consequence = "Changes which accounts count towards covering bills in the cover plan."
    params = {"cover_plan_excluded_accounts": resolved_ids}
    return await _create_proposal(uid, "set_cover_plan_exclusions", params, summary, consequence)


async def _exec_propose_set_hide_balances(uid: str, hidden=None) -> dict:
    if not isinstance(hidden, bool):
        return _tool_error("hidden must be true or false")
    prefs = await _current_prefs(uid)
    before = bool(prefs.get("hide_net_worth", False))
    if before == hidden:
        summary = f"{'Hide' if hidden else 'Show'} your balances (already set this way)"
    else:
        summary = "Hide your balances" if hidden else "Show your balances again"
    consequence = "Only changes what is shown, nothing about your calculations changes."
    params = {"hide_net_worth": hidden}
    return await _create_proposal(uid, "set_hide_balances", params, summary, consequence)


# ── B16 (B12 stage 3) resolvers — offline accounts, ledger entries, mirror
# rules, bank connections ─────────────────────────────────────────────────
# Same doctrine as every resolver above: id short-circuits, otherwise
# case-insensitive (then word-level) name match against the user's OWN
# records, ambiguous returns candidates rather than guessing.
_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _entry_date_str(e: dict) -> str:
    d = e.get("date")
    if isinstance(d, (datetime, date)):
        return d.strftime("%Y-%m-%d")
    return str(d or "")[:10]


def _entry_ref_matches(entry_ref: str, description: str) -> bool:
    """`_name_matches` is directional (needle's words must ALL be present in
    the candidate name) — fine when `entry_ref` is a short reference to a
    longer description ('Tesco' matching 'Tesco Express London Bridge'), but
    an `entry_ref` that embeds a date too ('the Tesco payment on
    2026-08-01', see `_resolve_ledger_entry_for_propose`'s own docstring)
    is LONGER than a short description like 'Tesco' and would never match
    in that direction alone (the extra words 'the'/'payment'/'on'/the date
    aren't in the description). Trying both directions — does entry_ref
    match description, OR does description match entry_ref — covers both
    shapes without weakening either: a short entry_ref still only matches a
    description it's genuinely a fragment of, and a longer entry_ref that
    happens to CONTAIN the description text also matches."""
    return _name_matches(entry_ref, description) or _name_matches(description, entry_ref)


async def _resolve_offline_account_for_propose(uid: str, account_ref: str) -> dict:
    """Resolves one offline (manual) account for every B16 propose tool
    that creates/edits/deletes an offline account, its ledger, or a mirror
    rule targeting it — scoped ONLY to manual_accounts_col, deliberately
    NOT `_resolve_account_for_propose` above (that resolver's own
    get_accounts list mixes in connected accounts too, the wrong universe
    for a tool where the target must always be an offline one, exactly
    like manual_accounts.py's own router endpoints)."""
    if not account_ref or not str(account_ref).strip():
        return {"error": "account_ref is required"}
    docs = await manual_accounts_col.find({"user_id": uid}).to_list(None)
    if not docs:
        return {"error": f"no offline account matching '{account_ref}'", "available": []}
    target = next((a for a in docs if a["_id"] == account_ref), None)
    if target is None:
        matches = [a for a in docs if _name_matches(account_ref, a.get("name") or "")]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [
                    {
                        "id": a["_id"], "name": a.get("name"),
                        "account_type": a.get("account_type"), "balance": _money(a.get("balance", 0)),
                    }
                    for a in matches
                ],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no offline account matching '{account_ref}'", "available": [a.get("name") for a in docs]}
    return {"account": target}


async def _resolve_ledger_entry_for_propose(uid: str, account_id: str, entry_ref: str) -> dict:
    """Resolves one hand-added ledger entry within one offline account, for
    propose_update_ledger_entry/propose_delete_ledger_entry. Reads through
    app.routers.manual_accounts.list_manual_transactions (the SAME data the
    Accounts page's ledger view shows, imported inside this function per
    this module's own IMPORT RULE). Rule-posted "mirror" entries (id
    prefixed "mirror:", see that router's own docstring) are excluded
    outright — no router endpoint accepts a mirror: id, so one can never be
    a valid target here.

    `entry_ref` is matched exact-id-then-fuzzy, same as every resolver in
    this module: an id short-circuits; otherwise a case-insensitive
    substring match against `description` (`_name_matches`) collects
    candidates, and if more than one entry shares that description, an ISO
    date (YYYY-MM-DD) literally present in `entry_ref` (e.g. the user said
    "the Tesco payment on 2026-08-01") narrows the set to the entry whose
    own date matches it exactly — two entries with an identical description
    on different dates are only ambiguous until the caller names the date.
    Still more than one candidate after that -> ambiguous; none -> not
    found."""
    from app.routers.manual_accounts import list_manual_transactions as _route_list_manual_txns

    all_entries = await _route_list_manual_txns(account_id, user={"email": uid})
    entries = [e for e in all_entries if not str(e.get("id", "")).startswith("mirror:")]
    if not entries:
        return {"error": f"no ledger entry matching '{entry_ref}'", "available": []}
    target = next((e for e in entries if e["id"] == entry_ref), None)
    if target is None:
        candidates = [e for e in entries if _entry_ref_matches(entry_ref, e.get("description") or "")]
        if len(candidates) > 1:
            date_match = _ISO_DATE_RE.search(str(entry_ref or ""))
            if date_match:
                narrowed = [e for e in candidates if _entry_date_str(e) == date_match.group(0)]
                if narrowed:
                    candidates = narrowed
        if len(candidates) > 1:
            return {
                "ambiguous": True,
                "matches": [
                    {
                        "id": e["id"], "description": e.get("description"),
                        "amount": _money(e.get("amount"), 2), "date": _entry_date_str(e),
                    }
                    for e in candidates
                ],
            }
        target = candidates[0] if candidates else None
    if target is None:
        return {
            "error": f"no ledger entry matching '{entry_ref}'",
            "available": [f"{e.get('description')} ({_entry_date_str(e)})" for e in entries],
        }
    return {"entry": target}


async def _resolve_account_rule_for_propose(uid: str, rule_ref: str) -> dict:
    """Resolves one transaction-mirror rule for propose_update_account_rule/
    propose_delete_account_rule, reading manual_account_rules_col directly
    (list_rules in app.routers.manual_accounts joins in display names this
    resolver has no need for). Same id-then-name, ambiguous-returns-matches
    pattern as every other resolver in this module."""
    docs = await manual_account_rules_col.find({"user_id": uid}).to_list(None)
    if not docs:
        return {"error": f"no rule matching '{rule_ref}'", "available": []}
    target = next((r for r in docs if r["_id"] == rule_ref), None)
    if target is None:
        matches = [r for r in docs if _name_matches(rule_ref, r.get("name") or "")]
        if len(matches) > 1:
            return {"ambiguous": True, "matches": [{"id": r["_id"], "name": r.get("name")} for r in matches]}
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no rule matching '{rule_ref}'", "available": [r.get("name") for r in docs]}
    return {"rule": target}


async def _resolve_source_account_for_propose(uid: str, ref: str) -> dict:
    """Resolves a CONNECTED account (never an offline one — a mirror rule's
    own source scope only makes sense against a real, syncing account) for
    propose_create_account_rule/propose_update_account_rule's
    `source_account_ref`. Same id-or-name resolution as
    `_resolve_account_for_propose` uses, but against `get_accounts`' list
    filtered to `not a.manual` first, so an offline account can never be
    picked as a rule's own source. The resolved account's id is then passed
    through app.routers.manual_accounts._resolve_source_scope (imported
    inside this function, this module's own IMPORT RULE) so the SAME
    canonical stored-id normalisation and 404 behaviour the router itself
    uses is reused verbatim, never reimplemented — that function's own
    docstring explains why the stored form matters (it must compare cleanly
    against a transaction's own account_id regardless of str/ObjectId)."""
    if not ref or not str(ref).strip():
        return {"account_id": None, "account_name": None}
    from app.routers.accounts import get_accounts as _route_get_accounts

    all_accs = await _route_get_accounts(user={"email": uid})
    accs = [a for a in all_accs if not a.manual]
    target = next((a for a in accs if a.id == ref), None)
    if target is None:
        matches = [a for a in accs if _name_matches(ref, a.name)]
        if len(matches) > 1:
            return {
                "ambiguous": True,
                "matches": [{"id": a.id, "name": a.name, "provider": a.provider} for a in matches],
            }
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no connected account matching '{ref}'", "available": [a.name for a in accs]}

    from app.routers.manual_accounts import _resolve_source_scope as _route_resolve_source_scope

    try:
        resolved_id = await _route_resolve_source_scope(uid, target.id)
    except HTTPException as e:
        return {"error": str(e.detail)}
    return {"account_id": resolved_id, "account_name": target.name}


async def _resolve_bank_connection_for_propose(uid: str, ref: str) -> dict:
    """Resolves a whole bank CONNECTION (a connections_col row for
    TrueLayer, or a finexer_consents_col row for Finexer) for
    propose_disconnect_bank, never a single account. Deliberately does NOT
    reuse `_resolve_account_for_propose` — that resolver's get_accounts
    list mixes in Yapily accounts whose `connection_id` field is actually a
    Yapily *consent* id (see accounts.py's own get_accounts), not a
    connections_col/finexer_consents_col row id; resolving a bank name
    through it could silently produce a connection id disconnect_connection
    can never find, a wrong-but-plausible match. Yapily is never touched by
    this tool at all.

    `ref` is tried two ways: an exact `_id` match against connections_col or
    finexer_consents_col for this uid is always unambiguous (ids are
    unique) and short-circuits. Otherwise `ref` is treated as a bank
    display name and matched against accounts_col's own `provider` field —
    both TrueLayer and Finexer-synced accounts live there (accounts.py's
    own sync_all writes Finexer accounts into the same collection) — grouped
    by `connection_id` so two connections to the same bank surface as an
    explicit ambiguous choice rather than silently merging their accounts."""
    ref = str(ref or "").strip()
    if not ref:
        return {"error": "connection_or_account_ref is required"}

    conn = await connections_col.find_one({"_id": ref, "user_id": uid})
    consent = None if conn else await finexer_consents_col.find_one({"_id": ref, "user_id": uid})
    if conn or consent:
        count = await accounts_col.count_documents({"connection_id": ref, "user_id": uid})
        sample = await accounts_col.find_one({"connection_id": ref, "user_id": uid}, {"provider": 1})
        return {
            "connection_id": ref,
            "bank_name": (sample or {}).get("provider") or "your bank",
            "accounts_count": count,
        }

    accs = await accounts_col.find({"user_id": uid}).to_list(None)
    groups: dict[str, list[dict]] = {}
    for a in accs:
        cid = a.get("connection_id")
        if not cid:
            continue
        groups.setdefault(cid, []).append(a)

    matching_group_ids = [
        cid for cid, group in groups.items()
        if any(_name_matches(ref, g.get("provider") or "") for g in group)
    ]
    if not matching_group_ids:
        available = sorted({a.get("provider") for a in accs if a.get("provider")})
        return {"error": f"no bank connection matching '{ref}'", "available": available}
    if len(matching_group_ids) > 1:
        return {
            "ambiguous": True,
            "matches": [
                {
                    "connection_id": cid,
                    "bank_name": groups[cid][0].get("provider") or "your bank",
                    "accounts": len(groups[cid]),
                }
                for cid in matching_group_ids
            ],
        }
    cid = matching_group_ids[0]
    return {
        "connection_id": cid,
        "bank_name": groups[cid][0].get("provider") or "your bank",
        "accounts_count": len(groups[cid]),
    }


# ── B16 (B12 stage 3) executors — accounts, ledger, mirror rules,
# connections ─────────────────────────────────────────────────────────────
# Owner spec, 2026-09-08 (B12 stage 3): the offline-accounts side of
# Penny's propose-only surface — everything manual_accounts.py's own
# router validates, mirrored line-for-line here (that router has no
# extracted `_validate_*` functions to import, so every check below notes
# which router lines it mirrors), plus a bank-connection disconnect and a
# sync-now with no fields to validate at all. `destructive=True` is passed
# ONLY by delete_offline_account and disconnect_bank (see `_create_proposal`
# above) — deleting one ledger entry or pausing a rule is comparatively
# minor and stays at the default.
async def _exec_propose_create_offline_account(uid: str, name=None, account_type=None, balance=None) -> dict:
    from app.routers.manual_accounts import ACCOUNT_TYPES as _MANUAL_ACCOUNT_TYPES

    # Mirrors app.routers.manual_accounts.create_manual_account's own
    # validation exactly.
    clean_name = str(name or "").strip()[:60]
    if not clean_name:
        return _tool_error("name is required")
    if account_type not in _MANUAL_ACCOUNT_TYPES:
        return _tool_error(f"account_type must be one of {sorted(_MANUAL_ACCOUNT_TYPES)}")
    try:
        bal = round(float(balance if balance is not None else 0), 2)
    except (TypeError, ValueError):
        return _tool_error("balance must be a number")
    if bal < 0:
        return _tool_error("balance must be 0 or more")

    type_label = {"savings": "savings", "current": "current", "credit_card": "credit card"}[account_type]
    summary = f"Add an offline {type_label} account called '{clean_name}' with a balance of {_money(bal)['formatted']}"
    consequence = (
        "Shows up on Accounts alongside your connected accounts and can be used for tracking or as "
        "a mirror rule's target. Low risk, you can delete it again later."
    )
    params = {"name": clean_name, "account_type": account_type, "balance": bal}
    return await _create_proposal(uid, "create_offline_account", params, summary, consequence)


async def _exec_propose_update_offline_account(
    uid: str, account_ref=None, name=None, account_type=None, balance=None,
) -> dict:
    from app.routers.manual_accounts import ACCOUNT_TYPES as _MANUAL_ACCOUNT_TYPES

    if not account_ref or not str(account_ref).strip():
        return _tool_error("account_ref required")
    resolved = await _resolve_offline_account_for_propose(uid, str(account_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["account"]

    # Mirrors app.routers.manual_accounts.update_manual_account's own
    # per-field validation exactly.
    updates: dict = {}
    if name is not None:
        new_name = str(name).strip()[:60]
        if not new_name:
            return _tool_error("name must not be blank")
        updates["name"] = new_name
    if account_type is not None:
        if account_type not in _MANUAL_ACCOUNT_TYPES:
            return _tool_error(f"account_type must be one of {sorted(_MANUAL_ACCOUNT_TYPES)}")
        updates["account_type"] = account_type
    if balance is not None:
        try:
            bal = round(float(balance), 2)
        except (TypeError, ValueError):
            return _tool_error("balance must be a number")
        if bal < 0:
            return _tool_error("balance must be 0 or more")
        updates["balance"] = bal

    if not updates:
        return _tool_error("at least one of name, account_type, or balance is required")

    label = doc.get("name")
    bits = []
    if "name" in updates and updates["name"] != label:
        bits.append(f"name to '{updates['name']}'")
    if "account_type" in updates:
        bits.append(f"type to {updates['account_type'].replace('_', ' ')}")
    if "balance" in updates:
        bits.append(f"balance to {_money(updates['balance'])['formatted']}")
    summary = f"Update '{label}', " + ", ".join(bits) if bits else f"Update '{label}'"
    consequence = "Only changes this offline account's own record on Accounts."
    params = {"account_id": doc["_id"], **updates}
    return await _create_proposal(uid, "update_offline_account", params, summary, consequence)


async def _exec_propose_delete_offline_account(uid: str, account_ref=None) -> dict:
    if not account_ref or not str(account_ref).strip():
        return _tool_error("account_ref required")
    resolved = await _resolve_offline_account_for_propose(uid, str(account_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    doc = resolved["account"]

    summary = f"Delete the offline account '{doc.get('name')}'"
    consequence = (
        "Removes this account and every ledger entry recorded on it. Any rule that fed this "
        "account will also be removed."
    )
    params = {"account_id": doc["_id"]}
    return await _create_proposal(uid, "delete_offline_account", params, summary, consequence, destructive=True)


async def _exec_propose_add_ledger_entry(
    uid: str, account_ref=None, amount=None, description=None, date_str=None, direction=None,
) -> dict:
    if not account_ref or not str(account_ref).strip():
        return _tool_error("account_ref required")
    resolved = await _resolve_offline_account_for_propose(uid, str(account_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    acc = resolved["account"]

    # Mirrors app.routers.manual_accounts._validate_entry_body exactly.
    clean_desc = str(description or "").strip()[:120]
    if not clean_desc:
        return _tool_error("description is required")
    try:
        amt = round(abs(float(amount)), 2)
    except (TypeError, ValueError):
        return _tool_error("amount must be a number")
    if amt <= 0:
        return _tool_error("amount must be greater than 0")
    if direction not in ("credit", "debit"):
        return _tool_error("direction must be 'credit' or 'debit'")
    if date_str:
        try:
            datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
        except ValueError:
            return _tool_error("date must be a valid ISO date/datetime")

    verb = "deposit" if direction == "credit" else "payment out"
    summary = f"Add a {_money(amt, 2)['formatted']} {verb} to '{acc.get('name')}': {clean_desc}"
    consequence = f"Adjusts {acc.get('name')}'s balance and adds this entry to its ledger."
    params = {
        "account_id": acc["_id"], "amount": amt, "description": clean_desc, "transaction_type": direction,
    }
    if date_str:
        params["date"] = str(date_str)
    return await _create_proposal(uid, "add_ledger_entry", params, summary, consequence)


async def _exec_propose_update_ledger_entry(
    uid: str, account_ref=None, entry_ref=None, amount=None, description=None, date_str=None, direction=None,
) -> dict:
    if not account_ref or not str(account_ref).strip():
        return _tool_error("account_ref required")
    if not entry_ref or not str(entry_ref).strip():
        return _tool_error("entry_ref required")
    resolved_acc = await _resolve_offline_account_for_propose(uid, str(account_ref).strip())
    if resolved_acc.get("ambiguous"):
        return resolved_acc
    if resolved_acc.get("error"):
        return _tool_error(resolved_acc["error"])
    acc = resolved_acc["account"]

    resolved_entry = await _resolve_ledger_entry_for_propose(uid, acc["_id"], str(entry_ref).strip())
    if resolved_entry.get("ambiguous"):
        return resolved_entry
    if resolved_entry.get("error"):
        return _tool_error(resolved_entry["error"])
    entry = resolved_entry["entry"]

    # Mirrors app.routers.manual_accounts._validate_entry_body exactly.
    updates: dict = {}
    if description is not None:
        clean_desc = str(description).strip()[:120]
        if not clean_desc:
            return _tool_error("description must not be blank")
        updates["description"] = clean_desc
    if amount is not None:
        try:
            amt = round(abs(float(amount)), 2)
        except (TypeError, ValueError):
            return _tool_error("amount must be a number")
        if amt <= 0:
            return _tool_error("amount must be greater than 0")
        updates["amount"] = amt
    if direction is not None:
        if direction not in ("credit", "debit"):
            return _tool_error("direction must be 'credit' or 'debit'")
        updates["transaction_type"] = direction
    if date_str is not None:
        try:
            datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
        except ValueError:
            return _tool_error("date must be a valid ISO date/datetime")
        updates["date"] = str(date_str)

    if not updates:
        return _tool_error("at least one of amount, description, date, or direction is required")

    label = entry.get("description")
    bits = []
    if "amount" in updates:
        bits.append(f"amount to {_money(updates['amount'], 2)['formatted']}")
    if "description" in updates and updates["description"] != label:
        bits.append(f"description to '{updates['description']}'")
    if "transaction_type" in updates:
        bits.append("to a deposit" if updates["transaction_type"] == "credit" else "to a payment out")
    if "date" in updates:
        bits.append("date")
    summary = f"Update the '{label}' ledger entry, " + ", ".join(bits) if bits else f"Update the '{label}' ledger entry"
    consequence = f"Adjusts {acc.get('name')}'s balance to match the change."
    params = {"account_id": acc["_id"], "entry_id": entry["id"], **updates}
    return await _create_proposal(uid, "update_ledger_entry", params, summary, consequence)


async def _exec_propose_delete_ledger_entry(uid: str, account_ref=None, entry_ref=None) -> dict:
    if not account_ref or not str(account_ref).strip():
        return _tool_error("account_ref required")
    if not entry_ref or not str(entry_ref).strip():
        return _tool_error("entry_ref required")
    resolved_acc = await _resolve_offline_account_for_propose(uid, str(account_ref).strip())
    if resolved_acc.get("ambiguous"):
        return resolved_acc
    if resolved_acc.get("error"):
        return _tool_error(resolved_acc["error"])
    acc = resolved_acc["account"]

    resolved_entry = await _resolve_ledger_entry_for_propose(uid, acc["_id"], str(entry_ref).strip())
    if resolved_entry.get("ambiguous"):
        return resolved_entry
    if resolved_entry.get("error"):
        return _tool_error(resolved_entry["error"])
    entry = resolved_entry["entry"]

    amount_fmt = _money(entry.get("amount"), 2)["formatted"]
    summary = f"Delete the ledger entry '{entry.get('description')}' ({amount_fmt}) from '{acc.get('name')}'"
    consequence = f"Reverses its effect on {acc.get('name')}'s balance."
    params = {"account_id": acc["_id"], "entry_id": entry["id"]}
    return await _create_proposal(uid, "delete_ledger_entry", params, summary, consequence)


async def _exec_propose_create_account_rule(
    uid: str, name=None, target_account_ref=None, match_type=None, match_value=None, sign=None,
    match_field=None, source_account_ref=None, backfill=None,
) -> dict:
    from app.routers.manual_accounts import MATCH_FIELDS as _MATCH_FIELDS
    from app.routers.manual_accounts import MATCH_TYPES as _MATCH_TYPES
    from app.routers.manual_accounts import SIGNS as _SIGNS

    clean_name = str(name or "").strip()[:60]
    if not clean_name:
        return _tool_error("name is required")
    if not target_account_ref or not str(target_account_ref).strip():
        return _tool_error("target_account_ref required")
    resolved_target = await _resolve_offline_account_for_propose(uid, str(target_account_ref).strip())
    if resolved_target.get("ambiguous"):
        return resolved_target
    if resolved_target.get("error"):
        return _tool_error(resolved_target["error"])
    target = resolved_target["account"]

    # Mirrors app.routers.manual_accounts._validate_rule_body exactly.
    if match_type not in _MATCH_TYPES:
        return _tool_error(f"match_type must be one of {sorted(_MATCH_TYPES)}")
    clean_value = str(match_value or "").strip()[:120]
    if not clean_value:
        return _tool_error("match_value is required")
    if sign not in _SIGNS:
        return _tool_error(f"sign must be one of {sorted(_SIGNS)}")
    clean_field = None
    if match_type == "description_equals":
        clean_field = match_field or "description"
        if clean_field not in _MATCH_FIELDS:
            return _tool_error(f"match_field must be one of {sorted(_MATCH_FIELDS)}")

    source_id = None
    source_name = None
    if source_account_ref and str(source_account_ref).strip():
        resolved_source = await _resolve_source_account_for_propose(uid, str(source_account_ref).strip())
        if resolved_source.get("ambiguous"):
            return resolved_source
        if resolved_source.get("error"):
            return _tool_error(resolved_source["error"])
        source_id = resolved_source.get("account_id")
        source_name = resolved_source.get("account_name")

    backfill_flag = bool(backfill)
    match_label = {
        "description_contains": f"description contains '{clean_value}'",
        "description_equals": f"{clean_field} is exactly '{clean_value}'",
        "category": f"category is '{clean_value}'",
    }[match_type]
    scope_label = f" from {source_name}" if source_name else ""
    backfill_label = "copying past matching transactions too" if backfill_flag else "starting from today"
    summary = (
        f"Create a rule that posts matching transactions{scope_label} to '{target.get('name')}' "
        f"when {match_label}, {backfill_label}"
    )
    consequence = "Every future matching transaction is mirrored onto this offline account automatically."
    params = {
        "name": clean_name, "target_account_id": target["_id"], "match_type": match_type,
        "match_value": clean_value, "sign": sign, "match_field": clean_field,
        "source_account_id": source_id, "backfill": backfill_flag,
    }
    return await _create_proposal(uid, "create_account_rule", params, summary, consequence)


async def _exec_propose_update_account_rule(
    uid: str, rule_ref=None, name=None, match_type=None, match_value=None, sign=None,
    match_field=None, source_account_ref=None, active=None, backfill=None,
) -> dict:
    from app.routers.manual_accounts import MATCH_FIELDS as _MATCH_FIELDS
    from app.routers.manual_accounts import MATCH_TYPES as _MATCH_TYPES
    from app.routers.manual_accounts import SIGNS as _SIGNS

    if not rule_ref or not str(rule_ref).strip():
        return _tool_error("rule_ref required")
    resolved = await _resolve_account_rule_for_propose(uid, str(rule_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    rule = resolved["rule"]

    # Mirrors app.routers.manual_accounts.update_rule's own merge-then-
    # validate shape, field by field.
    updates: dict = {}
    if name is not None:
        clean_name = str(name).strip()[:60]
        if not clean_name:
            return _tool_error("name must not be blank")
        updates["name"] = clean_name
    if match_type is not None:
        if match_type not in _MATCH_TYPES:
            return _tool_error(f"match_type must be one of {sorted(_MATCH_TYPES)}")
        updates["match_type"] = match_type
    if match_value is not None:
        clean_value = str(match_value).strip()[:120]
        if not clean_value:
            return _tool_error("match_value must not be blank")
        updates["match_value"] = clean_value
    if sign is not None:
        if sign not in _SIGNS:
            return _tool_error(f"sign must be one of {sorted(_SIGNS)}")
        updates["sign"] = sign
    if match_field is not None:
        if match_field not in _MATCH_FIELDS:
            return _tool_error(f"match_field must be one of {sorted(_MATCH_FIELDS)}")
        updates["match_field"] = match_field
    if source_account_ref is not None:
        if str(source_account_ref).strip():
            resolved_source = await _resolve_source_account_for_propose(uid, str(source_account_ref).strip())
            if resolved_source.get("ambiguous"):
                return resolved_source
            if resolved_source.get("error"):
                return _tool_error(resolved_source["error"])
            updates["source_account_id"] = resolved_source.get("account_id")
        else:
            updates["source_account_id"] = None
    if active is not None:
        updates["active"] = bool(active)
    if backfill is not None:
        updates["backfill"] = bool(backfill)

    if not updates:
        return _tool_error("at least one field to update is required")

    label = rule.get("name")
    bits = []
    if "name" in updates and updates["name"] != label:
        bits.append(f"name to '{updates['name']}'")
    if "match_value" in updates:
        bits.append(f"match value to '{updates['match_value']}'")
    if "match_type" in updates:
        bits.append(f"match type to {updates['match_type']}")
    if "sign" in updates:
        bits.append(f"sign to {updates['sign']}")
    if "source_account_id" in updates:
        bits.append("source account scope")
    if "backfill" in updates:
        bits.append("copying past matching transactions too" if updates["backfill"] else "pinning to today onwards")
    if "active" in updates:
        bits.append("pausing it" if not updates["active"] else "resuming it")
    summary = f"Update the '{label}' rule, " + ", ".join(bits) if bits else f"Update the '{label}' rule"
    consequence = "Changes take effect on this account's future postings; a paused rule stops mirroring new transactions."
    params = {"rule_id": rule["_id"], **updates}
    return await _create_proposal(uid, "update_account_rule", params, summary, consequence)


async def _exec_propose_delete_account_rule(uid: str, rule_ref=None) -> dict:
    if not rule_ref or not str(rule_ref).strip():
        return _tool_error("rule_ref required")
    resolved = await _resolve_account_rule_for_propose(uid, str(rule_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    rule = resolved["rule"]

    summary = f"Delete the rule '{rule.get('name')}'"
    consequence = "Any postings it made onto its target account are reversed."
    params = {"rule_id": rule["_id"]}
    return await _create_proposal(uid, "delete_account_rule", params, summary, consequence)


async def _exec_propose_disconnect_bank(uid: str, connection_or_account_ref=None) -> dict:
    if not connection_or_account_ref or not str(connection_or_account_ref).strip():
        return _tool_error("connection_or_account_ref required")
    resolved = await _resolve_bank_connection_for_propose(uid, str(connection_or_account_ref).strip())
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])

    bank_name = resolved["bank_name"]
    count = resolved["accounts_count"]
    plural = "account" if count == 1 else "accounts"
    summary = f"Disconnect {bank_name} ({count} {plural})"
    consequence = (
        "Removes every account and transaction from this connection. Your Safe-to-Spend and "
        "spending history may change once they're gone, and any bill or income prediction built "
        "from this bank stops working. This cannot be undone from Penny, you would need to "
        "reconnect the bank."
    )
    params = {"connection_id": resolved["connection_id"]}
    return await _create_proposal(uid, "disconnect_bank", params, summary, consequence, destructive=True)


async def _exec_propose_sync_now(uid: str) -> dict:
    summary = "Refresh your bank connections now"
    consequence = "Pulls the latest transactions and balances, may take a minute"
    return await _create_proposal(uid, "sync_now", {}, summary, consequence)


async def execute_tool(uid: str, name: str, args: dict) -> dict:
    """Dispatch one tool call to its executor. Never raises — every executor
    above already wraps its own engine call, and any error building the args
    themselves (a malformed `args` dict from the model) is caught here too."""
    args = args or {}
    try:
        if name == "get_safe_to_spend":
            return await _exec_get_safe_to_spend(uid)
        if name == "get_upcoming_bills":
            return await _exec_get_upcoming_bills(uid)
        if name == "search_transactions":
            return await _exec_search_transactions(
                uid,
                q=args.get("q"), category=args.get("category"), merchants=args.get("merchants"),
                date_from=args.get("date_from"), date_to=args.get("date_to"), txn_type=args.get("txn_type"),
            )
        if name == "get_accounts":
            return await _exec_get_accounts(uid)
        if name == "get_spend_verdict":
            return await _exec_get_spend_verdict(uid, args.get("period_offset") or 0)
        if name == "get_savings_position":
            return await _exec_get_savings_position(uid)
        if name == "get_debt_position":
            return await _exec_get_debt_position(uid)
        if name == "get_goals":
            return await _exec_get_goals(uid)
        if name == "check_affordability":
            return await _exec_check_affordability(uid, args.get("amount"), args.get("timeframe"))
        if name == "get_category_spend":
            return await _exec_get_category_spend(uid, args.get("category"), args.get("months"))
        if name == "get_insights":
            return await _exec_get_insights(uid)
        if name == "explain":
            return await _exec_explain(args.get("topic"))
        if name == "get_tax_position":
            return await _exec_get_tax_position(uid)
        if name == "get_today_brief":
            return await _exec_get_today_brief(uid)
        if name == "get_recurring_payments":
            return await _exec_get_recurring_payments(uid)
        if name == "get_account_activity":
            return await _exec_get_account_activity(
                uid, args.get("account_id_or_name"), args.get("days"),
                date_from=args.get("date_from"), date_to=args.get("date_to"),
            )
        if name == "get_mirror":
            return await _exec_get_mirror(uid)
        if name == "get_fill_candidates":
            return await _exec_get_fill_candidates(uid, args.get("account_id_or_name"))
        if name == "calculate":
            return await _exec_calculate(uid, args.get("expression"))
        if name == "propose_mirror_choice":
            return await _exec_propose_mirror_choice(uid, args.get("trait_id"), args.get("choice"))
        if name == "propose_dismiss_recurring":
            return await _exec_propose_dismiss_recurring(uid, args.get("key"))
        if name == "propose_restore_recurring":
            return await _exec_propose_restore_recurring(uid, args.get("key"))
        if name == "propose_add_planned":
            return await _exec_propose_add_planned(
                uid, args.get("name"), args.get("amount"), args.get("date"), args.get("account_id"),
            )
        if name == "propose_create_allocation":
            return await _exec_propose_create_allocation(
                uid, args.get("name"), args.get("amount_per_period"), args.get("fill_account_id"),
                args.get("match_type"), args.get("match_value"), args.get("recurrence"),
                args.get("effective_from"),
            )
        if name == "propose_create_commitment":
            return await _exec_propose_create_commitment(
                uid, args.get("name"), args.get("amount"), args.get("target_date"), args.get("funding_pots"),
            )
        if name == "propose_update_planned":
            return await _exec_propose_update_planned(
                uid, args.get("planned_ref"), args.get("name"), args.get("amount"), args.get("date"),
            )
        if name == "propose_delete_planned":
            return await _exec_propose_delete_planned(uid, args.get("planned_ref"))
        if name == "propose_update_allocation":
            return await _exec_propose_update_allocation(
                uid, args.get("allocation_ref"), args.get("name"), args.get("amount_per_period"),
                args.get("recurrence"), args.get("paused"),
            )
        if name == "propose_delete_allocation":
            return await _exec_propose_delete_allocation(uid, args.get("allocation_ref"))
        if name == "propose_update_commitment":
            return await _exec_propose_update_commitment(
                uid, args.get("commitment_ref"), args.get("name"), args.get("amount"), args.get("target_date"),
            )
        if name == "propose_delete_commitment":
            return await _exec_propose_delete_commitment(uid, args.get("commitment_ref"))
        if name == "propose_delete_checkpoint":
            return await _exec_propose_delete_checkpoint(uid, args.get("checkpoint_ref"))
        if name == "propose_skip_occurrence":
            return await _exec_propose_skip_occurrence(uid, args.get("key_or_name"), args.get("date"))
        if name == "propose_edit_occurrence":
            return await _exec_propose_edit_occurrence(
                uid, args.get("key_or_name"), args.get("date"), args.get("new_date"),
                args.get("new_amount"), args.get("scope"),
            )
        if name == "propose_clear_override":
            return await _exec_propose_clear_override(uid, args.get("key_or_name"), args.get("date"))
        if name == "propose_recategorise_transaction":
            return await _exec_propose_recategorise_transaction(
                uid, args.get("transaction_id"), args.get("merchant"), args.get("date"), args.get("amount"),
                args.get("new_category"), args.get("scope"),
            )
        if name == "propose_set_card_apr":
            # `_user_texts` is never a model-suppliable argument — it's
            # injected server-side by app.services.penny_agent's own
            # dispatch loop (see that module's own comment), threaded
            # through this same `args` dict rather than a new execute_tool
            # parameter so every other tool's call shape (and every
            # existing test double for execute_tool) stays untouched.
            return await _exec_propose_set_card_apr(
                uid, args.get("card_ref"), args.get("apr_pct"), args.get("_user_texts"),
            )
        if name == "propose_set_pay_period":
            return await _exec_propose_set_pay_period(uid, args.get("config"))
        if name == "propose_set_income":
            return await _exec_propose_set_income(uid, args.get("amount_annual"), args.get("bracket"))
        if name == "propose_set_pension_contributions":
            return await _exec_propose_set_pension_contributions(uid, args.get("amount_annual"))
        if name == "propose_set_child_benefit":
            return await _exec_propose_set_child_benefit(uid, args.get("receiving"))
        if name == "propose_set_debt_target":
            return await _exec_propose_set_debt_target(uid, args.get("months"))
        if name == "propose_set_debt_tracking_start":
            return await _exec_propose_set_debt_tracking_start(uid, args.get("date"))
        if name == "propose_set_cover_plan_exclusions":
            return await _exec_propose_set_cover_plan_exclusions(uid, args.get("account_refs"))
        if name == "propose_set_hide_balances":
            return await _exec_propose_set_hide_balances(uid, args.get("hidden"))
        if name == "propose_create_offline_account":
            return await _exec_propose_create_offline_account(
                uid, args.get("name"), args.get("account_type"), args.get("balance"),
            )
        if name == "propose_update_offline_account":
            return await _exec_propose_update_offline_account(
                uid, args.get("account_ref"), args.get("name"), args.get("account_type"), args.get("balance"),
            )
        if name == "propose_delete_offline_account":
            return await _exec_propose_delete_offline_account(uid, args.get("account_ref"))
        if name == "propose_add_ledger_entry":
            return await _exec_propose_add_ledger_entry(
                uid, args.get("account_ref"), args.get("amount"), args.get("description"),
                args.get("date"), args.get("direction"),
            )
        if name == "propose_update_ledger_entry":
            return await _exec_propose_update_ledger_entry(
                uid, args.get("account_ref"), args.get("entry_ref"), args.get("amount"),
                args.get("description"), args.get("date"), args.get("direction"),
            )
        if name == "propose_delete_ledger_entry":
            return await _exec_propose_delete_ledger_entry(uid, args.get("account_ref"), args.get("entry_ref"))
        if name == "propose_create_account_rule":
            return await _exec_propose_create_account_rule(
                uid, args.get("name"), args.get("target_account_ref"), args.get("match_type"),
                args.get("match_value"), args.get("sign"), args.get("match_field"),
                args.get("source_account_ref"), args.get("backfill"),
            )
        if name == "propose_update_account_rule":
            return await _exec_propose_update_account_rule(
                uid, args.get("rule_ref"), args.get("name"), args.get("match_type"),
                args.get("match_value"), args.get("sign"), args.get("match_field"),
                args.get("source_account_ref"), args.get("active"), args.get("backfill"),
            )
        if name == "propose_delete_account_rule":
            return await _exec_propose_delete_account_rule(uid, args.get("rule_ref"))
        if name == "propose_disconnect_bank":
            return await _exec_propose_disconnect_bank(uid, args.get("connection_or_account_ref"))
        if name == "propose_sync_now":
            return await _exec_propose_sync_now(uid)
        return _tool_error(f"unknown tool: {name}")
    except Exception as e:
        logger.exception("penny_tools: execute_tool(%s) crashed for %s", name, uid)
        return _tool_error(f"tool failed: {e}")
