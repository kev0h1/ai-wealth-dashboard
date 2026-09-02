# Question inventory: Home + Penny sheet
Captured 2026-08-27 from the live components. Source of truth for Penny tool coverage of these surfaces.

# User-Question Inventory — HOME screen and PENNY sheet (Sorted / Penny)

Source files traced: `app/components/HomePage.tsx`, `components/HomeBrief.tsx`, `components/PaydayPlanCard.tsx`, `components/SafeToSpendCard.tsx`, `components/UpcomingBillsStrip.tsx` (+ `lib/comingUp.tsx`), `components/ThisMonthStrip.tsx`, `components/HomeInsightSpotlight.tsx`, `components/ValueDeliveredStat.tsx`, `components/AccountLedgerRow.tsx`, `components/TransactionRow.tsx`, `components/PennySheet.tsx`, `components/PennyConversation.tsx`, `lib/pennyScreenConfig.tsx`, `lib/api.ts`, `lib/attention.ts`, `lib/paydayWindow.ts`, `lib/useHomePinnedCards.ts`.

---

# PART A — HOME SCREEN

## A0. Home data-load contract (context for every element below)

`HomePage.loadData()` fires in parallel (`app/components/HomePage.tsx:89-164`):

| Call | Endpoint | Feeds |
|---|---|---|
| `api.accounts()` | `GET /accounts` | Your estate rows, reauth banners, fresh-user detection |
| `api.getInvestmentAccounts()` | `GET /investment/accounts` | Estate investment row, +N more count |
| `api.safeToSpend()` | `GET /safe-to-spend` | Safe-to-Spend card, brief fallback copy, payday window |
| `api.getToday()` | `GET /today` | The Brief (companion items), payday plan card |
| `api.getNeedleSummary()` | `GET /needle/summary` | Last-month strip, `card_delta_so_far` fallback |
| `api.transactionsSearch({page:1,page_size:12})` | `GET /transactions/search` | Recent Transactions (over-fetch 12, show 6) |
| `api.getPreferences()` | `GET /preferences` | `home_pinned_accounts`, `home_pinned_cards`, `home_pinned_widget` |
| `api.allTransactions(90)` | `GET /transactions?days=90` | Pinned chart widget ONLY (lazy, gated on `homePinnedWidget`) |
| `api.syncAll()` | `POST /accounts/sync` | Refresh button |
| `api.cashflow()` | `GET /cashflow` | Upcoming bills strip (own fetch) |
| `api.getSpotlightInsight()` | `GET /savings-insights/spotlight` | Insight spotlight (own fetch) |
| `api.valueDelivered()` | `GET /value-delivered` | Potential/verified savings row (own fetch) |

---

## A1. Greeting header (`HomeBrief.tsx:1320-1348`)

**Shows** — avatar initials (from `useAuth().user.name`), time-aware greeting ("Good morning, {firstName}"; hydration-safe fallback "Hi, {name}" / "there"), a sync (RefreshCw) button. Desktop: a sticky "Hi, {firstName}" bar once the greeting scrolls out.

**Endpoint** — `user` from AuthProvider (`/auth/me`-class); no money data.

**Can do** — tap avatar → `/settings` (mobile only, `lg:hidden`); tap refresh → `api.syncAll()` then full `loadData()`.

| Bucket | Questions |
|---|---|
| WHERE | — |
| WHAT | Why does it call me by that name / where did my name come from? What does the circular arrow do — does it move money? Is "sync" the same as refreshing the page? |
| WHY | Why is my greeting stale/wrong (timezone)? Why do my initials show "??" |
| HOW | How do I change my name/photo? How do I get to settings on desktop? |
| WHEN | When did it last sync automatically? How often does it sync on its own? Do I need to press this every day? |

## A2. Sync-error banner (`HomeBrief.tsx:94-101`, glow via `attention.ts`)

**Shows** — "Sync didn't complete, try again in a moment." amber, `role="alert"`, auto-clears after 6s (`HomePage.tsx:221`). May carry the `needs-you` glow when `attn === "sync"`.

**Endpoint** — failure of `POST /accounts/sync`.

**Can do** — retry via the refresh button; it self-dismisses.

| Bucket | Questions |
|---|---|
| WHERE | Are my newest transactions missing right now because of this? |
| WHAT | What failed — my bank, the app, my connection? Is my data wrong while this shows? |
| WHY | Why does sync fail? Is one bank the problem or all of them? |
| HOW | How do I make it sync? Do I need to reconnect a bank? Who do I contact? |
| WHEN | When was the last successful sync? When will it retry? |

## A3. THE BRIEF — companion items (`HomeBrief.BriefBody`, `GET /today` → `CompanionItem[]`)

Items are bucketed by `type` and rendered by distinct card components. Every card except the payday ask supports Home-only dismissal (localStorage, 7-day expiry, `lib/homeDismissedAdvice.ts`) — the ✕ is labelled "Hide on Home".

### A3.0 Empty-brief fallback paragraph (`HomeBrief.tsx:1064-1088`)
**Shows** — one of five sentences chosen from `safeToSpend.state` / `days_until_payday` / `short_reason`:
- "Nothing needs you today. I'm keeping an eye on the bills, just check back later." (insufficient data)
- "…Your pay period ends in a couple of days. The first week's bills are already mapped, so just cruise." (tight, ≤3 days)
- "…Cash is tight for the rest of this pay period, but the bills are mapped. I'll flag anything that needs you." (tight)
- "Nothing new needs you. The one thing worth a look is the card spending this period, shown in Safe to Spend below." (short/cards)
- "Nothing new needs you. You're short this pay period, the gap is shown in Safe to Spend below." (short/bills)
- "…You've got headroom, and I'm watching the bills, enjoy it." (comfortable)

| Bucket | Questions |
|---|---|
| WHERE | If nothing needs me, where did this period's money actually go? |
| WHAT | What does "the bills are mapped" mean? What counts as something that "needs me"? What's the difference between "nothing needs you" and "nothing new needs you"? |
| WHY | Why is it saying I'm fine when I feel broke? Why "tight" and not "short"? |
| HOW | How do I make it tell me more? How do I get advice instead of reassurance? |
| WHEN | When will it flag something? When does "the rest of this pay period" end? |

### A3.1 `celebration` → CelebrationCard (`HomeBrief.tsx:321-381`)
**Shows** — SettleMark (emerald) + `item.headline` ("Sorted: X is covered") + optional `item.body`. Whole card is tappable → `/planning`. ✕ = Hide on Home.
**Endpoint** — `/today` items where `type === "celebration"`.

| Bucket | Questions |
|---|---|
| WHERE | Which money is covering it — which account? Where does that money come from? |
| WHAT | What does "Sorted"/"covered" actually guarantee? Is this a prediction or a fact? Does "covered" mean paid? |
| WHY | Why is this one worth celebrating and not the others? |
| HOW | How do I keep it covered? What if I spend the money it's counting on? |
| WHEN | When is it actually paid? Until when is it covered? |

