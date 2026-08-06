# Planning Screen: Web→Mobile Port

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 4af52d9 (2026-08-05 23:09:29 +0200)
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/planning/PlanningPage.tsx`

---

## Purpose & Emotional Job

The Planning screen is the **bills→covered→move loop** central hub. It shows what's coming this pay period (upcoming bills and income), flags at-risk payments (bills that can't be covered), and lets the user plan one-off expenses, edit predicted items, and manage their pay period settings.

**Behaviours alignment (BEHAVIOURS.md):**
- **Layer 2 — Mirror + Consent:** Upcoming bills are the primary feedback loop; editing them is identity-affirmation ("I know my real dates").
- **Layer 4 — Rhythms:** Pay period settings anchor the user's personal money calendar; the screen always reflects "now" within their chosen cycle.
- **Emotional job:** "Am I okay? Can I cover what's coming?" — runway figure + at-risk badge answer this directly.

**Design language (DESIGN.md / CALM COCKPIT):**
- Verdicts lead: runway figure (£X left) is the headline.
- Colour is information: red (rose) only when genuinely at risk; indigo for planned actions.
- At-risk badge (rose background, ⚠ icon) signals money can't cover bills before next payday.
- No nagging; clear next actions (edit, mark done, plan more).

---

## Source Files

**Web:**
- `/root/ai-wealth-dashboard/frontend/app/planning/PlanningPage.tsx` — main page component (926 lines)
- `/root/ai-wealth-dashboard/frontend/components/UpcomingEditSheet.tsx` — edit predicted bills/income (457 lines)
- `/root/ai-wealth-dashboard/frontend/components/PlanOneOffSheet.tsx` — add planned one-off expense (322 lines)
- `/root/ai-wealth-dashboard/frontend/components/PlannedEditSheet.tsx` — edit planned one-off (295 lines)
- `/root/ai-wealth-dashboard/frontend/components/PayPeriodSettingsSheet.tsx` — configure pay cycle (167 lines)
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` — API endpoints (see section 7 below)
- `/root/ai-wealth-dashboard/frontend/lib/payPeriod.ts` — pay period math (imported, not modified)
- `/root/ai-wealth-dashboard/frontend/components/BottomNav.tsx` — shared nav (not modified)

**Mobile (current):**
- `/root/ai-wealth-dashboard/mobile/app/(tabs)/budget.tsx` — **WebView stub, to be replaced**
- This doc drives a native Planning tab replacing Budget.

---

## Layout Anatomy: Web → Mobile

The Planning screen is a **fixed header + scrollable content + modal sheets** structure.

### Header Section (Fixed, no scroll)

**Header block:**
```
Px: 16 (mobile: env(safe-area-inset-top))
Py: 24
Slot:
  - Label (uppercase): "PLANNING" — fontSize 11, weight 600, uppercase, tracking-widest, text-slate-400 dark:text-slate-500
    - Light: #94a3b8  |  Dark: #64748b (tw.color.slate400 / slate500)
  - Title: "What's coming" — fontSize 20, weight 700 (text-xl font-bold), text-slate-900 dark:text-slate-100
    - Light: #0f172a  |  Dark: #f1f5f9 (tw.color.slate900 / slate100)
  - Mb (after label): 4px (0.5)
```

**At-risk callout (conditional, shown if `accountShortfalls.length > 0`):**
```
Bg: Rose (light) / rose-50 dark:rose-950/40
  - Light: #fff7ed → actual is rose-50 = #fef2f2
  - Dark: rgba(#7f1d1d, 0.4) custom dark rose depth
Border: 1px rose-200 dark:rose-900/60
  - Light: #fecdd3  |  Dark: rgba(#7f1d1d, 0.6)
Rounded: 2xl (radius.2xl = 16)
Px: 16 (4)  Py: 12 (3)
Icon: AlertTriangle, size 16, text-rose-600 dark:text-rose-400
  - Light: #e11d48  |  Dark: #fb7185
Text: "Your [bank] account is short before payday" (single shortfall) or "[N] accounts are short before payday" (multiple)
  - Title: fontSize 14, font-semibold, text-rose-900 dark:text-rose-100
    - Light: #431407  |  Dark: #fce7e6
  - Subtext: fontSize 12 (xs), text-rose-700 dark:text-rose-300, mt-2
    - Light: #b91c1c  |  Dark: #fca5a5
  - Show shortfall in format: "£[X] short for bills due before payday — move money in, or change a payment date."
  - Secondary action (Review button): Px 12 (3), Py 6 (1.5), min-h 44, rounded-lg, bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs
    - Light bg: #e11d48  |  Dark active: #dc2626
    - Callback: highlight first at-risk bill with smooth scroll
Button dismissal note: Px 4 (1), Py 8 (2), text-xs, text-slate-500 dark:text-slate-400 (subtext: "Payments can take a day or two to appear, so a very recent one may not be counted yet.")
```

### Main Content Area (Scrollable)

