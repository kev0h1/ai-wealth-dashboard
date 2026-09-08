# Debt Plan Screen Porting Guide

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** eebde4c 2026-08-05 11:22:36 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/debt-plan/DebtPlanPage.tsx`

---

## Purpose & Emotional Job

**STATUS: LIVE** — The debt-plan route is actively linked from GoalsStrip, Planning page debt cards, and Insights deep-links. This is a primary surface for debt payoff planning.

The Debt Plan screen answers **"When will I be free of card debt?"** and **"What would it take to clear sooner?"** It drills from a verdict (total carried debt, payoff horizon) through scenario comparisons (as-is vs. dearest-card-first), per-card breakdown, and strategic options (transfer routes, interest payoff projections). Every element supports the **agency job**: showing the user that debt is a solvable structure, not a moral judgment.

**Emotional payoff:** Control and optimism. The user sees:
- **Verdict first** (carried debt total, clearance month, interest cost at pace)
- **Agency block** (what extra monthly payment would clear by target date, which cards are winning)
- **Penny insight** (LLM narration anchored to the specific data, timed to user rhythm)
- **Trajectory comparisons** (same pool, dearest-card-first strategy vs. as-is)
- **Per-card breakdown** (each card's rate, payoff month, usage conflict warning if any)
- **Refinance options** (balance transfer opportunities with fee analysis)

---

## Source Files (Full Paths)

### Page Component
- `/root/ai-wealth-dashboard/frontend/app/debt-plan/DebtPlanPage.tsx` — Main page logic: data fetch, sheet state, burndown background render, rise-in stagger indices.

### Child Components & Sheets
- `/root/ai-wealth-dashboard/frontend/components/CardTermsSheet.tsx` — Bottom sheet for per-card rate/promo/BT-offer entry. Multi-card session or single-card (pill-tap). Phases: loading → found (representative rate) → candidates (card disambiguation) → manual entry. Fields: standard rate, 0% promos (kind/until-date/rate), unused BT offers (ends/fee_pct/note), usage (clear-monthly vs. carry).
- `/root/ai-wealth-dashboard/frontend/components/BottomNav.tsx` — Footer navigation bar (imported for mobile parity).
- `/root/ai-wealth-dashboard/frontend/components/AccountMiniCard.tsx` — BankBadge component (bank logo chip, used for per-card rows).
- `/root/ai-wealth-dashboard/frontend/components/PlanOneOffSheet.tsx` — RadioDot component (radio button indicator, used in card-terms sheet).
- **Note:** Do NOT import ConfirmDialog or ProgressBar — these are not used in the debt-plan surface.

### Shared Infrastructure
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` — `getDebtPlanView()`, `getCardTerms()`, `lookupCardTerms()`, `saveCardTerms()`. Types: `DebtPlanView`, `DebtPlanViewCard`, `CardTermsCard`, `CardTermsLookup`, `CardTermsSaveBody`.
- `/root/ai-wealth-dashboard/frontend/lib/goBack.ts` — Back navigation helper.
- `/root/ai-wealth-dashboard/frontend/components/PreferencesContext.tsx` — `hideNetWorth` preference for blurred amounts.
- `/root/ai-wealth-dashboard/frontend/lib/useLockBodyScroll.ts` — Body scroll lock for sheet open.
- `/root/ai-wealth-dashboard/frontend/lib/useSheetOpen.ts` — Page-layer blur trigger (adds `sheet-open` class to `#app-shell`).
- `/root/ai-wealth-dashboard/frontend/lib/useSheetA11y.ts` — Accessibility hook for sheet focus management.

### SVG & Charts
- Burndown background (`BurndownBackground` component) — Monotone cubic interpolation (Fritsch-Carlson) for history + projection curves. Custom SVG with glow filter on web.

---

## Layout Anatomy: Top → Bottom

### 1. Back Navigation (rise-in stagger 0)
**Button group** — flex, gap-1.5
- **Icon:** `ChevronLeft` (15px, lucide-react)
- **Label:** `"Back"` — `text-sm font-medium text-slate-600 dark:text-slate-300`
- **Interaction:** `active:opacity-70 transition-[transform,opacity]`
- **Margin:** `mb-5` below

---

### 2. Burndown Background (when projection exists)
**Layer:** Fixed `inset-0 -z-10` (behind all content)
**Render only if:** `plan?.projection?.length >= 1`

