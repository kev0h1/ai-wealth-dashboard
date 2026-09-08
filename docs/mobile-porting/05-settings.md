# Screen: Settings

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 9034187 2026-08-03 08:19:31 +0200 (`frontend/app/settings/SettingsPage.tsx`)
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/settings/SettingsPage.tsx`

---

## Purpose

The Settings screen is the user's control centre for app personalization, security, notification preferences, bank account management, financial profile data (income, pension, child benefit), profile identity (name, postcode), and destructive account operations (sync history, account deletion). It spans eight logical sections, each collapsible or conditional based on user data, and delegates sensitive operations (biometric lock) to the native shell via message bridge while handling everything else client-side.

---

## Source Files

**Web (Next.js):**
- `/root/ai-wealth-dashboard/frontend/app/settings/SettingsPage.tsx` (main page, 670 lines)
- `/root/ai-wealth-dashboard/frontend/components/Toggle.tsx` (switch control)
- `/root/ai-wealth-dashboard/frontend/components/AccountMiniCard.tsx` (bank badge + brand resolution)
- `/root/ai-wealth-dashboard/frontend/components/ConfirmDialog.tsx` (destructive action confirmation)
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` (NotificationPrefs type + API endpoints)

**Mobile (React Native — to build):**
- `mobile/app/(tabs)/settings.tsx` (main screen)
- `mobile/components/ui/` (reusable components: ToggleSwitch, Card, Button, MoneyFigure, etc.)
- `mobile/lib/AuthContext.tsx` (logout, token management)
- `mobile/lib/api.ts` (API client, matching web NotificationPrefs)

---

## Layout Anatomy

Settings is a vertical stack of collapsible **glass-card** sections separated by 12px (gap: p-3 equivalent, or `gap-3` in Tailwind). The page has a 16px horizontal gutter on all sides and respects `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` (mobile: SafeAreaView edges).

### Page Header Hero
- **Container:** rounded-3xl (24px), glass-hero (liquid glass background), px-4 pt-5 pb-6 (16/20/24px padding)
- **Layout:** Flex row, space-between items-center justify-between
- **Left side:**
  - Title: "Settings" — 20px/700 weight (headline), slate-900 / slate-100 (dark)
  - Subtitle: "Customise your dashboard" — 14px/400, slate-500 / slate-400 (dark)
  - Margin-top: 4px (mt-1)
- **Right side:** TutorialTrigger (? icon, help button; see foundation 00-foundation.md for icon details)
- **Background:** Indigo-to-violet gradient? NO — glass-hero is neutral, white/slate-800 with soft blur
- **Gap:** 12px (gap-3) between left and right content

### Section 1: Display
**Card:** glass-card, rounded-2xl, overflow hidden
**Header:** px-4 py-3, border-b border-slate-100/slate-700
- Label: "DISPLAY" — 12px/600, tracking-wide, slate-500/slate-400, uppercase
**Body:** px-4 py-3.5 (flex row, justify-between, items-center)
- **Left:** 
  - Title: "Dark Mode" — 14px/500, slate-800/slate-100
  - Description: "Easier on the eyes at night" — 12px/400, slate-500/slate-400, mt-0.5
- **Right:** Toggle (state: checked=darkMode, onChange=setDarkMode)

**Toggle Component Details:**
- Dimensions: 48px (w-12) wide × 24px (h-6) tall
- Track: rounded-full (100px radius, pill shape), bg-indigo-500 (ON) / bg-slate-200 (OFF); dark: bg-slate-600 (OFF)
- Knob: 20px (w-5 h-5) white circle, absolute positioned, top-0.5 left-0.5 when OFF
- Animation: translate-x-6 (24px right) when ON, transition-transform 200ms
- Focus: ring-2 ring-indigo-500, ring-offset-2 (light) / ring-offset-slate-800 (dark)
- Hit target: min-h-44px (inline-flex wrapper)
- Disabled: opacity-50
- Accessibility: role="switch", aria-checked, aria-label

---

### Section 2: Notifications
**Card:** glass-card, rounded-2xl, overflow hidden
**Header:** px-4 py-3, border-b border-slate-100/slate-700
- Label: "NOTIFICATIONS" — 12px/600, tracking-wide, slate-500/slate-400

