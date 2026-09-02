# PENNY_TOOLS.md, Penny as an agent over the app's engines

Status: **Ground-up loop-first rebuild, owner decision 2026-08-26**,
superseding the original phased plan below (kept for record, see
"Phasing" section). Why: the first live question asked of the phased
build, "How can I improve my entertainment spending", was captured by the
deterministic ladder's category-synonym match on "entertainment" and
confidently answered with a current-period total, a different question
than the one asked, and the tool-calling loop that could have actually
reasoned about it was never even consulted.

Catalog expanded 13 -> 17 tools, 2026-08-27, driven by a screen-by-screen
question inventory (see "Coverage checklist" below): four new tools
(`get_today_brief`, `get_recurring_payments`, `get_account_activity`,
`get_mirror`), `get_page_explainer` replaced by a single `explain(topic)`
covering three new registries (jargon terms, headline-number reconciliation,
how-do-I action walkthroughs) on top of the original page/topic copy, and
an enrichment pass wiring through why-fields six existing tools were
dropping (`get_debt_position`, `get_upcoming_bills`, `get_insights`,
`get_accounts`, `get_goals`, `get_spend_verdict`). All still read-only,
uid-scoped, currency-aware, raw+formatted GBP.

---

## The problem (unchanged diagnosis, now acted on fully)

One message takes one trip: question, then roughly 4,900 lines of hand-built
routing in `backend/app/routers/can_i.py` (synonym tables, domain ladder,
per-screen vocabulary, out-of-scope gate), then one engine's facts, then one
Haiku call that phrases them. The model never comes back to the app, so
every new question shape needs another rung of routing code. Phase 1 let the
loop answer only the ladder's terminal refusal; the entertainment-spend bug
showed that a confident wrong route never REACHES a refusal at all, so a
fallback-only loop can never fix the class of bug it exists to fix.

---

## The change

Penny's backend runs a tool loop, and now runs it FIRST. The model receives
the message plus a catalog of tool schemas and may reply with a tool call
instead of text. The backend executes the tool against the existing engine,
appends the compact JSON result, and calls the model again. Capped loop,
then a final phrased answer.

Doctrine holds: tools ARE the deterministic engines. The model gains agency
over retrieval, which engine to consult, what to search, and keeps zero
agency over arithmetic and verdicts. Every tool returns pre-derived verdict
words, hedged dates, and pre-formatted GBP strings the model must quote
verbatim. The LLM decides what to look up, never what the numbers are.

---

## Tool catalog

