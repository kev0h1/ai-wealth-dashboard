# Question inventory: Spend surfaces
Captured 2026-08-27 from the live components. Source of truth for Penny tool coverage of these surfaces.
Caveat: a few claims are inferred from code comments rather than observed behaviour (intent-preview copy, on_track/period.closed being unrendered, /transactions/search total semantics).

I have everything needed. Here is the inventory.

---

# SPEND surfaces — user-question inventory

Files: `/root/ai-wealth-dashboard/frontend/app/components/SpendPage.tsx`, `/root/ai-wealth-dashboard/frontend/components/SpendHeader.tsx`, `/root/ai-wealth-dashboard/frontend/components/SpendVerdictView.tsx`, `/root/ai-wealth-dashboard/frontend/components/SpendTrends.tsx`, `/root/ai-wealth-dashboard/frontend/components/MiscategorisedReviewSheet.tsx`, `/root/ai-wealth-dashboard/frontend/components/TeachingSheet.tsx`, `/root/ai-wealth-dashboard/frontend/components/IntentConsentSheet.tsx`, `/root/ai-wealth-dashboard/frontend/components/CategorySheet.tsx`, `/root/ai-wealth-dashboard/frontend/components/CategorisationRulesSheet.tsx`, `/root/ai-wealth-dashboard/frontend/components/PayPeriodSettingsSheet.tsx`, `/root/ai-wealth-dashboard/frontend/app/transactions/TransactionsPage.tsx`, `/root/ai-wealth-dashboard/frontend/lib/api.ts`.

## 0. Endpoint map (everything the Spend tab touches)

| Endpoint | api.ts | Feeds |
|---|---|---|
| `GET /spend/verdict?offset=N` | `api.spendVerdict` (1607) | reading, pills (Out/In/Net), period.days_elapsed, pace_series, moved+moved_total, notables, quiet_flags, majority, unresolved, unresolved_total/_material. 90 s client cache (`VERDICT_TTL_MS`, SpendPage:145) |
| `GET /spend/category-signals?offset=N` | `api.categorySignals` (1606) | per-category `usual_rate_per_day`, `multiple`, `suggested_aim`, `checkpoint`, `intent`, `door_engaged`. 60 s cache (SpendPage:105), prev period pre-warmed after 400 ms |
| `POST /spend/verdict/dismiss-unresolved {txn_id}` | 1608 | ask card "Not now" |
| `POST /trends/intent {category, answer}` | 2457 | "One-off" / "New normal" |
| `POST /spend/intent-preview {category}` | 2463 | consent sheet's "Here's what that changes" lines |
| `DELETE /spend/intent/{category}` | 2466 | toast "Undo" |
| `POST /checkpoints {ref, aim_amount?}` / `DELETE /checkpoints/{id}` | 2449 / 2452 | AimBlock set / cancel aim |
| `GET /transactions/miscategorised-count?offset=N` | 1799 | banner `count`, `ids`, `pair_count`, `review_total` |
| `GET /transactions/miscategorised` (all-time) | 1800 | review-sheet series rows, `members`, `reason` |
| `POST /transactions/dismiss-miscategorised-series {series_key}` | 1837 | series "Dismiss" |
| `GET /transactions/transfer-pair-suggestions` | 1844 | "Possibly the same transfer" cards |
| `POST /transactions/confirm-transfer-pair` / `dismiss-transfer-pair` | 1845 / 1850 | "Same transfer" / "Not the same" |
| `GET /transactions/search?q&category|categories&merchants&from&to&txn_type&page` | 1666 | the /transactions hub |
| `GET /transactions?days=365` | `api.allTransactions` via `lib/useAllTransactions.ts` | SpendTrends charts, income drill-down list, "Payments over £250" |
| `GET /transactions/oldest` | 1617 | how far back prev-period nav / the period sheet may walk |
| `PATCH /transactions/{id}` | `patchTransaction` | TeachingSheet spend fork; returns `matches_past` + `rule_suggestion` |
| `POST /transactions/{id}/resolve-movement` | `resolveMovement` | TeachingSheet movement fork |
| `POST /rules` / `DELETE /rules/{id}` | 2257 / 2268 | "Always file X as Y?" + its undo (with `affected[]` revert) |
| `GET /categories`, `POST /categories` | 1950/1951 via `CategoriesContext` | picker vocabulary + kinds (spend/commitment/movement) |
| `GET /commitments` | 1737 | movement-goal step's goal chips |
| `GET /accounts` | `api.accounts` | account names on ask card, review sheet, teaching sheet |
| `GET /subscription` | 2403 | `isPro` → Groceries receipt tool in CategorySheet |
| `GET /transport/summary` | | Transport-by-mode widget |
| `PUT /preferences` (`spend_widgets`, `home_pinned_widget`) | 1928 | Over-time widget order / pin |

Backend semantics referenced below: `/root/ai-wealth-dashboard/backend/app/services/spend_verdict.py` (qualify thresholds 1.5×/£40 or 1.25×/£120, `NOTABLE_CAP=3`, `EVERYTHING_THRESHOLD=3`, unresolved material = largest ≥ £250 **or** ≥10 % of Out, `determine_state`: `early` <5 days, `nobaseline` thin history, `nothing`/`normal`/`everything`).