**SVG Structure:**
- ViewBox: `0 0 100 100` (normalized coordinate space)
- Two monotone-cubic paths:
  1. **Solid path** (history + anchor to projection start) — `strokeWidth: 8` (non-scaling), `stroke-linecap: round`
  2. **Forecast path** (projection) — dashed `strokeDasharray: "16 10"`, same stroke properties
- **Seam line** (vertical) — marks transition from history to projection (when history exists)
- **SVG filter:** Gaussian blur (stdDev 0.8) for soft glow on strokes

**CSS Classes (custom in globals.css):**
- `.burndown-line-forecast` — Projection line stroke colour (indigo-400 or similar)
- `.burndown-line` — History line stroke colour (indigo-600)
- `.burndown-seam` — Vertical line stroke (slate-200 light / slate-700 dark)

**Body class trigger:** When active, adds `debt-burndown` to `document.body` for custom background treatments.

---

### 3. Verdict Block (rise-in stagger 1, glass-hero)
**Container:** `rounded-3xl p-5` (glass-hero surface)
**Background:** Card White / Slate Card (with glass-hero frost effect)

**Row 1 — Label:**
- Text: `"CARRIED ON YOUR CARDS"` or `"ACROSS YOUR CARDS"` (depends on buckets.float_total >= 1)
- Style: `text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300`

**Row 2 — Headline Figure:**
- Amount: `£` + total carried (if float exists) or total debt
- Style: `text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight mt-1`
- Masking: If `hideNetWorth=true`, show `••••`

**Row 3 — Split line (conditional, only if buckets + float_total >= 1):**
- Sentence structure:
  - With interest: `"£X carried — £Y of it costing interest · £Z of monthly spending you clear as you go"`
  - On 0% deals: `"£X carried on 0% deals · £Z of monthly spending you clear as you go"`
  - Generic: `"£X carried · £Z of monthly spending you clear as you go"`
- Style: `text-[13px] mt-1 text-slate-600 dark:text-slate-300` (muted, secondary line)

**Row 4 — Verdict Sentence (15px leading-relaxed):**
- Content depends on `totals.verdict` ("good" / "drifting" / "bad"):
  - **bad, no debt_free_month:** `"At your current pace the cards aren't coming down."` + optional 3m trend
  - **bad, with debt_free_month:** `"At your current pace the cards clear in [month] — further out than five years."` + optional trend
  - **drifting:** `"At your current pace the cards clear in [month] — [interest] of that will be interest."`
  - **good:** Either `"Nothing material on the cards right now."` or `"At your current pace the cards clear in [month], with [interest] interest."`
- Visual accent: `amberDot` (inline 8×8px rounded-full `bg-amber-500 mr-2`) precedes bad/drifting verdicts

---

### 4. Agency Block (optional, rise-in stagger 2)
**Shown if:** `extra_to_clear != null` OR `whats_working?.length > 0`

**Label:** `"WHAT IT WOULD TAKE"`
**Container:** `glass-card rounded-2xl p-4 space-y-2`

**Content lines (paragraphs, `text-sm leading-relaxed`):**
1. **Extra-to-clear sentence (if present):**
   - If `extra.amount === 0`: `"Your current pace already clears every [card-word] by [month]."`
   - Else: `"£X more a month clears every [card-word] by [month]."`
   - Styling: Amount in bold `text-slate-900 dark:text-slate-100`

2. **Wins (one per clearing card, if present):**
   - Per card: `"[Card name] is on its way out — clearing [month] at your pace."`
   - Month in bold emerald `text-emerald-600 dark:text-emerald-400`

---

### 5. Penny Insight Block (optional, rise-in stagger 3)
**Shown if:** `plan.narration?.text` exists

**Container:** `glass-card rounded-2xl p-4`

**Header line — Penny badge:**
- Badge: Inline-flex, indigo→violet gradient background `linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)`
- Badge padding: `px-2.5 py-1`
- Badge radius: `rounded-full`
- Badge text: `"✦ Penny"` — `text-[10px] font-semibold uppercase tracking-wide text-white`

**Body text:**
- `text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 max-w-prose`
- Content: `plan.narration.text` (LLM-generated narrative about the debt situation)
- Masking: If `hideNetWorth=true`, regex-replace all `£[\d,]+(\.\d+)?` with `£••••`

**Optional button (one of):**
1. If `narration.ask` exists:
   - Label: `"How I use this card"` (usage ask) or `"Add the deal"` (term ask)
   - Action: `onClick={() => openSheet(ask.account_id)}`

