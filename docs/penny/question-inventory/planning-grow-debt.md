# Question inventory: Planning, Grow, Debt, Scenario
Captured 2026-08-27 from the live components. Source of truth for Penny tool coverage of these surfaces.
Caveat: notable actionable finds: /budget is an orphaned route; scenario's month-by-month figures are fetched but never rendered; BottomNav.tsx carries a stale comment about /grow.

I have the full picture. Inventory below.

---

# User-Question Inventory — PLANNING / GROW / DEBT

Files traced: `/root/ai-wealth-dashboard/frontend/app/planning/PlanningPage.tsx`, `/root/ai-wealth-dashboard/frontend/app/grow/GrowVariant1.tsx` (+ `GrowVariant2.tsx`, `GrowVariant3.tsx`, unrouted), `/root/ai-wealth-dashboard/frontend/app/debt-plan/DebtPlanPage.tsx`, `/root/ai-wealth-dashboard/frontend/app/scenario/ScenarioPage.tsx`, `/root/ai-wealth-dashboard/frontend/app/budget/BudgetPage.tsx`, `/root/ai-wealth-dashboard/frontend/components/{UpcomingEditSheet,PlannedEditSheet,PlanOneOffSheet,CommitmentSheet,CardTermsSheet,SavingsGoalSheet,SavingsPlanCard,GoalsStrip,UpcomingBillsStrip,PennyConversation}.tsx`, `/root/ai-wealth-dashboard/frontend/lib/api.ts`, `/root/ai-wealth-dashboard/shared/src/types.ts`, backend `/root/ai-wealth-dashboard/backend/app/routers/grow.py`.

---

## 0. Route map / reachability (context for the inventory)

| Route | File | Reached from |
|---|---|---|
| `/planning` | `app/planning/PlanningPage.tsx` | BottomNav tab "Planning" (`components/BottomNav.tsx:148`); deep links `?day=YYYY-MM-DD&bill=<name>` from Home |
| `/grow` | `app/grow/page.tsx` → `GrowVariant1` | Plans dock row on Planning (`PlanningPage.tsx:1096,1652`); `goalsSummary` savings pillar `url:"/grow"` (`backend/app/routers/goals.py:95`) |
| `/debt-plan` | `app/debt-plan/DebtPlanPage.tsx` | Plans dock row (`PlanningPage.tsx:1095,1651`); `GoalsStrip` (`components/GoalsStrip.tsx:87`); `CommitmentSheet` consent "debt first" (`components/CommitmentSheet.tsx:438`); `/insights?tab=plan` redirect (`app/insights/InsightsPage.tsx:1222`) |
| `/scenario?items=<json>` | `app/scenario/ScenarioPage.tsx` | Only from `PennyConversation.runScenario` (`components/PennyConversation.tsx:1056`) — the "life simulator" |
| `/budget` | `app/budget/BudgetPage.tsx` (titled **"Trends"**) | **No in-app link in the frontend.** Only reachable by direct URL or the backend `goalsSummary` budget pillar `url:"/budget"` (`backend/app/routers/goals.py:118`) rendered by `GoalsStrip` |
| `GrowVariant2/3` | `app/grow/GrowVariant2.tsx`, `GrowVariant3.tsx` | Dead reference files; `app/grow/page.tsx` imports V1 only |

Note: `GrowVariant1` does render `BottomNav` (`GrowVariant1.tsx:506`) despite the stale comment at `BottomNav.tsx:122-127` claiming it doesn't — so `screen: "grow"` Penny context is live.

---

# A. PLANNING TAB (`/planning`)

Data loaded once on mount (`PlanningPage.tsx:476-484`): `api.accounts()` → `GET /accounts`; `api.cashflow()` → `GET /cashflow`; `api.getDebtPlanSummary()` → `GET /debt-plan/summary`; `api.getGrow()` → `GET /grow`; `api.listCommitments()` → `GET /commitments`; `api.getSavingsInsights()` → `GET /savings-insights`.

## A1. Page header — "PLANNING / What's coming"
- **Shows**: static eyebrow + title (`:1702-1704`).
- **Do**: nothing.
- **Questions** — WHAT: coming over what horizon? (answer buried: current period + 5 days of next, `NEXT_PERIOD_LOOKAHEAD_MS`, `:1060`).

## A2. Runway hero — "To last this pay period" / "Before month end"
- **Shows** (`:1588-1645`): big figure `runway = spendableNow − runwayBillsTotal` (`:1230-1234`); sub-line `£X now − £Y bills · ends <payday> (N days)` / `· N days remaining`; optional `+ £Z in savings if needed` when `savings_balance > 0`; footnote "Based on your typical spending, last 90 days".
- **Endpoint/fields**: `GET /cashflow` → `CashflowData.spendable_balance` (fallback `available_balance`), `savings_balance`, `upcoming_bills[]` (`lib/api.ts:189-204`). Pooled no-op transfers (`kind==="movement" && dest_account_spendable===true`) excluded from the bills sum (`isPooledNoOp`, `:38-40`, `:1230-1232`). Period boundary from local `getPayPeriodWithConfig` + `payPeriodConfig` preference, not the API.
- **Do**: nothing directly tappable; turns rose when negative. Pay-period config editable only via `PayPeriodSettingsSheet`, opened by `sessionStorage["wealth_open_pay_period"]==="1"` deep link (`:526-532`) — **no visible button on this page**.
- **Questions**:
  - WHERE: which accounts make up "£X now"? Does it include my savings/credit cards? Which bills are inside "£Y bills"?
  - WHAT: does "to last this pay period" mean I can spend all of it? What is "spendable" vs the savings line? What does "based on your typical spending, last 90 days" actually affect — this figure or the bill predictions?
  - WHY: why is my runway lower than my balance? Why did it drop when I only moved money between my own accounts? (answered structurally, never in copy — `:1121-1150`)
  - HOW: how do I change when my pay period ends? (only reachable by deep link) How do I raise this number?
  - WHEN: when exactly is payday — is `ends Fri 28 Aug` the last day or the pay day? What happens to leftovers at rollover?

## A3. Shortfall chip (top-right of hero)
- **Shows** (`:1628-1642`): `N accounts short` — rose+`AlertTriangle` when `genuineShortfalls.length>0`, amber+`AlertCircle` when only `timingShortfalls`.
- **Fields**: derived client-side from two walks over `upcoming_bills` + `upcoming_income` + `internal_inflows` (`atRiskWalks`, `:550-668`); conservative = bills before same-day credits, optimistic = credits first; "genuine" = short under both.
- **Do**: not a button (a `span`).
- **Questions** — WHAT: does "short" mean I'll bounce? Which account? WHY: why amber here and red there? WHERE: where do I see which account? HOW: how do I clear it?

