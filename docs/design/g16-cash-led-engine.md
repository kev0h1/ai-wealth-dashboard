# G16 — Safe-to-Spend goes cash-led in the engine

Proposal only. Nothing in this document has been built; `routers/analytics.py`,
`services/net_position.py`, `components/SafeToSpendCard.tsx` and every other
production file are untouched by this round. See
`frontend/app/design/cash-led-engine/` for the visual side of this proposal
and this file's final section for real UAT numbers (reported to Kevin only,
never written into a preview or a fixture).

Kevin's own framing (2026-09-09), verbatim intent: "card spend never leaves
cash in the period it is charged." The 2026-08-25 net-position doctrine had
`compute_safe_to_spend` subtract `card_growth_unpaid` from the cash runway so
a user funding life on a card could never read as having spare cash. G14
(also 2026-09-09, shipped) already moved the *hero* to cash-led — the figure
Home shows is `safe_to_spend_cash`, not the net figure — but the *engine*
underneath (the `safe_to_spend` field itself, and everything that reasons
over it) stayed net-of-card-growth. G16 finishes the move: the engine's
`safe_to_spend` becomes the cash figure too, for every consumer, with one
narrow fallback.

## 1. The rule, precisely

### Today (`routers/analytics.py` step 6c, `compute_safe_to_spend`)

```
safe_to_spend_cash = safe_to_spend                       # pre-card figure
card_growth_reserved = await card_growth_unpaid(uid, period_start, today, window_bills)
if card_growth_reserved:
    safe_to_spend = round(safe_to_spend - card_growth_reserved, 2)
```

Every card's unpaid growth this period (net of any card payment already
inside `window_bills` — the double-count guard) is subtracted from the pot,
unconditionally. `state`/`short_reason` are then derived from this NET
figure.

### Proposed

```
safe_to_spend_cash = safe_to_spend            # unchanged — still the cash-only figure
per_card = await card_growth_unpaid_by_card(uid, period_start, today, window_bills)
    # one query (existing _credit_card_account_ids + _txns_for_period, grouped
    # by account_id in Python — no extra DB round trip vs today), returns
    # [{account_id, growth, has_forecast_series}] per card with growth > 0.
    # has_forecast_series: True when `cached["recurring_spend"]` (already
    # loaded, zero extra queries — see §3) contains a pattern whose
    # `card_dest_account_id` equals this card's account_id, whether or not
    # that pattern's own next occurrence falls inside THIS period's window.
    # Existence of a learned repayment series is the signal, not timing.

card_growth_total = round(sum(c["growth"] for c in per_card), 2)      # the FACT
unforecast_growth  = round(sum(c["growth"] for c in per_card if not c["has_forecast_series"]), 2)

card_growth_reserved = 0.0
if unforecast_growth:
    card_growth_reserved = unforecast_growth
    safe_to_spend = round(safe_to_spend - card_growth_reserved, 2)   # fallback only
# else: safe_to_spend stays exactly safe_to_spend_cash — cash-led.
```

`safe_to_spend` is no longer net of card growth by default. It is reduced
only by the portion of this period's card growth that belongs to a card with
**no learned repayment series at all** — not "no series due before payday",
"no series, full stop." A card whose repayment series is learned is trusted:
its bill will land in a future cash walk (this period's, if the forecast
date falls before payday, else a later one) exactly the way every other
bill already does, and the engine no longer pre-empts that by reserving
against a debt that hasn't materialised as a cash event yet.

`card_growth_total` (new field) is the FACT: total unpaid card growth this
period, regardless of whether it was reserved. It is always computed and
always returned, so the hero's amber line and Penny's facts never have to
re-derive it.

### The fallback condition, spelled out

"Growth present AND no forecast card payment series at all" means: sum the
period's debit-minus-credit delta on the card (unchanged maths,
`_card_delta`, same double-count guard against a scheduled window bill), and
separately ask "has this card's repayment series ever been learned?" — a
yes/no lookup against `cached["recurring_spend"]`'s `card_dest_account_id`
field (see §3), not a fresh classification. If the card has growth but that
lookup comes back empty, the growth is reserved, exactly as it is today for
every card. If the lookup finds a series, the growth is a FACT only.