2. Else if missing rates exist:
   - Label: `"Add rates"`
   - Action: `onClick={() => openSheet(null)}` (opens sheet in multi-card mode)

3. Else: No button

**Button styling:** Indigo primary `bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-[transform,opacity]`

---

### 6. Missing-Rates Callout (optional, rise-in stagger 4)
**Shown if:** `showMissingRates === true` (cards with `flags.terms_missing && debt > 0`)

**Container:** `glass-card rounded-2xl p-4`

**Paragraph 1 — Headline:**
- `text-sm font-semibold text-slate-900 dark:text-slate-100`
- Content: `"[N] card[s] have[s] no rate on file, so their interest isn't counted."`

**Paragraph 2 — Subtext:**
- `text-[13px] text-slate-600 dark:text-slate-300 mt-1`
- Content: `"Add them once and the plan can count every pound of interest."`

**Button:**
- Label: `"Add rates"`
- Styling: Indigo primary (see section 5)
- Margin: `mt-3`
- Action: `onClick={onAddRates}` → `openSheet(null)`

---

### 7. Trajectory Blocks (optional, rise-in stagger 5)
**Shown if:** `showTwoTrajectory === true` (either "As it stands" or "Dearest card first" has content)
**Container:** `space-y-3` (two separate card sections)

#### 7a. "As it stands" block (shown if monthly interest OR potential interest visible)
**Container:** `glass-card rounded-2xl p-4`

**Label:** `"As it stands"` (rendered with CSS `uppercase` class) — `text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300`

**Case 1: Monthly interest > 0 (observed)**
- Headline: `"[Amount] a month in interest right now"` — amount in `text-2xl font-bold`, suffix in `text-sm`
- Line 2 (if non-clearing cards + interest on them): `"£X of that is on [N] card[s] that isn't/aren't clearing at your pace."` — `text-sm leading-relaxed mt-2`
- Line 3 (if interest to clear >= 1): `"£X to clear [rest of them / them at your pace]."` — `text-sm leading-relaxed mt-1`

**Case 2: No interest, but potential interest exists**
- Headline: `"No interest is hitting your cards right now."` — `text-[15px] font-semibold text-slate-900 dark:text-slate-100 mt-2`
- Subtext (if potential >= 1): `"If these balances ran past their 0% windows at the rates on file, they'd cost about £X a month."` — `text-sm leading-relaxed mt-1`

#### 7b. "Dearest card first" block (shown if scenario_b is a strategy with interest_saved >= 50)
**Container:** `glass-card rounded-2xl p-4 space-y-2`

**Label:** `"Dearest card first"` (rendered with CSS `uppercase` class) — `text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300`

**Sentence (complex, `text-sm leading-relaxed`):**
- Template: `"Same £X a month, dearest card first — clears [what] by [month] with £Y interest."`
- Variations on second sentence:
  - **Not clearing as-is, but strategy clears:** `"As it stands, [N] of those cards don't clear at all; by [month] they'd have cost £Z."`
  - **Clearing as-is too:** `"As it stands the same cards would have cost £Z by [month]."` + optional sooner clause (`", N months sooner than your current pace ([month])"`)
- **Month and amounts styled:** `font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`

**Interest saved (if >= 1, bold emerald):**
- `"That's £X less interest."` — emerald-600 dark:emerald-400

**Rising debt warning (if history.rising):**
- `"Your carried debt has risen £X over the last three months."` — `text-sm leading-relaxed`

**Assumption note (if present, italic muted):**
- `text-[12px] text-slate-600 dark:text-slate-300 italic`

---

### 8. The Cards Section (always visible, rise-in stagger 6)
**Label:** `"THE CARDS"` — `text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300`

**Container:** `glass-card rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/60`

**Per-card row (div, `p-4 space-y-2`):**

#### 8a. Line 1 — Badge, name, debt amount
- Flex: `items-center gap-3`
- **Badge** (left): BankBadge from `resolveBankChip(card.provider)`
  - `logoSrc`, `initials`, `altText`, `brandBg` properties
- **Name** (flex-1): `text-sm font-semibold text-slate-900 dark:text-slate-100 truncate`
- **Debt amount** (right): `text-base font-bold text-slate-900 dark:text-slate-100 flex-shrink-0`
  - Format: `"£0"` if zero, else `fmtMoney(debt, hide)`