---

## 1. Header region — `SpendHeader.tsx`

### 1.1 "Back to this period" chip (SpendHeader:418-427)
- **Shows**: appears only when `isCurrentPeriod` is false. Client-side period state (`lib/payPeriod.ts` + `PreferencesContext.payPeriodConfig`), not an endpoint.
- **Do**: `onSelectOffset(0)` → jumps to offset 0 (re-fetches verdict/signals/miscat count for that offset).
- **Questions**: WHAT — am I looking at history right now? WHEN — which period *is* "this period", and does it end on payday or month-end? HOW — can I pin a default period?

### 1.2 Period whisper row: `PAY PERIOD · 31 JUL → 27 AUG · DAY 23` (SpendHeader:443-451)
- **Shows**: label from `formatPeriodLocal(periodStart, periodEnd)` (`PayPeriodSettingsSheet.tsx:15`, UTC dates); `DAY {verdict.period.days_elapsed}` from the server payload.
- **Do**: tap → opens the Period sheet (§1.9).
- **Questions**: WHEN — why does my period start on the 31st and not the 1st? Is "day 23" counted from period start or from today? Does day N include today? Is a closed period frozen (`period.closed`)? WHAT — is this pay-period or calendar-month? HOW — where do I change the boundary (answer: sheet → Pay period settings)? WHY — the whole page's "usual by now" is scaled by day N, so: if my payday moves, does every multiple move too?

### 1.3 Prev / Next chevrons + swipe (SpendHeader:433-461, `usePeriodSwipe`)
- **Shows/Do**: `handlePrev`/`handleNext` walk one period; prev disabled past `oldestTxDate` (`GET /transactions/oldest`).
- **Questions**: WHEN — how far back can I go, and why does it stop? WHERE — did older data get dropped or is that genuinely my first transaction? WHAT — do past periods still ask me one-off/new-normal questions (they render, but `resolved` state resets per period, SpendPage:315-320)?

### 1.4 Search icon → `/transactions` (SpendHeader:463-469)
- **Shows**: link only. **Do**: full-history search hub.
- **Questions**: WHERE — where do I find one specific payment? WHAT — does search cover all accounts and all time (scope line says so)? WHY — why is this a different scope than the page I just left?

### 1.5 "Out" cell — `fmt(pills.spent)` (SpendHeader:487-494)
- **Shows**: `verdict.pills.spent`, the engine's reconciled outgoing total; explicitly NOT a client re-derivation (SpendPage:525-533 warns the old local sum wrongly counted Savings/Investment/Debt).
- **Do**: tap → `handleOutTap` (SpendPage:271) force-expands the majority list and scroll-snaps to `#spend-majority-section` (notables + majority + unresolved = Out).
- **Questions**: WHERE did it go — which categories/payments make up this number? WHAT — does "Out" include transfers to savings, credit-card payments, refunds, foreign-currency rows? Does it include unplaced "Other"? (yes — the footnote says so). WHY — is it high because of one bill or many small ones? WHY is it different from my bank's "spent this month"? HOW — if I recategorise a transfer, does Out drop? WHEN — is this so far this period, or a projection?

### 1.6 "In" cell — `fmt(pills.income)` (SpendHeader:495-503)
- **Shows**: `verdict.pills.income`. **Do**: toggles `IncomeDrilldown` (SpendHeader:99-111) — client-side list of `homeTxns` where `transaction_type === "credit" && category === "Income"`, sorted amount-descending (SpendPage:569-579), each row → TeachingSheet.
- **Questions**: WHERE — what's actually in my income? WHAT — why isn't this refund/transfer-in counted as income? Why does the list only show "Income"-category credits? WHY — why is In lower than my salary (period boundary splits a payday)? HOW — how do I mark this credit as income (answer: tap row → TeachingSheet credit fork "No: this was income")? Note: `pills.net` exists in the payload but is never rendered — "so am I up or down?" is an unanswered question here.

### 1.7 "Moved" cell — `fmt(moved_total)` in emerald (SpendHeader:504-514)
- **Shows**: `verdict.moved_total` (server sum of `moved[]`); cell absent entirely on payloads without the field.
- **Do**: tap → scrolls to `#spend-money-moved`.
- **Questions**: WHAT does "moved" mean — is it spending or not? Why is it green when money left my account? Is it added to Out or excluded (excluded — the block says "not counted in spending")? WHERE — moved *to where*, whose accounts? WHY — why is £8k "moved" when I only saved £500 (backend explicitly splits genuine destinations vs `own_accounts` shuffling)? HOW — how do I make a category count as moved rather than spent (answer: TeachingSheet movement fork / category kind)?