**Safe-to-spend runway card (if `available_balance != null`):**
```
Conditional style: if runwayNegative (runway < 0)
  - Bg: rose-50 dark:rose-900/20 (rgba(#7f1d1d, 0.2))
  - Border: 1px rose-200 dark:rose-800
else
  - Bg: glass-card (white/slate200 backdrop + opacity)
  - Border: none
Rounded: 2xl (16)
Px: 16 (4)  Py: 16 (4)

Layout (flex items-start justify-between gap-8):
  Left column:
    Label (text-[11px], font-semibold, uppercase, tracking-wide, text-slate-500 dark:text-slate-400, mb-2)
      - Light: #94a3b8  |  Dark: #64748b
      - Text: "Before month end" or "To last until payday" (depends on `isCalendarMonth`)
    Headline (runway figure): fontSize 24 (2xl), font-bold, tracking-tight, conditional colour
      - Positive: text-slate-900 dark:text-slate-100 (#0f172a / #f1f5f9)
      - Negative: text-rose-600 dark:text-rose-400 (#e11d48 / #fb7185)
      - Format: "£[X]" or "−£[X]" if negative
    Subtext (calculation): text-[11px], text-slate-500 dark:text-slate-400, mt-2, leading-snug
      - "£[available_balance] now − £[bills_total] bills · [N] days remaining" (calendar month) or "[payday_label] ([N] days)" (pay cycle)
  Right column (if accountShortfalls.length > 0):
    Badge: flex items-center gap-1.5, px-8 (2), py-4 (1), rounded-lg, bg-rose-100 dark:bg-rose-900/40, text-rose-600 dark:text-rose-400, text-[11px], font-semibold
      - Light: bg #fecdd3, text #e11d48  |  Dark: bg rgba(#7f1d1d, 0.4), text #fb7185
      - Icon: ⚠ (text)
      - Text: "[N] account / accounts short"
```

**Section: "Based on your typical spending — last 90 days"**
```
Text: text-[10px], text-slate-400 dark:text-slate-500, px-4 (1)
  - Light: #cbd5e1  |  Dark: #64748b
  - Muted statement: reassurance the figure is calculated from history, not static.
```

**Plan one-off button:**
```
Button (full width):
  Min height: 44 (11)
  Rounded: xl (12)
  Text: "+ Plan a one-off"
  Style: text-sm font-semibold
  Text colour: text-indigo-600 dark:text-indigo-400
    - Light: #4f46e5  |  Dark: #818cf8
  Background: transparent, hover:bg-indigo-50 dark:hover:bg-indigo-900/20
    - Light hover: #eef2ff  |  Dark hover: rgba(#3730a3, 0.2)
  Transition: transition-colors
  Focus: focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
```

**Debt plan link card (DebtEntryCard, if visible):**
```
Visibility gate: if (carried < 1 && float < 1) return null
  - Only shown if cards have meaningful balances (carried or float > 0)

Uppercase label: "YOUR CARDS" — text-[10px], font-semibold, uppercase, tracking-widest, text-slate-400 dark:text-slate-500, px-1, mb-2
Card button:
  Min height: 44 (11)
  Rounded: 2xl (16)
  Px: 16 (4)  Py: 12 (3)
  Style: glass-card
  Layout: flex-1 min-w-0 (text only) + flex-shrink-0 › (trailing icon)
  Content:
    NO icon badge — layout is flex-1 text + trailing › arrow only
    Title: "Card plan" — fontSize 15 (base-ish), font-semibold, text-slate-900 dark:text-slate-100, leading-snug
    Subtext (if cliff found): fontSize 13 (smaller), text-slate-500 dark:text-slate-400, mt-0.5, leading-snug
      - Highlight cliff date in amber if < 60 days: "Next 0% ends [date] — [card name]"
      - Date format: "Sep 2026" (fmtCliffMonth)
    Trailing icon: › (text-lg, text-slate-400 dark:text-slate-500, flex-shrink-0)
  Press: active:scale-[0.98], transition-transform
```

**Upcoming bills/income list (if not empty):**
```
Groups by days_away: "Today", "Tomorrow", "[N] days"
  - Labels: text-xs font-semibold uppercase tracking-wide
    - "Today" / "Tomorrow": text-amber-700 dark:text-amber-400
    - Others: text-slate-500 dark:text-slate-400

Each bill/income row (SwipeDismissRow component):
  Container: rounded-2xl, px-16 (4), py-12 (3), flex items-center gap-12
  State (flagged = at-risk or account short):
    At-risk: bg-rose-50 dark:bg-rose-900/20, border border-rose-200 dark:border-rose-800
    Normal: glass-card (light box shadow, dark border-based)
  Highlight (if scrolled into view): ring-2 ring-rose-400 dark:ring-rose-500
  
  Icon badge (flex-shrink-0):
    At-risk: w-8 h-8, rounded-lg, bg-rose-100 dark:bg-rose-900/40, text-rose-500, ⚠ icon (text, 14px)
    Normal: w-8 h-8, rounded-lg, bg-[colour]26 (6% tint of category), icon in full colour
  
  Content (flex-1 min-w-0):
    Name row (flex items-center gap-1.5):
      Name: text-sm font-medium
        - At-risk: text-rose-700 dark:text-rose-300
        - Normal: text-slate-800 dark:text-slate-100
      Type badge (if planned or edited): "planned" or "edited"
        - Bg: indigo-50 dark:indigo-900/30
        - Text: indigo-600 dark:indigo-400, text-[10px], font-semibold, px-1.5 (1.5), py-0.5 (0.5), rounded-md
    Account/shortfall info (conditional):
      If account_short: text-[11px] font-semibold text-rose-500 dark:text-rose-400, "[bank/account] · only £[balance] available"
      If at_risk (overall): text-[11px] font-semibold text-rose-500 dark:text-rose-400, "Overall balance will be low"
        - If bill has account info, add secondary line: account name (text-[11px] text-slate-400 dark:text-slate-500)
      Else if credit card: text-[11px] text-slate-500 dark:text-slate-400, account name (if present)
      Else: text-[11px] text-slate-400 dark:text-slate-500, account name (if present)
    Date: text-[11px] text-slate-500 dark:text-slate-400, formatted "Thu, 28 Aug"
    Pending status (if bill.pending && dpd >= 5): text-[11px], conditional colour
      - Debt category: text-red-600 dark:text-red-400, "Expected [date] — hasn't left. A missed card payment can mean fees, so worth checking today."
      - Other: text-slate-500 dark:text-slate-400, "Expected [date] — we haven't seen it leave. Worth checking with them."
      - Dismiss link: text-[11px] font-medium, text-slate-500 dark:text-slate-400, hover:underline, button text "Dismiss for this month"
  
  Amount (text-right, flex-shrink-0):
    Figure: text-base font-bold
      - Income: text-emerald-500 (#10b981)
      - At-risk: text-rose-600 dark:text-rose-400
      - Normal: text-slate-800 dark:text-slate-100
      - Format: "+£X.XX" or "−£X.XX" (thin dash, 2 decimals)
    Balance-after: text-[11px] font-medium
      - Positive: text-slate-500 dark:text-slate-400, "£[X] left"
      - Negative: text-rose-400, "−£[X] left"
  
  Swipe gesture (left):
    Reveal bg: rose-500 with "Not recurring" label and separate X icon (white, size 14)
    Opacity: reveals as user drags; opacity = Math.min(1, Math.abs(dx) / 80)

Empty state (if no upcoming items):
  Card (glass-card, rounded-2xl, p-32 (8) text-center):
    Text: text-sm text-slate-500 dark:text-slate-400, "Nothing more expected this pay period"
  Plan button (same as above)
  Debt card (same as above)
```