#### 8b. Line 2 — Rate pill
**Button styling:**
- Base: `rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform`

**States:**
1. **No rate (terms_missing or no segment):**
   - Label: `"Add rate"`
   - Styling: `border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400`
   - onClick: `() => openSheet(card.account_id)`

2. **Promo (source === "promo"):**
   - Label format: `"[APR]% until [month]"` or `"[APR]%"`
   - **If cliff (until within 60 days):**
     - Styling: `text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800`
   - **Else:**
     - Styling: `text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600`
   - onClick: Edit card

3. **Standard or unknown:**
   - Label: `"[APR]%"` or `"Rate on file"`
   - Styling: `text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600`

#### 8c. Line 3a — Cleared monthly (mutually exclusive with 8c)
**Text (`text-[13px] text-slate-600 dark:text-slate-300`):**
- `"Cleared monthly — this is spending, not carried debt."`

#### 8c. Line 3b — Non-cleared card details
**Only shown for non-cleared cards:**

- **Movement line (if monthly payment > 1):**
  - `"+£X/mo at your pace"` — `text-[13px] text-slate-600 dark:text-slate-300`

- **Projected flat note (if no movement + assumption exists):**
  - Custom assumption text (e.g., `"projected flat"`) — `text-[13px]`

- **Payoff line (if payoff_month exists):**
  - `"Clears [month]"` — `text-[13px]`
  - Optional interest: `" · £X interest"` (only if total_interest >= 1)

- **Non-clearing line (if no payoff + debt > 0 + monthly_interest_now >= 1):**
  - `"Not clearing at your pace · £X/mo interest right now"` — `text-[13px]`

#### 8d. Line 4 — Usage conflict warning (if present, amber calm tone)
**Text (`text-[13px] text-amber-700 dark:text-amber-400`):**
- `"You said you clear this monthly, but interest charges are appearing — worth a look."`

#### 8e. Line 5 — Near-term payment note (if payment in upcoming bills)
**Text (`text-xs text-slate-400 dark:text-slate-500`):**
- `"Its usual payment is already in your upcoming bills"`

---

### 9. Transfer Routes (optional, rise-in stagger 7)
**Shown if:** `plan.refinance_options?.length > 0`

**Label:** `"TRANSFER ROUTES"` — `text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300`

**Per-option card (`glass-card rounded-2xl p-4`, repeated):**

**Sentence structure (text-sm leading-relaxed):**
- Template: `"Moving £X from [source name] ([rate]%) to [dest name]'s offer: £Y fee once instead of ~£Z/mo interest."`
  - Source name: from `opt.source_name`
  - Rate (parenthetical): from source card's standard segment APR, if available
  - Amount: `fmtMoney(opt.transferable, hide)`
  - Destination: `opt.destination_name`
  - Fee: `fmtMoney(opt.fee, hide)`
  - Monthly interest avoided: `Math.round(interest_saved / window_months)`

- **Break-even clause (if break_even_weeks exists):**
  - `" Break-even in [weeks] weeks."`

**Assumptions note (if present, italic muted):**
- `text-[12px] text-slate-600 dark:text-slate-300 italic mt-2`
- Content: `opt.assumptions.join(" · ")`

---

## Component States

### Loading State
- Show 3 SkeletonCard repeats (animate-pulse, 4px + 3px + 3px lines)

### Error State
- Single `glass-card` with: `"The plan couldn't load — pull back and try again."` (`text-sm`)

### Empty Cards
- Possible but unlikely (user has credit cards from open-banking sync). If no cards: verdict/agency/penny/etc. still render if present.

### CardTermsSheet States
1. **Loading** (for each card): `"Checking this card's advertised rate…"` + 2 skeleton lines
2. **Found representative rate:** Display lookup APR, offer to use or override
3. **Candidates (ambiguous card):** Radio list of candidate products, pick one then fill details
4. **Manual entry:** User enters standard rate, optional 0% promos, optional BT offers, usage
5. **Finished:** Closing screen with count sentence, "Done" button

---

## Interactions & Sheets

### CardTermsSheet (Bottom Sheet, height `max-h-[85dvh]`, rounded-t-3xl)

**Lifecycle:**
1. User taps a rate pill or "Add rates" button
2. If single-card session: sequence = `[card]`; else: sequence = all cards (walk-through)
3. For each card (unless already confirmed):
   - Fire `api.lookupCardTerms(accountId)` → determine phase (loading → found/candidates/manual)
   - User selects representative rate or enters manual details
   - User fills optional sections: 0% promos (up to 4), unused BT offers (up to 6), usage
