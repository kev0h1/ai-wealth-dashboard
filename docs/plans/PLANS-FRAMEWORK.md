# Plans framework: source to sink (G232, spec for Kevin's sign-off)

Status: written spec, no code. Kevin signs this off before any build or design round.
Every rule is tagged **Today** (with the file where it lives) or **Proposed**. British English, hedged where it predicts.

## 0. Summary and complexity ceiling

One reservation core replaces three near-copies of the same idea. A reservation says: "this amount leaves this account this pay period, so do not count it as spendable until it has happened". A **set-aside** is a reservation with no tracked sink. A **plan** is a reservation whose sink is an account whose balance share is tracked toward a target. Goals, debt payments and the safety net are plan types.

Kevin's ceiling, kept throughout: two priorities only (safety net first, then everything else), no user-defined ordering, no further tiers. Every hard rule below is either a proposed default the user can confirm or reassign, or a transaction match. Nothing silent.

Top recommendations:

1. Release a reservation when the **outgoing** transfer from the source is matched. The sink rising is a second, confirming check, never the release trigger.
2. Prefer matched transactions over balance deltas. Balance deltas are a flagged fallback that can only propose, never release.
3. The safety net becomes a default goal plan per user, created once and never deleted silently. It starts as target-only (reserves £0), so Safe to Spend does not change on day one.
4. Shared sinks use an explicit per-plan share ledger. Withdrawals reduce custom plans first as a visible, provisional proposal. Only unattributed inflow fills the safety net first.
5. Build as an adapter over today's collections first. Parity with today's Safe to Spend is the gate; behaviour changes (release on fulfilment) ship as their own flagged step.

## 1. The reservation core

| Field | Meaning | Today |
|---|---|---|
| `source_account_id` | one current account the money leaves | Allocations: `source_account_id` with `source_basis` chosen or recent-transfers (`routers/allocations.py` `list_account_plans`, `services/account_plan_sources.py` `chosen_source`). Goals: no UI field writes it; the API already accepts and validates it (`routers/commitments.py` create ~1181, update ~1463), and G230 adds the field. |
| `amount` + `cadence` | pence per period, `every_period` or `once` | Allocations: `amount_per_period`, `recurrence`. Goals: derived each read as `_ceil5(remaining / periods_left)` (`routers/commitments.py` `_pot_progress_and_slice`), never stored. |
| `period` | the pay period from `get_pay_period_for_date` | Both. |
| `sink` (optional) | account or accounts whose balance share is tracked | Goals: `funding_pots`. Allocations: `fill_account_id`, used only as a fulfilment matcher, no progress or target. |
| `target` (plans only) | amount plus date, or a safety net target | Goals: `amount`, `target_date`. Safety net: `savings_goals_col` (`routers/savings.py`). |

**Period states** (**Proposed**; today only allocations have anything similar, `remaining = period_amount - filled`):

