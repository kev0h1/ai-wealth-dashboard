"""Can-I-afford-X quick-fire Q&A endpoint.

Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md). Owner
decision, made the same day the original phased plan shipped: the first
live question asked of the phased build, "How can I improve my entertainment
spending", was captured by the deterministic ladder's category-synonym match
on "entertainment" and confidently answered with a current-period total, a
different question than the one asked, and the tool-calling loop that could
have actually reasoned about it was never even consulted (it only ran as a
fallback after the ladder had already had its turn). A route that answers
questions it wasn't built to understand is worse than a slower path that
reasons about them properly, so the ~4,900-line hand-built ladder (synonym
tables, per-domain handlers, per-screen vocabulary, follow-up-route
inheritance, the out-of-scope gate) is gone outright. What remains here is
five deterministic short-circuits that cost the user nothing when they fire
(greeting, length/API-key gates, scenario detection) plus the tool-calling
agent loop (app.services.penny_agent) for everything else, with the
loop-failure/off-topic case falling back to a fixed refusal.

Deterministic fact-gathering still underlies every number Penny ever states —
it just now lives inside the engines the tool catalog
(app.services.penny_tools) calls, plus app.services.affordability for the
"can I afford X" arithmetic specifically, rather than inline in this router.
FCA doctrine, unchanged throughout: facts only, never "you should".
"""
import logging
import re
import statistics
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage
from app.db.collections import commitments_col, penny_proposals_col, preferences_col
from app.routers.analytics import compute_safe_to_spend
from app.routers.scenario import looks_like_scenario, parse_question
from app.services.affordability import _nothing_spare_line
from app.services.categories import get_category_kinds, is_discretionary
from app.services.penny_agent import run_penny_agent

# Same convention as app.routers.analytics (this module's own neighbour,
# already imported above): module-level stdlib logger, `.exception()` inside
# an except block so an outage is visible in `journalctl -u wealth-api`
# instead of silently swallowed behind a good-enough fallback reply.
logger = logging.getLogger(__name__)

router = APIRouter(tags=["can-i"])

# House-style guardrail: extracted to app.services.copy_style so every
# surface phrasing LLM output shares exactly one em-dash/en-dash backstop
# (see that module's docstring for the full rationale). Kept as a thin
# local delegation, not a straight `from ... import house_style`, so this
# file's public behaviour (the name `_house_style` other code in this
# module already calls) stays byte-identical.
from app.services.copy_style import house_style as _house_style


def _fmt_gbp(amount: float, decimals: int = 0) -> str:
    """£ format matching the app-wide convention: a Unicode minus (−), never
    a hyphen, for negative money (see SpendHeader.tsx / SafeToSpendCard.tsx)."""
    amount = amount or 0.0
    return f"−£{abs(amount):,.{decimals}f}" if amount < 0 else f"£{amount:,.{decimals}f}"


def _round5(value: float) -> int:
    """Round to the nearest £5 — the "round" figure the chip-seeding rules ask
    for, never a jagged pence amount in a tappable suggestion."""
    return int(round(value / 5.0)) * 5


# ── Greeting detection (deterministic, no LLM, no quota) ─────────────────────
# Owner feedback: "there should be some responses that can be answered
# without going to the llm" — a greeting is the clearest case. It is not an
# out-of-scope FINANCIAL question, it is not a question at all, so it must
# never reach the LLM, or the quota counter.
#
# Anchored on the WHOLE trimmed question (^...$, trailing punctuation/
# whitespace only) — never containment. "hey can I spend £20" must NOT match:
# the alternation below only ever consumes the greeting word(s) themselves,
# so anything left over ("can I spend £20") fails the trailing
# `[\s!.?]*$` and the whole anchored match fails, falling through to the
# length gate and the tool loop exactly as any other question would.
_GREETING_PHRASES = [
    r"hey(?:\s+there)?",
    r"hi(?:\s+there)?",
    r"hello(?:\s+there)?",
    r"hiya",
    r"yo",
    r"howdy",
    r"good\s+morning",
    r"good\s+afternoon",
    r"good\s+evening",
    r"what'?s\s+up",
    r"wassup",
    r"sup",
]
_GREETING_RE = re.compile(
    r"^(?:" + "|".join(_GREETING_PHRASES) + r")[\s!.?]*$",
    re.IGNORECASE,
)

# Fixed string, vary nothing — never LLM-authored, never drifts. Calm, not
# chirpy; invites a real money question rather than continuing the
# small-talk. No em-dash (house style).
_GREETING_REPLY = (
    "Hey. Ask me about your spending, your plans, or your tax, and I'll "
    "answer from your live numbers."
)


def _is_greeting(question: str) -> bool:
    """True when the question IS a greeting and nothing else — see
    _GREETING_RE's own comment for the anchoring rationale."""
    return bool(_GREETING_RE.match(question))


