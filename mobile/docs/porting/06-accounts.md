# Accounts Screen Documentation (Web to Mobile Port)

Checkpoint
- Web source reflected at commit: 5ad21c0 (2026-08-06)
- Last change to this screen's source: e9533c0 (2026-08-06 07:19:08)
- Find future changes: `git log e9533c0..HEAD -- frontend/app/components/AccountsPage.tsx`

---

## Purpose

The Accounts page is the complete estate view — net worth header, account groupings (current/savings/credit/investments/offline), per-account detail views with transaction lists, category breakdowns, contract-note management, and rules for offline-account reconciliation. This is the largest component in the web app (~2,864 LOC) and the mobile version must replicate its structure 1:1, keeping UX consistent with the existing Home AccountsGrid.

---

## Source Files (Web)

- **Main:** `/root/ai-wealth-dashboard/frontend/app/components/AccountsPage.tsx` (2,863 lines)
- **Child components:**
  - `AccountMiniCard.tsx` (path: `/root/ai-wealth-dashboard/frontend/components/`) — card display, bank branding, terms pills
  - `TransactionRow.tsx` — transaction row renderer (merchant icon, category, amount)
  - `TransactionSheet.tsx` — transaction detail & bulk categorisation
  - `StatementUpload.tsx` — CSV/PDF statement upload widget
  - `InvestmentUpload.tsx` — investment statement upload
  - `BankPickerSheet.tsx` — OAuth provider selection
  - `CardTermsSheet.tsx` — credit card APR / 0% promo capture
  - `CategorySheet.tsx` — drill-down category spending view
  - `CustomSelect.tsx` — dropdown for offline account selection
  - `CategoryRow.tsx` — category metadata type
  - `MonoConnectWidget.tsx` — Mono SDK (Kenya region)
  - `SegmentedControl.tsx` — tab picker
  - `BottomNav.tsx` — persistent footer nav
  - `Spinner.tsx` — loading spinner

**API layer:** `/root/ai-wealth-dashboard/frontend/lib/api.ts` (types: Account, InvestmentAccount, InvestmentHolding, InvestmentNote, Transaction, ManualAccount, ManualAccountRule, KPIs, CardTermsCard)

---

## Layout Anatomy (Top → Bottom)

### 1. **Header Card** (always visible list + detail views)