4. Save advances to next card; if last, show closing screen

**Per-card fields:**

#### Standard Rate Input
- **Label:** `"What's the rate on it?"` — `text-[11px] uppercase tracking-wide text-slate-500`
- **Hint:** `"The card's standard rate — what it charges once no deal covers the balance."` — `text-xs text-slate-400 mb-1.5`
- **Input:** `type="text" inputMode="decimal"` placeholder `"24.9"`, unit suffix `"%"` (right-aligned)
- **Styling:** `min-h-[48px] pl-3 pr-9 rounded-xl bg-slate-50 dark:bg-slate-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`
- **Validation:** 0 to 100, allow decimal

#### 0% Promos Section
- **Question:** `"Is any of this £X on a 0% deal?"` — `text-xs text-slate-400 mb-1.5`
- **Hint:** `"Balance transfers you've already made count here — add each one and when it ends."`
- **Chips (grid cols-2):** Yes / No (Chip component, selected state is indigo-50 bg + indigo border + indigo text)
- **Field name note:** Promos use `until` (ISO date string); BT offers use `ends` (ISO date string) — both are end-of-month conventions.

**If Yes (promoOn === true), per row (up to 4):**
- **Row header:** `"Deal N"` with delete button (X icon, 14px)
- **On what? (radiogroup, grid cols-3):** Purchases / Balance transfers / Both
- **Until (months 1-12, grid cols-4 + years 4-wide):** Month + Year chips (disable past dates relative to today)
- **Deal rate (%, optional):** Text input, 0-30, decimal allowed
- **Add another:** Button (+ icon, text-indigo-600) appears if < 4 rows

#### Unused BT Offers Section
- **Question:** `"Any 0% offers you haven't used yet?"` — `text-xs text-slate-400 mb-1.5`
- **Hint:** `"Offers the card is dangling — not ones you've already taken."`
- **Chips (grid cols-2):** Yes / No

**If Yes (btOffer === true), per row (up to 6):**
- **Row header:** `"Offer N"` with delete button
- **Ends (month + year):** Same grid structure as promos
- **Fee (%, optional 0-15):** Text input with `%` suffix
- **Note (freetext, max 120 chars):** Placeholder `"e.g. 0% for 12 months"`
- **Add another:** Button (+ icon) if < 6 rows

#### Usage Section
- **Question:** `"How do you use this card?"` — `text-xs text-slate-400 mb-1.5`
- **Hint:** `"Optional — it helps me read this card's balance right."`
- **Chips (grid cols-2):** "I clear it monthly" / "I carry a balance" (toggle; can deselect)

### Open-Sheet Actions
- **From Verdict/Agency/Penny:** `openSheet(null)` → multi-card mode
- **From Rate pill:** `openSheet(card.account_id)` → single-card session
- **From CardTermsSheet footer:** "Later" saves skip; "Save" saves confirmed terms

---

## Data: API Endpoints & Key Fields

### GET /debt-plan
Returns `DebtPlanView` with:
- **status** — always "ok" or error
- **computed_at** — ISO timestamp
- **horizon_months** — planning window for projections
- **cards** — array of `DebtPlanViewCard`
- **totals** — `DebtPlanTotals` (aggregated across cards)
- **scenario_b** — either error note OR strategy object with comparison metrics
- **refinance_options** — array of balance transfer suggestions
- **projection** — array of `DebtPlanProjectionPoint` (burndown forecast, if computation succeeded)
- **whats_working** — array of `DebtPlanWin` (cards clearing)
- **extra_to_clear** — singleton or null; amount extra per month to hit debt_free_month
- **history** — if available, historical balance curve + trend flags
- **narration** — LLM insight block (text + optional ask for a specific card)

### GET /card-terms
Returns `CardTermsList` with:
- **status** — `"ok"` or error
- **cards** — array of `CardTermsCard` (all credit cards from open-banking)
- **rate_note** — disclaimer: `"A representative rate is not the user's own rate…"`

