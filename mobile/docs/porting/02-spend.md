# Spend Screen Porting Guide

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 5ad21c0 2026-08-06 08:08:32 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/components/SpendPage.tsx`

---

## Purpose & Emotional Job

The Spend screen answers **"Where did my money go?"** — it drills from period totals (Spent/Income/Net) through category cards into transaction details. Every element supports the reassurance job: fast category sweep, optional income deep-dive, period navigation with swipe, and the **Door** pattern (checkpoints + "is this usual?" nudges) to handle spending anomalies without alarm.

**Emotional payoff:** Control and visibility. User sees their spending at three magnifications (summary pills → category grid → transaction list), and knows exactly which categories have checkpoints or anomalies.

---

## Source Files (Full Paths)

### Page Component
- `/root/ai-wealth-dashboard/frontend/app/components/SpendPage.tsx` — Main page logic: period nav, view switching (categories/list/trends), category aggregation, signals cache.

### Child Components
- `/root/ai-wealth-dashboard/frontend/components/SpendTrends.tsx` — Chart widget selector & renderers (pie, daily bars, period compare, size distribution, transport modes). Client-side only; uses Recharts + dnd-kit for reordering.
- `/root/ai-wealth-dashboard/frontend/components/CategorySheet.tsx` — Bottom sheet for category drill-down (list of transactions in category, the Door block for checkpoints/intent, collapsible tool launchers for fuel savings and grocery scanner).
- `/root/ai-wealth-dashboard/frontend/components/TransactionSheet.tsx` — Bottom sheet for single transaction edit (category selector, scope selector: just this / all from merchant / future from merchant).
- `/root/ai-wealth-dashboard/frontend/components/TransactionRow.tsx` — Single transaction row (merchant icon/favicon, name, amount, date; clickable).
- `/root/ai-wealth-dashboard/frontend/components/SegmentedControl.tsx` — Mobile view tab switcher (Categories / Transactions / Trends).
- `/root/ai-wealth-dashboard/frontend/components/CategoryRow.tsx` — Type-only import; exports `CategoryData` type used for aggregating spend by category.

### Shared Infrastructure
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` — `categorySignals()`, `patchTransaction()`, `similarTransactions()`, `oldestTransaction()`.
- `/root/ai-wealth-dashboard/frontend/lib/useAllTransactions.ts` — Memoised transaction fetch + cache; 60s TTL.
- `/root/ai-wealth-dashboard/frontend/lib/payPeriod.ts` — Period arithmetic: `getPayPeriodWithConfig()`, `prevPeriodWithConfig()`, `nextPeriodWithConfig()`, `filterPeriod()`, `formatPeriodLocal()`.
- `/root/ai-wealth-dashboard/frontend/lib/usePeriodSwipe.ts` — Touch swipe left/right to navigate periods (mobile).
- `/root/ai-wealth-dashboard/frontend/lib/categories.ts` — `CATEGORY_COLOURS` map.
- `/root/ai-wealth-dashboard/frontend/lib/categoryIcons.ts` — `getCategoryIcon()` mapping.

---

## Layout Anatomy: Top → Bottom

### 1. Header Section
**Light Background:** `#f0f2f7` / **Dark:** `#0f172a`  
**Padding:** `px-4 pt-6 pb-2`

#### Subheader Row (flex, space-between, items-center)
**Left column:**
- Label: `"Where your money goes"` — `text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide`
- Title: `"Spending"` — `text-xl font-bold text-slate-900 dark:text-slate-100`

**Right button:** "Manage" 
- Styling: `px-3 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700`
- Text: `text-xs font-semibold text-slate-600 dark:text-slate-300`
- Icon: `SlidersHorizontal` (lucide, 14px)
- Interaction: `active:scale-95 transition-transform`
- Action: Opens CategoryManagerSheet

#### Period Navigation Card (glass-card, rounded-2xl, p-3)
**On mobile:** Full width  
**On desktop (lg:):** Part of 2-column grid with summary pills