### 1.8 Pace strip sparkline (SpendHeader:188-269)
- **Shows**: `verdict.pace_series[]` — solid indigo cumulative `actual`, dotted slate cumulative `usual`, 4 px dot at today, tiny "usual" text label; `aria-label` reads "£X so far this period, against a usual pace of £Y". If every `usual` is null: renders "still learning your usual". Backend `build_pace_series` excludes "Other", income and movement kinds and uses a learned shape curve, not a straight line.
- **Do**: nothing — non-interactive (no tooltip, no scrub, no axis labels, no numbers).
- **Questions**: WHAT is the dotted line — average of what, how many periods? WHY is my line above it — which day did it jump (no date axis to answer this)? WHERE — can I tap a spike to see the payment (currently not)? WHAT — why does the usual line curve rather than ramp? WHEN — does it stop at today or run to period end? WHAT — "still learning your usual": how many periods until it learns (the reading says "about two full pay periods")? WHY does the strip disagree with a category's "4.3× usual" (different bases: totals exclude Other, categories don't)?

### 1.9 OUT-pill footnote: "Includes £X not yet placed ›" (SpendHeader:529-537)
- **Shows**: `unresolved_total`, gated on server-computed `unresolved_material`.
- **Do**: scrolls to `#spend-unresolved`.
- **Questions**: WHAT does "not yet placed" mean — unknown merchant, pending, uncategorised? WHY can't it be placed? WHERE are those payments? HOW do I place them (answer: ask card / Other row → TeachingSheet)? WHY — does this mean the rest of the page's judgement is wrong (it literally hedges the reading)?

### 1.10 The reading caption (SpendHeader:546)
- **Shows**: `verdict.reading`, wrapped in `MoneyText` so £ figures render mono. Deterministic templates per state (`build_reading`): `early` = "N days in, too soon to compare against usual."; `nobaseline` = "Still learning your usual, I need about two full pay periods…"; `nothing` = "Nothing unusual to report, all N categories running close to usual." (+ hedges for elevated / no-baseline categories); `everything` = "Spending is running high across the board, about £X more than a typical N days in."; `normal` = "One category is running above your usual pace, mostly Bills. Everything else looks normal." Sentence 2 may be a priced consequence or the movement-reassurance fallback ("You also moved £X to savings, and £Y between your own accounts.").
- **Do**: nothing — plain text, no "why?" affordance.
- **Questions**: WHY this verdict — which numbers produced it? WHAT — "mostly Bills": mostly by what measure, £ or count? WHAT — "everything else looks normal": normal vs what baseline? "£1,411 ahead of usual" — ahead by when, end of period or today? WHERE — tap-through to the evidence behind sentence 1 (none exists). WHEN — does the verdict change tomorrow? Who wrote this — a model or a rule?

### 1.11 Period sheet (SpendHeader:315-387)
- **Rows**: six most recent periods from `recentPeriods` (SpendPage:635-645, truncated at oldest transaction), each labelled `31 Jul → 27 Aug`, offset 0 tagged **Current**; then **Pay period settings** and **How we categorise your money**.
- **Do**: `onSelectOffset(offset)` walks the period math; opens `PayPeriodSettingsSheet` / `CategorisationRulesSheet`.
- **Questions**: WHEN — why only six? why does the list stop? WHAT — is a listed period closed/final? HOW — change my pay cycle; understand why money-to-self isn't spending.

---

## 2. Body — `SpendVerdictView.tsx`

### 2.1 Transfers-to-review banner (SpendVerdictView:863-886)
- **Shows**: one of three strings depending on payload: `"{review_total} transfers to review"` (all-time, authoritative) / `"{count+pair_count} transfers to review this period"` / `"{count} transfers this period may be miscategorised"`. From `GET /transactions/miscategorised-count?offset=N` (`count`, `pair_count`, `review_total`). Absent at zero.
- **Do**: opens `MiscategorisedReviewSheet` (§5). Also auto-opens via `/spend?review=1` from Penny's "Review transfers" chip (`lib/pennyScreenConfig.tsx:170`).
- **Questions**: WHAT is a "transfer to review" — what did the engine spot? WHY these ones? WHERE — which accounts/payments? WHY — is my Out figure wrong until I fix these (yes: "overstates your spending")? WHEN — is this count this period or all time (deliberately different; the sheet splits This period / Earlier periods)? HOW — fix them; stop being asked again (Dismiss).

### 2.2 Notable card — header row (SpendVerdictView:307-339)
- **Icon chip**: `getCategoryColour` / `getCategoryIcon` (deterministic hue from category name, `lib/categories.ts`).
- **Category name**: `notable.category`.
- **Amber chip `{multiple.toFixed(1)}× usual`**: `notable.multiple` from `category-signals`. Crossfades on resolve to a neutral chip: `noted · one-off` or `usual updating`.
- **Questions**: WHAT does "4.3× usual" mean — 4.3× a typical *whole period* or 4.3× usual-by-day-23? (it's pace-to-date). Usual over how many past periods? WHY is this category notable and not the bigger one below it (answer: excess must clear £40@1.5× or £120@1.25×)? WHAT — why only three cards (NOTABLE_CAP)? WHAT does "usual updating" mean, and how long until it's updated? WHERE — is a colour/icon meaningful?

### 2.3 Notable card — spend figure (SpendVerdictView:341)
- **Shows**: `fmt(notable.spent)` — this category's period spend, net of nothing (backend `cat_agg`).
- **Questions**: WHERE — which payments? WHAT — does it include refunds? WHY is it different from the same category's row in the majority list (it isn't listed twice — notables are removed from majority, SpendVerdictView promoted-set logic)? HOW — does correcting one payment move this?