| Tool | Backs onto | Returns |
| --- | --- | --- |
| `get_safe_to_spend` | `compute_safe_to_spend` (`analytics.py`) | net-of-card-growth STS per the net-position doctrine |
| `get_upcoming_bills` | the cashflow engine, `_compute_cashflow_patterns` LIVE on a cache miss (mirrors `GET /cashflow`, audit fix 2026-08-26) | hedged, dated bill and income events, each with account name/bank/balance, kind, pending/edited/days-past-due/original-date/rule_label state (enrichment pass, 2026-08-27); `insufficient_data` only when the user has no connected accounts at all |
| `search_transactions(q, category, merchants, from, to, txn_type)` | the same query builder as `GET /transactions/search` | at most 20 compact rows |
| `get_accounts` | account service, plus a twin of `accountKind.ts`'s substring classifier (kind/dormant have no backend field), `preferences.home_pinned_accounts`, `sync_freshness.last_bank_sync` | balances, names, providers, types, kind label, status, dormant flag, pinned, last_synced; never credentials or tokens |
| `get_spend_verdict(period_offset)` | the spend verdict service | reading (with "move" jargon translated to plain prose), pills, pace, quiet_flags, unresolved (count/materiality/largest), moved breakdown by kind, notables' cause lists and consequence lines, period.closed/days_left (enrichment pass, 2026-08-27) |
| `get_savings_position` | savings cashflow | current savings, Savings-tab surplus semantics |
| `get_debt_position` | debt plan engine | balances, plan state, terms asked never assumed; per-card rate_schedule/classification/classification_evidence/movement.monthly-basis-periods_used/potential_monthly_interest/usage(_conflict), plus top-level scenario_b, extra_to_clear, transfer_routes (refinance_options) (enrichment pass, 2026-08-27) |
| `get_goals` | `app.routers.commitments.list_commitments` (the same route Planning's Commitments block calls, replacing a thin `commitments_col` read, 2026-08-27) | active/done goals with progress, per_period_slice, periods_left, on_track, feasibility(_note), pace_note, shared_pot_goals, funding_pots |
| `check_affordability(amount, timeframe?)` | `app.services.affordability` (extracted from the deleted ladder's own what-if arithmetic) | a final, quote-verbatim `verdict` sentence, the £ figures raw+formatted, nearest-yes/savings-pace facts; `ask_when: true` + `timeframe_assumed: "current_period"` when a large amount was judged against the current period for lack of a timeframe (restored ladder behaviour, audit fix 2026-08-26) |
| `get_category_spend(category?, months?)` | `compute_spend_verdict` (this period) + raw transaction rows (top merchants / N-month total), home-currency filtered the same way `_load_period_txns` is (audit fix 2026-08-26) | per-category totals, payment counts, top 3 merchants — server-aggregated, never summed by the model |
| `get_insights` | `savings_insights_col`, ranked the same way GET /savings-insights ranks it, plus `GET /value-delivered` | title/summary/estimated-saving per insight, rank 1 = best; triggered_by, verified_savings/merchant, deadline_at, is_new, return_reason, plus a value_delivered summary with breakdown[] (enrichment pass, 2026-08-27) |
| `explain(topic)` | one flat registry in `penny_tools.py`: fixed screen/topic copy moved verbatim from the deleted ladder, PLUS four new registries (2026-08-27) | (a) per-screen/topic copy (isa_capability/saving_vs_investing/categorisation), (b) 14 jargon-term definitions grounded in code, (c) 8 headline-number reconciliations (what a figure includes/excludes and which sibling it disagrees with), (d) 13 how-do-I action walkthroughs, (e) 16 UK money-basics explainers (isa-allowance, cash-vs-ss-isa, lisa, personal-savings-allowance, emergency-fund, high-interest-debt-first, pension-match, pension-tax-relief, compound-interest, investment-fees, diversification, dividend-allowance, cgt-allowance, tax-year-dates, premium-bonds, marriage-allowance), imported from `app.content.money_basics.MONEY_BASICS` (the retired "Money basics" rotating Home card's own content, now grounding here instead) rather than copy-pasted, so the two can never drift; unknown topic returns the full valid-key list. 63 keys total (`checkpoint` is a second key aliasing `aim`'s own entry, same concept named both ways in the app, so 62 distinct pieces of copy). Replaces `get_page_explainer` |
| `get_tax_position` | `app.routers.chat.build_tax_fact_pack` (shared with `answer_tax_question`, extracted 2026-08-26) | the user's OWN income, pension, adjusted net income, personal allowance remaining, Child Benefit status |
| `get_today_brief` | `app.services.companion.compute_today_items` (the engine behind `GET /today`), live plus a `payday_preview=1` fallback when nothing is live | the companion feed items (move/payday_plan/cliff/celebration/ask/rhythm/needle/intent_pace/trajectory), with `move` items' full plan (plan_dest, source legs, covered, sources_safe, residual, income_note) and the payday plan split, live or previewable |
| `get_recurring_payments` | the same cashflow-cache patterns (`recurring_spend`) behind `GET /cashflow`'s upcoming bills, cadence labelled from the detector's own weekly/fortnightly/monthly day-count bands | per-series name, cadence, typical amount, next expected date, billing account/bank, kind, pending/edited/days-past-due state |
| `get_account_activity(account_id_or_name?, days?=30)` | server-side aggregation over the same 5-collection union `search_transactions` reads, home-currency filtered, spend-vs-movement split via `app.services.categories.is_non_spend` | money in/out (spend vs movement), net, top 5 transactions, current balance, per account or every account; a NAME matching more than one account returns `{ambiguous: true, matches: [...]}` (never guesses, audit fix 2026-08-27), an `id` from `get_accounts` always resolves precisely |
| `get_mirror` | `app.services.behaviour.compute_portrait` (`GET /mirror`'s engine) plus `app.services.checkpoints.list_active` (`GET /checkpoints`'s engine); merges the user's persisted keep/change choice onto a fresh in-memory compute without writing back | traits (title, narrative, evidence, kind, choice), computed_at, window_days, active aims (category, aim_amount, spent_so_far, days_left, on_track) |
| `calculate(expression)` | `app.services.safe_calc.evaluate`, owner-approved 2026-08-30 — generic arithmetic via Python `ast` parsing against a strict whitelist (numeric literals, `+ - * / // % **`, unary minus, parentheses, and calls to exactly `round`/`abs`/`min`/`max`/`series_sum(first, step, count)`/`days_between("YYYY-MM-DD","YYYY-MM-DD")`/`pct(x, p)`), never `eval`/`exec`. Names, attribute access, subscripts, strings outside `days_between`, comprehensions, lambdas and any other call are all rejected by construction. Bounds: expression ≤ 400 chars, ≤ 150 AST nodes, `**` exponent \|e\| ≤ 12, `series_sum` count ≤ 5000, \|result\| < 1e12, division by zero and every other rejection return a clean `{"ok": false, "error": "..."}` rather than raising. `series_sum` is the owner's own envelope case: a daily savings-challenge payment rising a fixed step each day, e.g. `series_sum(8.96, 0.04, 27)` for a first payment of £8.96 rising 4p a day for 27 days. `days_between` is inclusive of the first date, exclusive of the second. | `{ok, result, error}` plus the echoed `expression`, so a reply or a proposal's consequence line can show its working |

All 19 of the above are read-only.

## Write tools (propose-only)

Status: **Owner-approved, 2026-08-30 — Penny Agent Mode v1.** Supersedes the
"No write tools" line below (kept as history, not deleted, per this doc's own
style): Penny may now PROPOSE eight app actions (six at v1 launch, plus
`propose_recategorise_transaction` added the same day — see the "Doctrine
amendment" note below the table — and `propose_set_card_apr`, added later
the same day as "Doctrine amendment #2"), gated behind a one-time consent
moment. She still never executes anything herself.

Architecture, settled by an owner-reviewed study plus four owner decisions:
(1) confirm-as-is cards, no inline edits inside the proposal itself; (2) a
ONE-TIME consent moment before Penny may propose ANY action at all
(`penny_agent_consent` on preferences, granted via `POST
/penny/agent-consent`, checked by `app.services.penny_agent` before it even
offers a write-tool schema to the model); (3) an executed proposal's real
artefact carries `created_via: "penny"` (allocations/planned/commitments
docs, exposed on their own GET payloads); (4) a single 15-minute proposal
TTL (`penny_proposals_col`, Mongo TTL index on `expires_at`).

Follow-up, same day: the original contract only shipped the grant side, with
no way for a Settings toggle to turn Penny's write access back off. Added:
`DELETE /penny/agent-consent` clears `penny_agent_consent` back to falsy,
idempotently. It takes effect in two places — `app.services.penny_agent`
reads the field live on every call (no caching), so the very next question
excludes the propose-tool schemas exactly as a never-consented user's would;
and `POST /penny/proposals/{id}/execute` re-checks consent AT EXECUTE TIME
too, not only at proposal-creation time, so a proposal built while consented
but still sitting unactioned inside its 15-minute window cannot be executed
after revocation fires (rejects 403 with a human-readable `detail`, distinct
from the 410s used for expired/cancelled). An already-executed proposal's
idempotent replay is unaffected by revocation — replaying history is never
itself a new write.

CORE PRINCIPLE: **Penny proposes, never executes.** Every write tool below
builds a validated PROPOSAL row (`{proposal_id, kind, summary, consequence,
params}`) and never mutates real data itself. A separate pair of endpoints —
`POST /penny/proposals/{id}/execute` and `.../cancel`, both in
`app.routers.can_i`, neither ever touched by the LLM — is the ONLY code path
that turns a proposal into a real write, and it does that by replaying the
proposal's own stored `params` through the SAME router-level function the
app's own confirm sheet already calls for that action (re-validating
ownership/conflicts live, exactly like a normal user request). Execute is
idempotent (a second call replays the stored `result`, never double-creates)
and logs one audit line (`penny_proposal_audit uid=... proposal_id=...
kind=... executed_at=... source=penny`) to `journalctl -u wealth-api`.

| Tool | Defers to (router function) | Risk tier |
| --- | --- | --- |
| `propose_mirror_choice(trait_id, choice)` | `app.routers.behaviour.set_mirror_choice` | Low — records a keep/change choice on a trait, nothing financial moves |
| `propose_dismiss_recurring(key)` | `app.routers.analytics.dismiss_recurring` | Low — stops a series being predicted, reversible via restore |
| `propose_restore_recurring(key)` | `app.routers.analytics.restore_recurring` | Low — undoes a dismiss |
| `propose_add_planned(name, amount, date, account_id?)` | `app.routers.planned.create_planned_expense` | Medium — adds a one-off future payment to the projection, reduces shown safe-to-spend |
| `propose_create_allocation(name, amount_per_period, fill_account_id, match_type, match_value, recurrence, effective_from?)` | `app.routers.allocations.create_allocation` | Medium — reserves a per-period amount from safe-to-spend going forward |
| `propose_create_commitment(name, amount, target_date, funding_pots?)` | `app.routers.commitments.create_commitment` | Medium — reserves a recurring per-period slice from safe-to-spend until the target date |
| `propose_recategorise_transaction(transaction_ref, new_category, scope)` | `app.routers.transactions.update_transaction` (`scope="just_once"`), or that same function followed by `app.routers.categories.add_rule` (`scope="always"` — PATCH-then-rule, the same two-step order `TeachingSheet.tsx`'s own `commitSpend`-then-`handleAlways` already follows) | Medium — refiles one transaction, or one transaction plus every matching past one under a new rule; never touches the miscategorised-guardrail queue |
| `propose_set_card_apr(card_ref, apr_pct)` | `app.routers.card_terms.save_card_terms` (read-modify-write: the existing terms doc is read first via that router's own `_serialize_terms`, every field but `apr_pct` carried forward unchanged) | Medium — sets one credit card's standard APR, feeds the card plan and interest projections; VERBATIM-PROVENANCE gated, see "Doctrine amendment #2" below |

**Doctrine amendment, 2026-08-30 (same day as the v1 launch above).** The
owner watched Penny answer "Can I change this category" with manual
instructions and said, verbatim: "this is another agent action that we need
to add." This consciously amends the retired "Penny never recategorises"
line further down this doc (see "Coverage checklist" below) for
**user-initiated recategorisation only**, via the same propose/confirm
pattern as every other write tool — `propose_recategorise_transaction`
resolves one transaction (by id from `search_transactions`/
`get_account_activity`, or a merchant+date+amount triple), validates
`new_category` against the same picker source the app's own recategorise
sheet uses (`GET /categories`, spend-kind only — never a movement/income
category, ENGINE.md's Destination Rule), and asks the user which `scope`
they want before proposing if the conversation hasn't already said, mirroring
the sheet's own "Just this once" vs "Always file X as Y?" choice.
`scope="always"` states a real blast-radius count in its consequence line
from `app.services.categorisation.count_rule_matches` — a read-only preview
sharing its matching definition with `apply_single_rule` (the function that
actually applies the rule), extracted the same day specifically so the two
can never disagree (ENGINE.md: rules are engine-proposed with blast radius
shown, never auto-applied).

The **miscategorised-guardrail queue stays explicitly EXCLUDED** from this
amendment — transfer-pair suggestions, dismiss-miscategorised, and
resolve-movement all still require the app's own evidence-side-by-side
review sheet, never Penny; no propose tool exists for that domain and none
is added here. `add_rule` (the `scope="always"` execute path) is Pro-gated
in the real app (`Depends(require_tier(Tier.PRO))`); since a direct
router-function call bypasses that FastAPI dependency silently, the tier
check is re-implemented explicitly at both propose time
(`app.services.penny_tools`) and execute time (`app.routers.can_i`).

**Doctrine amendment #2, 2026-08-30 (verbatim owner quote).** "we probably
want to add an agent skill to add Apr to credit cards too" — card terms
(`app.routers.card_terms`) were deliberately EXCLUDED from Penny Agent Mode
v1 at launch, on the grounds that an LLM mishearing or inventing a rate has
no independent check the way an account/series/trait resolution does (those
all resolve against something that already EXISTS; a rate is a number the
model could simply state confidently and wrongly). The owner overrode that
exclusion the same day, and the mitigation replacing the blanket ban is a
**VERBATIM-PROVENANCE RULE**: the numeric rate in any card-terms proposal
MUST appear literally as a number in the user's own latest message, or an
earlier user turn in the conversation history handed to the loop. If the
user has not typed the number, `propose_set_card_apr` returns a
needs-clarification result (`{"needs_input": true, "ask": "What APR is
<card>? Type the number and I'll set it."}`) instead of building a
proposal — no exceptions, and the number is checked for an EXACT match
(after stripping any `%`/`percent` suffix), so "roughly 25" only provenances
the literal value 25, never a more-precise decimal (24.9) the model might
otherwise infer from it. This keeps "the user's answer is the truth"
(`card_terms.py`'s own header doctrine) literally true even inside the
agent loop: Penny can transcribe a stated rate, never infer or paraphrase
one. Implemented server-side in `_provenance_apr_present`
(`app.services.penny_tools`) against `user_texts` that
`app.services.penny_agent`'s own dispatch loop computes from its `messages`
history (never from the model's tool-call JSON, so the model cannot spoof
it) — never left to the system prompt alone, per the amendment's own
requirement.

**Scope v1: standard APR only.** Promo/BT segments (0% purchases or balance
transfer windows, valid-until dates) stay sheet-only for now — the tool's
own description tells the model to route a promo-shaped request ("what about
my 0% period") to the card's own terms sheet in the app instead of mangling
it into an APR figure, so the model routes those requests honestly rather
than guessing at a shape this tool was never built to carry.
`propose_set_card_apr`'s resolver (`_resolve_credit_card_for_propose`)
scopes candidates to credit-card accounts only (the same "Credit" kind
`get_accounts` already reports), and every ambiguous match carries balance
and last-4-digits (`_card_candidate_summary`/`_last4`, the latter only ever
the trailing 4 characters of the stored `account_number` field, matching
`get_accounts`' own "never returns credentials, account numbers or sort
codes" doctrine) so a human can tell apart two identically-named cards —
the owner holds two accounts both literally named "MASTERCARD" at NatWest.
The execute side (`app.routers.can_i._execute_set_card_apr`) is a genuine
read-modify-write: `card_terms.py`'s own `save_card_terms` REPLACES the
whole terms document on every save (by design, so a legacy-shaped doc
migrates on next save), so the executor reads the existing doc first via
that router's own `_serialize_terms` and carries every field but `apr_pct`
forward unchanged, so a recorded 0% promo window or BT offer is never
clobbered by an APR-only proposal.

Plus one new READ tool, added alongside these because the envelope
conversation needs it to resolve "which payment fills it": `get_fill_candidates(account_id_or_name)`
wraps the existing `GET /allocations/fill-candidates` logic (the same picker
data `AllocationSheet` uses), id-or-name resolved the same way
`get_account_activity` resolves an account. 18 read tools total now (17 +
this one); catalog line above updated to match.

Plus one more READ tool, owner-approved 2026-08-30 for a generic maths
need (his own words: "we will need some sort of arithmetic tool in penny
... this needs to be a generic arithmetic tool, other people might have
different use cases"): `calculate(expression)`, see its table row above
for the whitelist and bounds. Doctrine change alongside it (system prompt,
`app/services/penny_agent.py`): Penny never computes multi-step
arithmetic herself, even once she already has every figure in hand from
other tools; she calls `calculate` and shows its working in her reply
rather than stating a total she derived silently. 19 read tools total now
(18 + this one); catalog line above updated to match.

**ANTI-INJECTION RULE**, followed by every builder above (see each
`_exec_propose_*` function's own doctrine comment in
`app/services/penny_tools.py`): every account/series/trait parameter the
model supplies must resolve to an entity that EXISTS and is OWNED by the
calling user, via the SAME lookups the read tools already use
(`get_accounts`'s account list, `get_recurring_payments`'s series,
`get_mirror`'s traits) — a builder never accepts a raw id the model
invented, only an id-or-name it resolves live. Ambiguity (a name matching
more than one candidate) always returns `{"ambiguous": True, "matches":
[...]}` instead of a proposal, the same shape `get_account_activity`
already uses, so the model asks a clarifying question rather than guessing.
This is entity-existence-and-ownership hardening only — **deeper injection
hardening (verifying a parameter traces back to something the user actually
said earlier in the conversation, not merely something that exists and is
theirs) is a flagged follow-up, not built here.**

Loop wiring (`app.services.penny_agent`): flow fix, 2026-08-30, same day as
the original build — the propose-tool schemas (eight as of "Doctrine
amendment #2" above, which added `propose_set_card_apr` on top of the
same-day recategorisation amendment's seven) are now ALWAYS appended to the
tools offered to the model, consented or not. The first version gated
the schema itself on `preferences_col`'s `penny_agent_consent`, which turned
out to make the whole point of a dispatch-level gate unreachable: an
unconsented user asking Penny to do something got a model that never knew a
propose tool existed, so it just declined out-of-scope instead of ever
triggering the one-time consent moment. The gate now lives ONLY at dispatch
time — the model is free to attempt any propose tool whenever a request
calls for it (the system prompt says nothing about consent or availability,
so the refusal never reads as a model-authored decline), and the loop
refuses to actually call `execute_tool` unless `penny_agent_consent` is set,
returning `{"consent_required": True}` instead — the attempted intent is NOT
persisted, no proposal is built. This is what the frontend's one-time
consent card is FOR: show it, and once granted, auto-resend the same
question. When a propose tool DOES return a proposal (consented path), the
loop stops immediately (no further model call, the tool result already
carries a final, deterministic summary/consequence) and `run_penny_agent`
returns `{"proposal": {...}}`. `app.routers.can_i`'s `/can-i` response gains
a `proposal`/`consent_required` branch parallel to its existing `scenario`
branch, both additive on the wire.

## Coverage checklist

The screen-by-screen question inventory driving this catalog lives in
`docs/penny/question-inventory/` (four docs: home-and-penny, spend,
planning-grow-debt, insights-accounts-mirror). Use it as the checklist for
"does a tool exist to answer this" before adding a new one.

~~No write tools in any phase without a separate owner decision: Penny never
moves money, never recategorises, never dismisses. A future v2 may add
propose-only tools that render confirm cards.~~ Superseded 2026-08-30 (see
"Write tools (propose-only)" above) — that separate owner decision has now
been made; kept here as history rather than deleted, per this doc's own
convention.

---

## What stays deterministic

Short-circuits before the loop, unchanged and in this order: greeting,
length gate, the `OPENROUTER_API_KEY` guard, and scenario detection
(`looks_like_scenario` into the slot-confirm card, never simulated without
confirmation). Everything else — every affordability question, every tax
question, every spend/planning/debt/insights question, every page-explainer
ask — now goes through the loop. The honesty guards shipped 2026-08-26 (the
cannot-answer-subject rule, explicit zero-interest facts in debt grounding,
the verdict-quoted-verbatim rule) are the tool-result contract: tools return
complete facts so the model has nothing to invent.

---

## Loop guardrails (unchanged)

- Max 4 model calls per message (first plus 3 tool rounds); at cap, answer from facts in hand.
- One `increment_ai_chat_usage` per user message, regardless of tool rounds.
- Widened to a roughly 60s total budget (40s soft, 20s grace), 2026-08-31 (owner-reported bug: "If we move 825£ from my Monzo account, how much will be left" got the generic refusal). The original 12s/15s figures assumed ~2-4s per OpenRouter round trip; live measurement the same day found `anthropic/claude-haiku-4-5` via OpenRouter routinely taking 10-25s per round trip (confirmed provider/model-side, not network: a control call to a small Llama model over the identical path returned in under a second), so the old budget could not survive even one tool round. Neither suspected gate (the scenario detector, the model's own scope framing) was at fault, see `app.services.penny_agent`'s own dated comment on the constants for the full evidence trail. On timeout or any failure, the deterministic refusal is still returned.
- Every tool trace logged (tools called, arguments, duration, rounds) so a bad answer is debuggable from journalctl.
- System prompt v2 carries house style plus: advice-shaped-question doctrine (facts, not prescription), UK tax-mechanics general knowledge (chat.py's own doctrine folded in), up to 3 sentences when a breakdown genuinely needs it, and conversation-history-is-authoritative for follow-ups.
- History stays the existing 6-turn text cap; tool results are always fetched fresh, never carried between messages.
- Model: `anthropic/claude-haiku-4-5` throughout. A typical answer becomes 2 or 3 calls instead of 1.

---

## Phasing (historical record — Phase 1/2/3 below are superseded)

1. ~~Phase 1, loop as fallback.~~ Shipped, then immediately superseded the
   same day: the entertainment-spend bug proved a confidently-wrong route
   never reaches the fallback branch at all, so scoping the loop to the
   refusal path structurally cannot fix that class of bug.
2. ~~Phase 2, invert per domain.~~ ~~Phase 3, delete the ladder.~~ Collapsed
   into one cutover: the ladder was deleted outright rather than migrated
   domain by domain, since every domain's own routing code was equally
   capable of the same confident-miss failure mode.

### What was deleted

`_resolve_deterministic_route` and its whole call chain: `CATEGORY_SYNONYMS`,
the SPEND/DEBT/PLANNING tier regexes and `_route_domain`, per-screen
vocabulary fallback, the tax question tiers, the ISA-capability/saving-vs-
investing/categorisation-explainer/page-explainer matchers, the category-
spend-history and current-period-category-spend handlers, the payday-status
template, `_try_followup_inheritance` and its four per-route inherited-
follow-up handlers, and the four `_handle_*_domain` LLM-prompt-building
functions (spend/planning/debt/insights). `backend/app/routers/can_i.py`
shrank from 5,409 lines to ~525.

### What survives

- The greeting/length/API-key/scenario gates, byte-identical.
- The deterministic refusal fallback (now reached when the loop itself
  returns `None`, not after a ladder miss).
- `GET /can-i/suggestions` (the chip-seeding endpoint) — untouched, it never
  routed through the ladder.
- Every fixed reply STRING the ladder used to gate to (ISA capability,
  saving-vs-investing, categorisation, the 8 page explainers) — moved
  verbatim into `get_page_explainer`'s topic table in `penny_tools.py`, no
  copy lost.
- The deterministic affordability ARITHMETIC (the golf-session-bug fix, the
  £-delta/multi-month-fit headline logic, nearest-yes-amount) — extracted
  into `app/services/affordability.py` as `check_affordability`'s engine,
  now called with a model-supplied `amount`/`timeframe` instead of full-
  question regex extraction.
- The "move" jargon translation from the spend domain handler — moved into
  `get_spend_verdict`'s own tool executor, so `reading` never reaches the
  model in the confusing form in the first place.
- The user's OWN tax figures (income, pension, adjusted net income,
  personal allowance remaining, Child Benefit) that the deleted tax-question
  tier used to inject via `chat.answer_tax_question` — an independent audit
  (2026-08-26) caught that the rebuild's tax doctrine covered only GENERAL
  mechanics, so a personal question like "how much personal allowance do I
  have left" lost its real answer. Restored as `get_tax_position`, backed by
  `chat.build_tax_fact_pack` (extracted out of `answer_tax_question` so both
  callers share one derivation).
- The ask-when nudge for a large, dateless one-off spend (owner-reported UX
  bug: "Would I be able to afford a trip for 2000£" must ask when the trip
  is, not silently judge it against the current pay period) — the same
  audit caught that the deleted ladder's deterministic reply-suffix
  guarantee had no loop-native equivalent. Restored as a TOOL RESULT signal
  instead: `check_affordability` sets `ask_when: true` when it judged a
  large, timeframe-less amount against the current period (same 0.5-of-
  envelope threshold the deleted predicate used), and a system-prompt rule
  instructs the model to act on it. The one piece not carried over: the
  deleted predicate also required a one-off-shaped SUBJECT word ("trip",
  "holiday", ...) present in the question text; `check_affordability` never
  sees the raw question, so the signal here is threshold-only.

### Known drops (owner decision pending)

- **Commitment hand-off offer.** The deleted ladder's amount+horizon
  "Set this up: £X/period" chip (offering to turn a future-dated
  affordability answer into a tracked commitment) has no equivalent in the
  loop-first flow — `check_affordability` returns facts, not an `offer`
  payload, and `can_i.py`'s new response shape has no field for one. The
  audit confirmed the frontend guards this safely (the feature simply never
  renders, no broken state), so this is a deliberate, flagged gap rather
  than a silent regression, awaiting an owner decision on whether a future
  propose-only tool should restore it.

---

## Honest failure modes (unchanged)

- **Wrong-but-real tool called.** The answer is grounded in a true, possibly irrelevant fact, the trace shows it and the prompt gets tuned.
- **A figure stated without a tool call behind it.** The prompt requires a tool call behind any figure. This is instruction-enforced, not mechanically enforced.
- **Retrieval variance.** Which facts get consulted becomes model-chosen, the facts themselves never vary.

---

## Acceptance corpus

`backend/tests/test_can_i.py`'s original 2,900+ line acceptance corpus,
which pinned the deterministic ladder's behaviour question by question,
retired along with the ladder it pinned — there is no ladder left to
protect a question-by-question route against. The surviving suite (three
test files, 85 tests total — 23 in `test_can_i.py`, 30 in
`test_penny_agent.py`, 32 in the new `test_penny_tools.py`) covers: the
gates that still run before the loop (greeting, length, scenario), the
`/can-i` wire shape and usage-quota discipline, the deterministic refusal
fallback, `GET /can-i/suggestions`, the loop's own mechanics (rounds, tool
dispatch, the wall-clock ceiling, the OUT_OF_SCOPE sentinel),
`check_affordability`'s verdict pass-through and restored `ask_when` nudge,
`get_category_spend`'s server-side aggregation and home-currency filter,
`get_tax_position`'s personal figures, an integration test replaying the
exact motivating bug ("How can I improve my entertainment spending") to
prove it now reaches the loop rather than a synonym match, a
personal-allowance integration test proving the loop reaches
`get_tax_position` rather than answering from general knowledge alone, and
(2026-08-27) `test_penny_tools.py`'s coverage of the four new tools'
documented shapes, `explain`'s coverage across at least 5 term / 4 number /
3 action keys plus the unknown-topic valid-key list, the enrichment fields
on the debt/bills/insights/accounts/goals/spend-verdict tools, and
(post-audit, 2026-08-27) `get_today_brief`'s `persist=False` proof — a real
end-to-end `compute_today_items` run against spy collections asserting
zero write calls while the one-time surprise is still visible, plus a
`persist=True` guard test — and `get_account_activity`'s ambiguous-name
handling (duplicate names, a unique name, and an id always resolving).
Money-basics retirement (2026-08-27): the rotating "Money basics" Home card
was retired as a UI surface entirely (owner decision — education arrives
when asked, not on a 16-day rotation); its 16 curated explainers
(`app/content/money_basics.py`'s `MONEY_BASICS`) now ground `explain`'s new
category (e) instead, imported rather than copy-pasted so content can't
drift between the two. `test_penny_tools.py` covers at least 3 basics keys
returning real text, an unknown key still returning `available_topics`, and
a regression guard asserting no em-dash/en-dash survives in any
`MONEY_BASICS` title/body/takeaway.

Recategorisation amendment (2026-08-30): `backend/tests/test_penny_proposals.py`
(not yet listed above — that file and Penny Agent Mode v1 both postdate this
section) gained the `propose_recategorise_transaction` coverage: resolution
by id and by a merchant+date+amount triple, ambiguity, an out-of-reach
source-collection error (a transaction outside `transactions_col`), an
invalid category returning nearest-match suggestions, a movement-category
rejection, missing/invalid `scope`, both proposal shapes verbatim
(`just_once`'s "Changes only this transaction." and `always`'s real
blast-radius count from fixture history, `exclude_id`-adjusted so the
primary transaction is never double-counted), the Pro-tier gate at both
propose and execute time, the execute dispatch to each scope's real code
path (including "always"'s PATCH-then-`add_rule` two-step), and a standing
guard asserting no guardrail-queue-shaped tool name (`transfer_pair`,
`miscategorised`, `resolve_movement`) ever appears in `PROPOSE_TOOL_NAMES`.

Card-APR amendment #2 (2026-08-30): `test_penny_proposals.py` gained
`propose_set_card_apr` coverage: verbatim-provenance passing when the rate
is in the current message, passing when it's only in an earlier user turn,
refusing (`needs_input`, no proposal doc written) when the model's figure
never appears in the user's own words at all, and refusing a vaguer stated
figure ("roughly 25") against a more-precise invented one (24.9) even
though a different exact number (25) IS present; fuzzy card resolution
including the two-cards-both-named-MASTERCARD ambiguity with balance and
last-4 in each match; APR bounds (negative, over 100) rejected; and the
execute dispatch replaying through `card_terms.py`'s own `save_card_terms`
with an existing card's promo segments verified to survive an APR-only
proposal untouched.

---

## Operating rule while the loop runs everything

New facts and engines flow freely as new TOOLS. New ROUTING rungs in
`can_i.py` are no longer a thing to add at all — there is no ladder left to
extend. If a question needs a new capability, it needs a new tool (or a
system-prompt doctrine addition), never a new deterministic gate in the
router.

---

## Not-MCP decision

Recorded 2026-08-26: no MCP server for Penny. MCP is standardised tool
cataloguing for third-party clients; Penny is first-party, so the catalog
goes in the OpenRouter request payload and the loop lives in our backend. An
MCP wrapper becomes worthwhile only if external assistants should ever talk
to Sorted, and the tool layer here is shaped so that wrapper would be thin.