### Undo Snackbar (Fixed bottom)

**Shown conditionally when an item is dismissed or deleted:**
```
Position: fixed left-16 (4) right-16 (4) bottom-[calc(96px + env(safe-area-inset-bottom))]
Z-index: 70 (above content, below modals)
Animation: slideUpSheet (280ms cubic-bezier(0.32, 0.72, 0, 1))

Container:
  Bg: slate-900/95 dark:slate-100/95 (strongly opaque)
  Backdrop: blur
  Rounded: xl (12)
  Shadow: shadow-lg
  
Content:
  Layout: flex items-center justify-between gap-12 (3), pl-16 (4), pr-8 (2), min-h-48 (12)
  Message: text-sm font-medium, text-white dark:text-slate-900
    - "Planned payment deleted" or "Prediction removed"
  Undo button: text-sm font-bold, text-indigo-300 dark:text-indigo-600, min-h-44 (11), px-16 (4), rounded-lg
    - Active: active:bg-white/10 dark:active:bg-slate-900/10
  Progress bar (bottom): h-1.5 (3px), bg-indigo-400/90, animation "wdCountdown 6s linear forwards"
    - @keyframes wdCountdown: width 100% → 0% over 6s
```

---

## States

### Loading
```
Flex container: items-center justify-center py-64 (16)
Spinner: size 32, using Spinner component
Callback: api.cashflow() + api.accounts() + api.getDebtPlanView() load in parallel
```

### Empty (no upcoming items)
```
Glass card with centered text: "Nothing more expected this pay period"
"Plan a one-off" button
Debt card (if present)
```

### Error (network failure)
```
No dedicated error UI in current implementation; errors are caught in .catch(() => {})
Future: toast or error card above main content
```

### At-risk state
```
Rose callout at top: "Your [account] is short before payday"
At-risk bills: rose-50 background, ⚠ icon, rose text
Running balance turns negative: "−£[X] left"
```

### Pending bill (days_past_due >= 5)
```
Pending transaction: special subtext styling
Message: "Expected [date] — hasn't left. Worth checking with them."
Dismiss button (per-occurrence, not full dismissal)
```

### Edit mode (UpcomingEditSheet modal)
```
See section 6 (Interactions) for full sheet anatomy
```

---

## Interactions

### 1. Add Planned One-Off (PlanOneOffSheet)

**Trigger:** "+ Plan a one-off" button

**Sheet anatomy:**
```
Backdrop: fixed inset-0, bg-black/40, z-65, fade-in
Sheet: fixed inset-x-0 bottom-0, z-70
  Rounded: rounded-t-3xl (top only, 24)
  Max width: 500px (centered)
  Max height: 85dvh (scrollable)
  Glass-sheet background

Drag handle: centered, w-40 (10), h-1, bg-slate-200 dark:bg-slate-600, rounded-full, pt-12 (3), pb-4

Header: flex items-center gap-12 (3), px-20 (5), pt-8 (2), pb-12 (3)
  Title: "Plan a one-off" — text-base font-semibold
  Subtitle: "A payment you know is coming." — text-xs text-slate-500 dark:text-slate-400
  Close button: w-40 (10), h-40 (10), rounded-full, bg-slate-100 dark:bg-slate-700, text-slate-500 dark:text-slate-400, X icon
    - Active: bg-slate-200 dark:bg-slate-600

Content (scrollable, px-20 (5), space-y-12 (3)):
  Form state (if not saved):
    Name input: placeholder "Car service", min-h-48 (12), px-12 (3), rounded-xl, bg-slate-50 dark:bg-slate-700
      - Focus: ring-2 ring-indigo-500 ring-offset-2
    Amount input: prefix "£", placeholder "0.00", text-left tabular-nums, decimal inputMode
    Date input: min today, type="date", appearance-none
    Account selector (radiogroup): 
      - "Not sure yet" option (CircleDashed icon in light grey badge)
      - Spendable accounts (filter: exclude savings, credit, manual, negative balance)
      - Each account row: bank badge (logo/initials), name, provider, radio dot
      - Border: border-slate-200/70 dark:border-white/[0.08], divide-y, rounded-xl
      - Row interaction: click to select, active:opacity-70
    Error message (conditional): text-sm text-rose-600 dark:text-rose-400
    Submit button: "Plan it" (or "Planning…"), min-h-48 (12), w-full, rounded-xl, bg-indigo-600 text-white, disabled:opacity-60
  
  Confirmation state (if saved):
    Callout card: rounded-2xl, bg-indigo-50 dark:bg-indigo-900/20, px-16 (4), py-20 (5)
      - Message (text-sm font-semibold): constructed from impact.safe_to_spend_after
        - "Planned. You're still okay — £[X] in hand after this." (if positive)
        - "Planned. This tips your window £[X] short — a cover plan will appear on Home." (if negative)
        - "Planned. It's now in your upcoming bills." (if no impact data)
    Done button: w-full, min-h-48 (12), rounded-xl, bg-indigo-600 text-white, font-semibold
```

