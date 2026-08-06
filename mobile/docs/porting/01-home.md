# Mobile Home Screen Port: Complete Spec

## Checkpoint

- Web source reflected at commit: 5ad21c0 (feat(home): rhythm checkpoint surfaces on the brief)
- Last change to this screen's source: f17d90d 2026-08-05 16:42:59 +0200
- Find future changes: `git log 5ad21c0..HEAD -- frontend/app/components/HomePage.tsx`

---

## Purpose & Emotional Job

The Home screen is the **reassurance verdict engine** of the app (BEHAVIOURS.md Layer 2+3). Its emotional job is "Am I okay? What changed?" Within ten seconds, the user should see:
1. A greeting + sync status (HomeBrief)
2. The Safe-to-Spend verdict (SafeToSpendCard) — am I okay, tight, or short before payday?
3. Rhythm checkpoints + Penny proactive items (integrated into HomeBrief body)
4. Four KPI rows: Upcoming Bills, This Month/Cards, Insights (savings opportunities), and Investment summary
5. Top 3 accounts or investment accounts pinned + "+N more" button
6. Recent 6 transactions (filtered, non-micro-transfers)

The design language is **Calm Cockpit**: verdicts lead (big bold £ figures), colour is information (red = genuine risk only), and the indigo→violet gradient is reserved for Penny advice surfaces.

---

## Source Files

### Web page component
- `/root/ai-wealth-dashboard/frontend/app/components/HomePage.tsx`

### Web child/shared components ACTUALLY RENDERED by HomePage
- `/root/ai-wealth-dashboard/frontend/components/HomeBrief.tsx` — greeting + brief body (companion items, ask/move/cliff/rhythm/celebration/needle cards)
- `/root/ai-wealth-dashboard/frontend/components/SafeToSpendCard.tsx` — verdict hero (3-col instrument readout)
- `/root/ai-wealth-dashboard/frontend/components/UpcomingBillsStrip.tsx` — 14-day bill glance with summary
- `/root/ai-wealth-dashboard/frontend/components/ThisMonthStrip.tsx` — cards/since-payday verdict
- `/root/ai-wealth-dashboard/frontend/components/HomeInsightSpotlight.tsx` — savings insight card (swipeable, left-swipe dismiss)
- `/root/ai-wealth-dashboard/frontend/components/ValueDeliveredStat.tsx` — savings/verified row (inside index block)
- `/root/ai-wealth-dashboard/frontend/components/AccountMiniCard.tsx` — account card (grid variant, calm+glass)
- `/root/ai-wealth-dashboard/frontend/components/InvestmentMiniCard.tsx` — investment account card (grid variant, calm+glass)
- `/root/ai-wealth-dashboard/frontend/components/TransactionRow.tsx` — recent transaction row with icon + category
- `/root/ai-wealth-dashboard/frontend/components/FuelSavingsCard.tsx` — pinned fuel insight (conditional)
- `/root/ai-wealth-dashboard/frontend/components/GroceryBasketCard.tsx` — pinned grocery insight (conditional)
- `/root/ai-wealth-dashboard/frontend/components/SpendTrends.tsx` (PinnedWidgetCard export) — chart widget (conditional)

### NOT rendered on home (imported or mentioned but not used)
- `GoalsStrip` — NOT rendered (no web home equivalent; mobile has native GoalsCard)
- `NetWorthCard` — NOT rendered (replaced by SafeToSpendCard; different data model and purpose)
- `MoneyBasicCard` — NOT rendered (generic rotating education card, intentionally not on home flow)
- `CompanionStack` — commented out with "kept-for-future" note (line 28 of HomePage.tsx; companion items rendered via HomeBrief instead)

### Mobile implementation (current, partial native)
- `/root/ai-wealth-dashboard/mobile/app/(tabs)/index.tsx` — page shell
- `/root/ai-wealth-dashboard/mobile/components/home/HomeHeader.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/NetWorthHero.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/GoalsCard.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/ComingUpCard.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/SpotlightCard.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/AccountsGrid.tsx`
- `/root/ai-wealth-dashboard/mobile/components/home/RecentTransactions.tsx`

---

## Critical Rendering Order (HomePage.tsx structure)

**Web layout uses a 2-column grid (lg:grid-cols-[5fr_6fr]):**
- Left column: greeting/brief, SafeToSpendCard+index block, reauth banners, KPI strips, accounts grid, pinned cards
- Right column: recent transactions

**Rendering order must match the source (HomePage lines 228–471):**
1. HomeBrief (greeting + companion items) — line 230
2. SafeToSpendCard + unified index block (ValueDeliveredStat + Mirror row) — lines 264–293
3. Reauth banners — lines 298–312
4. YOUR MONEY section (KPI strips: UpcomingBills, ThisMonth, Spotlight) — lines 314–328
5. Pinned insight cards (fuel, groceries, chart) — lines 333–352
6. YOUR ESTATE accounts grid — lines 355–424
7. Recent transactions (right column, or single-column on mobile) — lines 429–471

**Mobile will be single-column; maintain this order vertically.**

---

## Layout Anatomy (Top → Bottom)