### POST /card-terms/:accountId/lookup
Queries external rate sources for a card's advertised rate. Returns `CardTermsLookup`:
- **representative_apr** — null if not found; number if found
- **display_name** — advertised product name
- **candidates** — array of product names (if ambiguous)
- **lookup_status** — human label ("Found", "Ambiguous", "Not found", etc.)
- **status** — "ok" or error
- **product_key** — unique lookup identifier (string | null)
- **stale** — boolean; true if the cached lookup is old (>30 days)
- **source_url** — URL where rate was found (string | null)
- **ambiguous** — boolean; drives the candidates disambiguation phase
- **rate_basis** — classification of the rate type ("standard", "promotional", etc.)
- **rate_note** — disclaimer or caveat about the rate

### POST /card-terms/:accountId
Saves entered terms for a card. Payload: `CardTermsSaveBody`:
- **status:** "confirmed" or "skipped"
- **apr_pct:** number | null
- **promos:** `CardPromo[]` (kind, apr_pct, until: ISO date)
- **bt_offers:** `BtOffer[]` (ends: ISO date, fee_pct, note)
- **usage:** "clear_monthly" | "carry" | null
- **product_key:** string | null (from lookup)
- **min_payment_note:** string | null (optional; e.g. "£5 or 2% balance, whichever is higher")

---

## Current Mobile State

**NONE** — This is a new screen. Web-only precedent.

---

## React Native Port Notes

### Key Architectural Differences

1. **No SVG native support for burndown:** The Fritsch-Carlson cubic interpolation SVG (`BurndownBackground`) is web-specific. On mobile, consider:
   - **Option A:** Skip the burndown visual (reduce visual debt, focus on data tables).
   - **Option B:** Use `react-native-svg` + `d3-shape` curvature functions (moderate effort).
   - **Option C:** Render a simple bar chart with `react-native-svg` (lower fidelity but functional).
   - **Recommendation:** Start with Option A for MVP; burndown is inspirational, not actionable.