**Interior flex structure:**
- **Left button:** Previous period
  - `w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-700`
  - Icon: `ChevronLeft` (16px, colour #64748b)
  - Disabled when `canGoPrev === false`
  - Active: `bg-slate-200 dark:bg-slate-600`

- **Center:** Period label + current-period indicator
  - Label: `formatPeriodLocal(periodStart, periodEnd)` — `text-sm font-semibold text-slate-700 dark:text-slate-200`
  - Subtext (if current): `"Current period"` — `text-[11px] text-slate-500 dark:text-slate-400 mt-0.5`

- **Right button:** Next period
  - Same styling as left button
  - Icon: `ChevronRight`
  - Disabled when at current period

**Below nav buttons:**
- Settings button: `mt-2 mx-auto text-slate-500 dark:text-slate-400 text-xs flex items-center gap-1.5`
  - Icon: `Settings2` (12px)
  - Text: `"Pay period settings"`
  - Action: Opens PayPeriodSettingsSheet

#### Summary Pills Section (grid grid-cols-3 gap-2)
**Only shown when not loading.**

**Three equal pill cards (each is glass-card rounded-xl px-3 py-2.5):**
1. **Spent**
   - Label: `"Spent"` — `text-[11px] text-slate-500 dark:text-slate-400 mb-0.5`
   - Amount: `fmtSummary(summary.spent)` — `text-sm font-bold text-slate-900 dark:text-slate-100`

2. **Income (tappable)**
   - Label: `"Income"` (with chevron icon: `ChevronUp/Down` 10px)
   - Amount: `fmtSummary(summary.income)` — same styling
   - Interaction: `active:opacity-70 transition-opacity`
   - State: Toggled by `incomeExpanded`
   - Action: Expands income transaction drill-down below

3. **Net**
   - Label: `"Net"` — same label styling
   - Amount: Conditional colour
     - If `>= 0`: `text-emerald-700 dark:text-emerald-400`
     - If `< 0`: `text-slate-900 dark:text-slate-100`
   - Prefix: `"+"` if positive, `"−"` if negative

**Conditional: Income Drill-Down**
When `incomeExpanded && incomeTxns.length > 0`:
- Glass card, rounded-xl, overflow-hidden
- Header: `px-4 pt-2.5 pb-1` → `text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide` saying `"Income this period"`
- Body: Maps `incomeTxns` → `<TransactionRow>` components

#### View Switcher (mobile only)
**Hidden on desktop (lg:hidden)**
- `<SegmentedControl>` with options: Categories | Transactions | Trends
- Styling: `mt-3`
- Interaction: `value`/`onChange` drive the view state

---

### 2. Content Block — Conditional Rendering

**Desktop (lg):** All three views render simultaneously in a 2-column + 1-row grid.  
**Mobile:** Only the selected view (`view` state) renders.

#### A. Categories View

**Loading state:**
- Spinner (32px) centred in `py-16` container

**Empty state:**
- Glass card, `rounded-2xl p-8 text-center`
- Text: `"No spending in this period"` — `text-slate-500 dark:text-slate-400 text-sm`

**Populated state — Category grid (grid grid-cols-2 gap-3):**

Each category card (glass-card, rounded-2xl p-4, text-left, active:scale-95 transition-transform, flex flex-col gap-2, overflow-hidden):

**Interior layout:**
1. **Header row (flex items-center gap-2.5):**
   - **Tinted icon chip** (w-9 h-9, flex items-center justify-center, flex-shrink-0, rounded-xl)
     - Background: `${colour}26` (15% alpha tint of category colour)
     - Icon: category icon (lucide, 16px, full colour)
   - **Text column (min-w-0):**
     - Name: `text-sm font-semibold text-slate-800 dark:text-slate-100 truncate`
     - Subtext: `${count} txn${s}${multipleFragment}` — `text-[11px] text-slate-500 dark:text-slate-400 mt-0.5`
       - `multipleFragment = sig?.multiple != null ? ` · ${sig.multiple.toFixed(1)}× usual` : ""`

2. **Amount (text-lg font-bold text-slate-900 dark:text-slate-100):**
   - Formatted as `£${cat.total.toLocaleString(...)}`

3. **Spend bar (h-1.5 w-full rounded-full overflow-hidden):**
   - Track: `bg-slate-200 dark:bg-slate-700`
   - Fill: `width: ${Math.min(cat.pct, 100)}%`, colour from category colour

4. **Badge slot (inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]):**
   - Precedence: Checkpoint > "is this usual?" > Category quick-links
   - **Checkpoint badge** (if `sig?.checkpoint`):
     - Background: `bg-slate-100 dark:bg-slate-700/60`
     - Text: `text-slate-500 dark:text-slate-300`
     - Content: `£${Math.round(sig.checkpoint.spent_so_far)} of £${Math.round(sig.checkpoint.aim_amount)} aim` + ChevronRight icon
   - **"Is this usual?" badge** (if `sig?.multiple >= 1.5 && !sig?.door_engaged`):
     - Same styling
     - Content: `"is this usual?"` + ChevronRight icon
   - **Quick-link badges** (Transport/Groceries only; fallback):
     - Transport (only in CategorySheet when category is "Transport"): Fuel icon + `"Cheaper fuel nearby"` (collapsible tool launcher, not a badge on the card)
     - Groceries (only in CategorySheet when category is "Groceries" + Pro): ReceiptText icon + `"Scan & compare receipts"` (collapsible tool launcher, not a badge on the card)
     - No Debt quick-link badge on category cards (Debt badge is shown on the SpendPage category card itself, but not a quick-link inside the sheet)

