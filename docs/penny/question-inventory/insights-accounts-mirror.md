# Question inventory: Insights, Accounts, Mirror, recurring
Captured 2026-08-27 from the live components. Source of truth for Penny tool coverage of these surfaces.
Caveat: the sparkline, utilisation bar, and Mirror KIND_ACCENT sections describe INERT code paths (no data source / never applied), written as questions-if-wired, not live UI.

I have everything needed. Here is the inventory.

---

# User-Question Inventory — INSIGHTS / ACCOUNTS / MIRROR

Endpoints traced through `/root/ai-wealth-dashboard/frontend/lib/api.ts`. Types resolve to `/root/ai-wealth-dashboard/shared/src/types.ts` (re-exported as `@wealth/shared`).

---

## PART 1 — INSIGHTS TAB

Files:
- `/root/ai-wealth-dashboard/frontend/app/insights/page.tsx` (5-line shell)
- `/root/ai-wealth-dashboard/frontend/app/insights/InsightsPage.tsx` (1388 lines — page + `SavingsInsightsSection` exported for embedding)
- `/root/ai-wealth-dashboard/frontend/app/insights/tax/TaxPage.tsx`
- `/root/ai-wealth-dashboard/frontend/app/insights/receipts/ReceiptsPage.tsx`
- `/root/ai-wealth-dashboard/frontend/components/HomeInsightSpotlight.tsx`
- `/root/ai-wealth-dashboard/frontend/components/ValueDeliveredStat.tsx`
- `/root/ai-wealth-dashboard/frontend/lib/insightIcons.ts`

---

### 1.1 Page header — "INSIGHTS / Ways to save"

`InsightsPage.tsx:1281-1285`

**Shows** — static eyebrow `INSIGHTS`, title "Ways to save", subtitle "Personalised ways to spend less, start with the top one." No stat. Alternate hero (`heroMode === "tax"`, `:1254-1278`) shows a tax-year progress bar computed **client-side** from `new Date()` (6 Apr → 5 Apr), with `{daysLeft} days left`.

**Endpoint** — none for the "save" header. Tax hero: pure client date maths, no API.

**Can do** — nothing (tax hero is non-interactive; reachable only via `?tab=tax` deep link, `:1225`).

**Questions**
- WHAT: "Ways to save" — save *versus what*? Is this a target, or just tips?
- WHY: why is there no number here when every other tab leads with a figure?
- WHEN (tax hero): what happens on 5 Apr? Does the bar mean I'm running out of time on something specific to me?

---

### 1.2 Insight card — category chip + label

`InsightCard` / `CategoryChip`, `InsightsPage.tsx:56-66, 695-711`

**Shows** — lucide icon in indigo tile (`insightCategoryIcon(insight.category)`) + `insight.label`.

**Endpoint** — `GET /savings-insights` → `api.getSavingsInsights()` (`lib/api.ts:2274`), fields `SavingsInsight.category`, `.label`, `.icon` (`.icon` is fetched but **unused** — the frontend maps its own icon via `lib/insightIcons.ts`).

**Can do** — nothing (decorative).

**Questions**
- WHERE: does this category correspond to a category I see on Spend/Transactions? Are "Bills" here the same "Bills" there? (They are not — `CATEGORY_APP_ROUTES` in `backend/app/routers/savings_insights.py:114-127` maps `mobile`/`broadband`/`energy`/`insurance`/`water` all onto `?category=Bills`.)
- WHAT: what does "car_finance" vs "car_insurance" mean when both are the same monthly direct debit to me?

---

### 1.3 Insight card — "New" badge

`InsightsPage.tsx:699-703`

**Shows** — Penny mark + "New" pill when `insight.is_new`.

**Endpoint** — `SavingsInsight.is_new` off `GET /savings-insights`. Tab badge is separate: `GET /savings-insights/new-count` (`api.newInsightCount`, `lib/api.ts:2275`) consumed by `components/BottomNav.tsx:57`, cached in `localStorage["wd_insight_badge"]`. Viewing the list fires `POST /savings-insights/mark-viewed` (`api.markInsightsViewed`, `:2276`) and clears that cache (`InsightsPage.tsx:899-900`).

**Can do** — implicitly clear the badge by viewing. No explicit "mark all read".

**Questions**
- WHEN: new since when — since my last visit, or newly generated?
- WHY: why is this still marked New when I read it yesterday? (Per-card `is_new` has a different lifecycle from the tab badge — comment at `:897-898`.)
- WHAT: is "New" a new *saving* or new *wording on an old saving*?

---

### 1.4 Insight card — the user's own figure (headline)

`InsightsPage.tsx:725-732`

**Shows** — `~£{topTrigger.monthly_amount}/mo at {topTrigger.display_name}` + `· +N more` + caption "· from your transactions". `topTrigger = insight.triggered_by[0]`.

**Endpoint** — `SavingsInsight.triggered_by[]` (`merchant_key`, `display_name`, `monthly_amount`, `occurrences`) off `GET /savings-insights`.

**Can do** — nothing directly (the collapsible "Based on N transactions" below is the drill-in).

**Questions**
- WHERE: **which account is this £X/mo leaving from?** The card never names an account — only a merchant. This is the single biggest WHERE gap on the surface.
- WHAT: is `~£X/mo` an average, a latest charge, or an annualised/12 figure?
- WHY: why is this merchant the "top" one when another one costs me more?
- WHEN: over what window was this monthly figure computed?
- HOW: how do I change or cancel it — the card offers no cancel path, only comparison links.

---

### 1.5 Insight card — verified savings banner

`InsightsPage.tsx:714-722`

**Shows** — emerald banner: "**You did it**, payments to {verified_merchant} have stopped. That's ~£{verified_savings}/mo staying in your pocket."

**Endpoint** — `SavingsInsight.verified_savings`, `.verified_merchant`.

**Can do** — nothing (celebratory only; no dismiss, no "undo, it didn't stop").

**Questions**
- WHY: why does it say this stopped when I only paused it / switched to annual billing?
- WHEN: when did it stop — which was the last payment?
- WHAT: is "£X/mo staying in your pocket" a real balance change I can see somewhere, or a projection?
- HOW: how do I tell you this is wrong (still paying, different card)?

---

### 1.6 Insight card — title + body ("more"/"less")

`InsightBody`, `InsightsPage.tsx:623-665`; title at `:735-743`

**Shows** — `insight.title` (demoted to sub-line when a trigger exists) and `insight.body`, truncated to the **first two sentences** with a "more" toggle. Sentence splitter protects decimals via `_DECIMAL_PLACEHOLDER = "\0"` (`:621`) so "4.47%" isn't rendered as "4. 47%". Both rendered through `MoneyText`.

**Endpoint** — `SavingsInsight.title`, `.body` (LLM-generated backend-side).

**Can do** — expand/collapse.

