"""Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md) — the
tool-calling agent loop that is now the PRIMARY path for every /can-i
question except a greeting, the length/API-key gates, and a scenario-
simulation ask (all three stay in app.routers.can_i, unchanged). This
supersedes the original Phase 1 plan, where this loop only ran as a
fallback after a large hand-built deterministic ladder had already had a
turn. The motivating bug: "How can I improve my entertainment spending" was
captured by a synonym match on "entertainment" in that ladder and answered
with a current-period total, a confident answer to a question the ladder
matched but never understood, and the loop that could have handled it
properly was never even consulted. A route that answers questions it wasn't
built to answer is worse than a slower path that actually reasons about
them, so the ladder is gone and this loop runs first.

This module is deliberately narrow: it owns the OpenRouter tool-calling loop
and nothing else. The engine functions it can reach all live in
app.services.penny_tools (TOOL_SCHEMAS/execute_tool) — this file never talks
to a database collection directly.

IMPORT RULE: like penny_tools.py, this module must NEVER import from
app.routers.can_i (that module imports this one). The two tiny helpers this
loop needs that already exist there (£-agnostic HEADLINE/REPLY parsing) are
reimplemented here in miniature — see `_parse_headline_reply_or_none`'s own
"twin of" comment.

Failure doctrine (revised, B37, 2026-09-14): `run_penny_agent` never raises,
and returns one of THREE shapes. A dict on success (or the pre-existing
`consent_required`/`proposal` shapes). `{"provider_error": True}` when
OpenRouter itself could not be made to answer — a retryable HTTP error
(429/5xx, see `_call_openrouter_with_retry` and the module-level comment
above `_MAX_PROVIDER_RETRIES`) that stayed bad through every retry, a
non-retryable HTTP error (400/401/...), or a connection-level failure
(timeout, DNS, refused connection). `None` for everything else that isn't
an infrastructure problem: round cap exhausted, the hard wall-clock ceiling
firing, unparseable output, OR the model itself declining the question as
off-topic (see `_OUT_OF_SCOPE_SENTINEL` below). This three-way split exists
because the caller (can_i.py's seam) must NOT tell these apart the same
way: `None` still falls back to the pre-existing out-of-scope refusal
(`out_of_scope: True`) — correct for a genuinely off-topic or unparseable
question, since the model was consulted and either declined or answered
badly. `provider_error` gets its own, honestly-worded failure reply instead
(`out_of_scope: False`) — the model was never actually consulted, so
telling the user their question was out of scope would be false. Before
this split, EVERY failure collapsed to `None`, which is exactly the bug
this fixes: a 429 or a 502 read to the user as "that's outside what I can
work out", a wrong and discouraging thing to tell someone about their own,
perfectly answerable question.

Off-topic sentinel: rule 5 of `_SYSTEM_PROMPT` instructs the model to answer
a question with no financial angle with the single bare line
`OUT_OF_SCOPE`, no HEADLINE/REPLY, no tool calls. can_i.py's long-standing
invariant is that an off-topic question costs no LLM-phrased answer at all.
Letting the model phrase its own decline would silently break that: the
decline parses as a normal HEADLINE/REPLY pair, so the seam would return
`out_of_scope: False` for a question that was never in scope. The sentinel
closes that gap — a detected `OUT_OF_SCOPE` response is treated exactly
like any other failure (logged, `None` returned), so the seam falls through
to the existing free, correctly-labelled refusal, unchanged.

Wall-clock ceiling: `_WALL_CLOCK_BUDGET_S` is a SOFT signal read inside the
loop (it forces `tool_choice="none"` on the next round once elapsed time
crosses it, same as the hard `_MAX_MODEL_CALLS` round cap) — on its own that
only ever changes what the NEXT request asks for, it does nothing to bound
a request that is already in flight. `asyncio.wait_for` around the whole
loop is the actual ceiling: a slow-but-not-erroring OpenRouter can otherwise
chain up to `_MAX_MODEL_CALLS` full `_REQUEST_TIMEOUT_S` timeouts back to
back, and /can-i is a synchronous request a user is actively waiting on —
that must never take anywhere near a minute for something that, worst case,
falls back to a refusal anyway.
"""
import asyncio
import json
import logging
import random
import re
import time
import uuid
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.core.llm import openrouter_chat
from app.db.collections import preferences_col
from app.services.penny_tools import (
    PROPOSE_TOOL_NAMES, PROPOSE_TOOL_SCHEMAS, TOOL_SCHEMAS, execute_tool,
    revoke_agent_consent,
)

logger = logging.getLogger(__name__)