## A4. Genuine shortfall callout (red) + "Review" button
- **Shows** (`:1708-1778`): 1 account → "Your {bank} account is short before payday" / "£X short for bills due before payday. Move money in, or change a payment date." + optional culprit line "The £X move on {date} is part of why."; ≥2 accounts → count headline + up to 3 `bank · £X short` + "+N more". Footnote: "Payments can take a day or two to appear…".
- **Fields**: `accountShortfalls` (`:702-765`) — `shortfall = billsSum − balance − inflowsSum` using `UpcomingBill.account_balance/account_id/account_bank`, `CashflowData.internal_inflows[]` (`lib/api.ts:163-188`). Culprit = largest `movement`-kind bill on that account since the last credit (`movementsSince`, `:614-660`).
- **Do**: tap **Review** → spotlights the earliest/largest at-risk bill row on a genuinely short account (`setHighlightTarget('bill-…')`, `:1757-1771`), ring-flash 2800 ms.
- **Questions**:
  - WHERE: which bills exactly make up the £X? Where is the money supposed to come from?
  - WHAT: does "short before payday" mean a bounce, a fee, or just tight? What counts as "the move that's part of why"?
  - WHY: why is this account short when my total balance is fine? Why is my own savings transfer blamed?
  - HOW: how do I "move money in" from here (there's no transfer action)? How do I change a payment date — which button?
  - WHEN: short *by when* — which day does it tip over?

## A5. Timing-risk callout (amber)
- **Shows** (`:1786-1822`): "Money's due into {bank} on {date}. If a payment leaves before it lands, it could bounce." (or N-account variant with per-bank `due {date}`).
- **Fields**: `severity==="timing"`, `dueDate` = earliest of `upcoming_income` ∪ `internal_inflows` for that account (`:750-755`).
- **Do**: read-only (no Review, no dismiss).
- **Questions** — WHAT: is this a problem or not? WHY: why is it only "could"? WHEN: what time of day does money land? HOW: can I move the payment a day later? WHERE: which payment is the risky one (no link to the row)?

## A6. Day-fallback note
- **Shows** (`:1825-1827`): "Nothing's due {date} now, showing the closest day with payments."
- **Trigger**: `?day=` deep link that no longer matches a rendered day (`resolveDayTarget`, `:843-862`).
- **Questions** — WHY: why did the thing I tapped from Home disappear? WHAT: was it paid, skipped, or re-dated?

## A7. Day group headers ("Today" / "Tomorrow" / "N days")
- **Shows** (`:1239-1248`, `:1563-1580`), keyed `data-day-key={expected_date}` for deep-link scrolling.
- **Do**: first group carries the **"+ Plan a one-off"** link (`:1567-1575`, title tooltip "A dated bill from one account").
- **Questions** — WHAT: why "3 days" instead of a date? WHEN: what actual date is "5 days"? (the date is on each row, not the header).

## A8. Payday boundary divider
- **Shows** (`:1550-1554`): hairline + "New pay period · {Fri 28 Aug}". Rows after it are `next_period` (rendered one shade quieter, `:1468`).
- **Questions** — WHAT: does the next-period stuff count against my runway? (No — `runwayBillsTotal` stops at payday.) WHY are these greyer? WHEN does the new period start vs when I actually get paid?

## A9. Bill / income row (the core object)
- **Shows** per row (`renderRow`, `:1262-1532`): category icon (or red `AlertTriangle` / amber `AlertCircle`), name, `planned` or `edited` badge, amount `−£X` / `+£X` (income emerald), and the running `£N left` rail — or the special **"stays in your accounts"** for pooled no-op transfers (`:1519-1522`). Sub-lines, in priority order:
  - `{bank} · only £X available` (red, genuine account shortfall, `:1374-1378`)
  - amber dot + `{bank} · money's due in around now` (timing risk, `:1389-1394`)
  - "Overall balance will be low" (pooled `running < 0`, `:1395-1404`)
  - "Includes a £X move {date}" (culprit attribution, red or amber variants, `:1409-1426`)
  - amber dot + "May not go through if the balance is tight. No fee either way." (unfundable **movement**, `:1432-1437`)
  - plain bank name; the formatted date; pending copy (below)
  - insight hint button "could save ~£X ›" (`:1449-1461`)
- **Fields**: `UpcomingBill` (`lib/api.ts:78-123`) — `name, amount, expected_date, days_away, account_id/name/bank, account_balance, is_credit_card, category, edited, rule_label, pending, original_date, planned, planned_id, days_past_due, kind, dest_account_id, dest_account_spendable`. Insight hint matched by merchant name against `GET /savings-insights` → `SavingsInsight.triggered_by[].display_name/merchant_key` + `savings_estimate` (`:490-514`).
- **Do**:
  - **Tap row** → `UpcomingEditSheet` (predicted) or `PlannedEditSheet` (planned) (`:1310-1328`).
  - **Swipe left** → `SwipeDismissRow` (`:1915-1978`): "Not recurring" → `POST /cashflow/dismiss-recurring` with 6 s undo (`dismissUpcoming`, `:965-985`); on a planned row → "Delete" → `DELETE /planned/{id}` deferred 6 s (`deletePlannedWithUndo`, `:928-946`).
  - **Tap insight hint** → `/insights?tab=save&insight={id}`.
  - **"Dismiss for this month"** on badly-overdue pending bills → `POST /cashflow/skip-occurrence` (`skipOccurrence`, `:987-1016`).
- **Questions**:
  - WHERE: which account does this leave from? Where does a "movement" row actually go (destination is in the payload as `dest_account_id` but never shown)?
  - WHAT: what does "£N left" mean — after this one, across all accounts, or in this account? What is "stays in your accounts"? What does the `planned` vs `edited` badge mean? What does "could save ~£X" cover?
  - WHY: why is this red and that one amber? Why is this bill even predicted — I cancelled it? Why is a transfer counted as an outgoing at all?
  - HOW: how do I change this bill's date/amount? How do I stop it being predicted forever vs just this month? How do I mark it paid?
  - WHEN: is the date the due date or the date it usually leaves? When will it actually clear?

## A10. Pending / overdue bill copy
- **Shows** (`:1469-1496`): `days_past_due >= 5` → Debt category: "Expected {date}, hasn't left. A missed card payment can mean fees, so worth checking today."; other: "Expected {date}, we haven't seen it leave. Worth checking with them." + **Dismiss for this month**. `< 5` days: "expected {weekday}, hasn't left yet".
- **Fields**: `pending`, `days_past_due`, `original_date`, `category`.
- **Do**: "Dismiss for this month" → `POST /cashflow/skip-occurrence {key, date: original_date ?? expected_date}` with optimistic removal + revert on failure.
- **Questions** — WHY hasn't it left / did my bank fail it? WHAT does "dismiss for this month" do to the prediction and to my runway? WHEN should I chase them? HOW do I confirm it was actually paid?

## A11. Empty states
- "Nothing more expected this pay period" (whole window empty, `:1080`; or current period empty with next-period rows still showing, `:1682-1686`).
- Error: "Couldn't load what's coming." + **Retry** → re-fetch `GET /cashflow` (`:1039-1048`, `retryCashflow` `:520-523`).
- **Questions** — WHY is nothing showing — is it broken or genuinely clear? WHAT about my direct debits next week?

## A12. Undo snackbar
- **Shows** (`:1832-1853`): "Prediction removed" / "Planned payment deleted" + **Undo**, 6 s countdown bar.
- **Do**: Undo → for recurring, awaits the in-flight `dismissRecurring`, then `POST /cashflow/restore-recurring` + refetch (`:1018-1034`); for planned, cancels the deferred delete.
- **Questions** — WHAT exactly did I remove (this occurrence or all future ones)? HOW do I get it back after the 6 s?

---

# B. PLANS DOCK (Planning → Debt / Grow)

Single glass surface, two rows, skeletons while loading (`PlansDock`, `:231-272`).

## B1. Debt row — "Next 0% ends {Sep 2026} · Card plan"
- **Shows** (`computeDebtRow`, `:106-161`): earliest promo end across cards within 1 year; small amber dot when that cliff is ≤60 days away (`isCliffSoon`, `:42-47`); falls back to bare "Card plan"; row hidden entirely when `carried_total < 1 && float_total < 1`.
- **Endpoint/fields**: `GET /debt-plan/summary` → `DebtPlanSummary.totals.buckets.{carried_total,float_total}`, `cards[].rate_schedule[0].{source,until}` (`lib/api.ts:1482-1487`).
- **Do**: tap → `/debt-plan`.
- **Questions** — WHAT is a 0% deal ending, and what happens to the balance the day after? WHICH card is it (name is computed but not rendered)? WHY am I only being told the month, not the day? WHEN exactly does it end — end of that month? HOW much will it start costing me? WHY did this row vanish/appear?

## B2. Grow row — "£1,256/mo short · Grow"
- **Shows** (`computeGrowRow`, `:168-188`): the £-figure + qualifier regex-extracted from the Grow verdict headline; whole headline as fallback; hidden when no headline.
- **Endpoint/fields**: `GET /grow` → `GrowView.verdict.headline` (`shared/src/types.ts:401-409`; built in `backend/app/routers/grow.py:248-260`).
- **Do**: tap → `/grow`.
- **Questions** — WHAT does "short" mean — am I overdrawn every month? Short *of what*? WHY does it differ from my runway figure above? WHERE is the shortfall going (debt repayments — stated only on Grow itself)? HOW do I fix it?

---

# C. COMMITMENTS BLOCK (goals) — Planning

`CommitmentsBlock` (`:282-437`), data `GET /commitments` → `{items: Commitment[]}` (`lib/api.ts:585-627`).

## C1. Empty state — "+ Plan a big expense / a goal to save toward"
- **Do**: opens `CommitmentSheet` in create mode.
- **Questions** — WHAT counts as a big expense vs a one-off bill? HOW is this different from "+ Plan a one-off"? WHERE does the money get held?

## C2. Goal card (per active commitment)
- **Shows** (`:309-390`): name; target month (`target_date` → "Sep 2026"); thin progress bar, indigo when `on_track`, amber when not; `£progress of £amount`; `£per_period_slice each pay period ({period_label}) · {periods_left} left`; "Shares a pot with X, Y" (`shared_pot_goals`); amber-dot `pace_note.text` + **"See where ›"** → `/spend`; feasibility dot + `feasibility_note` (suppressed when a caution `pace_note` is showing).
- **Fields**: `Commitment.{id,name,amount,target_date,progress,remaining,periods_left,per_period_slice,period_label,on_track,feasibility,feasibility_note,feasibility_tone,shared_pot_goals,pace_note,funding_pots}`.
- **Do**: tap card → `CommitmentSheet` edit mode; tap "See where ›" → `/spend`; horizontal snap-scroll when ≥2 goals.
- **Questions**:
  - WHERE: which pot holds this money? Is it actually being moved, or is this notional? Which other goal is eating the same pot?
  - WHAT: what does "on track" measure? What's a "per pay period slice" — is it auto-transferred? What does "stretch"/"savings"/"surplus" mean?
  - WHY: why is the bar amber? Why is my progress lower than the pot balance (count-existing baseline)? Why does an older goal get first claim?
  - HOW: how do I speed it up / lower the target / pause it? How do I actually move the slice?
  - WHEN: will I hit the target by the month shown? What happens the month it arrives?

## C3. "+ Plan a big expense" header link (when goals exist)
- **Do**: `CommitmentSheet` create mode. Same questions as C1.

---

# D. PLANNING SHEETS (editing surfaces)

## D1. `UpcomingEditSheet` — edit a predicted bill/income
`components/UpcomingEditSheet.tsx`. Header: "{name} · Predicted {date} · ±£X".
| Element | Endpoint | Action |
|---|---|---|
| Date input | `POST /cashflow/edit-upcoming` via `api.editUpcoming({key,date,new_date,new_amount,scope})` (`lib/api.ts:1623`) | change the date this bill lands |
| Amount input | same | override the predicted amount |
| **Repeats** — `rule_label` row, or "Set a schedule" free-text ("e.g. every Sunday · last Friday of the month") | `api.previewUpcomingRule` → readback card (label + next dates) → `api.applyUpcomingRule`; "Remove" → `api.clearUpcomingRule` (`lib/api.ts:1627-1632`) | teach the app the real cadence |
| Scope segmented control "Just this one" / "This & future" (+ helper "Updates every upcoming one until a real payment replaces it") | `scope` param | choose blast radius |
| **Save** / **Reset to prediction** (only when `edited`) | `api.clearUpcomingOverride` | undo a manual override |
| **Skip this month** (bills only) | `POST /cashflow/skip-occurrence` (uses `original_date ?? expected_date`) | drop one occurrence |
| **"Not a bill" / "Not income"** → 2-step "Stop predicting this?" → Remove/Keep | parent's `dismissUpcoming` → `POST /cashflow/dismiss-recurring` | kill the prediction |

- **Questions**:
  - WHAT: what's the difference between Skip this month, Reset to prediction, and Not a bill? What is a "prediction" vs a real payment? What does "until a real payment replaces it" mean?
  - WHY: why did you predict this date/amount at all? Why is it "edited"?
  - HOW: how do I change the date at my *bank* vs here — does editing here move the real direct debit? (It doesn't; nothing says so.) How do I write a schedule it will understand?
  - WHEN: if I set "every Sunday", when does the next one show? When does a skipped occurrence come back?
  - WHERE: which account will the edited version debit (not editable here — only in `PlannedEditSheet`)?

## D2. `PlannedEditSheet` — edit a user-created planned payment
`components/PlannedEditSheet.tsx`. Fields: name, amount, date (min today when changed), account radio list limited to **spendable** accounts (non-manual, non-savings, non-credit, non-negative, `:64-72`). Save → `PATCH /planned/{id}` (`api.updatePlanned`, `lib/api.ts:2446`); Delete → parent's `deletePlannedWithUndo`.
- **Questions** — WHY can't I pick my savings/credit-card account? WHAT happens to my runway when I change the account? HOW do I make this repeat (there's no rule builder here)? WHEN can I date it in the past?

## D3. `PlanOneOffSheet` — "+ Plan a one-off / A payment you know is coming"
`components/PlanOneOffSheet.tsx`. Fields name / amount / date (min today) / "Which account will it leave from?" (with "Not sure yet" + helper "Pick one so I can plan the cover if it's short."). Save → `POST /planned` (`api.addPlanned`, `lib/api.ts:2441`).
- **Confirmation copy** driven by `PlannedImpact` (`lib/api.ts:126`): "Planned. You're still okay, £X in hand after this." / "Planned. This tips your window £X short, a cover plan will appear on Home." / "Planned. It's now in your upcoming bills."
- **Questions** — WHAT is "your window" and where's the "cover plan on Home"? WHAT is "£X in hand" (Safe to Spend, not the runway shown on this very page)? WHY do the two figures differ? HOW do I make it recurring? WHERE did it go after saving?

## D4. `CommitmentSheet` — plan a big expense / edit a plan
`components/CommitmentSheet.tsx`. Header sub: "A goal you set money aside for, separate from single bills."
- **Fields**: Name (40 chars); Total amount; **By when** (`type="month"`, min = next month, floored to the stored month when editing, `:128-132`); **"Fund it from savings pots?"** multi-select (connected savings-subtype accounts + manual offline accounts badged "offline, updated by you"; credit cards excluded, `:163-169`), plus "No pot, track it by hand"; per-pot toggle chip **"count the £X already here"** (`count_existing`); conflict line "Also funding {names}, £X spoken for · £Y free"; helper "Pick pots and progress tracks their growth from today, offline pots you update yourself."
- **Live verdict**: debounced 400 ms `POST /commitments/preview` (`api.previewCommitment`, `lib/api.ts:1767`) → `CommitmentPreview.{per_period_slice,periods_left,starting_progress,feasibility,feasibility_note,feasibility_tone,pots_detail,consent}`. Client-side estimate line: `≈ £X each pay period ({label}) · N periods` (ceil-to-£5, `:245-254`).
- **Consent gate (create only)**: `CommitmentPreview.consent` (`lib/api.ts:643-650`) renders title + lines + three buttons `actions.anyway` / `actions.later_date` (returns and focuses the month input) / `actions.debt_first` (→ `/debt-plan`).
- **Save**: `POST /commitments` or `PATCH /commitments/{id}` (only changed date/pots sent, `:275-300`). **Cancel this plan** → 2-step "Stop reserving for this? Money already set aside stays where it is." → `POST /commitments/{id}/cancel`.
- **Questions**:
  - WHERE: where does the reserved money physically live? Does the app move it, or do I? Where does a "no pot" goal's progress come from?
  - WHAT: what does "count the £X already here" do to progress? What's "spoken for" vs "free"? What is a "stretch" vs "savings" verdict? What does the consent screen mean by doing debt first?
  - WHY: why can't I pick this month? Why is my slice £X and not amount÷months? Why did my progress reset when I changed pots (PATCH re-captures baselines)?
  - HOW: how do I actually fund it each period? How do I split one pot across two goals?
  - WHEN: "By when" — is that the first of the month or the end? When is the first slice taken? When does the goal auto-complete?

## D5. `PayPeriodSettingsSheet`
Opened only via `sessionStorage["wealth_open_pay_period"]` (`:526-532`); saves to the `payPeriodConfig` preference, which redrives period start/end, the runway label, and the payday divider.
- **Questions** — WHERE do I change my payday? WHY does the app think my month starts then? WHAT changes if I switch to calendar month? WHEN does the change take effect?

---

# E. GROW SCREEN (`/grow`, `GrowVariant1`)

Loads `GET /grow` (`api.getGrow`), plus in parallel `GET /savings/insights` (`api.savingsInsights`) and `GET /savings/plan` (`api.getSavingsPlan`) (`GrowVariant1.tsx:291-318`).

## E1. Hero verdict
- **Shows** (`:373-412`): eyebrow "Grow"; `verdict.headline`; `verdict.sub`; conditional promo line "Your card's at 0% until {30 Sep 2026}, the after-debt figure reflects those repayments." (`debt.all_promo && debt.promo_cliff`, `:394-398`); tile "Spare each month"/"Short each month" + `|surplus_monthly|`; footnote "Excludes money moved to savings or investments."
- **Backend copy** (`backend/app/routers/grow.py:248-266`): headline variants — `You've got ~£X/month spare` / `After debt repayments, you're about £X/month short` / `Your spending has been running ~£X/month ahead of income` / `Your income and spending have been about even`. Sub: `Your buffer covers ~N days` / `~N.N months`.
- **Do**: read-only; retry via **Try again** on the error card ("Grow couldn't load, the instrument panel needs a live reading to show the ladder.").
- **Questions**:
  - WHERE: where is the shortfall going — which repayments, which categories? Where does "spare" end up if I don't do anything?
  - WHAT: what period is "/month" averaged over? What is "excludes money moved to savings or investments" excluding — the transfers or the balances? What does the buffer "covering N days" assume I'd still spend?
  - WHY: why does this say short when Planning says I have £X left? Why is the 0% promo relevant to a monthly figure?
  - HOW: how do I turn "short" into "spare"?
  - WHEN: when does the 0% end and what does the figure become after it?

## E2. Priority ladder (the hero instrument)
- **Shows** (`:415-426`, rung `:157-228`): 7 rungs, each with an LED node (emerald `CircleCheck` = done, indigo pulsing icon = active, grey `Lock` = locked), a 5-segment strip (state only, explicitly *not* a progress fraction, `:117-138`), a state pill **Cleared / In progress / Locked**, the rung `title`, factual `detail`, an optional in-app `link` button, and — **active rung only** — the generic `options` bullets.
- **Rungs & detail copy** (`backend/app/routers/grow.py:355-405`): `essentials` ("Your everyday spending fits within your income, with about £X/month to spare. This excludes savings, investments and debt repayments" / "…is about £X/month more than your income"); `pension_match` (income + contributions on file, or "Add your income to see this", link "See your tax levers ›" → `/insights?tab=tax`); `starter_buffer` ("Your buffer holds £X against a 1-month target of £Y"); `expensive_debt` ("You're carrying £X outside any 0% deal" / "Your carried debt is all on a 0% deal, ending {cliff}" / "You have no debt on file"); `full_fund` ("…against a 3-month target of £Y"); `pension_topup` (taper/60%-trap personalised copy); `isa_invest` ("This unlocks once your buffer reaches ~3 months of spending and any expensive debt is cleared" / "You hold £X in investments on file").
- **State rule**: first `not_done` rung becomes `active`; everything after it is forced `locked` regardless of its own state; data-missing rungs are `locked` but don't block (`grow.py:409-431`).
- **Do**: tap a rung's `link` (only `pension_match` / `pension_topup` have one) → `/insights?tab=tax`. Rungs themselves are **not** tappable; nothing can be marked done or reordered.
- **Questions**:
  - WHAT: what is this ladder — a rule, a recommendation, my plan? What does "Locked" mean — locked by whom, and does it unlock automatically? What are the segment bars measuring? What is a "starter buffer" vs a "full emergency fund" vs a "safety net goal"? What is "expensive debt" (which cards count)?
  - WHY: **why this order** — why debt before investing, why pension before buffer? Why is a rung after my active one locked even though it's already done? Why is this rung locked when I *do* have income?
  - HOW: how do I complete the active rung? How much per month gets me there and by when? How do I skip a rung I don't care about? How do I feed it the missing data ("Add your income to see this" — no button on most rungs)?
  - WHEN: when will this rung clear at my current pace? (No per-rung ETA anywhere.) When does the 0% cliff move `expensive_debt` back to active?
  - WHERE: where does my buffer money have to sit to count (which accounts)?

## E3. Ladder empty state
"No ladder to show yet, connect an account so Grow has a live reading to work from." (`:428-434`) — no connect button here.
- **Questions** — HOW/WHERE do I connect an account from here?

## E4. Savings plan milestones (`SavingsPlanCard`)
- **Shows** (`GrowVariant1.tsx:437-447`, `components/SavingsPlanCard.tsx`): progress ring %; "Your savings plan" / "Plan complete! 🎉"; "{done} of {total} done, keep going!"; per-milestone text with tick/circle; auto milestones "Auto-tracked · target £X"; live spend milestones "£X on {category} this month · target £Y" coloured green/amber/red at 80 %/100 % of target.
- **Endpoint**: `GET /savings/plan` → `SavingsPlan.{milestones[],done_count,total_count}`; `POST /savings/plan/steps/{id}/toggle`, `DELETE …/steps/{id}`, `DELETE /savings/plan` (`api.toggleSavingsPlanStep/deleteSavingsPlanStep/deleteSavingsPlan`, `lib/api.ts:1894-1908`).
- **Do**: tick/untick a manual milestone; remove a milestone (X); **Delete** the whole plan. Savings-type milestones are non-tappable (`auto`).
- **Questions** — WHAT makes a milestone "auto-tracked"? WHY can't I tick this one? WHERE did this plan come from (created elsewhere, in Insights)? HOW do I add a milestone from here (I can't)? WHEN does the month-target reset?