**Data sent to API:**
```
POST /planned
  name: string (required, trimmed)
  amount: number (required, > 0)
  date: string (required, ISO 8601, >= today)
  account_id?: string (optional, spendable account ID)
Response: { planned: PlannedExpense; impact: PlannedImpact }
  PlannedExpense:
    - id: string
    - name: string
    - amount: number
    - date: string
    - account_id?: string | null
  PlannedImpact:
    - safe_to_spend_before: number | null
    - safe_to_spend_after: number | null
    - state_after: "comfortable" | "tight" | "short" | null
```

---

### 2. Edit Predicted Bill/Income (UpcomingEditSheet)

**Trigger:** Tap/click on any upcoming bill or income row (non-planned)

**Sheet anatomy:**
```
Same backdrop + sheet structure as above, but:
Header icon: category colour badge (not rose)
Header text: "[name]" — "Predicted [date] · [sign]£[amount]"
Close button: standard

Content (scrollable):
  Date + Amount side-by-side (grid cols-2 gap-12):
    Date input: min-h-48, px-12, rounded-xl, bg-slate-50 dark:bg-slate-700, type="date"
    Amount input: prefix "£", min-h-48, pl-28 (7), pr-12, rounded-xl, tabular-nums
  
  Repeats section:
    Label: "REPEATS" — text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400
    If item.rule_label:
      Active rule row: Repeat icon, text (label), Remove button
        - Remove button: min-h-36 (9), px-8 (2), text-sm, text-slate-500 dark:text-slate-400, bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700, rounded-lg
    Else if not expanded:
      Collapsed button: "Set a schedule" — Repeat icon + text, min-h-44 (11), w-full, px-12, rounded-xl, bg-slate-50 dark:bg-slate-700, hover:bg-slate-100 dark:hover:bg-slate-600
    Else (expanded rule builder):
      Input: placeholder "e.g. every Sunday · last Friday of the month", min-h-48, px-12, rounded-xl, bg-slate-50 dark:bg-slate-700
      Error message (conditional): text-xs text-rose-600 dark:text-rose-400
      If rulePreview (preview visible):
        Card: rounded-xl, bg-indigo-50 dark:bg-indigo-900/20, p-12 (3), space-y-1.5
          - Title: rulePreview.label (text-sm font-semibold)
          - Dates: "Mon, 1 Sep · Fri, 5 Sep · …" (next 3 dates, formatted)
          - Buttons: "Apply schedule" (indigo), "Edit" (grey)
      Else (preview not yet shown):
        Button: "Preview" — min-h-44 (11), w-full, bg-slate-100 dark:bg-slate-700, text-slate-700 dark:text-slate-200, rounded-xl, font-semibold, disabled if no text
  
  Scope selector (SegmentedControl):
    Options: "Just this one" | "This & future"
    Explanation: "Only edits this occurrence" or "Updates every upcoming one until a real payment replaces it" (text-[11px] text-slate-400 dark:text-slate-500, mt-1.5)
  
  Error message (conditional): text-sm text-rose-600 dark:text-rose-400
  
  Action buttons (flex flex-col gap-8 (2), pt-4):
    Save: min-h-48 (12), w-full, rounded-xl, bg-indigo-600 text-white, font-semibold, disabled:opacity-60
    Reset to prediction (if item.edited): min-h-48, w-full, rounded-xl, bg-slate-100 dark:bg-slate-700, text-slate-700 dark:text-slate-200, font-semibold
    Skip this month (if item.type !== "income"): min-h-44 (11), w-full, rounded-xl, text-slate-500 dark:text-slate-400, bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700, font-semibold
    Not a bill / Not income (two-step confirm):
      Initial: min-h-44, w-full, rounded-xl, text-rose-600 dark:text-rose-400, bg-transparent hover:bg-rose-50 dark:hover:bg-rose-900/20, font-semibold
      Confirm step: flex items-center gap-8 (2)
        - Text: "Stop predicting this?" (text-sm text-slate-600 dark:text-slate-300)
        - Remove button: min-h-36 (9), px-12 (3), rounded-xl, bg-rose-600 text-white, font-semibold
        - Keep button: min-h-36, px-12, rounded-xl, text-slate-600 dark:text-slate-300, bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700, font-semibold
```

**Data sent to API:**
```
POST /cashflow/edit-upcoming
  key: string (item name)
  date: string (ISO 8601, original expected date)
  new_date?: string | null (if changed)
  new_amount?: number | null (if changed)
  scope: "one" | "future"

POST /cashflow/preview-rule
  key: string
  text: string (natural language rule, e.g. "every Sunday")
  anchor_date: string (ISO 8601, the date the rule applies to)
Response: { ok: boolean; error?: string; schedule?: Record<string, unknown>; label?: string; next_dates?: string[] }

POST /cashflow/apply-rule
  key: string
  schedule: Record<string, unknown> (from preview response)

POST /cashflow/clear-rule
  key: string

POST /cashflow/clear-override
  key: string
  date: string

POST /cashflow/skip-occurrence
  key: string
  date: string (original_date or expected_date, depending on pending status)
```