| State | Meaning | Reserves |
|---|---|---|
| reserved | period open, nothing seen | full amount |
| partially fulfilled | some matched | the unmet remainder |
| fulfilled | fully matched | £0 |
| released | user marked done, or removed this period (today's `period_overrides` of £0, G217) | £0 |
| eased | user took part off for this period (**Today**: `period_eased`, `services/plan_easing.py`) | the eased amount |
| missed | period closed short, user chose "missed" | £0; next period unchanged. For a goal the end date and projection are recalculated: the user picks a higher per-period amount or a later date, within G228's limits (125%, at most 2 periods) |
| rolled over | period closed short, shortfall added to next period | next period gains it, capped (section 3) |

**Set-aside versus plan.** A set-aside has no target and no progress. It still has a fulfilment rule: today an allocation is released by credits that match a description rule landing in its fill account (`matching_fills_this_period`). Proposed additions for a sink-less set-aside: a matched outgoing debit from the source, a manual release, or the period ending. A plan has a sink and a target, so its fulfilment also updates the plan's share of that sink and its progress.

## 2. Plan types

**Goal** (sink = one or more savings pots). **Today** this is a commitment. Progress is each goal's claim on its pots, allocated oldest-first so a pound counts once between goals (`compute_pot_ledger`). Proposed: unchanged at cut-over, then shares per section 5.

**Debt payment** (sink = one card, several, or all cards). Proposed. The amount is a per-period payment from the source. The split across cards is a suggestion built from `services/debt_plan.py`: cards with an active 0% promo ending soonest first (the engine already sorts active promos earliest-first), the total anchored to demonstrated movement (`_compute_movement`, closed pay periods) rather than an aspiration. Rules: the user decides and the app never applies a split silently; where card terms are not confirmed, the app does not rank cards and offers "all cards, one total" instead (terms are asked, never inferred, per the debt planner decisions); the 51% representative-rate rule keeps any rate wording hedged.

**Safety net** (default goal plan, one per user). Proposed mapping from `SavingsGoalSheet.tsx` and `savings_goals_col`: target of 3 or 6 months or a custom amount becomes the plan target, and "accounts holding your savings" (`account_ids`) become the sinks. Defaults: target-only (contribution £0, so it reserves nothing and Safe to Spend is unchanged; the contribution becomes user-set in build item 6); created lazily on first read with a stored `default: true`; editable; never deleted silently. Today `DELETE /savings/goal` removes the doc and deleting an offline account silently `$pull`s it from `account_ids`; the plan version resets to unconfigured and tells the user when a sink disappears. With no goal doc, savings-kind accounts are suggested as sinks but not tracked until the user confirms; with no savings account the sheet prompts to pick one or add an offline account (as it does today). The safety net target stays separate from the Safe to Spend buffer (`safe_to_spend_buffer` preference, `routers/analytics.py`): the buffer is cash held back in the hero, the safety net is a savings target. Planning's Cash and investments card reads the default plan for its buffer readout and keeps opening the same sheet.

**Investment contributions.** Recommended: yes, as a goal sub-kind with "contributions only" progress, because market moves make balance deltas meaningless. Fulfilment is by matched transfer only. No performance claims and the existing soft-nudge posture stays. Build last.

## 3. Fulfilment detection

In order of preference (**Proposed** unless marked):

1. **Matched outgoing transfer from the source.** Releases the reservation. This is the no-double-counting rule: the debit has already lowered the pooled balance, so holding the reservation would count the money twice, and waiting for the sink would understate Safe to Spend through sync lag or an unseen sink. (**Today** allocations release only on the inbound match; goals never release per period.)
2. **Matched inbound at the sink.** Confirms the release and updates the plan's share. If it never appears, the plan shows "left <source>, not yet seen in <sink>" rather than reserving again.
3. **Engine-proposed match, user confirms.** Reuses `_transfer_pair_suggestions` in `routers/analytics.py` (~5800: same-user legs, exact amount, one day of tolerance for statement lag). `_direct_fill_leg_source` in `services/companion.py` is narrower, pairing same-day exact-amount legs only.
4. **User-picked transaction.**
5. **Manual mark done.**
6. **Balance delta, fallback only.** Offered as a proposal needing confirmation, never an automatic release. Caveats shown: interest, market moves, refunds, new card spend, other deposits.

Unseen sinks (offline accounts, pots not exposed by open banking): detection 1, 3, 4 or 5 on the source side only. Today's goal progress already reads offline balances the user updates.

**Partial and over-payment.** Matched amounts sum. Over-payment fulfils the period and the excess counts as progress, not credit against next period.

**Short period.** The user chooses roll over or missed (Kevin's decision). Recommended timing: one quiet prompt at period end. An earlier prompt only once the shortfall is certain: less than the reserved amount seen, no further income expected before payday, and the source cannot cover it after bills. Reason: early prompts invite a decision before a late salary arrives. An unanswered prompt leaves the plan awaiting a choice and reserves only the usual amount, so Safe to Spend never changes by default. Roll-over cap: two consecutive, then the prompt offers only "missed" or "edit the plan". A rolled-over amount shares G228's limits (later periods at most 125% of usual, date moves at most two periods, `plan_easing.py`) so the two mechanisms cannot drift. On "missed", the goal's end date and projection are recalculated: the user chooses a higher per-period amount or a later date, and the same limits apply. Easing (G228: never two periods running, at most two in 12 months) and roll-over share **one counter per plan**, recommended so a plan cannot be softened twice as often by using both routes.

## 4. Flows into other surfaces

- **Safe to Spend.** **Today**: `min_running - buffer - commitments_reserved - allocations_reserved` (`routers/analytics.py`, from `total_reserved_slices` and `total_reserved_remaining`). Proposed: one `reserved_total` from the core, with both existing fields kept for compatibility, and one combined ledger line, "Plans and set-asides", with the breakdown one tap down.
- **Upcoming hero.** **Today** (G227): `spendableNow + income - bills - set aside - plans`, with `plans_reserved` from the same function as Safe to Spend (`/analytics/cashflow`). Proposed: reads `reserved_total`; the reconcile test (`tests/test_upcoming_plans_reconcile.py`) stays.
- **Per-account walk and account sheet.** **Today**: `lib/upcomingPlans.ts` `accountPlan` subtracts plans linked to the account and shows unassigned plans pooled-only. Proposed (G230): the reservation subtracts from its source account only.
- **Move and shortfall engine.** **Today**: `services/allocation_shortfall.py` (G217: `gap = max(0, -(closing - reserved)) - max(0, -closing)`, floor £5) and `companion._reserved_for_allocations` for sizing legs. Proposed: both read reservations of every kind keyed by source. The bill walk and `walk_sort_key` lockstep are untouched.
- **Easing (G228) and reducing (G217)** become one operation on the core: a per-period adjustment keyed by period end (today two stores: `period_eased` on commitments, `period_overrides` on allocations). The offers stay separate cards in the UI, since Kevin ruled out coupling set-asides and plans in G228 round 2.

## 5. Shared sinks

Several plans may track one account. The balance is split by an explicit **share ledger** (per plan, per account, in pence), not derived from the balance, so each change has a cause the app can show. **Today** only goals share a ledger (oldest-first, `compute_pot_ledger`); the safety net is outside it, so it and a goal can claim the same pound. The ledger is seeded at cut-over from today's output, so nothing moves.

| Rule | Proposed |
|---|---|
| Priority | The safety net is filled first and protected. No other tiers. |
| Deposit with a matched plan | Counts for that plan. |
| Unattributed inflow (interest, ad-hoc deposits) | Arriving unattributed money fills the safety net to target first, then shows as **unallocated**; it never silently grows a custom plan. |
| Withdrawal | Reduces custom plans first, and the safety net only drops once the custom plans on that account are at £0. Applied provisionally with a "proposed" tag. The user confirms or reassigns (emergency spend to the safety net, the Japan trip to Japan). Never a silent rule. |
| Several custom plans | Reduce proportionally to current shares. Alternative: most recent first. Preferred: proportional, because no single plan is wiped by one withdrawal and it is explainable in one line. (Today's oldest-first applies to claims, not withdrawals.) |
| Safety net across several accounts | A withdrawal reduces the share held in the account it left. Custom plans absorb only within that account. There is no cross-account order. Where Penny must suggest where to draw from, easiest access first. |
| Moving target | "3 months of spending" (`savings.py` `_target_amount`) is frozen at period start, and changes only when it differs by more than 10% and £100, with a "target moved from £X to £Y because your spending changed" note. A moved target never pulls money from custom plans. |
| Target edited | A lower target releases the excess to unallocated. A higher one shows "£X to go". Re-splitting existing shares is offered as a proposal only. |
| Own-account transfers | Never progress. A transfer between two sinks of the same plan is neutral; between plans, shares move only when the user attributes them. |
| Sink excluded from Safe to Spend (G231) | Allowed, and the natural home for a ring-fenced account. A sink that **counts** towards Safe to Spend is refused with a reason: the pool counts both accounts, so releasing on the matched outgoing transfer would raise spendable cash while the money stays in the pool. |

## 6. Boundary and migration

| | Set-aside (allocation) | Plan |
|---|---|---|
| Question it answers | Is this amount spoken for this period? | Is this pot on its way to a target? |
| Sink and progress | None | Tracked share, target, projection |
| Amount | Chosen by the user | Chosen, or derived from target and date |
| Period miss | Resets next period | Roll over or missed |

**Invariant.** For any user without a shared sink or a configured safety net contribution, the core's `reserved_total` equals `total_reserved_slices + total_reserved_remaining`, and `compute_safe_to_spend` output and the `/analytics/cashflow` totals are identical before and after the adapter. **Test**: a golden fixture suite (goals only, allocations only, both, easing and override live, completed once-off, pending allocation, unavailable plan, and a configured safety net contribution) asserting equality field by field, including `plans_reserved`, plus the existing G227 reconcile and `tests/test_safe_to_spend_hardening.py`.

**One deliberate exception.** Reading `_pot_progress_and_slice`, a goal's slice is recomputed from `remaining` and does not drop to £0 once the period's contribution is made, so Safe to Spend appears to keep reserving after the transfer (to be confirmed on a live fixture in build item 2). Release-on-fulfilment will raise Safe to Spend after a contribution. That is the point of the framework, but it changes results, so it ships separately behind a flag, with Kevin's sign-off (question 1).

## 7. Data model, API, build split

**Data model (sketch).** First slices keep `commitments_col`, `allocations_col` and `savings_goals_col` as storage behind an adapter, `services/reservations.py`, which returns core-shaped records. New collections: `plans` (default plan docs and, later, debt and investment plans), `plan_periods` (plan id, period start and end, reserved, fulfilled, state, evidence ids, adjustment), `plan_shares` (plan id, account id, share pence, basis), `plan_proposals` (withdrawal attribution, match, roll-over prompt). Nothing is moved until the adapter proves parity.

**API (sketch).** `GET /plans` (every kind, one shape); `POST|PUT|DELETE /plans/{id}`; `GET /plans/{id}/periods`; `POST /plans/{id}/periods/{end}/fulfil` (transaction ids or manual); `POST .../resolve` (roll_over or missed); `POST /plans/proposals/{id}/confirm`; `GET /plans/debt-split`. Existing `/commitments`, `/allocations` and `/savings/goal` stay as facades.

**Build split** (ids to be assigned; G230 first):

1. **G230** source account on goal plans (write path, "Paid from" field, hedged inference, per-account walk). Surfaces: Edit plan, Upcoming account walk, account sheet.
2. Reservation core adapter, one `reserved_total`, parity suite. Surfaces: analytics, cashflow, companion engine; no UI.
3. **G231** exclude an account from Safe to Spend (prerequisite for the sink rule). Surfaces: account sheet, hero, Upcoming, Penny.
4. Period records and fulfilment detection, release on matched outgoing, flagged. Surfaces: Upcoming rows, account sheet, Penny.
5. Roll-over or missed prompt and caps, folding G228 easing and G217 override onto period adjustments. Surfaces: Home brief, Planning, Upcoming.
6. Safety net default plan, frozen target, suggested sinks, user-set contribution. Surfaces: SavingsGoalSheet, Planning Cash and investments card, Penny.
7. Shared sinks: share ledger, withdrawal and deposit proposals, unallocated. Surfaces: account sheet, Planning, Penny.
8. Debt payment plans with the split suggestion. Surfaces: Planning debt position, Cards, Edit plan.
9. Investment contribution plans (optional, last). Surfaces: Planning, Edit plan.

The design round (section 9) runs after sign-off and before items 4 to 8.

## 8. Open questions for Kevin

1. Release a goal's reservation once its contribution is matched, raising Safe to Spend afterwards? Default: yes, own step, flagged.
2. Roll-over prompt timing? Default: period end, earlier only when the shortfall is certain.
3. Unanswered prompt? Default: waits, reserves the usual amount, changes nothing.
4. Roll-over cap and shared limits with G228? Default: two consecutive, then missed or edit; 125% and two-period limits shared.
5. Sinks excluded from Safe to Spend allowed, counted current accounts refused? Default: yes.
6. Withdrawal default? Default: custom plans first, provisional, tagged "proposed".
7. Several custom plans on one account? Default: proportional, not most recent first.
8. Frozen safety net target threshold? Default: change only above 10% and £100, at period start.
9. Target edits re-split shares? Default: proposals only.
10. Safety net sinks when none are chosen? Default: suggest savings accounts, track only after confirmation; none exist, prompt or offline account.
11. One combined "Plans and set-asides" ledger line? Default: yes, breakdown below.
12. Debt split when card terms are unconfirmed? Default: no ranking, "all cards, one total".
13. Do investment contributions fit? Default: yes, contributions-only progress, built last.
14. Storage? Default: adapter over today's collections first, migrate only after parity.
15. Balance-delta fallback? Default: proposal only for cards and visible savings, never an automatic release.

## 9. Design round brief (Astra, `frontend/app/design/plans-framework/`)

Skill: impeccable, rewritten to DESIGN.md (Calm Cockpit, no red for plan states, Penny's gradient not used, amber only as a signifier). Production components imported where they exist. Screens:

1. Create and edit a plan: type, source, sink or none, amount, cadence, safety net and debt variants.
2. How a reservation shows on Safe to Spend (combined line), Upcoming and the account sheet.
3. Fulfilment: engine-proposed match to confirm, user-picked transaction, mark done, "left <source>, not yet seen".
4. Roll-over or missed prompt, including the capped state.
5. Multi-card split suggestion, with terms-unknown state.
6. A sink-less set-aside beside a plan.
7. Safety net default plan: sink choice with several, none, offline account; moved-target message.
8. Shared account: each plan's share, unallocated, a proposed withdrawal reduction with confirm or reassign.

390px, both themes, `web-design-guidelines` gate, independent reviewer, finish with `--uat-review`.