## E5. "Where it's sitting" split gauge
- **Shows** (`SplitGauge`, `:232-273`): emerald/sky bar split, `£cash` **"Cash, safe"** vs `£invested` **"Invested, at risk"**; italic "Nothing invested yet, this fills in once the ladder reaches that rung." when `!invest.has_investments`.
- **Fields**: `GrowView.buffer.current`, `GrowView.invest.portfolio_value`.
- **Questions** — WHERE is the cash (which accounts) and where is the invested money? WHAT does "at risk" mean here — is it losing money now? WHY is my current-account balance not in this bar? HOW do I change the split? WHEN would the invested figure last have updated (prices)?

## E6. Buffer mini readout + Edit pencil
- **Shows** (`:454-474`): "Buffer" `£current / £target`, "~N days covered".
- **Do**: pencil (shown only when `savingsInsights` loaded) → `SavingsGoalSheet`.
- **Questions** — WHAT is the target based on (3 vs 6 months of *what* spending)? WHY is my target that number? HOW do I change it / add an account it doesn't know about? WHEN will I reach it? WHERE is this money held?

## E7. Debt mini readout
- **Shows** (`:475-489`): `£debt.total`, then "all on 0%" or "£expensive_total not on 0%"; or emerald "None on record".
- **Do**: not tappable (**no link to `/debt-plan` from Grow**).
- **Questions** — WHICH cards? WHAT does "not on 0%" cost me? WHY doesn't this match the debt-plan carried figure (buckets vs total)? HOW do I get to the card plan from here? WHEN does the 0% end?