### 2.4 Notable card — pace line (`paceLine`, SpendVerdictView:56-62)
- **Shows**: one of three sentences from `multiple`, `excess`, `daysElapsed`: "about twice your usual pace for day 23." / "about 4.3× your usual pace for day 23." / "running about £120 ahead of usual for day 23."
- **Questions**: WHAT — "usual pace for day 23": is my usual front-loaded by bills? WHY — £120 ahead: ahead of what number exactly (the underlying `usual_by_now` is in `notable.pace` but never rendered)? WHEN — will this self-correct by period end? WHY does the wording change between × and £ (threshold at 1.9-2.1)?

### 2.5 Notable card — consequence line (SpendVerdictView:361-365)
- **Shows**: `notable.consequence_line.text` — server-priced consequence (from `spend_impact`), deliberately un-alarmed styling. Absent when unpriced.
- **Questions**: WHY this consequence — what assumption (rest of period at usual pace?) produced it? WHAT — is it a prediction or a fact? WHERE — what does it hit: bills, savings, safe-to-spend? HOW — what would make it go away? WHY does one card have it and another doesn't?

### 2.6 Notable card — "Biggest:" cause line (`causeLine`, SpendVerdictView:64-67)
- **Shows**: `Biggest: {name} £{amount} · {name} £{amount}.` from `notable.cause[]` (backend `_top_causes` over the category's debit transactions), clamped to 2 lines.
- **Questions**: WHERE — is that a merchant or a raw bank string? WHY only two/three names — what's the rest? WHAT — is "biggest" by single payment or by merchant total? HOW — tap a name to filter (not tappable; only the whole card routes).

### 2.7 "See the {payments_count} payment(s) ›" (SpendVerdictView:372-379)
- **Shows**: `notable.payments_count`. **Do**: `onOpenCategory(name)` → SpendPage pushes `/transactions?category=X&from=ISO&to=ISO` (SpendPage:746-752) — hub with two removable chips.
- **Questions**: WHERE — the actual payments. WHAT — why does the hub show more/fewer than N once I remove the period chip? WHEN — the period chip: what happens if I widen? HOW — recategorise from there (each row → TeachingSheet).

### 2.8 Intent pair — question + "One-off" / "New normal" (SpendVerdictView:393-427)
- **Shows**: `notable.prior_intent?.question` (softened repeat-ask when this category was already filed new-normal before) else "Was this a one-off, or the new normal?".
- **Do**: "One-off" → `POST /trends/intent {answer:"one_off"}` (awaited, real error surface: "Couldn't save that, try again."), then card collapses + `ResolveToast`. "New normal" → never posts; opens `IntentConsentSheet` (§4.1).
- **Questions**: WHAT happens if I say one-off — does it hide the card, silence future alerts, or change my baseline? WHAT does "new normal" change (that's exactly what the consent sheet answers)? WHY is it asking again — I said this last month (that's `prior_intent`). HOW do I undo (toast Undo → `DELETE /spend/intent/{category}`)? WHEN — does an answer apply to this period only or forever? WHERE does the answer show up elsewhere (Home, aims, safe-to-spend)?

### 2.9 AimBlock — three states (SpendVerdictView:116-247)
- **State C (offer)**: quiet "Set an aim" link; eligibility `multiple >= 1.5 && suggested_aim != null` from `category-signals`.
- **State B (ask)**: "Your usual {category} is about £X a period." + "Aim for that this period?" + **Set this aim** (`POST /checkpoints {ref}`) / **Choose a different amount** (inline £ input → `POST /checkpoints {ref, aim_amount}`); error "That didn't save. Try again."
- **State A (live)**: "£{spent_so_far} of your £{aim_amount} aim · {daysLabel(days_left)}" + **Cancel this aim** (`DELETE /checkpoints/{id}`, silent on failure). `on_track` is in the payload but unused.
- **Questions**: WHAT is an "aim" — a budget, a limit, an alert? WHY is £X my usual — over what history? WHEN — does the aim run to period end; what happens on day one of the next period; is it recurring? WHAT — what happens if I blow through it (nothing visible here — no on-track state rendered)? WHERE else does the aim appear? HOW — change the amount later (only cancel + re-set)? WHY am I only offered an aim on ≥1.5× categories? Is `spent_so_far` the same figure as the card's own `spent` (different sources: checkpoint vs cat_agg)?

### 2.10 Unresolved ask card (SpendVerdictView:461-559)
- **Shows**: `UNPLACED · {payments_count} PAYMENTS`; `£{largest.amount} · {accountName ?? largest.display_name} · {date}`; (material weight only) "The biggest of the N. I can't place it yet."; "All N together are £{unresolved.total}, counted in your £{pills.spent} out." Two densities from `unresolved.weight` (`material` vs `routine`). Account name resolved client-side from `GET /accounts` matched on `largest.account_id`.
- **Do**: **"Tell me what this was"** → `onAskCorrect` builds a synthetic Transaction and opens `TeachingSheet` with `forceMovementRoot` (SpendPage:797-832) → lands on "Is this account yours?". **"Not now"** → optimistic hide + `POST /spend/verdict/dismiss-unresolved {txn_id}` (per-transaction only; the whisper/Other row stay).
- **Questions**: WHY can't it be placed — bad merchant string, new payee, unmatched transfer? WHERE — which account, which date, is it pending? WHAT — is this money gone or held? WHY is *this* one asked about and not the other N-1 (materiality: ≥£250 or ≥10 % of Out, or recurring)? WHAT does "Not now" do — forever, or will it come back? HOW do I place it, and does answering fix the other N-1 too? WHY does it start with "Is this account yours?" rather than a category list?

### 2.11 Unresolved whisper (SpendVerdictView:938-942)
- **Shows**: `Other · £X, still working this one out` — only when the ask card isn't showing and `unresolved.total > 0`.
- **Questions**: WHAT is "still working this one out" — is the engine going to fix it by itself? WHEN? HOW do I help? WHY is it in "Out" if you don't know what it is?

### 2.12 "This period / Over time" tablist (`SpendPatternsToggle`, SpendHeader:277-308)
- **Do**: toggles `showPatterns`; `?view=trends|categories|list` deep-links map onto it (SpendPage:664-669); `?view=upcoming` redirects to `/planning`.
- **Questions**: WHAT is in "Over time" — same numbers, different window? WHY does the header (Out/In/Moved) stay on both? WHEN — does "Over time" respect the period I'm on (yes, charts are period-scoped + walk back 6)?

### 2.13 Majority section header (`majorityHeader`, SpendVerdictView:701-715)
- **Shows**: state-dependent — `LOOKING NORMAL · £X ACROSS N CATEGORIES` (normal/nothing) / `WHERE THE REST WENT · …` (everything) / `WHERE YOUR MONEY WENT · …` (nobaseline) / `SO FAR THIS PERIOD · …` (early). Sum/count exclude zero rows **and** exclude "Other" and the promoted notables.
- **Questions**: WHY doesn't this total match "Out" (notables + Other are missing from it — the biggest latent confusion on the page)? WHAT — "the rest" of what? WHAT — does "looking normal" mean I'm fine? WHEN — "so far this period": compared with what?

### 2.14 Majority row (SpendVerdictView:561-590)
- **Shows**: icon chip, `row.category`, `{payments_count} payment(s)`, optional amber `· above usual` when the category is in `quiet_flags` (qualified but overflowed `NOTABLE_CAP`), and `£{row.spent}` right-aligned. `has_baseline`/`elevated` are in the payload; `elevated` is not itself rendered here (the amber tag keys off `quiet_flags`).
- **Do**: tap → `/transactions?category=X&from&to`.
- **Questions**: WHAT does "· above usual" mean and why isn't it a card like the ones above? WHY does this row have no × multiple? WHY is a bigger amount below a smaller one (it's £-sorted — but a notable with a bigger amount sits *above* in a different section)? WHERE — the payments. WHY is this category in the list at all (is Savings/Debt here? no — movement kinds are excluded upstream)?