def _greeting_response() -> dict:
    """headline=None is deliberate, not an oversight: PennyConversation.tsx's
    `ask()` already has a branch for exactly this shape — `else if
    (res.headline) {...bold verdict...} else {...degraded: true...}` — a
    headline-less reply renders as plain body text in the existing bubble
    shell (the same branch a phrasing-call failure elsewhere in this app
    degrades to), so this reuses an existing render path rather than
    inventing a new one. No LLM call and no `increment_ai_chat_usage` here:
    a greeting costs the user nothing."""
    return {
        "reply": _house_style(_GREETING_REPLY),
        "headline": None,
        "facts": [],
        "explainer": False,
        "topic": None,
        "out_of_scope": False,
    }


# ── `screen` — a STRUCTURED ENUM, not free text — page-awareness ────────────
# The frontend sets this itself from its own route table (one of a fixed,
# closed set of tab names); the user never types it, and it can never carry
# a £ figure, a date, or an instruction. Handed straight to
# app.services.penny_agent.run_penny_agent as grounding for the model (see
# that module's `_build_user_content`) — this router itself makes no routing
# decision on it any more, it only validates the shape before passing it on.
_KNOWN_SCREENS = frozenset({
    "planning", "tax", "home", "spend", "insights", "grow", "debt", "accounts", "other",
})


def _valid_screen(raw) -> str | None:
    """Validate the optional `screen` field against the known, closed set the
    frontend's tab router actually uses. Anything else — missing, wrong
    type, a typo, a future/removed screen name — becomes None."""
    return raw if isinstance(raw, str) and raw in _KNOWN_SCREENS else None


# ONE fixed sentence, appended to the out-of-scope refusal ONLY when
# `screen` is known — points a refused question at a page-explainer answer,
# still reachable via the loop's explain(topic) tool even though this
# router no longer routes to it directly.
_OUT_OF_SCOPE_SCREEN_HINT = " You can also ask what this page shows."