**Body:** px-4 py-3.5

**State Branch 1 — NATIVE (mobile app inside WebView):**
- Icon: Bell (16px, indigo-500, flex-shrink-0)
- Text: "Notifications are delivered by the app — manage them in your phone's notification settings."
  - 12px/400, slate-500/slate-400, flex items-center gap-3

**State Branch 2 — UNSUPPORTED (browser without push API):**
- Icon: BellOff (16px, slate-400, flex-shrink-0)
- Text: "Push notifications aren't supported in this browser."
  - 12px/400, slate-500/slate-400

**State Branch 3 — DENIED (user blocked permission):**
- Icon: BellOff (16px, amber-500, flex-shrink-0, mt-0.5)
- Layout: flex items-start gap-3
- Left: Icon
- Right:
  - Title: "Notifications blocked" — 14px/500, slate-800/slate-100
  - Text: "To receive transaction alerts, allow notifications for this site in your browser settings." — 12px/400, slate-500/slate-400, mt-0.5

**State Branch 4 — GRANTED (web push enabled):**
- Layout: flex row, items-center, justify-between, gap-3
- **Left (flex 1):**
  - Icon: Bell (16px), color: indigo-500 if enabled, slate-400 if disabled
  - Layout: flex items-center gap-3
  - Text:
    - Title: "Push notifications" — 14px/500, slate-800/slate-100
    - Desc: "Allow alerts on this device" — 12px/400, slate-500/slate-400, mt-0.5
- **Right:** Toggle (checked=notifEnabled, onChange=handleToggleNotifications, disabled=notifLoading)
  - If loading: Loader2 (12px, spin animation, slate-400) in 48px × 24px flex container

**Error message (if notifError):**
- mt-2, flex items-center gap-1.5
- Icon: AlertCircle (13px, red-500, flex-shrink-0)
- Text: red-500, 12px/400, notifError message

**Notification Preference Rows (when notifPrefs is loaded):**
- **Divider:** border-t border-slate-100/slate-700/50
- **Header:** px-4 pt-3 pb-1
  - Label: "NOTIFY ME ABOUT" — 11px/600, tracking-wide, slate-500/slate-400
- **Rows (6 total):**
  1. insights → "Tips & insights" + "Ways to save money we spot for you"
  2. budget_alerts → "Budget alerts" + "When you go over a budget category"
  3. bill_alerts → "Bill alerts" + "When an upcoming bill may not clear"
  4. goal_milestones → "Goal milestones" + "When you reach a savings goal"
  5. period_digest → "Pay-period digest" + "A fresh-start goals summary each new pay period"
  6. transactions → "New transactions" + "Each time new transactions arrive"

**Each row:**
- Layout: flex row, items-center, justify-between, px-4 py-3
- Min-height: 44px (hit target)
- **Left:** flex 1, pr-3
  - Title: 14px/500, slate-800/slate-100
  - Description: 12px/400, slate-500/slate-400, mt-0.5
- **Right:** Toggle (checked=notifPrefs[key], onChange=toggleNotifPref(key))
- Border: border-t border-slate-50/slate-700/50

---

### Section 3: Where Money Can Come From (Conditional)
Only renders if `coverAccounts.length > 0`

**Card:** glass-card, rounded-2xl, overflow hidden

**Header (Collapsible Button):**
- role="button", aria-expanded=coverOpen, aria-controls="cover-accounts-body"
- onClick: toggle coverOpen
- className: w-full text-left, flex items-center gap-3, px-4 py-3, active:opacity-70
- When open: border-b border-slate-100/slate-700
- **Left content:** flex-1
  - Label: "WHERE MONEY CAN COME FROM" — 12px/600, tracking-wide, slate-500/slate-400, block
  - Summary: `${allowedCount} of ${total} account(s)` or `Any of your ${total} account(s)` — 14px/500, slate-800/slate-100, block, mt-0.5
- **Right icon:** ChevronDown (16px, slate-400/slate-500, transition-transform, rotate-180 when open)

**Body (id="cover-accounts-body", conditional render if coverOpen):**

**Info text:**
- px-4 pt-3, 13px/400, slate-500/slate-400, leading-snug
- "By default Penny can move from any of your accounts. Turn one off and it will never be suggested."