---

### 3. Edit Planned One-Off (PlannedEditSheet)

**Trigger:** Tap/click on any planned bill row (identified by `item.planned === true`)

**Sheet anatomy:**
```
Same backdrop + sheet structure; very similar to UpcomingEditSheet but simpler:

Header: planned item icon badge, "[name] — Planned [date] · −£[amount]"
Close button

Content (scrollable, px-20 (5), space-y-12):
  Name input: min-h-48, px-12, rounded-xl, bg-slate-50 dark:bg-slate-700
  Amount input: prefix "£", min-h-48, pl-28 (7), pr-12, rounded-xl, tabular-nums
  Date input: min-h-48, px-12, rounded-xl, type="date", min={today}
    - Note: date validation only rejects past dates if user changed it
  Account selector (radiogroup): same as PlanOneOffSheet
    - "Not sure yet" (default)
    - Spendable accounts list
  
  Error message (conditional): text-sm text-rose-600 dark:text-rose-400
  
  Action buttons (flex flex-col gap-8, pt-4):
    Save: min-h-48 (12), w-full, rounded-xl, bg-indigo-600 text-white, disabled:opacity-60
    Delete (no two-step confirm; deletion is undoable via snackbar): min-h-44 (11), w-full, rounded-xl, text-rose-600 dark:text-rose-400, bg-transparent hover:bg-rose-50 dark:hover:bg-rose-900/20, font-semibold
```

**Data sent to API:**
```
PATCH /planned/{planned_id}
  name?: string
  amount?: number
  date?: string
  account_id?: string | null
  (only changed fields sent)

DELETE /planned/{planned_id}
```

---

### 4. Pay Period Settings (PayPeriodSettingsSheet)

**Trigger:** Not directly accessible from Planning screen in current implementation; deep-linked via `sessionStorage.wealth_open_pay_period`

**Sheet anatomy:**
```
Backdrop: fixed inset-0, bg-black/40, z-65
Sheet: fixed bottom-0, left-1/2 -translate-x-1/2, w-full max-w-[430px], glass-sheet, rounded-t-3xl, z-70
  Max height: 88dvh
  Padding bottom: env(safe-area-inset-bottom)

Drag handle: pt-12 (3), pb-4 (1), centered w-40 h-1 rounded-full, bg-slate-200 dark:bg-slate-600

Header: flex items-center justify-between, px-20 (5), pt-8 (2), pb-16 (4)
  Title: "Pay Period" — text-base font-bold text-slate-900 dark:text-slate-100
  Close button: w-8 h-8, rounded-full, bg-slate-100 dark:bg-slate-700, X icon (colour: #64748b)

Mode selector (px-20, pb-16, space-y-8):
  Four radio button options:
    1. "Calendar month" — "1st to last day of each month"
    2. "Monthly pay date" — "Period starts on a fixed day each month"
    3. "Every two weeks" — "14-day periods from a reference payday"
    4. "Last weekday of month" — "Payday = last chosen weekday each month"
  
  Each button:
    Full width, flex items-start gap-12 (3), px-16 (4), py-12 (3), rounded-xl, text-left, transition-all
    Border-2 (not border)
    Selected: border-indigo-500, bg-indigo-50 dark:bg-indigo-900/20
    Unselected: border-slate-100 dark:border-slate-700, bg-slate-50 dark:bg-slate-700/40
    Radio dot (left): w-4 h-4 rounded-full border-2, flex-shrink-0, mt-2 (0.5)
      - Selected: border-indigo-500, inner dot bg-indigo-500
      - Unselected: border-slate-300 dark:border-slate-500
    Text (right):
      - Label: text-sm font-semibold, text-indigo-700 dark:text-indigo-300 (if selected) or text-slate-700 dark:text-slate-200 (if unselected)
      - Description: text-sm text-slate-500 dark:text-slate-400, mt-2 (0.5)

Sub-options (conditional, px-20, pb-16):
  If mode === "monthly_pay_date":
    CustomSelect: "Pay day of month" — dropdown 1–28
      - Label: text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400, mb-8 (2)
  
  If mode === "last_weekday_of_month":
    CustomSelect: "Day of week" — 0 (Sunday) to 6 (Saturday)
  
  If mode === "biweekly":
    CustomSelect: "Pay day" — 0–6 (weekday)
    Date input: "A known payday date" — min-h-48 (12), px-12, py-2.5, bg-slate-50 dark:bg-slate-700, rounded-xl, border-slate-200 dark:border-slate-600
      - Focus: ring-2 ring-indigo-500

Save button (px-20, pb-32 (8)):
  w-full, py-16 (4), rounded-2xl, bg-indigo-600 text-white, font-semibold, text-base, hover:bg-indigo-700, active:scale-[0.98]
  Text: "Save Pay Period"
```

**Data sent to API:**
```
PATCH /preferences
  pay_period_config: PayPeriodConfig

Possible PayPeriodConfig types:
  { type: "calendar_month" }
  { type: "monthly_pay_date"; day: number (1-28) }
  { type: "biweekly"; weekday: number (0-6); referenceDate: string (ISO 8601) }
  { type: "last_weekday_of_month"; weekday: number (0-6) }
  { type: "last_friday" } (legacy, not shown in new UI)
```

---

### 5. Swipe to Dismiss (SwipeDismissRow)