_MODEL = "anthropic/claude-haiku-4-5"
_MAX_TOKENS = 500
_MAX_MODEL_CALLS = 4
# Budget history, 2026-08-31 (owner-reported bug: "If we move 825£ from my
# Monzo account, how much will be left" got the generic out-of-scope
# refusal). Diagnosis ruled out BOTH suspected gates: `looks_like_scenario`
# correctly returns False for this phrasing (no cadence/income-change/
# cancel word, no commitment-verb+month pair — verified directly and pinned
# in test_scenario_routing.py), and a live trace with a loosened budget
# proved the model itself correctly calls get_accounts then calculate and
# answers factually the moment it has enough time — there was never a scope
# problem either. journalctl correlated the exact incident timestamp
# (second-for-second) to a "hard wall-clock ceiling hit" WARNING log line,
# logged before this session ever ran a single test call — a real,
# spontaneous production timeout, not a reproduction artefact. (uvicorn
# runs `--log-level warning` in prod, so the loop's own INFO-level success/
# tool-trace logs never reach journalctl at all — their absence proves
# nothing on its own; the WARNING-level ceiling hit is the load-bearing
# evidence here, not an inferred absence of successes.) Manually repeating
# the exact question moments later reproduced the same timeout 5 more
# times in a row. Direct measurement the same day (isolated OpenRouter calls, this exact
# system prompt/tool catalog, `anthropic/claude-haiku-4-5`) found single
# round trips routinely taking 10-25s against Anthropic directly (a trivial
# no-tools "say hi" call took 5-11s; a control call to a small Llama model
# over the identical network path/client returned in 0.85s, ruling out a
# network/VPS cause) — several times slower than the ~2-4s this budget was
# originally calibrated against ("typical answer becomes 2 or 3 calls" per
# PENNY_TOOLS.md). The OLD 12s soft / 15s hard ceiling could not survive
# even ONE such round, let alone the 2-3 rounds a real answer needs, so
# every substantive question was silently losing the race and falling back
# to the refusal, regardless of routing or scope. Live-verified against the
# exact reported question with these widened values (get_accounts then
# calculate then final: ~31-55s total, comfortably inside the new hard
# ceiling below). Still bounded, and still far under nginx's own
# proxy_read_timeout (120s) for this endpoint.
_WALL_CLOCK_BUDGET_S = 40.0
# Grace on top of the soft budget above before the HARD asyncio.wait_for
# ceiling fires — gives an in-flight request that is already past the soft
# budget a little room to land its forced-final answer instead of being cut
# off mid-flight every time, while still bounding the absolute worst case.
_WALL_CLOCK_GRACE_S = 20.0
_REQUEST_TIMEOUT_S = 35.0

# ── Transient provider errors (B37, 2026-09-14 audit) ───────────────────────
# Before this: ANY non-200 from OpenRouter (a rate limit, a blip, a
# misconfigured key, anything) was treated identically — one failed request,
# no retry, straight to `None`, which the seam in can_i.py turns into the
# fixed "that's outside what I can work out" refusal with `out_of_scope:
# True`. That is a lie about the user's question specifically for the
# transient case: a 429 or a 502 says nothing about whether the question was
# answerable, only that the provider had a bad moment. A 400 (malformed
# request) or 401 (bad/missing key) is a different story — retrying either
# repeats the exact same mistake at the exact same paid-call cost with no
# chance of a different outcome, so only 429 and 5xx are retried.
#
# Bounded on every axis: `_MAX_PROVIDER_RETRIES` retries (3 attempts total)
# per model-call round, exponential backoff with full jitter between them
# capped at `_RETRY_MAX_DELAY_S`, and a provider `Retry-After` header is
# honoured but itself capped at `_RETRY_AFTER_CAP_S` — a provider asking for
# a longer backoff than that is treated as "not worth waiting for" in a
# synchronous, user-facing request rather than actually waited out. Worst
# case added latency from this scheduling alone (no Retry-After present):
# two backoff waits, each up to its own ceiling (0.5s then 1.0s) = 1.5s.
# With a Retry-After header honoured on both retries: 2 * `_RETRY_AFTER_CAP_S`
# = 6.0s. Either way this sits inside the SAME `_WALL_CLOCK_BUDGET_S` +
# `_WALL_CLOCK_GRACE_S` = 60s hard ceiling that already bounds the whole
# loop (see `run_penny_agent`'s `asyncio.wait_for` below) — a retry never
# gets its own separate budget, it just spends time out of the one that
# already exists, and if the ceiling fires mid-retry the loop still gives up
# cleanly (falls through to the pre-existing `asyncio.TimeoutError` handler,
# unchanged).
#
# Metering stays honest for free: `app.core.llm.openrouter_chat`/
# `record_llm_usage` only ever write a usage row on a 200 response (see that
# module) — a 429/5xx attempt that gets retried records nothing, so only the
# attempt that finally lands a 200 (if any) is billed, and if every attempt
# in a round fails, NOTHING is billed for it at all. Every attempt in this
# module also shares the one `message_id` `run_penny_agent` already
# generates per user question, so `monthly_usage`'s distinct-message-id count
# (what the user's monthly Penny allowance is actually measured against)
# cannot move because of a retry either — that count is already keyed off
# distinct message ids, not row counts.
_MAX_PROVIDER_RETRIES = 2
_RETRY_BASE_DELAY_S = 0.5
_RETRY_MAX_DELAY_S = 4.0
_RETRY_AFTER_CAP_S = 3.0


class _ProviderFailure(Exception):
    """Raised out of `_call_openrouter_with_retry` once a request to
    OpenRouter could not be made to succeed — a non-retryable status on the
    very first attempt (e.g. 400/401), or a retryable one (429/5xx) that
    stayed bad through every retry. Deliberately a DIFFERENT signal from a
    plain `None` return elsewhere in this module: `None` still means "the
    model declined the question as off-topic, or its final answer couldn't
    be parsed" (a genuine scope/output problem), this means "OpenRouter
    itself could not be reached to ask" (an infrastructure problem). See
    `run_penny_agent`'s docstring for how the two are told apart on the
    wire — `None` still drives the caller's existing out-of-scope refusal,
    this drives a distinct, honestly-worded failure reply with
    `out_of_scope: False`."""


def _is_retryable_status(status_code: int) -> bool:
    """429 (rate limited) or any 5xx (provider-side) — worth paying for a
    second attempt. Everything else (400 malformed, 401/403 auth, 404, 422,
    ...) is a permanent failure that a retry cannot fix, only repeat."""
    return status_code == 429 or status_code >= 500


def _parse_retry_after(response: httpx.Response) -> float | None:
    """OpenRouter's own `Retry-After` header, when sent — either
    delta-seconds (`"Retry-After: 20"`) or an HTTP-date, per RFC 9110.
    Returns None when absent or unparseable, in which case the caller falls
    back to its own backoff schedule instead."""
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max((dt - datetime.now(timezone.utc)).total_seconds(), 0.0)