**Account rows:**
- Container: mt-2, divide-y divide-slate-100/slate-700/60
- **Each row:** flex items-center gap-3, px-4 py-3, min-h-44px
  - **Left:** BankBadge (36px × 36px)
    - Props: logoSrc (from brand), initials (from brand), altText (brand.label), brandBg (brand.background)
    - Style: rounded-xl, contain object-cover, bg-white, ring-1 ring-black/0.06 (light) / ring-white/0.12 (dark)
    - On error: Show initials badge with background
  - **Middle:** flex-1
    - Account name: 14px/500, slate-900/slate-100, truncate, block
    - Provider: `acc.provider || "Offline account"` — 12px/400, slate-400/slate-500, truncate, block
  - **Right:** Toggle (checked=allowed, onChange=toggleCoverAccount(acc.id))

---

### Section 4: Financial Profile
**Always rendered**; only pension + child-benefit rows and tax-breakdown link are gated on incomeBracket

**Card:** glass-card, rounded-2xl, overflow hidden

**Header:** px-4 py-3, border-b border-slate-100/slate-700
- Label: "FINANCIAL PROFILE" — 12px/600, tracking-wide, slate-500/slate-400
- Subtext: "Self-declared — unlocks personalised tax insights" — 11px/400, slate-500/slate-400, mt-0.5

**Income Input Row:** px-4 py-3.5
- **Label:** "Approximate income (£/yr)" — 14px/500, slate-800/slate-100, block, mb-1
- **Hint:** "Used to personalise your tax calculations — over £100k unlocks the Tax tab" — 12px/400, slate-500/slate-400, mb-2
- **Input container:** position relative, w-40 (fit-content, or 40 in RN)
  - **Prefix:** "£" — position absolute, left-3, top-1/2, -translate-y-1/2, 14px/400, slate-400
  - **Input:** 
    - type="text" (web), inputMode="numeric" (web), keyboardType="number-pad" (mobile)
    - placeholder: "e.g. 110000"
    - value: fmtDigits(incomeInput) — formatted with commas (e.g. "110,000")
    - onChange: strip non-digits
    - onBlur: parse, save, update bracket locally
    - Style: full width, pl-7 (left padding for £ sign), pr-3, py-2, rounded-xl, border-slate-200/slate-600, bg-slate-50/slate-700, 14px/400, text-slate-800/slate-100
    - Focus: ring-2 ring-indigo-500, outline none

**Finance message (conditional):**
- mt-2, 12px/500
- Color: emerald-500 (success) or red-500 (error)
- Note: Income blur message auto-hides after 2000ms. Profile save message (profileMsg) does NOT auto-hide — stays until next save.

**Conditional section: Income bracket ≥ 100k**

**Pension Input Row:** px-4 pb-3.5, border-t border-slate-50/slate-700/50, pt-3.5
- **Label:** "Pension contributions this year (£/yr)" — 14px/500, slate-800/slate-100, block, mb-1
- **Hint:** "Used to calculate your adjusted net income" — 12px/400, slate-500/slate-400, mb-2
- **Input:** Same as income (£ prefix, numeric keyboardType, rounded-xl, etc.)
  - placeholder: "0" (not "e.g. 110000")

**Child Benefit Toggle Row:** flex items-center justify-between, px-4 pb-3.5, border-t border-slate-50/slate-700/50, pt-3.5
- **Left:**
  - Title: "Receiving Child Benefit" — 14px/500, slate-800/slate-100
  - Description: "High income charge applies over £60k" — 12px/400, slate-500/slate-400, mt-0.5
- **Right:** Toggle (checked=hasChildBenefit, onChange=handleChildBenefitToggle, onColor="bg-indigo-500")

**Tax Breakdown Link Button:** w-full, flex items-center justify-between, px-4 py-3.5, border-t border-slate-100/slate-700, text-indigo-600/indigo-400
- Text: "View tax breakdown" — 14px/600
- Icon: ChevronRight (16px)
- Background: transparent, active:bg-indigo-50/indigo-900/10, transition-colors
- On press: router.push("/insights?tab=tax")

---

### Section 5: Security (Conditional)
Only renders if `bioState?.supported === true` (biometric hardware available)

**Card:** glass-card, rounded-2xl, overflow hidden