**Light Mode:** `glass-card` (translucent white #ffffff on #f0f2f7 canvas, blur 12px)  
**Dark Mode:** `glass-card` (translucent #1e293b on #0f172a, blur 12px, hairline border #334155)  
**Padding:** `mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6`

- **Title:** "Accounts" (h1: 20px/700, slate-900 light / slate-100 dark)
- **KPI Section** (if `kpis` loaded):
  - **Label:** "NET WORTH" (10px/600 UPPERCASE tracking-wide, muted)
  - **Value:** Display figure (30px/700 font-bold, num class)
    - Hidden state: "••••••" (hides if `hideNetWorth` true)
    - Trend icon: TrendingUp/TrendingDown (16px, slate-400)
  - **Eye toggle:** Hide/show balance (p-1 rounded-full, focus ring indigo-500)
  - **Credit card total** (if cards exist): "−£X across cards" (base/600 num, muted label)
- **Summary line:** "N bank · M investment · P offline" (sm text-slate-500)
- **Context buttons** (region + tab dependent):
  - **UK / Banks tab:**
    - "Add Bank" (indigo-50/600 text)
    - "Statement" (indigo-50/600 text)
    - "Offline" (indigo-50/600 text)
    - "Finexer (beta)" (full-width, indigo-50/600)
  - **Kenya / Banks tab:**
    - "Mono" button (MonoConnectWidget)
    - "Statement" (indigo-50/600 text)
    - "Offline" (indigo-50/600 text)
  - **Investments tab:**
    - "Upload Statement" (indigo-600 button)
    - "Add contract note" toggle (indigo-50/600)
- **Tab bar:** 2-tab segmented control (Banks / Investments)
  - Active: bg-white dark:bg-slate-800, text-indigo-600
  - Inactive: text-slate-500 dark:text-slate-400

---

### 2. **Alert Banners** (Banks tab, above account lists)

All use 4px padding top/bottom, rounded-2xl, hairline borders.

- **Syncing banner:** indigo-50/100/300 (Calm indigo, RefreshCw animate-spin)
- **Reconnect warning:** red-50/200/800 (AlertTriangle, red-500, dismissible ×)
- **Expired provider alerts:** amber-50/200/800 (AlertTriangle, amber-500, Reconnect button)

---

### 3. **Banks Tab Content**

#### 3.1 Empty State
- Center-aligned card (bg-white dark:bg-slate-800, rounded-2xl shadow-sm)
- Icon box (14×14 indigo-50/indigo-900, Landmark icon #4f46e5)
- Heading: "No banks connected"
- Copy: Region-aware (UK → open banking; Kenya → Mono/statement)
- CTAs: Styled buttons (indigo-600 + secondary white/slate-700)

#### 3.2 Connected Bank Accounts List
- **Grid:** 2-column (`grid grid-cols-2 gap-3`)
- **Each cell:** `AccountMiniCard` (calm + glass variants, 124px min-height)
  - **Card:** LinearGradient (135° from provider brand → darker shade)
  - **Top row:** Logo (36×36 rounded-xl, white/20 overlay) + type badge (frosted white/20 pill)
  - **Provider name:** 10px/600 UPPERCASE muted, tracking-widest
  - **Account name:** 11px text, white/75
  - **Balance:** 20px/700 bold, white, tight tracking
  - **Deco circle:** 80×80 white/10 at bottom-right (overflow hidden)
  - **States:**
    - Expired: overlay `rgba(0,0,0,0.5)` with amber "Reconnect" text
    - Pressed: `scale-95` (50ms)
  - **Pinning:** Pin icon (top-right overlay) toggling HOME_PINNED_ACCOUNTS
  - **Terms pill** (credit cards only): Slate-700 text for APR, amber when 0% promo ends ≤60 days
  - **"Add rates"** affordance (cream pill) for credit cards without captured terms

**Web Imports:** accountBrand(), BANK_META, TermsPill

#### 3.3 Offline Accounts Section
- **Heading:** "Offline accounts" + caption (sm text-slate-700 + xs text-slate-400)
- **Empty state:** "No offline accounts yet."
- **List:** Each is a white/slate-800 row (rounded-2xl shadow-sm, py-3 px-4, flex)
  - Icon box (9×9 rounded-xl, slate-100/slate-700)
  - Name + type label ("Savings · Offline" in muted)
  - Balance (right-aligned, red for credit cards)
  - ChevronRight (slate-400)
  - Tap → detail view

---

### 4. **Investments Tab Content**

#### 4.1 Empty State
- Icon box + TrendingUp icon
- "No investment accounts"
- Copy: "Upload a quarterly statement from Vanguard, Wealthify, HL, Fidelity, AJ Bell."
- "Upload Statement" CTA (indigo-600)

#### 4.2 Investment Account Cards (Collapsible)
- **Card:** `glass-card` rounded-2xl, overflow hidden
- **Header row** (clickable): flex items-center justify-between
  - **Left:** TrendingUp icon (16px indigo-500) + account name + account_type + optional "NO STATEMENT YET" label (xs amber)
  - **Account ref + refresh date:** xs text-slate-400
  - **Right:** value (sm/700 bold) + chevron (ChevronDown/Up 14px slate-500)
- **Expanded content:** border-t slate-50/700

  **A. Action bar:**
  - Refresh prices (indigo-600, RefreshCw animate-spin when loading)
  - Remove account (rose-500, Trash2)

  **B. Decomposed value line** (xs muted, leading-snug):
  - **Provisional:** "No statement yet — running total from £0"
  - **With statement + prices refreshed:** "£X · prices refreshed DATE · +/−£Y added (N notes)"
  - **With statement only:** "Valued £X on DATE · +/−£Y added (N notes)"

  **C. Info box** (slate-50/slate-700, rounded-2xl, px-4 py-4):
  - **Label:** "HOW THIS ACCOUNT STAYS CURRENT" (xs/600 UPPERCASE tracking-wide)
  - **Explanation:** xs text-slate-600, multi-line copy
  - **Upload buttons:** 2-button row
    - "Upload statement" (white/slate-600, border slate-200/500)
    - "Add contract note" (indigo-600, FileText icon)
  - **Inline contract note form** (mt-3, if toggled):
    - Password input (xs, slate-200/slate-500 border, rounded-xl)
    - Eye toggle for password visibility
    - File picker (dashed border, Upload + "Choose PDF")
    - Error message (amber-50/100/700)
    - Submit button (indigo-600, RefreshCw animate-spin on upload)

  **D. Contract notes list** (if notes exist):
  - **Label:** "CONTRACT NOTES" (xs/600 UPPERCASE tracking-wide slate-400)
  - **Card:** white/slate-800, rounded-xl, divide-y slate-50/slate-700, border hairline
  - **Each note row** (px-3 py-2.5, flex justify-between):
    - **Left:**
      - Date (xs text-slate-500)
      - Fund name (xs font-medium slate-700)
      - "SOLD" badge (xs muted) if sale
      - Amount: ±£X (xs/700 emerald for buy / rose for sale)
    - **Right:** Delete button (6×6 Trash2, hover → rose-400)
  - **Show more / fewer** toggle (≤6 visible, show all link)
  - **Superseded notes:** "(N notes folded into statement)"

  **E. Holdings list** (if expanded):
  - **Each holding** (px-4 py-3, divide-y):
    - **Name + ISIN + type + units** (xs/medium slate-700)
    - **Price / unit:** xs muted (live: emerald-600/600, stale: slate-400)
    - **Value** (right): sm/700 bold slate-800

---

### 5. **Account Detail View** (Modal/Overlay, when selectedAccount set)

#### 5.1 Detail Header
- **Background:** Provider gradient (same as home card)
- **Back button:** ArrowLeft + "Accounts" (slate text, white/80 hover)
- **Action buttons** (right side, white/20 hover white/30):
  - Manual account (account.manual === true): "Edit" (Pencil icon)
  - Statement account (account.id.startsWith("statement-")): "Add statement" (Upload)
  - Connected account (else): "Reconnect" (RefreshCw)
  - All: "Remove" (Trash2, red-500/20, red-500/30 hover) — destructive CTA
- **Account name:** xl/700 bold (headerTextColor)
- **Type badge + balance:** xs/600 pill badge + 2xl/700 balance (red if negative)

#### 5.2 Segmented Control
- **Manual account:** "Transactions" / "Rules"
- **Connected account:** "Transactions" / "Categories"

#### 5.3 Transactions Tab (Bank Accounts)

**Search bar:**
- Search icon (left), clear button (right)
- Placeholder: "Search transactions…"
- bg-white dark:bg-slate-800, border slate-200/slate-700, focus ring-2 ring-indigo-500

**Pagination** (if >20 txns):
- Previous / Next buttons (slate border, disabled when at end)
- "Page N / Total" center

**Transaction list:**
- bg-white dark:bg-slate-800, rounded-2xl shadow-sm
- Each row: `TransactionRow` component
  - **Merchant icon** (16px, favicon or initials in category-colour chip ~15% tint)
  - **Name/description** (xs font medium slate-800) + merchant name optional (xs muted)
  - **Category badge** (xs muted pill, category colour)
  - **Amount** (sm font-bold, red if outgoing / emerald if income)
  - **Date** (xs text-slate-400)
  - Tap → TransactionSheet (categorisation, bulk apply)

**Empty state:** "No transactions" / "No matching transactions"

#### 5.4 Transactions Tab (Manual/Offline Accounts)

- **"Add transaction" button** (indigo-600, Plus icon)
- Same list, but each row can be edited
- Mirrored transactions (id starts with "mirror:") are read-only
- Tap non-mirror row → edit form

#### 5.5 Categories Tab

- **Grid:** 2-column (`grid grid-cols-2 gap-3`)
- **Each category card:**
  - **Header row:** Icon chip (32×32, rounded-xl, cat-colour ~15% bg) + category name (xs/600) + count (xs muted)
  - **Total:** base/700 bold (£X)
  - **Bar:** 1px height, slate-100/700 track, cat-colour fill, rounded-full
  - Tap → CategorySheet (drill-down list of txns + filter controls)

#### 5.6 Rules Tab (Manual Accounts Only)

- **Description:** "Auto-post matching transactions to this account."
- **"Add rule" button** (indigo-600, Plus)
- **Rule list:** Each rule is a white/slate-800 row (rounded-2xl shadow-sm)
  - **Name + match type + sign** ("Exactly/Contains 'VALUE' · Offset/Shadow")
  - **On/Off toggle pill** (emerald-100 if on / slate-200 if off)
  - **Edit + Delete buttons** (Pencil, Trash2; hover text-indigo-500 / text-rose-500)
- **Empty state:** "No rules yet."

---

## States

### 1. **Loading States**
- Full page: Spinner centered (size 32)
- Account transactions: Spinner (size 20-24)
- Account holdings: Spinner

### 2. **Empty States**
- No banks: Icon box + heading + copy + CTAs
- No investments: Icon box + heading + copy + "Upload Statement" CTA
- No offline accounts: "No offline accounts yet."
- No transactions: "No transactions" or "No matching transactions"
- No holdings: "No holdings found"
- No rules: "No rules yet."

### 3. **Error States**
- Statement upload error: amber-50/100/700 box
- Note upload error: amber-50/100/700 box
- Reconnect warning: red-50/200/800 banner (dismissible)
- Expired provider: amber-50/200/800 banner with Reconnect CTA

### 4. **Cold-Start Investment Account** (from contract note only)
- Provisional flag on account header
- Label: "NO STATEMENT YET" (xs slate-400 UPPERCASE)
- Decomposed line: "No statement yet — running total from £0"
- Cannot expand holdings until statement uploaded
- Notes add to a running total from 0

### 5. **Investment Price Refresh**
- Last refreshed date shown (xs slate-400, "updated DATE")
- RefreshCw animate-spin while refreshing
- Disabled with opacity-50 while refreshing
- Holdings updated in-place post-refresh

---

## Interactions

### 1. **Account Navigation**
- List view (default): Tap account card → detail view (push history state)
- Detail view: Tap back button → list view (pop history state)
- Deep link: `?id=<accountId>` opens detail at app boot, strips param after open
- Detail back after delete: Pop to list (no re-fetch needed, handled in handleDeleteAccount)

### 2. **Banking - Connect Flow**
- Tap "Add Bank" (UK) / "Mono" (Kenya) → OAuth flow
- TrueLayer: `api.connectLink()` → window.location.href = auth_url
- Mono: MonoConnectWidget render function (callback: `handleMonoSuccess()`)
- Post-connect: Poll `/accounts` until new account appears, then close syncing banner
- Reconnect (expired): Same flow, validates expected account re-appears (account_number match)

### 3. **Statement Upload**
- Tap "Statement" → StatementUpload sheet (file + password)
- Supports PDF/CSV
- On success: Reload accounts + reload current account txns + close sheet
- Error: Display amber box with error message

### 4. **Investment Upload**
- Tap "Upload Statement" (Investments tab header) → InvestmentUpload sheet
- Quarterly statement PDF (provider: Vanguard, Wealthify, HL, Fidelity, AJ Bell)
- On success: Reload investment accounts + close sheet
- Error: amber error box

### 5. **Investment Contract Note - Cold Start**
- Tap "Add contract note" toggle → Reveal form (inline in header)
- Upload PDF contract note without a statement yet
- Creates provisional investment account (no statement_date)
- On success: Reload accounts (new provisional account appears)
- Can then upload statement to set real value
- Error: amber-50/100/700 box

### 6. **Investment Contract Note - After Statement**
- Tap "Add contract note" inside expanded investment card → Inline form
- Same PDF upload + password (if protected)
- Validates note date ≠ duplicates
- Appends to investmentNotes[inv.id]
- Display: Show last 6 most recent (activeNotes.slice(-6)), "Show all N" link if more
- After expand: "Show fewer" toggle (back to last 6)
- Superseded notes (after next statement): "(N notes folded into statement)" helper text

### 7. **Investment Price Refresh**
- Tap "Refresh prices" → `api.refreshInvestmentPrices(id)`
- Updates display_value, last_refreshed on account
- Refetches holdings with live current_price
- Shows "prices refreshed DATE" in decomposed line
- RefreshCw spins for duration

### 8. **Transaction Detail (Bank)**
- Tap transaction row → TransactionSheet modal
- **Scopes** (if merchant_name or description exists):
  - "All from merchant" (all matching)
  - "Future from merchant" (future only, if matches)
- **Category picker:** Dropdown (all categories)
- **Similar txns:** Fetched on scope change, checkboxes to select which to apply
- **Save:** `api.patchTransaction()` with category + additional_ids
- Displays "X saved" confirmation for 900ms, then closes

### 9. **Transaction Edit (Manual/Offline)**
- Tap non-mirrored manual txn → Edit form (modal)
- Fields: Description, Amount, Date, Type (credit/debit)
- Delete button (separate flow: confirm → delete)
- Save: `api.updateManualTransaction()` or `api.addManualTransaction()`

### 10. **Offline Account Create/Edit**
- Tap "Offline" button (header) → Manual modal
- **Form fields:**
  - Name (max 60 char)
  - Type: 3-button grid (Savings/Current/Credit)
  - Balance (decimal input, ≥0)
- **Save:** `api.createManualAccount()` / `api.updateManualAccount()`
- **Delete:** From detail view header, confirm → `api.deleteManualAccount()`
- Error: rose-500 message below form

### 11. **Rule Create/Edit**
- Tap "Add rule" in manual account detail → Rule modal
- **Form:**
  - Name (max 60 char)
  - Offline account target (CustomSelect if not in detail view)
  - Linked account source (radiogroup: Any account or specific bank account)
  - Match type: Description / Category (2-button grid)
  - Match value: Search input (debounced, shows top 6 txns on focus)
    - Tap transaction → auto-fill value + strictness picker (Exactly / Contains)
    - Strictness shows match count for each mode
    - Volatility explanation (date/amount fragments) if widened from equals → contains
  - Backfill checkbox: "Also apply to N past transactions"
  - Effect: Offset (opposite amount) / Shadow (same amount) (2-button grid)
- **Save:** `api.createManualAccountRule()` / `api.updateManualAccountRule()`
- **Activate/Deactivate:** Toggle in account detail (On/Off pill, no modal)
- **Delete:** From row context menu, confirm → reverse mirrored amounts

### 12. **Card Terms Capture**
- Tap terms pill on credit card → CardTermsSheet modal
- Walks through APR + promos (0%, balance transfer, etc.)
- Save: `api.createCardTerms()` / `api.updateCardTerms()`
- Pill updates post-save (shows APR or "X% ends DATE")
- "Add rates" link (for credit cards without terms) → same sheet

### 13. **Net Worth Hide/Show**
- Tap eye icon in header → Toggle `hideNetWorth`
- Persisted via `api.updatePreferences({ hide_net_worth: boolean })`
- Label: "Net worth" (title-case, rendered uppercase via CSS textTransform)
- All balances replace with "••••••" when hidden (net worth + balance both hidden)

### 14. **Pin Account to Home**
- Tap pin icon on account card (list view) → Toggle pin
- Max 3 pinned (toast: "Home shows up to 3 pinned accounts")
- Persisted: `api.updatePreferences({ home_pinned_accounts: [id, ...] })`

### 15. **Confirm Dialog** (Custom, not native)
- Replaces window.confirm for delete/remove flows
- Portal (z-[70], centered, dark bg)
- Message text + Cancel / Delete (or Remove) buttons
- Delete button: red-500 (destructive styling)

---

## Sheets & Modals (All Browser, Not Native)

### 1. **TransactionSheet**
- Bottom sheet mobile (rounded-t-3xl, slide-up 280ms), centered modal desktop (rounded-3xl)
- Backdrop: black/40 fade-in
- Handles: Drag indicator (mobile only)
- **Content:** Category picker + scope picker (all | future scopes only) + similar txns multi-select + save button
- **Z-index:** 70

### 2. **CategorySheet**
- Same geometry as TransactionSheet
- **Content:** Category name + total + count + transaction list (sorted by date desc)
- Tap txn → close sheet + open TransactionSheet for that txn

### 3. **CardTermsSheet**
- Same geometry
- **Content:** Credit card APR / promos capture form (multi-step or single page)

### 4. **StatementUpload**
- Same geometry
- **Content:** File input (PDF/CSV) + password field (if PDF) + submit + error message

### 5. **InvestmentUpload**
- Same geometry
- **Content:** File input (PDF statement) + password field + submit + provider selector + error message

### 6. **BankPickerSheet**
- Same geometry
- **Content:** Bank provider grid (clickable cards: Barclays, Natwest, HSBC, etc.)
- Tap → OAuth flow via TrueLayer

### 7. **Manual Account Modal**
- Full screen overlay, centered on desktop, bottom-sheet mobile
- bg-black/40 backdrop
- glass-sheet (rounded-t-3xl mobile / rounded-3xl desktop)
- Drag handle (mobile only)
- **Content:** Name input + Type grid + Balance input + Cancel / Save buttons
- Z-index: 70

### 8. **Manual Transaction Modal**
- Same geometry as Manual Account Modal
- **Content:** Description + Direction (credit/debit) + Amount + Date + Delete button (if edit) + Cancel / Save
- Z-index: 70

### 9. **Rule Modal**
- Same geometry
- **Content:** Name + Offline account (select if not in detail) + Linked account (radio group) + Match type (grid) + Match value (search) + Strictness (radio if picked) + Backfill (checkbox) + Effect (grid) + Cancel / Save
- Z-index: 70

### 10. **Confirm Dialog**
- Portal (not bottom sheet)
- Fixed inset-0 z-50 flex items-center justify-center
- Dark card (bg-slate-900, border-slate-700)
- Message text + Cancel (slate) / Delete (red) buttons

---

## Data: API Endpoints & Key Fields

**API base:** `/root/ai-wealth-dashboard/frontend/lib/api.ts`

### 1. **Accounts**
- `api.accounts()` → Account[]
  - `id`: string
  - `name`: string
  - `provider`: string (TrueLayer provider name or manual label)
  - `provider_id`: string (Finexer stable ID for branding)
  - `type`: string ("Current", "Savings", "Credit Card", etc.)
  - `subtype`: string | null (e.g., "ISA", "Savings")
  - `balance`: number (GBP or KES)
  - `currency`: string ("GBP", "KES")
  - `status`: "connected" | "expired" | "reconnect_required" | "pending"
  - `account_number`: string | null (last 4 visible)
  - `sort_code`: string | null (UK only)
  - `manual`: boolean (offline account)
  - `logo_url`: string | null (Finexer dynamic logo)
  - `bg_colors`: string[] (Finexer gradient stops, hex)

### 2. **Manual Accounts**
- `api.manualAccounts()` → ManualAccount[]
  - `id`: string
  - `name`: string
  - `balance`: number
  - `account_type`: "savings" | "current" | "credit_card"
- `api.createManualAccount({ name, balance, account_type })`
- `api.updateManualAccount(id, { name, balance, account_type })`
- `api.deleteManualAccount(id)`

### 3. **Transactions**
- `api.transactions(accountId, { page, q, category, days, txnType, pageSize })` → { items: Transaction[], pages: number }
  - `id`: string
  - `account_id`: string
  - `description`: string
  - `merchant_name`: string | null
  - `amount`: number (absolute)
  - `transaction_type`: "debit" | "credit"
  - `date`: ISO8601 string
  - `category`: string | null
- `api.manualTransactions(accountId)` → Transaction[] (offline account ledger)
- `api.addManualTransaction(accountId, { description, amount, transaction_type, date })`
- `api.updateManualTransaction(accountId, txId, { description, amount, transaction_type, date })`
- `api.deleteManualTransaction(accountId, txId)`
- `api.patchTransaction(txId, { category, additional_ids })` → { bulk_count: number }
- `api.similarTransactions(txId, "single" | "all" | "future")` → Transaction[]

### 4. **Investment Accounts**
- `api.getInvestmentAccounts()` → InvestmentAccount[]
  - `id`: string
  - `provider`: string ("Vanguard", "Wealthify", "Hargreaves Lansdown", etc.)
  - `account_type`: string
  - `account_reference`: string
  - `total_value`: number (£)
  - `display_value`: number | null (post-refresh, if different)
  - `statement_date`: ISO8601 | null
  - `last_refreshed`: ISO8601 | null
  - `added_since`: number (from contract notes post-statement)
  - `notes_since`: number (count of notes since statement)
  - `provisional`: boolean (no statement yet, running total from 0)
- `api.deleteInvestmentAccount(id)`
- `api.refreshInvestmentPrices(id)` → { new_total: number }

### 5. **Investment Holdings**
- `api.getInvestmentHoldings(accountId)` → InvestmentHolding[]
  - `id`: string
  - `name`: string
  - `isin`: string | null
  - `type`: string ("Fund", "Stock", "ETF", etc.)
  - `units`: number
  - `statement_value`: number
  - `current_value`: number | null (live post-refresh)
  - `price_per_unit`: number
  - `current_price`: number | null (live post-refresh)

### 6. **Investment Notes**
- `api.investmentNotes(accountId)` → InvestmentNote[]
  - `id`: string
  - `fund_name`: string
  - `trade_date`: ISO8601
  - `kind`: "buy" | "sale"
  - `amount`: number (signed: +ve buy, -ve sale)
  - `superseded`: boolean (folded into next statement)
- `api.uploadInvestmentNote(accountId, file, password?)` → { account: InvestmentAccount, note: InvestmentNote }
- `api.uploadInvestmentNoteColdStart(file, password?)` → { account: InvestmentAccount } (creates provisional account)
- `api.deleteInvestmentNote(noteId)` → { account: InvestmentAccount }

### 7. **Manual Account Rules**
- `api.manualAccountRules()` → ManualAccountRule[]
  - `id`: string
  - `name`: string
  - `target_account_id`: string (offline account to post to)
  - `source_account_id`: string | null (filter by source, null = any)
  - `source_account_name`: string | null
  - `match_type`: "description_equals" | "description_contains" | "category"
  - `match_value`: string
  - `match_field`: "description" | "merchant" | null
  - `sign`: "opposite" | "same"
  - `active`: boolean
  - `applies_from`: ISO8601 | null
- `api.createManualAccountRule({ name, target_account_id, source_account_id, match_type, match_value, match_field, sign, backfill })`
- `api.updateManualAccountRule(id, { name, match_type, match_value, sign, source_account_id, match_field, backfill, active })`
- `api.deleteManualAccountRule(id)`

### 8. **Card Terms**
- `api.getCardTerms()` → { cards: CardTermsCard[] }
  - `account_id`: string
  - `terms`: { status: "confirmed" | "pending", apr_pct: number | null, promos: [{ until: string, apr_pct: number }, ...] }
- `api.createCardTerms(accountId, { apr_pct, promos })`
- `api.updateCardTerms(accountId, { apr_pct, promos })`

### 9. **Categories**
- `api.accountCategories(accountId)` → AccountCategorySummary[]
  - `name`: string (e.g., "Groceries", "Transport")
  - `total`: number (£)
  - `count`: number (txn count)
  - `pct`: number (% of total spend)
- `api.transactions(accountId, { category, pageSize: 100, days: 90, txnType: "debit" })` → { items: Transaction[] } (same endpoint, scoped)

### 10. **KPIs**
- `api.kpis()` → KPIs | null
  - `net_worth`: number (£)
  - `cash`: number (£)
  - `runway`: number (days)
  - `investments`: number (£)
  - `pensions`: number (£)
  - `last_updated`: ISO8601 | null

### 11. **Preferences**
- `api.getPreferences()` → { home_pinned_accounts: string[], hide_net_worth: boolean, ... }
- `api.updatePreferences({ home_pinned_accounts, hide_net_worth })`

### 12. **Connection & OAuth**
- `api.connectLink(providerId?: string)` → { auth_url: string } (TrueLayer OAuth)
- `api.finexerConnectLink()` → { auth_url: string; connection_id: string } (Finexer OAuth)

---

## Finexer BANK_META Alias Mapping (Correctness Risk)

**Divergence found:** Web `AccountMiniCard.tsx` FINEXER_ALIAS map includes bare keys (`hsbc:`, `revolut:`) that mobile `AccountsGrid.tsx` omits.

**Web set (complete):**
```
hsbc_personal, hsbc, hsbc_business, hsbc_kinetic, hsbc_net, hsbc_ms,
revolut
```

**Mobile set (missing some):**
```
hsbc_personal, hsbc_business, hsbc_kinetic, hsbc_net, hsbc_ms,
(no bare hsbc:, revolut:)
```

**Action required:** When building mobile accounts screen, add the missing bare keys to FINEXER_ALIAS in the mobile components to prevent Finexer accounts from falling back to DEFAULT gradient when the API returns these codes:

```javascript
hsbc: "HSBC",
revolut: "REVOLUT",
```

---

## Current Mobile State

The mobile app currently has **NO native Accounts screen**. Only the Home AccountsGrid exists (`mobile/components/home/AccountsGrid.tsx`), showing:
- Top 3 pinned or highest-balance accounts
- First investment account (if exists)
- "+N more accounts" card (links to Accounts / Manage)

**AccountsGrid tokens & layout:** (from existing code)
- Card: `tw.radius["2xl"]` (16px), `tw.space[4]` padding (16px)
- Mini-card min-height: 124px
- Logo: 36×36 rounded-xl, white/95 bg, 32×32 img
- Type badge: 10px UPPERCASE bold, white/90, white/20 bg pill
- Provider name: 10px/600 UPPERCASE widest, white/60, margin-bottom 4px
- Account name: 11px, white/75, margin-bottom 8px
- Balance: 20px/700 bold white, tight tracking
- Deco circle: 80×80 white/10 absolute bottom-right

---

## React Native Porting Notes

### 1. **Charts & Sparklines**
- Web uses React Recharts (tiny sparklines in category cards) → **RN:** react-native-svg + react-native-svg-charts or lightweight path renderer
- Investment holdings: No sparklines, just values

### 2. **File Uploads**
- Web: `<input type="file">` (browser native) → **RN:** `expo-image-picker` (photos) + `expo-document-picker` (PDFs)
- Password-protected PDFs: `react-native-pdf` (viewer) + backend PDF parsing

### 3. **Bottom Sheets & Modals**
- Web: `createPortal()` to body + CSS (fixed, glass backdrop, slide-up animation)
- **RN:** `react-native-modal` or `@react-navigation/bottom-sheet` + `Animated` API for slide-up (280ms, `cubic-bezier(0.32, 0.72, 0, 1)`)
- Glass: Use `blurRadius={12}` on Android via `react-native-blur`; iOS native blur view

### 4. **OAuth Flows**
- TrueLayer: `expo-auth-session` + `expo-web-browser` (deeplink callback to app)
- Finexer: Same pattern
- Mono (Kenya): SDK may provide RN component or webview wrapper

### 5. **Search & Autocomplete**
- Transaction search: Client-side filter (RN state) + debounce (setTimeout) + FlatList refinement
- Rule search: Same debounced pool search, TransactionRow render per match

### 6. **Permissions**
- Camera: Not needed (photo picker only)
- File system: `expo-document-picker` handles permissions transparently
- Pasteboard: Not used

### 7. **Animation & UX**
- Card press: `scale(0.95)` via inline transform (Pressable pressed state), no Animated.spring
- Spinner: Use `react-native-svg` `<Circle>` + `Animated.loop(Animated.timing(...))`, or react-native-activity-indicator native
- Sheet slide-up: 280ms cubic-bezier easing via `Animated.timing()`
- Segmented control: Already exist in codebase (use same)
- Number formatting: `toLocaleString()` works (non-formatting Unicode supported in RN text)

### 8. **Responsive Layout**
- Mobile (< 600px): Single column for transactions, single-row segmented, full-width buttons
- Tablet (≥600px): 2-column grid for categories, side-by-side buttons where applicable
- Use `useWindowDimensions()` to detect width (same as Home AccountsGrid)

### 9. **Keyboard Handling**
- Text inputs in modals: Use `KeyboardAvoidingView` (iOS) + `android:windowSoftInputMode` (manifest)
- Number inputs: `inputMode="decimal"` supported in React Native 0.71+

### 10. **Icons**
- Web: `lucide-react` (Chakra-based React icon library)
- **RN:** `lucide-react-native` (same icons, RN-optimized) — already used in Home AccountsGrid
- SVG logos (bank favicons): `Image` from google favicon service (HTTP, cached)

### 11. **Dark Mode**
- Web: Tailwind `dark:` classes
- **RN:** NativeWind `dark:` + `useColorScheme()` hook (auto-detect or user pref)
- All colors in mobile/lib/tw.ts must have light + dark variants

### 12. **Status Bar & Safe Area**
- Wrap top-level view with `useSafeAreaInsets()` (already used in AccountsGrid)
- Status bar text color: `setStatusBarStyle()` (light/dark based on theme)

### 13. **Swipe Gestures**
- Desktop web: Swipe between transaction pages (touch handlers exist on web)
- **RN:** Use `react-native-gesture-handler` + `PanResponder` for swipe (optional; not critical for MVP)

---

## Open Questions & Risks

### 1. **Finexer Account Branding**
- **Question:** Do Finexer accounts always provide `bg_colors` and `logo_url`? What if missing?
- **Risk:** Fallback to BANK_META on mismatch; may not match web exactly if Finexer API changes
- **Solution:** Validate Finexer API contract in backend; always provide 2 hex colours or null

### 2. **Cold-Start Investment Account UX**
- **Question:** Should user see empty holdings list before statement upload?
- **Risk:** Confusing state — "total value £500 but no holdings"
- **Solution:** Hide holdings until statement uploaded (provisional = no holdings)

### 3. **Rule Match Validation**
- **Question:** Backend substring search vs. UI pattern detection — what if mismatch?
- **Risk:** User picks transaction, UI says "will match 5", but only 2 match at save time
- **Solution:** Fetch counts at save time, not UI-side; show "Checking…" while saving

### 4. **Password-Protected PDFs**
- **Question:** React-native-pdf + expo-document-picker: does iOS/Android support embedded password input?
- **Risk:** May need custom C++ / native module for PDF decryption
- **Solution:** Offload to backend (send encrypted PDF + password, decrypt server-side)

### 5. **Pagination on Mobile**
- **Question:** Swipe between pages on mobile? Or "Load more" infinite scroll?
- **Risk:** Swipe UX fragile; infinite scroll creates memory issues with large datasets
- **Solution:** Use swipe + "Prev / Next" buttons (dual affordance, mirrors web)

### 6. **Reconnect Validation**
- **Question:** Account re-match after OAuth (account_number check) — will it work on Finexer?
- **Risk:** Finexer returns different account_number format or missing field
- **Solution:** Validate Finexer account_number field; fallback to account_reference if needed

### 7. **Glass Morphism on Android**
- **Question:** Does `react-native-blur` work reliably on Android 6+?
- **Risk:** Blur may be janky or not support backdrop-filter-like stacking
- **Solution:** Use opacity-based fallback on Android if blur unavailable (solid semi-transparent overlay)

### 8. **Investment Notes Superseding**
- **Question:** When user uploads statement, backend marks old notes as superseded. UI must reflect this.
- **Risk:** Stale UI if cached note list not refetched
- **Solution:** Refetch investmentNotes + investmentHoldings on every investment account expand (no cache)

### 9. **Merchant Icon Lookups**
- **Question:** Google favicon service — does it work over HTTPS? Can we cache?
- **Risk:** Slow network requests per transaction; high traffic could trigger rate-limits
- **Solution:** Use FastImage (caching layer) + placeholder initials on error

### 10. **Multi-Select on Touch**
- **Question:** Tap to check/uncheck txns in TransactionSheet multi-select — is it clear?
- **Risk:** Users may expect long-press to toggle, not single tap
- **Solution:** Add checkboxes (CheckSquare icon) on left of each txn; explicit toggle affordance

### 11. **Breadcrumb Navigation**
- **Question:** List → Detail → Sheet stacking — does React Navigation history.back() work through all 3?
- **Risk:** Back gesture may skip sheets or pop to wrong screen
- **Solution:** Use modal stackNavigator for sheets; history.back() closes innermost layer

### 12. **Rule Source Account Scoping**
- **Question:** If rule.source_account_id is set, UI must filter the transaction pool — server-side or client?
- **Risk:** Frontend pool is cached; if source account is new, pool won't include its txns
- **Solution:** Always refetch full pool when rule modal opens; don't cache across sessions

### 13. **KPIs Net Worth Display**
- **Question:** What if kpis is null after API call? Show "Loading…" or empty?
- **Risk:** Page visible but net-worth header blank — awkward
- **Solution:** Show skeleton on initial load; if error, show "Unable to load" (safe default)

### 14. **Investment Value Precision**
- **Question:** Price per unit may have 4 decimal places; display precision for current_value?
- **Risk:** Rounding errors accumulate (units × price ≠ value_total)
- **Solution:** Display price to 2 decimals (truncate, don't round); total to 2 decimals (use backend value)

### 15. **Offline Account Transactions — Edit Validation**
- **Question:** Can user edit date to before account creation? Before statement date on investment?
- **Risk:** Logical inconsistency (txn before account exists)
- **Solution:** Validate client-side: date ≥ account creation date; server-side enforce as well

---

## Summary Table

| Section | Component | Tokens | State | Interaction |
|---------|-----------|--------|-------|-------------|
| **Header** | Net worth card | glass-card, 30px/700 num | KPI load, hidden | Eye toggle |
| **Banks List** | Account mini-card | 2-col grid, gradient bg, 124px min | Empty, loading, expired | Tap→detail, pin, reconnect |
| **Investments** | Collapsible card | glass-card, TrendingUp icon | Provisional, holding load | Expand, refresh prices, delete |
| **Detail Head** | Provider gradient | accountBrand gradient | Type badge, balance | Back, Edit/Reconnect, Remove |
| **Txns** | TransactionRow | Grid, merchant icon, category | Paginated, search, load | Tap→sheet, categorise, bulk |
| **Categories** | Grid cards | 2-col, bar chart, icon chip | Empty, load | Tap→CategorySheet, drill |
| **Rules** | Row list | Flex, On/Off pill | Empty, load | Tap edit, toggle active, delete |
| **Manual Txn** | Form modal | glass-sheet, 3 fields | Edit, add | Save, delete (edit only) |
| **Card Terms** | Sheet | glass-sheet, form | Load, capture | Save, dismiss |
| **Confirm** | Dialog | Portal, dark card | Message + 2 buttons | Destructive red button |

---

**Final note:** This component is the single largest surface in the app. Prioritise 1:1 fidelity on the Home AccountsGrid visual style (mini-card gradient, typography, spacing); leverage existing mobile modal patterns for sheets; defer animations (swipe, blur) to post-MVP if time is tight. The core UX (tap account → detail, tap txn → categorise, tap rule → edit) must be rock-solid on day one.