**Untracked section:**
Appears below categories if `untrackedCategories.length > 0`.
- Collapsible header (glass-card, flex space-between p-4):
  - Left: `"Untracked"` label + `"Transfers — not counted in spend"` description
  - Right: Count badge + Chevron (up/down)
- When expanded: Same grid layout as categories (grid grid-cols-2 gap-3)

---

#### B. Transactions List View

**Loading state:** Spinner

**Empty state:** Glass card with `"No transactions in this period"` (or `"No payments over £250..."` if `largeOnly` filtered)

**Populated state:**
- Glass card, rounded-2xl, overflow-hidden
- Interior: `divide-y divide-slate-50 dark:divide-slate-700`
- **Optional filter banner** (if `largeOnly`):
  - Pill with indigo background: `bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-700/60`
  - Text: `"Payments over £250"`
  - Dismiss button: `"Show all"` text link
- Body: Maps `displayTxns` (filtered to `largeOnly ? txns >= £250 : all`) → `<TransactionRow>` components
- **Desktop (lg):** `max-h-[640px] lg:overflow-y-auto`

---

#### C. Trends View

Renders `<SpendTrends>` component.

**Loading state:** Spinner in `py-16` container

**Populated state:**
- Memoised widget stack (default: category pie + daily bars)
- Each widget has:
  - Toolbar (drag handle, menu, pin toggle, delete, add)
  - Chart rendering (pie / bar / etc.)
  - Tooltip on hover/click (Recharts)
- Callback on "Review Large" → filters to `largeOnly`, switches to list view, shows transient toast

---

## States (Loading / Empty / Error / Populated / Edge Cases)

### Loading States
1. **Initial page load:** `pageLoading = loading || txLoading` shows spinner in content areas.
2. **Period swipe:** Signals cache checks for hit; if miss, `fetchSignals()` runs async (no blank/flicker if cached).
3. **Signals fetch:** `refetchSignals()` is called after category changes; cache is invalidated.

### Empty States
1. **No categories (all periods, all users):** "No spending in this period" card.
2. **No transactions in list view:** "No transactions in this period" card.
3. **No transactions matching filter (largeOnly):** "No payments over £250 in this period" card.
4. **Income empty:** Income pill is still shown; drill-down does not render if `incomeTxns.length === 0`.

### Error States
- **Transaction fetch fails:** `useAllTransactions` returns empty array; page gracefully shows empty state.
- **Signals fetch fails:** Signals map becomes `{}` (falsy badge); card renders without multiple/checkpoint info.
- **Patch transaction fails:** User is notified (via saved toast), close sheet after 900ms anyway.

### Edge Cases
1. **Foreign currency transactions:** Filtered out of summary totals via `isHomeCurrency()`. List view still shows them with their own symbol.
2. **Multiple pay period configs:** Period state is re-initialised when config changes; offset resets to 0.
3. **Deep-link from RhythmCard:** SessionStorage key `wealth_open_category` is read on mount; if set, category is auto-opened once categories load.
4. **Oldest transaction boundary:** `canGoPrev` is `false` if `periodStart` is not after oldest transaction date.
5. **Refunds as credits:** Credits in non-Income categories net against category spend, not counted as income.