**Header:** px-4 py-3, border-b border-slate-100/slate-700
- Label: "SECURITY" — 12px/600, tracking-wide, slate-500/slate-400

**Body:** flex items-center justify-between, px-4 py-3.5
- **Left:**
  - Title: "Biometric unlock" — 14px/500, slate-800/slate-100
  - Description: "Require fingerprint or face to open the app" — 12px/400, slate-500/slate-400, mt-0.5
- **Right:** Toggle (checked=bioState.enabled, onChange=toggleBiometrics, label="Biometric login")

**Note:** On mobile, biometric state is stored in SecureStore ("biometric_lock" key) and read on app launch via expo-local-authentication. This toggle updates both local state and SecureStore. The native shell (Expo app) enforces the lock gate at (tabs)/_layout.tsx.

---

### Section 6: Data
**Card:** glass-card, rounded-2xl, overflow hidden

**Header:** px-4 py-3, border-b border-slate-100/slate-700
- Label: "DATA" — 12px/600, tracking-wide, slate-500/slate-400

**Body:** px-4 py-3.5
- **Title:** "Sync all history" — 14px/500, slate-800/slate-100
- **Description:** "Re-fetch the last 90 days from all connected banks." — 12px/400, slate-500/slate-400, mt-0.5, mb-3
- **Button:** flex items-center gap-2, px-4 py-2, rounded-xl, bg-indigo-500, text-white, 14px/500, disabled:opacity-50, active:scale-95
  - Icon: RotateCcw (14px, animate-spin if syncing)
  - Label: "Syncing…" (if syncingHistory) or "Sync history (90 days)"

**Sync message (conditional):**
- mt-2, 12px/500
- Color: emerald-500 (success) or red-500 (error)
- Note: syncHistoryMsg auto-hides after 4000ms (different from finance messages)

---

### Section 7: Account
**Card:** glass-card, rounded-2xl, overflow hidden

**Header:** px-4 py-3, border-b border-slate-50/slate-700
- Label: "ACCOUNT" — 12px/600, tracking-wide, slate-500/slate-400, mb-0.5
- If user.email: px-4 py-3, 12px/400, slate-500/slate-400, email address

**Profile Edit Block:** px-4 py-3, border-b border-slate-50/slate-700, space-y-3

**Full Name Input:**
- Label: "Full name" + span "— used to recognise transfers between your own accounts" — 12px/400, slate-500/slate-400, block, mb-1
  - Note: This label text is part of the input label, not a separate description
- Input: w-full, 14px/400, bg-slate-50/slate-700, rounded-xl, px-3 py-2, border-slate-200/slate-600, slate-900 text (dark: slate-100)
  - Focus: ring-2 ring-indigo-500
  - placeholder: "First Last"

**Home Postcode Input:**
- Label: "Home postcode" + span "— used for local fuel prices" — 12px/400, slate-500/slate-400, block, mb-1
- Input: same styling as Full Name
  - placeholder: "e.g. B91 2AB"

**Save Button (conditional, only if profileDirty):**
- w-full, py-2, rounded-xl, 14px/600, text-white, bg-indigo-600, active:scale-98, transition-transform, disabled:opacity-50
- Label: "Saving…" (if profileSaving) or "Save profile"

**Profile Message (conditional):**
- 12px/500, emerald-500 (success) or red-500 (error)

**Sign Out Button:**
- w-full, flex items-center gap-3, px-4 py-3.5, text-left, text-slate-600/slate-300
- hover:bg-slate-50 (light) / dark:hover:bg-slate-700
- active:bg-slate-100, transition-colors
- Icon: LogOut (16px)
- Text: "Sign out" — 14px/500

---

### Section 8: Danger Zone
**Card:** glass-card, rounded-2xl, overflow hidden, border border-red-100/red-900/40

**Header:** px-4 py-3
- Label: "DANGER ZONE" — 12px/600, tracking-wide, red-500/red-400, mb-1

**Body:** px-4 py-2.5
- **Button:** px-4 py-2.5, 14px/500, text-red-500, rounded-xl, hover:bg-red-50/red-900/10, active:bg-red-100, transition-colors
  - Label: "Delete account & all data…"