## E8. Footnotes
- Static `notes[]` (`grow.py:433-436`): capital-at-risk disclaimer + "The cash-ISA limit drops to £12,000 for under-65s from April 2027."
- **Questions** — WHY am I being told about ISA limits? WHAT does it mean for me? WHEN — April 2027, do I need to act before then?

## E9. `SavingsGoalSheet` (opened from E6)
- **Shows/Do** (`components/SavingsGoalSheet.tsx`): "Build your safety net… 3–6 months' spending"; target chips **3 months / 6 months / Custom** with live "≈ £X based on your spending"; collapsible "Accounts holding your savings · N selected" multi-select with balances; add/edit/delete **offline accounts** (`POST/PATCH/DELETE /savings/manual-accounts`); Save → `POST /savings/goal` (`api.saveSavingsGoal`, `lib/api.ts:1853`) labelled "Start tracking" / "Update target".
- **Questions** — WHAT is "based on your spending" (which months, which categories)? WHY 3–6? WHERE do offline accounts get their balance from (me, manually — how often do I update)? HOW does selecting an account change my buffer number and my ladder rungs? WHEN does the balance refresh?

## E10. Unrouted `GrowVariant2/3`
Same `GET /grow` payload rendered as a numbered step list / different verdict framing (`GrowVariant2.tsx:108,134-191,301-364`). Not reachable — no user questions, but they are a second copy of the ladder copy to keep in sync.