### 1. HEADER ROW
**What:** Greeting + sync button + tutorial link (web: sticky desktop only)

**Layout & Structure:**
- Grid: flex items-center justify-between
- Left: h1 greeting text (text-[28px] font-bold tracking-tight, slate-900 dark:slate-100)
- Right: flex gap-2 containing TutorialTrigger (16px) + sync button

**Sync Button:**
- Size: w-9 h-9 (36×36px)
- Styling: rounded-full, bg-white dark:bg-slate-800, border 1px slate-100 dark:slate-700, shadow-sm
- Icon: RefreshCw size-14 (14px), text-slate-500 dark:text-slate-400, animate-spin when syncing
- State: disabled while `syncing` flag is true
- On click: calls `api.syncAll()` then `loadData()`
- Focus ring: focus-visible:ring-2 focus-visible:ring-indigo-500

**Greeting Behaviour:**
- Hydration guard: renders neutral "Hi, {name}" on first paint
- After mount: updates via `new Date().getHours()` to show "Good morning/afternoon/evening"

**Mobile mapping:**
Use HomeHeader component; conditional render tutorial link. No sticky behaviour on mobile (drawer or menu elsewhere). Sync button same size (44px on mobile is more generous; 36px tighter on web).

---

### 2. BRIEF SECTION (HomeBrief)
**What:** Dynamic companion items surface (Penny proactive alerts, asks, celebrations, moves, cliff/trajectory, rhythm)

**Structure:**
- Greeting headline (from component state, time-of-day aware) — text-[28px] font-bold, slate-900; dark: slate-100
- Sync button: 36×36px (w-9 h-9), rounded-full, white bg / slate-800 dark, 1px slate-100/700 border, shadow-sm; spinning RefreshCw icon (slate-500/400) when syncing
- Tutorial link: TutorialTrigger component (16px footprint)
- Sync error banner (amber, alert icon) if `syncError` true
- Loading skeleton (2 lines, slate-100/700 animate-pulse) if loading
- OR Brief body: space-y-3 layout with dynamic cards below

**Brief body content (ordered, as per BriefBody logic):**
1. Celebration cards (✦ emerald-500, clickable to /mirror)
2. Cliff/trajectory cards (amber AlertTriangle/TrendingDown, dismissible)
3. Rhythm cards (spend spike detection, inline intent buttons)
4. Ask cards — bespoke logic:
   - `ask:payday` → Confirm/Decline buttons (indigo-600 primary action, slate-500 secondary)
   - Other asks → Route push CTA + "Not now" dismiss
5. Needle card (closed period review invite, muted)
6. Move cards (Penny gradient chip, destination tile + source ledger, assurance footer)
7. Fallback text when items.length === 0 (contextual: depends on SafeToSpend state)

**All companion item cards:**
- Rounded 16px (rounded-2xl)
- glass-card class (liquid-glass or solid fallback; on mobile render as solid card)
- p-4 padding
- Dark mode: slate-800 card, slate-200 text

**Penny gradient** (indigo→violet 135°): used ONLY on ask/move/celebration chips, not on cliff/trajectory (those are factual, not advice)

**Mobile mapping:**
Replace with native components: cards as View + Text stack. Gradient chips use `expo-linear-gradient` with angles adjusted to platform. All text sizes/weights mapped via tw.text tokens.

---

### 3. WHERE YOU STAND SECTION
**What:** Safe-to-Spend verdict card + unified index block (Value Delivered + Mirror row)

**Important: Section order in HomePage**
- This section FOLLOWS HomeBrief (line 260) and PRECEDES reauth banners (line 297)
- Reauth banners render AFTER "WHERE YOU STAND", NOT before
- This is the correct rhythm: brief → verdict → reauth alerts → KPI strips

**SafeToSpendCard structure:**
- Hero container: rounded-3xl (24px), glass-hero, p-5
- Header: "SAFE TO SPEND" label (text-[11px] uppercase tracking-wide, slate-400) + state icon (ShieldCheck/AlertCircle/AlertTriangle)
  - Icon colour: emerald-600 (comfortable) | amber-500 (tight) | red-500 (short)
- Verdict line (text-lg/xl font-bold): "You're okay — £X to spare" | "Tight until {weekday} — £X in hand" | "Short before payday — £X to cover"
  - Estimated caveat in muted font-normal if applicable
- 3-column instrument grid (if `spendable_now` is set):
  - Each column: glass-tile, rounded-xl, px-3 py-2.5
  - Label: text-[11px] uppercase tracking-wide, slate-400
  - Figure: text-base font-semibold, slate-800 (dark: slate-100), tabular-nums
  - "Now": spendable_now in green if positive
  - "Bills": −bills_total
  - "Free": ±safe_to_spend (green if positive, red if short)
- Pace rate line (text-[13px] muted): "£X.XX/day to payday"
- Payday income line (text-sm): "Payday {weekday} · +£X lands"
- Freshness label (text-sm muted) if sync > 3 hours old
- CTA button (conditional):
  - If short: "See what's due ›" → /planning
  - If tight + high card debt: "See your cards ›" → /cards
  - (Suppressed if move item exists)