@router.post("/can-i")
async def can_i(body: dict, user: dict = Depends(current_user)):
    question = (body.get("question") or "").strip()

    # ── 1. Greeting short-circuit — deterministic, no LLM, no quota. Checked
    # BEFORE the length gate immediately below, on purpose: "Hi" is 2
    # characters and would otherwise trip the 3-160 400 error before ever
    # reaching _is_greeting, and a greeting is not a malformed question, it
    # isn't a question at all. Also checked before the OPENROUTER_API_KEY
    # guard below, since answering a greeting needs no LLM and so has no
    # dependency on that key being configured.
    if _is_greeting(question):
        return _greeting_response()

    # ── 2. Length gate and API-key guard — unchanged ─────────────────────
    if not (3 <= len(question) <= 160):
        raise HTTPException(400, "question must be 3-160 characters")
    if not OPENROUTER_API_KEY:
        raise HTTPException(500, "AI not configured")

    # ── 3. Context/screen/history validation — unchanged shape ──────────
    # `context` is a short client-supplied string describing what screen the
    # user was looking at when they asked ("£165 free, 4 days left") — LLM
    # grounding only, handed straight through to run_penny_agent.
    raw_context = body.get("context")
    context = raw_context if isinstance(raw_context, str) else ""
    screen = _valid_screen(body.get("screen"))

    raw_history = body.get("history") or []
    history: list[dict] = []
    if isinstance(raw_history, list):
        for entry in raw_history[-6:]:
            if not isinstance(entry, dict):
                continue
            role = entry.get("role")
            content = entry.get("content")
            if role not in ("user", "assistant") or not isinstance(content, str):
                continue
            history.append({"role": role, "content": content[:300]})

    uid = user["email"]
    # ── 4. Usage-quota check — unchanged ─────────────────────────────────
    await check_ai_chat_limit(uid)

    # ── 5. Scenario short-circuit — deterministic routing, no LLM
    # judgement, byte-identical to before this rebuild ──────────────────
    # looks_like_scenario (app/routers/scenario.py) is a hard rule: an ONGOING
    # or FUTURE-DATED money change (a new standing cost, a cancellation, an
    # income change) routes to the scenario simulator's slot extraction
    # instead of the tool loop below. Runs BEFORE the loop, so a
    # scenario-shaped question never reaches it. Shares parse_question with
    # POST /scenario/parse rather than a second copy of extraction. This
    # never simulates: the user confirms/edits slots via the confirm card
    # before /scenario/run is ever called.
    if looks_like_scenario(question):
        result = await parse_question(uid, question)
        items = result.get("items") or []
        clarify = result.get("clarify")
        if clarify:
            reply = clarify
            headline = "Tell me a bit more"
        elif len(items) == 1:
            subject = items[0].get("label") or "this change"
            reply = f"Got it, {subject}. Check the details below and I'll run the numbers."
            headline = "Here's what I understood"
        else:
            subject = f"these {len(items)} changes"
            reply = f"Got it, {subject}. Check the details below and I'll run the numbers."
            headline = "Here's what I understood"
        return {
            "scenario": True,
            "items": items,
            "rejected": result.get("rejected") or [],
            "prefilled": result.get("prefilled") or False,
            "clarify": clarify,
            "reply": _house_style(reply),
            "headline": _house_style(headline),
            "facts": [],
            "explainer": False,
            "topic": None,
            "out_of_scope": False,
        }

    # ── 6. THE TOOL LOOP — loop-first, not a fallback any more. Every
    # question that isn't a greeting, isn't malformed, and isn't scenario-
    # shaped reaches app.services.penny_agent.run_penny_agent, which owns
    # the OpenRouter tool-calling cycle over the read-only catalog in
    # app.services.penny_tools. Its failure contract (see that module's own
    # docstring) is a dict on success, None on ANY failure whatsoever
    # (provider error, timeout, round/budget cap, unparseable output, or the
    # model's own OUT_OF_SCOPE decline) — never raises. Usage is only ever
    # incremented here, exactly once, on the success path; the agent module
    # itself never touches the quota counter.
    agent_result = await run_penny_agent(uid, question, history, screen, context)
    if agent_result is not None:
        # ── Penny Agent Mode v1 (owner decision, 2026-08-30) — two new
        # non-answer outcomes ahead of the ordinary headline/reply shape,
        # both additive on the wire (see PENNY_TOOLS.md's "Write tools
        # (propose-only)" section and frontend/lib/api.ts's CanIResponse).
        if agent_result.get("consent_required"):
            # No usage charge: the user asked for an action, not an answer,
            # and got neither — nothing was consulted, nothing decided. See
            # app.services.penny_agent's own consent-gate comment for why
            # this can only ever fire for a genuinely non-consenting user.
            return {
                "reply": _house_style(
                    "I can set things up for you, tap allow and I'll always "
                    "check with you before anything is created."
                ),
                "headline": "Want me to be able to do this?",
                "facts": [],
                "explainer": False,
                "topic": None,
                "out_of_scope": False,
                "consent_required": True,
            }
        if agent_result.get("proposal"):
            # A propose-only write tool built a complete, final proposal —
            # summary/consequence are already deterministic, house-styled
            # copy (see app.services.penny_tools._create_proposal), never
            # LLM-phrased, so they're safe to surface directly as the
            # headline/reply pair alongside the structured `proposal` block
            # the frontend's confirm card renders from.
            await increment_ai_chat_usage(uid)
            proposal = agent_result["proposal"]
            return {
                "reply": _house_style(proposal["consequence"]),
                "headline": _house_style(proposal["summary"]),
                "facts": [],
                "explainer": False,
                "topic": None,
                "out_of_scope": False,
                "proposal": proposal,
            }
        await increment_ai_chat_usage(uid)
        return {
            "reply": _house_style(agent_result["reply"]),
            "headline": _house_style(agent_result["headline"]),
            "facts": [],
            "explainer": False,
            "topic": None,
            "out_of_scope": False,
        }

    # ── 7. Deterministic refusal fallback — the loop returned None (a real
    # failure, or a genuinely off-topic question). Byte-identical shape to
    # the pre-rebuild refusal: out_of_scope True, no usage charge.
    example_amount = 50
    timeframe = _weekend_or_week()
    try:
        sts_preview = await compute_safe_to_spend(uid)
        if sts_preview.get("status") != "insufficient_data":
            preview_chip = _headroom_chip(float(sts_preview.get("safe_to_spend") or 0.0))
            if preview_chip:
                m = re.search(r"£(\d+)", preview_chip["label"])
                if m:
                    example_amount = int(m.group(1))
    except Exception:
        pass
    worked_example = f"Can I spend £{example_amount} {timeframe}?"
    # Copy fix, 2026-08-31 (owner, verbatim, after the same generic refusal
    # fired twice on genuinely answerable questions): this line under-
    # described Penny's real breadth post-agent-mode. She now reads a wide
    # tool catalog (accounts, transactions, plans, envelopes, debt, tax,
    # insights, the Mirror) and can PROPOSE several actions for the user to
    # confirm (see PENNY_TOOLS.md's "Write tools" section) — the old
    # "spending, affordability and UK tax questions" line described roughly
    # a third of that. Kept honest about what she does NOT do (never
    # executes anything herself, still says "set up" not "do").
    reply_text = (
        "I answer from your live numbers, covering your accounts, spending, "
        f'plans and UK tax, and can set some things up for you to confirm, try "{worked_example}".'
    )
    # Screen-flavoured nudge: ONE fixed sentence, never a per-screen variant,
    # appended only when `screen` is known.
    if screen:
        reply_text += _OUT_OF_SCOPE_SCREEN_HINT
    return {
        "reply": reply_text,
        "headline": "That one's outside what I can work out from your numbers.",
        "facts": [],
        "explainer": False,
        "topic": None,
        "out_of_scope": True,
    }


# ── GET /can-i/suggestions — personalised chip seeding ───────────────────────
# Every chip below is engine-owned and deterministic: no LLM call, no new
# heavy queries — Chip A reuses the cached safe-to-spend path Can-I already
# calls, Chip B reuses pace.load_spend_txns, Chip C reuses commitments.py's
# own pot-ledger/slice maths so a chip can never quote a number Planning
# would disagree with. Every chip's phrasing is answerable by the /can-i tool
# loop above (an amount the model can extract, or a "name a thing, no price"
# question it can ask a clarifying follow-up on).
#
# Unchanged by the loop-first rebuild — this endpoint never routed through
# the deleted ladder, it only ever composed chip labels from engine reads.