---

# F. DEBT SURFACES

## F.I `/debt-plan` (`DebtPlanPage.tsx`) — `GET /debt-plan` (`api.getDebtPlanView`) + `GET /card-terms` (`api.getCardTerms`)

### F1. Verdict hero
- **Shows** (`VerdictBlock`, `:85-180`): eyebrow **"CARRIED ON YOUR CARDS"** (when `float_total >= 1`) else "ACROSS YOUR CARDS"; big £ = `buckets.carried_total` or `totals.debt`; split line variants — "£X carried, £Y of it costing interest · £Z of monthly spending you clear as you go" / "£X carried on 0% deals · £Z…" / "£X carried · £Z…"; verdict sentence by `totals.verdict`:
  - `bad`: amber dot + "At your current pace the cards aren't coming down." or "…clear in {Month}, further out than five years." (+ "Your carried debt has risen £X over the last three months." when `history.rising`)
  - `drifting`: amber dot + "At your current pace the cards clear in {Month}, £X of that will be interest."
  - `good`: "Nothing material on the cards right now." or "…clear in {Month}, with £X interest."
  - Footnote when `commitments_reserved`: "Assumes your recent payment pace continues. Your plans reserve £X each pay period ({label}), which can change this."
- **Fields**: `DebtPlanTotals.{debt,debt_free_month,interest_to_clear,verdict,buckets}` (`lib/api.ts:1432-1451`), `history.{trend_3m,rising}`, `commitments_reserved`.
- **Questions**:
  - WHAT: what is **"carried"** vs **"float"/"monthly spending you clear as you go"**? What is "current pace" measured from? What does "drifting" mean? What is "£X of that will be interest"?
  - WHERE: where is my money going each month on these cards — which card, which spend?
  - WHY: why "aren't coming down" when I pay every month? Why does my goal reservation change the clear date? Why did my debt rise £X?
  - HOW: how do I clear faster? What's the smallest change that moves the date?
  - WHEN: is "{Month}" the month it hits zero? Why a month and not a date? When does interest start being charged?