### 2.15 "Show all {N}" (SpendVerdictView:971-979) and "Nothing in X or Y yet" (980-984)
- **Shows**: collapse at 8 rows; zero-spend categories named in a whisper line.
- **Questions**: WHAT — why do I have categories with nothing in them? WHEN — is "yet" a nudge that something's due (no link to Planning)? HOW do I delete a category I never use (only via Settings; not reachable here)?

### 2.16 "Other" row (SpendVerdictView:600-625, rendered at 988-995)
- **Shows**: grey chip, `Other`, `{unresolved.payments_count} payments · still placing`, `£{unresolved.total}`. Deliberately outside the header's sum/count and never hidden behind Show all.
- **Do**: `onOpenCategory("Other")` → `/transactions?category=Other&from&to`.
- **Questions**: WHAT — is "Other" a category or not (the code says never; the row looks like one)? WHY is it visually subordinate? WHY does it not have a × usual? HOW do I empty it? WHEN — does "still placing" mean an async job is running?

### 2.17 "Money you moved" disclosure (SpendVerdictView:627-697)
- **Header**: `Money you moved · £{sum of moved[]}, not counted in spending` + chevron (collapsed by default). Note: this sums client-side, while the header's Moved cell uses server `moved_total` — two paths to the same figure.
- **Rows** (per `moved[]` entry, fixed order): icon by `kind` (`pots` PiggyBank, `credit_cards` CreditCard, `investments` TrendingUp, `own_accounts` ArrowLeftRight), `m.label` ("To your pots" / "To your credit cards" / "To your investments" / "Between your accounts"), sub-line `goal_names.join(" · ") · N payments`, amount.
- **Do**: rows with `m.categories` route to `/transactions?categories=…&txn_type=debit&from&to&label=…` (SpendPage:766-781); rows without are inert divs.
- **Questions**: WHAT is the difference between "To your pots" and "Between your accounts" (backend: `Transfer` that survived transfer-target refinement = plain shuffling)? WHY is my credit-card payment not spending — I *did* spend it? WHERE did "Between your accounts" actually go? WHY do goal names appear on pots but nowhere else? WHY is one row tappable and another not? HOW do I make a custom category count as moved? WHEN — does moving money to savings still count against my safe-to-spend?

---

## 3. Toasts and error banners (SpendPage)