### A3.2 `cliff` and `trajectory` → CliffCard (`HomeBrief.tsx:399-451`)
**Shows** — amber AlertTriangle (cliff) / TrendingDown (trajectory), `headline`, `body`, optional CTA button `item.action.label` → `item.action.route`. ✕ = Hide on Home. Payload-less `rhythm` items render here too.
**Endpoint** — `/today` items.

| Bucket | Questions |
|---|---|
| WHERE | Which bill/merchant is this? Which account will it hit? |
| WHAT | What is a "cliff"? What's a "trajectory"? Does amber mean I'm in trouble? What's a promo rate ending? |
| WHY | Why did the price go up / why is my balance heading there? How confident is this projection? What's driving it? |
| HOW | How do I avoid the cliff — switch, cancel, pay down? What happens if I ignore it? |
| WHEN | When exactly does the cliff hit? When will the trajectory land? How long do I have to act? |

### A3.3 `rhythm` (with `payload.multiple >= 1.5`) → RhythmCard (`HomeBrief.tsx:734-902`)
**Shows** — category icon chip (user colour override), headline either `"£X in {category}, way above your usual"` (multiple ≥ 20) or `"{Category} ran {N.N}× your usual"`; one support line: `"One payment: {name}, {date}."` / `"Mostly one payment: {name}, £X on {date}."` / `"£X so far this period."`. Buttons: **"A one-off"** / **"My new normal"** (`POST /trends/intent` via `api.recordTrendIntent`), confirming to "Noted, one-off."/"Noted, new normal."; ghost row **"See the payments"** → sets `sessionStorage.wealth_open_category` → `/spend`. ✕ = Hide on Home.
**Endpoint fields** — `payload.category`, `payload.multiple`, `payload.spent`, `payload.dominant{name,amount,date}`.

| Bucket | Questions |
|---|---|
| WHERE | Where did the £X go — show me the actual transactions. Which merchant dominated it? Which account paid? |
| WHAT | What is "your usual" — an average of what, over how long? What does "3.2×" mean in pounds? What happens if I say "new normal" — does my budget change? What does it do with "one-off"? |
| WHY | Why is this category flagged and not others? Why is my usual so low/high — was last period abnormal? Is one big payment skewing this? Does the multiple include a refund? |
| HOW | How do I fix the category if it's mis-tagged? How do I undo "new normal"? How do I stop being asked about this? |
| WHEN | Over what window is "so far this period"? When does the period end so this normalises? When will you ask me again? |

### A3.4 `intent_pace` → IntentPaceCard (`HomeBrief.tsx:467-509`)
**Shows** — plain headline + body, no accent, no CTA. Pace note against a Mirror-chosen aim. ✕ = Hide on Home.

| Bucket | Questions |
|---|---|
| WHERE | Which spend counted toward this aim? |
| WHAT | What is an "aim"? What is the Mirror and why does it have opinions about me? What pace am I being measured against? |
| WHY | Why am I ahead/behind? Which transactions moved the needle? |
| HOW | How do I change or drop the aim? How do I get back on pace? |
| WHEN | When is the aim measured/judged? When does the pace window reset? |

### A3.5 `ask` id `ask:payday` → AskPaydayCard (`HomeBrief.tsx:131-205`)
**Shows** — "✦ PENNY" gradient chip, bold `headline`, `body` (£ masked when `hideNetWorth`). Primary: `item.action.label` default **"Yes, that's it"** → `POST /income/confirm-payday`, then `onRefresh` (full Home reload). Secondary: `item.secondary_action.label` default **"No, set it myself"** → `POST /today/dismiss` + `sessionStorage.wealth_open_pay_period=1` → `/planning`.
**Endpoint** — `/today`; confirm returns `ConfirmPaydayResponse{payday, schedule, schedule_label, payday_phrase, pay_period_config, merchant, amount, period}`.

| Bucket | Questions |
|---|---|
| WHERE | Which transaction made you think this is my payday? Which account did it land in? |
| WHAT | What is a "pay period" vs a calendar month? What changes across the app if I confirm? Is this my salary or a one-off credit? |
| WHY | Why does Penny need to know my payday? Why did it guess this date/amount? Why is it asking again? |
| HOW | How do I set it manually? How do I handle two incomes / irregular pay / weekly pay? How do I undo a wrong confirmation? |
| WHEN | When is my next payday now? When does the current period end? What happens if I get paid early (weekend/bank holiday)? |