**Behaviour:**
- User swipes left on a bill row.
- Dismiss reveal grows: bg-rose-500, icon + label "Not recurring" or "Delete" (depending on planned vs predicted). X icon is separate (white, size 14).
- Dismiss fires at dx < −width×0.4 (~40% of element width) or flick (< 250ms, > 60px).
- Opacity fade reveals as user drags past ~80px (Math.min(1, Math.abs(dx) / 80)).
- Snackbar appears with Undo (6s timeout).

**Technical:**
```
onTouchStart: record initial x, y, time
onTouchMove: compute dx (translate-x)
  - Track dx displacement (negative = leftward)
onTouchEnd:
  - width = shellRef.current?.offsetWidth ?? 320
  - flick = elapsed < 250ms && dx < -60
  - if (dx < -width * 0.4 || flick): dismiss fires after 180ms
  - else: reset to 0
Reveal layer: 
  Absolute position, inset-0, bg-rose-500
  Opacity = Math.min(1, Math.abs(dx) / 80) — opacity ramps at 80px
  Flex items-center justify-end gap-1.5 pr-4
  Content: X icon (white, size 14) + label (white, text-xs font-semibold)
Content layer:
  Transform: translateX(${dx}px)
  Transition: transform 180ms ease-out (unless dragging)
```

---

## Data: API Endpoints & Key Fields

**Base URL:** `/api` (or `process.env.NEXT_PUBLIC_API_URL`)

### 1. Fetch Cashflow
```
GET /cashflow
Response: CashflowData {
  weekly_projection: CashflowWeek[]
  upcoming_bills: UpcomingBill[]
  upcoming_income: UpcomingBill[] (same schema as bills)
  avg_daily_spend: number
  available_balance: number
  next_payday: string | null (ISO 8601)
  payday_source: "confirmed" | "period" | null
  income_suggestion: IncomeSuggestion | null
}

UpcomingBill {
  name: string (e.g. "Netflix", "Salary")
  amount: number (always positive; direction from type field)
  expected_date: string (ISO 8601)
  days_away: number (0 = today, 1 = tomorrow, etc.)
  account_id?: string | null
  account_name?: string | null (e.g. "Current Account")
  account_bank?: string | null (e.g. "Starling", "Chase")
  account_balance?: number | null (account balance on expected_date)
  category?: string | null (e.g. "Subscriptions", "Bills", "Income")
  edited?: boolean (user overrode amount/date)
  rule_label?: string | null (e.g. "every Friday")
  pending?: boolean (payment sent but not cleared)
  original_date?: string | null (when bill was originally expected)
  planned?: boolean (user-added, not predicted)
  planned_id?: string (if planned)
  days_past_due?: number (if pending; count of days since original_date)
}
```

### 2. At-Risk Calculation
```
Computed client-side in PlanningPage.tsx (lines 164-210 for atRiskBills, lines 445-455 for item.at_risk):

TWO DISTINCT SIGNALS:

1. atRiskBills (per-account running balance):
   - Computed by simulating bill/income sequence on each account
   - Drives the flagged row: rose background + ⚠ icon
   - Shows "[bank] · only £[balance] available" message
   - Lines 164–210 of PlanningPage.tsx

2. item.at_risk (global cashflow running balance):
   - Computed as running total of all income/bills; going negative signals risk
   - Drives the "Overall balance will be low" subtext
   - Lines 445–455 of PlanningPage.tsx
   - balance_after = running total after this item

accountShortfalls: { accountId: string; bank: string; balance: number; shortfall: number }[]
  - For each account in atRiskBills, sum its upcoming bills and compare to balance
  - shortfall = billsSum - balance (if > 0)
  - Used to populate the top-of-page callout: "Your [bank] is short before payday"
```

### 3. Fetch Accounts
```
GET /accounts
Response: Account[] {
  id: string
  name: string (e.g. "Current Account")
  type?: string (e.g. "checking", "savings", "credit_card")
  subtype?: string (e.g. "saving", "credit")
  provider?: string (e.g. "Starling", "Chase")
  balance?: number
  manual?: boolean (true = manually added, not synced)
}
```

### 4. Fetch Debt Plan View
```
GET /debt-plan
Response: DebtPlanView {
  totals: { buckets?: { carried_total: number; float_total: number } }
  cards: Array<{
    name: string
    rate_schedule: Array<{
      source: "promo" | "standard"
      until?: string (ISO 8601, promo end date)
    }>
  }>
}
```

### 5. Add Planned Expense
```
POST /planned
Request: {
  name: string (required)
  amount: number (required, > 0)
  date: string (required, ISO 8601, >= today)
  account_id?: string (optional)
}
Response: { planned: PlannedExpense; impact: PlannedImpact }
  PlannedExpense {
    id: string
    name: string
    amount: number
    date: string
    account_id?: string | null
  }
  PlannedImpact {
    safe_to_spend_before: number | null (before this expense)
    safe_to_spend_after: number | null (after this expense)
    state_after: "comfortable" | "tight" | "short" | null
  }

Validation (client):
  - name.trim().length > 0
  - amount > 0
  - date >= today (ISO 8601 string)
```

### 6. Edit Upcoming Bill/Income
```
POST /cashflow/edit-upcoming
Request: {
  key: string (bill name)
  date: string (original expected date, ISO 8601)
  new_date?: string | null (if changed)
  new_amount?: number | null (if changed)
  scope: "one" | "future"
}
```

### 7. Preview Rule
```
POST /cashflow/preview-rule
Request: {
  key: string
  text: string (e.g. "every Sunday", "last Friday of the month")
  anchor_date: string (ISO 8601, the date this rule applies to)
}
Response: {
  ok: boolean
  error?: string (if ok === false, parse this for user-friendly message)
  schedule?: Record<string, unknown> (structured rule; opaque to frontend)
  label?: string (human-readable rule, e.g. "Every Friday at payday")
  next_dates?: string[] (ISO 8601 dates: the next 3 occurrences)
}
```