| Element | Shows | Do | Questions |
|---|---|---|---|
| `ResolveToast` (SpendPage:43-85) | "Groceries noted as a one-off." / "Groceries filed as your new normal." 5 s auto-dismiss | **Undo** → `DELETE /spend/intent/{category}`, refetch signals + verdict | WHAT changed exactly? WHEN does the window to undo close (5 s, no second chance)? HOW do I change my mind next week? |
| Undo-failure banner (SpendPage:988-998) | "Couldn't undo that, try again." | none | WHAT state am I in now — filed or not? WHERE do I retry? |
| Notable card intent error (SpendVerdictView:421-425) | "Couldn't save that, try again." | retry the button | WHY did it fail — offline, server? |
| Verdict load failure (SpendPage:839-841) | "Couldn't load this period. Try again shortly." | none (no retry button) | WHEN will it work? HOW do I retry? |

---

## 4. Sheets opened from the Spend body

### 4.1 `IntentConsentSheet` — "New normal" consent
- **Shows**: title `previewTitle ?? "File {category} as your new normal?"`; "Here's what that changes:" + `lines[]` from `POST /spend/intent-preview {category}` (skeleton while loading; generic fallback "This updates what counts as usual for {category}." on failure).
- **Do**: **File it** → `POST /trends/intent {new_normal}` owned by SpendPage (`handleFileNewNormal`, refetches signals + verdict, resolves card, toast); **Keep as one-off for now** / X → dismiss without writing; inline "Couldn't save that, try again."
- **Questions**: WHAT does it change — my baseline, my aims, my safe-to-spend, future alerts? WHEN does the new usual take effect — this period or next? WHY is it priced (what are these lines derived from)? HOW do I reverse it (Undo toast only; no visible "manage my intents" surface)? WHAT — "keep as one-off for now" — did that just record a one-off (no, it records nothing)?

### 4.2 `MiscategorisedReviewSheet` — "Review these transfers"
- **Penny explainer** (601-620): Transfer / Savings (savings account) / Debt (card payment) rules + "these look like your own transfers but landed in a spending category, which overstates your spending."
  - *Questions*: WHAT — how did they land wrong in the first place? WHY does that overstate spending — by how much?