**Questions**
- WHAT: what do these numbers in the body mean — are they *my* numbers or a national average? (`body` is LLM copy; only `triggered_by` is the user's own data.)
- WHY: why is this advice being given to me specifically?
- WHY: is this an ad? Who chose these providers?
- HOW: what is step one — the body describes an outcome, not an action.
- WHEN: is this deal/price still current?

**Note:** `savings_estimate` exists on the type but is **deliberately never rendered** on this card (comment in `HomeInsightSpotlight.tsx:154-160`). It leaks only into Planning's bill-row hint (§4.4).

---

### 1.7 Insight card — timestamp

`InsightsPage.tsx:749-751`, helper `timeAgo` `:68-77`

**Shows** — "Today"/"Yesterday"/"3d ago"/"2w ago"/"1mo ago", **only if `refreshed_at` is within 14 days**. Clock-skew guard: negative diff renders "Today".

**Endpoint** — `SavingsInsight.refreshed_at`.

**Questions**
- WHEN: what happened at that moment — was the *advice* refreshed or my *spending* re-read?
- WHY: why do older cards show no date at all? (Silent >14-day suppression.)

---

### 1.8 Insight card — primary in-app CTA

`InsightsPage.tsx:754-762`, labels map `APP_ROUTE_LABELS` `:40-53`

**Shows** — "See your subscriptions ›" / "See your energy bills ›" etc, keyed off `insight.category`; falls back to "See it in your spending".

**Endpoint** — `SavingsInsight.app_route`; built server-side in `backend/app/routers/savings_insights.py:999` via `_merchant_scoped_route()`, resolving to `/transactions?category=Subscriptions`, `?category=Bills`, `?category=Groceries`, `?category=Eating%20Out`, `?category=Health`, or a bare `/transactions?merchants=<names>` (`CATEGORY_APP_ROUTES`, `:114-127`).

**Can do** — navigate to a scoped transaction list.

**Questions**
- WHERE: "See your subscriptions" lands on a *category* filter — where do these subscriptions actually bill from? Which card/account?
- WHAT: why does "See your mobile bills" show me a generic "Bills" list containing water and insurance too?
- WHY: why doesn't the destination show the same £/mo the card just showed me?
- HOW: from that list, how do I actually cancel or switch?

---

### 1.9 Insight card — comparison-site links

`InsightsPage.tsx:765-781`, map `CATEGORY_LINKS` `:25-37`

**Shows** — "Compare:" + external pills (uSwitch, MSE, Habito, Compare the Market, GoCompare, Trolley, Tastecard, Hussle, Which?, VoucherCodes…). Hardcoded frontend map, **not** backend data. Comment says URLs verified 5 Jul 2026.

**Can do** — open a third-party site in a new tab (`target="_blank" rel="noopener noreferrer"`).

**Questions**
- WHY: are you paid for these links? Why these two sites?
- WHAT: does clicking this share my data with them?
- HOW: after I switch on one of these sites, how does the app know / how do I mark it done? (No return path, no "I did this" affordance — only the passive `verified_savings` detection in §1.5.)
- WHEN: are these prices current?

---

### 1.10 Insight card — workflow CTA + WorkflowDrawer

`InsightCard` CTA `:784-792`; `WorkflowDrawer` `:394-608`

**Shows** — secondary outlined button labelled `workflow.cta`, or **"Improve this tip"** when `insight.user_context` already exists. Drawer: progress bar, "Step N of M", one input per step (`text`/`number`/`currency` with £ prefix / `select` as a stacked radio list), Back/Next/"Save & Personalise", plus a "Save with answers so far" escape hatch. A pre-fill grounding banner: "We can already see ~£X/mo at {merchant}, only N quick questions…" (`:529-534`). `gym_name` is auto-prefilled from the top trigger (`:415-417`). On save: 1.5s success state ("Penny is crunching your numbers"), then `onSaved` refetches immediately **and again after 25s** (`:827`).

**Endpoints**
- `GET /savings-insights/workflows` → `api.getWorkflows()` (`lib/api.ts:2293`), `Record<category, WorkflowDef>` — keyed **by category**, not insight id (`:1094, :1107`).
- `POST /savings-insights/{id}/context` → `api.saveInsightContext()` (`lib/api.ts:2294-2299`), body `{ context: Record<string,string> }`.
- Read-back: `SavingsInsight.user_context`.

**Can do** — answer the workflow, revise it later, save partial answers, abandon (X or backdrop tap).

**Questions**
- WHY: why are you asking me this — don't you already have my transactions?
- WHAT: what happens to what I type? Is this stored, shared, sent to an AI?
- WHAT: "Improve this tip" — improve how? What was wrong with it?
- HOW: how do I edit an answer I got wrong? (Only via re-entering the whole flow.)
- WHEN: how long until the personalised advice appears? (Copy says "in a moment"; code waits 25s.)
- HOW: my deal end date is in the workflow — will you remind me? (`SavingsInsight.deadline_at` is parsed backend-side but **never rendered anywhere in the frontend**.)

---

### 1.11 Insight card — pin toggle

`InsightsPage.tsx:705-710`, handler `handlePin` `:933-941`

**Shows** — `Bookmark` / `BookmarkCheck` (indigo when pinned). Pinned cards get their own "Pinned" band above "For You" (`:1088-1097`).

**Endpoint** — `PATCH /savings-insights/{id}/pin` → `api.pinSavingsInsight()` (`lib/api.ts:2281-2285`), returns `{ pinned: boolean }`. Optimistic local re-sort by pinned.

**Questions**
- WHAT: does pinning mean "I'll do this", "remind me", or just "keep at top"?
- WHY: do pinned insights stop refreshing / stop being replaced?
- HOW: how do I mark one as *done* rather than pinned? (No done state exists.)

---

### 1.12 Insight card — "Based on N transactions" disclosure

`InsightsPage.tsx:796-819`

**Shows** — collapsible listing each `triggered_by` entry: `display_name` (truncated 65%) · `£{monthly_amount}/mo` · `{occurrences}×`.

**Endpoint** — `SavingsInsight.triggered_by[]`.

**Questions**
- WHERE: which account did each of these hit? (Not shown — only merchant + amount + count.)
- WHY: why is this merchant in this insight — I don't recognise the name. (`display_name` is a normalised `norm_key.title()` server-side, `savings_insights.py:572`, so it can look nothing like the statement string.)
- WHAT: is `N×` occurrences within a month, or across the whole lookback?
- WHY: two of these look like the same merchant billed twice — is that a duplicate?

---

### 1.13 Refresh control + "Searching…" state

`InsightsPage.tsx:991-1019`, `handleRefresh` `:920-931`, banner `:1079-1086`

**Shows** — "Refresh" with spinning icon; switches to "Searching…" and shows an indigo banner "Searching for the latest deals… Results appear in ~20 seconds." Hard-coded `setTimeout(…, 20000)` then refetch.

**Endpoint** — `POST /savings-insights/refresh` → `api.refreshSavingsInsights()` (`lib/api.ts:2286`), returns `{ message }` (fire-and-forget; the client does not poll).

**Questions**
- WHAT: searching *where* — the web, or my transactions?
- WHY: nothing changed after refreshing — did it fail? (No error surfaced if the 20s elapses with an unchanged list.)
- WHEN: how often does this happen on its own? Do I need to press it?
- HOW: can I refresh just one card?

---

### 1.14 Show more / fewer

`InsightsPage.tsx:1109-1116`; `VISIBLE_UNPINNED = 3` (`:889`)

**Shows** — "Show N more ways to save" / "Show fewer".

**Hidden logic worth flagging** (`:947-960`): the insight currently on the Home spotlight is **filtered out of this list** unless it's deep-linked, is the only one, or has a `return_reason`.

**Questions**
- WHERE: I saw a tip on Home — where is it in this list? (Deliberately suppressed.)
- WHY: why only three by default?
- WHAT: are the hidden ones worse, or just older?

---

### 1.15 Deep-link scroll + ring highlight

`InsightsPage.tsx:943-946, 965-984`

**Shows** — `?insight=<id>` expands "show more" if needed, scrolls the card into centre and pulses a 2.4s indigo ring.

**Callers** — `HomeInsightSpotlight.tsx:114`, Planning bill hint `PlanningPage.tsx:1454`.

**Questions**
- WHY: why did the page jump? What did I just get taken to?
- WHERE: which of these is the one I tapped, after the ring fades?

---

### 1.16 "Improve your suggestions" → Unknown Bills panel

`ImproveHousekeepingPanel` `:836-871`, `UnknownBillsPanel` `:88-220`

**Shows** — collapsed row "Improve your suggestions". Inside: amber card "Help us personalise your insights / N recurring bills we couldn't identify". Each bill row: `display_name`, `£{monthly_amount}/mo · {occurrences} payments`. Expanding shows a 3-column icon grid of `label_options` + a "Skip" tile. On pick: "Generating insight…" then a 20s delayed reload.

**Endpoints**
- `GET /savings-insights/unknown-bills` → `api.getUnknownBills()` (`lib/api.ts:2287-2290`) → `{ unknown_bills[], label_options: Record<key,{icon,label}> }`.
- `POST /savings-insights/label` `{ merchant_key, category }` → `api.labelBill()` (`:2291-2292`).

**Can do** — categorise an unknown recurring bill, or Skip it.

**Questions**
- WHAT: **what *is* this payment?** — the user is being asked the question they'd ask the app.
- WHERE: which account is this "£X/mo" going out of? (Not shown — merchant + amount only, so identification is harder than it needs to be.)
- WHY: why couldn't you identify it when it's a well-known name?
- WHAT: what does "Skip" do — hide forever, or ask again later?
- WHEN: "N payments" over what period? Is this monthly, quarterly, annual?
- HOW: what if it's not a bill at all (one-off, a friend, a transfer)?

---

### 1.17 "Your labelled bills" panel

`LabelledBillsPanel` `:233-389`

**Shows** — "Your labelled bills / N bills categorised". Rows: `display_name`, current label (or italic "Skipped"). "Edit" reveals the same category grid with the current pick ringed, plus a red **"Remove label (put back in unknown)"**.

**Endpoints**
- `GET /savings-insights/labels` → `api.getBillLabels()` (`lib/api.ts:2300`).
- Re-label: `POST /savings-insights/label` (same as above).
- `DELETE /savings-insights/labels/{merchant_key}` → `api.deleteBillLabel()` (`:2301-2305`).

**Questions**
- WHAT: is this the same as the categories on my transactions? (No — separate bill-label store.)
- WHY: relabelling didn't change my Spend page — why not?
- WHEN: how long until a re-label produces a new insight? (20s timer, `:264`.)
- HOW: can I rename the merchant, not just re-categorise it?

---

### 1.18 Pro lock (402)

`InsightsPage.tsx:1029-1052`, trigger `:902-905`

**Shows** — when `GET /savings-insights` returns HTTP 402, an indigo "Pro feature" panel listing four benefits and "From £5.99/month · Cancel anytime". Also `api.getSubscription()` sets `isPro` (`:1182-1185`) but that state is **never read** — dead.

**Endpoint** — 402 from `/savings-insights`; `GET` subscription via `api.getSubscription()`.

**Can do** — nothing. **There is no upgrade button on this panel.**

**Questions**
- HOW: how do I actually upgrade? (Dead end.)
- WHAT: am I on Pro or not? Was I before?
- WHY: I saw insights last week — why are they locked now?

---

### 1.19 Empty / error / loading states

`:1021-1027` (3 pulsing skeletons), `:1054-1058` ("Couldn't load insights"), `:1060-1077` (lightbulb + "No insights yet" + "Find Savings" button).

**Questions**
- WHY: no insights — because I have nothing to save, or because you haven't looked yet?
- HOW: "Find Savings" — what will it do, and does it cost anything?
- WHEN: how much transaction history do you need before this works?

---

### 1.20 "More · learn the basics" → MoneyBasicCard

`InsightsPage.tsx:1301-1311`

**Endpoints** — `GET /money-basics/daily` (`api.getDailyMoneyBasic`, `lib/api.ts:2270`), `GET /money-basics?topic=` (`:2271-2272`).

**Questions** — WHAT: is this about me or generic education? WHY is it hidden down here?

**COVERED (2026-08-27)** — this card is retired as a UI surface entirely
(owner decision: education should arrive when asked, not on a 16-day
rotation). Both questions above are moot now: there's no "down here" left
to hide it in, and "is this about me or generic education" is answered by
Penny saying so in the reply itself. The same 16 explainers
(`app/content/money_basics.py`'s `MONEY_BASICS`) now ground `explain`'s new
category (e) — `isa-allowance`, `cash-vs-ss-isa`, `lisa`,
`personal-savings-allowance`, `emergency-fund`, `high-interest-debt-first`,
`pension-match`, `pension-tax-relief`, `compound-interest`,
`investment-fees`, `diversification`, `dividend-allowance`, `cgt-allowance`,
`tax-year-dates`, `premium-bonds`, `marriage-allowance` — reachable by
asking Penny directly, plus curated chips on `grow` (Lifetime ISA, Cash vs
Stocks & Shares ISA) and `tax` (Marriage Allowance). See PENNY_TOOLS.md's
`explain(topic)` row.

---

### 1.21 AdviceDisclaimer

`InsightsPage.tsx:1380`, `components/AdviceDisclaimer.tsx`

**Questions** — WHAT: if this isn't advice, what is it? WHY does the app tell me to switch provider but disclaim advice?

---

### 1.22 Tax section (hidden tab, `?tab=tax`)

`app/insights/tax/TaxPage.tsx`. Never offered in the UI (`InsightsPage.tsx:1141-1143`); reached from Grow pension rungs + Settings.

**Elements & endpoints**
- `TaxHeroCard` (`TaxPage.tsx:308-380`) — four branches by adjusted income: PA fully tapered (≥£125,140) / 60% trap (£100k–£125,140) / higher rate / basic rate. Figures computed **client-side** (`PA = 12_570`, `TAPER_START`, `TAPER_END`, `taperLoss()` `:11-19`).
- Income source: `GET` `api.getTaxAnnualisedIncome()` (`:207`) + `api.getPreferences()` (`:221`), or props passed down from `InsightsPage` (`income_bracket`, `income_value`, `pension_annual`, `has_child_benefit`, `:1196-1213`).
- `ActionRow` (`:75-132`) — status icon (done/action/info) + tap-to-mark-done, persisted via `useDone()` (`:45`).
- ISA row (`:479-480`): "ISA: £20,000 allowance · {daysLeft} days left" / "Unused ISA allowance cannot be carried forward…".
- `KeyDate` rows (`:552-563`): 5 Apr end of tax year, 31 Jul payment on account, 31 Jan self-assessment.
- `TaxPennyEntry` (`InsightsPage.tsx:1373`).

**Questions**
- WHAT: **what is an ISA, and do I have one?** The app knows (`accountKind.ts:24` classifies `sub.includes("isa")` as Investment; `AccountMiniCard.tsx:290` gives ISA its own colour) but this page never says whether *you* have one.
- WHERE: which of my accounts is the ISA — and how much of the £20,000 have I already used? (Never computed.)
- WHY: am I being told about the 60% trap — did you read my salary, or did I type it?
- HOW: how do I "top up my ISA" from here? (No action, no account link.)
- WHEN: "{daysLeft} days left" — until what exactly, and what happens if I miss it?
- WHAT: does "mark done" tell HMRC anything, or is it just a checkbox for me?

---

### 1.23 Home spotlight insight (`HomeInsightSpotlight.tsx`)

**Shows** — one insight as a swipeable card: category chip, "New" badge, `return_reason` line with a `RotateCcw` icon, `title`, `body` (2-line clamp), "See all insights ›". Deliberately **no** savings-estimate badge (`:154-160`).

**Endpoints** — `GET /savings-insights/spotlight` → `api.getSpotlightInsight()` (`lib/api.ts:2278`); `POST /savings-insights/{id}/dismiss` → `api.dismissSpotlightInsight()` (`:2279-2280`). After dismiss it re-`load()`s to surface the next eligible one.

**Can do** — dismiss via X or left-swipe (35% width or velocity > 0.5); tap → `/insights?tab=save&insight=<id>`.

**Questions**
- WHAT: does dismissing kill this tip forever, or just for today?
- WHY: **"why is this back?"** — the `return_reason` copy exists precisely because a resurfaced card reads as nagging (comment `:139-144`). e.g. "Updated: estimated saving now ~£83/mo".
- WHERE: where did the card I just swiped away go? (Suppressed from the Insights list too, unless it has a `return_reason` — `InsightsPage.tsx:947-960`.)
- HOW: how do I get it back?

---

### 1.24 ValueDeliveredStat (Home → Insights)

`components/ValueDeliveredStat.tsx`

**Shows** — one row: "£X/mo **saved**" when `verified_monthly_saving > 0`, else "£X/mo **potential savings**". Hidden entirely when both are 0.

**Endpoint** — `GET /value-delivered` → `api.valueDelivered()` (`lib/api.ts:1611`) → `{ insights_acted_on, total_monthly_saving, verified_monthly_saving?, breakdown[] }`. **`breakdown[]` is fetched and never rendered.**

**Can do** — tap → `/insights?tab=save`.

**Questions**
- WHAT: "saved" versus "potential savings" — what's the difference and which am I looking at?
- WHY: I haven't done anything — why does it say I'm saving £X?
- WHERE: which insights make up this number? (The `breakdown` exists in the payload but has no UI.)
- WHEN: saved since when? Is this per month, forever?

---

### 1.25 Dead code (not routed/rendered)

- `app/components/InsightList.tsx` — old dark-theme `Insight` cards (`impact`, `confidence %`, `rationale`, `action`). No importer.
- `app/components/AccountList.tsx` — old dark-theme account list. No importer.

---

## PART 2 — ACCOUNTS SURFACES

Files:
- `/root/ai-wealth-dashboard/frontend/app/accounts/page.tsx` → `/root/ai-wealth-dashboard/frontend/app/components/AccountsPage.tsx` (3380 lines: list view + detail view + all modals in one component)
- `/root/ai-wealth-dashboard/frontend/components/AccountLedgerRow.tsx`
- `/root/ai-wealth-dashboard/frontend/components/AccountMiniCard.tsx` (badge/brand + Home calm card)
- `/root/ai-wealth-dashboard/frontend/components/InvestmentMiniCard.tsx`
- `/root/ai-wealth-dashboard/frontend/lib/accountsEstate.ts` (grouping/dormant/attention)
- `/root/ai-wealth-dashboard/frontend/lib/accountKind.ts` (classifier)

Shared loader `loadAccounts()` (`AccountsPage.tsx:466-533`) fires five in parallel: `api.accounts()`, `api.getInvestmentAccounts()`, `api.manualAccounts()`, `api.manualAccountRules()`, `api.kpis()`.

---

### 2.1 Net-worth block

`AccountsPage.tsx:2270-2331`

**Shows** — "NET WORTH" + `kpis.net_worth` (2xl, **stays neutral ink even when negative** — Red Is Risk), masked to `••••••` when `hideNetWorth`. Sub-line: `−£{cardTotal} across cards · {N} bank · {M} investment · {K} offline`. `cardTotal` is computed **client-side** by summing `Math.abs(Math.min(balance,0))` over accounts whose type/subtype contains "credit" (`:2277-2286`). Eye/EyeOff toggle.

**Endpoints** — `GET /kpis` → `api.kpis()` (`lib/api.ts:1603`) → `KPIs { net_worth, cash, runway, investments, pensions, last_updated }`. Counts from `GET /accounts`, `GET /investment/accounts`, `GET /manual-accounts`.

**Note** — an explicit comment (`:2305-2309`) says **no month-over-month trend is shown** because `KPIs` carries only a point-in-time value with no history; `last_updated` is fetched but not rendered here.

**Can do** — hide/show balances (local preference, `usePreferences`).

**Questions**
- WHY: **why did my net worth change?** (No delta, no history, no explanation anywhere.)
- WHEN: as of when is this? Is it live or from this morning's sync? (`last_updated` unused.)
- WHAT: does net worth include my credit-card debt, my pension, my offline pots? (Offline accounts are excluded from `buildEstate` — `accountsEstate.ts` comment `:1154-1157` — but *are* counted in `kpis.net_worth` server-side. Two different totals coexist.)
- WHERE: which accounts add up to this number?
- WHAT: "£X across cards" — is that what I owe, or my limit?

---

### 2.2 "+ Add" menu

`AddMenuItem` `:34-50`, menu `:2334-2416`

**Shows** — one primary "+ Add" opening a menu. UK: Add Bank / Statement / Investment / Offline / **Finexer (beta)**. Kenya: Mono / Statement / Offline.

**Endpoints** — `GET /auth/truelayer/link?provider=` → `api.connectLink()` (`lib/api.ts:1644`) returns `{ auth_url }` → hard `window.location.href` redirect. `api.finexerConnectLink()` same pattern. `BankPickerSheet`, `StatementUpload`, `InvestmentUpload`, `MonoConnectWidget`.

**Questions**
- WHAT: what is "Finexer (beta)" and why would I pick it over "Add Bank"?
- WHAT: **what is an "Offline" account?** (Explained only further down the page: "Track balances we can't connect to: pots, cash, store cards.")
- HOW: how do I add an ISA / a pension? (Only via "Investment" → statement PDF upload — non-obvious.)
- WHERE: where does my data go when I connect? What consent am I giving?
- WHEN: how long does the connection last?

---

### 2.3 Find bar + lens chips

`:2607-2641`; logic `filterEstate` `accountsEstate.ts:141-166`

**Shows** — "Find an account…" (matches `name` or `provider`, case-insensitive) and chips: All / Current / Savings / Credit / Investment / **Owed**. "Owed" = **any row with `balance < 0`** — overdrafts included, and a credit card in credit excluded (`:155-160`). Filtering hides all group/attention/inactive structure and shows a flat "N results" list; the Offline section is hidden while filtering to avoid duplication (`:2831-2836`).

**Questions**
- WHAT: **what does "Owed" mean** — money I owe, or money owed to me? Why is my overdrawn current account in there?
- WHY: is my credit card missing from "Credit"? (Offline credit cards route via `MANUAL_KIND`, `:190-194`; a card with balance > 0 stays in Credit but leaves Owed.)
- WHERE: why did my offline pots vanish when I typed? (They didn't — they're merged into the filtered list only, via `manualEstateRows` `:1156-1175`.)

---

### 2.4 "Needs reconnecting" band (attention)

`:2670-2694`; derivation `needsAttention(a) = a.status === "expired"` (`accountKind.ts:65-67`)

**Shows** — amber-bordered card, AlertTriangle, "NEEDS RECONNECTING · N", rows with an inline "Reconnect" button. Prominent, not tucked away.

**Endpoint** — `Account.status` off `GET /accounts`.

**Can do** — Reconnect (`handleReconnect`, `:765-779`): stores `localStorage["reconnect_expected"] = {provider, account_number, sort_code}`, then `GET /auth/truelayer/link?provider=<provider_id>` → full-page redirect.

**Questions**
- WHY: **why does this need reconnecting?** (Copy says only "expired". The real cause — 90-day Open Banking consent — is never stated anywhere in the frontend.)
- WHEN: **when did it stop syncing? When will it expire again?** (No `expires_at`, no last-sync date anywhere on this surface.)
- WHAT: is the balance shown on this row still accurate, or frozen at expiry? (No staleness caption.)
- WHAT: did I lose transactions while it was expired?
- HOW: do I have to re-enter my bank login? Will it re-add the account as a duplicate?

---

### 2.5 Reconnect-mismatch warning

`:495-527` (validation), `:2534-2543` (banner)

**Shows** — red banner "Wrong account connected" + "We couldn't find your {provider} account ••••1234 in what was reconnected (found ••••5678). If this is wrong, remove it and reconnect again." Only fires when the provider returned ≥1 connected account and the expected last-4 isn't among them.

**Can do** — dismiss (×).

**Questions**
- WHAT: did I just connect the wrong bank account? What happens to the old one now?
- WHERE: which account is the new one — is my history split across two now?
- HOW: "remove it and reconnect" — remove *which*? Will removing delete my transaction history? (Yes: `handleDeleteAccount` confirm copy is "Remove this account **and all its transactions**?", `:783`.)

---

### 2.6 Pinned band

`:2696-2710`; `MAX_PINS = 3` (`:618`), `togglePin` `:626-640`

**Shows** — "PINNED" header + rows (amber filled star in `AccountLedgerRow:164`). Pinned rows that are `attention` or `dormant` are **excluded** from the pinned band (`accountsEstate.ts:113-118`) and appear in their bucket instead. Over-cap attempt shows an amber toast: "Home shows up to 3 pinned accounts, unpin one first." for 3.5s (`:627-632`).

**Endpoint** — `GET /preferences` / `PATCH` via `api.getPreferences()` / `api.updatePreferences({ home_pinned_accounts })`.

**Questions**
- WHAT: pinned to *where* — this page or Home? (Copy only reveals "Home" in the error toast and the aria-labels "Pin to Home".)
- WHY: I pinned my savings account and it disappeared from Pinned — why? (Silently demoted for being £0/dormant or expired.)
- WHY: only 3?

---

### 2.7 Collapsible groups + subtotals

`:2712-2765`; `GROUP_ORDER = ["Current","Savings","Credit","Investment"]`, `GROUP_LABELS` (`accountsEstate.ts:81-92`)

**Shows** — sticky headers "CURRENT · 3" with right-aligned subtotal (`−£X` / `£X`, whole units, masked when hidden) and a chevron. **Credit collapses by default when it has >4 accounts** (`:2717`). Collapse state persists in `localStorage["sorted:estate:collapsedGroups"]`, hydrated post-mount to avoid hydration mismatch (`:1183-1195`).

**Sort** — pinned first, then balance descending (`sortRows`, `accountsEstate.ts:96-99`).

**Questions**
- WHAT: is the Credit subtotal what I owe, or a net?
- WHY: is this account filed as "Current" when it's a savings pot? (Classification is substring-matching on `type`/`subtype`, `accountKind.ts:18-34`; the default fall-through is "Current".)
- WHY: does Investment here differ from the Investments drill-in? (Investment rows use `display_value ?? total_value`, `accountsEstate.ts:52`.)
- WHERE: does the subtotal include the offline pots I added? (No — `buildEstate` excludes manual accounts entirely.)

---

### 2.8 Account ledger row

`components/AccountLedgerRow.tsx:117-247`

**Shows** — `BankBadge` (logo, else brand-coloured initials), optional amber star, `row.name`, sub-line `{provider} · {accountKindLabel(kind)}`, right-aligned balance in the `money` class. Sign handling (`:139-144`):
- overdrawn (non-credit, balance < 0) → `−£X` + caption "overdrawn", rose ink
- credit card, balance < 0 → `£X` + caption "**owed**"
- credit card, balance > 0 → caption "**in credit**"
- dormant → whole row muted slate-400
- aria-label: `"{name}, £{balance} {caption}"`

**Questions**
- WHAT: **"owed" vs "in credit" vs "overdrawn"** — three different words for a negative-looking number.
- WHY: is my credit card showing a positive number without a minus sign?
- WHY: is this row greyed out? (Dormant, never explained inline.)
- WHERE: which of these is the account my salary lands in? (No "main account" marker.)
- WHEN: how fresh is this balance? (No per-row timestamp anywhere.)

---

### 2.9 Sparkline (investment rows) — **inert**

`MiniSparkline` `AccountLedgerRow.tsx:28-54`, gated at `:197`

**Shows** — a 52×20 polyline, `rgba(129,140,248,0.55)`, 1.3 stroke, `aria-hidden`. Renders only when a `sparkline: number[]` prop is passed **and** `kind === "Investment"`.

**Endpoint** — **none.** Prop doc `:106-108`: "Sparkline is OFF by default — no per-account balance-history series exists yet." `AccountsPage` never passes it. **This element cannot appear in production today.**

**Questions (if/when wired)**
- WHEN: what period does this cover?
- WHAT: is this balance, contributions, or market value?
- WHY: it's going down — is that the market or me withdrawing?
- WHERE: no axis, no scale — is a small wiggle £5 or £5,000? (`sparklinePoints` min/max-normalises each series independently, so two rows are not comparable.)

---

### 2.10 Utilisation bar (credit rows) — **inert**

`UtilisationBar` `AccountLedgerRow.tsx:60-78`, gated at `:175`

**Shows** — 1px rose track, fill at `clamp(0..100)`, deepening `rose-400/90` at ≥80%, caption `"{pct}% of £{limit}"`.

**Endpoint** — **none.** Prop doc `:102-104`: "Utilisation bar is OFF by default — no live credit-limit data source exists yet." Never passed by `AccountsPage`.

**Questions (if/when wired)**
- WHAT: **what is "utilisation" and why does it matter?** (Credit-score impact is never mentioned.)
- WHY: does 80% turn darker — is that bad?
- WHERE: where did the £limit come from — did the bank tell you, or did I?
- HOW: how do I get this down before my statement date?
- WHEN: does this reset on payment or on statement date?

---

### 2.11 Card-terms pill / "Add rates"

`AccountLedgerRow.tsx:211-243`; computed by `termsPillFor()` `AccountsPage.tsx:56-75`; wired by `estateTermsProps()` `:1230-1241`

**Shows** — only for `kind === "Credit"` bank rows. Filters out expired promos, sorts by soonest end:
- promo ending ≤60 days → **amber** `"0% ends 14 Mar"` (+ `· +N` for extra promos)
- promo ending >60 days → slate `"0% until Mar 2027"`
- no active promo, `apr_pct` present → slate `"24.9% APR"`
- confirmed card with nothing → indigo "**Add rates**" with a `%` icon

**Endpoint** — `GET` card terms via `api.getCardTerms()` → `{ cards: CardTermsCard[] }`, each with `terms.status` (`"confirmed"`), `terms.apr_pct`, `terms.promos[] { kind, apr_pct, until }` (`lib/api.ts:1229-1262`). Also `?cardTerms=1` (full walk) / `?cardTerms=<accountId>` (single card) deep links (`AccountsPage.tsx:2117-2133`).

**Can do** — tap pill → `CardTermsSheet` scoped to that card; "Add rates" → same sheet in capture mode.

**Questions**
- WHEN: **when exactly does my 0% end, and what rate do I pay the day after?** (Pill shows only the end date, never the reverting APR.)
- WHAT: what does "0% until Mar 2027" apply to — purchases, balance transfers, or both? (`CardPromoKind` carries this; the pill drops it.)
- WHY: is this amber? Is it urgent? (60-day threshold, unexplained.)
- WHERE: did this rate come from my bank or did I type it in? (Almost always the latter — `status: "confirmed"` means user-confirmed.)
- HOW: what should I do before it ends?
- WHAT: `· +2` — what are the other two promos?

---

### 2.12 "Inactive" (dormant) collapsed bucket

`:2767-2812`; rule `isDormant(a) = a.balance === 0 && !isCredit(a)` (`accountKind.ts:59-63`)

**Shows** — collapsed sticky header "INACTIVE · N", closed by default. Rows render muted, no reconnect affordance. Dedupe: accounts that are both expired and £0 appear **only** in Attention (`:1204-1208`).

**Questions**
- WHY: **why is this flagged inactive?** Nothing on screen explains "£0 balance". (A £0 credit card is deliberately *not* dormant — "paid off, not dormant" — but the user is never told that rule either.)
- WHAT: does "inactive" mean you stopped syncing it? Does it still count in my net worth? (It does — `netWorth` sums all rows, `accountsEstate.ts:111`.)
- WHY: my account has money in it and it's in here. (Only exact `=== 0` qualifies, so this shouldn't happen — but a stale/failed sync reading 0 would land here rather than in Attention.)
- HOW: how do I get it out of Inactive, or remove it entirely?

---

### 2.13 Offline accounts section

`:2831-2894`; modal `openAddManual` `:794-802` / `saveManual` `:816-…`; placeholder "e.g. Cash ISA, Wallet, Store card" (`:1348`)

**Shows** — "Offline accounts / Track balances we can't connect to: pots, cash, store cards. Tap to add transactions & rules." Rows: type icon, `name`, `{typeLabel} · Offline`, balance (rose + `-` prefix for `credit_card`, since `ManualAccount.balance` is stored positive and negated for display, `:1163`).

**Endpoints** — `GET /manual-accounts` (`api.manualAccounts`, `lib/api.ts:1980`), `POST`/`PATCH`/`DELETE` via `api.createManualAccount` / `updateManualAccount` / `deleteManualAccount`.

**Questions**
- WHEN: **when was this balance last right?** (`ManualAccount.updated_at` exists on the type and is **never rendered**.)
- HOW: how do I keep it up to date — do I have to remember?
- WHAT: does this count toward net worth? Toward Safe to Spend?
- WHERE: my Cash ISA is "offline" — is it the same thing as the ISA on the Tax page?

---

### 2.14 Offline-account rules (mirror rules)

Detail view "Rules" segment `:2153-2202`; builder `:1600-1750`ish; helpers `ruleValueFor` `:118-136`, `matchForPicked` `:161-175`, `isVolatileDescription` `:149-151`

**Shows** — "Auto-post matching transactions to this account." Rows: rule `name` (struck through when inactive), sub-line `Contains/Exactly/Category "value" · Offset|Shadow [· source account]`, an On/Off pill, edit and delete icons. Builder shows live match counts for both `contains` and `equals` against a cached transaction pool (`getAllTransactionsCached`), and explains widening (`widenedBecause: "volatile" | "too-long"`).

**Endpoints** — `GET /manual-account-rules` (`lib/api.ts:2013`), plus `api.createManualAccountRule` / `updateManualAccountRule` / `deleteManualAccountRule`.

**Questions**
- WHAT: **"Offset" vs "Shadow"** — completely opaque labels for `sign: "opposite" | "same"`.
- WHAT: "Contains" vs "Exactly" — which should I pick? Why did you change my choice? (Auto-widening on volatile descriptions.)
- WHERE: which account will these come *from*? (Optional `source_account_id`; "" = any account.)
- WHEN: does this apply to past transactions too? (`applies_from` / `ruleBackfill`.)
- HOW: how do I undo a rule that mis-fired across a year of history?

---

### 2.15 Account detail — header

`:2809-2001` region (`:1871-2000`)

**Shows** — back ("Accounts"), icon actions: Edit (offline only), Add statement (statement accounts only), Pin star (**hidden when expired**, `:1901`), Remove (rose Trash2). Then bank badge + `name`, then a 30px balance with sign-aware caption ("owed" / "in credit" / "overdrawn"), the card-terms pill/"Add rates", and finally `{kind} · {provider}`.

**Endpoints** — from the already-loaded `Account`; delete via `DELETE /accounts/{id}` (`lib/api.ts:1973-1978`) or `api.deleteManualAccount`.

**Questions**
- WHEN: **when was this balance last updated?** (Absent.)
- WHAT: is this the available balance or the ledger balance? Does it include pending?
- WHERE: what's my account number / sort code? (`Account.account_number` and `sort_code` exist on the type and are used **only** for the reconnect-mismatch check — never displayed.)
- HOW: how do I move money from here to another of my accounts? (**No transfer affordance exists on any account surface.**)
- WHY: why can't I pin an expired account?
- WHAT: does "Remove" delete my data or just disconnect? (Confirm copy: "Remove this account **and all its transactions**?")

---

### 2.16 Account detail — Reconnect banner

`:1935-1944`

**Shows** — full-width amber button "Reconnect", **only** when `status === "expired"`, and never for manual/statement accounts. Comment: "never a standing chip".

**Questions** — same as §2.4: WHY expired, WHEN it expires next, WHAT happened to the gap in transactions, HOW long it takes.

---

### 2.17 Account detail — Transactions tab

`:2070-2151`

**Shows** — debounced search (300ms, `:2027-2044`), category filter chip carrying its scope (`"{Category} · 90 days"` or `"· in · 90 days"`), `TransactionRow` list, page N/M with Prev/Next, and **horizontal swipe** to page (50px threshold, `:2098-2107`). Empty: `No transactions matching "{q}"`.

**Endpoint** — `GET /accounts/{id}/transactions?page=&q=&category=&days=&txn_type=` → `api.transactions()` (`lib/api.ts:1599`) → `PagedTransactions { items, pages }`. Manual accounts instead use `api.manualTransactions(accountId)`, fully client-paged.

**Can do** — search, page, tap a row → `TeachingSheet` (recategorise, propagate a rule).

**Questions**
- WHEN: how far back does this go? Why does it stop?
- WHY: is this filed as "Groceries" when it's my pharmacy?
- WHAT: why is a transfer to my own savings showing as spend? (`kind: "movement"` handling lives in Planning, not here.)
- WHERE: this shows on two accounts — is it double-counted?

---

### 2.18 Account detail — Categories tab

`renderCategoryRows` `:1829-1867`; sections `:2205-2243`

**Shows** — two direction-separated sections, both captioned "**last 90 days**": "Spending" (debit) and "Money in" (credit — card payments, refunds, incoming transfers). Rows: coloured category chip + icon, `name`, `{count} payments`, `£{total}` (2dp), chevron. Tapping sets `detailCatFilter` and jumps to the Transactions tab **scoped to the same 90-day window and direction** (comment `:688-693` — deliberately matched so the drill-in totals reconcile).

**Endpoint** — `GET /accounts/{id}/categories` and `?txn_type=credit` → `api.accountCategories()` (`lib/api.ts:1601-1602`) → `AccountCategorySummary[] { name, total, count, pct }`. **`pct` is fetched and never rendered.**

**Questions**
- WHEN: why 90 days? Can I see a different window? (Fixed, no control.)
- WHAT: "Money in" — is my salary in here? Is a refund income?
- WHY: does this total not match the Spend page? (Different window and per-account scope.)
- WHERE: which of these are recurring vs one-off?

---

### 2.19 Investments drill-in

`:2898-3355`

**Shows** — per account: `{provider} {account_type}`, `account_reference`, "updated {refreshDate}", `display_value ?? total_value`, "no statement yet" chip when provisional. Expanded: 30px value, `Investment · {provider} · updated {updated_at}` and a **provenance line** with four branches (`:2929-2962`):
- provisional → "No statement yet: running total of your contract notes, from £0."
- refreshed after statement + notes → `Prices refreshed {d} · ±£{addedSince} since {stmtDate} statement · {N} notes`
- refreshed after statement, no notes → `Prices refreshed {d} · statement {d}`
- no refresh → `Valued £{displayValue − addedSince} on {stmtDate} · ±£{addedSince} added/net trades since ({N} contract notes)`

Plus a collapsed "**How this stays current**" ⓘ explainer (`:3117-3130`): "A statement sets the account's value. Contract notes add each buy or sell on top until the next statement arrives… Notes dated before your latest statement won't add: that value is already counted, and duplicates are rejected."

Contract-notes list (last 6, "Show all N"), sale rows marked "sold" and rose-signed, and `"{N} earlier notes folded into your {stmtDate} statement"`. Holdings: `name`, `isin`, type, `{units} units`, "**Live** £X / unit" in emerald when `current_price !== null` else slate, and `current_value ?? statement_value`.

**Endpoints** — `GET /investment/accounts` (`api.getInvestmentAccounts`), `/investment/accounts/{id}/holdings` (`lib/api.ts:2159`), `/notes` (`:2180`), `POST .../refresh` (`:2168`), `POST .../notes/upload` (`:2190`), `api.uploadInvestmentNoteColdStart`, `DELETE` account/note.

**Can do** — expand, pin to Home, refresh prices, remove, upload statement, add contract note (with PDF password field), delete a note (two-step confirm), cold-start "Add contract note" to create an account from £0.

**Questions**
- WHAT: **why are there three different dates** (statement date, updated, prices refreshed) and which one is "now"?
- WHY: my value went up but I didn't buy anything — is that the market or a re-upload?
- WHAT: does "Live £X / unit" mean live now, or live as of the last refresh?
- WHEN: how often do prices refresh on their own? Do I have to press the button?
- WHY: my contract note didn't add anything. (Only explained inside the collapsed ⓘ — "notes dated before your latest statement won't add".)
- WHERE: is this my ISA? Is this the pension the Tax page keeps mentioning? (`account_type` is free text off the statement.)
- HOW: is this a real-time valuation I could sell at?

---

### 2.20 Sync / empty / loading states

`:2523-2532` "Syncing your bank accounts…" (polls `api.accounts()` every 3s while `?syncing=1`, `:576-588`); `:2547-2600` "No banks connected"; `:2913-2933` "No investment accounts / Upload a quarterly statement from Vanguard, Wealthify, Hargreaves Lansdown, Fidelity, or AJ Bell."

**Questions** — WHEN will syncing finish? WHY is it taking so long? WHAT if my provider isn't in that list? HOW far back will it import?

---

### 2.21 Home account grid (`AccountMiniCard`, calm variant)

`components/AccountMiniCard.tsx:341-…`; Home wiring `app/components/HomePage.tsx:271-296, 515+`

**Shows** — 13rem card: brand chip, 2-line name, `{bank} · {kind}` with `kind` in `ACCOUNT_KIND_COLOUR` (Current #60a5fa / Savings #fbbf24 / **ISA #34d399** / Credit #f87171 / Offline #94a3b8), 2xl balance (neutral even when negative), sign-aware caption, card-terms pill at `mt-auto`. Top picks = expired first, then pinned; rest behind "+N more".

**Note** — `typeLabel()` here (`:286-293`) is a **third, subtly different classifier** from `lib/accountKind.ts` and `accountsEstate.ts`: it has an `ISA` bucket the estate does not, and it doesn't check `type.includes("saving")` (only `sub`).

**Questions**
- WHY: is my savings account labelled "Current" on Accounts but "Savings" on Home? (Different classifiers.)
- WHAT: does the coloured word mean?
- WHERE: which accounts are hidden behind "+N more"?

---

### 2.22 Home reauth banners

`app/components/HomePage.tsx:454-471`, providers derived `:291-300`

**Shows** — one amber banner **per provider**: "{provider} needs reconnecting" / "Transactions have stopped syncing." + amber "Reconnect" button. First banner gets a `needs-you` attention class when `attn === "reconnect"`.

**Questions**
- WHEN: **stopped syncing when?** What am I missing?
- WHY: this happened last month too — why does it keep happening?
- WHAT: are my Safe to Spend / bills wrong right now because of this?
- HOW: how long does reconnecting take, and do I have to do all my banks?

---

### 2.23 Settings — "Where money can come from"

`app/settings/SettingsPage.tsx:730-782`

**Shows** — collapsed row with summary "Any of your N accounts" or "M of N accounts". Body: "By default Penny can move from any of your accounts. Turn one off and it will never be suggested." Then per-account rows with `BankBadge`, name, `provider` or "Offline account", and a toggle (`aria-label: "Allow transfers from {name}"`).

**Questions**
- WHAT: **"move from" — does the app actually move my money?** (It suggests; the toggle wording implies more.)
- WHERE: which accounts are excluded right now, and what did that change?
- WHY: is my savings account suggested for bills?
- HOW: does turning one off change my Safe to Spend?

---

## PART 3 — MIRROR / BEHAVIOUR SCREENS

Files:
- `/root/ai-wealth-dashboard/frontend/app/mirror/page.tsx` → `MirrorPage.tsx` (342 lines)
- `/root/ai-wealth-dashboard/frontend/components/AimSheet.tsx`
- `/root/ai-wealth-dashboard/frontend/app/penny/PennyPage.tsx:288-305` (entry card)
- `/root/ai-wealth-dashboard/frontend/lib/pennyScreenConfig.tsx:130, 250` (nav links)

---

### 3.1 Mirror header + window caption

`MirrorPage.tsx:220-239`

**Shows** — eyebrow "THE MIRROR", h1 "**How your money behaves**", Penny mark chip, and: "Computed from your last **{Math.round(window_days/30)} months** of transactions. No judgement, just what the data says." (falls back to "6 months" pre-load).

**Endpoint** — `GET /mirror` (`?refresh=1` on recompute) → `api.getMirror()` (`lib/api.ts:1612-1613`) → `MirrorPortrait` = `{ status: "insufficient_data" }` | `{ status: "ok", computed_at, window_days, traits[] }`.

**Note** — `computed_at` is in the payload and **never rendered**.

**Questions**
- WHAT: **what is "the Mirror"?** What am I looking at?
- WHEN: when was this computed? (`computed_at` unused — the only temporal cue is "last N months".)
- WHY: "no judgement" — is something here judging me?
- WHERE: does this cover all my accounts, or only connected ones?
- WHAT: does this leave my device / go to an AI?

---

### 3.2 "What you're working on" — active aims

`MirrorPage.tsx:255-286`

**Shows** — eyebrow "WHAT YOU'RE WORKING ON", then per aim: `aim.ref` (the category name), `£{spent_so_far} of your £{aim_amount} aim · {days_left} days left` (with "last day" at ≤0 and "1 day left" at 1), and a quiet "Cancel this aim".

**Endpoints** — `GET /checkpoints` → `api.listCheckpoints()` (`lib/api.ts:2451`) → `{ checkpoints: ActiveAim[] }` where `ActiveAim = Checkpoint & { ref: string }`, `Checkpoint = { id, aim_amount, spent_so_far, days_left, on_track }`. Cancel: `DELETE /checkpoints/{id}` (`:2452-2456`).

**Note** — `on_track` is in the payload and **never rendered** on this screen.

**Questions**
- WHAT: **what is an "aim"** — a budget, a goal, a promise?
- WHERE: does "£280 of your £320 aim" come from the same numbers as my Spend page? Which transactions count?
- WHY: am I over already — what pushed me over? (No breakdown, no `on_track` signal.)
- WHEN: "{N} days left" until when — payday, month end, a fixed window? (`days_left` is opaque.)
- HOW: how do I change the amount? (Only cancel and re-set via a trait.)
- WHAT: what happens when it ends — do you tell me? Does it roll over?

---

### 3.3 Trait card — title + narrative + evidence

`TraitCard` `MirrorPage.tsx:31-132`, body `:62-74`

**Shows** — bold `trait.title` (often "Your Signature: {Category}"), `trait.narrative` prose, then `trait.evidence[]` as muted lines.

**Endpoint** — `MirrorTrait { id, title, narrative, evidence[], kind, choice, ref_category? }` off `GET /mirror`.

**Note** — `trait.kind` (`structure` | `habit` | `pleasure` | `hygiene`) has a full `KIND_ACCENT` colour map at `:14-19` (indigo / emerald / violet / slate) that is **computed into `accent` at `:37` and never applied** — the kind is invisible in the UI.

**Questions**
- WHAT: **what does "Your Signature: Eating Out" mean?** Is that good or bad?
- WHAT: what are "structure", "habit", "pleasure", "hygiene"? (Currently invisible — but they'd be the next question the moment the accent map is wired up.)
- WHY: **why did you decide this about me?** The evidence lines are prose, not linked figures.
- WHERE: which transactions is this based on? (No drill-through from evidence to transactions.)
- WHY: this was true in January but not now — is it stale?
- WHAT: does this affect anything — my Safe to Spend, my insights, what Penny says?

---

### 3.4 Trait card — "This is me, keep it" / "This isn't me, change it"

`MirrorPage.tsx:77-100`, handler `handleChoice` `:41-57`

**Shows** — two equal buttons; selected state indigo (keep) or amber (change). Optimistic — errors are swallowed (`:52-55`).

**Endpoint** — `POST /mirror/choice` `{ trait_id, choice }` → `api.setMirrorChoice()` (`lib/api.ts:1614-1615`).

**Side effect** — picking "change" on a **category-backed** trait with no existing aim auto-opens `AimSheet` (`:49-51`). Category resolution: `trait.ref_category`, falling back to regex-parsing `"Your Signature: (.+)"` from the title (`traitCategory` `:25-29`).

**Confirmation copy** (`:103-129`):
- keep → "Noted, we'll never nag you about this."
- change + aim exists → "Aim set, Penny is tracking it with you."
- change + category, no aim → "Noted, an aim gives Penny something to track. **Set an aim**"
- change, no category → "Noted, Penny will factor this in."

**Questions**
- WHAT: **what does "keep it" actually do?** ("We'll never nag you about this" — nag me where? Which notifications stop?)
- WHAT: does "change it" change my behaviour or just your description of it?
- WHY: why did a sheet asking for a number just open when I said "this isn't me"?
- HOW: how do I undo a choice? (Tapping the same button is a no-op, `:42`.)
- WHAT: "Penny will factor this in" — factor it into what?
- WHY: does one trait get an aim offer and another just says "noted"? (`ref_category` presence, invisible to the user.)

---

### 3.5 Recompute button

`MirrorPage.tsx:242-251`

**Shows** — "Recompute" / "Recomputing…" with spinner, only when `portrait.status === "ok"`.

**Endpoint** — `GET /mirror?refresh=1`.

**Questions**
- WHAT: what changes when I recompute? Will my saved keep/change choices survive?
- WHY: didn't anything change?
- WHEN: does this happen automatically? How often?

---

### 3.6 Insufficient-data / no-traits states

`:293-310`

**Shows** —
- `insufficient_data` (or fetch failure — both map to the same branch, `:293`): "Not enough data yet / The Mirror needs at least **60 days** of transactions to compute your behavioural portrait. Check back after a couple of months of connected banking."
- traits empty: "No distinct patterns detected yet, check back after more transactions have been synced."

**Questions**
- WHEN: **how many more days?** (Threshold stated, progress not.)
- WHY: I've been connected for six months — why does it say not enough? (A failed fetch renders identically to genuine insufficiency — misleading.)
- WHAT: does "connected banking" mean my statement uploads don't count?

---

### 3.7 AimSheet (checkpoint creation)

`components/AimSheet.tsx`

**Shows** — "Set an aim for {category}", a prefilled amount derived from the category's own baseline: `suggested_aim` if the backend supplies one, else `roundTo5(usual × 0.93)` where `usual = usual_rate_per_day × periodDays` (`:53-62`). Empty input is allowed — the backend derives it. Success: "Aim set, Penny will track it with you."

**Endpoints** — `GET /spend/category-signals?offset=0` → `api.categorySignals()` (`lib/api.ts:1606`) → `CategorySignals { period{start,end,days_elapsed,days_left,offset,closed}, signals: Record<category, CategorySignal> }`. Save: `POST /checkpoints` `{ ref, aim_amount? }` → `api.createCheckpoint()` (`lib/api.ts:2449-2450`).

**Questions**
- WHY: **where did this suggested number come from?** (93% of usual — never stated.)
- WHAT: is "usual" my average, my median, this year, last 90 days?
- WHEN: is this per week, per month, per pay period? (The sheet never names the window; `period.days_elapsed + days_left` is used silently.)
- WHAT: happens if I go over — do you block anything, or just tell me?
- HOW: what if I want to aim for zero, or for a percentage cut?

---

### 3.8 Mirror entry card (Penny screen)

`app/penny/PennyPage.tsx:288-305`, headline fetch `:87-92`

**Shows** — `ScanFace` chip, "**How your money behaves**", and a live one-line subtitle = `portrait.traits[0].title` with the `"Your Signature: "` prefix stripped; falls back to "Your money's rhythm, patterns and habits, reflected back."

**Endpoint** — `GET /mirror` (no refresh) — the same call the Mirror page makes.

**Questions**
- WHAT: "**rhythm, patterns and habits**" — what will I actually see?
- WHY: does this headline show one category name — is that my biggest problem?

---

## PART 4 — SUBSCRIPTIONS / COMMITMENTS / RECURRING

The app has no dedicated "Subscriptions" screen. Recurring money lives in three places: **upcoming bills** (Planning + Home strip), **commitments/goals** (Planning), and the insight-side **unknown/labelled bills** (§1.16–1.17).

---

### 4.1 Home "Coming up · 14 days" strip

`components/UpcomingBillsStrip.tsx`; shared logic `lib/comingUp.tsx`

**Shows** — eyebrow "Coming up · 14 days", a `DropSentence` headline (`comingUp.tsx:443`), and a footer: amber dot when something is due today + `"{N} bills · £{total} total"` + optionally `"· £{X} moving between your accounts"`.

**Critical rule** — the headline/total describe **spend only**. `isSpend(bill) = bill.kind !== "movement"` (`comingUp.tsx:37-39`) — transfers/savings/investment STOs are excluded from the count and total and mentioned only as a plain, uncoloured addendum, so a balance-conscious user can still reconcile against their actual balance drop (`UpcomingBillsStrip.tsx:127-135`). Income is deliberately never mixed in (`:97-104`).

**Endpoint** — `GET /cashflow` → `api.cashflow()` (`lib/api.ts:1610`) → `CashflowData.upcoming_bills: UpcomingBill[]`. Client filters `days_away < 14`.

**Can do** — tap → `/planning?day=<iso>` targeting today's bill if any, else the heaviest day (`computeHeadsUp`, `comingUp.tsx:95-110`).

**Questions**
- WHERE: **which accounts do these bills come out of?** (`account_name`/`account_bank` exist on `UpcomingBill` and are not shown on this card.)
- WHAT: "£X moving between your accounts" — is that money I'm losing or not?
- WHY: does the total not match what actually left my account? (Movements excluded by design.)
- WHEN: are these dates confirmed, or predicted? (`pending`, `original_date`, `edited` all exist and are invisible here.)
- WHAT: are these subscriptions, or all bills?

---

### 4.2 Planning — upcoming bill/income row (the de-facto subscription row)

`app/planning/PlanningPage.tsx:1302-1530`

**Shows** — per row: category icon chip (or AlertTriangle/AlertCircle when at risk), `item.name`, `planned` / `edited` chips, then a stack of conditional sub-lines:
- `account_short` → rose: `"{bank} · only £{account_balance} available"`
- `account_timing` → slate + amber dot: `"{bank} · money's due in around now"`
- `at_risk` → rose: `"Overall balance will be low"`
- movement culprit → `"Includes a £{X} move {date}"` (rose when genuine, slate+amber dot when timing)
- `movementCalm` → `"May not go through if the balance is tight. No fee either way."`
- plain case → muted `{account_bank || account_name}`
- date line (`formatItemDate`), muted one step further for next-period rows
- pending ≥5 days past due → `"Expected {date}, we haven't seen it leave. Worth checking with them."` or, for `category === "Debt"`, `"A missed card payment can mean fees, so worth checking today."` + a "Dismiss for this month" link

Right column: `−£{amount}` (or `+£` emerald for income) and a running-balance rail `"£{balance_after} left"` — replaced by `"stays in your accounts"` for a pooled no-op transfer (`isPooledNoOp`, `:38-40`).

**Endpoint** — `GET /cashflow` (`upcoming_bills` + `upcoming_income`); risk flags derived client-side against a conservative/optimistic double walk.

**Can do**
- Tap → `UpcomingEditSheet` (`components/UpcomingEditSheet.tsx`) — change **date** and **amount**, scope "this one" vs "all future" (`api.editUpcoming`, `lib/api.ts:1623-1624`); revert (`api.clearUpcomingOverride`); "skip this occurrence" (`api.skipUpcomingOccurrence`, `:1621`); and a **Repeats** section that takes free text, previews a schedule (`api.previewUpcomingRule` → `{ schedule, label, next_dates[] }`), applies it (`api.applyUpcomingRule`), or clears it (`api.clearUpcomingRule`).
- **Left-swipe → "Not recurring"** (`SwipeDismissRow`, `:1915-1960`; 40% width or a <250ms flick past −60px) → `POST /cashflow/dismiss-recurring` (`api.dismissRecurring`, `lib/api.ts:1620`), with an undo path via `api.restoreRecurring` (`:1622`, `PlanningPage.tsx:1030`).
- Planned one-offs swipe to "Delete" instead.
- "Dismiss for this month" on a stale pending bill.

**Questions**
- WHERE: **which account does this bill from?** (Shown, but only as a bank/account name in a sub-line that is suppressed in several branches.)
- WHAT: **"Not recurring"** — does swiping cancel the subscription, or just hide the prediction? (High-stakes ambiguity on a destructive-looking rose swipe background.)
- WHAT: "edited" / "planned" chips — who edited it?
- WHY: did this bill move to a different date? (`original_date` vs `expected_date`.)
- WHY: is this row amber and that one red? ("money's due in around now" vs "only £X available" — the genuine/timing split.)
- WHEN: **when does this renew / when is the next one after this?** (No "next occurrence" or "renews every N" is ever shown on the row — only a single date. `rule_label` exists and is passed to the sheet but not rendered on the row.)
- WHY: "we haven't seen it leave" — did they take it or not?
- HOW: how do I cancel this subscription? (Nothing anywhere offers cancellation; the only path is the insight card's external comparison links.)
- WHAT: "stays in your accounts" — so did this £X leave or not?

---

### 4.3 Planning — Commitments block (goals/plans)

`PlanningPage.tsx:282-437`

**Shows** — per active commitment: `name`, target month, progress bar (indigo when `on_track`, amber otherwise), `£{progress} of £{amount}`, `£{per_period_slice} each pay period ({period_label}) · {periods_left} left` (or "a period" when `period_label` is null), optional `"Shares a pot with {names}"`, a `pace_note` amber line with a "See where ›" link to `/spend`, and a feasibility line with a dot (slate for `surplus`/`funded`, amber for `savings`/`stretch`). The feasibility line is **suppressed** when `pace_note` is present and the tone is caution — "one loud thing, not two stacked" (`:388-391`).

**Endpoint** — `GET /commitments` → `api.listCommitments()` (`lib/api.ts:1737`) → `{ items: Commitment[] }`. Create/preview: `POST /commitments`, `POST /commitments/preview` (`:1747, :1773`) → `CommitmentPreview` with `pots_detail[]` and a soft `CommitmentConsent` gate.

**Can do** — tap → `CommitmentSheet` (edit); "+ Plan a big expense".

**Questions**
- WHAT: **"Shares a pot with X"** — is my money being counted twice? (Rule buried in the type doc: "a pound is claimed by only the oldest goal", `lib/api.ts:614-616`.)
- WHERE: **which account holds this progress?** (`funding_pots[]` with `contributing_balance` and `count_existing` exist on the type; the card shows none of it.)
- WHAT: `count_existing` — does my existing balance count toward this, or only new money?
- WHY: is this "stretch"? What would make it not stretch?
- WHY: is there an amber dot on a plan I'm on track for? (`savings` feasibility = "likely dips into savings".)
- WHEN: "{N} left" — periods, weeks, months? (Only qualified when `period_label` is non-null.)
- HOW: how do I actually move the money each period — is this automatic?

---

### 4.4 Planning — bill-row insight hint

`PlanningPage.tsx:1449-1462`, matcher `:490-514`

**Shows** — on a bill row, a small indigo link: `"could save ~£{est} ›"` or just `"could save ›"`.

**Endpoint** — `GET /savings-insights`; `est` is the **first number regex-extracted** from `insight.savings_estimate` (`/([\d][\d,]*)/`, `:493`). Matching is fuzzy substring both ways between the bill name and `triggered_by[].display_name`/`merchant_key`, with a ≥4-char guard (`:498-503, :509-513`).

**Can do** — tap → `/insights?tab=save&insight=<id>` (deep-link + ring highlight, §1.15).

**Questions**
- WHAT: "could save ~£83" — per month or per year? (`savings_estimate` is free-form text; only its first number survives.)
- WHY: is this on the wrong bill? (Loose substring matching can cross-link merchants.)
- WHY: does this number appear here but nowhere on the insight card itself? (Deliberate — §1.6.)
- HOW: save it how?

---

### 4.5 Settings — "Notify me about"

`app/settings/SettingsPage.tsx:680-706`

**Shows** — eight toggles, each a money fact in miniature:

| key | title | description |
|---|---|---|
| `insights` | Tips & insights | "Ways to save money we spot for you" |
| `budget_alerts` | Budget alerts | "When you go over a budget category" |
| `category_pace` | Category running hot | "When a category is well above your usual pace" |
| `classification_attention` | Payments needing a look | "Unplaced or possibly miscategorised payments" |
| `bill_alerts` | Bill alerts | "When an upcoming bill may not clear" |
| `goal_milestones` | Goal milestones | "When you reach a savings goal" |
| `period_digest` | Pay-period digest | "A fresh-start goals summary each new pay period" |
| `transactions` | New transactions | "Each time new transactions arrive" |

**Endpoint** — `NotificationPrefs` (`lib/api.ts:50-60`) via `api.getNotificationPrefs` / `api.updateNotificationPrefs`.

**Questions**
- WHAT: **"when an upcoming bill may not clear"** — will you tell me *which* bill and *which* account?
- WHAT: "well above your usual pace" — what's my usual? Who decides "well above"?
- WHAT: "unplaced or possibly miscategorised" — did the app get something wrong, or did I?
- WHEN: how much notice do bill alerts give — the day before, the morning of?
- WHERE: do these go to my phone or my email?
- WHY: I turned these on and never get any.

---

### 4.6 Settings — push permission states

`SettingsPage.tsx:569-680`

**Shows** — native-granted ("Delivered by your phone. Manage in your phone's Settings."), native-denied / web-denied ("To receive **transaction alerts**, allow notifications for this site…"), native-prompt ("Turn on notifications"), unsupported, checking, plus a "Send a test notification" button (native-granted only) and an **amber** (never red) error row.

**Endpoints** — `GET /push/vapid-public-key` (`lib/api.ts:2316`), `POST /push/subscribe` (`:2318`), `api.getNativePushStatus`, `api.sendTestPush` → `TestPushResult`, `PushDeliveryStatsWithConfig`.

**Questions**
- WHAT: what will you actually send me — will a notification show my balance on my lock screen?
- WHY: notifications are on but I never see any. (The `PushDeliveryStats { attempted, delivered, failed, pruned }` type exists and has no UI here.)
- HOW: how do I unblock them?

---

## Cross-cutting gaps (question-generating by absence)

1. **No account is ever named on an insight.** `SavingsInsight.triggered_by` carries `merchant_key`/`display_name` only — no `account_id`. Every "where does this bill from" question is unanswerable in-product.
2. **No balance history, anywhere.** `KPIs` is point-in-time (comment at `AccountsPage.tsx:2305-2309` says as much); the sparkline is inert; no per-account "last updated". Every "why did my balance change / when did it change" question is structurally unanswerable.
3. **No consent-expiry model in the frontend.** The only expiry signal is `Account.status === "expired"`, surfaced *after* the fact. No countdown, no expiry date, no 90-day explanation, no "reconnect before X".
4. **No money-movement affordance.** Settings says "Penny can move from any of your accounts", but no account, commitment, or aim surface offers a transfer action. "How do I move money between my own accounts" has no answer.
5. **Three competing account classifiers** — `lib/accountKind.ts` (5 kinds, no ISA), `components/AccountMiniCard.tsx:286-293` (5 kinds, *with* ISA, different savings test), and `components/InvestmentMiniCard.tsx:34`. Same account can be labelled differently on Home vs Accounts.
6. **Fetched-but-unrendered fields** (each a latent question the payload can already answer): `SavingsInsight.icon`, `.savings_estimate` (on-card), `.deadline_at`; `MirrorPortrait.computed_at`; `MirrorTrait.kind` (accent map computed, unused); `Checkpoint.on_track`; `ValueDelivered.breakdown[]`; `AccountCategorySummary.pct`; `KPIs.last_updated`; `ManualAccount.updated_at`; `Account.account_number`/`sort_code`; `UpcomingBill.rule_label` (on the row); `PushDeliveryStats`.
7. **Dead-end Pro lock** — the 402 panel (`InsightsPage.tsx:1029-1052`) has no upgrade button.
8. **Failure renders as insufficiency** — `MirrorPage.tsx:293` collapses a caught fetch error and a genuine `insufficient_data` into the same "Not enough data yet / needs 60 days" copy.
