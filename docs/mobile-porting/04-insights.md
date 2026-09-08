# Screen: Insights (Main + Receipts + Tax Sub-Screens)

## Checkpoint

```
Web source reflected at commit: 5ad21c0 (2026-08-06)
Last change to this screen's source: f17d90d 2026-08-05 16:42:59
Find future changes: git log 5ad21c0..HEAD -- frontend/app/insights/
```

---

## Purpose & Emotional Job

The **Insights** tab is the "behavioural intelligence" surface — a place to discover savings opportunities, understand spending patterns, and manage tax efficiency. Its core emotional job is **permission**: validated insights (Sparkles badges for "New", green checkmarks for "Done") give users permission to act, while the "Ways to Save" section handles the discovery loop.

Three distinct screens:
1. **Main Insights Page** (`/insights`) — Primary hub: Savings (net goal), Ways to Save (AI insights), Tax Efficiency (high earners only).
2. **Receipts Sub-Screen** (`/insights/receipts`) — Receipt scanning & basket tracking for grocery price intelligence.
3. **Tax Sub-Screen** (`/insights/tax`) — Tax planning checklist + FAQ chat (Penny gradient, high-earner feature).

---

## Source Files (All Paths Absolute)

### Main Pages
- `/root/ai-wealth-dashboard/frontend/app/insights/InsightsPage.tsx` (~2001 lines)
- `/root/ai-wealth-dashboard/frontend/app/insights/receipts/ReceiptsPage.tsx` (~150+ lines)
- `/root/ai-wealth-dashboard/frontend/app/insights/tax/TaxPage.tsx` (~700+ lines)