---

## Interactions

### 1. Period Navigation
- **Left/Right chevrons:** `handlePrev()` / `handleNext()` — slide to adjacent period, reset view to "categories".
- **Swipe:** `usePeriodSwipe` hook fires `onPrev`/`onNext` on left/right swipes (mobile).
- **Pay period settings button:** Opens PayPeriodSettingsSheet (modal for config: fixed, calendar month, variable anchor).
- **Keyboard:** None (not a tablist; swipe handles this on mobile).

### 2. View Switching
- **Mobile only:** SegmentedControl tabs (Categories / Transactions / Trends).
- **Desktop:** All views render side-by-side; no switcher.
- **Query param sync:** `?view=list` deep-link reads on mount and sets initial tab.

### 3. Category Drill-Down
- **Tap category card:** Sets `openCategory` state → `<CategorySheet>` portal opens.
  - Sheet displays all transactions in that category.
  - Shows the **Door block** (checkpoint/intent/ask).
  - Fuel/grocery quick-links appear inside.
- **Tap transaction in category sheet:** Sets `selectedTx` → CategorySheet closes, TransactionSheet opens.

### 4. Transaction Edit
- **Tap transaction row:** Sets `selectedTx` → `<TransactionSheet>` portal opens.
  - User selects new category from dropdown.
  - User selects scope: "Just this one" | "All from ${merchant}" | "Future from ${merchant}".
  - Fetch similar transactions for scope; show checklist.
  - Tap Save → API call, badge shows count saved, close after 900ms.
- **Action:** `handleTxUpdated()` clears transaction + signal caches, updates local state.

### 5. Income Expansion
- **Tap income pill:** Toggles `incomeExpanded`.
- If expanded and `incomeTxns.length > 0`: Renders drill-down card with all income transactions.
- Each row is clickable → opens TransactionSheet.

### 6. Untracked Toggle
- **Tap untracked header:** Toggles `untrackedOpen`.
- Expands grid of Transfer categories (Transfer in / Transfer out).

### 7. Manage Button
- Opens `<CategoryManagerSheet>` (category rules, reordering, icon overrides).

### 8. Trends Widget Interactions
- **Drag widgets:** Reorder via dnd-kit (desktop) or custom drag handlers (RN); order saved to preferences.
- **Pin widget:** Saves as pinned widget (displayed on Home).
- **Delete widget:** Removes from view; order recomputed.
- **Add widget:** Opens modal to add available widgets.
- **Chart tooltip:** Recharts tooltip on hover/click (dark slate background, 11px text).
- **"Review large":** Filters transactions to >= £250, switches to list view, shows toast "Showing payments over £250".

**Note:** Swipe-to-delete on transactions is NOT implemented in CategorySheet (neither web nor RN).

---

## Data: API Endpoints & Key Fields

### Endpoints (all in `/root/ai-wealth-dashboard/frontend/lib/api.ts`)

| Endpoint | Method | Purpose | Returns |
|----------|--------|---------|---------|
| `/spend/category-signals?offset=${offset}` | GET | Fetch signals (multiple, checkpoint, intent, door_engaged) for period | `{ signals: Record<string, CategorySignal> }` |
| `/transactions/oldest` | GET | Get oldest transaction date (bounds check for prev navigation) | `{ date: string \| null }` |
| `/accounts` | GET | List user's accounts | `Account[]` |
| `/subscription` | GET | Check if user is Pro (enables features) | `{ tier: "free" \| "pro" }` |
| `/transactions/:id` | PATCH | Update transaction category ± bulk update similar | `{ bulk_count?: number }` |
| `/transactions/:id/similar?scope=all\|future` | GET | Find similar transactions by merchant/description | `Transaction[]` |

### Key Type Definitions

```typescript
// Transaction (from API)
interface Transaction {
  id: string;
  account_id: string;
  merchant_name?: string;
  description: string;
  amount: number;  // always positive; direction in transaction_type
  transaction_type: "debit" | "credit";
  category?: string;  // user-assigned or AI-inferred
  currency: string;
  date: string;  // YYYY-MM-DD
}

// CategorySignal (per-period, per-category)
interface CategorySignal {
  multiple?: number;  // spend / historical average
  suggested_aim?: number;  // AI-suggested checkpoint amount
  checkpoint?: Checkpoint;  // active aim object
  intent?: "one_off" | "new_normal";
  door_engaged?: boolean;
}

// Checkpoint (active aim for a category)
interface Checkpoint {
  id: string;
  aim_amount: number;
  spent_so_far: number;
  days_left: number;
}

// PayPeriodConfig (user preference)
interface PayPeriodConfig {
  type: "calendar_month" | "fixed_day" | "variable_anchor";
  // ... fields vary by type
}
```

