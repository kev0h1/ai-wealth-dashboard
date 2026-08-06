# Screen: Budget / Trends

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** f17d90d 2026-08-05 16:42:59 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/budget/BudgetPage.tsx`

---

## STATUS: SUPERSEDED BY PLANNING — BUT ROUTE STILL LIVE

**Critical Finding:** The web app's PRIMARY navigation (`BottomNav` tabs) **no longer lists Budget**. It has been replaced by **Planning** (CalendarClock icon, `/planning` route). However:

1. The `/budget` route **still exists** and is **reachable via direct URL**
2. The page is fully functional but NOT navigable from the main nav
3. Mobile currently has a **"Budget" tab that is a WebView stub** pointing to `/budget`
4. **Recommendation:** Replace the mobile Budget tab with Planning tab to match web parity

**Evidence:**
- `frontend/components/BottomNav.tsx` line 54–60: Five tabs listed — Home, Spend, **Planning** (not Budget), Insights, Settings
- `frontend/app/budget/` still exists; `/budget` route still resolves
- `frontend/app/planning/` exists alongside it (commit 4af52d9)
- Grep search: No links to `/budget` in web nav; only API calls remain (`/api/budgets`, `/api/budget/chat`, etc.)

**Action for Kevin:** Confirm whether mobile Budget tab should be:
- Deleted and replaced with Planning tab (recommended for web parity)
- Kept as a direct `/budget` deeplink (if you want the Trends view available on mobile)
- Demoted to a sub-sheet within Planning (future refactor)

---

## Purpose

**Trends.** The Budget page is renamed "Trends" on the web and presents **pace data** — how your discretionary spending rate compares to your usual rate, category by category, within the current pay period. The page does NOT show traditional budget limits; instead, it surfaces anomalies (unusual multiples of your norm) and optional "aims" (checkpoints) you can set for specific categories if spending is out of the ordinary.

The page anchors on **one metric**: "THIS PERIOD" — discretionary spend so far vs. daily rate, updated live from transaction data. Below that, a "YOUR CHOICES" section lists every category where you spent money this period, ranked by impact, with annotations (rate/day, multiple of usual, % of total discretionary spend). Tapping a category opens a **CategorySheet** to review transactions or set an aim.

**AI Integration:** A Penny FAB (indigo→violet gradient button) in the bottom-right opens a **chat panel** where the AI can suggest budgets based on your spending history, apply suggested limits, and answer budget questions.

---

## Source Files

**Root page component:**
- `/root/ai-wealth-dashboard/frontend/app/budget/BudgetPage.tsx` (671 lines)

**Child/imported components:**
- `CategorySheet` → `/root/ai-wealth-dashboard/frontend/components/CategorySheet.tsx` (handles category drill-down, transaction review, aim setting via DoorBlock)
- `TransactionSheet` → `/root/ai-wealth-dashboard/frontend/components/TransactionSheet.tsx` (transaction detail, category override)
- `BottomNav` → `/root/ai-wealth-dashboard/frontend/components/BottomNav.tsx` (tab bar; Budget NOT listed)
- `Spinner` → `/root/ai-wealth-dashboard/frontend/components/Spinner.tsx` (loading state)
- `ChatMarkdown` → `/root/ai-wealth-dashboard/frontend/components/ChatMarkdown.tsx` (AI reply formatting)
- `ChatScrollLock` → Defined inline in BudgetPage.tsx (lines 48–51), not a separate component file

**Design tokens & utilities:**
- `DESIGN.md` (colour, spacing, typography, shadows)
- `frontend/lib/categories.ts` (CATEGORY_COLOURS map)
- `frontend/lib/categoryIcons.ts` (getCategoryIcon function)
- `frontend/lib/payPeriod.ts` (getPayPeriodWithConfig, formatPeriod, filterPeriod)
- `frontend/lib/usePeriodSwipe.ts` (swipe navigation for pay periods)
- `frontend/lib/api.ts` (API calls: paceDetail, getBudgets, setBudgets, budgetChat, etc.)

---

## Layout Anatomy (Top → Bottom)

### 1. Page Header (px-4 pt-6 pb-2)

**"Trends" title**
- Text: "Trends"
- Style: `text-xl font-bold text-slate-900 dark:text-slate-100`
- Spacing: 20px font-size, 16px line-height, 700 weight
- Light bg: implicit canvas #f0f2f7 | Dark bg: #0f172a

---

### 2. Period Navigation Card (px-4)

**Container:**
- Class: `glass-card rounded-2xl p-3`
- Border-radius: 16px (card)
- Padding: 12px (md)
- Light bg: white #ffffff (with glass effect) | Dark bg: slate-800 #1e293b
- Shadow: `shadow-sm` (light) or hairline border (dark)
- Touch action: Swipe-enabled (usePeriodSwipe hook)

**Layout: flexbox row, space-between**

**Left button (Previous):**
- Element: `<button>`
- Size: 44×44px (w-11 h-11)
- Icon: ChevronLeft (16px, slate-500 #64748b)
- Border-radius: `rounded-full` (9999px)
- Background: `bg-slate-100 dark:bg-slate-700`
- Active state: `active:bg-slate-200 dark:active:bg-slate-600`
- Disabled: `disabled:opacity-30`
- Disabled when: past oldest transaction date

**Center text block:**
- **Period label:** formatPeriod(start, end) → e.g., "1–31 Aug" or "1 Aug – 30 Sep"
  - Style: `text-sm font-semibold text-slate-700 dark:text-slate-200`
  - 14px, 600 weight
- **Current period badge** (only shown if offset === 0):
  - Text: "Current period"
  - Style: `text-[11px] text-slate-500 dark:text-slate-400 mt-0.5`
  - 11px, 400 weight, muted

**Right button (Next):**
- Element: `<button>`
- Size: 44×44px
- Icon: ChevronRight (16px, slate-500)
- Border-radius: `rounded-full`
- Background: `bg-slate-100 dark:bg-slate-700`
- Active state: `active:bg-slate-200 dark:active:bg-slate-600`
- Disabled: `disabled:opacity-30`
- Disabled when: already at current period (offset === 0)

---

### 3. Loading State (px-4 pt-8)

**Shown when:** `pageLoading` is true (detailLoading OR txLoading)

**Content:** Centered `<Spinner size={32} />` with `py-16` vertical padding

---

### 4. Unavailable State (px-4 mt-6)

**Shown when:** detail is null or detail.status !== "ok"

**Message:**
- Text: "Trends aren't available right now."
- Style: `text-sm text-slate-400 dark:text-slate-500`
- 14px body, muted secondary

---

### 5. Hero Card — THIS PERIOD (px-4, space-y-8 mt-4)

**Container:**
- Class: `glass-hero rounded-2xl p-4`
- Border-radius: 16px (card)
- Padding: 16px (lg)
- Light bg: white #ffffff | Dark bg: slate-800 #1e293b
- Shadow: `shadow-sm` (light) or hairline border (dark)

**Whisper label:**
- Text: "THIS PERIOD"
- Style: `text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500`
- 11px, 600 weight, +0.05em tracking, muted
- Margin bottom: 4px (mb-1)

**Money figure:**
- Element: `<span class="text-3xl font-bold text-slate-900 dark:text-slate-100">`
- Value: discretionarySoFar formatted (e.g., "£847")
- Font: 30px, 700 weight, tight line-height 1.2
- Colour: ink (slate-900 light / slate-100 dark)
- Hidden if `hideNetWorth` true → shows "£••" instead

**Secondary label:**
- Text: "spent on choices"
- Style: `text-sm text-slate-500 dark:text-slate-400 font-medium`
- 14px, 500 weight
- Gap from figure: 8px (gap-2)

**Tertiary line:**
- Format: `£{ratePerDay}/day · {daysLeft} days to payday`
- Style: `text-sm text-slate-500 dark:text-slate-400 mt-1.5`
- 14px, 400 weight, muted
- Hidden if `hideNetWorth` true → shows "£••/day" instead
- Days-left only shown if period not closed and pd.days_left != null

---

### 6. Notable Day Callout (px-1)

**Shown when:** detail.notable_day exists

**Format:**
- Date: Formatted as "Monday, 5 Aug" (full weekday + numeric day + short month)
- Text: `"{date} was {amount} — about {multiple}× your usual {weekday}."`
- Style: `text-[12px] text-slate-400 dark:text-slate-500 px-1`
- 12px, 400 weight, muted
- Amount hidden if hideNetWorth true

---

### 7. YOUR CHOICES Section (space-y-8, px-4)

**Whisper label:**
- Text: "YOUR CHOICES"
- Style: `text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3`
- 11px, 600 weight, +0.05em tracking

**List container (when choices.length > 0):**
- Element: `<div class="glass-card rounded-2xl overflow-hidden">`
- Border-radius: 16px
- Padding: none (managed per row)
- Light bg: white | Dark bg: slate-800
- Shadow: shadow-sm (light) / hairline border (dark)

**Each choice row (clickable if transactions exist):**

**Element:** `<button>` (or `<div>` if no txns)  
**Clickable state:** `active:scale-[0.99] transition-transform active:bg-slate-50 dark:active:bg-slate-700/40`

**Row layout: flexbox row, items-center, gap-3, px-4 py-3**
- Borders: First row no border; subsequent rows have `border-t border-slate-50 dark:border-slate-700`

**Category chip (left):**
- Element: `<span class="w-8 h-8 rounded-lg flex items-center justify-center">`
- Size: 32×32px
- Border-radius: 8px (chip)
- Background: `${colour}26` (15% alpha tint of category colour, computed in hex)
- Icon: lucide-react icon (15px) in full category colour
- Flex-shrink: 0 (never compresses)

**Category text block (middle, flex-1):**

- **Category name:**
  - Text: choice.category (e.g., "Eating Out")
  - Style: `text-sm font-medium text-slate-800 dark:text-slate-100`
  - 14px, 500 weight
  - Truncate: `truncate`

- **Subline 1 — rate metrics:**
  - Format: `{ratePerDay}/day · {multiple}× your usual · {shareOfDiscretionary}% of your spending`
  - Style: `text-[12px] text-slate-500 dark:text-slate-400 mt-0.5`
  - 12px, 400 weight, muted
  - Only shown if any fragment exists; joined with ` · ` (dot spacer)
  - Optional fragments:
    - `choice.rate_per_day` → `£{formatted}/day` (always present)
    - `choice.multiple != null` → `{toFixed(1)}× your usual`
    - `choice.share_of_discretionary != null` → `{Math.round(% × 100)}% of your spending`

- **Subline 2 — checkpoint aim (if present):**
  - Format: `£{spent} of your £{aim} aim · {daysLeft} {label}`
  - Days label: "last day" (≤0), "1 day left" (1), "{N} days left" (>1)
  - Style: `text-[12px] text-slate-500 dark:text-slate-400 mt-0.5`
  - Hidden if hideNetWorth true → shows `£•• of your £•• aim · {daysLeft}`

**Amount spent (right):**
- Element: `<span class="text-base font-bold tabular-nums text-slate-700 dark:text-slate-200">`
- Value: fmt(choice.spent) (e.g., "£892")
- Font: 16px, 700 weight, tabular-nums
- Flex-shrink: 0 (never compresses)

**Empty state:**
- Shown when: choices.length === 0
- Text: "Nothing spent on choices {this|yet this} period." (ternary on isClosed)
- Style: `text-sm text-slate-400 dark:text-slate-500 px-1`
- 14px, 400 weight, muted

---

### 8. Penny FAB (fixed)

**Position:** Fixed bottom-right, 14px above bottom nav (88px + safe-area-inset-bottom)

**Element:** `<button>`
- Size: 56×56px (w-14 h-14)
- Border-radius: 9999px (pill/full)
- Background: `BRAND_GRADIENT` (indigo #4f46e5 → violet #7c3aed, 135°)
- Shadow: `shadow-xl` + `ring-2 ring-white/40 dark:ring-white/25`
- Icon: MessageCircle (24px, white)
- Z-index: 60
- Tap feedback: Implicit (opens chat)
- `data-tutorial-id="tutorial-budget-chat"` for onboarding

---

### 9. AI Chat Panel (fixed, z-60)

**Shown when:** chatOpen === true

**Backdrop:** Blurred page (via ChatScrollLock component locking body scroll)

**Container:**
- Element: `<div role="dialog" aria-modal="true">`
- Position: Fixed bottom-right, same baseline as FAB (calc(88px + env(safe-area-inset-bottom)))
- Size: 340px wide, 480px tall; maxWidth 100vw − 32px
- Border-radius: 16px (card)
- Light bg: white #ffffff | Dark bg: slate-800 #1e293b
- Shadow: `shadow-xl`
- Layout: flex flex-col

**Header (flex-shrink-0, px-4 py-3):**
- Background: `BRAND_GRADIENT`
- Text colour: white
- Layout: flex items-center justify-between

**Left block:**
- Flex row, gap-2.5, items-center
- Avatar: 32×32px circle, `bg-white/20 backdrop-blur`, flex items-center justify-center
  - Icon: Sparkles (16px, white)
- Text block:
  - Title: "Penny"
    - Style: `text-sm font-bold` (14px, 700), white
  - Subtitle: "Budget help · Powered by Claude"
    - Style: `text-[11px] opacity-70` (11px, 400), white × 70%

**Right buttons:**
- Flex row, gap-2, items-center
- Reset button (`RotateCcw` icon, 16px):
  - Size: 36×36px (w-9 h-9)
  - Border-radius: 9999px
  - Background: transparent
  - Opacity: `opacity-70 hover:opacity-100`
  - Tap: Creates new chat session
- Close button (`X` icon, 20px):
  - Size: 36×36px
  - Same styling
  - Tap: setChatOpen(false)

**Messages area (flex-1, overflow-y-auto, px-3 py-3, space-y-2):**

**Each message:**
- Layout: flex flex-col, aligned left (assistant) or right (user)
- Message bubble:
  - User: Background `BRAND` (#4f46e5), white text, 14px, max-width 80%, `rounded-2xl rounded-br-sm`
  - Assistant: Background `bg-slate-100 dark:bg-slate-700`, slate-800/slate-100 text, 14px, max-width 80%, `rounded-2xl rounded-bl-sm`
  - Padding: px-3 py-2
  - Content: Plain text (user) or ChatMarkdown-rendered (assistant)
- Suggested budget card (if msg.suggestedBudgets):
  - Component: `<ApplyBudgetCard>`
  - Shows category → monthly_limit rows
  - Apply button with gradient background

**Loading indicator:**
- Shown when chatLoading === true
- Three bouncing dots (6px w-1.5 h-1.5 = 6px, slate-400), delayed animation

**Input area (flex-shrink-0, flex items-center gap-2, px-3 py-2, border-t border-slate-100 dark:border-slate-700):**

- **Input field:**
  - Element: `<input type="text">`
  - Placeholder: "Ask about your budget…"
  - Class: `flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2`
  - Border: `border border-slate-200 dark:border-slate-600`
  - Focus: `focus:ring-2 focus:ring-indigo-500`
  - Disabled: `disabled:opacity-40` (when chatLoading)

- **Send button:**
  - Element: `<button>`
  - Size: 36×36px (w-9 h-9)
  - Border-radius: 9999px
  - Background: `BRAND_GRADIENT`
  - Icon: Send (16px, white) or Loader2 animate-spin (16px, white) if loading
  - Disabled: `disabled:opacity-40`

---

### 10. Category Sheet (bottom sheet)

**Shown when:** openCategory !== null

**Component:** `<CategorySheet>`

**Passed props:**
- name: category name
- title: "Choices in {category}"
- total: spent in category
- count: transaction count
- transactions: filtered txn array
- sym: currency symbol
- onClose: setOpenCategory(null)
- onTransactionClick: → setOpenCategory(null), setSelectedTx(tx)
- door: (optional) DoorBlock props (aim setting, checkpoint, intent capture)

**Door block (if present):**
- category, multiple, suggestedAim, checkpoint, intent, doorEngaged, isCurrentPeriod
- onChanged callback to refetch paceDetail

---

### 11. Transaction Sheet (bottom sheet)

**Shown when:** selectedTx !== null

**Component:** `<TransactionSheet>`

**Passed props:**
- transaction: full Transaction object
- onClose: setSelectedTx(null)
- onUpdated: handleTxUpdated (sync back to main list)

---

## States

### Loading State
- `detailLoading` OR `txLoading` → spinner with py-16 padding
- Page content hidden

### Unavailable State
- `detail.status !== "ok"` → "Trends aren't available right now."
- Hero card, choices, FAB all hidden

### Empty State
- `detail.choices.length === 0` → "Nothing spent on choices {yet }this period."
- Hero card shown; choices section shows message

### Populated State
- Hero card with THIS PERIOD figure
- Optional notable-day callout
- YOUR CHOICES list with all categories
- Each category row shows:
  - Name + icon chip
  - Rate/day, multiple, % of discretionary
  - Optional checkpoint aim line
  - Total spent right-aligned

### Over-Budget / High-Multiple State
- **Visual indicator:** Multiple ≥ some threshold (e.g., 1.5×)
  - Category row remains calm; no red highlight
  - Multiple is stated in subline: "2.3× your usual"
  - DoorBlock offers intent capture: "Is this one-off or new normal?"
- **Checkpoint set:** Subline shows "£{spent} of your £{aim} aim · {daysLeft}"
  - If on-track: implicitly calm
  - If over-aim: no red; text remains muted
  - User can tap to cancel aim or review transactions

### Chat States
- **Initial:** First time opening chat → session created, greeting message shown
- **Message exchange:** User sends text → API call `/budget/chat` → assistant reply displayed
- **Suggested budgets:** AI includes `suggestedBudgets` → ApplyBudgetCard shown; user taps "Apply" → `api.setBudgets` called, feedback given
- **Loading:** Three bouncing dots during API call
- **Error:** "Sorry, couldn't reach the AI. Try again."

---

## Interactions

### Period Navigation
- **Swipe left/right:** Moves to prev/next period (via usePeriodSwipe hook)
- **Prev button:** onClick → setPeriodOffset(o => o − 1), disabled if canGoPrev false (past oldest txn)
- **Next button:** onClick → setPeriodOffset(o => Math.min(0, o + 1)), disabled if isCurrentPeriod

### Category Row Tap
- **Condition:** txns.length > 0 (at least one transaction)
- **Action:** setOpenCategory with full category detail, opens CategorySheet
- **Drill-down:** User can review transactions or set an aim via DoorBlock

### Transaction Tap (from CategorySheet)
- **Action:** setSelectedTx(tx), opens TransactionSheet for detail/edit
- **On update:** handleTxUpdated invalidates cache, re-syncs to main list

### DoorBlock Interactions (within CategorySheet)
- **State A — Live checkpoint:** Shows `£{spent}/{aim} · {daysLeft}`
  - "Cancel this aim" link → api.cancelCheckpoint(id) → refetchDetail()
- **State C — The ask (intent capture):** Shown when multiple ≥ 1.5 and no checkpoint yet
  - Radio/button group: "This is a one-off" or "This is my new normal"
  - Sets local intent state, user confirms → api call to save
- **After confirmation:** Checkpoint appears in next refetch

### Chat Interactions
- **Open FAB:** setChatOpen(true) → chat session initialized on first open
- **Send message:** Input text → sendMessage() → setMessages with user + assistant replies
- **Suggested budgets card:** Shows category → limit rows, "Apply this budget" button → applyBudgets() → api.setBudgets() → feedback message
- **Reset chat:** Reset button in header → newBudgetChatSession() → chatInitialised flag reset
- **Close chat:** X button → setChatOpen(false)

### Keyboard
- **Input field:** Enter key (without Shift) → sendMessage()

---

## Data

### API Endpoints

**GET /pace/detail?offset={periodOffset}**
- Returns: `PaceDetail`
- Fields: period (start, end, days_elapsed, days_left, closed), pace (state, actual, discretionary_so_far), choices (array), notable_day
- Cached/refetched on periodOffset change
- Error → detail.status = "unavailable"

**GET /budgets**
- Returns: `{ budgets: { category: string; monthly_limit: number }[] }`
- Fetched once on mount; used to merge suggested budgets

**GET /budget/chat/session**
- Returns: `{ session_id: string; messages: { role, content }[] }`
- Called when chat panel opens (if !chatInitialised)

**POST /budget/chat**
- Body: `{ messages: ChatMessage[], session_id?: string }`
- Returns: `{ reply: string; session_id?: string; suggested_budgets?: Budget[] }`

**POST /budget/chat/new**
- Body: `{}`
- Returns: `{ session_id: string; messages: [] }`
- Called on reset button in chat header

**PUT /budgets**
- Body: `{ budgets: { category: string; monthly_limit: number }[] }`
- Called when user applies suggested budgets

**Other (transitive via CategorySheet):**
- GET /checkpoints → Active aims
- POST /checkpoints → Create new aim (with category, amount, days)
- DELETE /checkpoints/{id} → Cancel aim
- See CategorySheet.tsx for door-specific calls

### Local State

**Page-level:**
- `detail: PaceDetail | null` — pace data, choices, notable day
- `budgets: Budget[]` — user's current budget limits
- `periodOffset: 0 | −1 | ...` — pay period navigation
- `openCategory: { name, title, total, count, transactions[], multiple, suggestedAim, checkpoint, intent, doorEngaged }` — category drill-down state
- `selectedTx: Transaction | null` — transaction detail state

**Chat-level:**
- `chatOpen: boolean`
- `messages: ChatMessage[]` — conversation history
- `inputText: string` — input field value
- `chatLoading: boolean` — API call in flight
- `sessionId: string | null` — backend session ID

### Transaction Schema (per Transaction type from @wealth/shared)
- id, date, amount, category, account_id, merchant, description, transaction_type ("debit" | "credit"), currency, etc.
- Used to populate CategorySheet lists

### PaceChoice Schema
```typescript
{
  category: string;
  spent: number;
  rate_per_day: number;
  multiple: number | null;           // {actual} / {usual}
  share_of_discretionary: number | null;
  txn_count: number;
  usual_rate_per_day: number | null;
  txn_ids: string[];
  checkpoint?: Checkpoint | null;
  intent?: "one_off" | "new_normal" | null;
  door_engaged?: boolean;
  suggested_aim?: number | null;
}
```

### Checkpoint Schema
```typescript
{
  id: string;
  aim_amount: number;
  spent_so_far: number;
  days_left: number;
  on_track: boolean;
}
```

---

## Current Mobile State

**Mobile Budget Tab:** `/mobile/app/(tabs)/budget.tsx`
- **Implementation:** WebView stub
- **Route:** Points to web at `/budget`
- **Status:** Functional but not maintained/upgraded separately

**What's needed IF Budget tab is kept:**

1. **PaceDetail fetching:**
   - Create hook `usePaceDetail(offset)` → fetch `/pace/detail?offset={offset}`
   - Handle unavailable state gracefully
   - Memoize to avoid refetch on every render

2. **Period navigation:**
   - Store offset state with pay-period config from PreferencesContext
   - Implement prev/next period logic (use `payPeriod` utility functions from shared backend)
   - Track `oldestTxDate` to gate prev button

3. **Category list rendering:**
   - Map over `detail.choices`
   - For each choice, render row with:
     - Category chip (icon + ~15% alpha bg)
     - Name, rate/day, multiple (if present), % discretionary (if present)
     - Spent amount right-aligned
     - Checkpoint aim line (if present)
   - Tap row → navigate to category detail screen

4. **Category detail screen:**
   - Accept category name as route param
   - Fetch transactions for category (via CategorySheet logic)
   - Display transaction list
   - Show DoorBlock (intent capture, aim setting) if multiple ≥ 1.5
   - Tapping transaction → transaction detail sheet

5. **Transaction detail sheet:**
   - Category override UI (if applicable)
   - Edit → sync back to list

6. **AI chat (Penny FAB):**
   - Same pattern as web: FAB button → chat panel overlay
   - Session-based conversation
   - Suggested budgets card + Apply button

7. **Styling:**
   - Use `mobile/lib/tw.ts` tokens throughout
   - Light/dark mode: `useColorScheme()` from react-native
   - Safe area: Wrap in `SafeAreaView` from `react-native-safe-area-context`
   - Bottom navigation: Position elements to respect 88px + safe-area-inset-bottom

---

## Recommended Tokens & Styles (for RN port if kept)

### Colors (from `tw.ts`)
- Canvas: `tw.color.canvasLight` / `tw.color.canvasDark`
- Card bg: `tw.color.cardLight` / `tw.color.cardDark`
- Card border: `tw.color.cardBorderLight` / `tw.color.cardBorderDark`
- Ink: slate-900 / slate-100
- Muted: slate-400
- Muted-deep: slate-500
- Category colour: Map to hex from CATEGORY_COLOURS (18-colour palette in `frontend/lib/categories.ts`)
- Brand: indigo-600 `tw.color.indigo600` (#4f46e5)
- Penny gradient: indigo-600 → violet-600 (`tw.color.violet600` #7c3aed)

### Typography
- Hero figure: 30px / 700 / leading-none (lineHeight = 30)
- Section label (whisper): 11px / 600 / tracking-wide (+0.025em = 0.275px @ 11px)
- Body: 14px / 400 / leading-5 (line-height 20)
- Small: 12px / 400 / leading-4 (line-height 16)

### Spacing
- Card padding: 16px (lg)
- Row padding: 12px vertical (md), 16px horizontal (lg)
- Hero: 20px xl
- Gaps: 12px (category chip to text)

### Radii
- Card: 16px (`tw.radius["2xl"]`)
- Category chip: 8px (`tw.radius.lg`)
- Button: 12px (`tw.radius.xl`)
- Pill (FAB, nav): 9999px (`tw.radius.full`)

---

## RN Port Notes

### Key Differences vs Web

1. **No gesture swipe library on mobile yet.** Implement period nav with prev/next buttons; add swipe later via `react-native-gesture-handler`.

2. **No backdrop blur in RN.** Modal background will be simple semi-transparent overlay; no glass effect.

3. **Bottom sheet:** Use `@react-native-menu/menu` or equivalent; or modal with custom bottom-to-top animation.

4. **Chat panel:** Implement as a full-screen modal or bottom sheet; React Native doesn't support fixed positioning like web.

5. **Safe area:** Respect `SafeAreaView` + `useSafeAreaInsets()` for notches.

6. **Category icons:** `lucide-react-native` provides the same icons; or fall back to emoji.

7. **Grid/flex:** React Native's `flexbox` is CSS-like but `View` layout is simpler — no `min-w-0` concept; use `flex: 1` for flex-grow.

8. **Typography:** No system font stack in RN; use platform-specific defaults (`'System'` on iOS, `sans-serif` on Android).

9. **Transactions cache:** Integrate with mobile's `useAllTransactions()` hook (if ported) or create mobile-native transaction hook.

10. **API integration:** Use same `/api` endpoints; ensure CORS headers match web auth token scheme.

---

## Open Questions / Risks

**For Kevin:**

1. **Budget vs Planning tab decision (CRITICAL):**
   - Should mobile keep the "Budget" tab pointing to `/budget`?
   - Should it be renamed to "Planning" to match web nav?
   - Or should Budget be merged into Planning as a sub-view?
   - **Recommendation:** Replace with Planning tab; Budget route becomes a deeplink-only fallback.

2. **Pace data refresh cadence:**
   - Currently refetches on periodOffset change; should it also poll on foreground/background?
   - Chat session: does it persist across app suspend/resume?

3. **Chat history persistence:**
   - Backend stores session; should mobile cache messages locally for offline viewing?

4. **Aim creation UX:**
   - DoorBlock's intent capture (one-off vs new-normal) is critical; ensure mobile wording is equally clear.
   - Does mobile show the same two-button choice, or different UX?

5. **Notable day callout:**
   - Web shows a single anomaly; should mobile always show it, or only on budget tab (not Planning)?

6. **Category colours:**
   - User overrides (ColourProvider) must be fetched/synced on mobile. Currently missing.

---

## Cross-Reference

- **Related screens:**
  - Planning tab (`/planning`) — bill tracking, income confirmation, upcoming cashflow — **RECOMMEDED MOBILE TAB REPLACEMENT**
  - Spend tab (`/spend`) — transaction list by category
  - Insights tab (`/insights`) — detected patterns, savings opportunities
  - Home tab (`/`) — hero safe-to-spend, upcoming bills, key metrics

- **Related documents:**
  - `03-planning.md` — Plan tab structure (if exists; cross-reference for tab rename decision)
  - `DESIGN.md` — Tokens, typography, named rules
  - `BEHAVIOURS.md` — Door/checkpoint/intent layer, Rhythm calendar
  - `mobile/docs/porting/00-foundation.md` — Design tokens, context providers, shared primitives

---

## Summary

**Budget/Trends is a live but navigation-superseded screen.** It presents pay-period pace data (discretionary spend vs. usual rate) category-by-category, with optional aim-setting via the Door framework. The web version is fully functional but NOT linked in primary nav — replaced by Planning. Mobile currently WebView-stubs it and should be upgraded (or replaced with Planning) to match web parity. The screen requires period navigation, category drill-down, transaction detail, and AI chat integration (Penny FAB). If kept as a mobile native rebuild, refer to CategorySheet logic for the door/aim-setting interaction pattern and ensure safe-area compliance for the FAB and chat panel.