**Delete Confirmation Dialog (when deleteOpen = true):**
- Title: "Delete everything?"
- Message (custom JSX):
  - Paragraph 1: "This permanently erases everything — bank connections, transactions, budgets, plans, insights and chat history. It cannot be undone. Type DELETE to confirm."
    - Styling: 14px/400, slate-500/slate-400, leading-relaxed, space-y-3
    - Bold phrase: "DELETE" — font-bold, slate-700/slate-200
  - Input: w-full, 14px/400, bg-slate-50/slate-700, rounded-xl, px-3 py-2, border-red-200/red-800, slate-900 text (dark: slate-100)
    - Focus: ring-2 ring-red-500
    - placeholder: "DELETE"
    - autoCapitalize: "characters"
    - onChange: update deleteConfirm state
- Confirm button: "Delete my account" (destructive variant, red-500, disabled if deleteConfirm !== "DELETE")
- Cancel button: "Cancel" (secondary)

---

## States

### Loading & Async States

1. **Initial Load:**
   - Profile (name, postcode) fetches on mount via `api.getProfile()`
   - Cover accounts fetches on mount via `api.accounts()` filtered to exclude credit
   - Notification prefs load from `rawPrefs.notification_prefs` when preferences context is ready
   - Biometric state queries native shell via postMessage ("biometrics:get")

2. **Profile Saving:** `profileSaving = true`
   - Save button disabled, "Saving…" label
   - After API response, show success/error message — profileMsg does NOT auto-hide (stays until next save)

3. **Finance Input Save (income/pension):** On blur
   - Parse digits, update bracket locally
   - Call `api.updatePreferences({ income_value })` or `api.updatePreferences({ pension_annual })`
   - Show "Saved" message with 2000ms auto-hide (financeMsg DOES auto-hide, unlike profileMsg)

4. **Sync History:** `syncingHistory = true`
   - Button disabled, RotateCcw icon spins
   - Message shows after completion (4000ms auto-hide) — different auto-hide duration from finance messages
   - Response includes total_accounts + message; page displays message

5. **Notification Toggle:**
   - `notifLoading = true` while subscribing/unsubscribing
   - Shows Loader2 spinner in toggle area
   - On web: call `Notification.requestPermission()` if not already granted
   - On mobile (native mode): only preference toggles work (biometric-like gate)

6. **Biometric Toggle:**
   - `setBioState({ ...bioState, enabled: next })`
   - postMessage to native shell: `{ type: "biometrics:set", enabled: next }`
   - Native shell updates SecureStore and confirms via "native-biometrics" event

7. **Account Deletion:**
   - `deleting = true` while `api.deleteUserAccount()` runs
   - Then `logout()` and redirect to login
   - Button disabled during operation

### Error & Empty States

- **No cover accounts:** Entire section doesn't render (conditional)
- **Biometric not supported:** Entire Security section doesn't render (conditional)
- **Notification error:** AlertCircle icon + red text message in Notifications section
- **Profile/finance error:** Red text message below the field
- **Sync error:** Red text message below the Sync button

---

## Interactions

### Navigation & Routing
- "View tax breakdown" → `router.push("/insights?tab=tax")`
- Sign out → `logout()` then redirected by AuthProvider
- Delete account → `logout()` and auth gate redirects to login

### Bank Account Management (Cover-Plan Accounts)
- Section expands/collapses with ChevronDown icon rotation
- Toggle per account: `toggleCoverAccount(id)` → add/remove from `excludedIds` set, call `api.updatePreferences({ cover_plan_excluded_accounts: [...ids] })`
- Each row displays:
  - BankBadge (36×36px, logo or initials)
  - Account name (truncated)
  - Provider/subtext renders only when `(acc.manual || acc.provider)` is true
    - If manual: "Offline account"
    - If provider present: provider name
    - Otherwise: no subtext
  - Toggle switch (allowed/excluded)

### Notification Preferences
- Master toggle: "Push notifications" (only on web/granted state; native always-on)
  - If disabled, unsubscribe from push manager and call `api.unsubscribePush(endpoint)`
  - If enabled, request permission → subscribe → call `api.subscribePush(sub.toJSON())`
- 6 preference toggles (insights, budget_alerts, bill_alerts, goal_milestones, period_digest, transactions)
  - Each toggle: `toggleNotifPref(key)` → update local state + `api.updatePreferences({ notification_prefs: {...} })`
  - No debounce; fires immediately