### F2. Penny insight block
- **Shows** (`PennyInsight`, `:265-314`): Penny badge + `narration.text` (masked to `£••••` when `hideNetWorth`), from `DebtPlanNarration` (`source: "llm" | "fallback"`).
- **Do**: CTA is `narration.ask` → **"How I use this card"** (`ask.kind==="usage"`) or **"Add the deal"** → opens `CardTermsSheet` for that `account_id`; else **"Add rates"** (full walk) when any card has `terms_missing`.
- **Questions** — WHY is Penny asking me this? WHAT will change if I answer? IS this generated or a fact? WHERE did these figures come from?

### F3. "WHAT IT WOULD TAKE" (agency block)
- **Shows** (`AgencyBlock`, `:184-224`): "**£X more a month** clears every carried card by {Month}." (or "Your current pace already clears every carried card by {Month}." when `extra.amount === 0`), plus per-win lines "{card} is on its way out, clearing **{Month}** at your pace."
- **Fields**: `extra_to_clear.{amount,debt_free_month,horizon_months}`, `whats_working[]` (`DebtPlanWin`).
- **Questions** — HOW do I find £X a month (no link to Grow/Spend)? WHAT does "every carried card" exclude? WHY that horizon? WHEN — is {Month} the last payment or the zero balance? WHERE would the £X come from?

### F4. Missing-rates callout
- **Shows** (`MissingRatesCallout`, `:228-257`): "N cards have no rate on file, so their interest isn't counted." + "Add them once and the plan can count every pound of interest." + **Add rates**.
- **Fields**: `cards[].flags.terms_missing && debt > 0`.
- **Do**: opens `CardTermsSheet` (full walk, `startAccountId: null`).
- **Questions** — WHY doesn't the app know my rate (it has my bank feed)? WHAT is wrong in the numbers above until I fix this? HOW long does adding them take? WHERE do I find my rate?

### F5. "AS IT STANDS" (monthly bleed)
- **Shows** (`TrajectoryBlocks`, `:378-420`): `£X` "a month in interest right now" (`totals.monthly_interest_now`, described in the type as *observed interest-charge debits, never derived*); "£Y of that is on N cards that aren't clearing at your pace" (`totals.nonclearing`); "£Z to clear the rest / them at your pace" (`interest_to_clear`); alternative branch "No interest is hitting your cards right now." + "If these balances ran past their 0% windows at the rates on file, they'd cost about £X a month." (`potential_monthly_interest`).
- **Questions** — WHAT is the difference between interest *now*, interest *to clear*, and *potential* interest? WHICH cards are "not clearing"? WHY is one card's interest excluded? WHEN would the potential figure become real (the promo dates)? HOW do I stop the bleed?

### F6. "DEAREST CARD FIRST" (avalanche comparison)
- **Shows** (`:422-448`): "Same £{pool} a month, dearest card first, clears everything / every card you're paying down by **{Month}** with £X interest. As it stands, {N of those cards don't clear at all}; by {Month} they'd have cost £Y." (or the `as_is_clears` variant with ", N months sooner than your current pace ({Month})"); "That's **£Z** less interest."; rising-debt line; italic `sb.assumption`.
- **Fields**: `DebtPlanScenarioB` (`lib/api.ts:1401-1417`) — `debt_free_month,total_interest,window_months,as_is_interest_over_window,interest_saved,months_sooner,as_is_clears,pooled_count,pooled_nonclearing_count,covers_all_debt,assumption`. `pool` computed client-side as Σ `cards[].movement.monthly > 0` (`:334-338`). Gated on `interest_saved >= 50`.
- **Questions**:
  - WHAT: what is "dearest card first"? What is the "same £X a month" made of — is that what I actually pay now? What is "demonstrated movement"?
  - WHY: why is this better than what I do now? Why does it say "every card you're paying down" not "everything"?
  - HOW: **how do I actually do this** — there is no action button, no reordering, no plan to accept. How do I change which card gets the extra?
  - WHEN: by {Month} — and does that assume nothing new goes on the card?

### F7. "THE CARDS" — per-card rows
- **Shows** (`CardRows`, `:520-617`) per card: bank badge + name + `£debt`; **rate pill**; then either "Cleared monthly: this is spending, not carried debt." or: movement "**+£X/mo** at your pace" (or the `projected flat` assumption string), payoff "Clears {Month} · £Y interest" or "Not clearing at your pace · £Z/mo interest right now"; amber-dot usage conflict "You said you clear this monthly, but interest charges are appearing, worth a look."; muted "Its usual payment is already in your upcoming bills" (`near_term_source`).
- **Fields**: `DebtPlanViewCard` (`lib/api.ts:1363-1399`) — `debt, movement.{monthly,basis,periods_used}, rate_schedule[], payoff_month, months_to_payoff, total_interest, monthly_interest_now, paying_interest, terms_contradiction, potential_monthly_interest, first_interest_month, flags.{terms_missing,standard_rate_missing,thin_history,promo_whole_balance_assumed,assumptions[]}, classification, classification_evidence[], usage, usage_conflict, near_term_bills[]`.
- **Do**: tap the rate pill → `CardTermsSheet` for that card. Nothing else on the row is interactive (no "pay this off", no "make this the target").
- **Questions**:
  - WHAT: what is "+£X/mo at your pace" — money I'm paying, or the balance falling? What does "cleared monthly: this is spending, not carried debt" mean for my totals? What is "projected flat"?
  - WHERE: where do I see the transactions behind this card's movement (`classification_evidence` exists in the payload, never rendered)?
  - WHY: why does it say I'm not clearing when I pay the minimum? Why is this classified as cleared/carried? Why does the usage conflict say interest is appearing?
  - HOW: how do I change how this card is treated? How do I stop new spending landing on it?
  - WHEN: "Clears {Month}" — with or without new spending? When does the promo on this card end (only in the pill)?

### F8. Rate pill (per card)
- **Shows** (`RatePill`, `:455-516`): **"Add rate"** (indigo) when `terms_missing`; `"{apr}% until {Sep}"` amber-tinted when the promo end is within 60 days (`isCliff`, `:35-41`), else neutral; `"{apr}%"` or "Rate on file" for standard/unknown.
- **Do**: tap → `CardTermsSheet` prefilled for that card.
- **Questions** — WHAT does "until Sep" mean, the 1st or the 30th? WHAT rate applies after? WHY is this one amber? WHERE did this rate come from — my statement or an average? WHEN do I need to act (balance transfer lead time)?