### 8. Apply Rule
```
POST /cashflow/apply-rule
Request: {
  key: string
  schedule: Record<string, unknown> (from preview response)
}
```

### 9. Clear Rule
```
POST /cashflow/clear-rule
Request: {
  key: string
}
```

### 10. Clear Override
```
POST /cashflow/clear-override
Request: {
  key: string
  date: string (ISO 8601)
}
```

### 11. Skip Occurrence
```
POST /cashflow/skip-occurrence
Request body: {
  key: string
  date: string (ISO 8601, the original_date or expected_date)
}
```

### 12. Dismiss Recurring
```
POST /cashflow/dismiss-recurring
Request body: {
  key: string
}
```

### 13. Restore Recurring
```
POST /cashflow/restore-recurring
Request body: {
  key: string
}
```

### 14. Update Planned Expense
```
PATCH /planned/{planned_id}
Request: {
  name?: string
  amount?: number
  date?: string
  account_id?: string | null
} (only changed fields required)
```

### 15. Delete Planned Expense
```
DELETE /planned/{planned_id}
```

---

## Current Mobile State & Gap

**Mobile Budget tab (current):**
- File: `/root/ai-wealth-dashboard/mobile/app/(tabs)/budget.tsx`
- Implementation: `<DashboardWebView initialPath="/budget" />` — a WebView stub
- Status: **No native Planning logic**

**Tab rename note:**
- Mobile currently shows tabs: Home, Spend, Budget, Insights, Settings (in BottomNav analogue)
- **After port:** Budget → Planning (navigation label change)
- **This replaces:** Mobile's Budget tab entirely with a native Planning screen

**To build natively:**
1. ✅ Main layout: header + scrollable content (FlatList or ScrollView)
2. ✅ At-risk callout (conditional rose background, AlertTriangle icon)
3. ✅ Runway card (headline figure + calculation breakdown)
4. ✅ Upcoming bills list (grouped by days_away)
5. ✅ Bill row styling (glass-card vs rose-flagged, icons, swipe dismiss)
6. ✅ Plan one-off button → PlanOneOffSheet (RN Modal)
7. ✅ Edit predicted bill → UpcomingEditSheet modal
8. ✅ Edit planned one-off → PlannedEditSheet modal
9. ✅ Pay period settings → PayPeriodSettingsSheet modal
10. ✅ Undo snackbar (conditional absolute positioning at bottom)
11. ✅ Swipe-to-dismiss row (PanResponder or react-native-gesture-handler)
12. ✅ Debt card link (optional; navigate to /debt-plan or standalone screen)

**Estimated effort:**
- **Core layout + list:** 150–200 lines (RN ScrollView + FlatList)
- **Modals (4 sheets):** 800–1000 lines (forms, inputs, validation, API calls)
- **Gesture (swipe dismiss):** 100–150 lines (PanResponder)
- **Styling + tokens:** 300–400 lines (all hex/radius/padding from tw.ts)
- **Total:** ~1500–2000 lines of code

---

## RN Port Notes

### Sheets → RN Modal

**Web:** `createPortal` + backdrop + animate slideUpSheet
**Mobile:** `<Modal animationType="slide" transparent={true}>` (or `@react-native-menu/menu` for sheet UX)

- Backdrop: `<Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />`
- Sheet container: SafeAreaView + paddingBottom for inset-bottom
- Drag handle: View with borderRadius, grey background
- Scrollable content: ScrollView with `nestedScrollEnabled={true}`
- Transitions: `useRef(new Animated.Value(0))` for slideUp if needed

### Icons

- `lucide-react` → `lucide-react-native` (same named exports, RN-compatible)
- Sizes: scale proportionally (web 16px → RN ~16, accounting for DPI)
- Colors: pass hex directly (e.g., `color="#4f46e5"`)

### Gradients

- **Penny gradient (indigo→violet):** Use `react-native-linear-gradient` or `expo-linear-gradient`
  ```tsx
  import LinearGradient from 'react-native-linear-gradient';
  <LinearGradient colors={["#4f46e5", "#7c3aed"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
  ```
- Other solid backgrounds: direct `backgroundColor` or `tw.color.*`

### Input Styling

**Web:** Tailwind classes (bg-slate-50, focus:ring-2, etc.)
**Mobile:** React Native `StyleSheet` + conditionals

```tsx
const inputStyle = {
  backgroundColor: isDark ? tw.color.slate700 : tw.color.slate50,
  borderRadius: tw.radius.xl,
  paddingHorizontal: tw.space[3],
  paddingVertical: tw.space[3],
  fontSize: tw.text.sm.fontSize,
  lineHeight: tw.text.sm.lineHeight,
  color: isDark ? tw.color.slate100 : tw.color.slate900,
};
<TextInput style={inputStyle} />
```

### Date Picker

**Web:** HTML `<input type="date" />`
**Mobile:** `@react-native-community/datetimepicker` or `expo-date-time` or custom picker

### Swipe Gesture

**Web:** `onTouchStart`, `onTouchMove`, `onTouchEnd` with dx tracking
**Mobile:** `react-native-gesture-handler` (PanGestureHandler) or `Animated.createAnimatedComponent(View)` with `PanResponder`

```tsx
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, { useAnimatedGestureHandler, useSharedValue, useAnimatedStyle } from 'react-native-reanimated';

const translateX = useSharedValue(0);
const gestureHandler = useAnimatedGestureHandler({
  onStart: (_, ctx) => { ctx.startX = translateX.value; },
  onActive: (event, ctx) => {
    translateX.value = Math.min(0, ctx.startX + event.translationX);
  },
  onEnd: (event) => {
    if (translateX.value < -80) {
      // Trigger dismiss
      translateX.value = runOnJS(onDismiss)();
    } else {
      translateX.value = withTiming(0);
    }
  },
});
```