---

## Current Mobile State: DashboardWebView Stub

**File:** `/root/ai-wealth-dashboard/mobile/app/(tabs)/spend.tsx`  
**Current implementation:**
```typescript
import DashboardWebView from "@/components/DashboardWebView";
export default function SpendTab() {
  return <DashboardWebView initialPath="/spend" />;
}
```

**What DashboardWebView does:**
- Loads web app at `https://wealth.auriqltd.co.uk/spend` in a WebView (iframe-like).
- Passes auth token as URL param.
- Handles back navigation, theme sync, geolocation polyfill.
- No native Spend screen yet — entire UI is web-rendered.

**Fallback behaviour:**
- All interactions (category drill-down, transaction edit, period swipe) work via web.
- Performance: Network latency on every action; no offline support.
- Native gesture support (swipe period nav) is emulated via injected JS.

---

## To Build Native 1:1: Everything Required

### Components (React Native + NativeWind)
1. **SpendScreen** (replaces DashboardWebView)
   - Period nav (left/right chevrons, date label, settings button)
   - Summary pills (Spent / Income / Net)
   - View tabs (mobile only)
   - Conditional content rendering (categories / list / trends)

2. **CategoryGrid** (2-up layout, wrapped)
   - Card per category with tinted icon, name, count, amount, spend bar
   - Badge slot (checkpoint / "is this usual?" / quick-links)
   - Tap → CategorySheet

3. **CategorySheet** (RN Modal, rounded-t-3xl on mobile)
   - Header with category name + close button
   - Door block (checkpoint / intent ask)
   - Collapsible tool launchers (Fuel for Transport, Grocery Scanner for Groceries if Pro)
   - Transaction list
   - Max height: 80dvh (not 88dvh)

4. **TransactionSheet** (RN Modal, rounded-t-3xl on mobile)
   - Transaction details (merchant, date, amount, account badge)
   - Category selector (CustomSelect or PickerIOS)
   - Scope selector (Just this / All from merchant / Future from merchant)
   - Similar transactions checklist (if scope != single; scopes are "all" or "future" only, not "single")
   - Save button
   - Max height: 88dvh (on mobile); centered modal on desktop

5. **TransactionRow**
   - Merchant icon / initials
   - Name + description (truncate)
   - Amount (right-aligned, colour for credit/debit)
   - Date (small, muted)
   - Tap → TransactionSheet

6. **TransactionListView**
   - FlatList or ScrollView of TransactionRow
   - Optional filter banner (>= £250)

7. **TrendsView**
   - Widget stack (pie, daily bars, etc.)
   - react-native-svg for chart rendering
   - Drag & drop reordering (RN Gesture Handler)

### Styling (via `tw` tokens)

All numeric values (spacing, font size, radius, colour) come from `/root/ai-wealth-dashboard/mobile/lib/tw.ts`.

#### Key Tokens Used:
- **Spacing:** `tw.space[1]` (4px) through `tw.space[12]` (48px)
- **Type:** `tw.text.xs` (12px/16lh) through `tw.text.xl` (20px/28lh)
- **Radius:** `tw.radius.lg` (8px), `tw.radius.xl` (12px), `tw.radius["2xl"]` (16px), `tw.radius["3xl"]` (24px)
- **Colours (light/dark):**
  - Canvas: `tw.color.canvasLight` / `tw.color.canvasDark`
  - Card: `tw.color.cardLight` / `tw.color.cardDark`
  - Text: `tw.color.slate900` (light) / `tw.color.slate50` (dark)
  - Accents: `tw.color.indigo600` (brand), `tw.color.emerald500` (positive), `tw.color.amber500` (warning)

### State Management