### Financial Profile Inputs
- Income & Pension: on blur, parse digits (strip non-numeric), update state, derive bracket locally, save via `api.updatePreferences()`
- Bracket is server-derived but computed locally after income input for instant UI visibility of pension/child-benefit sections
- Income formatting: `toLocaleString("en-GB")` → "110,000"
- Child benefit: toggle → save immediately

### Profile Editing
- Full name & postcode fields: changes dirty the "Save profile" button
- Save button only appears if dirty
- On save, disable button, show "Saving…", then show success/error message (2000ms auto-hide)

### Biometric Lock (Mobile Only)
- Toggle updates local state + sends postMessage to native shell
- Native shell persists to SecureStore and updates its auth gate logic
- Web: section does not render (not supported)

### Sync History
- Button press triggers `api.syncHistory()`
- Shows spinner while loading
- Message appears on completion (success or error), auto-hides after 4 seconds

### Dark Mode
- Toggle updates `darkMode` state via `setDarkMode()` (PreferencesContext)
- Persisted via the context provider (localStorage on web; SecureStore or AsyncStorage on mobile)
- Instant visual update across the entire app

### Delete Account
- Opens ConfirmDialog with scary message + "DELETE" confirmation input
- Button disabled until user types "DELETE"
- On confirm, runs `api.deleteUserAccount()` → logs out → redirects

---

## Data & API

### API Endpoints

| Action | Method | Path | Payload | Response |
|--------|--------|------|---------|----------|
| Get profile | GET | `/profile` | — | `{ full_name, postcode, ... }` |
| Update profile | PUT | `/profile` | `{ full_name, postcode }` | Updated profile object |
| Get preferences | (via PreferencesContext) | — | — | `UserPreferences` with notification_prefs, income_*, pension_*, etc. |
| Update preferences | PATCH | `/preferences` | `{ income_value, pension_annual, has_child_benefit, notification_prefs, cover_plan_excluded_accounts, ... }` | Updated preferences |
| Get accounts | GET | `/accounts` | — | `Account[]` |
| Sync history | POST | `/accounts/sync-history` | — | `{ message: string; total_accounts: number }` |
| Delete account | DELETE | `/account` | — | `{ deleted: boolean }` |
| Get VAPID public key (web push) | GET | `/push/vapid-public-key` | — | `{ public_key: string }` |
| Subscribe to push | POST | `/push/subscribe` | `{ subscription: PushSubscriptionJSON }` | `{ ok: boolean }` |
| Unsubscribe from push | DELETE | `/push/subscribe` | `{ endpoint }` | `{ ok: boolean }` |

### NotificationPrefs Type

```typescript
export type NotificationPrefs = {
  transactions: boolean;        // Each time new transactions arrive
  budget_alerts: boolean;       // When you go over a budget category
  goal_milestones: boolean;     // When you reach a savings goal
  insights: boolean;            // Tips & insights
  period_digest: boolean;       // Pay-period digest
  bill_alerts: boolean;         // When an upcoming bill may not clear
};
```

### Account Type (for cover-plan display)

```typescript
export interface Account {
  id: string;
  name: string;
  type: string;                 // "Current", "Savings", "Credit Card"
  subtype?: string;
  provider?: string;            // "Barclays", "HSBC", etc. (from Finexer provider_id or TrueLayer display)
  provider_id?: string;         // Finexer stable code (e.g. "natwest", "amex")
  balance: number;
  currency: string;             // "GBP" or "KES"
  status: "active" | "expired";
  account_number?: string;
  sort_code?: string;
  manual?: boolean;             // true if offline account (not bank-connected)
  logo_url?: string;            // Finexer optional logo URL
  bg_colors?: string[];         // Finexer gradient colours
  apr?: number;                 // Credit cards only
}
```

### UserPreferences Structure (subset)

```typescript
export interface UserPreferences {
  notification_prefs?: NotificationPrefs;
  income_bracket?: string;       // "under_100k", "100k_125k", "125k_plus"
  income_value?: number;         // Raw annual income in £
  pension_annual?: number;       // Annual pension contribution in £
  has_child_benefit?: boolean;
  cover_plan_excluded_accounts?: string[];  // Account IDs to exclude from cover plan
  // ... other fields
}
```