### Component Children & Shared Imports
- `/root/ai-wealth-dashboard/frontend/components/FuelSavingsCard.tsx` — Fuel price lookup by location.
- `/root/ai-wealth-dashboard/frontend/components/GroceryBasketCard.tsx` — Receipt scanning + basket insights.
- `/root/ai-wealth-dashboard/frontend/components/TransportInsights.tsx` — Breakdown by transport mode (car, taxi, rail, PT).
- `/root/ai-wealth-dashboard/frontend/components/TaxChat.tsx` — Penny gradient chat FAB + floating panel for tax Q&A.
- `/root/ai-wealth-dashboard/frontend/components/ChallengesPanel.tsx` — Challenge tiles (easy/medium/stretch tiers).
- `/root/ai-wealth-dashboard/frontend/components/MoneyBasicCard.tsx` — Rotating education card ("grow" section).
- `/root/ai-wealth-dashboard/frontend/components/ConfirmDialog.tsx` — Delete confirmations.
- `/root/ai-wealth-dashboard/frontend/components/SegmentedControl.tsx` — Tab switcher for Savings | Ways to Save | Tax.
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` — API types (`SavingsInsight`, `Basket`, `BasketInsights`, `TransportSummary`, `FuelNearby`, etc.).

---

## Layout Anatomy

### **MAIN PAGE: InsightsPage.tsx**

**Page Flow (Mobile / Tabbed)**  
- **Header** — Glass-hero card (mx-4 mt-4 rounded-3xl, NOT sticky). **Title changes per tab**: "Grow your money" (Savings) / "Ways to save" (Ways-to-Save) / "Tax efficiency" (Tax). Icon chip (category-coloured) + stat/progress bar visible per tab.
- **Tab Switcher** — SegmentedControl: "Savings" | "Ways to save" | "Tax" (only if income ≥ £100k).  
  Light: bg-slate-50 dark:bg-slate-700/40, rounded-xl, 12px radius, 8px gap between tabs. Badge on "Ways to save" shows newInsightCount (clears on open).
- **Content Container** — Scrollable below tab bar.

**Tab 1: Savings**
1. **Next £100 Card** — Optional; only if ≥2 actions apply (buffer/debt/pension/invest).
   - Header: "Where should your next £100 go?" (accordion).
   - List: numbered steps (1: Starter buffer, 2: Credit card debt, 3: Pension, 4: Full goal).
   - Token: `rounded-2xl`, `bg-white dark:bg-slate-800`, `shadow-sm`, `p-4`, text-base/bold/slate-900.
   
2. **Safety Net Card** — Emergency fund tracker.
   - States: **Setup** (not configured), **Tracking** (configured), **Funded** (100%).
   - **Setup Mode:**
     - Icon: Shield (emerald-600).
     - Title: "Build your safety net".
     - Description: "An emergency fund of 3–6 months' spending protects you from surprises."
     - Target choice: 3 buttons (3 months | 6 months | Custom) — bg-emerald-600 when selected, white text.
     - Accounts list: Collapsible, checkboxes, manual account add/edit.
     - CTA: "Start tracking" button (emerald-600, full width).
   - **Tracking Mode:**
     - Progress ring: SVG circle, 52×52px, emerald accent (#059669).
     - Verdict: "~X days covered" | "Safety net funded 🎉".
     - Timeline: "At £X/mo spare → 1 month covered by [date]".
     - Edit button: top right, emerald-50 pill.
   - Token: `glass-card` (border-slate-100 dark:border-slate-700), `rounded-2xl`, `p-4`, `shadow-sm`.
   - Typography: Base font-bold slate-900 (verdict), sm font-medium slate-500 (timeline).

3. **Savings Plan Card** — Ordered steps (when safety net configured).
   - Title: "Your savings plan" / "Plan complete! 🎉" (no "Pay off £X debt" variant).
   - Milestone list (ALWAYS visible, not collapsible): Shows m.text, m.done, optional target fields. No "amount + date per step" variant.
   - Token: `glass-card`, `rounded-2xl`, `p-4`.

4. **Ready to Grow Card** — When safety net 100% & no debt.
   - BG: emerald-50 dark:emerald-900/30, border emerald-200 dark:emerald-800.
   - Icon: Sparkles (emerald-600).
   - Title: "Your safety net is funded — ready to grow?"
   - Education items: 3 topics (rotating), emoji + label.
   - Token: `rounded-2xl`, `p-5`, border.

**Tab 2: Ways to Save**
1. **Section Header & Refresh** — "Ways to save" title + Refresh button (text-indigo-600, icon 14px, animate-spin on loading).
   - Typography: text-base font-bold, text-sm text-slate-500 description.
   
2. **States:**
   - **Loading:** 3 skeleton cards (bg-white dark:bg-slate-800, rounded-2xl, h-36 animate-pulse, no shadow).
   - **Locked (402 error):** Indigo banner "Pro feature" → "Upgrade to Pro" card.
   - **Empty:** Centlemoji (💡), "No insights yet", "Tap Refresh…", Find Savings button (indigo-600).
   - **Refreshing:** Indigo-50 banner, "Searching for the latest deals… Results appear in ~20 seconds."

3. **Insight Cards Stack** — Pinned section label (uppercase 11px), then cards.
   - **InsightCard component:**
     - Category badge: 11px font-semibold, rounded-full, category bg (neutral pill: bg-slate-100 dark:bg-slate-700), text-slate-600.
     - "New" badge (if `is_new`): Sparkles icon + "New", indigo-50 bg.
     - Pin button: Bookmark icon, top right, hover text-indigo-500.
     - **Closure state** (if `verified_savings`): Green banner, CheckCircle2, "You did it — payments to [merchant] have stopped. That's ~£X/mo staying in your pocket."
     - **Title:** text-base font-bold slate-900, leading-snug.
     - **Body:** text-sm text-slate-600 dark:text-slate-400, truncated (2 sentences) with "more" toggle.
     - **Timestamp:** 11px text-slate-400, self-end, only if ≤14 days old.
     - **Deal Sites Section** (if category links exist): "Where to save" label (11px uppercase), 2 buttons (uSwitch, MSE, etc.), ExternalLink icon 12px.
     - **Workflow CTA** (if workflow exists): Secondary button, "Improve this tip" or "[cta text]", SlidersHorizontal icon.
     - **Triggered By** (collapsible): "Based on X transaction(s)", merchant + monthly amount.
   - Token: `glass-card`, `rounded-2xl`, `p-4`, `shadow-sm`.

4. **Show More Button** (if unpinned.length > 3): "Show X more ways to save" — text-slate-600, border-slate-200.

5. **Improve your suggestions** (collapsed section):
   - Unknown Bills Panel (UnknownBillsPanel):
     - Header: "Help us personalise your insights", "X recurring bills we couldn't identify", amber-50 bg.
     - Rows: Merchant name, "£X/mo · Y payments", expand/collapse.
     - Category picker: 3×N grid, icon + label buttons (rounded-xl, bg-slate-50 hover:bg-indigo-50).
     - Skip button: ✕ icon.
     - Saving state: "Generating insight…" (RefreshCw animate-spin).
   - Labelled Bills Panel (LabelledBillsPanel):
     - Collapsible list of labelled bills, edit mode, delete action.
   - Token: `glass-card`, `rounded-2xl`, borders.

6. **Education Section** (collapsed, "More · learn the basics"):
   - MoneyBasicCard embedded (rotating education items).

**Tab 3: Tax** (High-earner only: income ≥ £100k)
- Delegated to TaxPage component (see Tax section below).
- Displayed as mobile tab OR desktop column (≥1024px = 3-col grid).
- **NO inner tabs** (Income & Allowances / Checklist / Tax Chat tabs do NOT exist).
- **NO editable income/pension input fields** (all read-only from getPreferences/Settings).

---

### **RECEIPTS SUB-SCREEN: ReceiptsPage.tsx**

**Page Flow**
- **Sticky Header:**
  - Back button (ChevronLeft 22px, active:bg-slate-100, -mr-1).
  - Title: "Receipts" (text-lg font-bold).
  - Badge: "X total" (text-sm text-slate-500), right side.
  - BG: f0f2f7/90 dark:0f172a/90, backdrop-blur-sm, border-b border-slate-200/60.

- **Content (px-4 py-4 pb-28):**
  - **Loading:** 4 skeleton rows (h-16 bg-white dark:bg-slate-800 rounded-2xl animate-pulse).
  - **Empty:** Receipt icon (emerald rounded-2xl square, NOT circle), "No receipts yet", "Scan a receipt from the Insights page…", "Go back" link (text-emerald-600).
  - **Populated:** List of `Basket` items.

- **Basket Row Component:**
  - Expand/collapse: ChevronDown (rotate-180 when open).
  - Shop name + item count: "Tesco (12 items)".
  - Date: "12 Aug 2024 · estimated" (italicized).
  - Total (right): "£45.23" (text-sm font-bold num).
  - Delete button: Trash2 icon (text-slate-300 hover:text-rose-500, -mr-1, p-2.5).
  - **Expanded Detail:**
    - Item rows: Qty (if >1) + name, category, line_price (right).
    - Token: `rounded-2xl`, `border border-slate-100 dark:border-slate-700`, `shadow-sm`.

---

### **TAX SUB-SCREEN: TaxPage.tsx**

**Page Flow (Real Structure — TaxPage.tsx:339-515)**
- **Sticky Header (embedded mode OFF):** Back button, "Tax efficiency", tax year progress bar (indigo accent).
  - Progress label: "6 Apr" (left) / "X days left" (centre) / "5 Apr" (right).
  
- **Content (no tabs):**
  1. **TaxHeroCard** — Context-aware hero (indigo-50 bg, calendar accent)
     - Headline: "Shelter your savings before 5 Apr" or "Tax your way to more growth" (depends on income bracket).
     - Body: Education on ISA/pension allowances (bold key figures).
     - Footer: Calendar icon + amber "X days left in YYYY/YY — allowances reset 5 Apr".
  
  2. **"Your levers" section label** (11px uppercase).
  
  3. **Pension lever** — Context-based card (read-only):
     - **If taper issue (income >£100k):** AlertCircle + "Pension — contribute £X before 5 Apr" (amber accent).
       - Detail: Adjusted income, taper threshold, required contribution.
       - Grid: "Extra needed", "Tax saved" (emerald), "Costs you" (3-col split).
     - **If <£100k:** CheckCircle2 + "✓ Your £100k allowance is safe" (emerald, reassuring).
  
  4. **Gift Aid** (ActionRow, toggleable).
  
  5. **Child Benefit** (ActionRow, conditional: if applicable & income >£60k, toggleable).
  
  6. **ISA Allowance** (ActionRow, always visible, toggleable, highlights if <90 days left).
  
  7. **"Also worth knowing" (collapsible, closed by default)**
     - **Self-assessment** (action status by default).
     - **Tax codes** (action status by default).
     - **Salary sacrifice** (info status).
     - **Carry-forward** (info status).
     - **EIS/SEIS** (info status).
  
  8. **"Key dates" section label** (11px uppercase).
  
  9. **Key dates list** (no chevron, always visible)
     - "5 Apr YYYY" — "End of tax year" + sublabel.
     - "31 Jul YYYY" — "Second payment on account" + sublabel.
     - "31 Jan YYYY+1" — "Self-assessment deadline" + sublabel.

- **TaxChat FAB** (at page bottom, outside main scroll area):
  - Position: `fixed bottom-[calc(88px+env(safe-area-inset-bottom))] right-16px`.
  - Circular button (56px), BRAND_GRADIENT (indigo→violet), MessageCircle icon.
  - Opens floating panel: 340×520px, gradient header, "Penny | Tax questions" (Sparkles icon + text), messages, input, quick buttons, close (X).

- **Token:**
  - Section labels: 11px font-bold uppercase tracking-widest, text-slate-500.
  - ActionRow: bg-white dark:bg-slate-800, rounded-2xl, p-4, flex gap-3.
  - Highlight state: ring-1 ring-amber-300 (when relevant, e.g., ISA <90 days).
  - Hero card: bg-indigo-50 dark:bg-indigo-950/40, border indigo-100 dark:indigo-800/50, rounded-2xl, p-5.

---

## States for Each Screen

### **MAIN PAGE**

**Safety Net Card:**
| State | Appearance | Actions |
|-------|-----------|---------|
| Not configured | Setup form, shield icon, green CTA | Account selection, target choice, "Start tracking" |
| Configured, <100% | Progress ring, "~X days covered", timeline, Edit button | Update target, toggle steps |
| Configured, 100% | Full green ring, "Safety net funded 🎉", celebration message | Edit button (available but not primary) |
| Loading savings data | Skeleton card (h-20 animate-pulse) | None (read-only) |

**Insight Card:**
| State | Indicator | Appearance |
|-------|-----------|-----------|
| New | Sparkles badge + "New" label | Indigo-50 bg, animate-in |
| Verified (savings) | CheckCircle2 in green banner | Shows monthly savings & merchant |
| Pinned | BookmarkCheck icon (indigo-500) | Appears first in list |
| Unpinned (hidden behind "show more") | — | Below top 3 |
| Loading insights | Skeleton cards (3×) | bg-white h-36 animate-pulse |
| Locked (Pro feature) | Indigo hero section | Upgrade prompt, feature list, pricing |
| Refreshing | Indigo banner, spinner icon | "Searching for the latest deals…" |

**Workflow Drawer (Modal):**
| State | Content | Actions |
|-------|---------|---------|
| Step form | Current step label, input field (text/currency/select), progress bar | Next, Back, Save with answers so far |
| Saving | Spinner, "Saving…" message | Disabled |
| Done (1.5s) | CheckCircle2 (48px), "Saved — Penny is crunching…" | Auto-close modal |

### **RECEIPTS PAGE**

| State | Appearance | Actions |
|-------|-----------|---------|
| Loading | 4 skeleton rows (h-16) | None |
| Empty | Receipt icon (emerald), "No receipts yet" | "Go back" link |
| List populated | Basket rows, expandable detail, delete buttons | Expand/collapse, delete (with confirm) |
| Deleting | Opacity fade, then removed from list | Confirm dialog modal |

### **TAX PAGE**

| State | Appearance | Actions |
|-------|-----------|---------|
| Loading | Skeleton cards | None |
| Showing (high-earner) | Checklist rows, tax year progress, chat FAB | Mark items done, edit fields, ask Penny |
| Hidden (low-earner) | Not shown; tab disappears on mobile | N/A |
| Chat open (mobile) | FAB visible, panel overlay | Send messages, quick buttons |
| Chat closed | FAB visible bottom-right | Tap to open |

---

## Interactions

### **Main Page**

1. **Tab Switching** (SegmentedControl):
   - Taps switch between "Savings", "Ways to save", "Tax".
   - State preserved across navigation.
   - On mobile, only one tab content shown at a time.
   - On desktop (≥1024px), all 3 shown side-by-side (grid-cols-3).

2. **Safety Net Setup Flow:**
   - User taps "Start tracking" or "Edit".
   - Form expands: target choice (3 buttons), account list (checkboxes), manual account add.
   - CTA: "Start tracking" (first time) or "Update target" (edit).
   - On save, form collapses and displays progress ring.

3. **Insight Card Interactions:**
   - **Bookmark/Pin:** Taps icon → API call → card moves to "Pinned" section, order updates.
   - **Expand Body:** "more" link expands 2+ sentences.
   - **Deal Sites:** External links (target="_blank").
   - **Workflow CTA:** Opens WorkflowDrawer modal (portal), multi-step form, saves context.
   - **Triggered By Toggle:** Expands/collapses merchant list.
   - **Deep Link:** From home spotlight (?insight=<id>) scrolls to card, highlights with ring for 2.4s.

4. **Show More Insights:**
   - Taps "Show X more ways to save" → sets `showAll = true` → renders all unpinned.
   - Taps "Show fewer" → collapses back to first 3.

5. **Improve Suggestions (collapsed):**
   - Expands to show UnknownBillsPanel + LabelledBillsPanel.
   - Unknown bills: Expand bill row, pick category from grid, save (shows "Generating insight…"), 20s delay before refresh.
   - Labelled bills: Edit mode, change category, delete label.

6. **Refresh Insights:**
   - Taps "Refresh" button (text-indigo-600, RefreshCw icon, animate-spin).
   - API call: `api.refreshSavingsInsights()`.
   - Shows spinner, "Searching…" banner for ~20s.
   - Auto-reloads insights on success.

### **Receipts Page**

1. **Navigation:**
   - Back button: `router.back()` (useRouter).
   - Breadcrumb in header: "Back" navigates to /insights.

2. **Basket Expand/Collapse:**
   - Taps ChevronDown icon → expands detail rows.
   - Taps again → collapses.
   - Smooth rotation animation (duration-150, rotate-180).

3. **Delete Basket:**
   - Taps Trash2 icon.
   - Opens ConfirmDialog modal.
   - On confirm: Removes from list, API call: `api.deleteBasket(id)`.

4. **Receipt Scanning (from GroceryBasketCard):**
   - Camera or image upload (file input).
   - Sends to API: `api.scanReceipt(dataUrl)`.
   - On success: Adds basket to list, expands detail, reloads insights.
   - On error: Shows error banner.

### **Tax Page**

1. **Checklist Toggle (ActionRow):**
   - Taps row → toggles `done` state (localStorage persisted).
   - Icon changes: Info → AlertCircle (action) or CheckCircle2 (done).
   - Text styling: line-through when done.

2. **Tax Field Edits:**
   - Income input (number): Recomputes PA taper loss.
   - Pension annual (currency): Updates tax relief calculation.
   - Child Benefit (toggle): Enables/disables benefit recipient rules.

3. **Penny Chat FAB (TaxChat):**
   - Taps circular button (BRAND_GRADIENT, bottom-right).
   - Panel slides up (or becomes visible as fixed floating card).
   - Type message → send → AI response (via `api.taxChat(messages)`).
   - Markdown formatting in responses (ChatMarkdown component).
   - Quick buttons: "How does pension carry-forward work?", etc. → auto-fills input.
   - Close button (X): Collapses panel.

4. **Navigation to Tax Sub-Screen:**
   - From mobile tab switcher, taps "Tax" → routes to `/insights/tax` (if not embedded).
   - On desktop, TaxPage renders embedded in right column.

---

## Interactions: Sheets & Modals

### **WorkflowDrawer (Multi-Step Form Modal)**
- Portal overlay: `fixed inset-0 z-[60] bg-black/40`.
- Sheet container: `glass-sheet rounded-t-3xl max-h-[90dvh]` (rounded top).
- Handle bar: **w-10 h-1** (40×4px, NOT 10×1px) bg-slate-200 dark:bg-slate-600, centered.
- Header: 11px category chip (insight.icon + insight.label) + h2 "Personalising your insight…" (when saving).
  - Also shows "Step N of M" progress label (11px text-slate-500).
- Input rendering:
  - **Text field:** bg-slate-50 dark:bg-slate-700, rounded-xl, 14px text, focus:ring-2 focus:ring-indigo-400.
  - **Currency:** £ prefix, decimal inputMode, right-aligned.
  - **Select:** Buttons grid, each option toggles selection (bg-indigo-50 when selected).
- Navigation: Back (if step > 0), Next (step < total-1), Save & Personalise (final step).
- "Save with answers so far" (footer, light text, if >1 step and not final).
- On save: Spinner → "Personalising your insight…" → CheckCircle2 (48px) + "Saved — Penny is crunching your numbers." (1.5s) → auto-close.

### **TaxChat Floating Panel**
- Position: `fixed bottom-[calc(88px+env(safe-area-inset-bottom))] right-16px` (above bottom nav).
- Dimensions: 340×520px (max-width calc(100vw-32px)).
- Header: BRAND_GRADIENT (indigo→violet), white text, Sparkles icon.
  - Title: "Penny" (bold).
  - Subtitle: Two lines — "Tax questions · Powered by Claude" (11px, on Penny gradient surface).
- Message list: Role-based styling (user vs assistant).
- Input: Text field + Send button (SendIcon, active:scale-95).
- Quick buttons: Carousel or grid of preset questions.
- Close on backdrop click or X button.

---

## Sheets / Upload Flows

### **GroceryBasketCard Upload Flow (from Receipts Tab / Home)**
- **Camera/Image Input:**
  - Native `<input type="file" accept="image/*" capture="environment">` for camera.
  - WebView bridge: `window.ReactNativeWebView.postMessage()` for native camera (React Native app).
  - File picker fallback.
- **Processing:**
  - Client-side downscaling: `fileToScaledDataUrl(file, 1600px, 0.8 quality)` → JPEG data URI.
  - Send to API: `api.scanReceipt(dataUrl)`.
  - Loading state: Progress spinner, "Scanning…" text.
- **Success:**
  - Basket added to list.
  - Expanded by default (shows items).
  - Reloads insights.
- **Error:**
  - Banner: text-red-600 bg-red-50, error message (max 60 chars).
  - Retry option.

### **Manual Account Addition (Safety Net Setup)**
- Form: Account name input (max 60 chars), balance currency input (£ prefix).
- Validation: Name non-empty, balance ≥ 0.
- On save: `api.addSavingsManualAccount({ name, balance })` → success closes form, reloads savings.
- On edit: `api.updateSavingsManualAccount(id, { name, balance })`.
- On delete: `api.deleteSavingsManualAccount(id)`.

---

## Data & API Endpoints

All endpoints via `/root/ai-wealth-dashboard/frontend/lib/api.ts` (api.*).

### **Main Insights (Ways to Save Tab)**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `getSavingsInsights()` | GET | List all savings insights | `id`, `title`, `body`, `category`, `icon`, `label`, `is_new`, `pinned`, `verified_savings`, `verified_merchant`, `triggered_by[]`, `refreshed_at` |
| `refreshSavingsInsights()` | POST | Trigger AI refresh (~20s) | Returns: `{ message: string }` |
| `newInsightCount()` | GET | Badge count for Ways-to-Save tab | Returns: `{ count: number }` |
| `markInsightsViewed()` | POST | Clear Ways-to-Save badge on open | Returns: `{ ok: boolean }` |
| `saveInsightContext(insightId, context)` | POST | Save workflow answers | `context: { [step.id]: value }` |

### **Bills & Categorization**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `getUnknownBills()` | GET | Uncategorised recurring | `unknown_bills[]`, `label_options` |
| `labelBill(merchantKey, category)` | POST | Assign category | — |
| `getBillLabels()` | GET | Already-labelled bills | `{ merchant_key, display_name, category, label, is_skip }[]` |
| `deleteBillLabel(merchantKey)` | DELETE | Remove label (revert to unknown) | — |

### **Savings Tab (Safety Net & Savings Plan)**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `savingsInsights()` | GET | Savings summary (Safety Net data) | `current_savings`, `target_amount`, `target_type`, `target_months`, `monthly_spending`, `monthly_surplus`, `pct_funded`, `accounts[]`, `configured`, `monthly_income`, `months_to_target`, `funded_date` |
| `saveSavingsGoal(body)` | PUT | Set target & accounts | `{ target_type: "months" \| "amount", target_months?: number, target_amount?: number, account_ids[] }` |
| `getSavingsPlan()` | GET | Fetch savings plan + milestones | Returns: `{ plan: SavingsPlan \| null }` |
| `saveSavingsPlan(plan)` | PUT | Create/replace plan | `plan: { mode?, kind?, target_months?, target_amount?, milestones[] }` |
| `toggleSavingsPlanStep(stepId, done)` | PATCH | Mark milestone done/pending | — |
| `deleteSavingsPlanStep(stepId)` | DELETE | Remove single milestone | — |
| `deleteSavingsPlan()` | DELETE | Remove entire plan | — |
| `addSavingsManualAccount(data)` | POST | Add offline account | `{ name, balance }` |
| `updateSavingsManualAccount(id, data)` | PATCH | Edit offline account | `{ name?, balance? }` |
| `deleteSavingsManualAccount(id)` | DELETE | Remove offline account | — |

### **Receipts & Baskets**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `listBaskets()` | GET | All scanned receipts | `id`, `shop`, `purchased_at`, `date_estimated`, `total`, `currency`, `items[]` |
| `scanReceipt(dataUrl)` | POST | OCR receipt image | Request: JPEG data URI, Response: `Basket` |
| `deleteBasket(id)` | DELETE | Remove receipt | — |
| `basketInsights()` | GET | Price trends, cheaper alternatives | `{ baskets[], cheaper_alternatives[], price_changes[] }` |

### **Fuel & Transport**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `fuelNearby({ grade, lat, lng })` | GET | Cheapest fuel stations | `{ count, stations[{ ppl, distance_km, name, postcode }] }` |
| `transportSummary()` | GET | Spend breakdown by mode | `{ total_spend, modes[{ name, monthly, total, colour, pct }] }` |

### **Tax Tab (High-Earner Only)**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `getPreferences()` | GET | Read-only income/pension/child-benefit data | `income_bracket`, `income_value`, `pension_annual`, `has_child_benefit` |
| `getDebtPlanView()` | GET | Debt status (for child benefit context) | — |
| `taxChat(messages)` | POST | Tax Q&A via Penny | Request: `{ role: string; content: string }[]`, Response: `{ reply: string }` |

### **Misc (Shared Across Tabs)**
| Endpoint | Method | Purpose | Key Fields |
|----------|--------|---------|-----------|
| `getMoneyBasics(topic?)` | GET | Rotating education card ("grow" on Savings tab) | `topic?: string`, Returns: `{ icon, title, body, tax_year }` |
| `getSubscription()` | GET | Pro feature lock status | `{ tier: string; ... }` |

---

## Current Mobile State

**Status:** WebView stub (no native implementation yet).

**What Exists on Web (to Port Natively 1:1):**

### **Tab 1: Savings** — LARGEST, Most Interactions
- [x] Safety net setup/editing (account picker, target choice, manual add/edit/delete).
- [x] Progress ring SVG (52px, emerald accent, animated fill).
- [x] "Where should your next £100 go?" accordion (up to 4 steps).
- [x] Safety net verdict (X days covered / funded).
- [x] Savings plan card (ordered steps, toggle done/pending).
- [x] "Ready to grow" education card (Sparkles icon, 3 topics).
- [x] Skeleton loaders (h-20 animate-pulse).

### **Tab 2: Ways to Save** — SECOND LARGEST
- [x] Section header + Refresh button (RefreshCw animate-spin).
- [x] Pro feature upsell (locked state, indigo hero).
- [x] Insight card deck (pinned vs unpinned, "show more" pagination).
- [x] InsightCard internals: category badge, "New" indicator, pin/bookmark, verified banner, title, body (truncated + "more" toggle), timestamp, deal links, workflow CTA, triggered-by collapsible.
- [x] Unknown bills picker (category grid, skip option, "Generating insight…" state).
- [x] Labelled bills edit/delete.
- [x] Education section collapsible (MoneyBasicCard).

### **Tab 3: Tax** (High-Earner Only)
- [x] Tax year progress bar (visual % filled).
- [x] Key dates list (calendar icons, date labels).
- [x] Checklist rows (toggleable, icon updates).
- [x] Penny chat FAB + floating panel (gradient, markdown responses, quick buttons).

### **Receipts Sub-Screen** — SMALL, Clear
- [x] Back button navigation.
- [x] Sticky header ("X total" badge).
- [x] Basket list (shop name, date, item count, total).
- [x] Expand/collapse detail rows (item name, category, qty, price).
- [x] Delete with confirm modal.
- [x] Empty state (emoji, message, "Go back").
- [x] Skeleton loading.

### **Components to Remove (Dead / Belong Elsewhere)**

These are imported but NOT rendered on InsightsPage — delete them from this screen's children:
- **FuelSavingsCard** — renders on HomePage:335, not Insights.
- **GroceryBasketCard** — renders on HomePage:336, not Insights.
- **TransportInsights** — dead, unused entirely.
- **ChallengesPanel** — home-only, not Insights.
- **HomeInsightSpotlight** — home-only spotlight deep link, not Insights.
- **ConfirmDialog** — imported line 10 but unused on InsightsPage (used only for Receipts delete).

### **Missing / To Build:**
- All state management (useState hooks → useContext or Zustand).
- API integration (replace mock with actual calls).
- Animation/transitions (Reanimated or React Native shared-value based).
- Camera integration (expo-image-picker for Receipts).
- Modal/sheet rendering (react-native-bottom-sheet or portal-based).
- Markdown rendering (react-native-markdown-display or similar).
- SVG progress ring (react-native-svg Svg/Circle).

---

## RN Port Notes

### **Charts & SVG**
- **Progress ring (Safety Net):** Use `react-native-svg` (`Svg`, `Circle`, `strokeDasharray` for progress).
- **Fuel station list bar charts:** `react-native-svg` `Rect` for bars + gradient fills.
- **Transport modes bar chart:** Same (react-native-svg).

### **Camera & File Upload**
- **Receipt scanning:** `expo-image-picker` → `launchCameraAsync()` or `launchImageLibraryAsync()`.
- **File scaling:** Use Expo's `expo-image-manipulator` to downscale before upload.
- **Send to API:** FormData with base64 or raw bytes.

### **Chat & Markdown**
- **Penny Chat:** Use `react-native-markdown-display` for AI responses (code blocks, lists, emphasis).
- **Message rendering:** SimpleMarkdown or markdown-to-jsx adapted for RN.

### **Penny Gradient (Tax Chat FAB)**
- **Indigo→Violet 135° gradient:** Use `expo-linear-gradient` (`LinearGradient` with angle).
- **Hex colors:** #4f46e5 (indigo) → #7c3aed (violet).
- Token: Mobile button (56px circular, shadow-lg equivalent via `elevation` or `shadow`).

### **Bottom Sheet / Modals**
- **WorkflowDrawer:** `react-native-bottom-sheet` with backdrop + scroll handling.
- **Tax Chat panel:** Float as fixed overlay or use bottom-sheet.
- **Delete confirm:** React Native `AlertIOS` + `Platform.select()` for Android equivalent.

### **Styled Components**
- **Glass/Blur:** Use `expo-blur` (`BlurView`) for subtle backgrounds.
- **Rounded corners:** All components use NativeWind `rounded-2xl` etc. (mapped to Tailwind).
- **Dark mode:** NativeWind handles `dark:` prefix (system preferences or toggle).

### **Tokens (mobile/lib/tw.ts Mapping)**
- `rounded-2xl` → 16px (standard card).
- `rounded-xl` → 12px (control/button).
- `shadow-sm` → `elevation: 2` or similar (platform-specific).
- `p-4` → `padding: 16px`.
- `gap-3` → `gap: 12px`.
- `text-base font-bold` → `fontSize: 16, fontWeight: 700`.
- `text-[11px]` → `fontSize: 11`.
- Colors: Use TailwindCSS classes (NativeWind transpiles to inline styles).

### **Light & Dark Tokens (Exact Hex)**

**Light Mode**
| Element | Hex | Token |
|---------|-----|-------|
| Canvas BG | #f0f2f7 | bg-slate-50 |
| Card BG | #ffffff | bg-white |
| Border | #f1f5f9 | border-slate-100 |
| Text (primary) | #0f172a | text-slate-900 |
| Text (muted) | #94a3b8 | text-slate-500 |
| Accent (indigo) | #4f46e5 | text-indigo-600 |
| Success (emerald) | #10b981 | text-emerald-600 |
| Warning (amber) | #f59e0b | text-amber-600 |
| Error (red) | #ef4444 | text-red-600 |
| Penny Gradient Start | #4f46e5 | indigo-600 |
| Penny Gradient End | #7c3aed | violet-600 |

**Dark Mode**
| Element | Hex | Token |
|---------|-----|-------|
| Canvas BG | #0f172a | bg-slate-900 |
| Card BG | #1e293b | bg-slate-800 |
| Border | #334155 | border-slate-700 |
| Text (primary) | #f1f5f9 | text-slate-100 |
| Text (muted) | #475569 | text-slate-500 |
| Accent (indigo) | #60a5fa | text-indigo-400 |
| Success (emerald) | #34d399 | text-emerald-400 |
| Warning (amber) | #fbbf24 | text-amber-400 |
| Error (red) | #ef5350 | text-red-400 |

---

## Open Questions & Risks

1. **Large Page Size**: InsightsPage is ~2KB lines of code. Consider componentizing further on mobile (separate SavingsSection, InsightsSection, TaxSection as standalone modules).

2. **Deep Linking**: Home spotlight → Insights card (?insight=<id> param). Mobile must preserve router state & scroll to card. Verify with router stack.

3. **WebView Bridge (Camera)**: GroceryBasketCard has native camera fallback (`window.ReactNativeWebView`). Ensure Expo Router can pass messages between RN and WebView layer.

4. **API Rate Limits**: Receipt scanning (OCR) and fuel nearby (geolocation + API call) may have rate limits. Add error recovery & user messaging.

5. **Geolocation Permissions**: FuelSavingsCard requests browser geolocation. Mobile equivalent: Expo permissions API (`expo-permissions`).

6. **Chat Markdown**: TaxChat responses use ChatMarkdown (web component). Ensure RN markdown renderer handles all syntax (code blocks, tables, emphasis).

7. **Skeleton Loaders**: Web uses `animate-pulse`. RN equivalent: Shimmer lib (`react-native-shimmer-placeholder`) or custom Reanimated animation.

8. **Modal Z-Index**: WorkflowDrawer uses `z-[60]`. Mobile z-indexing is platform-dependent (use stack navigation or portal).

9. **Workflow Steps Validation**: Multi-step form needs client-side validation. Ensure "Save with answers so far" doesn't fail silently.

10. **Accessibility**: Checklist toggles, tab navigation, focus management. Mobile needs VoiceOver/TalkBack labels (React Native `accessibilityLabel`, `accessibilityRole`).

11. **Large Lists**: If user has 50+ insights, scrolling performance matters. Consider FlatList with virtualization.

12. **Offline Accounts (Manual Entry)**: Safety net card allows users to add accounts not connected via API. Ensure data persists locally (AsyncStorage) if offline.

13. **Insight Pinning Sync**: Pinned state is stored server-side but displayed immediately client-side. Handle race conditions (user pins 2 cards rapidly).

14. **Receipt Image Size**: Downscaling to 1600px on web. Mobile should do same (avoid OOM on older devices). Verify expo-image-manipulator handles large originals.

15. **Tax-Only Content**: Tab hides on mobile if `incomeBracket < "100k_125k"`. Ensure dynamic tab rendering doesn't break scroll position.

---

## Summary

The **Insights** screen is the app's discovery & financial planning hub. It's large (~92KB web component) with three distinct sub-surfaces:

- **Savings** (setup, progress, plan steps) — Emerald color voice, safety net first.
- **Ways to Save** (AI insights with personalization workflows) — Neutral cards, "New" badges, deep linking.
- **Tax** (checklist, Penny chat) — High-earner feature, indigo→violet gradient.
- **Receipts** (receipt scanning, basket detail) — Focused sub-screen, image upload flow.

**Layout Notes:**
- On desktop (≥1024px), InsightsPage renders a 3-col grid: Savings tab (left) | Ways-to-Save tab (centre) | Tax tab (right).
- Special case: If `!showTaxSection` (income <£100k), use `grid-cols-2` instead (Savings + Ways-to-Save only).

**Mobile parity requires:**
1. Exact token matching (hex, radii, padding, fonts, dark mode).
2. All interaction states (loading, locked, empty, error, populated).
3. Multi-step form handling (WorkflowDrawer with category chip + "Personalising…" state).
4. Image upload pipeline (receipts).
5. SVG progress visualization (react-native-svg).
6. Gradient backgrounds (expo-linear-gradient).
7. Chat markdown rendering + AI streaming (if applicable).
8. Geolocation + permissions (fuel card).
9. New Insight count badge on Ways-to-Save tab (via newInsightCount()).
10. Glass-hero card header with dynamic title per tab.

**No custom design variants needed** — this port is 1:1 fidelity recreation from web.