2. **Sheet interactions:** CardTermsSheet is a bottom sheet (use Expo's `BottomSheetScrollView` or custom modal). Multi-card sequence (walk-through with index + total footer) translates directly to RN.

3. **Rise-in stagger animation:** Web uses CSS `animation: slideUpSheet` with `--rise-index` delays. On RN, use Reanimated 3 with `Animated.stagger()` or sequential `useEffect` + `Animated.timing()`.

4. **Glass effect:** `glass-card`, `glass-hero`, `glass-sheet` (web: `backdrop-filter: blur`). On RN, approximate with semi-transparent overlays + tinted views (Tailwind dark mode → manual color pairs). No blur on mobile (CPU-intensive).

5. **Typography:** Use web's `text-4xl / font-bold` → RN `fontSize: 30, fontWeight: '700'` via `tw.text['3xl']` + `tw.weight.bold`. Consistent with Spend screen porting.

6. **Colours:** All hex values map 1:1 via `/root/ai-wealth-dashboard/mobile/lib/tw.ts`. Indigo-600 (#4f46e5), Indigo-700 (#4338ca), Amber-500 (#f59e0b), Emerald-400 (#34d399), etc. — already defined.

7. **SVG currency/utility icons:** `ChevronLeft`, `ChevronRight`, `X` (lucide-react) → `lucide-react-native` equivalents. Icon sizes: 15-16px web → adjust for mobile safe-area.

8. **Input validation:** Rate inputs (`inputMode="decimal"`) → RN `keyboardType="decimal-pad"`. Chips are press-responders with `active:scale-95` → `Animated.timing()` or simple `opacity` feedback.

9. **Memoisation:** API calls (`getDebtPlanView`, `getCardTerms`, `lookupCardTerms`) should be hoisted to a custom hook or Context (like web's `useEffect` + state), avoiding redundant fetches during navigation.

10. **Navigation:** `goBack(router)` in web → RN `useNavigation().goBack()` or back action in route params.

### Mobile-Specific Features

- **Swipe to dismiss CardTermsSheet:** Gesture handler integration (already in use elsewhere in mobile app).
- **Safe area:** Respect `useSafeAreaInsets()` for sheet footer padding (`pb-safe` or manual `paddingBottom: insets.bottom`).
- **Scroll behaviour:** CardTermsSheet body must support scroll lock + inner scroll (body → sheet overflow-y logic). Test on both platforms.
- **Bottom navigation:** Ensure `BottomNav` is always visible below all other content (Zstack or absolute positioning).

---

## Open Questions & Risks

1. **Burndown visual:** Confirm with Kevin whether the chart background is load-bearing for understanding payoff trajectory, or whether a simple number + table is sufficient on mobile (space-constrained).

2. **Multi-card sheet walk-through:** Is the single-card session (pill tap) prioritized over the full walk-through on mobile? Test both UX paths early.

3. **Penny insight LLM call timing:** The narration is fetched server-side and cached. Confirm latency expectations on poor networks (mobile); show spinner until ready or load without it?

4. **Transfer routes (refinance options):** Low mobile-friendliness (dense text, multiple columns). Consider card-based list vs. multi-column table. May need design adjustments.

5. **Rate pill styling edge cases:** Very long card names (Amex Platinum long form) may overflow badge + name line. Test text truncation + swipe-reveal on mobile.

6. **Scenario B comparison sentence:** Complex nested text. Consider splitting into multiple short lines on mobile (narrow viewport).

7. **History trend flags:** If 3-month trend shows rising debt, the warning sentence is inline. On mobile, may need a separate callout or warning chip for visibility.

8. **Accessibility:** Screen reader announcements for "rise-in stagger" and burndown SVG (aria-hidden currently). Ensure all interactive elements have labels and WCAG AA contrast.

---

## Checklist for Mobile Implementation

- [ ] Create `mobile/app/(tabs)/debt-plan.tsx` (or route equivalent)
- [ ] Create `mobile/components/CardTermsSheet.tsx` (bottom sheet + multi-card sequence)
- [ ] Create or adapt `mobile/components/BurndownBackground.tsx` (or skip for MVP)
- [ ] Create helper: `mobile/lib/debtPlan.ts` (format functions: `fmtMoney`, `fmtMonth`, isCliff)
- [ ] Adapt API types from `/root/ai-wealth-dashboard/frontend/lib/api.ts` to mobile
- [ ] Test CardTermsSheet multi-card walk-through (index tracking, save/later/close states)
- [ ] Test 0% promo grid chips (month/year selection, disable past dates)
- [ ] Test rate input validation (0-100, decimal, empty allowed if promos exist)
- [ ] Test verdict sentence rendering (all three verdict paths: good/drifting/bad)
- [ ] Test Penny insight LLM text masking (£XXXX → £•••• when hideNetWorth=true)
- [ ] Test rise-in stagger animation (sequential fade-in top→bottom)
- [ ] Test dark mode (all tiles, text, chips, buttons)
- [ ] Test landscape orientation (if supported; may need side-by-side layout)
- [ ] Integrate with existing bottom nav + navigation stack
- [ ] Accessibility audit: screen readers, contrast, touch targets (min 44×44)

---

## Fidelity Reference: Exact Hex Codes & Tokens

### Colours (all tokens already in mobile/lib/tw.ts)
| Token | Light | Dark |
|-------|-------|------|
| Canvas | #f0f2f7 | #0f172a |
| Card | #ffffff | #1e293b |
| Card border | #f1f5f9 | #334155 |
| Ink (primary text) | #0f172a | #f1f5f9 |
| Muted (secondary text) | #94a3b8 | — |
| Muted deep (labels) | #64748b | — |
| Indigo (brand) | #4f46e5 | — |
| Indigo (hover) | #4338ca | — |
| Indigo light bg | #eef2ff | #312e81/30 |
| Amber (warning) | #f59e0b | — |
| Amber light | #fffbeb | #78350f/20 |
| Emerald (positive) | #10b981 | — |
| Emerald (lighter) | #34d399 | — |
| Rose (error) | #ef4444 | — |

### Spacing (Tailwind 4px unit)
| Scale | px |
|-------|-----|
| xs (0.5) | 2 |
| sm (1) | 4 |
| md (2) | 8 |
| lg (3) | 12 |
| xl (4) | 16 |
| 2xl (5) | 20 |
| 3xl (6) | 24 |

### Radii
| Class | px |
|-------|-----|
| rounded-xl | 12 |
| rounded-2xl | 16 |
| rounded-3xl | 24 |
| rounded-full | 9999 |

### Typography (all via tw.text + tw.weight)
| Size | fs | lh | Weight |
|------|----|----|--------|
| Display | 30 | 36 | 700 |
| Headline | 20 | 28 | 700 |
| Title | 14 | — | 600 |
| Body | 14 | 20 | 400 |
| Label | 11 | 16 | 600 (+0.05em tracking) |
| Tiny | 10 | 14 | 600 (+0.05em tracking) |

### Shadows (web only, skip on RN)
- Card: `shadow-sm` (0 1px 2px rgba(0,0,0,0.05))
- Float: `shadow-xl`

---