### Client-side Storage (Mobile)

- **Biometric lock state:** SecureStore `"biometric_lock"` key (boolean), read on app launch
- **Dark mode:** Persisted via ThemeContext (mobile: SecureStore or AsyncStorage-backed)
- **Income bracket:** Derived locally from income_value; not persisted (recalculated per input)
- **Form state (profile, income, etc.):** Component local state; saved to backend on blur/submit

---

## Current Mobile State

**Status: WebView stub** — The mobile app currently renders the web SettingsPage inside a WebView at `mobile/app/(tabs)/settings.tsx`.

### To Build Natively (1:1 Parity)

Replace the WebView stub with a native React Native screen that implements:

1. **Layout:** VerticalScroll stack with 8 glass-card sections (Display, Notifications, Where Money Can Come From, Financial Profile, Security, Data, Account, Danger Zone)

2. **Components to build or reuse:**
   - **ToggleSwitch** (custom or mobile/components/ui/Toggle equivalent)
   - **Input** (TextInput with £/symbol prefix for financial fields)
   - **Button** (primary: indigo-600; secondary: hairline; destructive: red-500)
   - **BankBadge** (36×36 logo or initials, rounded-xl, ring)
   - **ConfirmDialog** (Modal with black/50 backdrop, panel, Cancel + Confirm buttons)
   - **Card** (glass-card equivalent: rounded-2xl, shadow-sm, borders)
   - **MoneyFigure** / **WhisperLabel** (if used for display values)
   - **NO bank-connect buttons, uploads, SegmentedControl, CustomSelect, CategoryManagerSheet, BankPickerSheet, PayPeriodSettingsSheet, or AdviceDisclaimer** on this screen

3. **API integration:**
   - Use mobile/lib/api.ts (matches web, shares NotificationPrefs, Account types)
   - Auth via AuthContext (token in SecureStore, logout clears it)
   - Preferences: fetch once, update via `api.updatePreferences()` with partial objects

4. **Mobile-specific concerns:**
   - **Biometric lock:** Already implemented in (tabs)/_layout.tsx via expo-local-authentication
     - This screen's biometric toggle reads/writes SecureStore "biometric_lock" key
     - Native shell enforces the gate; this screen only controls the setting
   - **Push notifications:** expo-notifications handles the native delivery
     - This screen's notification prefs toggle is for granular permission preferences, not the platform permission
     - Request platform permission via `Notifications.requestPermissionsAsync()` (Expo), not browser Notification API
   - **Safe area:** Wrap in SafeAreaView with edges=["bottom", "top"] to respect notches + home indicator
   - **Keyboard:** TextInput dismissal on blur or scroll; no fixed keyboard covers

5. **Dark mode:** Built-in via NativeWind; use `dark:` variants on all surfaces
   - Theme context already initialized in root layout
   - This screen reads `theme` from ThemeContext and applies dark variant classes

---

## RN Port Notes

### Component Mapping

| Web Element | React Native Equivalent | Notes |
|---|---|---|
| `<div className="rounded-2xl glass-card">` | `<View className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60">` | Use NativeWind for rounded/border/bg; glass-card is frosted background + border (no backdrop-filter in RN) |
| `<input type="text">` | `<TextInput>` | keyboardType="numeric" for financial fields; onBlur for save |
| `<button>` | `<Pressable>` | onPress handler; active:scale-95 via Pressable state |
| `<Toggle>` | Custom RN component or mobile/components/ui/Toggle | Animated.Value for knob translate; Pressable for tap |
| Toggle.checked | useState boolean | Same semantics; mobile Toggle accepts same props (checked, onChange, label, disabled) |
| `<svg>` (Lucide icon) | lucide-react-native icon | Same import name; RN version requires explicit color prop |
| `aria-*` attributes | accessibilityRole / accessibilityLabel | RN accessibility props |
| Dark mode (CSS) | NativeWind dark: | Context-aware; applies dark: classes based on theme state |
| `localStorage` | SecureStore (expo-secure-store) or AsyncStorage | For biometric_lock, dark_mode, other local prefs |

### Focus & Interaction

- **No hover states:** RN Pressable manages pressed state instead
  - `active:opacity-70` → Pressable opacity state
  - `active:scale-95` → Pressable transform state