### A3.6 `ask` (any other id, e.g. `ask:card_terms`) → AskGenericCard (`HomeBrief.tsx:231-302`)
**Shows** — Penny chip, headline, body, primary `item.action.label` → route push, plus Home-only **"Not now"** (localStorage hide; on Penny there's no Not-now at all).

| Bucket | Questions |
|---|---|
| WHERE | Which card/account is this about? |
| WHAT | What is APR / a promo rate / a balance transfer? Why can't the app just know my rate? |
| WHY | Why do you need me to type this in? What improves if I answer? |
| HOW | Where do I find my APR? How do I skip permanently? |
| WHEN | When will you ask again if I say Not now? When does my promo end? |

### A3.7 `needle` item (`HomeBrief.tsx:1175-1189`)
**Shows** — plain glass card, `headline` + a text-link action ("review last month" class CTA) → `item.action.route`.

| Bucket | Questions |
|---|---|
| WHERE | Where did last month's money go? |
| WHAT | What is "the needle"? What's in a month review? |
| WHY | Why is it inviting me now? |
| HOW | How do I see previous months? |
| WHEN | When did last month close? Why is this only here for a few days? |

### A3.8 `move` → MoveCard (`HomeBrief.tsx:523-719`)
**Shows** (rich `plan_dest` variant):
- Penny chip + optional ✕ (Home).
- Bold headline.
- **Destination tile**: bank badge + one of: `"£X overdrawn right now"` (`plan_dest.is_overdraft`), `"£{balance} held · £{needs_total} payment expected {needs_by}"` (1 bill), `"£{balance} held · £{needs_total} in {N} payments before period end · first expected {needs_by}"`.
- **Sources ledger**: per-leg bank badge + account name + `£{amount}` (from `item.moves[].move_map.from` / `item.move_map.from`), then a **"Moving £{total}"** row.
- **Footer assurance**: "Clears the payment"/"Clears all N payments"/"Clears the overdrawn balance" (`item.covered`) + "the source still covers its own bills"/"every source still covers its own bills" (`item.sources_safe`); plus `item.residual`, `item.income_note`, `item.overflow_note`.
- Optional action button → `item.action.route`.
Fallback variant (no `plan_dest`): headline + body only.
**Endpoint fields** — `CompanionItem.plan_dest{account_id,name,provider,balance,needs_total,needs_by,bills[],is_overdraft}`, `moves[]`, `move_map`, `amount`, `covered`, `sources_safe`, `residual`, `income_note`, `overflow_note`.

| Bucket | Questions |
|---|---|
| WHERE | Where exactly is this money coming from and going to? Which bills is the destination account paying? What's in the "£X held" number — is that the whole balance? |
| WHAT | Does the app move the money, or do I? Is this a transfer instruction or a suggestion? What does "held" mean? What does "sources still cover their own bills" prove? What's a "residual"? What's the "overflow note"? |
| WHY | Why this account and not another? Why this amount exactly? Why now? What if I don't move it — what actually breaks? Why is the source safe — did you count its own upcoming bills? |
| HOW | How do I do the transfer? Can I do part of it? How do I mark it done so it stops asking? How do I tell it to ignore an account (e.g. joint/kids' savings)? |
| WHEN | When must the money be there by (`needs_by`)? What's the deadline before an overdraft fee / failed DD? When does "before period end" fall? |

### A3.9 "Cleared from Home" pointer row (`HomeBriefClearedRow`, `HomeBrief.tsx:1251-1285`) — rendered by HomePage **below** Safe-to-Spend
**Shows** — Penny gradient square + one sentence: `"{A money move|An upcoming bill|A spending change|A pace note|A win|A question|Last month's review|Your payday plan} is still on Penny."` or `"… and {N-1} more are still on Penny."` + chevron. Only when everything in the brief was hidden.
**Endpoint** — derived from the same `/today` feed + local dismiss store.

| Bucket | Questions |
|---|---|
| WHERE | Where is "Penny"? Is that a page or the chat? |
| WHAT | Does "cleared" mean done, or just hidden? What's the difference between hiding here and dismissing there? |
| WHY | Why is it still there if I dismissed it? Why won't it tell me what it is? |
| HOW | How do I actually get rid of it for good? How do I un-hide it on Home? |
| WHEN | When does a hidden card come back? (7-day expiry, invisible to the user.) |

## A4. PAYDAY PLAN section (`HomeBrief.PaydayPlanSection`, `HomeBrief.tsx:1407-1587`)

Gated on Home to the payday window (`lib/paydayWindow.ts`: live plan exists, OR `days_until_payday` 1–5). Never renders with zero accounts.

### A4.1 Payday-plan entry row (teaser)
**Shows** — "Payday plan" + a distance-aware subline built from `safeToSpend.next_payday`: "Pay period ends today/tomorrow/{Weekday}/{Sat 30 Aug}. See how I'd split your next pay cheque" (fallback: "See how I'd split your next salary"). Chevron rotates when the preview is expanded.
**Can do** — tap → `api.getToday(true)` (`GET /today?payday_preview=1`) and renders the returned `payday_plan` item inline; tap again to collapse. ✕ = "Dismiss until next payday" (localStorage keyed to `next_payday`). Errors show "Couldn't build the plan just now, try again after a sync." / "No payday plan to show yet."; loading shows "Working it out…".

| Bucket | Questions |
|---|---|
| WHERE | Where does the plan think my salary lands? |
| WHAT | What is a payday plan? Does it move money automatically? Is a "preview" hypothetical? |
| WHY | Why did this appear now (and not last week)? Why did it disappear after I dismissed it? |
| HOW | How do I make it use different accounts/amounts? How do I get it back after dismissing? |
| WHEN | When does my pay period actually end? When will the real plan appear? Is "period ends Friday" the same as "paid Friday"? |

### A4.2 PaydayPlanCard (`components/PaydayPlanCard.tsx`) — live or preview
**Shows**, in order:
1. Penny chip + ✕ ("Dismiss" live → `POST /today/dismiss`; "Close preview" in preview mode).
2. Preview framing line: "If your pay landed today, here's how I'd split it."
3. **Hero figure** `£{item.total}` + "Moving to {N} account(s)" (N = dests with `move > 0`).
4. Headline with the £ amount stripped client-side (`headlineNoAmount`).
5. `item.body` sentence.
6. Trimmed notice (amber dot): **"Buffers trimmed to fit this month."** when `item.trimmed`.
7. **Salary tile**: bank badge, `salary.name`, `~£{salary.amount}` emerald, caption "expected".
8. **Destination rows** (sorted by `move` desc): bank badge, `dest.name`, `£{dest.move}`; breakdown line joining `£{bills_total} payments · ~£{spend_typical} spending · £{buffer} buffer`; plus "you usually send £{usual}" when `|usual − move| > 25`.
9. **"Already set: {names}"** for dests with `move === 0` and a known `usual`.
10. **"£{salary.stays} stays with you in {salary.name}."**
11. Action button: `item.action.label` (live) or "See the full plan ›" (preview) → `item.action.route`.
**Endpoint fields** — `CompanionItem.total/preview/dests[]/salary{account_id,name,provider,amount,stays}/trimmed`, `PaydayPlanDest{name,provider,balance,bills_total,bill_count,spend_typical,buffer,target,move,usual}`.

| Bucket | Questions |
|---|---|
| WHERE | Where is each £ going and what will it pay? Where does the money that "stays with me" go? Which bills are inside `bills_total`? |
| WHAT | What's a "buffer" and who decided its size? What is "~£X spending" — an estimate of me? What does "target" mean vs "move"? What does "already set" mean — did I already send it? Does the app execute these transfers? What does "trimmed" mean and what got cut? |
| WHY | Why £X to this account and not less? Why is it more/less than I usually send? Why did buffers get trimmed — am I short? Why is this account skipped? Why is my salary "~" (estimated)? |
| HOW | How do I edit the split? How do I add/remove a destination? How do I make it permanent/repeat monthly? How do I tell it my usual amount changed? How do I mark it as done? |
| WHEN | When should I make these transfers — before or after payday? When does my pay actually land? When will this plan refresh? |

## A5. Fresh-user hero: "Connect your first bank" (`HomePage.tsx:378-395`, and duplicate empty state at `:548-562`)

**Shows** — "Connect your first bank" + "Read-only access through open banking, we can never move your money." + primary button "Connect a bank" → `api.connectLink()` (`GET /auth/truelayer/link`) → external redirect.

| Bucket | Questions |
|---|---|
| WHERE | Where does my data go? Who stores it? |
| WHAT | What is open banking? What does read-only actually mean? Which banks are supported? Does this hurt my credit file? |
| WHY | Why do you need my bank at all? Why can't I enter things manually? |
| HOW | How do I connect a second bank / a credit card / an investment account? How do I disconnect later? How do I upload a statement instead? |
| WHEN | When will my transactions appear? How far back does history go? When does the connection expire? |

## A6. Load-error fallback (`HomePage.tsx:398-412`)

**Shows** — "Couldn't load your data, check your connection." + "Try again" → resets skeletons and re-runs `loadData()`.

| Bucket | Questions |
|---|---|
| WHERE | Is my data still there? |
| WHAT | Is this my internet or your servers? |
| WHY | Why does it keep failing? |
| HOW | How do I use the app offline / see cached figures? |
| WHEN | When will it be back? |

## A7. SAFE TO SPEND card (`components/SafeToSpendCard.tsx`) — `GET /safe-to-spend`

The single densest surface on Home. Every sub-element below is its own question generator.

### A7.1 Whisper label + state icon
**Shows** — "SAFE TO SPEND" + ShieldCheck (comfortable) / AlertCircle (tight, or short-because-cards) / AlertTriangle (short-because-bills). Colour: emerald / amber / red.

| Bucket | Questions |
|---|---|
| WHAT | What is "safe to spend" — is it my balance? Safe by whose definition? What does the shield/triangle mean? |
| WHY | Why amber and not red? Why did the icon change since yesterday? |
| HOW | How do I get back to green? |
| WHEN | Safe to spend between now and when? |

### A7.2 Verdict headline (`SafeToSpendCard.tsx:173-184`)
**Shows** one of four sentences (+ " · estimated" when `estimated`):
- comfortable: **"You're okay. £X to spare this pay period."**
- tight: **"Tight until your pay period ends. £X in hand."**
- short + `short_reason === "cards"`: **"Bills are covered, but £X has gone on cards this period. Nothing spare until payday."**
- short + bills: **"Short this pay period. £X to cover."**
Note the client-side remap: a backend `short` with `safe_to_spend > −1` and not cards-driven is re-read as *comfortable* (`zeroSafe`, `:61`, `:124-126`).

| Bucket | Questions |
|---|---|
| WHERE | Where did the spare go since last week? Where is the £X "in hand" — which account? |
| WHAT | What is "to spare" — after what? What does "in hand" include? What is "estimated" estimating? What counts as "cards"? What does "nothing spare until payday" forbid me from doing? |
| WHY | Why only £X? Why am I tight this period when I wasn't last? Why does it say short when my balance is positive? Why did the verdict change between two visits today? |
| HOW | How do I make it say "okay"? What single change gains me the most? How do I cover the £X gap? |
| WHEN | Until when — what date does "this pay period" end? When does it recalculate? |

### A7.3 NOW / BILLS / FREE tiles (`:267-295`)
**Shows** — three count-up figures: **NOW** = `spendable_now`; **BILLS** = `bills_total` (with a leading "−" only when > 0); **FREE** = `|safe_to_spend|` (prefixed "−" when `state === "short"`). Masked to "£••••" under `hideNetWorth`. Explicitly NOW − BILLS ≠ FREE once card/commitment reserves exist.

| Bucket | Questions |
|---|---|
| WHERE | Which accounts make up NOW? Which bills make up BILLS — list them. Where's the missing money — NOW minus BILLS doesn't equal FREE! |
| WHAT | Does NOW include savings? Does BILLS include things I've already paid? Is FREE per-day or for the whole period? What is a "reserve"? |
| WHY | Why doesn't the arithmetic add up? Why is BILLS higher than last period? Why did NOW drop overnight? Why is FREE negative? |
| HOW | How do I lower BILLS? How do I include/exclude an account from NOW? How do I see the maths? |
| WHEN | Bills due by when? Is NOW as-of now or as-of last sync? |

### A7.4 Cash-vs-cards chain line (`:301-310`, shows when `card_growth_reserved >= 10`)
**Shows** — amber dot (only when short) + **"£{safe_to_spend_cash} before cards · £{card_growth_reserved} on cards · £{free} free|short"**.

| Bucket | Questions |
|---|---|
| WHERE | Where did the £X on cards get spent — which merchants, which card? |
| WHAT | What is "before cards"? Is it my raw balance? (It isn't — it's post-bills, post-buffer, post-commitments.) What is a "card reserve" — is the money set aside somewhere? What does "short" here mean vs the headline? |
| WHY | Why is card spend deducted from my cash when I haven't paid the bill yet? Why £X reserved and not the full balance? Why did this line appear only now? |
| HOW | How do I stop card spend eating my free cash — pay it off now? How do I turn this reserve off? |
| WHEN | When is the card bill actually due? When does the reserve release? |

### A7.5 Pace + payday line (`:317-331`)
**Shows** — either **"£X.XX/day until {today|tomorrow|Friday|Sat 30 Aug}"** (when `pace.state ∈ {comfortable,on_pace,ahead,early}` and `pace.sustainable != null`) or **"Pay period ends {label}"**; then optionally **" · ~£{payday_income} expected"**.

| Bucket | Questions |
|---|---|
| WHERE | Where does the daily figure come from — what's already been spent today? |
| WHAT | What is "sustainable per day" — does it include bills? Is "expected" guaranteed? Is "period ends Friday" my payday? |
| WHY | Why did my daily rate drop? Why is expected income lower than my usual salary? Why no pace figure at all today? |
| HOW | How do I raise the daily amount? Can I bank unspent days? How do I correct expected income? |
| WHEN | Which "Friday"? (Deliberate distance-aware labelling — still ambiguous to users at 6–7 days.) When does the day counter roll over? |

### A7.6 Commitments-reserved line (`:333-350`, when `commitments_reserved > 0`)
**Shows** — tappable: **"£X each pay period ({monthly}) reserved for {N} plan(s)"** (or "a period" when `commitments_reserved_period_label` is null) + "›" → `/planning`. `aria-label`: "See the plans this is reserved for".

| Bucket | Questions |
|---|---|
| WHERE | Which pot is holding it? Which plans? |
| WHAT | What is a "plan"/"commitment"? Is the money actually moved or just notionally reserved? Does it come out of FREE? |
| WHY | Why £X per period — how was the slice calculated? Why is my plan taking so much? |
| HOW | How do I pause, cancel, or shrink a plan? How do I skip this period? |
| WHEN | When is the target date? What period is "each pay period"? |

### A7.7 Freshness caveat (`:352-354`, `syncAgeLabel`)
**Shows** — only when data is >3h old: "Synced N hours ago" / "Synced yesterday" / "Synced N days ago" / "Synced on 24 Aug".

| Bucket | Questions |
|---|---|
| WHERE | Which of my accounts is stale? |
| WHAT | Are these numbers wrong right now? |
| WHY | Why hasn't it synced? |
| HOW | How do I force a sync? |
| WHEN | When will it sync next? How current is "fresh"? |

### A7.8 CTAs (`:358-373`)
**Shows** — **"See what's due ›"** → `/planning` (state short, unless `suppressCTA` because a `move` item exists); **"See your cards ›"** → `/cards` (state tight AND `card_debt >= 1000`, suppressed when the chain line shows).

| Bucket | Questions |
|---|---|
| WHERE | What's due, and from which account? |
| WHAT | What will I see on that page? |
| WHY | Why is this button here today and not yesterday? Why is there no button when I'm short? |
| HOW | How do I act on what's due — can I move a bill? |
| WHEN | Due when? |

## A8. Potential-savings row — ValueDeliveredStat (`components/ValueDeliveredStat.tsx`) — `GET /value-delivered`

**Shows** — PennyMark + either **"£X/mo saved"** (when `verified_monthly_saving > 0`) or **"£X/mo potential savings"** (from `total_monthly_saving`), currency symbol per region (£ / KSh). Hidden entirely when both are 0. Tap → `/insights?tab=save`.

| Bucket | Questions |
|---|---|
| WHERE | Where is that saving coming from — which bills/switches? Where has the saved money actually gone? |
| WHAT | What's the difference between "saved" and "potential"? Verified by whom/how? Is this per month forever? |
| WHY | Why did the number change? Why is it counting something I never acted on? Why so small/so big? |
| HOW | How do I actually capture the potential saving? How do I dismiss ideas I'll never do? |
| WHEN | Saved since when? Over what horizon is "/mo" projected? |

## A9. Reauth banner(s) (`HomePage.tsx:455-472`)

**Shows** — per expired provider: AlertTriangle + **"{Provider} needs reconnecting"** + "Transactions have stopped syncing." + amber **"Reconnect"** → `api.connectLink(provider_id)` → external redirect. First one may carry the `needs-you` glow (highest attention priority).

| Bucket | Questions |
|---|---|
| WHERE | What data am I missing right now? Which accounts under that bank? |
| WHAT | What expired — a consent, a token? Did I do something wrong? Will I lose history? |
| WHY | Why do connections expire? Why this bank and not the others? |
| HOW | How long does reconnecting take? Do I need my bank app/card reader? |
| WHEN | When did it stop syncing? How stale is my Safe to Spend because of this? How often will this happen (90 days)? |

## A10. "YOUR MONEY" — Coming up · 14 days (`components/UpcomingBillsStrip.tsx`) — `GET /cashflow`

**Shows** — eyebrow "Coming up · 14 days"; a computed `DropSentence` (one of four shapes, `lib/comingUp.tsx:443-498`):
- empty: "Nothing due in the next 14 days."
- concentrated (1 day): "£X due {today} across {N payments}, {P}% of this fortnight."
- concentrated: "The next {D} days carry {P}%. Heaviest: {when}, £X across {N payments}."
- landing: "£X due {when}. The heaviest day is {when}, £Y across {N payments}." (or folded when same day: "…, the heaviest hit of the fortnight.")
- calm: "Nothing's due for {D} days. Then the heaviest day is {when}, £X across {N payments}."
Footer: amber dot (when something is due today) + **"{N} bills · £{total} total"** + optionally **" · £{movementTotal} moving between your accounts"**.
Tap → `/planning?day={heaviest or today ISO}`. States: skeleton, "Couldn't load upcoming bills" + Retry, and self-hides when zero spend bills.
**Endpoint fields** — `CashflowData.upcoming_bills[]{name, amount, expected_date, days_away, kind}`; `kind === "movement"` is excluded from the headline/total via `isSpend`.

| Bucket | Questions |
|---|---|
| WHERE | Which bills are these — name them. Which account will each come out of? Where's my rent/mortgage — why isn't it here? Where did the "moving between your accounts" money go? |
| WHAT | What counts as a "bill" here — is a transfer a bill? What is "movement" vs spend? What does "% of this fortnight" mean? What is a "heaviest day"? Why do bill names look like bank gibberish (or get renamed)? |
| WHY | Why 14 days and not until payday? Why is this total different from Safe to Spend's BILLS? Why is one day carrying everything? Why is a bill I cancelled still listed? Why is an amount an estimate? |
| HOW | How do I move/skip/delete a bill? How do I mark one as paid? How do I add a bill you missed? How do I stop counting a transfer as an outgoing? |
| WHEN | Exactly which dates? What happens when a due date falls on a weekend? Does "today" mean it's already gone or still to come? |

## A11. "Last month" strip — ThisMonthStrip (`components/ThisMonthStrip.tsx`) — `GET /needle/summary`

**Shows** — only for the first 3 days of a new period (`current.days_into_period <= 2`) and only when `last_closed` exists. Whisper "LAST MONTH"; then `last_closed.lines.movement` (emerald when `card_delta < 0`, else ink) and `last_closed.lines.cash` — both backend-authored sentences, £ masked when `hideNetWorth`. Tap → `/month?which=last`.
**Fields** — `NeedleClosed{period_start, period_end, card_delta, month_end_cash, lines{headline, movement, cash, streak}}`.

| Bucket | Questions |
|---|---|
| WHERE | Where did last month's money actually go? Which categories moved the card balance? |
| WHAT | What is "card movement"? What is "month-end cash"? Does green mean I paid debt down? What is a "streak"? |
| WHY | Why did my card balance grow? Why is my end-of-month cash lower than I thought? Why is this comparing to a "month" when I'm paid every 4 weeks? |
| HOW | How do I do better this month? How do I see the full breakdown? |
| WHEN | Which dates were "last month"? Why did this card disappear after a few days? When does this month close? |

## A12. Insight spotlight — HomeInsightSpotlight (`components/HomeInsightSpotlight.tsx`) — `GET /savings-insights/spotlight`

**Shows** — category icon chip + `insight.label`; "✦ New" badge when `is_new`; optional `return_reason` line with a RotateCcw icon (e.g. "Updated: estimated saving now ~£83/mo"); bold `insight.title`; 2-line-clamped `insight.body`; violet footer link **"See all insights ›"** → `/insights?tab=save&insight={id}`. Skeleton on first load; renders nothing if no insight.
**Can do** — tap → insights; ✕ or **left-swipe to dismiss** → `POST /savings-insights/{id}/dismiss`, then immediately re-loads the next eligible insight.
**Fields used** — `SavingsInsight{id, category, label, title, body, is_new, return_reason}`. Deliberately does *not* show `savings_estimate`.

| Bucket | Questions |
|---|---|
| WHERE | Where in my spending did this come from — which transactions triggered it? |
| WHAT | Is this an ad? Who wrote this — Penny or a human? What's the actual saving in pounds (the estimate is hidden)? What does "New" mean? |
| WHY | Why am I being shown this one? Why did a dismissed one come back? Why does the estimate keep changing? |
| HOW | How do I act on it — is there a switch/cancel flow? How do I tell you I already did it? How do I stop insights about this category entirely? |
| WHEN | When does the deal/deadline expire (`deadline_at` exists but isn't rendered)? When will another one appear? |

## A13. Pinned cards zone (`HomePage.tsx:494-513`) — opt-in via `preferences.home_pinned_cards` / `home_pinned_widget`

### A13.1 FuelSavingsCard (`api.fuelNearby`)
**Shows** — "Fuel prices nearby"; preview line "Cheapest {grade} nearby: {N}p/l · {distance}"; expandable list with CHEAPEST / CLOSEST tags, ppl per station, sort control; states for "Finding cheaper fuel nearby…", location permission, "No {grade} stations within N miles"; pin/unpin control.

| Bucket | Questions |
|---|---|
| WHERE | Where is that station exactly — how do I navigate there? Where is my location coming from? |
| WHAT | What is "ppl"? Is my grade right? How fresh is this price? |
| WHY | Why is a station 6 miles away "cheapest" — is the detour worth it? Why do prices differ from what I actually paid? |
| HOW | How do I change grade/radius? How do I unpin this card? |
| WHEN | When was this price last updated? |

### A13.2 GroceryBasketCard (`api.basketInsights`, `api.listBaskets`, `api.scanReceipt`, `api.deleteBasket`)
**Shows** — headline insight line (emerald), or "Snap a receipt to track grocery prices"; savings/increase item rows with per-item ± percentages; basket history.

| Bucket | Questions |
|---|---|
| WHERE | Which shop was cheaper? Where is my receipt data stored? |
| WHAT | What is a "basket"? What's being compared — same item, same size? |
| WHY | Why did this item go up? Is that inflation or a different shop? |
| HOW | How do I scan a receipt? How do I fix a misread item? How do I delete a basket? |
| WHEN | Compared over what time window? When was the last basket? |

### A13.3 PinnedWidgetCard (`components/SpendTrends.tsx:849+`) — `GET /transactions?days=90`
**Shows** — one of: "Category breakdown" (donut), "Daily spend" (bars), "Period comparison" (last six pay periods), "Size distribution", "Transport modes" — filtered to the current pay period via `getPayPeriodWithConfig` and to home currency via `isHomeCurrency`.
**Can do** — tap → `/spend?view=trends`.

| Bucket | Questions |
|---|---|
| WHERE | Where did the biggest slice go? Which transactions are in that bar? |
| WHAT | Which period is this — calendar month or my pay period? Does it include transfers, refunds, foreign spend? |
| WHY | Why is this category so big? Why is this period different from last? |
| HOW | How do I change/remove the pinned widget? How do I drill in? |
| WHEN | What date range is on the x-axis? When does the period reset? |

## A14. "Your estate" section (`HomePage.tsx:521-594`)

**Shows** — header "YOUR ESTATE" + **"Manage ›"** → `/accounts`. Then up to 3 top-pick accounts (priority: expired connections → user pins from `home_pinned_accounts` → biggest current balances → biggest savings), plus the top 1 investment account, then **"+{N} more accounts ›"**.
Each `AccountLedgerRow` shows: bank logo/initials badge; optional amber ★ (pinned); account name; `{provider} · {kind label}` subtitle; right-side `£{|balance|}` (rose when negative, muted when dormant/£0) with a caption of **"owed"** (credit, negative) / **"in credit"** (credit, positive) / **"overdrawn"** (non-credit, negative); an inline amber **"Reconnect"** when `row.attention`. Tap → `/accounts?id={id}` (or `?tab=Investments`).

| Bucket | Questions |
|---|---|
| WHERE | Where are my other accounts — why only three? Where's my pension/mortgage? Is my ISA counted in net worth? |
| WHAT | What is "estate"? What does "owed"/"in credit"/"overdrawn" mean here? Is a credit balance good or bad? Is this balance available or pending-inclusive? What's a "dormant" account? |
| WHY | Why were these three chosen? Why does this balance differ from my bank app? Why is my card showing a negative when I owe money? |
| HOW | How do I pin an account? How do I hide/close one? How do I add a manual/offline account? |
| WHEN | As of when is this balance? When do pending transactions clear? |

## A15. Recent Transactions (`HomePage.tsx:599-641`) — `GET /transactions/search?page=1&page_size=12`

**Shows** — header "RECENT TRANSACTIONS" + **"See all ›"** → `/transactions`. Up to 6 rows after filtering out micro pot-shuffles (`category === "Transfer" && amount < 1`). Each `TransactionRow`: merchant favicon (domain-mapped) or coloured initial chip; `merchant_name || description || "Unknown"`; `{date} · {category}` subtitle; right amount `+£X` (emerald, credits) or `-£X` (ink, debits) formatted per transaction currency. Empty state: "No transactions yet".
**Can do** — tap a row → `TeachingSheet` (recategorise, resolve movement/transfer, attach to a goal, create a merchant rule via `api.addRule`, `api.patchTransaction`, `api.resolveMovement`) with undo/toast; corrections patch both `recentTxns` and `transactions` locally.

| Bucket | Questions |
|---|---|
| WHERE | Which account did this come from (account isn't shown here)? Where's the transaction I made an hour ago? Why do only 6 show? |
| WHAT | Why is this called "Unknown"/a raw bank string? Is this category right — who decided it? What's a "movement"/transfer resolution? What does a pending transaction look like? |
| WHY | Why is this categorised as X? Why is a £0.30 transfer hidden? Why is the amount different from the receipt (tip/FX)? Why is a refund showing green? |
| HOW | How do I recategorise this and everything like it? How do I split a transaction? How do I undo a miscategorisation? How do I attach it to a goal? |
| WHEN | When did this actually happen vs settle? Why is the date different from my bank's? |

## A16. Bottom nav Penny button + living dot (`components/BottomNav.tsx:205-253`)

**Shows** — raised gradient Penny button (the only place the indigo→violet gradient appears as a fill), with an amber "living dot" lit whenever the payday window is active (`isPaydayWindowActive`, cached at `wd_penny_dot`, written through by Home). Also: Spend badge (`wd_spend_badge`, bills due within 7 days their account can't cover) and Insights badge (`wd_insight_badge`).
**Can do** — tap → opens/closes the floating Penny window with `{ screen: screenForPathname(pathname) }`.

| Bucket | Questions |
|---|---|
| WHERE | Where does this take me — a page or a chat? |
| WHAT | Who/what is Penny? What does the amber dot mean? Is there a notification waiting? |
| WHY | Why is the dot lit? Why did it appear today? |
| HOW | How do I clear the dot? How do I turn it off? |
| WHEN | When does the dot light up (1–5 days before period end / live plan)? |

---

# PART B — PENNY SHEET (floating chat window)

`components/PennySheet.tsx` renders a portal-mounted floating window (not a takeover sheet: no scrim, no blur, page stays visible), z-56 click-catcher / z-58 panel, capped 65dvh, floor `min(26rem, 65dvh)`, anchored above the nav's Penny button (mobile) or bottom-right (desktop). It mounts once per session and keeps its threads alive; `PennyConversation` is deferred to the first open.

## B1. Sheet header (`PennySheet.tsx:539-558`)

**Shows** — gradient square + PennyMark, title **"Ask Penny"**, ✕ Close. `role="dialog" aria-modal="true"`.

| Bucket | Questions |
|---|---|
| WHAT | Who is Penny — an AI, a human, an adviser? What can she actually see about me? Is this regulated advice? |
| WHY | Why is this a small window and not a page? |
| HOW | How do I get a bigger view / my full history? How do I close it? |
| WHEN | When does she know about a transaction — is she looking at live data? |

## B2. Header link row (`PennySheet.tsx:573-585`, `lib/pennyScreenConfig.tsx`)

**Shows** — up to 3 quiet links, screen-aware. From **Home**: "Your plan and updates" (`/penny`), "Your accounts" (`/accounts`), "Mirror" (`/mirror`). Every other screen: just "Your plan and updates". Each closes the sheet on the way out.

| Bucket | Questions |
|---|---|
| WHERE | Where do these go? What's on the Penny page that isn't here? |
| WHAT | What is the "Mirror"? What are "updates"? Is "your plan" the payday plan or my goals? |
| WHY | Why these three links and why do they change per page? |
| HOW | How do I get back to the conversation after tapping one? (It closes the sheet.) |
| WHEN | — |

## B3. Chip row — sheet mode (`PennyConversation.tsx:1521-1572`)

**Shows** — a single horizontally-scrolling, non-wrapping row, capped at **6** chips (full-page mode caps at 3), right-edge fade. Priority order: deterministic ask chips → link chips → LLM ask chips → personalised `canISuggestions` £-chips (deduped case-insensitively against config `q` values).
On **Home** (`personalisedChips: true`): personalised £-chips from `GET /can-i/suggestions` plus the deterministic **"How am I doing until payday?"**.
Other screens' curated sets (for cross-screen reference): spend → "Where did my money go this month?", "Am I spending more than usual?", "How do categories work?" (deterministic), link "Review transfers" (`/spend?review=1`); planning → "How am I doing until payday?", "What's still due before payday?"; insights → "What's still due before payday?", links Tax/Receipts; grow → "Am I saving enough?", "Saving vs investing, how does it work?" (deterministic), link "Your plan"; debt → "How am I doing on my debt?", "When will my card be clear?", link "Your plan"; tax → four explainer chips (pension carry-forward, salary sacrifice, self-assessment, Gift Aid); accounts (not yet reachable) → "How do I add an ISA?", link "Mirror".
**Behaviour** — an `ask` chip **populates the composer** (does not send, does not focus/pop the keyboard); a `link` chip closes the sheet and navigates. No ✕ dismiss in sheet mode. Asked chips disappear per-bucket (`askedLabels`).

| Bucket | Questions |
|---|---|
| WHERE | Where do these suggestions come from — my data or a canned list? |
| WHAT | What do the £ figures in a chip refer to? Why did the chip fill the box instead of answering? What's the difference between a pill-shaped chip and a ghost one with an arrow? |
| WHY | Why these questions and not the one I want? Why did a chip disappear after I asked it? Why are the chips different on each page? |
| HOW | How do I edit the question before sending? How do I get rid of chips I never use? How do I see more (they scroll off-screen)? |
| WHEN | When do the suggestions refresh? |

## B4. Thread / conversation (`PennyConversation.tsx:1587-1629`)

**Shows** — `aria-live="polite" role="log"` internally scrolling pane, `space-y-3`, capped at **6 messages** (`HISTORY_CAP`) as a sliding window. **Per-screen buckets**: home / spend / planning / insights / grow / debt / tax / accounts / other — each with its own thread and its own **30-minute inactivity TTL** (`PENNY_THREAD_TTL_MS`); expiry is silent, no notice.

| Bucket | Questions |
|---|---|
| WHERE | Where did my earlier messages go? Where's the conversation I had on the Spend page? |
| WHAT | Is this saved anywhere? Does Penny remember me between sessions? Does she see this history when I ask a follow-up? |
| WHY | Why did my thread vanish (30-min TTL, invisible)? Why did the thread change when I switched tabs? Why does it only remember 6 turns? |
| HOW | How do I start a fresh conversation? How do I copy/export an answer? How do I go back to a previous thread? |
| WHEN | When does the conversation reset? |

## B5. UserBubble (`:267-275`)
**Shows** — right-aligned indigo bubble, max 85% width, the user's exact text with £ figures rendered in `MoneyText`.

| Bucket | Questions |
|---|---|
| WHAT | Did she understand my question the way I meant it? |
| HOW | How do I edit/resend a question? Can I delete it? |

## B6. VerdictBubble (`:294-364`) — `POST /can-i`
**Shows** — left-aligned muted bubble, max 90% width:
1. **Headline** (bold, 16px) from `CanIResponse.headline` — the verdict alone, under ~8 words ("Yes.", "Not this week.").
2. **Reasoning sentence** from `reply` (14px, mid-muted) — suppressed when `reply.startsWith(headline)`.
3. **Offer chip**: **"Set this up: £{per_period}/period ›"** from `CanIOffer{name, amount, target_date, per_period}` → opens `CommitmentSheet` prefilled.
Degraded path (no `headline`): the whole `reply` renders as plain body text. Out-of-scope answers use the identical anatomy — no separate treatment. The grey "facts" tier was removed (backend now returns `facts: []`).

| Bucket | Questions |
|---|---|
| WHERE | Where did that figure come from — which accounts/bills? Show me the transactions behind it. |
| WHAT | What does "yes" actually leave me with? What is a "period" in "£X/period"? Is this advice or information? Does it account for my card bill? What does "out of scope" mean — why won't she answer? |
| WHY | Why no? Why that number and not another? Why is her answer different from what Safe to Spend says? Why did she say yes yesterday and no today? What did she assume? |
| HOW | How do I make the answer "yes" — what would I have to change? How do I set this up (offer chip)? How do I correct a wrong assumption? |
| WHEN | Until when does this answer hold? When would it change? When would the commitment complete (`target_date`)? |

## B7. ExplainerBubble (`:375-390`)
**Shows** — same bubble shell, **no bold headline**; a quiet uppercase topic eyebrow (`msg.topic`, e.g. "TAX") and markdown prose (`ChatMarkdown`). Used for general-knowledge answers not grounded in the user's balances.

| Bucket | Questions |
|---|---|
| WHAT | Is this about MY situation or general rules? Which tax year? Is this UK-only? Can I rely on it? |
| WHY | Why is this styled differently from her other answers? Why won't she apply it to my numbers? |
| HOW | How do I make it specific to me? Where's the official source? |
| WHEN | When do the rules change / which tax year does this apply to? |

## B8. ScenarioConfirmCard (`:447-614`) — the anti-chatbot gate
**Shows** — deliberately a full-width `glass-card`, not a bubble. Title **"Here's what I understood"**. Per extracted item (max 3, backend-capped): a fieldset legend of **"Cancel" / "Income change" / "New cost"**, editable **Label**, **Amount** (with an amber "assumption, check this" marker when `prefilled` and kind is `income_change`), **Cadence** (Monthly / Weekly / Annual / One off), **Starts** (month picker), **Duration** (Ongoing / Ends) and conditional **End month**. Remove ✕ per item. `rejected[]` reasons shown quietly. Empty state: "Everything was removed, nothing left to run." Submit: **"Run it"** → `/scenario?items={JSON}`.

| Bucket | Questions |
|---|---|
| WHERE | Where did she get that amount from — I never said it? Which of my existing bills does "Cancel" refer to? |
| WHAT | What is a "scenario"? What does "Income change" mean — gross or net? What does "assumption, check this" mean? Why was an item rejected? Does "Run it" change anything real? |
| WHY | Why did she extract that and not what I said? Why only 3 items? Why did it guess my income? |
| HOW | How do I add another item? How do I model a raise AND a new cost together? How do I go back and re-ask instead of editing? |
| WHEN | What does "Starts" default to? What does "Ongoing" mean — forever? How far ahead does the simulation run? |

## B9. Typing indicator / error-retry (`:624-655`)
**Shows** — three bouncing dots in a Penny bubble, `sr-only` text **"Penny is checking your numbers"**. On failure: **"Couldn't check that just now, try again in a moment."** + **"Try again"** (re-sends the last user turn with the prior history).

| Bucket | Questions |
|---|---|
| WHAT | Is she querying my bank live? Is my question being sent somewhere? |
| WHY | Why did it fail? Was it my question or the service? |
| HOW | How do I retry / rephrase? |
| WHEN | How long does an answer normally take? |

## B10. Composer (`:1407-1436`, sheet shell at `:1736-1737`)
**Shows** — pill text input, `maxLength=160`, `aria-label="Ask Penny a spending question"`, placeholder seeded from the first £-bearing suggestion chip (`"Ask Penny: {chip label}"`) else **"Ask Penny: Can I spend £45 this weekend?"**; gradient send button (Loader2 while loading); disclaimer line **"General information, not regulated financial advice."** Enter submits. Deliberately never auto-focuses in sheet mode (no keyboard pop on open, or after a chip tap, or after an answer lands).
**Wire** — `api.canI(question, history, context?, screen)` → `POST /can-i {question, history, context, screen}`. `context` (`askContext.summary`) is one-shot per session and structurally separate from `question`; `screen` is sent on every call.

| Bucket | Questions |
|---|---|
| WHERE | Where does my question go — is it sent to an AI provider? Is it stored? |
| WHAT | What can I ask? What can't she answer? What does "not regulated financial advice" mean legally — can I act on this? Why is there a 160-character limit? |
| WHY | Why did she answer a different question? Why does she know what page I'm on? |
| HOW | How do I ask about a specific merchant/account/date range? How do I ask a follow-up she'll understand? How do I phrase a "what if"? |
| WHEN | Does she know today's transactions or only up to the last sync? |

## B11. Offer hand-off → CommitmentSheet (`:1751-1780`)
**Shows** — opened from a verdict's offer chip; prefilled `{name, amount, target_date}` with `source: "can_i"`. On save, appends a confirmation turn to the current bucket: **"Set up: £{per_period_slice} each pay period ({period_label}) reserved."**

| Bucket | Questions |
|---|---|
| WHERE | Which pot/account will fund it? Where is the money actually held? |
| WHAT | What is "reserved" — is it moved or just earmarked? Does this reduce my Safe to Spend? What is a "pay period slice"? |
| WHY | Why that per-period amount? Why that target date? Is it feasible (`feasibility`, `feasibility_note`)? |
| HOW | How do I change/cancel it later? How do I fund it from multiple pots? How do I skip a period? |
| WHEN | When will it be fully funded? When does the first slice come out? |

---

# PART C — Cross-cutting question generators (apply to nearly every element)

1. **`hideNetWorth` masking** — figures render as `£••••` / `£••` across SafeToSpendCard, MoveCard, PaydayPlanCard, ThisMonthStrip, HomeBrief (`maskAmounts` regex `£[\d,]+`). → *"Why is everything dots? How do I unhide? Does the app still know the numbers?"*
2. **Region symbol** — `SYM = {UK: "£", Kenya: "KSh "}` in UpcomingBillsStrip and ValueDeliveredStat; SafeToSpendCard/PaydayPlanCard hardcode `£`. → *"Why is one card in KSh and another in £? Which currency am I actually seeing? How is FX converted?"*
3. **Rounding conventions** — `fmtSum`/whole-pound rounding for multi-bill sums vs `fmt` (pence kept) for a single named bill; SafeToSpendCard's `zeroSafe` collapses anything under £1 to £0. → *"Why doesn't this total match my bank to the penny? Why does £0.60 show as £0?"*
4. **The word "period"** — "pay period", "this period", "each pay period", "a period", "period end", "last month", "fortnight", "14 days", "90 days" all coexist on one screen. → *"Which window is this number about? Is 'period ends Friday' the same as 'paid Friday'?"*
5. **Colour semantics** — emerald = verified/good, amber = attention (never materialised risk), red reserved for materialised risk only, ink for figures. → *"Is amber bad? Why is a negative number black here and red there?"*
6. **Attention glow (`needs-you`)** — at most one card glows: reconnect > sync error > live payday plan; nothing glows otherwise. → *"Why is this card glowing? Why is nothing glowing when I'm short?"*
7. **Dismissal semantics** — three different mechanics live on Home: server dismiss (`POST /today/dismiss`), Home-only localStorage hide (7-day expiry), and window-scoped payday-entry hide (keyed to `next_payday`). All look like the same ✕. → *"Is it gone forever? Why did it come back? Where did it go?"*
8. **Estimated / "~" markers** — `estimated` suffix on the verdict, `~£X expected` salary, `~£X spending` in payday dests. → *"What's estimated vs known? How confident are you? How do I correct it?"*
9. **Two "how much can I spend" answers** — Safe to Spend's FREE tile vs Penny's verdict vs the pace `£X/day`. → *"Which number do I actually trust?"*
10. **Missing "why" drill-downs** — no element on Home exposes the underlying bill list, transaction list, or arithmetic for its own figure; every tap routes to a different page (`/planning`, `/cards`, `/spend`, `/insights`, `/month`, `/accounts`). → *"Show me the maths" is unanswerable in place on nearly every card.*