_CHIP_B_LOOKBACK_DAYS = 90
_CHIP_B_MIN_COUNT = 3        # occurrences needed to call a category "recurring"
_CHIP_B_MAX_MAD_RATIO = 0.5  # median absolute deviation / median — the
                             # "stable typical amount" bar; Golf (~0.37 on
                             # real data) passes, Eating Out's long tail
                             # (~0.52) does not.
_CHIP_B_EXCLUDE = {"Subscriptions"}  # fixed recurring cost, not a spend
                                     # DECISION — "can I afford another
                                     # subscription" doesn't fit the
                                     # weekend-spend framing.
SESSION_STYLE_CATEGORIES = {
    "golf", "padel", "tennis", "squash", "gym", "yoga", "pilates",
    "swimming", "football", "climbing", "boxing", "spin", "crossfit",
}

_FALLBACK_CHIPS = [
    "How much can I spend on a gift?",
    "Can I afford a takeaway this week?",
    "How much could I put toward savings this month?",
]

# Below this, free is too tight (or negative) to suggest ANY new spend or
# top-up — a "£117 on health?" chip at −£144 free is temptation, not
# reassurance. Shared by every spend-shaped chip candidate (headroom,
# discretionary-vocabulary, commitment top-up, cold-start padding) so the
# gate can never drift between them.
_CHIP_SPEND_FLOOR = 20

_REASSURANCE_CHIPS = [
    "How am I doing until payday?",
    "What's still due before payday?",
]


def _weekend_or_week() -> str:
    """"this week" early in the pay-week (Mon-Wed), "this weekend" once it's
    close enough to be the natural next spend occasion (Thu-Sun)."""
    return "this week" if date.today().weekday() < 3 else "this weekend"


def _headroom_chip(free: float) -> dict | None:
    """Chip A — a round 15-25% (fixed at 20%) of current free, £5-rounded.
    Only offered when free > £20 (seeding rule)."""
    if free <= _CHIP_SPEND_FLOOR:
        return None
    amount = max(5, _round5(free * 0.20))
    return {"label": f"Can I spend £{amount} {_weekend_or_week()}?"}


def _scaled_fallback_chip(free: float) -> dict | None:
    """Cold-start padding chip — same shape as Chip A. Gated behind the same
    _CHIP_SPEND_FLOOR as every other spend-shaped chip: a tight or negative
    `free` gets a reassurance chip instead of a floored-at-£10 spend
    suggestion (see BLOCKER 2 — a spend chip at negative headroom is
    temptation, not reassurance)."""
    if free <= _CHIP_SPEND_FLOOR:
        return None
    amount = max(10, _round5(free * 0.20))
    return {"label": f"Can I spend £{amount} {_weekend_or_week()}?"}


async def _discretionary_chip_candidate(uid: str, kind_map) -> tuple[str, float] | None:
    """Chip B's "their vocabulary" source: the top discretionary category by
    recent recurrence whose amounts are stable enough to call "typical".
    Ranks by (count desc, stability asc) so the most frequent stable category
    wins outright, and the tightest-spread category wins any count tie."""
    from app.services.pace import load_spend_txns

    end = date.today()
    start = end - timedelta(days=_CHIP_B_LOOKBACK_DAYS)
    txns = await load_spend_txns(uid, start, end, kind_map=kind_map)

    by_cat: dict[str, list[float]] = {}
    for t in txns:
        if t["amount"] <= 0:
            continue  # refunds/credits net negative — not a spend occurrence
        cat = t["category"]
        if cat in _CHIP_B_EXCLUDE or not is_discretionary(kind_map, cat):
            continue
        by_cat.setdefault(cat, []).append(t["amount"])

    best: tuple[str, float] | None = None
    best_key: tuple[int, float] | None = None
    for cat, amounts in by_cat.items():
        if len(amounts) < _CHIP_B_MIN_COUNT:
            continue
        med = statistics.median(amounts)
        if med <= 0:
            continue
        mad = statistics.median([abs(a - med) for a in amounts])
        ratio = mad / med
        if ratio > _CHIP_B_MAX_MAD_RATIO:
            continue
        key = (-len(amounts), ratio)
        if best_key is None or key < best_key:
            best_key, best = key, (cat, round(med))
    return best


def _chip_b_label(category: str, typical_amount: float) -> str:
    cat_lower = category.strip().lower()
    if cat_lower in SESSION_STYLE_CATEGORIES:
        return f"Can I book another {cat_lower} session?"
    return f"Can I spend £{typical_amount:,.0f} on {cat_lower}?"