### F9. "TRANSFER ROUTES" (balance transfer)
- **Shows** (`TransferRoutes`, `:621-652`): "Moving **£X** from {source} (24.9%) to {destination}'s offer: **£fee** fee once instead of ~**£Y** interest a month. Break-even in N weeks." + italic joined `assumptions`.
- **Fields**: `DebtPlanRefinanceOption` (`lib/api.ts:1418-1431`) — `transferable, fee, interest_saved, net_saving, window_months, break_even_weeks, assumptions[]`; source APR read off the source card's `rate_schedule` `standard` segment; monthly = `interest_saved / window_months` (client-derived).
- **Do**: read-only — **no "do it" / "mark as done" action anywhere**.
- **Questions**:
  - WHAT: what is a balance transfer, what's the fee charged on, what happens to the old card?
  - WHERE: where did the destination offer come from (it's whatever I typed into `CardTermsSheet`'s "Any 0% offers you haven't used yet?")?
  - WHY: why only £X transferable and not the whole balance? Why is break-even in weeks?
  - HOW: **how do I actually make the transfer?** How do I tell the app I did it?
  - WHEN: when does the destination offer expire? When does the fee get charged? When does break-even happen relative to the promo end?

### F10. Loading / error
Skeleton cards (`:743-748`); "The plan couldn't load, pull back and try again." (`:750-754`) — no retry button.
- **Questions** — HOW do I retry? WHY did it fail?

## F.II `CardTermsSheet` — recording card terms (`components/CardTermsSheet.tsx`)

Session is either one card (`startAccountId`) or a walk over all cards ("· {i} of {n}" in the header). Header sub when no card: "So plans can work with what each card really costs."

| Element | Copy / behaviour | Endpoint |
|---|---|---|
| Lookup phase | "Checking this card's advertised rate…" | `GET /card-terms/{id}/lookup` (`api.lookupCardTerms`) → `CardTermsLookup.{representative_apr,display_name,candidates,stale,ambiguous,rate_basis,rate_note,source_url}` |
| Found | "{name} advertises around {X}%. That's the representative rate, so yours may differ. Is it close?" + **Use {X}%** / **It's different** | `POST /card-terms/{id}` `{status:"confirmed", apr_pct}` |
| Candidates | "Which card is this?" radio list | — |
| Manual | "Couldn't find this card's advertised rate. What does yours charge?" / "Here's what you've told me. Edit anything that's changed." / "What's the rate on it?" | — |
| Standard rate input | label "What's the rate on it?" + "The card's standard rate: what it charges once no deal covers the balance." (0–100 validation) | `apr_pct` |
| **0% deals** | "Is any of this £{balance} on a 0% deal?" + "Balance transfers you've already made count here, add each one and when it ends." Yes/No; per deal: **On what?** (Purchases / Balance transfers / Both), **Until** (month chips, past months disabled + 4 year chips), **Deal rate** %; up to 4 deals; "+ Add another deal"; shortcut button "It's on a 0% deal" | `promos: CardPromo[] {kind, apr_pct, until}` — `until` stored as the **last day of the chosen month** (`endOfMonthIso`) |
| **Unused offers** | "Any 0% offers you haven't used yet?" + "Offers the card is dangling, not ones you've already taken." Per offer: **Ends** month/year, **Fee** % (0–15), **Note** ("e.g. 0% for 12 months"); up to 6 | `bt_offers: BtOffer[] {ends, fee_pct, note}` |
| **Usage** | "How do you use this card?" + "Optional, it helps me read this card's balance right." → **I clear it monthly** / **I carry a balance** (toggleable off) | `usage: "clear_monthly" \| "carry"` |
| Footer | **Later** (records a skip and advances) / **Save** | `POST /card-terms/{id}` `{status:"skipped"}` |
| Closing | "That's updated, your card picture stays sharp." / "That's all N, your card picture is sharp." | — |
| Errors | "Pick both the month and year the offer ends." / "Fees are usually small, enter 0 to 15%." / "Deal rates are small, enter 0 to 30." / "Pick a month that's still ahead." / "Two deals of the same kind need different end dates." / "Enter a rate between 0 and 100." | — |

- **Questions**:
  - WHAT: what's the difference between a "0% deal" I have and a "0% offer I haven't used"? What's a "representative rate" and why isn't it mine? What does "purchases vs balance transfers vs both" change? What happens to my numbers if I pick "I clear it monthly" wrongly?
  - WHERE: where on my statement do I find the APR / the promo end date? Where does this get used (the answer — the whole debt plan, the Plans dock cliff, the Grow `expensive_debt` rung — is never stated)?
  - WHY: why does it need the end *month* only? Why must two deals of the same kind differ? Why is my balance shown here?
  - HOW: how do I record a deal that's already expired? How do I remove a rate I entered wrong? How do I say "I don't know"? (only "Later")
  - WHEN: does "until Sep 2026" mean through 30 Sep? When does the app re-check the advertised rate? When does "Later" ask me again?

---

# G. SCENARIO / WHAT-IF (the life simulator)

## G1. `ScenarioConfirmCard` (in Penny thread, `components/PennyConversation.tsx:447-608`)
- **Shows**: "Here's what I understood"; one editable `fieldset` per extracted item, legend **Cancel / Income change / New cost**; fields **Label**, **Amount** (with amber-dot "assumption, check this" when `prefilled && kind==="income_change"`), **Cadence** select, **Starts** (`type="month"`), **Duration** (Ongoing / Ends) and **End month**; quiet `rejected[]` line; **Run it**. Empty case: "Everything was removed, nothing left to run."
- **Fields**: `CanIResponse.{scenario,items,rejected,prefilled,clarify}` from `POST /can-i` (`api.canI`, `lib/api.ts:1725`); `ScenarioItem` (`lib/api.ts:734-745`).
- **Do**: edit any slot, remove an item, **Run it** → `router.push('/scenario?items=<json>')`. Nothing is simulated until Run it.
- **Questions** — WHAT is it going to simulate, over what horizon? WHY did it guess this amount ("assumption, check this")? WHY were some items rejected? HOW do I add a fourth item (3-item backend cap)? WHEN does "starts" mean — the 1st of that month? HOW does the simulator work at all?

## G2. `/scenario` page (`app/scenario/ScenarioPage.tsx`) — `POST /scenario/run`
- **G2a. "What if" card**: one line per item, "Add/Cancel/Change {label}, £X a month, from {Sep 2026}", plus `rejected` text.
  - Questions — WHAT exactly did it take from my question? WHY is my wording gone?
- **G2b. "Month-end cash" hero**: `headline`; **Now** (`baseline.monthly_surplus`) → **With this** (`cash.surplus_after` or "Unclear"); delta pill `±£X a month` (`recurring_delta`); lumpy note "Some of this lands in specific months rather than being spread evenly, see the month-by-month figures for where it actually bites."; null reason (`reasons.cash`, e.g. thin history) or `UNMAPPED_REASON_FALLBACK`.
  - Fields: `ScenarioCashBlock.{surplus_now,surplus_after,per_month[],first_tight_month,months_negative}` — note `per_month`, `first_tight_month`, `months_negative` are **in the payload but never rendered**, while the lumpy note tells the user to "see the month-by-month figures".
  - Questions — WHERE are the month-by-month figures it just told me to look at? WHAT is "month-end cash" vs Planning's runway vs Home's safe-to-spend? WHY "Unclear"? WHEN would I first go tight (`first_tight_month` exists, unshown)? HOW many months does this project?