Use `useState` + `useCallback` as in web (or Redux if already in mobile codebase). Key state:
- `periodStart`, `periodEnd` — current view period
- `periodOffset` — relative to today (0 = current, -1 = prev)
- `signals` — cache of category signals per period
- `view` — "categories" | "list" | "trends" (mobile only)
- `openCategory`, `selectedTx` — sheet open state
- `incomeExpanded` — income drill-down state
- `pageLoading`, `txLoading` — fetch states

### Data Hooks

Create RN equivalents of web hooks:
- `useAllTransactions()` — fetch + memoise (60s TTL)
- `usePayPeriodConfig()` — read from user preferences
- `useCategorySignals(offset)` — fetch + cache per offset
- `useColours()`, `useCategoryIcons()` — preference context

### API Client

Adapt `/root/ai-wealth-dashboard/frontend/lib/api.ts` → `/root/ai-wealth-dashboard/mobile/lib/api.ts` (or share via monorepo). Methods needed:
- `categorySignals(offset)` → fetch `GET /spend/category-signals?offset=`
- `patchTransaction(id, {category, additional_ids})` → `PATCH /transactions/:id`
- `similarTransactions(id, scope)` → `GET /transactions/:id/similar?scope=`
- `allTransactions()` → `GET /transactions` (filtered client-side)
- `oldestTransaction()` → `GET /transactions/oldest`
- `accounts()` → `GET /accounts`
- `getSubscription()` → `GET /subscription`

---

## RN Port Notes: Critical Details

### Spending Chart (React Native)

**Web uses:** Recharts (DOM-based, tooltip on hover/click)  
**RN port must use:** `react-native-svg` (Skia or SVG-based)