**Pay-in-full user whose bill has not been learned yet**: this is exactly
the fallback case, and it is the reason the fallback exists at all. A user
who always clears the card in full has genuine growth mid-period (spending
that hasn't been billed yet) and, until the recurring-pattern detector has
seen 2+ cycles of the repayment debit, no learned series. Under this
proposal they get the SAME protection they have today: the growth is
reserved and the hero floors at £0 amber, because the engine cannot yet
prove the bill is accounted for. Once the repayment series is learned (a
matter of one or two billing cycles for an established user, immediate for
anyone `debt_plan.py` has already classified via a payment-matches-spend
pattern), the fallback stops firing and the engine trusts the forecast
instead of re-reserving forever.

## 2. Every consumer of `safe_to_spend` / `card_growth_reserved`

| Consumer | Today | Under this proposal |
| --- | --- | --- |
| `routers/analytics.py` `compute_safe_to_spend` (`state`, `short_reason`) | `state` derived from the NET figure; "short" fires for both a genuine cash gap and a card-funded one, disambiguated by `short_reason` (`"bills"` / `"cards"`) | `state` derived from the (now almost-always cash) figure. Ordinary card growth (series learned) no longer pushes `state` to "short" at all — a user with £38 cash and £761 of *forecast* card growth reads "tight" or "comfortable" on the pot alone, with the card fact reported alongside, not folded into the verdict. Only the fallback case still produces a genuine "short" reading, under a renamed `short_reason` (§4) |
| `components/SafeToSpendCard.tsx` hero | Cash-led already (G14): hero always renders `safe_to_spend_cash`, clamped to £0 amber for `short_reason === "cards"`. **This file is unaffected by G16** — the hero already shows what the engine is now catching up to | Same hero markup. The `card_growth_reserved` field it renders keeps working — for the fallback case, `card_growth_reserved` still carries the reserved amount as today. For the ordinary case, `card_growth_reserved` is 0 and the new `card_growth_total` field (not yet read by this component) carries the FACT for a follow-on frontend change (out of scope for this proposal — see §6) |
| `components/HomeBrief.tsx` (Penny brief fallback paragraph) | `short_reason === "cards"` branch: "Nothing new needs you. The one thing worth a look is the card spending this period, shown in Safe to Spend below." | This branch fires far less often (only the fallback case). A card whose bill IS learned no longer produces a "short" reading for the Brief to react to at all — nothing needs pointing at, the ordinary "headroom" fallback text applies instead, with the card fact living on the hero card beneath, as intended |
| `services/pace.py` `compute_pace` (`pot = safe_to_spend`) | Sustainable £/day rate computed against the NET pot — a card-funded user's "pace" already looked worse than their actual cash position, quietly throttling their spend-rate reading below what their bank balance shows | Pace now reads the cash-led pot for anyone whose card bill is forecast — sustainable rate matches the cash actually available. Fallback-case users are unaffected (same reserved pot as today) |
| `services/spend_impact.py` `_headroom()` (via `response_cache` → `compute_safe_to_spend`) | Caps a "your move looks set to shrink" promise at `min(abs(delta), headroom)`, headroom = net pot floored at 0 | Headroom becomes the cash-led figure — **larger** for anyone with forecast (unreserved) card growth. This is the sharpest risk in this proposal; see §5 |
| `services/spend_impact.py` net-negative gate (`net_position.period_net`) | Independent of this change — `period_net`'s own `card_growth` is already unfloored/descriptive and was never wired into `compute_safe_to_spend`. No change | No change |
| `routers/can_i.py` `can_i_suggestions` (`GET /can-i/suggestions`) | `free = safe_to_spend` (net); `free <= 0` renders `_nothing_spare_line`, disambiguated by `short_reason` | `free` is cash-led. Ordinary card-growth users get an ordinary positive-`free` context line — this proposal adds a new branch so that line also carries the card FACT ("£38 free · 6 days left, £761 gone on cards" or Kevin's own composed sentence, see §4). The `_nothing_spare_line("cards", …)` branch only fires for the fallback case now, and needs re-wording since "cards" no longer means "bills are covered but spare is gone", it means "a card bill needs confirming" |
| `services/affordability.py` `check_affordability` (Penny's `check_affordability` tool) | `safe_to_spend` (net) drives `free_after_spend`, `verdict_word`, `nearest_yes_amount`, `per_day` — a card-funded user could be told "no" to a purchase their bank balance covers | All of these become cash-led. `result` gains a `card_growth` fact (§4) so the model can say "yes, and £761 has gone on cards this period" instead of silently omitting the card story. The fallback case is unaffected — Penny still says "no" honestly when the reserve is protecting an unconfirmed bill |
| `services/penny_tools.py` `_exec_get_safe_to_spend` (`get_safe_to_spend` tool) | Returns `safe_to_spend`, `state`, `short_reason`, `card_debt` (total outstanding balance, unrelated to this change) — no period-growth fact at all today | Gains a `card_growth` money fact (raw + formatted) and, when non-zero, a `card_growth_wording: "carried" | "cleared_monthly"` hint (§4) so Penny's prose can match the hero's own line |
| `routers/grow.py` `_period_gate` (`short = state == "short"`, `to_cover = abs(safe_to_spend)`) | Any card-funded shortfall blocks Grow's "you have surplus, here's where to put it" framing, even when cash is genuinely free | Only a genuine cash shortfall (or the fallback case) blocks Grow now. A user with £38 spare and £761 of *forecast* card growth is no longer told they can't consider saving this period — arguably a correctness fix riding along with this change, flagged honestly in §5 |
| `services/companion.py` (`_source_min_running`, payday-plan sizing) | Reads `total_reserved_remaining` (allocations) via `compute_safe_to_spend`, not `card_growth_reserved` directly — a separate reservation on a separate figure (source-account headroom, not the pooled pot) | Unaffected. Confirmed by reading; no card-growth dependency in this module |
| `services/warmup.py` (`_compute_safe_to_spend`) | Pre-warms the cached response via `build_safe_to_spend_response` | No code change — inherits whatever `compute_safe_to_spend` returns, same as today |
| `routers/planned.py` (`safe_to_spend_before`/`_after` one-off preview) | Reads `safe_to_spend` net, before/after a hypothetical planned expense | Cash-led before/after, same mechanism, no shape change |
| `routers/mcp.py` | Only a scope-name string (`"get_safe_to_spend": "accounts:read"`) — not a consumer of the figure | No change |
| `routers/allocations.py`, `routers/commitments.py` | Docstring cross-references only ("called by `compute_safe_to_spend` to reserve...") — these modules PRODUCE a reserve `compute_safe_to_spend` consumes, they do not read `safe_to_spend`/`card_growth_reserved` back | No change |

## 3. The forecast-series signal (and why it, not a full classification, is cheap enough)

`compute_safe_to_spend` is a hot path: it is called directly, bypassing the
90s response cache, from `can_i.py`'s suggestions/affordability handlers,
`grow.py`'s period gate, and `planned.py`'s before/after preview (twice) —
`compute_safe_to_spend`'s own docstring is explicit that a full-period
transaction scan plus a `get_category_kinds` read on every one of those
calls "would be a real perf regression regardless." `debt_plan.py`'s
`_classify_card` (carried_zero / carried_interest / cleared_monthly /
unclear) is exactly that kind of scan — per card, it needs the card's
transaction history, an aged-balance reconstruction, interest-charge
detection, and a payment-matches-prior-spend pattern check. It is the right
tool for the Cards page (computed once, cached, invalidated on writes); it
is the wrong tool to run inline on every Penny message.

Two cheaper signals are already sitting in data `compute_safe_to_spend`
either already loads or can load for one extra (already-necessary) query:

1. **Forecast-series existence** — `cached["recurring_spend"]` (the same
   `cached` doc `compute_safe_to_spend` already holds via
   `cashflow_cache_col.find_one`, zero extra queries) carries
   `card_dest_account_id` on any recurring-spend pattern the engine has
   linked to a credit-card repayment (`_serialise_pattern`,
   `routers/analytics.py:2016`; the matching logic that produces it is
   `_learn_card_repayment_destinations`, `routers/analytics.py:~1480`).
   `has_forecast_series` for a card is simply "does any pattern in this list
   carry `card_dest_account_id == <this card's account_id>`" — a dict
   lookup, not a query. This is what §1's rule uses to decide the fallback.

2. **Declared usage** (`card_terms_col`, one query, no transaction fan-out)
   — G10 shipped a direct `usage: "clear_monthly" | "carry"` field on the
   ASKED card-terms document (`routers/card_terms.py`), the same field
   `_classify_card` falls back to when the transaction evidence is
   inconclusive (`services/debt_plan.py:1382-1385`). This is the signal for
   the AMBER LINE'S WORDING (§4) — it answers "does the user say they clear
   this card monthly", which forecast-series-existence alone cannot: a card
   on a minimum-payment plan can have a perfectly well-learned repayment
   series (the recurring minimum payment itself) while still carrying a
   balance forward. Series-existence and usage answer two different
   questions and must not be conflated — series-existence gates the
   fallback reserve (a safety question); usage picks the wording (a
   framing question). A card with no `card_terms_col` doc at all (never
   asked) defaults to the "carried" wording — the more cautious of the two,
   consistent with every other fail-closed default in this module.

## 4. `short_reason_for` and the "cards" state

Today: `short_reason_for(state, safe_to_spend_cash)` returns `"bills"` when
the cash figure itself is non-positive (genuine risk, red), `"cards"`
otherwise (bills covered, shortfall is card-funded, amber, hero clamps to
£0). Every "short" reading has exactly one of these two reasons.

Proposed: a THIRD path opens up, because `state == "short"` can now happen
for a reason that is neither a genuine cash gap nor ordinary card spending —
it can happen because the fallback reserve fired (an unconfirmed card bill).
The function becomes:

```
def short_reason_for(state, safe_to_spend_cash, card_growth_reserved):
    if state != "short":
        return None
    if safe_to_spend_cash <= 0:
        return "bills"
    if card_growth_reserved > 0:
        return "cards_unconfirmed"     # renamed from "cards" — see below
    return None   # should not happen: state=="short" with cash>0 and no
                   # reserve is a contradiction under the new rule; kept
                   # as a defensive None rather than a silent mis-label
```

`"cards"` as a value is retired and renamed `"cards_unconfirmed"` — the old
name described "the shortfall is card-funded spending, bills are covered",
which was true of every card-short reading under the old rule. Under the
new rule it is no longer true of *most* card-growth situations (those are
no longer "short" at all — they are a comfortable/tight state with a fact
line, see the hero-state table below); it is true only of the narrow
fallback case, where the honest description is "a card bill exists that we
cannot yet confirm is covered", not "bills are covered but cards used the
spare." The rename is a correctness fix for what the word means now, not
cosmetic.

**States the UI and Penny would then see**, replacing today's two:

| State | `short_reason` | Meaning | Colour |
| --- | --- | --- | --- |
| `comfortable` / `tight` | `null` | Ordinary, cash comfortably (or tightly) covers the period; may or may not carry card growth | Emerald / amber chip only, unchanged |
| `comfortable` / `tight` **+ `card_growth_total > 0`** | `null` | NEW: cash is fine, but card growth is being reported as a fact (the amber line under the hero) | Same emerald/amber hero, plus a neutral-to-amber informational line — never a red or "short" signal, because nothing about this state is short |
| `short` | `"bills"` | Genuine cash gap, unchanged from today | Red, unchanged |
| `short` | `"cards_unconfirmed"` | Fallback fired: growth exists on a card with no learned repayment series, reserved out of caution | Amber, floors at £0 — visually identical to today's `isCardsShort` branch, renamed |

**What happens to `isCardsShort` and the amber chip**: `SafeToSpendCard.tsx`
is not changed by this proposal (out of scope, production file), but the
frontend work this doc's preview illustrates would rename the constant to
`isCardsUnconfirmed` (`data.short_reason === "cards_unconfirmed"`) and its
chip label from "Cards used the spare" to something honest about the new
meaning — the preview proposes **"Card bill unconfirmed"**. The chip's
colour, icon, and £0-floor behaviour are unchanged; only the label and the
body copy underneath change, because the underlying claim changed from "you
spent your spare money on cards" to "we can't yet confirm a card bill is
accounted for." The NEW comfortable/tight-plus-card-fact state (row 2 above)
needs a home in the same component: this proposal's preview adds it as a new
secondary line, visually identical in placement to today's G14 line, active
whenever `card_growth_total > 0` regardless of state, worded per §1's carried
/cleared-monthly rule instead of the flat "£X went on cards unpaid this
period" sentence.

## 5. Risk — honest version

This makes the headline number **larger** for anyone carrying card growth
with a learned repayment series, in the direction opposite of conservative.
Today, a user who has put £761 on their card this period sees that
reflected as £761 less "safe to spend" everywhere the engine looks. Under
this proposal, provided the repayment series is learned, they see the full
cash figure and a separate amber sentence they can choose to read or not.

**What could go wrong**: the sharpest case is exactly Kevin's own framing —
a user spends the £38 the engine now calls "free," and that £38 (or some of
it) turns out to be needed for the card bill that lands after payday. This
is real: cash and card debt are genuinely fungible from the user's point of
view even though this proposal (correctly, per Kevin's stock/flow doctrine
in `net_position.py`) keeps them as two separate frames. The mitigations
are:

1. **The fallback protects the case with no evidence at all.** A card with
   no learned repayment series still gets the old, conservative treatment —
   this is exactly the population most likely to be surprised, because the
   engine has never seen them pay a card bill and so has no forecast to
   point to. This is the majority of the actual risk surface for a NEW
   card-carrying user; it is not weakened by this proposal.
2. **The amber line is a fact every time there is one, not a dismissible
   toast.** It sits directly under the hero figure, in the same visual
   weight as today's G14 line, every time `card_growth_total > 0` — not
   gated behind "Full calculation," not a one-time notification. A user who
   never reads the second line is exactly as exposed under this proposal as
   under today's live behaviour is to the analogous "read the small print"
   risk everywhere else in the product (buffer, allocations, commitments
   are all disclosed the same way, not hard-blocked).
3. **The bill-lands-after-payday case is the genuine residual gap.** When a
   card's repayment series IS learned but its next occurrence falls AFTER
   `next_payday`, `window_bills` never includes it (the window is
   `today..next_payday` only), so nothing in the cash walk ever reduces the
   pot for it, in EITHER the old or the new rule — this is not new
   exposure, it is the same exposure the fallback's opposite case (series
   learned) has always had, just now visible without a compensating
   reserve. Concretely: a cleared-monthly card whose statement closes after
   payday means this period's growth becomes NEXT period's bill, funded (in
   the ordinary case) out of next period's income, not this period's cash —
   which is arguably the economically correct frame (Kevin's own "card
   spend never leaves cash in the period it is charged"), but it does mean
   the amber line is the ONLY signal for that upcoming bill until it enters
   a future window. No hard reserve catches this by design; a user who
   spends past what the NEXT bill will need, having ignored the line, is
   not protected by anything in this proposal beyond the fact itself.
4. **`spend_impact`'s headroom cap grows too.** §2 flags this directly: the
   "your move looks set to shrink" promise cap widens by exactly the
   unreserved card growth for anyone in the ordinary (series-learned) case.
   This is the same fungibility risk as point 1, one level removed — a
   payday-move promise capped against a bigger headroom could promise money
   that is, in the user's own mental model, already spoken for by a card.
   This proposal does not add a mitigation here beyond the amber line
   itself; it is worth Kevin deciding explicitly whether `spend_impact`
   should keep netting card growth out of ITS headroom even though the
   pot's own state/short_reason no longer does — that would be a deliberate
   asymmetry (Home shows cash-led, spend_impact's promise stays
   conservative) and is flagged here as an open question, not resolved by
   this proposal.

## 6. Migration note — what else has to change

- **`DESIGN.md`**, "The Safe-to-Spend hero (Home)" section: the "card
  position" stage description ("unpaid card balance growth" as a reserved
  stage of the ledger) needs to describe the new split — cash forecast,
  set-asides, and an OPTIONAL fallback-only card reserve stage, distinct
  from the always-present informational card-growth line. The status-pill
  word list ("On track, Tight, Cards used the spare, or Short") needs its
  third item renamed to match §4's chip label.
- **`PENNY_TOOLS.md`**, the tool catalog table: `get_safe_to_spend`'s
  "Returns" cell currently reads "net-of-card-growth STS per the
  net-position doctrine" — becomes something like "cash-led STS; card
  growth is a separate fact, reserved only when a card's growth has no
  learned repayment series" and the `check_affordability` row's "Returns"
  cell needs the new `card_growth` fact mentioned alongside the existing
  nearest-yes/savings-pace facts.
- **`services/net_position.py`**'s own module docstring — the "two frames,
  never subtracted" doctrine statement is not contradicted by this proposal
  (`card_growth_unpaid`'s STOCK/FLOW distinction is unchanged; what changes
  is how much of the stock figure gets reserved), but the docstring's
  claim that `compute_safe_to_spend` reserves ALL unpaid card growth needs
  updating to describe the fallback-only reserve, and `short_reason_for`'s
  own docstring needs the `cards_unconfirmed` rename and the new
  comfortable/tight-plus-fact state documented.
- **`tests/test_net_position.py`**: every `card_growth_unpaid`-focused test
  (the floored-at-zero, double-count-guard, and no-card-accounts tests)
  stays valid as-is — that function's own maths is unchanged by this
  proposal, only how its result is USED changes. The three
  `short_reason_for` tests (`test_short_reason_none_when_not_short`,
  `test_short_reason_bills_when_cash_pot_itself_non_positive`,
  `test_short_reason_cards_when_bills_covered_but_net_short`) need a
  `card_growth_reserved` argument threaded into the call per §4's new
  signature, and the "cards" test needs renaming/updating for
  `"cards_unconfirmed"`. A NEW test function is needed for
  `card_growth_unpaid_by_card` (or whatever the per-card helper is named)
  covering: a card with a learned series is excluded from the reserve even
  with growth; a card with no series is included; a mixed two-card case
  reserves only the unlearned card's portion.
- **`tests/test_safe_to_spend_hardening.py`**:
  `test_safe_to_spend_returns_lowest_projected_balance_and_reconciles_cash`
  and `test_safe_to_spend_marks_a_known_reserve_failure_degraded` both
  exercise step 6c's reserve path and will need fixture data that
  distinguishes a card WITH a learned series (asserting `safe_to_spend ==
  safe_to_spend_cash`, no reserve) from one WITHOUT (asserting the fallback
  reserve fires exactly as today's tests already assert). New assertions
  are needed for `card_growth_total` being present and correct regardless
  of which branch fired, and for the renamed `short_reason` value.
- **Frontend** (not touched by this proposal, listed for completeness): the
  `short_reason` TypeScript union in `lib/api.ts` (`"bills" | "cards" |
  null`) needs `"cards"` renamed to `"cards_unconfirmed"`, and
  `SafeToSpendCard.tsx`, `HomeBrief.tsx` need the corresponding rename plus
  the new comfortable/tight-plus-card-fact secondary line (§4). This is
  real frontend work, out of scope for this proposal round, and should be
  its own follow-on item once Kevin approves the direction.

## 7. Real-data dry run (UAT, read-only)

Reported to Kevin in the session reply only — see the chat message this
session sent back, not this file. No production data is reproduced here or
in the preview fixtures (which use public-safe, invented figures).