- **G2c. "Debt" card**: debt-free month **Now → With this** (raw `YYYY-MM` strings, *not* formatted like everywhere else), or "Unclear" + reason.
  - Fields: `ScenarioDebtBlock.{debt_free_month_now,debt_free_month_after,months_later,extra_interest,movement_exhausted,clears_after}` — `months_later`, `extra_interest`, `movement_exhausted` are **never rendered**.
  - Questions — WHAT is "debt free" (all cards? carried only?)? HOW MUCH extra interest does this cost me (`extra_interest` is in the payload)? WHY unclear? WHEN — is `2027-04` the month it clears?
- **G2d. "Plans & goals" card**: per plan, amber dot when `slipped`, "{feasibility_now} → {feasibility_after}"; "At least one plan would become harder to reach under this scenario."
  - Questions — WHAT do "surplus/savings/stretch/funded" mean as words on a row? WHICH plan slipped and by how long (`target_date` is in the payload, unshown)? WHY did it slip?
- **G2e. "Grow · emergency fund cover"**: `N.N months` Now → With this, amber dot when worse.
  - Questions — WHAT counts as cover? WHY does it drop? WHEN do I run out?
- **G2f. "Where this comes from"**: "£X a month to place. Your surplus covers £Y of it, none right now." + candidate categories with "£Z/mo median"; or "This change frees up money. There is no shortfall to place anywhere."
  - Questions — WHERE do these categories come from? WHY these? WHAT does "median" mean? HOW do I actually cut one (no link to Spend/budget)? Am I being told to cut them?
- **G2g. Footer assumptions** (`assumptions[]` minus the lumpy note) + **Try again** on error ("This scenario couldn't be run right now. Nothing has changed, try again.") + empty state "No scenario to show yet. Ask Penny a 'what if' question to see it here." → **Ask Penny** opens the sheet.
  - Questions — WHAT assumptions is this all resting on? HOW do I save/keep this scenario (there's no save, no share, no re-run with edits — back goes to `/penny`)? HOW do I turn a scenario into a real plan/commitment?

---

# H. ADJACENT / SUPPORTING SURFACES

## H1. `/budget` — "Trends" (`app/budget/BudgetPage.tsx`), orphaned route
- **Elements**: period nav card (prev/next + swipe, `formatPeriod`, "Current period", prev disabled at `oldestTransaction`); hero "THIS PERIOD · £X spent on choices · £Y/day · N days to payday" (`GET /pace/detail` → `PaceDetail.pace.{actual,discretionary_so_far}`, `period.{closed,days_left}`); notable-day line "{Monday 4 Aug} was £X, about 2.3× your usual Monday" (`detail.notable_day`); "YOUR CHOICES" rows — category, `£X/day · 1.4× your usual · 22% of your spending`, optional aim line "£X of your £Y aim · N days left" (`choice.checkpoint`), tap → `CategorySheet` with the aim "door" (`suggested_aim`, `intent`, `door_engaged`); Penny FAB → budget chat (`GET/POST /budget/chat`, `/budget/chat/session`, `/budget/chat/new`) with an **"Apply this budget"** card writing `PUT /budgets` (`api.setBudgets`).
- **Note**: page shows *no budget limits* despite fetching `GET /budgets` — budgets are only written via chat and read by `goalsSummary`.
- **Questions** — WHERE are my budgets, now that this page is called "Trends"? WHAT is an "aim" vs a "budget limit" vs a "checkpoint"? WHY is a category "1.4× your usual"? HOW do I set a limit without chatting to Penny? WHEN does the period roll? WHY can't I reach this page from the nav?

## H2. `UpcomingBillsStrip` (Home → Planning bridge)
- **Shows** (`components/UpcomingBillsStrip.tsx`): "Coming up · 14 days"; a `DropSentence` verdict (from `lib/comingUp.tsx`); footer "N bills · £X total" + optional "· £Y **moving between your accounts**"; amber dot when something is due today.
- **Endpoint**: `GET /cashflow`; window `days_away < 14`; `isSpend` filters out `kind==="movement"` from the headline.
- **Do**: tap → `/planning?day={heaviest or today's ISO date}`.
- **Questions** — WHAT is "moving between your accounts" and why isn't it in the total? WHICH day is the heavy one? WHY 14 days when Planning shows a pay period? WHERE did the bill I tapped go (see the day-fallback note, A6)?

## H3. `GoalsStrip` (Home)
- **Shows** (`components/GoalsStrip.tsx`): up to three rows — label, detail, 6 px bar coloured by status (emerald done / amber at-risk / indigo on-track); "7 over" humanised to "7 categories over budget".
- **Endpoint**: `GET /goals/summary` → `GoalSummary.{pillar,label,detail,pct,done,at_risk,url}`; `url` is `/debt-plan` | `/grow` | `/budget`.
- **Do**: tap a row → its pillar page. Empty state CTA "Start with debt payoff" → `/debt-plan`.
- **Questions** — WHAT are my three goals and did I choose them? WHY is one amber? WHERE does "budget" take me (an unlinked page titled "Trends")? HOW do I add/remove a goal?

---

# I. Cross-surface question clusters (the ones no single element answers)

1. **Three different "how much is free" numbers**: Planning runway (`spendable − bills to payday`), Grow `surplus_monthly` (monthly income vs spending, post-debt), `PlanOneOffSheet`'s Safe-to-Spend "in hand" figure, plus Scenario "Month-end cash". No surface reconciles them. → *WHY don't these agree? WHICH one should I trust?*
2. **"Demonstrated movement"** underpins the card payoff dates, "£X/mo at your pace", the dearest-card-first pool and the scenario debt block (`DebtPlanMovement.basis`, `periods_used` — both in the payload, **never rendered**). → *WHAT is "my pace", over how many periods, and does it include the payment that's in my upcoming bills?*
3. **0% promo dates** appear as month-only in three places with three formats: Plans dock "Next 0% ends Sep 2026", rate pill "0% until Sep", Grow "at 0% until 30 Sep 2026" (`formatPromoCliff` is the only one that shows a day). → *WHEN exactly, and what changes that day?*
4. **No action ever attaches to advice**: transfer routes, dearest-card-first, "£X more a month", ladder rungs, absorb candidates — all read-only. → *HOW do I do the thing you just told me about, and how do I tell you I did it?*
5. **Money "reserved" vs money "moved"**: commitment slices, funding pots, `count_existing` baselines, and the payday-plan legs are described but never shown as a transfer anywhere in Planning. → *WHERE is this money right now, and who moves it?*
6. **Red vs amber doctrine** (genuine shortfall vs timing risk vs unfundable movement) is implemented precisely in code (`:670-772`, `:1185-1208`) and explained to the user nowhere. → *WHY is this red / why is that only a dot?*