**Chart specs (from SpendTrends):**
1. **Category Pie (default):**
   - Inner radius: 24–38px (compact/normal)
   - Outer radius: 38–60px
   - Padding angle: 2.5°
   - Corner radius: 3px
   - Colours: Category colours (CATEGORY_COLOURS map)
   - No animation (isAnimationActive={false})
   - Tooltip (mobile click): dark slate (#0f172a/0.92 opacity), 11px text, padding 6px 10px, border-radius 10px

2. **Daily Bars:**
   - Bars per day from period start to today
   - X-axis: day labels (auto-tick every 1/2/end)
   - Y-axis: muted text (#64748b light, #94a3b8 dark)
   - Bar fill: Indigo (#6366f1)
   - Reference line: Slate-400 (#94a3b8) for average (dashed, labeled inside top-right)
   - Tooltip: Same style as pie

3. **Period Compare:**
   - 6-bar comparison (last 6 pay periods)
   - X-axis: period labels
   - Bar colour: Indigo (current period), light indigo (past periods)
   - No reference line (only Daily Bars has one)

4. **Transaction Sizes (size_distribution):**
   - Bands: <£5, £5–10, £10–25, £25–50, £50–100, £100–250, £250+
   - Bar chart of count or total spend per band (user toggles via "By spend" / "By count" buttons)
   - Tooltip: Same style as pie

5. **Transport by Mode (transport_modes):**
   - 90-day rolling average
   - Split bar (car/rideshare/public transit with branded colours: amber-400/blue-500/violet-500)
   - Mode rows below (name, monthly cost/mo, percentage, progress bar per mode)

**Port strategy:**
- Use `react-native-svg` + `react-native-svg-charts` (or implement custom canvas-based chart)
- Replicate exact dimensions, colours, and label formatting
- Swipe right-left to switch between charts (instead of widget carousel on web)
- Long-press for tooltip (since no hover on mobile)

### Swipe Gestures

**Web uses:** `usePeriodSwipe` (touch handlers on div)  
**RN port must use:** `react-native-gesture-handler` (PanGestureHandler)

**Interactions:**
1. **Period swipe (horizontal):**
   - Swipe left → `handleNext()`
   - Swipe right → `handlePrev()`
   - Velocity > threshold to trigger (no slow scroll)

**Note:** Transaction swipe-to-delete is NOT used in the current Spend page (neither web nor RN). CategorySheet does not support swipe deletion; this was a planned feature that is not implemented.

**Code pattern:**
```typescript
<PanGestureHandler onGestureEvent={...} onHandlerStateChange={...}>
  <Animated.View style={animStyle}>
    {/* content */}
  </Animated.View>
</PanGestureHandler>
```

### Bottom Sheets & Modals

**Web uses:** Recharts Tooltip + createPortal bottom sheets (slide-up from bottom, blur backdrop)  
**RN port must use:** `react-native` Modal + Animated

**Specs:**
1. **CategorySheet:**
   - Modal with transparent background
   - Child: rounded-top (`borderTopLeftRadius: 24, borderTopRightRadius: 24`)
   - Animated slide-up from bottom (280ms, cubic-bezier(0.32, 0.72, 0, 1))
   - Backdrop: black/40 opacity
   - Max height: 80dvh (both mobile and desktop)
   - Safe-area bottom padding respected

2. **TransactionSheet:**
   - Same animation as CategorySheet
   - Scrollable content (SafeAreaView with ScrollView)
   - Checklist for similar transactions (flat, not nested)
   - Max height: 88dvh (mobile bottom sheet); centered on desktop with 85dvh max

**Animation:** Use `Animated` API with easing function:
```typescript
Animated.timing(slideY, {
  toValue: 0,
  duration: 280,
  easing: Easing.bezier(0.32, 0.72, 0, 1),
  useNativeDriver: true,
})
```

---

## Open Questions & Risks

1. **Chart performance:** Recharts renders fast in web; RN SVG charts may lag on lower-end Android devices. Validate with Skia renderer vs SVG-based solution (vs fallback to native canvas via `expo-skia`).

2. **Signals cache strategy:** Web uses module-level cache (Map per offset, TTL 60s, in-flight dedup). On RN, decide: memory-only (app lifecycle) vs persistent (AsyncStorage, risk of stale data). Recommend memory-only + refresh on tab focus.

3. **Similar transactions UI:** Web shows a checklist in a scrollable sheet. RN modal height is fixed (88dvh); if many matches, list must scroll independently. Use FlatList inside the modal.

4. **Period swipe on desktop-sized iPad:** Web hides tabs on desktop via JS conditional render (`!isDesktop` checks matchMedia for 1024px breakpoint). On RN, if width > 1024, show all views simultaneously (grid layout) or hide tabs anyway? Recommend: hide tabs (keep mobile-first UX even on large screens).

5. **Offline support:** Web assumes constant connectivity. RN should handle:
   - Cache transactions on first load (AsyncStorage).
   - Show stale data if offline + refetch when online.
   - Disable "Manage" / category edits when offline.

6. **Deep-link from RhythmCard:** Web reads sessionStorage key `wealth_open_category`. On RN, use `Linking` + navigate to spend tab + pass category name as state/route param.

7. **Loading placeholders:** Web shows spinners. RN should use skeleton loaders (better perceived performance) or at least blur+fade for period swipe (cached data → no blank).

8. **Category quick-links (Fuel / Grocery only):** On web, quick-links inside CategorySheet are collapsible tool launchers (not direct navigation). Fuel (inside Transport category) → FuelSavingsCard; Grocery (inside Groceries category, Pro only) → GroceryBasketCard. On RN, adapt these to collapsible tool launchers inside the sheet, or navigate to dedicated screens if full-page UX is needed.

9. **Trends widget reordering:** Web uses dnd-kit (drag-drop-kit). RN should use `react-native-reanimated` + `react-native-gesture-handler` for drag reordering. Keep state in preferences (AsyncStorage or app state).

10. **Income drill-down on small screens:** On iPhone SE, three pills + income drill-down can overflow. Use ScrollView if needed; ensure safe-area-inset-top/bottom are respected.

---

## Canonical References

- **Design tokens:** `/root/ai-wealth-dashboard/mobile/lib/tw.ts`
- **RN parity rules:** `/root/ai-wealth-dashboard/mobile/PARITY.md`
- **Web source:** `/root/ai-wealth-dashboard/frontend/app/components/SpendPage.tsx` + all child components
- **API contract:** `/root/ai-wealth-dashboard/frontend/lib/api.ts` (categorySignals, patchTransaction, similarTransactions)
- **Design system:** `/root/ai-wealth-dashboard/DESIGN.md` (Calm Cockpit, colours, typography, "The Red Is Risk Rule", "The Category Voice Rule")
- **Behaviours:** `/root/ai-wealth-dashboard/BEHAVIOURS.md` (Door pattern, checkpoints, intent capture, Rhythm calendar)