### Responsive Layout

- **Mobile width:** typically 390–430px (base scale)
- **Padding:** use `tw.space[4]` (16px) for px-4 equivalents
- **MaxWidth on sheets:** 500px web → 100% mobile (or safe maxWidth on landscape)
- **Safe area:** wraps root; modals should respect it at bottom

### Color Tokens

All hex values from `/root/ai-wealth-dashboard/mobile/lib/tw.ts`:
```
Light mode: use canvasLight, cardLight, slate400–900, indigo*, emerald, amber, rose
Dark mode: use canvasDark, cardDark, slate50–600, same indigo/emerald/amber/rose
```

### FlatList vs ScrollView

**Planning list (upcoming bills):**
- Use `<FlatList>` for grouped sections (Today, Tomorrow, [N] days)
  - Wrap groups in `SectionList` or render groups in ScrollView
  - Item: `renderItem` → SwipeDismissRow
  - Separator: `divider` between groups

**Sheets (forms):**
- Use `<ScrollView nestedScrollEnabled={true}>` inside Modal
- `contentContainerStyle={{ flexGrow: 1 }}` to expand if content < sheet height

---

## Cross-Cutting Clarifications & Corrections

### Swipe Dismiss Threshold
- Dismiss fires at `dx < −width × 0.4` (~40% of element width), per line 894 of PlanningPage.tsx.
- The 80px value (line 907) is ONLY the opacity-fade threshold, not the dismiss trigger.
- Swipe labels are "Not recurring" (for recurring predicted items) / "Delete" (for planned items).
- The × is a separate `<X size=14>` icon rendered alongside the label, not part of the string.

### Pending Non-Debt Bill Message
- **Non-debt categories:** "Expected [date] — we haven't seen it leave. Worth checking with them." (PlanningPage.tsx:602)
- **Debt category specifically:** "Expected [date] — hasn't left. A missed card payment can mean fees, so worth checking today." (PlanningPage.tsx:601)
- Both have a "Dismiss for this month" button below the message.

### DebtEntryCard (Card Plan Link)
- NO icon badge in this card — the layout is flex-1 text (title + subtext) + flex-shrink-0 › (trailing arrow only).
- Visibility gate: if `(carried < 1 && float < 1) return null` — only show if cards have meaningful balances.
- The `hide` / `hideNetWorth` prop is passed but unused in the current implementation.

### At-Risk Signal Distinction
- There are TWO distinct signals — do not conflate them:
  1. **atRiskBills** (per-account running balance, lines 164–210): drives the flagged row (rose background + ⚠ icon) and "[bank] · only £[balance] available" message.
  2. **item.at_risk** (global cashflow running balance, lines 445–455): drives the "Overall balance will be low" subtext.

---

## Open Questions & Risks

1. **Pay period settings deep link:** Web uses `sessionStorage.wealth_open_pay_period`. Mobile should use deep linking or prop-based trigger. Decision needed: where is settings accessible on mobile? (Likely Planning header or Settings tab.)

2. **Debt plan card navigation:** Web routes to `/debt-plan`. Mobile needs a corresponding screen. Include in scope or link to WebView stub?

3. **Swipe dismiss UX on mobile:** iOS UX for swipe-dismiss typically reveals on left edge. Confirm final gesture design with Kevin before building.

4. **Undo snackbar position:** Web uses `bottom: calc(96px + env(safe-area-inset-bottom))` (above BottomNav). Mobile should respect `insetBottom` and tab bar height. Use `useBottomTabBarHeight()` or hardcode 60–80px.

5. **Empty state copy:** "Nothing more expected this pay period" — verify with Kevin if this is the final copy or if it should vary (e.g., "All bills covered — you're clear!").

6. **Rhythms integration:** BEHAVIOURS.md Layer 4 mentions rhythm checkpoints on this screen. Current web implementation doesn't surface them. Clarify: should Planning eventually show checkpoint suggestions here? Or is that Home-only for now?

7. **Category colours overrides:** API supports user-defined category colours. Fetch from `usePreferences()` or similar; apply to icon badges. Not blocked; same as web.

8. **Account balance sufficiency logic:** The at-risk calculation is complex (running balance simulation). Consider extracting to a shared utility (`lib/cashflow.ts`) to keep RN code dry.

9. **Accessibility:** RN has limited a11y support for complex interactions (swipe, modals, focus trap). Test with accessibility inspector; ensure announcements for at-risk status and snackbar undo.

10. **Dark mode detection:** Use `useColorScheme()` from React Native + ColorProvider context (likely already in mobile app). Ensure all `tw.color.*` lookups respect current scheme.

---

## Checkpoint Summary

**Web source:** frontend/app/planning/PlanningPage.tsx + 4 child sheets  
**Mobile target:** mobile/app/(tabs)/(native screen replacing Budget tab)  
**Tab rename:** Budget → Planning  
**Key states:** loading, empty, at-risk, populated, pending  
**Sheets:** PlanOneOff, UpcomingEdit, PlannedEdit, PayPeriodSettings  
**Gestures:** swipe-left dismiss, scroll, modal animations  
**API calls:** ~15 endpoints; key: cashflow, accounts, debt-plan, plus CRUD on planned/upcoming  
**Styling:** glass-card, rose (at-risk), indigo (actions), category colours, dark mode  
**Scope:** ~1500–2000 RN lines + shared utils; 2–3 week effort  

---

**End of 03-planning.md**