async def _commitment_chip_candidate(uid: str) -> tuple[str, float] | None:
    """Chip C's "their plan" source: the oldest active commitment's name and
    a round ~20-30% (fixed at 25%) top-up on its per_period_slice, floored at
    £10. Reuses commitments.py's own pot-ledger + slice maths (a single-doc
    ledger is exact for that one doc) so this can never disagree with what
    Planning shows for the same plan."""
    from app.routers.commitments import (
        _pay_cfg as _commitments_pay_cfg,
        _pot_progress_and_slice,
        compute_pot_ledger,
    )

    doc = await commitments_col.find_one(
        {"user_id": uid, "status": "active"}, sort=[("created_at", 1)]
    )
    if not doc:
        return None
    cfg = await _commitments_pay_cfg(uid)
    ledger = await compute_pot_ledger(uid, docs=[doc])
    info = await _pot_progress_and_slice(doc, cfg, ledger, date.today())
    slice_amount = float(info.get("per_period_slice") or 0)
    if slice_amount <= 0:
        return None
    top_up = max(10, _round5(slice_amount * 0.25))
    name = str(doc.get("name") or "").strip() or "your plan"
    return name, top_up


@router.get("/can-i/suggestions")
async def can_i_suggestions(user: dict = Depends(current_user)):
    uid = user["email"]
    sts = await compute_safe_to_spend(uid)
    if sts.get("status") == "insufficient_data":
        return {
            "chips": [
                {"label": "Can I spend £50 this weekend?"},
                {"label": "How much can I spend on a gift?"},
            ],
            "context_line": "Connect an account to see your numbers",
        }

    free = float(sts.get("safe_to_spend") or 0.0)
    days_left = int(sts.get("days_until_payday") or 0)
    # free can be <= 0 (net of unpaid card growth) — never show a negative
    # "free" figure here either; see app.services.affordability._nothing_
    # spare_line for the shared phrasing this borrows.
    if free > 0:
        context_line = f"{_fmt_gbp(free)} free · {days_left} day{'s' if days_left != 1 else ''} left"
    else:
        payday_label = None
        next_payday = sts.get("next_payday")
        if next_payday:
            try:
                payday_label = date.fromisoformat(str(next_payday)[:10]).strftime("%a %-d %b")
            except ValueError:
                payday_label = None
        context_line = _nothing_spare_line(payday_label, sts.get("short_reason"))

    chips: list[dict] = []

    if free > _CHIP_SPEND_FLOOR:
        # ── Comfortable headroom — the normal spend-shaped chip set ─────────
        headroom = _headroom_chip(free)
        if headroom:
            chips.append(headroom)

        try:
            kind_map = await get_category_kinds(uid)
            candidate = await _discretionary_chip_candidate(uid, kind_map)
            if candidate:
                cat, typical = candidate
                chips.append({"label": _chip_b_label(cat, typical)})
        except Exception:
            pass

        try:
            commitment = await _commitment_chip_candidate(uid)
            if commitment:
                name, top_up = commitment
                chips.append({"label": f"Can I put £{top_up:,.0f} extra toward {name}?"})
        except Exception:
            pass

        # ── Cold start — pad with neutral, assumption-free fallbacks ────────
        if len(chips) < 2:
            seen = {c["label"] for c in chips}
            fallback_chip = _scaled_fallback_chip(free)
            pool = ([fallback_chip["label"]] if fallback_chip else []) + _FALLBACK_CHIPS
            for label in pool:
                if len(chips) >= 2:
                    break
                if label in seen:
                    continue
                chips.append({"label": label})
                seen.add(label)
    else:
        # ── Tight or negative headroom — reassurance, never temptation ──────
        # BLOCKER 2: no headroom/discretionary/commitment-top-up chip below
        # the floor — those all suggest NEW spend or an extra commitment
        # contribution, which is exactly wrong when the user is already
        # short. Both reassurance chips are answerable by the tool loop from
        # the always-present safe-to-spend/bills facts, no amount required.
        for label in _REASSURANCE_CHIPS:
            chips.append({"label": label})

    return {"chips": chips[:3], "context_line": context_line}


# ── Penny Agent Mode v1 — propose/execute/cancel + one-time consent ────────
# Owner decision, 2026-08-30 (see PENNY_TOOLS.md's "Write tools
# (propose-only)" section). CORE PRINCIPLE: Penny PROPOSES, never executes —
# every write tool in app.services.penny_tools builds a stored, validated
# proposal (penny_proposals_col), and the endpoints below are the ONLY code
# path that ever turns one into a real write. Each executor replays the
# proposal's own already-validated `params` through the SAME router-level
# function the app's own confirm sheet calls for that action (re-validating
# ownership/conflicts live, exactly as a normal user request would — nothing
# here bypasses those checks), never a second, parallel write path.

async def _execute_mirror_choice(uid: str, params: dict) -> dict:
    from app.routers.behaviour import ChoiceBody
    from app.routers.behaviour import set_mirror_choice as _route_set_mirror_choice

    body = ChoiceBody(trait_id=params["trait_id"], choice=params["choice"])
    return await _route_set_mirror_choice(body, user={"email": uid})