- **"Possibly the same transfer" section** (`renderPair`, 227-310, from `GET /transactions/transfer-pair-suggestions`): two leg rows (bank badge + account name + `date · description` + `−£X` / `+£X`), reason line "The same amount left {A} and arrived in {B} on the same day / a day apart" (`date_diff_days`).
  - *Do*: **Same transfer** → `POST /transactions/confirm-transfer-pair {credit_id, debit_id}` (fixes both legs' categories **and** learns the description pair for future syncs; failure restores card + "Couldn't file that, try again."); **Not the same** → `POST /transactions/dismiss-transfer-pair {pair_key}`.
  - *Questions*: WHY do you think these are the same — same amount, same day, that's it? WHAT changes if I confirm (both categories + a learned rule)? WHERE do I see the learned pairing afterwards? WHAT if I'm wrong? WHEN — will it auto-match next month?
- **Series row** (`renderItem`, 338-565): ArrowLeftRight chip in the current category's colour, merchant/description, `{count}×` badge, `{count} payments since {first_date}` or `{date}`, bank badge + account name, amount or `min – max` range, current-category pill, evidence line `reason` ("The payee name matches yours." / "The account number matches your {account}." / "…matches the one shown above."), `See the {count} payments` inline disclosure (6 most recent members + "{N} earlier payments not shown"; server caps members at 20).
  - *Do*: **Recategorise** → stacked `TeachingSheet` on the synthesised transaction; **Dismiss** → `POST /transactions/dismiss-miscategorised-series {series_key}`, optimistic removal.
  - *Questions*: WHY was this flagged (the reason line answers one row; not the count)? WHAT — is a "series" all payments to this payee forever? WHAT — does recategorising fix all N payments or just the newest (the sheet passes one synthesised transaction; propagation depends on TeachingSheet's rule offer)? WHERE are the other N-6? WHAT does Dismiss mean — this period, forever, this series only? HOW do I undo a dismiss (no path)? WHY does the amount show a range?
- **This period / Earlier periods split** (330-336, only when both groups non-empty).
  - *Questions*: WHEN — why is the banner's number smaller than this list (period-scoped count vs all-time list — the split exists to explain exactly this)?
- **Empty state**: 🎉 "All reviewed / Nothing left to check for now."

### 4.3 `TeachingSheet` — the recategorise engine (every Spend entry point funnels here)
- **Header**: merchant/description, `−£X`/`+£X`, date, bank badge + account name.
- **Spend fork** (`spend-root`): "I've filed this as {category}, correct it and I learn." + category chips (`GET /categories`, custom first, current one ringed; movement/income kinds and "Other" excluded by the Destination Rule) + **Something else…** + **This was money I moved ›**.
  - *Do*: chip → `PATCH /transactions/{id} {category}` (or `resolve-movement {spending}` when the row is currently movement-kind).
  - *Questions*: WHAT does "I learn" mean — will it fix past payments too? WHY was it filed as this? WHERE is the list of my categories from? HOW do I make a new one? WHY isn't Savings/Transfer in this list?
- **`spend-naming`**: "New category" name input + kind toggle **Everyday spending** / **A bill I have to pay** (inferred by `inferCategoryKind`, movement coerced to discretionary). (The richer `CategoryKindChooser.tsx` with the third "Money I move, not spend" option exists but is only wired into `/design/category-kind`.)
  - *Questions*: WHAT is the difference between the two kinds — what does each do to my figures? WHY can't I create a "money I move" category here? WHERE will this new category appear?
- **Movement fork, debit** (`movement-root`): intro varies — "Money moved has a destination, not a category. Where did it go?" (via escape hatch) / "I can't place this one yet. I don't know enough to guess, so I'm asking." (ask handoff) / "This looks like money you moved. It left for an account I can't see." Options: *Yes: to another of my accounts here* (`mine-here` → Transfer), *Yes: it funds a goal* → goal chips from `GET /commitments` (+ "My goal isn't listed" → name a pot → `mine-offline`; failure copy "I couldn't check your goals just now" + Try again), *Yes: just an account of mine elsewhere* → offline pot name (`mine-offline`), *No: this was spending* → category picker.
  - *Questions*: WHY does it think this is money I moved? WHAT is an "offline pot" and where does it show up (Accounts? Net worth?)? WHAT — will this stop counting in my spending (yes)? WHERE — does linking to a goal credit that goal's progress? HOW — what if it's neither mine nor spending?
- **Movement fork, credit**: "Money arrived. Where is it from?" → *Yes: from another of my accounts* (Transfer) / *No: this was income* / *No: something else*.
  - *Questions*: WHAT — will marking it income change my In figure and my payday detection?
- **`propose-rule`**: "Always file {merchant} as {category}? · Matches {matches_past} past payments · will catch future ones" → **Always** (`POST /rules`, then toast "Filed and rule saved. Undo" which reverts the categorisation **and** every `affected[]` sibling) / **Just this once**.
  - *Questions*: WHAT exactly will the rule match — the merchant, a substring, all amounts? WHERE do I see/edit my rules later (copy elsewhere points at Settings → Rules)? WHAT — does it rewrite the N past payments retroactively (yes)? WHY didn't it offer a rule this time (`matches_past == 0`)? WHAT — what if Always fails on free tier (falls back to "Filed.")?
- **Done toast**: "Filed as {category}." + **Undo**, 5 s then auto-close. Footer whisper on every step: "I learn from every correction, you shouldn't have to do this twice."
  - *Questions*: WHEN — does my Spend page update immediately (SpendPage invalidates transactions + signals + verdict caches, `handleTxUpdated`)? WHY did the "× usual" chip change after I corrected something?

### 4.4 `CategorisationRulesSheet` — "How we categorise your money"
- Four cards: own-money-moving isn't spending (Savings / Debt / Transfer), purchases by merchant, "we flag anything that looks off", "you're always in control … Settings → Rules".
- *Questions*: WHERE is Settings → Rules? HOW do I see what rules already exist? WHAT — does "by who you paid" mean an external merchant database? WHY did *my* payment get the wrong category?

### 4.5 `PayPeriodSettingsSheet`
- Modes: Calendar month / Monthly pay date (day 1-28) / Every two weeks (weekday + reference date) / Last weekday of month; **Save Pay Period**.
- *Questions*: WHEN — will changing this rewrite my history (SpendPage resets to offset 0 on config change)? WHAT happens to a live aim / a "day 23" figure? WHY only up to day 28? WHERE — does this affect Home/Planning too?

### 4.6 `CategorySheet` — the surviving synthetic list: "Payments over £250"
- Opened only from Over-time → Transaction sizes → **Review large payments** (SpendPage:862-875, threshold `Math.abs(amount) >= 250` over `listTxns`). Shows title, `{count} transactions · this period`, total, and rows → TeachingSheet. `door` (aim) never applies here; Transport/Groceries tool chips can appear if `name` matched (it's forced to "Other", so they don't).
- *Questions*: WHY £250 (fixed, unexplainable in UI)? WHAT — does this include transfers/refunds (yes — it's raw `periodTxns`, unlike everything else on the page)? WHERE — why doesn't this match the £250+ bar's own total (bar excludes Transfer + credits)?

---

## 5. "Over time" — `SpendTrends.tsx` (period-scoped, computed client-side from `GET /transactions?days=365`)

Common note: every widget filters `spendDebits` = debits excluding "Transfer" only — so Savings/Investment/Debt-kind spend IS included here, unlike the verdict's Out. That is a first-order "why don't these agree?" question.

| Widget | Shows | Do | Questions |
|---|---|---|---|
| **Category breakdown** (donut) | Slices = category totals with credits netted; top 5 legend with % of total; "+N more" | Click a slice → tooltip £ | WHAT total is the % of — does it match Out? WHERE — why is Savings a slice here but "moved" up top? WHY no Other slice explanation? |
| **Daily spend** (bars) | "Busiest day: {date} · £X · N× your daily average"; bars per day up to today; dashed `avg £X/day` reference line | Click a bar → £ tooltip | WHY is the average only over *active* days? WHERE — what did I buy on the busiest day (no drill-through)? WHEN — why does it stop at today? WHY does the busiest day not appear as a notable? |
| **Period comparison** (6 bars) | "£X this period · £Y (Z%) more/less than last"; current period highlighted; leading empty periods dropped | Click → tooltip | WHEN — is the current (partial) period compared against complete ones (yes — the honest-comparison trap)? WHAT — same category rules as the header? WHERE — tap a bar to open that period (not wired)? |
| **Transaction sizes** (7 bands `<£5 … £250+`) | "N payments over £250 · X% of your spend"; By spend / By count toggle | **Review large payments** → CategorySheet §4.6 | WHY these bands? WHAT — is a £249 payment safe? WHERE — see the payments in a middle band (only £250+ has a CTA)? |
| **Transport by mode** | `GET /transport/summary`: "£X/mo · Transport · 90 days", car/rideshare/public split bar + per-mode rows with £/mo and % | none | WHEN — 90 days, not my pay period: why the different window? WHERE — which payments are "Car Care"? HOW — is this the same as the Transport category? |
| **Widget chrome** | ⋮ menu: Pin to Home / "Pin to Home (replaces pin)" / Unpin, Remove; hold-drag to reorder; **Add widget** gallery ("Charts use the pay period you're viewing") | `PUT /preferences {spend_widgets, home_pinned_widget}` | WHAT — only one Home pin, why? WHERE does a pinned widget appear? HOW do I get a removed widget back (gallery)? |
| Empty states | "No spending in this period" / "No charts yet, add one below…" | | WHY empty — no data or wrong period? |

---

## 6. `/transactions` hub — `TransactionsPage.tsx` (every "See the payments" lands here)

| Element | Shows / source | Do | Questions |
|---|---|---|---|
| Back button | `router.back()` | | WHERE do I go back to — the period I came from? |
| Title "Every payment · Search" | static | | WHAT — every payment, ever, all accounts? |
| Search input (300 ms debounce) | `q` → `GET /transactions/search` | type / clear | WHAT fields does it search — merchant, description, amount, category? WHY doesn't an amount search work? |
| Scope line | "Searching everything · all accounts, all time" or "Searching all accounts" when a period chip is applied | | WHEN — does "all time" mean my full bank history or the imported window (`allTransactions` uses 365 d elsewhere, but this endpoint is unbounded)? |
| Category chip (removable) | `categoryLabel ?? category ?? categories.join()`; carries `txn_type` and `label` as one unit | X clears category + categories + label + txn_type together | WHY does clearing "To your pots" also drop the debit-only scope? WHAT does the label "To your pots" resolve to underneath (hidden category list)? |
| Merchants chip (indigo) | `merchants=` from insight deep-links, shows first + `+N` | X clears | WHERE did these merchant names come from? |
| Period chip | `31 Jul → 27 Aug` from `from`/`to` (SpendPage passes `isoDate(periodStart/End)`) | X → widen to all history, count updates | WHEN — is the boundary inclusive? WHY does the count jump when I remove it? |
| Result rows (`TransactionRow`) | merchant favicon or initial, display name, `{date} · {category}`, `+/-£X` (note: ASCII hyphen here, unlike the U+2212 house rule elsewhere) | tap → TeachingSheet | WHAT — why does this row's category differ from where I found it? WHERE — which account is this from (row doesn't show it; `showAccount` prop unused here)? |
| Pagination | `{page} / {pages} · {total} total`, Prev/Next, horizontal swipe | | WHAT — is `total` the count for this filter or overall? WHY doesn't the page show a summed £ total for the filter (the single most obvious missing figure for "See the 12 payments" — the card said £X, this page never re-states it)? |
| Empty states | "No payments matching "{q}"" / "No payments in this period" + **Widen to all history ›** | clear period | WHY zero — wrong period or wrong filter? |

---

## 7. Cross-cutting questions the surface provokes (not tied to one element)

- **Reconciliation**: Out = notables + majority + unresolved, but the majority header's own sum excludes notables and Other — three visible totals that never add up on screen. "Why doesn't £X + £Y = my Out?"
- **Three different spend definitions in one tab**: verdict `pills.spent` (excludes movement kinds, includes Other) vs SpendTrends (`spendDebits`: excludes only "Transfer") vs CategorySheet "over £250" (raw, includes everything). "Which one is my real spending?"
- **Currency**: `homeTxns` filters non-home currency out of every client-side figure (`isHomeCurrency`, SpendPage:516-519) but foreign rows still appear in lists. "Where did my KES spending go in the totals?" `sym` is `£`/`KES ` but `SpendHeader.fmt` and `SpendVerdictView.fmt` hardcode `£`.
- **Freshness**: verdict cached 90 s, signals 60 s, transactions 60 s, all invalidated on recategorise. "Why did the number change when I came back?" / "Is this live?"
- **Closed periods**: `period.closed` and `days_left` are in the payload and never rendered; past periods still show intent buttons and aims. "Can I still act on last month?"
- **Provenance**: nothing on the page says which figures are rules vs a model (backend is fully deterministic). "Did an AI decide this?"
- **No settings/kind surface reachable from Spend**: category kind (discretionary/commitment/movement) drives what counts as spend, but is only editable inside TeachingSheet's new-category flow. "How do I stop 'House Fund' counting as spending?"