- **No focus ring:** iOS/Android show platform-standard focus indicators
  - Add `accessible={true}` + `accessibilityLabel` for screen reader compatibility
- **No CSS transitions:** Use Animated API or React Native's built-in LayoutAnimation for state changes
  - Toggle knob slide: Animated.timing({ toValue: 1, duration: 200 })
  - Or use Reanimated for advanced easing (cubic-bezier-like)

### Safe Area & Layout

- Wrap settings screen in SafeAreaView: `<SafeAreaView edges={["top", "bottom"]} className="flex-1">`
- Page container: `<ScrollView className="flex-1 bg-slate-50 dark:bg-slate-900">`
- Section gap: 12px between cards (use `mb-3` on each Card or in a gap-aware FlatList)
- Horizontal padding: 16px (px-4 equivalent) on left/right of ScrollView content

### Keyboard Handling

- TextInput `onBlur` → trigger save (matching web onBlur handler)
- Dismiss keyboard on submit: `Keyboard.dismiss()` or set `blurOnSubmit={true}`
- Don't use fixed positioning for keyboard; let ScrollView reflow

### Accessible Color Contrast

- All text must be ≥4.5:1 contrast ratio (WCAG AA)
  - Light: slate-900 (#0f172a) on white or slate-50 ✓
  - Dark: slate-100 (#f1f5f9) on slate-800/900 ✓
  - Muted secondary: slate-400 (#94a3b8) on white/slate-50 — borderline, OK for tertiary text
- Test in both light and dark modes

---

## Open Questions & Risks

1. **Biometric toggle UX:** Should toggling require re-authentication (i.e., fingerprint before enabling)? Current web design just toggles; mobile should probably ask for confirmation. Clarify with Kevin.

2. **Financial profile visibility:** Should the pension/child-benefit sections expand conditionally (as they do now based on income_bracket), or always show on mobile (smaller screen, less space)? Test layout.

3. **Push notification testing:** Expo push notifications require a server to send tokens. Confirm that the backend's `/notifications/subscribe` endpoint correctly stores and routes to the Expo push service. Test on physical devices (simulator may not receive notifications).

4. **Dark mode persistence:** Confirm that mobile ThemeContext (SecureStore-backed) survives app restart. If not, re-test theme toggle.

5. **Large account lists:** If a user has >50 cover-plan accounts, the expanded section becomes a long scroll. Consider pagination or a dedicated modal picker.

6. **Android keyboard:** Numeric keyboardType may vary by device. Test with Samsung, Google Pixel to ensure £-prefix layout doesn't shift.

7. **Profile image / avatar:** Web doesn't show user avatar on Settings; mobile screen shouldn't either (1:1 parity). If future design adds avatar, it goes on a different screen.

8. **Notification permissions prompt:** On first Settings load, should the app proactively request notification permission? Or wait for user to toggle? Current design requires toggle. Confirm desired flow.

9. **Account deletion confirmation:** Web uses an input field to type "DELETE". Mobile might benefit from a more intuitive gesture (e.g., slide-to-delete). Proposed: keep the text input for 1:1 parity, but consider a visual hint ("slide to confirm") in v2.

10. **Scroll-to-section:** If user lands on Settings with an anchor (e.g. to the Notifications section), mobile ScrollView should auto-scroll there. Implement via useEffect + ref.

---

## Cross-Reference

- **Companion API docs:** frontend/lib/api.ts (NotificationPrefs, Account, UserPreferences types; endpoint signatures)
- **Design tokens:** mobile/lib/tw.ts (colour, spacing, radius definitions)
- **Theme context:** mobile/lib/ThemeContext.tsx (dark mode state, SecureStore persistence)
- **Auth context:** mobile/lib/AuthContext.tsx (logout, token management)
- **Biometric lock gate:** mobile/app/(tabs)/_layout.tsx (expo-local-authentication, SecureStore integration)
- **Foundation:** mobile/docs/porting/00-foundation.md (design tokens, RN mapping rules, component inventory)
- **Web source:** frontend/app/settings/SettingsPage.tsx (source of truth for logic, layout, state machine)
- **Web design:** frontend/DESIGN.md (Calm Cockpit principles, The Red Is Risk rule, glass surfaces, typography hierarchy)