async def _execute_dismiss_recurring(uid: str, params: dict) -> dict:
    from app.routers.analytics import dismiss_recurring as _route_dismiss_recurring

    return await _route_dismiss_recurring({"key": params["key"]}, user={"email": uid})


async def _execute_restore_recurring(uid: str, params: dict) -> dict:
    from app.routers.analytics import restore_recurring as _route_restore_recurring

    return await _route_restore_recurring({"key": params["key"]}, user={"email": uid})


async def _stamp_created_via(col, doc_id: str, into: dict) -> None:
    """Stamps `created_via: "penny"` on a just-created artefact (allocation/
    planned/commitment doc — the origin badge, owner decision 3 of 4), then
    mirrors the same field onto `into` (the execute response) so the
    frontend sees the badge on the very first response, not only on a later
    GET (list/detail routes for all three already expose the field — see
    `_serialise` in allocations.py/commitments.py and list_planned_expenses
    in planned.py)."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(doc_id)
    except (InvalidId, TypeError):
        oid = doc_id
    await col.update_one({"_id": oid}, {"$set": {"created_via": "penny"}})
    into["created_via"] = "penny"


async def _execute_add_planned(uid: str, params: dict) -> dict:
    from app.db.collections import planned_expenses_col
    from app.routers.planned import create_planned_expense as _route_create_planned

    body = {
        "name": params["name"], "amount": params["amount"], "date": params["date"],
        "account_id": params.get("account_id"),
    }
    result = await _route_create_planned(body, user={"email": uid})
    await _stamp_created_via(planned_expenses_col, result["planned"]["id"], result["planned"])
    return result


async def _execute_create_allocation(uid: str, params: dict) -> dict:
    from app.db.collections import allocations_col
    from app.routers.allocations import create_allocation as _route_create_allocation

    result = await _route_create_allocation(dict(params), user={"email": uid})
    await _stamp_created_via(allocations_col, result["id"], result)
    return result


async def _execute_create_commitment(uid: str, params: dict) -> dict:
    from app.db.collections import commitments_col as _commitments_col_execute
    from app.routers.commitments import create_commitment as _route_create_commitment

    # source="can_i" — the existing commitments.py source enum already
    # anticipates a Penny-originated commitment; created_via="penny" (below)
    # is the separate, more specific origin-badge stamp the owner asked for.
    body = {**params, "source": "can_i"}
    result = await _route_create_commitment(body, user={"email": uid})
    await _stamp_created_via(_commitments_col_execute, result["id"], result)
    return result


async def _execute_recategorise_transaction(uid: str, params: dict) -> dict:
    """Owner amendment, 2026-08-30 (see PENNY_TOOLS.md "Write tools"
    section): user-initiated recategorisation joins the propose/confirm set,
    dispatched by scope to the SAME code path the app's own transaction
    sheet uses for each choice — `just_once` is a plain `PATCH
    /transactions/{id}` (`update_transaction`, transactions.py), `always` is
    the sheet's own "Always file X as Y?" propagation offer, `POST /rules`
    (`add_rule`, categories.py). Either way this is the engine's ordinary
    learning path for a USER correction (ENGINE.md's Two Inputs Rule) — a
    Penny-originated correction is still a user correction, nothing here is
    a second, parallel write path.

    `add_rule` is Pro-gated in the real app (`Depends(require_tier(Tier.
    PRO))`); calling the router function directly bypasses that FastAPI
    dependency silently (a plain default-parameter value, never resolved
    outside a real request), so the tier check is re-run explicitly here —
    already checked once at propose time too
    (`penny_tools._exec_propose_recategorise_transaction`), re-checked here
    in case the subscription lapsed in between.

    `scope="always"` PATCHes the primary transaction FIRST, then creates
    the rule — the same two-call sequence TeachingSheet's own
    `commitSpend` (PATCH) followed by `handleAlways` (POST /rules) already
    follows, never a single combined step. This matters beyond just fidelity
    to the real flow: `add_rule`'s bulk pass only touches rows whose
    `custom_category` is still `None`, so PATCHing the primary row first is
    what correctly excludes it from that bulk pass (it's handled directly,
    not swept up as one of the "past" matches) — see
    `penny_tools._exec_propose_recategorise_transaction`'s own `exclude_id`
    comment for why the proposal's blast-radius preview already assumed
    this ordering."""
    scope = params.get("scope")
    if scope == "just_once":
        from app.routers.transactions import update_transaction as _route_update_transaction

        body = {"category": params["new_category"]}
        return await _route_update_transaction(params["transaction_id"], body, user={"email": uid})

    if scope == "always":
        from app.core.subscription import Tier, get_subscription

        sub = await get_subscription(uid)
        if sub.tier < Tier.PRO:
            raise HTTPException(
                402,
                {
                    "code": "UPGRADE_REQUIRED", "current_tier": sub.tier_name,
                    "required_tier": "pro",
                    "message": "This feature requires a Pro subscription.",
                },
            )
        from app.routers.categories import add_rule as _route_add_rule
        from app.routers.transactions import update_transaction as _route_update_transaction

        patch_result = await _route_update_transaction(
            params["transaction_id"], {"category": params["new_category"]}, user={"email": uid},
        )
        body = {
            "description": f"{params.get('merchant_label') or 'merchant'} → {params['new_category']}",
            "pattern": params["pattern"],
            "category": params["new_category"],
        }
        rule_result = await _route_add_rule(body, user={"email": uid})
        return {"transaction": patch_result, "rule": rule_result}

    raise HTTPException(500, f"unknown recategorise_transaction scope '{scope}'")


async def _execute_set_card_apr(uid: str, params: dict) -> dict:
    """Owner doctrine amendment #2, 2026-08-30 (see PENNY_TOOLS.md's "Write
    tools (propose-only)" table): replays through card_terms.py's own
    `save_card_terms`, the SAME function CardTermsSheet's save calls.

    save_card_terms REPLACES the whole terms document on every save (its
    own docstring: "the full document is replaced" — this is deliberate,
    it's how a legacy-shaped doc gets migrated the first time a user
    re-saves). Passing a bare {"apr_pct": ...} body straight through would
    therefore silently WIPE any already-recorded 0% promo window or BT
    offer — exactly the "must not clobber recorded promo segments" risk
    this executor exists to avoid. So this is a genuine read-modify-write:
    the existing doc (if any) is read first via card_terms.py's own
    `_serialize_terms` (which already maps a legacy on_promo/promo_kind/
    promo_end doc into the current `promos` list shape, so an old-shaped
    doc is carried forward correctly too), every other field is passed
    through UNCHANGED, and only apr_pct changes.

    Reads through `app.routers.card_terms`'s OWN `card_terms_col` name
    (not a fresh `app.db.collections` import) deliberately: it's the same
    module-level reference `save_card_terms` itself reads/writes through,
    so this pre-read can never be looking at a different collection object
    than the save that follows it."""
    from app.routers.card_terms import CardTermsBody as _CardTermsBody
    from app.routers.card_terms import _serialize_terms as _card_serialize_terms
    from app.routers.card_terms import card_terms_col as _card_terms_col_execute
    from app.routers.card_terms import save_card_terms as _route_save_card_terms

    account_id = params["account_id"]
    existing_doc = await _card_terms_col_execute.find_one({"_id": f"{uid}:{account_id}"})
    existing = _card_serialize_terms(existing_doc) or {}
    body = _CardTermsBody(
        status="confirmed",
        apr_pct=params["apr_pct"],
        promos=existing.get("promos") or [],
        min_payment_note=existing.get("min_payment_note"),
        bt_offers=existing.get("bt_offers") or [],
        usage=existing.get("usage"),
        product_key=existing.get("product_key"),
    )
    return await _route_save_card_terms(account_id, body, user={"email": uid})


_PROPOSAL_EXECUTORS = {
    "mirror_choice":              _execute_mirror_choice,
    "dismiss_recurring":          _execute_dismiss_recurring,
    "restore_recurring":          _execute_restore_recurring,
    "add_planned":                _execute_add_planned,
    "create_allocation":          _execute_create_allocation,
    "create_commitment":          _execute_create_commitment,
    "recategorise_transaction":   _execute_recategorise_transaction,
    "set_card_apr":               _execute_set_card_apr,
}


@router.post("/penny/agent-consent")
async def grant_agent_consent(user: dict = Depends(current_user)):
    """The ONE-TIME consent moment (owner decision 2 of 4, 2026-08-30):
    grants `penny_agent_consent` on preferences, the field
    app.services.penny_agent checks before ever offering a propose-only
    write tool to the model, or accepting the model calling one. Idempotent
    — granting again just re-stamps the timestamp, never errors. GET side:
    exposed on GET /preferences alongside every other preference."""
    uid = user["email"]
    now = datetime.now().isoformat()
    await preferences_col.update_one(
        {"user_id": uid}, {"$set": {"penny_agent_consent": now, "user_id": uid}}, upsert=True,
    )
    return {"penny_agent_consent": now}


@router.delete("/penny/agent-consent")
async def revoke_agent_consent(user: dict = Depends(current_user)):
    """The Settings toggle's OFF path (added on top of the original
    grant-only contract, 2026-08-30, same day). Clears
    `penny_agent_consent` back to falsy. Idempotent — revoking when already
    not consented just confirms the off state, never errors.

    Takes effect immediately and in two places: `app.services.penny_agent`
    reads this field live on every call (no caching), so the very next
    question excludes the propose-tool schemas again exactly as a
    never-consented user's would; and `execute_proposal` below re-checks
    consent at EXECUTE time, not just at proposal-creation time, so a
    proposal built while consented but still sitting unactioned in the
    15-minute window cannot be executed after this fires."""
    uid = user["email"]
    await preferences_col.update_one(
        {"user_id": uid}, {"$set": {"penny_agent_consent": None, "user_id": uid}}, upsert=True,
    )
    return {"penny_agent_consent": None}


@router.post("/penny/proposals/{proposal_id}/execute")
async def execute_proposal(proposal_id: str, user: dict = Depends(current_user)):
    """Replays a stored proposal through the same router function the app's
    own confirm sheet calls for that action. IDEMPOTENT: a proposal already
    executed replays its stored `result` rather than dispatching a second
    time (`doc.get("executed_at")` below) — safe to retry on a flaky
    connection, never double-creates. 410 (not 404) on an expired or
    cancelled proposal — the id was real, it just isn't actionable any
    more."""
    uid = user["email"]
    doc = await penny_proposals_col.find_one({"_id": proposal_id, "user_id": uid})
    if not doc:
        raise HTTPException(404, "proposal not found")
    if doc.get("cancelled_at"):
        raise HTTPException(410, "proposal was cancelled")
    if doc.get("executed_at"):
        return {"executed": True, "kind": doc["kind"], "result": doc.get("result"), "replayed": True}
    expires_at = doc.get("expires_at")
    if expires_at and datetime.now() > expires_at:
        raise HTTPException(410, "proposal expired")

    # Consent re-check AT EXECUTE TIME, not just at proposal-creation time
    # (owner follow-up, 2026-08-30): the loop already refuses to BUILD a
    # proposal without consent, but a proposal built while consented can
    # still be sitting unexecuted in its 15-minute window when the user
    # revokes consent (DELETE /penny/agent-consent) — this must never let a
    # stale proposal execute after that. Only gates a genuinely FIRST
    # execution; the idempotent-replay branch above (already executed)
    # intentionally returns before reaching here, since replaying history is
    # never itself a new write.
    prefs = await preferences_col.find_one({"user_id": uid}, {"penny_agent_consent": 1})
    if not (prefs and prefs.get("penny_agent_consent")):
        raise HTTPException(
            403, "Penny's permission to act on your behalf was revoked, this proposal can no longer be executed",
        )

    executor = _PROPOSAL_EXECUTORS.get(doc["kind"])
    if executor is None:
        raise HTTPException(500, f"no executor for proposal kind '{doc['kind']}'")
    try:
        result = await executor(uid, doc.get("params") or {})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "can_i: proposal execute failed for %s kind=%s id=%s", uid, doc["kind"], proposal_id,
        )
        raise HTTPException(500, f"execution failed: {e}")

    now = datetime.now()
    await penny_proposals_col.update_one(
        {"_id": proposal_id}, {"$set": {"executed_at": now, "result": result}},
    )
    # Audit trail (owner requirement): {uid, proposal_id, kind, executed_at,
    # source: "penny"} as one greppable log line — same convention every
    # other module-level logger in this codebase already uses for
    # `journalctl -u wealth-api` visibility, no new collection needed.
    #
    # Promoted from .info() to .warning() (observability fix, flagged twice
    # before this line ever got fixed): prod runs `uvicorn --log-level
    # warning`, and — separately from that flag — the root logger's default
    # level is WARNING with no handler ever configured on it (no
    # logging.basicConfig anywhere in this app), so an INFO record from a
    # module logger is dropped twice over: first by the logger's own
    # effective-level check (inherited from root), then, even if it cleared
    # that, by logging's `lastResort` handler, which is hardcoded to
    # WARNING. Net effect: every .info() call in this codebase is currently
    # invisible in journalctl, full stop, regardless of the uvicorn flag.
    # A dedicated logger was considered (per the fix brief) so a real audit
    # trail wouldn't visually read as an operational problem in the log
    # stream, but this line fires only on a genuine user-confirmed money
    # action (never in a hot loop), so its volume is exactly the volume an
    # operator actually wants to see — WARNING is the right severity to
    # borrow for "make it visible" without adding a second handler/
    # propagate=False setup nothing else in this codebase uses.
    logger.warning(
        "penny_proposal_audit uid=%s proposal_id=%s kind=%s executed_at=%s source=penny",
        uid, proposal_id, doc["kind"], now.isoformat(),
    )
    return {"executed": True, "kind": doc["kind"], "result": result, "replayed": False}


@router.post("/penny/proposals/{proposal_id}/cancel")
async def cancel_proposal(proposal_id: str, user: dict = Depends(current_user)):
    """Marks a proposal cancelled (the confirm card's Cancel tap). Blocks a
    later execute (410 — see execute_proposal above); cancelling an
    already-executed proposal is itself a 410, there is nothing left to
    cancel. Cancelling an already-cancelled proposal is a no-op success."""
    uid = user["email"]
    doc = await penny_proposals_col.find_one({"_id": proposal_id, "user_id": uid})
    if not doc:
        raise HTTPException(404, "proposal not found")
    if doc.get("executed_at"):
        raise HTTPException(410, "proposal already executed")
    if doc.get("cancelled_at"):
        return {"cancelled": True, "proposal_id": proposal_id}
    await penny_proposals_col.update_one(
        {"_id": proposal_id}, {"$set": {"cancelled_at": datetime.now()}},
    )
    return {"cancelled": True, "proposal_id": proposal_id}