def _retry_delay_s(attempt: int, retry_after: float | None) -> float:
    """`attempt` is 0-indexed (0 = the wait before the FIRST retry). A
    provider `Retry-After` is honoured directly, capped at
    `_RETRY_AFTER_CAP_S` (see the module-level note above for why an
    uncapped honour would risk the user-facing latency budget). Otherwise:
    bounded exponential backoff with full jitter (uniform over [0, ceiling],
    the standard AWS-recommended shape) — jitter rather than a fixed delay
    so a burst of requests hitting the same transient error don't all retry
    in lockstep and immediately reproduce the same rate limit."""
    if retry_after is not None:
        return min(max(retry_after, 0.0), _RETRY_AFTER_CAP_S)
    ceiling = min(_RETRY_BASE_DELAY_S * (2 ** attempt), _RETRY_MAX_DELAY_S)
    return random.uniform(0, ceiling)


async def _call_openrouter_with_retry(
    payload: dict, *, uid: str, client: httpx.AsyncClient, message_id: str,
) -> httpx.Response:
    """One model-call round's worth of OpenRouter request, with the retry
    policy described in the module-level comment above applied on top of
    the shared `app.core.llm.openrouter_chat` (metering stays centralised
    there, unchanged — this only decides WHETHER to call it again). Always
    returns a 200 `httpx.Response` on success; raises `_ProviderFailure`
    (never returns a non-200 response) once there is nothing more worth
    trying. A connection-level failure (no HTTP response at all — DNS,
    refused connection, the request timing out against
    `_REQUEST_TIMEOUT_S`) is treated as an immediate, UNretried failure:
    the attempt has already spent up to the client's own timeout, so
    retrying it risks doubling that against the wall-clock ceiling for a
    case no more likely to succeed a moment later — the caller's existing
    round-cap/wall-clock handling is what bounds that case, not this
    function."""
    attempt = 0
    while True:
        try:
            response = await openrouter_chat(
                payload, user_id=uid, pipeline="penny", client=client, message_id=message_id,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            # Logged here (with the real exception text, where a message
            # like this belongs) but NOT threaded into the raised
            # `_ProviderFailure` below — chaining via `from exc` keeps the
            # traceback without leaking a library-authored message into a
            # value that could end up user-facing (see
            # tests/test_no_raw_exception_leak.py's structural guard).
            logger.warning("penny_agent: OpenRouter request failed for %s: %r", uid, exc)
            raise _ProviderFailure("connection failure") from exc
        if response.status_code == 200:
            return response
        retryable = _is_retryable_status(response.status_code)
        if not retryable or attempt >= _MAX_PROVIDER_RETRIES:
            logger.warning(
                "penny_agent: OpenRouter HTTP %s for %s (attempt %d/%d, retryable=%s), giving up",
                response.status_code, uid, attempt + 1, _MAX_PROVIDER_RETRIES + 1, retryable,
            )
            raise _ProviderFailure(f"HTTP {response.status_code}")
        delay = _retry_delay_s(attempt, _parse_retry_after(response))
        logger.warning(
            "penny_agent: OpenRouter HTTP %s for %s, retrying in %.2fs (attempt %d/%d)",
            response.status_code, uid, delay, attempt + 1, _MAX_PROVIDER_RETRIES,
        )
        await asyncio.sleep(delay)
        attempt += 1


# The model's own decline for a question with no financial angle — see the
# module docstring's "Off-topic sentinel" section for why this exists rather
# than letting the model phrase a normal-looking refusal.
_OUT_OF_SCOPE_SENTINEL = "OUT_OF_SCOPE"

# ── "Stop setting things up" (B13, 2026-09-08) ────────────────────────────
# A deterministic, no-model-call twin of Settings' "Turn off" control:
# app.services.penny_tools.revoke_agent_consent is the ONE place a revoke
# actually happens (clears the consent flag AND cancels every pending
# proposal), called identically from both the Settings DELETE route and
# here. "Server is the gate" doctrine — this is never offered to the model
# as a tool, it is matched in Python BEFORE the OpenRouter client is ever
# touched, so revoking never costs a message, never depends on the model
# correctly recognising the intent, and can never be talked out of firing
# by a cleverly-phrased follow-up.
#
# Whole-message match only (light case/punctuation tolerance), not a
# substring search: a sentence that merely MENTIONS one of these phrases
# mid-thought ("why did it stop proposing halfway through the walkthrough")
# must not accidentally revoke consent — a user actually asking to stop
# always says so as the entire message, matching this codebase's existing
# convention for short deterministic intents (see can_i.py's own greeting
# short-circuit for the same "match the whole thing, not a fragment of it"
# discipline).
_STOP_CONSENT_PHRASES = frozenset({
    "stop setting things up",
    "turn off setting things up",
    "stop proposing",
    "revoke consent",
})
_TRAILING_PUNCT_RE = re.compile(r"[.!?]+$")


def _is_stop_consent_message(question: str) -> bool:
    normalized = _TRAILING_PUNCT_RE.sub("", (question or "").strip().lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized in _STOP_CONSENT_PHRASES

_SYSTEM_PROMPT = (
    "You are Penny, the assistant inside Sorted, a personal money app. You "
    "answer questions using the user's own live financial data, reached "
    "ONLY through the tools you have been given.\n\n"
    "RULES, no exceptions:\n"
    "1. Every £ figure you write MUST come verbatim from a tool result — "
    "prefer its pre-formatted string. NEVER compute, derive, sum, round or "
    "estimate a number yourself; if you need a figure, call a tool for it. "
    "Penny never computes multi-step arithmetic herself, even when she "
    "already has every number in hand: she uses calculate and shows the "
    "working in her reply ('£8.96 first payment plus 4p a day for 27 days "
    "comes to £258.66').\n"
    "2. Any state, verdict, reading, or classification string in a tool "
    "result (for example a safe-to-spend state of 'comfortable'/'tight'/"
    "'short', a card's 0%/interest-bearing classification, "
    "check_affordability's verdict sentence, or a spend verdict's reading "
    "sentence) has ALREADY been decided by the backend from the user's live "
    "numbers. Reproduce it faithfully — never paraphrase it into a "
    "different judgement, and never contradict or soften it.\n"
    "2a. Safe to Spend is a cash figure. When get_safe_to_spend or "
    "check_affordability returns positive card_growth, mention that amount "
    "as a separate card-balance fact after the cash answer. Never add it to "
    "or subtract it from Safe to Spend yourself, and never turn a positive "
    "cash figure into a refusal unless the backend verdict says so.\n"
    "3. Facts, never advice. Never say 'you should', never recommend a "
    "financial product or provider (FCA rule).\n"
    "4. Future-dated events (expected income, upcoming bills) are always "
    "hedged: 'expected', 'usually', 'around' — never a promise that money "
    "will move.\n"
    "5. If the question is not about the user's own money (weather, "
    "general trivia, anything with no financial angle), do not call a "
    "tool and do not write a HEADLINE/REPLY at all — respond with EXACTLY "
    "one line and nothing else: OUT_OF_SCOPE\n"
    "6. Never repeat what the user's current screen already shows them "
    "(the screen name, when known, is given in the user message) — add "
    "only what is new.\n"
    "7. British English, answer-first. Normally at most 2 short sentences; "
    "allow up to 3 only when a genuine breakdown needs the extra room (for "
    "example naming what's driving a category, see rule 8) — never use the "
    "third sentence just to pad or repeat yourself. Write in plain, human "
    "punctuation: no em-dashes (—) or en-dashes (–); use a comma, a full "
    "stop, or a plain conjunction instead.\n"
    "8. Advice-shaped questions ('how can I improve/cut/fix/reduce my X "
    "spending') are answered with the FACTS that make the decision obvious, "
    "never a prescription: the total, how it compares to usual, and what's "
    "driving it (the top merchant(s), from get_category_spend). Never "
    "suggest a specific action ('cancel it', 'switch provider', 'spend "
    "less'). Example, in the exact HEADLINE:/REPLY: shape the OUTPUT FORMAT "
    "section below requires, never as bare unlabelled prose: HEADLINE: "
    "Entertainment up on usual REPLY: Entertainment is £231 across 16 "
    "payments, about 4x your usual pace. Daniel Maingi and Google Play "
    "drive most of it.\n"
    "9. UK tax mechanics questions (allowances, thresholds, reliefs, how "
    "something works generally) may be answered from general knowledge, "
    "educational and UK-specific, never personalised tax advice: this tax "
    "year (2026/27), the personal allowance tapers above £100,000 of "
    "adjusted net income and is lost entirely at £125,140 (an effective 60% "
    "marginal rate in that band, 40% income tax plus 20% from the lost "
    "allowance); the annual pension allowance is £60,000, with unused "
    "allowance from the last 3 years carried forward; salary sacrifice "
    "(pension, cycle to work, EV) and Gift Aid both reduce adjusted net "
    "income; the ISA allowance is £20,000/year with no carry-forward; EIS "
    "gives 30% income tax relief and SEIS 50% for qualifying investors; "
    "self-assessment is mandatory above £100,000 income; the Child Benefit "
    "high income charge starts at £60,000 adjusted income. Hedge every "
    "threshold as 'this tax year' rather than a permanent fact, since these "
    "change yearly. Never suggest, name or recommend a specific product, "
    "provider, scheme or investment, including EIS/SEIS opportunities, to "
    "obtain a relief; explain the mechanics only, and point to a regulated "
    "financial adviser for anything recommendation-shaped. No tool call is "
    "needed for a purely general question. "
    "The MOMENT a tax question touches the user's OWN numbers (their "
    "income, their personal allowance remaining, their adjusted net income, "
    "whether they get Child Benefit), call get_tax_position and use ONLY "
    "its figures for those — never estimate, assume or carry over a figure "
    "from general knowledge once a personal one is asked for.\n"
    "10. The conversation history is authoritative for follow-ups: a bare "
    "'why', 'what about X', or similarly short continuation refers to the "
    "topic and figures of the immediately preceding turn in the history you "
    "were given, not a fresh, unrelated question — re-call a tool if you "
    "need a figure again rather than inventing one from memory of the prior "
    "reply's text.\n"
    "11. When a tool result carries `ask_when: true` (check_affordability "
    "sets this whenever it judged a large amount against the current pay "
    "period for lack of a stated timeframe), your REPLY must give the "
    "current-period fact briefly AND, in the same reply, ask one short "
    "question about when the spend is actually for, since that would change "
    "the answer. This may use the 3rd sentence allowed under rule 7.\n"
    "12. For three question shapes, call explain with the matching topic "
    "key rather than answering from your own understanding of the app: "
    "(a) what a term/label on screen means ('what does moved mean', "
    "'what's an aim'), (b) why two figures on screen don't seem to agree "
    "('why is Out different from the majority total'), (c) how to do "
    "something in the app ('how do I stop a bill being predicted', 'how do "
    "I pin an account'). If you aren't sure of the exact key, call explain "
    "anyway with your best guess — an unknown topic returns the full list "
    "of valid keys to pick from and re-call with. Never answer any of these "
    "three question shapes from general knowledge or your own "
    "understanding of the app.\n\n"
    "OUTPUT FORMAT: once you have everything you need for an IN-SCOPE "
    "question, respond with EXACTLY two lines, nothing before or after:\n"
    "HEADLINE: <under 8 words>\n"
    "REPLY: <your answer, per rule 7>\n"
    "This applies to EVERY in-scope final answer with no exception, "
    "including a follow-up question and a fact-driven answer shaped like "
    "rule 8's example above: never drop the HEADLINE:/REPLY: labels just "
    "because the answer itself is a couple of plain sentences."
)

# Penny Agent Mode v1 (owner decision, 2026-08-30, see PENNY_TOOLS.md) —
# ALWAYS appended to the system prompt, consented or not (flow fix,
# 2026-08-30, same day: gating this behind consent made the one-time
# consent moment itself unreachable — an unconsented user asking for an
# action needs the model to attempt a propose tool so the DISPATCH-level
# gate in `run_penny_agent` has something to catch and turn into
# `consent_required`; see that function's own docstring). Deliberately says
# nothing about consent or availability — the model is never told these
# tools might be refused, the server is the only gate, and the refusal
# outcome doesn't read as a model-authored decline. Kept as a separate
# constant, not folded into `_SYSTEM_PROMPT`, purely for readability.
_WRITE_TOOLS_ADDENDUM = (
    "\n\n13. You may also PROPOSE an action for the user to confirm, never "
    "execute one yourself: propose_mirror_choice, propose_dismiss_recurring, "
    "propose_restore_recurring, propose_add_planned, propose_create_allocation, "
    "propose_create_commitment, propose_recategorise_transaction, "
    "propose_set_card_apr. Call one of these ONLY when the user has clearly "
    "asked you to do or set up that specific thing, never merely because "
    "they mentioned or discussed it. Resolve any account, series, trait or "
    "transaction by calling a read tool first if you aren't already sure of "
    "its exact id or name, never invent one. Once a propose tool returns a "
    "result, stop, the tool result itself is the final answer, a confirm "
    "card renders it, you do not need to add HEADLINE/REPLY text of your "
    "own.\n"
    "14. propose_recategorise_transaction ALWAYS needs a scope, "
    "'just_once' or 'always'. If the user hasn't already said which, ask "
    "them before calling the tool ('just this once, or should I always "
    "file <merchant> as <category>?') rather than guessing. Never propose "
    "this for a transaction the user is disputing as fraud or wants "
    "resolved as a transfer/movement (an account of theirs, a goal, a "
    "pot) — that goes through the app's own review sheet, not Penny.\n"
    "15. propose_set_card_apr's apr_pct must be a number the user actually "
    "typed themselves in this conversation, this turn or an earlier one, "
    "never a figure you infer, estimate, round, or make up from vaguer "
    "language ('about 25%', 'whatever the average card charges'). If they "
    "haven't typed an exact number, ask them to type it rather than "
    "guessing or calling the tool with an invented figure, the tool also "
    "independently refuses an unprovenanced number, so calling it early "
    "only wastes a round. Scope v1: standard APR only, point a 0% promo "
    "window or balance-transfer offer request at the card's own terms "
    "sheet in the app instead."
)

# Date grounding, 2026-08-30 (found while verifying the elliptical-follow-up
# fix above): the model has no built-in notion of "today" — a relative
# phrase like "last month" was being resolved against a guessed/remembered
# date (observed live: search_transactions called with date_from/date_to
# in December 2024 for a question asked in August 2026), a wrong-but-real
# tool call per PENNY_TOOLS.md's own "Honest failure modes" section. Built
# fresh per call (never a module-level constant) so a long-running process
# never answers "today" with the date it happened to start on.
_DATE_GROUNDING_TEMPLATE = (
    "\n\n16. Today's date is {today} ({weekday}). Resolve any relative "
    "date phrase ('last month', 'this year', 'last week', 'yesterday') "
    "against THIS date, never a date you recall from training or guess — "
    "compute the real date_from/date_to (or period_offset) from it before "
    "calling a tool."
)


def _parse_headline_reply_or_none(raw: str, *, has_tool_grounding: bool = False) -> tuple[str, str] | None:
    """Twin of app.routers.can_i._parse_headline_reply (that function no
    longer exists post-ladder-deletion, but the original DELIBERATELY-
    stricter design note below still explains this one's shape): the
    original always returned a best-effort (headline, reply) pair, falling
    back to the raw text wholesale when the model didn't follow the
    HEADLINE:/REPLY: contract, because that path had no fallback of its own
    to defer to. This loop does have one — the pre-existing out-of-scope
    refusal in can_i.py — so a malformed final answer here surfaces as None
    and lets the caller fall back to that, rather than ship an unstructured
    reply the seam has no way to distinguish from a well-formed one.

    Bug fix, 2026-08-30 (owner-reported: "What about last month" after
    "What were my unplaced transactions" got the generic out-of-scope
    refusal): traced to this function, not history handling — the model
    correctly used history to inherit the prior turn's subject and
    correctly re-called get_spend_verdict for the changed window, but wrote
    its final answer as bare prose ("Last month you had £85 of unplaced
    transactions across 2 payments...") without the HEADLINE:/REPLY:
    labels, mimicking rule 8's own advice-shaped example (now fixed to show
    the labels too — see _SYSTEM_PROMPT). A correct, tool-grounded answer
    was being thrown away exactly like a genuine failure. `has_tool_grounding`
    (true whenever this call's `tools_used` is non-empty, i.e. at least one
    real engine tool backed this specific answer) gates a narrow fallback:
    UNLABELLED, non-trivial content is accepted as the reply verbatim, with
    no headline (see the 2026-09-10 note further down, where a synthesised
    headline turned out to routinely truncate mid-word), rather than
    discarded. This does not weaken rule 1's tool-grounding requirement
    (which was never mechanically enforced here in the first place, a
    correctly-labelled answer with an invented figure would have passed
    just as easily before this fix) — it only stops a real, grounded answer
    being punished for a labelling slip. A round that never called a tool
    at all (has_tool_grounding=False) keeps the original strict behaviour,
    since an ungrounded bare-prose answer is exactly the shape a genuine
    off-topic decline or hallucination would also take."""
    headline: str | None = None
    reply_lines: list[str] = []
    mode: str | None = None
    for line in (raw or "").strip().splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("HEADLINE:"):
            headline = stripped.split(":", 1)[1].strip()
            mode = "headline"
            continue
        if stripped.upper().startswith("REPLY:"):
            reply_lines.append(stripped.split(":", 1)[1].strip())
            mode = "reply"
            continue
        if mode == "reply" and stripped:
            reply_lines.append(stripped)
    reply = " ".join(l for l in reply_lines if l).strip()
    if headline and reply:
        return headline, reply
    if not has_tool_grounding:
        return None
    # Fallback path — see the 2026-08-30 note above. Only reached when the
    # strict HEADLINE:/REPLY: parse above found neither label at all (a
    # partially-labelled reply, e.g. a REPLY: line with no HEADLINE:, still
    # falls through to None here exactly as before — only a clean absence
    # of the whole contract is eligible).
    if headline or reply:
        return None
    fallback = (raw or "").strip()
    if len(fallback) < 10 or fallback.upper() == _OUT_OF_SCOPE_SENTINEL:
        return None
    # Bug fix, 2026-09-10 (owner-reported on prod, two real replies cut off
    # mid-word at exactly 60 chars: "...came from new spen" and "...from 3
    # p"): this used to synthesise a headline from `first_sentence[:60]`
    # with no word-boundary trim, so it routinely sliced through a word or
    # a currency figure. There is no universally-safe hard trim here — a
    # sentence the model wrote as ordinary prose was never composed to fit
    # an 8-word verdict headline, so any fixed-width cut risks landing the
    # same failure somewhere else (mid-word, mid-number, or a clause that
    # just reads as unfinished). The frontend already has a graceful path
    # for exactly this shape: `PennyConversation.tsx`'s VerdictMsg treats a
    # falsy `headline` as the `degraded` case and renders the full `reply`
    # as plain body text instead of forcing a bold verdict line (see that
    # file's own comment on the `degraded` field). Returning no synthetic
    # headline here, rather than inventing one, is both simpler and safer
    # than any truncation scheme, and the user gets the complete, untrimmed
    # answer either way.
    return "", fallback


def _build_user_content(question: str, screen: str | None, context: str) -> str:
    """The human turn handed to the model: the raw question, plus the
    screen name (when known) and the screen's own context block (when
    non-trivial) — the same two grounding signals every other LLM path in
    can_i.py appends, just folded into one user message instead of a
    separate system-prompt slot, since this loop's system prompt is fixed
    and shared across every question rather than rebuilt per-call."""
    parts = [question]
    if screen:
        parts.append(f"(Current screen: {screen})")
    if context:
        parts.append(f"CONTEXT (what the user's current screen shows): {context}")
    return "\n\n".join(parts)


async def run_penny_agent(
    uid: str, question: str, history: list[dict], screen: str | None, context: str,
) -> dict | None:
    """Run the tool-calling loop for one question. See module docstring's
    revised (B37) "Failure doctrine" for the three-way return contract: a
    dict on success, `{"provider_error": True}` on an infrastructure
    failure (OpenRouter unreachable/erroring after retries), `None` for a
    genuine off-topic decline or unparseable output. Never raises.

    Penny Agent Mode v1 (2026-08-30): also returns a dict for the two new
    non-answer outcomes — `{"proposal": {...}}` when a propose-only write
    tool built a proposal (the loop stops there, no further model call), and
    `{"consent_required": True}` when the model attempted a propose tool
    without the user having granted `penny_agent_consent` (checked once,
    below, via preferences_col — the SAME field POST /penny/agent-consent
    sets).

    Flow fix (2026-08-30, same day, owner-caught): PROPOSE_TOOL_SCHEMAS are
    now ALWAYS offered to the model, consented or not — gating them behind
    consent (the original build) made the one-time consent moment itself
    unreachable, since an unconsented user asking for an action never got a
    model that even knew a propose tool existed, so it just declined
    out-of-scope instead of ever surfacing `consent_required`. The gate now
    lives ONLY at dispatch time, below: the model is free to attempt any
    propose tool whenever a user's request calls for it, and the server
    refuses to actually call `execute_tool` (never persists the attempted
    intent, never builds a proposal) unless `consented` is true, returning
    `{"consent_required": True}` instead so the frontend can show the
    one-time consent card and auto-resend the question once granted.

    B13 (2026-09-08): checked BEFORE anything else in this function,
    including the consent lookup just below — see `_is_stop_consent_message`
    and the module-level doctrine note above it. No OpenRouter call, no
    round counted, no tool ever offered for this: revoking is deterministic
    and always succeeds (revoke_agent_consent is itself idempotent), so this
    always returns an ordinary headline/reply pair, never `None`."""
    if _is_stop_consent_message(question):
        result = await revoke_agent_consent(uid)
        logger.info(
            "penny_agent: stop-consent phrase matched for %s, proposals_cancelled=%d",
            uid, result.get("proposals_cancelled") or 0,
        )
        return {
            "headline": "Setting things up is off",
            "reply": (
                "Setting things up is off. I will only answer questions "
                "until you turn it back on in Settings or ask me to set "
                "things up again."
            ),
            "tools_used": [],
        }
    started = time.monotonic()
    try:
        prefs = await preferences_col.find_one({"user_id": uid}, {"penny_agent_consent": 1})
    except Exception:
        logger.exception("penny_agent: consent lookup failed for %s, treating as not consented", uid)
        prefs = None
    consented = bool(prefs and prefs.get("penny_agent_consent"))
    # Always offered — see the flow-fix note above. `consented` is still
    # used below, at DISPATCH time, as the actual gate. TOOL_SCHEMAS and
    # PROPOSE_TOOL_SCHEMAS are both module-level list literals in
    # penny_tools.py, so this concatenation is the same list, in the same
    # order, on every call — required for the prompt-cache breakpoint below
    # to actually hit (Anthropic caches the prefix up to the breakpoint in
    # the order tools -> system -> messages, so a reordered tool list would
    # silently invalidate the cache every request).
    tools = TOOL_SCHEMAS + PROPOSE_TOOL_SCHEMAS
    today = date.today()
    date_grounding = _DATE_GROUNDING_TEMPLATE.format(today=today.isoformat(), weekday=today.strftime("%A"))

    # Prompt caching (2026-09): the static system prompt (rules + write-tools
    # addendum, ~8,500 tokens together with the tool schemas above — comfortably
    # over every Claude model's minimum cacheable length) carries an Anthropic
    # `cache_control` breakpoint. Anthropic caches everything up to and
    # including this breakpoint — the tool schemas AND this text block — so
    # every round of every question after the first one anywhere in the
    # process gets a cache hit on the (identical, unchanging) tools+system
    # prefix. `date_grounding` is a SEPARATE content block placed AFTER the
    # cached one, deliberately uncached: it embeds today's date, which
    # changes daily and would otherwise force a fresh (uncached) prefix
    # write on the first request of every new day. Nothing else volatile
    # (user id, thread id, screen name) lives in the system message at all —
    # those are folded into the per-call user message by
    # `_build_user_content` instead, which was already true before this
    # change and is what keeps the cached block static across every user.
    messages: list[dict] = [{
        "role": "system",
        "content": [
            {
                "type": "text",
                "text": _SYSTEM_PROMPT + _WRITE_TOOLS_ADDENDUM,
                "cache_control": {"type": "ephemeral"},
            },
            {"type": "text", "text": date_grounding},
        ],
    }]
    for entry in (history or []):
        role = entry.get("role") if isinstance(entry, dict) else None
        content = entry.get("content") if isinstance(entry, dict) else None
        if role in ("user", "assistant") and isinstance(content, str):
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": _build_user_content(question, screen, context)})

    # One id per USER MESSAGE (i.e. per call to run_penny_agent), shared by
    # every OpenRouter round the loop below makes for it — see app.core.llm's
    # monthly_usage, which counts distinct penny message_ids rather than
    # rounds, since one question can cost several rounds (tool calls) but is
    # still one "message" from the user's/billing's point of view.
    message_id = str(uuid.uuid4())

    async def _loop() -> dict | None:
        """The actual model-call/tool-call cycle, isolated so the caller can
        wrap it in a hard `asyncio.wait_for` ceiling (see the module
        docstring's "Wall-clock ceiling" section) — a timeout here cancels
        this coroutine, including any request `client.post` has in flight,
        rather than merely skipping the NEXT round the way the soft
        `_WALL_CLOCK_BUDGET_S` check below already does on its own."""
        tools_used: list[str] = []
        rounds = 0
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_S) as client:
            while True:
                elapsed = time.monotonic() - started
                rounds += 1
                if rounds > _MAX_MODEL_CALLS:
                    logger.warning(
                        "penny_agent: round cap (%d) exhausted for %s, giving up",
                        _MAX_MODEL_CALLS, uid,
                    )
                    return None
                # Last allowed round, or already over the soft wall-clock
                # budget: force a final answer (no more tool calls) rather
                # than either running past the cap or giving up with a tool
                # round still outstanding. The hard ceiling around this
                # whole loop (see `run_penny_agent` below) is what actually
                # bounds a request that ignores this and hangs anyway.
                force_final = rounds == _MAX_MODEL_CALLS or elapsed >= _WALL_CLOCK_BUDGET_S

                payload = {
                    "model": _MODEL,
                    "max_tokens": _MAX_TOKENS,
                    "temperature": 0,
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "none" if force_final else "auto",
                }
                # `_call_openrouter_with_retry` (module-level, see its own
                # docstring and the "Transient provider errors" comment
                # above `_MAX_PROVIDER_RETRIES`) already retries a 429/5xx a
                # bounded number of times and only ever returns a 200 here —
                # a non-retryable status, or a retryable one that stayed bad
                # through every retry, raises `_ProviderFailure` instead,
                # caught by the `asyncio.wait_for` wrapper below this
                # function, NOT here (letting it propagate out of `_loop`
                # keeps this inner function's job to "get one successful
                # round or raise", not to also decide what a failure means
                # to the caller).
                r = await _call_openrouter_with_retry(
                    payload, uid=uid, client=client, message_id=message_id,
                )
                data = r.json()
                choice = (data.get("choices") or [{}])[0]
                msg = choice.get("message") or {}
                tool_calls = msg.get("tool_calls") or []

                if tool_calls and not force_final:
                    # Wire format: echo the assistant's own tool_calls turn
                    # back, then one role="tool" message per call, content =
                    # JSON string of that call's result — standard OpenAI/
                    # OpenRouter tool-calling shape.
                    messages.append({
                        "role": "assistant",
                        "content": msg.get("content"),
                        "tool_calls": tool_calls,
                    })
                    for tc in tool_calls:
                        fn = tc.get("function") or {}
                        name = fn.get("name") or ""
                        try:
                            call_args = json.loads(fn.get("arguments") or "{}")
                        except (json.JSONDecodeError, TypeError):
                            call_args = {}
                        # THE consent gate (flow fix, 2026-08-30: PROPOSE_
                        # TOOL_SCHEMAS are now always offered to the model —
                        # see run_penny_agent's own docstring for why gating
                        # the schema instead made the one-time consent moment
                        # unreachable), so this dispatch-time check is no
                        # longer defence in depth, it's the ONLY gate. The
                        # attempted intent is deliberately NOT persisted:
                        # execute_tool is never reached, so no proposal is
                        # ever built for a non-consenting user — this is
                        # exactly the moment that surfaces `consent_required`
                        # so the frontend can show the one-time consent card.
                        if name in PROPOSE_TOOL_NAMES and not consented:
                            logger.info(
                                "penny_agent: propose tool %s attempted without consent for %s",
                                name, uid,
                            )
                            return {"consent_required": True}
                        if name == "propose_set_card_apr":
                            # Owner doctrine amendment #2, 2026-08-30
                            # (verbatim-provenance rule, see
                            # PENNY_TOOLS.md): the builder in penny_tools.py
                            # must check the apr_pct the model supplies
                            # against the user's OWN words, never trust the
                            # model's tool-call JSON for that. `_user_texts`
                            # is computed here, server-side, from this
                            # call's own `messages` (never anything the
                            # model's JSON can influence) and threaded
                            # through `call_args` rather than a new
                            # execute_tool parameter, so every other tool's
                            # dispatch call — and every existing test
                            # double for execute_tool, all still
                            # (uid, name, args)-shaped — stays untouched.
                            call_args = dict(call_args)
                            call_args["_user_texts"] = [
                                m.get("content") for m in messages
                                if m.get("role") == "user" and isinstance(m.get("content"), str)
                            ]
                        t0 = time.monotonic()
                        result = await execute_tool(uid, name, call_args)
                        dt_ms = int((time.monotonic() - t0) * 1000)
                        tools_used.append(name)
                        logger.info(
                            "penny_agent: tool=%s args=%s ms=%d uid=%s",
                            name, call_args, dt_ms, uid,
                        )
                        if isinstance(result, dict) and result.get("proposal") is True:
                            # Penny Agent Mode v1: a propose-only write tool
                            # already built a complete, final proposal (see
                            # app.services.penny_tools._create_proposal) — the
                            # loop stops here, no further model call is
                            # needed, the tool result itself IS the answer.
                            logger.info(
                                "penny_agent: proposal kind=%s id=%s returned by %s for %s, rounds=%d",
                                result.get("kind"), result.get("proposal_id"), name, uid, rounds,
                            )
                            return {"proposal": result}
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.get("id"),
                            "content": json.dumps(result, default=str),
                        })
                    continue

                content = msg.get("content")
                stripped = (content or "").strip()
                if stripped == _OUT_OF_SCOPE_SENTINEL or stripped.startswith(_OUT_OF_SCOPE_SENTINEL):
                    # See the module docstring's "Off-topic sentinel"
                    # section: treated exactly like any other failure so the
                    # seam falls through to the existing free, correctly
                    # `out_of_scope: True` refusal for a question that was
                    # never in scope.
                    #
                    # Promoted .info() -> .warning() (observability sweep):
                    # this branch returns None, which per the module's own
                    # "Failure doctrine" IS a failure path (it drives the
                    # user straight to the generic refusal, same as a round-
                    # cap exhaustion or an OpenRouter HTTP error, both of
                    # which already log at WARNING two branches away from
                    # this one). Left at INFO, it was invisible under prod's
                    # effective logging threshold exactly like every other
                    # silent .info() this sweep found — so a spike in
                    # off-topic declines (e.g. a prompt regression wrongly
                    # routing real questions out of scope) had no signal at
                    # all next to the round-cap/timeout/HTTP-error siblings
                    # that DO show up.
                    logger.warning(
                        "penny_agent: declined off-topic for %s after %d rounds", uid, rounds,
                    )
                    return None

                parsed = (
                    _parse_headline_reply_or_none(content, has_tool_grounding=bool(tools_used))
                    if content else None
                )
                total_ms = int((time.monotonic() - started) * 1000)
                if parsed is None:
                    logger.warning(
                        "penny_agent: unparseable/empty final answer for %s after %d rounds, %dms",
                        uid, rounds, total_ms,
                    )
                    return None
                headline, reply = parsed
                logger.info(
                    "penny_agent: uid=%s rounds=%d tools=%s total_ms=%d",
                    uid, rounds, tools_used, total_ms,
                )
                return {"headline": headline, "reply": reply, "tools_used": tools_used}

    try:
        return await asyncio.wait_for(_loop(), timeout=_WALL_CLOCK_BUDGET_S + _WALL_CLOCK_GRACE_S)
    except asyncio.TimeoutError:
        total_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "penny_agent: hard wall-clock ceiling (%.1fs) hit for %s after %dms, giving up",
            _WALL_CLOCK_BUDGET_S + _WALL_CLOCK_GRACE_S, uid, total_ms,
        )
        return None
    except _ProviderFailure as exc:
        # B37 — retries exhausted (or a non-retryable status hit on the
        # first attempt): OpenRouter itself is the problem, not the
        # question. Distinct from every `None` return above: the caller
        # (can_i.py) must tell this apart from a genuine off-topic decline
        # or an unparseable answer and reply honestly that the service
        # could not answer right now, `out_of_scope: False` — see that
        # module's own handling of `agent_result.get("provider_error")`.
        total_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "penny_agent: provider failure for %s after %dms (%s), reporting infrastructure failure",
            uid, total_ms, exc,
        )
        return {"provider_error": True}
    except Exception:
        total_ms = int((time.monotonic() - started) * 1000)
        logger.exception("penny_agent: failed for %s after %dms", uid, total_ms)
        return None