**Light mode hexes:**
- Label: #94a3b8 (slate-400)
- Figure (comfortable): #059669 (emerald-600 web class, NOT #10b981 which is emerald-500)
- Figure (tight): #f59e0b (amber-500)
- Figure (short): #ef4444 (red-500)
- Glass-tile bg: semi-transparent white overlay
- ⚠️ NOTE: tw.ts emerald600 constant is WRONG — verify against Tailwind CSS (#059669 is correct emerald-600)

**Dark mode hexes:**
- Label: #64748b (slate-500)
- Figure (comfortable): #34d399 (emerald-400)
- Figure (tight): #fbbf24 (amber-400)
- Figure (short): #f87171 (red-400)

**Unified index block below verdict card** (mt-3, rounded-2xl glass-card):
- Divider: divide-y divide-slate-100 dark:divide-slate-700/50
- Row 1: ValueDeliveredStat (Sparkles icon + "£X/mo saved" or "£X/mo potential")
- Row 2: Mirror button (ScanFace icon + "How your money behaves" + › chevron)

Both rows: min-h-[44px], hover:opacity-80, active:scale-98, focus ring, padding px-4

**Mobile mapping:**
SafeToSpendCard → native component. Use LinearGradient for glass-hero if needed (or solid with tone contrast). 3-col grid → View with row 3-column layout. Buttons → Pressable with scale animations.

---

### 4. REAUTH BANNERS (Conditional)
**What:** Provider connection expired alerts

**Per expired provider:**
- Alert card: bg-amber-50 dark:bg-amber-900/20, border amber-200 dark:amber-800, rounded-2xl p-4, flex gap-3
- Icon: AlertTriangle size-15, amber-500
- Text:
  - Headline: "TrueLayer needs reconnecting" (text-sm font-semibold amber-800)
  - Sub: "Transactions have stopped syncing." (text-[11px] amber-600 dark:amber-400 leading-tight)
- CTA button: "Reconnect" (bg-amber-500 hover:amber-600, text-white, text-xs font-semibold, px-3 py-1.5 rounded-lg, active:scale-95)

**Mobile mapping:**
Similar card structure. Icon from lucide-react-native. Button Pressable with scale. No icon size shrinking needed in RN if handled via style.

---

### 5. YOUR MONEY SECTION
**What:** Three KPI strips: Upcoming Bills, This Month/Cards, Insights spotlight

**Label header** (above all three):
- text-[11px] font-semibold uppercase tracking-wide, slate-400 dark:slate-500
- mx-4 lg:mx-0 (padding handled by parent)
- mb-3

**UpcomingBillsStrip:**
- Tapable button: glass-card rounded-2xl px-4 py-3, flex gap-3
- Flex items:
  - Icon container: w-9 h-9, rounded-xl, bg-amber-50 dark:bg-amber-900/30, flex center
    - CalendarClock icon size-17, amber-500
  - Content area:
    - Label: "Coming up · 14 days" (text-xs text-slate-400 dark:text-slate-500 font-medium) — NOT amber-400
    - Summary line: flex gap-2, flex-wrap mt-0.5
      - Parts rendered as `{count} due {label}` or `{count} {label}` (urgent parts in amber-500, later parts in slate-600 dark:slate-300)
      - Examples: "3 due tomorrow" "1 due today" "2 bills over the next 2 weeks"
  - Right align: "total out" label (text-xs text-slate-400 dark:text-slate-500) + amount (text-sm font-bold text-slate-700 dark:text-slate-200, GBP formatted)
- On tap: → /planning

**ThisMonthStrip:**
- Tapable button: glass-card rounded-2xl px-4 py-3, fade-in
- Label: "Last month" or "Since payday" (text-[11px] uppercase slate-400)
- Two variants based on days_into_period:
  - Closed (days ≤ 2): movement line (text-sm font-medium, emerald-600 if card_delta < 0) + cash line (text-sm slate-500)
  - Live: "Cards have [held steady|come down|gone up] {timeframe}" with amount emphasized in emerald or neutral
- On tap: → /month?which=last or /cards

**HomeInsightSpotlight:**
- Swipeable card: glass-card rounded-2xl overflow-hidden, pointer events captured for left-swipe
- Top-right dismiss button (X icon, grey, dismissible)
- Content layout p-4:
  - Chip: Penny gradient, label + icon emoji
  - Optional "New" badge (violet-500 bg, white text)
  - Return reason (if resurrected, text-[11px] amber-600)
  - Title (text-base font-bold slate-900)
  - Body (text-sm slate-500, line-clamp-2)
  - Savings estimate (emerald background, TrendingDown icon + amount)
  - "See all insights" link (text-sm violet-600, ChevronRight)
- On tap: → /insights?tab=save&insight={id}
- On left-swipe: dismiss, then fetch next insight
- On dismiss: dismissSpotlightInsight API call

**Mobile mapping:**
Render as native cards with similar styling. Swipe gesture handling → React Native's PanResponder or react-native-gesture-handler. Spotlight is one card (partial RN state exists).

---

### 6. PINNED INSIGHT CARDS (Conditional)
**What:** Fuel savings, grocery basket, chart widget (if user pinned them)

**Rendered only if:**
- FuelSavingsCard pinned AND !loading
- GroceryBasketCard pinned AND !loading
- PinnedWidgetCard (chart widget) pinned AND !loading AND homeTxns.length > 0

**Mobile mapping:**
Currently not in native mobile; marked for future. For now, render via WebView fallback or defer to web route.

---

### 7. YOUR ESTATE (ACCOUNTS GRID)
**What:** Top 3 accounts pinned/expired, then investments, then "+N more" button

**Header:**
- Label: "YOUR ESTATE" (text-[11px] uppercase tracking-wide slate-400)
- "Manage" button (text-xs font-semibold indigo-500, ChevronRight icon, → /accounts)
- mb-3

**Loading state:**
- grid grid-cols-2 gap-3
- 4 skeleton placeholders: h-28 bg-white dark:bg-slate-800 rounded-2xl animate-pulse shadow-sm

**Empty state:**
- Single card: "Connect your first bank" (text-sm font-semibold) + "Read-only access..." (text-sm slate-500)
- "Connect a bank" button (indigo-600 hover:indigo-700 active:scale-95, text-white, py-2.5 px-4, rounded-xl)

**Populated state:**
- grid grid-cols-2 gap-3
- Render topPickAccounts (up to 3, prioritizing expired, then pinned, then largest balances)
- Render first investment account (if exists)
- If hiddenAccountCount > 0: "+N more accounts" button (dashed border, slate-200 dark:slate-700, w-full, text-lg font-bold slate-400, → /accounts)

**AccountMiniCard (calm variant, grid=true):**
- Size: 2-column grid cell, h-auto (min-h ~ 7rem)
- Variant: calm=true, glass=true (glass-card or solid card)
- Content (p-4):
  - Top: flex justify-between
    - Bank initials badge (w-9 h-9, font-bold, background = provider brand colour)
    - Account type pill (text-[11px] uppercase, bg-slate-100 dark:slate-700, slate-500)
  - Name (text-sm font-medium, slate-600)
  - Subtype/provider (text-[11px] slate-400)
  - Balance (text-base font-semibold slate-900, num class, or "£••••" if hideNetWorth)
  - Tap → /accounts?id={id}

**InvestmentMiniCard (calm variant, grid=true):**
- Same grid layout as AccountMiniCard
- Top: provider brand gradient square (w-9 h-9, TrendingUp icon white)
- Type pill: "Investment"
- Provider name (text-[11px] slate-400)
- Updated date (text-[11px] slate-400)
- Value (text-base font-semibold, or "••••" if hidden)
- Tap → /accounts?tab=Investments

**Light mode card hexes:**
- Card: #ffffff, 1px border #f1f5f9, shadow-sm
- Text primary: #0f172a (slate-900)
- Text secondary: #94a3b8 (slate-400)
- Pill bg: #f1f5f9 (slate-100)

**Dark mode card hexes:**
- Card: #1e293b (slate-800)
- Text primary: #f1f5f9 (slate-100)
- Text secondary: #64748b (slate-500)
- Pill bg: #334155 (slate-700)

**Mobile mapping:**
Native View + Text stacks in 2-column layout via flexDirection: 'row'. Use tw.space and tw.color tokens. Provider badges as View with background image or initials text. Glass effect optional (render as solid card on older RN).

---

### 8. RECENT TRANSACTIONS (Desktop: right column, Mobile: full width)
**What:** Last 6 transactions (filtered: no micro-transfers, max 6)

**Header:**
- Label: "RECENT TRANSACTIONS" (text-[11px] uppercase slate-400)
- "See all" link (text-xs font-semibold indigo-500, ChevronRight → /spend?view=list)
- mb-3

**Loading state:**
- glass-card rounded-2xl overflow-hidden p-4 space-y-3
- 5 skeleton rows: flex gap-3
  - Dot: w-2.5 h-2.5 rounded-full animate-pulse
  - Name line: h-3.5 w-36 rounded animate-pulse
  - Date line: h-2.5 w-20 rounded animate-pulse
  - Amount: h-3.5 w-14 rounded animate-pulse

**Empty state:**
- glass-card rounded-2xl py-8 text-center
- "No transactions yet" (text-sm slate-400)

**Populated state:**
- glass-card rounded-2xl overflow-hidden
- divide-y divide-slate-50 dark:divide-slate-700
- 6 rows, each TransactionRow (non-micro-transfers only)

**TransactionRow:**
- Button: w-full px-4 py-3, flex gap-3, text-left, hover:bg-slate-50 dark:hover:bg-slate-700/40, active:bg-slate-100 dark:active:bg-slate-700
- Layout:
  - Icon (MerchantIcon): w-9 h-9 rounded-xl
    - If domain match → Google favicon (logoUrl service)
    - Else → category-colour background + initial text
  - Content: flex-1 min-w-0
    - Name: text-sm font-medium text-slate-800 dark:text-slate-100
    - Date + category: text-xs text-slate-500 dark:text-slate-400 mt-0.5
  - Amount (num class): text-sm font-semibold
    - If credit: emerald-500 (BOTH light and dark — no dark:emerald-400 variant)
    - If debit: text-slate-800 (light) / text-slate-100 (dark) — NOT slate-900
    - Format: ±£X.XX (currency-aware)
- On tap: opens TransactionSheet (detailed modal) with category edit affordance

**Light mode hexes:**
- Row hover: #f8fafc (slate-50)
- Row active: #f1f5f9 (slate-100)
- Text primary: #1e293b (slate-800)
- Text secondary: #64748b (slate-500)
- Credit: #10b981 (emerald-500)
- Debit: #1e293b (slate-800)

**Dark mode hexes:**
- Row hover: #1e293b with 40% opacity (slate-700/40)
- Row active: #1e293b (slate-700)
- Text primary: #f1f5f9 (slate-100)
- Text secondary: #94a3b8 (slate-400)
- Credit: #10b981 (emerald-500 — NOT emerald-400; same as light)
- Debit: #f1f5f9 (slate-100)

**Mobile mapping:**
FlatList with 6-item limit or ScrollView. Each row → native View + Text stack. Merchant icon logic same (web URL favicons work in RN Image). Category chip → category-colour square badge with initial or icon. On row press → navigate to transaction detail sheet (native modal).

---

## States

### Loading
- **Initial page load:** Loading flag true, all data null
  - SafeToSpend: skeleton (h-6 title line + 3-col grid placeholders)
  - Brief body: 2-line skeleton
  - Accounts grid: 4 account skeleton placeholders
  - Transactions: 5-row skeleton
  - All animate-pulse (bg-slate-100/700)

- **Per-fetch skeleton gates:** SafeToSpend and transactions each clear independently once their own API calls resolve. Brief clears when accounts call resolves + all "fast" promises settled.

### Empty (no accounts connected)
- SafeToSpend: renders nothing (insufficient_data)
- Brief body: contextual fallback text (depends on SafeToSpend state if available)
- Accounts grid: "Connect your first bank" CTA card
- Transactions: "No transactions yet"
- Reauth banners: none visible

### Error
- **loadError true:**
  - Dismisses most content
  - Shows: "Couldn't load your data — check your connection" + "Try again" button
  - On retry: resets all loading flags and re-fetches all data

- **syncError true:**
  - Brief body shows amber banner: "Sync didn't complete — try again in a moment"
  - Dismisses after 6s if user doesn't manually retry

### Populated (normal)
- All sections render with real data
- Brief items may be empty list (shows contextual fallback text)
- Accounts grid shows top picks + investment accounts
- Transactions list shows recent 6

### Edge cases
- **hideNetWorth preference:** all £ amounts masked as "£••••" across entire screen
  - Affects: SafeToSpend card, companion move items, account balances, investment values, transactions
- **No upcoming bills:** UpcomingBillsStrip renders nothing (all.length === 0)
- **No value delivered:** ValueDeliveredStat renders nothing (monthly and verified both 0)
- **No spotlight insight:** HomeInsightSpotlight renders nothing (insight null after load)
- **Expired providers:** amber reauth banner per provider, above "Where You Stand" section
- **Late sync (>3h):** freshness caveat in SafeToSpend card

---

## Interactions

### Taps & Navigation
- **Sync button:** calls `api.syncAll()`, then `loadData()`; disabled while syncing; shows spinning RefreshCw icon when active
- **Tutorial link:** TutorialTrigger component (web only; mobile: defer to menu or skip for now)
- **HomeBrief items:**
  - Celebration card → tap opens /mirror
  - Cliff/trajectory → dismiss button removes via `api.dismissTodayItem()`
  - Rhythm card → "A one-off" / "My new normal" buttons → `api.recordTrendIntent(category, answer)`; "I'd like to change this" → /spend with sessionStorage category preset
  - Ask:payday → "Yes, that's it" confirms, "No — set it myself" → /planning (calls `api.confirmPayday()` or `api.dismissTodayItem()`)
  - Ask:generic → CTA button routes to item.action.route, "Not now" dismisses via `api.dismissTodayItem()`
  - Needle card → "Review" link → /month?which=last
  - Move card → CTA (if present) routes to item.action.route
- **SafeToSpend CTA:**
  - Short state: "See what's due ›" → /planning
  - Tight+high card debt (card_debt ≥ £1000): "See your cards ›" → /cards
- **Unified index block (ValueDeliveredStat + Mirror row):**
  - ValueDeliveredStat row: tappable (hover:opacity-80, active:scale-[0.98]); route TBD (check ValueDeliveredStat.tsx)
  - Mirror row: "How your money behaves" with › chevron → /mirror
- **UpcomingBillsStrip:** entire button → /planning
- **ThisMonthStrip:** entire button → /month?which=last (if closed) or /cards (if live)
- **HomeInsightSpotlight:**
  - Tap card → /insights?tab=save&insight={encodeURIComponent(insight.id)}
  - Dismiss button (top-right X) → `api.dismissSpotlightInsight(insight.id)`, then fetch next
  - Left-swipe (velocity > 0.5 px/ms or distance > 35% width) → slide-out animation (200ms), then API call + load next
- **AccountMiniCard:** tap → /accounts?id={id}
- **InvestmentMiniCard:** tap → /accounts?tab=Investments
- **"+N more accounts" button:** → /accounts
- **"Manage" link:** → /accounts
- **"See all" (transactions):** → /spend?view=list
- **TransactionRow:** tap → opens TransactionSheet (modal detail)

### Sheets & Modals
1. **TransactionSheet**
   - Fields: merchant name, date, amount, category (editable with category picker)
   - On category change: calls `api.updateTransaction()`, updates all matching transactions if requested
   - Close button (X) or swipe-down dismisses sheet
   - On mobile: full-screen bottom sheet; on web: centred modal

### Swipes
- **HomeInsightSpotlight:** left-swipe (velocity > 0.5 px/ms or distance > 35% of card width) triggers dismiss animation: card translateX out (200ms), opacity fade (150ms), then `api.dismissSpotlightInsight()` call; next insight fetches and surfaces

### Pull-to-Refresh
- Mobile: ScrollView with RefreshControl
- On refresh: calls `loadData()` (full reset of all states)
- Spinner shown while loading

### Penny Entry Point
- Celebration cards (✦ emerald, identity milestones) tap to /mirror
- Move cards (Penny gradient chip) show structured transfer planning
- Ask cards and Rhythm cards trigger Penny advice flows
- HomeInsightSpotlight (indigo→violet chip) links to /insights

---

## Data

### API Endpoints (from frontend/lib/api)
All called from HomePage.tsx or child components:

- `api.accounts()` → Account[]
- `api.getInvestmentAccounts()` → InvestmentAccount[]
- `api.safeToSpend()` → SafeToSpend
- `api.getToday()` → { items: CompanionItem[] } (brief companion items)
- `api.allTransactions(90)` → Transaction[] (90-day history, filtered on client)
- `api.getPreferences()` → { home_pinned_accounts?: string[], home_pinned_widget?: string }
- `api.syncAll()` → void (triggers sync, used after user manual request)
- `api.cashflow()` → CashflowData (upcoming bills + income)
- `api.getNeedleSummary()` → NeedleSummary (this month verdict)
- `api.valueDelivered()` → ValueDelivered (savings stats)
- `api.getSpotlightInsight()` → SavingsInsight (single featured insight)
- `api.connectLink(providerId?)` → { auth_url: string } (bank connection OAuth)
- `api.dismissTodayItem(id)` → void (hide companion item)
- `api.dismissSpotlightInsight(id)` → void (hide spotlight, surface next)
- `api.recordTrendIntent(category, answer)` → void (rhythm card: answer is "one_off" | "new_normal")
- `api.updateTransaction(id, category)` → Transaction (edit transaction category)
- `api.confirmPayday()` → void (ask:payday card confirm action)

### Key Data Structures

**SafeToSpend:**
```typescript
{
  state: "comfortable" | "tight" | "short",
  status: "ok" | "insufficient_data",
  safe_to_spend: number,           // signed (positive = headroom, negative = gap)
  spendable_now: number | null,
  bills_total: number,
  estimated: boolean,
  payday_income?: number,
  card_debt?: number,
  next_payday: string,             // ISO date
  last_synced?: string,            // ISO timestamp
  pace?: { state: string; sustainable?: number },
}
```

**CompanionItem (brief):**
```typescript
{
  id: string,
  type: "ask" | "move" | "celebration" | "cliff" | "trajectory" | "rhythm" | "needle",
  headline: string,
  body?: string,
  action?: { label: string; route: string },
  secondary_action?: { label: string },
  // ... type-specific fields (move_map, plan_dest, payload for rhythm, etc.)
}
```

**Account:**
```typescript
{
  id: string,
  name: string,
  provider: string,
  provider_id?: string,
  type: string,
  subtype?: string,
  balance: number,
  status: "active" | "expired",
  currency: string,
}
```

**Transaction:**
```typescript
{
  id: string,
  account_id: string,
  description: string,
  merchant_name?: string,
  amount: number,
  date: string,             // ISO date
  category?: string,
  transaction_type: "debit" | "credit",
  currency: string,
}
```

**ValueDelivered:**
```typescript
{
  total_monthly_saving: number,
  verified_monthly_saving?: number,
  insights_acted_on: number,
}
```

---

## Current Mobile State & Gaps

### Current partial native implementation
- ✅ HomeHeader (greeting + sync button) — mostly matching
- ✅ NetWorthHero (KPI display) — exists but needs refinement to SafeToSpendCard spec
- ✅ GoalsCard — web route fallback
- ✅ ComingUpCard — partial, needs full UpcomingBillsStrip + ThisMonthStrip alignment
- ✅ SpotlightCard — exists, needs swipe gesture + full insight content
- ✅ AccountsGrid — exists, needs calm+glass variant alignment
- ✅ RecentTransactions — exists, needs transaction row polish + category display
- ❌ HomeBrief body — **NOT NATIVE** (ask/move/cliff/rhythm/celebration cards missing; currently just KPI stub)
- ❌ ValueDeliveredStat — partial (exists in web, not integrated mobile)
- ❌ Reauth banners — missing
- ❌ Pinned insight cards (fuel, groceries, chart widget) — not in mobile scope yet
- ❌ Mirror row — missing from index block
- ❌ Desktop 2-column layout — mobile is single-column (correct)
- ❌ Transaction detail sheet — tapping row doesn't open TransactionSheet

### Key diffs to reach 1:1
1. **HomeBrief full rebuild:** Implement all companion item card types from BriefBody logic: ask cards (bespoke payday confirm/decline + generic route), move cards (Penny gradient + destination/source ledger), cliff/trajectory cards (amber alert), rhythm cards (spend spike + intent buttons), celebration cards (✦ emerald-500 + dismiss), needle card. All using native View/Text stack + glass-card simulation. Order MUST match HomePage.tsx BriefBody (celebs → cliff → trajectory → rhythm → ask → needle → other → moves).

2. **SafeToSpendCard as distinct component:** Mobile NetWorthHero is a different data model (focus on net worth, not safe-to-spend verdict). Create a true SafeToSpendCard component that mirrors the web verdict structure: 3-col instrument grid (Now, Bills, Free), colour-coded state icon (ShieldCheck/AlertCircle/AlertTriangle), state-specific CTA ("See what's due ›" or "See your cards ›"). Data model is SafeToSpend, NOT NetWorthHero (safe_to_spend, spendable_now, bills_total, payday_income, card_debt, state).

3. **Unified index block below verdict:** Add ValueDeliveredStat row + Mirror row, divider between them (divide-y glass-card styling). Matching web px-4 py-3 button-like rows with hover/active states.

4. **Reauth banners:** Detect expiredProviders and render alert cards AFTER "WHERE YOU STAND" section, BEFORE "YOUR MONEY" KPIs. Amber alert card: icon + headline + body + "Reconnect" button.

5. **ThisMonthStrip full spec:** Currently ComingUpCard; extend to include closed-month variant (days_into_period ≤ 2, shows movement line + cash line) + live variant (since payday, shows verb-based copy like "Cards have gone up"). Exactly match web copy and styling.

6. **TransactionSheet:** Create native modal/sheet component for transaction detail. Tapping row should navigate to sheet with category picker. On save, call api.updateTransaction(). On mobile: full-screen bottom sheet or modal.

7. **Icon polish:** Ensure all lucide-react-native icons (CalendarClock, AlertTriangle, TrendingDown, ScanFace, Sparkles, AlertCircle, ShieldCheck, X, ChevronRight, RefreshCw) render correctly and match size/colour specs (all 14-17px range).

8. **Glass effect fallback:** On older RN versions, glass-card may render as solid white/slate-800 without backdrop-filter. Prefer solid card (better perf on mobile) if glassmorphic effect not available; maintain tone contrast for depth.

9. **HomeInsightSpotlight swipe gesture:** Implement left-swipe dismiss on SpotlightCard. Web uses onPointerDown/onPointerMove/onPointerUp with velocity calculation; mobile should use PanResponder or react-native-gesture-handler. Match velocity threshold (0.5 px/ms) and distance threshold (35% of width).

---

## RN Port Notes

### Icon Mapping (lucide-react → lucide-react-native)
All icons imported from `lucide-react-native`. Size props in RN are single number (not string):
- `<ChevronRight size={16} />` in web → `<ChevronRight size={16} />` in RN ✓
- `<AlertTriangle size={15} />` → same ✓
- Icons are exact parity; no renaming needed

### Chart / SVG Components
- **PinnedWidgetCard (chart widget):** Currently deferred; if needed, use `react-native-svg` + `expo-svg` or WebView embed
- **Status indicators / gradients:** Use `expo-linear-gradient` for Penny gradient (indig→violet 135°) and provider brand gradients

### Gradient Usage
- **Penny gradient chip:** 135° angle, indigo #4f46e5 → violet #7c3aed
  ```typescript
  import { LinearGradient } from 'expo-linear-gradient';
  <LinearGradient colors={['#4f46e5', '#7c3aed']} start={{x: 0, y: 0}} end={{x: 1, y: 1}}>
    <Text>✦ Penny</Text>
  </LinearGradient>
  ```
- **Provider brand gradients (InvestmentMiniCard):** Already in web as linear-gradient strings; extract to shared constants and use LinearGradient in mobile

### List Components
- **Transactions list:** Use `FlatList` with 6-item data array
- **Companion items (brief body):** Use `FlatList` or `View` with `space-y-3` (gap: 12px)
- **Accounts grid:** Use `View` with `flexDirection: 'row'`, two columns

### Text Size & Weight Mapping
All via `tw.text` + `tw.weight`:
- `text-[28px] font-bold` → `{...tw.text["3xl"], fontWeight: tw.weight.bold}`
- `text-[11px] font-semibold uppercase tracking-wide` → `{...tw.text["11"], fontWeight: tw.weight.semibold, letterSpacing: tw.tracking(0.025, 11), textTransform: 'uppercase'}`
- Use `tabular-nums` via fontVariant: 'tabular-nums' (RN support is platform-specific; fallback to default monospace font)

### Spacing
All via `tw.space`:
- `px-4 py-3` → `paddingHorizontal: tw.space[4], paddingVertical: tw.space[3]`
- `gap-3` → `gap: tw.space[3]`
- `mb-3` → `marginBottom: tw.space[3]`

### Colour
All via `tw.color`:
- `bg-slate-100` → `backgroundColor: tw.color.slate100`
- `text-emerald-600` → `color: tw.color.emerald600`
- Light/dark variants handled via `useTheme()` hook (existing); conditionally select `tw.color.slate50` vs `tw.color.slate900`

### Dark Mode
Use existing `const { dark } = useTheme()` in all components. Conditionally select colors:
```typescript
const bgColor = dark ? tw.color.cardDark : tw.color.cardLight;
const textColor = dark ? tw.color.slate100 : tw.color.slate900;
```

### Shadows
- `shadow-sm` → No direct RN equivalent. Use `Platform.select` to apply iOS-only shadow, or omit (rely on card tone contrast as per DESIGN.md One-Shadow-Rule)
- Preferred: use border + tone contrast instead of shadows

### Borders
- `border border-slate-100` → `borderWidth: 1, borderColor: tw.color.slate100`
- Hairline borders: use `HAIRLINE` constant from tw.ts

### Animation
- `active:scale-95` → Use `Pressable` with `onPressIn/Out` to animate transform
- `animate-pulse` → Use `react-native-reanimated` Animated.loop() or `LottieView` for skeleton
- `transition-transform duration-150` → Animated.timing() with 150ms duration

### Safe Area
- Use `SafeAreaView` from `react-native-safe-area-context` wrapping ScrollView
- Set `edges={["top"]}` or `edges={["top", "bottom"]}` per screen

### Modal / Sheet
- **TransactionSheet:** Use native `Modal` component + custom pan-to-close gesture, or `BottomSheetModal` from `react-native-bottom-sheet` library (if available; check package.json)
- **Companion item sheets (if any):** Same approach

### Keyboard Handling
- Category picker in TransactionSheet should use FlatList or Picker component
- Use `react-native-keyboard-aware-scroll-view` if sheet content scrolls and keyboard interaction needed

### RefreshControl
- Already used in current mobile/app/(tabs)/index.tsx
- `<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={...} />`
- Colour: indigo-600 (light) or slate-100 (dark)

---

## Open Questions / Risks

1. **Companion item rendering parity:** The web brief body renders many card variants (ask/move/cliff/rhythm/celebration) based on item.type. Mobile will need exact UI parity for each card family. Risk: missing edge case (e.g., ask:card_terms vs ask:payday both need correct button labels).

2. **Swipe gesture on insight spotlight:** Current mobile SpotlightCard doesn't implement left-swipe dismiss. Risk: PanResponder or gesture-handler adds complexity; ensure velocity thresholds match web (0.5 px/ms or distance > 35% of width).

3. **Category picker for transaction edit:** Mobile currently doesn't have native category picker in transaction detail. Risk: need to decide: inline Picker component or route to /spend category list?

4. **Hide net worth masking:** All £ amounts must be masked as "£••••" across the entire page when preference is set. Risk: missed in one component (e.g., companion item body text); recommend a utility function for masking and audit all calls.

5. **Glass card fallback:** On older Android or when backdrop-filter unsupported, glass-card will render as solid. Risk: visual inconsistency. Decision: should we always fallback to solid card (simpler), or attempt glassmorphic effect via opacity?

6. **Syncing across multi-fetch:** Home page has per-fetch skeleton gates (SafeToSpend clears on its own, transactions on theirs). Risk: if one API hangs, UX stalls. Current web handles this via Promise.allSettled(). Ensure mobile mirrors this—loadData should use Promise.allSettled or independent setters per fetch.

7. **Locale & currency:** Web uses `region` preference (UK vs Kenya). Mobile should respect SYM constant ("£" vs "KSh ") and locale-specific formatting. Risk: untested in Kenya region.

8. **Sticky header:** Web shows sticky header when greeting scrolls out (desktop only). Mobile: decide whether to implement sticky greeting row on home (may conflict with tab bar).

9. **Tutorial link:** Web triggers tutorial via TutorialTrigger component. Mobile currently routes to web (/web with tutorial=1 param). OK as interim, but if native tutorial UI is built, integrate it here.

10. **Pinned cards (fuel, groceries, chart):** Currently web-only feature. Mobile has no fuel/grocery/chart widgets yet. Risk: home screen feels incomplete without them. Suggest defer to Phase 2 or render via WebView embed.

---

## References
- Web design system: `DESIGN.md` (Calm Cockpit, Glass Card Rules, One Shadow Rule, Red Is Risk Rule, Penny Gradient Rule)
- Product positioning: `PRODUCT.md` (reassurance verdict engine, zero manual labour, honest estimates)
- Behaviour model: `BEHAVIOURS.md` (identity mirror, consent, paradoxes, checkpoints, proactive Penny)
- Canonical RN mapping: `mobile/docs/porting/00-foundation.md` (type, spacing, radius, colour, animation rules; refer to it rather than repeating table here)
- API: `frontend/lib/api.ts` (endpoint signatures and response types)
- Current mobile: `mobile/app/(tabs)/index.tsx` and `mobile/components/home/*`

---

**End of spec.** This document is the single source of truth for the Home screen mobile rebuild. Refer to it instead of reading web code directly; use web code only to validate specific edge cases or visual polish.
