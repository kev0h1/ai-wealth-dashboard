# Auth & Login: PIN Unlock + Onboarding

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to auth source files:** 9f948fc 2026-08-01 15:21:28 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/login/page.tsx frontend/components/LoginScreen.tsx frontend/components/Onboarding.tsx frontend/components/AuthProvider.tsx`
- **Apply diffs:** `git diff 5ad21c0..HEAD -- <paths>`

**ERRATA: Previous references to LoginOverlay.tsx are INVALID — this file does not exist. Ignore any mention of "LoginOverlay" in earlier versions of this doc. The auth model consists of: (1) AuthProvider (renders LoginScreen, then Onboarding), (2) LoginScreen (Google OAuth), (3) Onboarding (multi-step flow), and (4) a separate unused /login route (PIN stub, not integrated into auth flow).**

---

## Purpose

Document the web app's login gate (4-digit PIN unlock) and post-login onboarding flow (profile name, pay date, bank connect, biometric opt-in). Mobile adds native Google sign-in and biometric unlock in native APIs; this doc reconciles both auth models and identifies design/UX gaps.

---

## Source Files

### Web (Frontend)
- **PIN login gate (MVP):** `/root/ai-wealth-dashboard/frontend/app/login/page.tsx` — PIN input (hardcoded "8048") + unlock logic; separate standalone route
- **Auth provider & session:** `/root/ai-wealth-dashboard/frontend/components/AuthProvider.tsx` — Token persistence, user validation via /api/auth/session/validate; renders `<LoginScreen>` (Google OAuth) when !user, then `<Onboarding>` if onboarding incomplete
- **Google OAuth screen:** `/root/ai-wealth-dashboard/frontend/components/LoginScreen.tsx` — Google sign-in button + branding; rendered by AuthProvider when no user token
- **Onboarding flow:** `/root/ai-wealth-dashboard/frontend/components/Onboarding.tsx` — Welcome → profile name → payday → bank connect → biometric opt-in (step 5 only shown if bioSupported in WebView)

### Mobile (React Native)
- **Auth context:** `/root/ai-wealth-dashboard/mobile/lib/AuthContext.tsx` — Token storage via expo-secure-store
- **Auth complete handler:** `/root/ai-wealth-dashboard/mobile/app/auth-complete.tsx` — Deep link handler for OAuth redirect
- **Biometric gate:** `/root/ai-wealth-dashboard/mobile/app/(tabs)/_layout.tsx` — Native fingerprint/face unlock (gates all tabs)
- **Tokens:** `/root/ai-wealth-dashboard/mobile/lib/tw.ts` — Tailwind/design token mapping (use for spacing, colors, text sizes)

### Design References
- `/root/ai-wealth-dashboard/DESIGN.md` — Design system (colours, typography, components)
- `/root/ai-wealth-dashboard/PRODUCT.md` — Brand personality, positioning

---

## Layout Anatomy

### Web: Login Page (PIN Unlock)

**Route:** `/login`

**Container & Background:**
- Background: `bg-slate-950` (dark slate, full bleed)
- Centered card: `max-w-xs` (384px), `rounded-2xl`, `bg-slate-900`, `border border-slate-800`, `p-8`, `shadow-2xl`
- All dark theme (no light variant)

**Header (Icon + Title):**
- Icon badge: 56px (14 Tailwind) circle, `rounded-full`, `border` + `bg` conditional
  - **Neutral state:** `bg-indigo-500/20 border-indigo-500/30`, icon `text-indigo-400`
  - **Error state:** `bg-red-900/30 border-red-500/50`, icon `text-red-400`
  - Icon: `ShieldCheck` (lucide-react), 28px (7 Tailwind), color-coded
- Spacing: `mb-5` (20px)
- Title: "Wealth Dashboard", `text-lg` (18px), `font-semibold`, `text-white`, `mb-1`
- Subtitle: "Enter your 4-digit PIN", `text-sm` (14px), `text-slate-400`, `mb-6` (24px)

**PIN Input Field:**
- Type: `password`, `inputMode="numeric"`, `maxLength={4}`
- Placeholder: `••••`
- Sizing: `w-full`, `py-4` (16px vert), text-center
- Typography: `text-2xl` (24px), `tracking-widest` (0.1em letter-spacing)
- Styling:
  - Background: `bg-slate-800`
  - Border: `border-2`
    - **Neutral:** `border-slate-700`
    - **Focus:** `border-indigo-500` (via `:focus:border-indigo-500` — note: border replaces ring)
    - **Error:** `border-red-500`
  - Radius: `rounded-xl` (12px)
  - Text colour: `text-white`
- Placeholder colour: `placeholder:text-slate-600`
- Transitions: `transition-colors`
- Behaviour: 
  - `autoFocus` on mount
  - Error state clears when user types (via `onChange`)
  - `Enter` key triggers unlock

**Unlock Button:**
- `w-full`, `py-3` (12px), `rounded-xl` (12px)
- Background: `bg-indigo-600`, hover `hover:bg-indigo-500`
- Text: `text-white`, `font-medium`, `text-sm` (14px)
- Transitions: `transition-colors`
- Spacing: `mt-4` (16px)

**Error Message (Conditional):**
- Appears below button when `error === true`
- Layout: `flex items-center justify-center gap-1.5`, `mt-4`
- Text: `text-red-400`, `text-sm` (14px)
- Icon: `AlertCircle` (4×4px, 1 Tailwind), `w-4 h-4`
- Message: "Incorrect PIN"
- Accessibility: error feedback is immediate; field clears on new input attempt

**Current PIN Logic (Web):**
```
PIN: "8048"
On unlock: 
  - Correct → localStorage.setItem("wealth_auth", "true"); router.replace("/")
  - Incorrect → setError(true); setPin(""); show error message
```

---

### Web: Onboarding Flow (Post-Login)

**Route:** `/` (after login; redirected if `profile.onboarding_complete === false`)

**Shell (Shared Across All Steps):**
- Background: `bg-white dark:bg-slate-800` (light/dark support)
- Layout: `min-h-dvh flex flex-col items-center justify-center px-6 py-10`
- Content wrapper: `w-full max-w-sm` (448px)

**Progress Indicator (Steps 2–5, not step 1 "welcome"):**
- Four dots (indices 0–3) representing steps: "profile", "payday", "bank", "secure"
- Layout: `flex gap-2 mb-8` (32px)
- Dot styling:
  - Active (current): `w-6 h-6` (24px), `bg-indigo-500`, `rounded-full`
  - Completed (i < dotIndex): `w-4 h-4` (16px), `bg-indigo-300 dark:bg-indigo-700`
  - Future (i > dotIndex): `w-4 h-4`, `bg-slate-200 dark:bg-slate-700`
  - All: `h-1.5` (6px) vertical height, `transition-[width] duration-200`

**Step 1: Welcome**
- Heading: "Welcome to Wealth", `text-3xl` (30px), `font-bold`, `tracking-tight`
- Subheading: "Your money, all in one place. Set up takes 2 minutes.", `text-sm` (14px), `text-slate-500 dark:text-slate-400`, `mt-2`, `leading-relaxed`
- Hero icon: 80px square, `rounded-3xl` (24px), `bg-gradient-to-br from-indigo-500 to-violet-600`, `shadow-xl`
  - Icon: Wallet/chart polyline, 40px (10 Tailwind), `stroke-white`, stroke-width 2

**Feature cards (3×):**
- Card: `bg-white dark:bg-slate-800 rounded-2xl p-3.5 shadow-sm flex items-center gap-4`
- Icon badge: 36px square, `rounded-xl` (12px), category-coloured background (`bg-blue-50 dark:bg-blue-900/30`)
  - Icon (lucide, 18px): `text-blue-600 dark:text-blue-400`
- Text: `text-sm` (14px), `text-slate-700 dark:text-slate-300`, `leading-snug`
- Features:
  1. Building2 icon: "Connect all your banks automatically via open banking" (blue)
  2. Wallet icon: "Track spending and set budgets that actually stick" (emerald)
  3. Sparkles icon: "Get AI-powered insights to save more money" (violet)

**CTA:** `w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md shadow-indigo-200 dark:shadow-none transition`
- Label: "Get started"
- Icon: `<ChevronRight size={16} />` (lucide-react)

---

**Step 2: Profile (Name + Postcode)**

**Heading:** "What's your name?", `text-xl font-bold`, dark/light variant
**Subheading:** "We use your name to recognise transfers between your own accounts.", `text-sm text-slate-500 dark:text-slate-400 mt-1`

**Card Container:** `bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-6 space-y-4`

**Name Fields (2×, grid cols-2 gap-3):**
- Label: `text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5`, text "First name" / "Last name"
- Input:
  - `w-full px-3.5 py-2.5 rounded-xl` (12px)
  - Border: `border border-slate-200 dark:border-slate-600`
  - Background: `bg-white dark:bg-slate-900`
  - Text: `text-sm text-slate-900 dark:text-slate-100`
  - Focus: `focus:outline-none focus:ring-2 focus:ring-indigo-500`
  - Placeholders: "Kevin" / "Maingi"
  - Max length: 40 chars

**Postcode Field:**
- Label: "Postcode (optional)", `text-xs font-semibold`, with "(optional)" in `font-normal text-slate-400`
- Input: same as name, `autoCapitalize="characters"`, `uppercase`
  - Placeholder: "e.g. SW1A 1AA", with `placeholder:normal-case` (placeholder not uppercase)
  - Max length: 10 chars
  - Helper text: "Used to find cheaper fuel near you.", `text-xs text-slate-400 dark:text-slate-500 mt-1.5`

**Error (conditional):** `text-xs text-rose-500`
**CTA:** `w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] font-semibold text-white text-sm disabled:opacity-50 transition-all`
- Label: "Continue" / "Saving…"

---

**Step 3: Payday**

**Heading:** "When do you get paid?", `text-xl font-bold`
**Subheading:** "This powers your spending runway and budget periods.", `text-sm text-slate-500 dark:text-slate-400 mt-1`

**Options Container:** `bg-white dark:bg-slate-800 rounded-3xl shadow-sm overflow-hidden mb-4`

**Option Row (×7):**
- Full-width button, `flex items-center justify-between px-5 py-3.5 text-left`
- Border: `border-b border-slate-50 dark:border-slate-700/50`, no border on last child
- Background:
  - **Selected:** `bg-indigo-50 dark:bg-indigo-900/30`
  - **Unselected:** `hover:bg-slate-50 dark:hover:bg-slate-700/40`
- Transitions: `transition-colors`
- Label text: `text-sm font-medium`
  - **Selected:** `text-indigo-700 dark:text-indigo-300`
  - **Unselected:** `text-slate-800 dark:text-slate-100`
- Sub-text (if present): `text-xs text-slate-400 dark:text-slate-500 mt-0.5`
- Check icon (selected only): 20px circle, `bg-indigo-500`, centred `Check` icon (11px, white, stroke-width 3)

**Options (hardcoded):**
1. "Last Friday of month" / "Typical UK monthly salary"
2. "1st of the month" / "e.g. civil service, some pensions"
3. "15th of the month" / ""
4. "25th of the month" / "Common for many employers"
5. "28th of the month" / ""
6. "End of the month" / "Calendar month view"
7. "I'll set this later" / ""

**CTA:** `w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] font-semibold text-white text-sm transition`
- Label: "Continue"

---

**Step 4: Bank Connect**

**Icon Badge (Conditional):**
- Size: 64px square, `rounded-2xl` (16px), `mb-4`
- **Not connected:** `bg-blue-50 dark:bg-blue-900/30`, icon `Building2` (28px), `text-blue-500`
- **Connected:** `bg-emerald-50 dark:bg-emerald-900/30`, icon `Check` (28px, white stroke-width 2.5), `text-emerald-500`

**Heading (Conditional):**
- Not connected: "Connect your first bank", `text-xl font-bold text-slate-900 dark:text-slate-100`
- Connected: "Bank connected!", `text-xl font-bold text-slate-900 dark:text-slate-100`

**Subheading (Conditional):**
- Not connected: "Link your account in seconds via secure open banking. Wealth can only read data — it can never move your money."
- Connected: "Your transactions are syncing in the background."
- Both: `text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed`

**Trust Badges (shown only if not connected, ×3):**
- Grid: `grid grid-cols-3 gap-2 mb-6`
- Card: `bg-white dark:bg-slate-800 rounded-2xl p-3 text-center shadow-sm`
- Badge (emoji): `text-lg mb-1` — 🔒 / 🏦 / ✕
- Text: `text-xs text-slate-500 dark:text-slate-400 leading-tight`
  - "Read-only access" / "Bank-grade encryption" / "Revoke anytime"

**Main CTA:**
- `w-full py-3.5 rounded-2xl text-white font-semibold text-sm transition-all active:scale-[0.98] mb-3`
- **Not connected:** `bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none`, label "Connect a bank"
- **Connected:** `bg-emerald-500 hover:bg-emerald-600`, label "Let's go ›"

**Secondary CTA (shown if not connected):**
- `w-full py-2.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors`
- Label: "Skip for now — I'll add banks later"

**BankPickerSheet Component (imported):**
- Opens on "Connect a bank" click
- Loads list of TrueLayer providers
- Search + filter
- Triggers OAuth redirect on bank select
- Closes and shows "Bank connected!" on success

---

**Step 5: Secure (Biometric Opt-In) — ONLY shown if bioSupported===true**

**Visibility:** This step is ONLY rendered if `bioSupported === true` (line 63, Onboarding.tsx). The `bioSupported` flag defaults to `false` and is only set to `true` if the component is running inside a React Native WebView and receives a "biometrics:supported" message. Outside a WebView, the secure step is never shown and `finish()` is called after the bank step (line 86).

**Icon Badge:** 64px square, `rounded-2xl` (16px), `bg-indigo-50 dark:bg-indigo-900/30`, `mb-4`
- Icon: `ShieldCheck` (28px), `text-indigo-500`

**Heading:** "Protect your dashboard", `text-xl font-bold text-center`
**Subheading:** "Your finances live here. Require your fingerprint or face every time the app opens — you can change this any time in Settings."
- `text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed text-center`

**Primary CTA:** `w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-[0.98] mb-3`
- Label: "Enable biometric unlock"
- Action: Calls `setBiometrics(true)` then `finish()`

**Secondary CTA:** `w-full py-2.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors`
- Label: "Maybe later"
- Action: Calls `setBiometrics(false)` then `finish()`

---

## States

### Login Gate (PIN Screen)

| State | Visual | Behaviour |
|-------|--------|-----------|
| **Neutral** | Input: `border-slate-700`, Icon: indigo badge `bg-indigo-500/20` | User can type; 4 digits max |
| **Focus** | Input: `border-indigo-500` (focus ring replaced by border) | Cursor active in PIN field |
| **Error** | Input: `border-red-500`, Icon: red badge `bg-red-900/30`, Error message below button | Wrong PIN entered; field clears on next key press |
| **Unlocking** | (No explicit loading state in current code) | `Enter` key or button click submitted |
| **Success** | (Immediate redirect) | localStorage updated; router redirects to `/` |

### Onboarding Flow

| Step | States | Transitions |
|------|--------|-------------|
| **Welcome** | — | Button press → "profile" |
| **Profile** | Input focus, Error (validation), Saving (button disabled) | Continue (if names valid) → "payday" |
| **Payday** | Option selected (radio-like), Idle | Continue → "bank" |
| **Bank** | Loading (BankPickerSheet), Not connected, Connecting (button disabled), Connected | Not connected: "Connect" or "Skip" → "secure" or finish; Connected: "Let's go" → next step or finish |
| **Secure** | (No option state) | Enable or skip → calls finish() → closes onboarding, sets `wealth_tutorial_pending` flag |

### Biometric Flow (Web Onboarding Step 5)

| State | Behaviour |
|-------|-----------|
| **Check supported** | useEffect queries `ReactNativeWebView.postMessage({ type: "biometrics:get" })` |
| **Supported** | Step 5 ("secure") shown; buttons available |
| **Not supported** | Step 5 skipped; finish() called after bank step |
| **User enables** | Step 5 button "Enable biometric unlock" → `setBiometrics(true)` → finish() |
| **User skips** | Step 5 button "Maybe later" → `setBiometrics(false)` → finish() |

---

## Interactions

### Login Gate (PIN Entry)

1. **Focus:** User taps PIN input → `autoFocus` trigger + focus ring
2. **Type:** Each keystroke → `onChange` sets PIN state, clears any error state
3. **Enter key:** If key === "Enter" → `unlock()` triggered
4. **Submit:** Click "Unlock" button → `unlock()` called
5. **Validation:** 
   - If PIN === "8048" → set `wealth_auth` in localStorage → redirect to `/`
   - Else → set `error=true`, clear PIN, show error message, remain on login
6. **Retry:** User taps PIN again → error cleared (via onChange), try new PIN

### Onboarding: Welcome to Profile Transition

1. User sees welcome screen with 3 feature cards + "Get started" CTA button (with `<ChevronRight size={16} />` icon)
2. Click "Get started" → `setStep("profile")`
3. Name fields + postcode appear
4. User fills first/last name (required), postcode (optional)
5. Press Enter in any field or click "Continue" → `saveProfile()` validation
6. Valid → API call to `updateProfile(fullName, postcode, false)` with completion flag `false` (does NOT mark onboarding complete yet)
7. On success → `setStep("payday")`
8. On error → error message appears below button

### Onboarding: Payday Selection

1. User sees 7 hardcoded payday options
2. Click any option → `setPayIdx(i)` (radio-like single selection)
3. Selected option highlights with indigo background + checkmark
4. Click "Continue" → `savePayday()` reads `PAY_OPTIONS[payIdx].value`
5. If value is not null, API call to `updatePreferences({ pay_period_config: value })`
6. Then `setStep("bank")`

### Onboarding: Bank Connect Flow

1. **Not connected state:**
   - User sees "Connect your first bank" heading + 3 trust badges + "Connect a bank" button
   - Click "Connect a bank" → `setShowSheet(true)` → BankPickerSheet modal appears
   - In sheet: user searches/filters banks, selects one
   - On selection:
     - `onConnecting()` callback → `setShowSheet(false)`, `setBankAdded(true)` (shows success state)
     - OAuth redirect opened (in browser if web, in CustomTab if mobile)
     - Once auth completes and redirect returns, page reloads and shows updated state
   - "Skip for now" button → calls `bankDoneNext()` which advances flow

2. **Connected state (after OAuth succeeds):**
   - Icon shows green checkmark, heading changes to "Bank connected!"
   - "Let's go ›" button now calls `bankDoneNext()`
   - `bankDoneNext()` checks if biometrics are supported (via `ReactNativeWebView`)
     - If supported → `setStep("secure")`
     - If not supported → `finish()` directly

### Onboarding: Biometric Opt-In (Step 5 / Secure)

1. User sees "Protect your dashboard" prompt + biometric icon (ONLY if bioSupported === true)
2. Two buttons: "Enable biometric unlock" and "Maybe later"
3. **Enable:** 
   - Click → `setBiometrics(true)` (posts message to ReactNativeWebView to store pref in SecureStore)
   - Then `finish()` → calls `api.updateProfile(name, postcode)` then `localStorage.setItem("wealth_tutorial_pending", "1")`, then `onComplete()`
4. **Skip:**
   - Click → `setBiometrics(false)` (posts message to store pref=disabled)
   - Then `finish()` (same flow as enable)

### Biometric Messaging Pattern (Web → Mobile)

```javascript
// Web sends to mobile:
const rn = window.ReactNativeWebView;
rn?.postMessage(JSON.stringify({ 
  type: "biometrics:set", 
  enabled: true/false 
}));

// Web asks mobile if biometrics supported:
rn.postMessage(JSON.stringify({ 
  type: "biometrics:get", 
  id: "<random-id>" 
}));

// Mobile posts back:
window.dispatchEvent(new CustomEvent("native-biometrics", {
  detail: { id: "<same-id>", supported: true/false }
}));
```

---

## Data & Auth Model

### Web Authentication Flow — Two Separate Systems

**System 1: Google OAuth (Real Production Gate via AuthProvider)**

1. **Initial:** User lands on app root (`/`)
   - AuthProvider checks token in localStorage
   - No token → render `<LoginScreen>` (Google OAuth button)
   - Click "Continue with Google" → POST `/api/auth/google` → Google consent screen
   - Google redirects back with `?token=<jwt>` or `?error=<code>`
   - AuthProvider picks up token from URL, stores via `localStorage`
   - Token validated: POST `/api/auth/session/validate` with `Authorization: Bearer <token>`
   - On success: Response contains user `{ email, name }`
   - On failure: Clear token, render LoginScreen again

2. **Onboarding Gate (after OAuth):**
   - AuthProvider fetches `/api/profile` after token validation
   - If `profile.onboarding_complete === false` → render `<Onboarding>` component
   - Once onboarding finishes → `localStorage.setItem("wealth_tutorial_pending", "1")` + call `onComplete()`
   - Onboarding component unmounts; user proceeds to dashboard

3. **Session Persistence:**
   - On app reload, AuthProvider reads token from localStorage
   - Validates token again via `/api/auth/session/validate`
   - If expired/invalid, clears token; user returns to `<LoginScreen>`

**System 2: PIN Unlock (MVP Stub, Separate from AuthProvider)**

- Route: `/login` (hardcoded route, separate from auth flow)
- Standalone page for development/testing only
- PIN: "8048" (hardcoded for MVP)
- On correct PIN: `localStorage.setItem("wealth_auth", "true"); router.replace("/")`
- **IMPORTANT:** This is NOT integrated into AuthProvider; it's a parallel, unused route
- In production, Google OAuth (System 1) is the real gate; PIN page is a temporary bypass

### Mobile Authentication Flow (Current + Target)

**Current State (MVP):**
- Mobile wraps web app in Expo WebView (`web.tsx`)
- Web runs inside WebView (both PIN /login route AND Google OAuth via AuthProvider)
- Biometric lock gate is at native layer: `(tabs)/_layout.tsx` checks SecureStore("biometric_lock") on app foreground
- Deep link handler: `/auth-complete.tsx` catches TrueLayer OAuth redirect during bank-connect flow
- **Auth source:** Web app (via WebView) → token stored in SecureStore by AuthContext

**Target State (Native Rebuild, 1:1 with Web Auth Logic):**
1. **Login gate:** Google OAuth (primary, from web AuthProvider logic)
   - Native Google Sign-In (via @react-native-google-signin) OR web OAuth via WebBrowser
   - On success → token stored in SecureStore via AuthContext.setToken()
   - POST `/api/auth/session/validate` to validate token
   - On failure → show login screen again

2. **Onboarding Flow (After Google OAuth):**
   - Onboarding component (ported to native RN) runs if `profile.onboarding_complete === false`
   - Steps: Welcome → Profile → Payday → Bank Connect → Secure (biometric, if in WebView/bioSupported)
   - On completion → `localStorage.setItem("wealth_tutorial_pending", "1")` + call `onComplete()`

3. **Biometric Unlock (Native, Persistent Gate):**
   - `(tabs)/_layout.tsx` biometric gate runs on every app foreground (via AppState listener)
   - Checks SecureStore("biometric_lock"): if "0" or null → skip prompt; show tabs
   - If "1" + hardware available → prompt `LocalAuthentication.authenticateAsync()`
   - On success → show tabs; on fail → show "Dashboard locked" card + retry button
   - **Note:** This is separate from web's onboarding Step 5 prompt (web asks once; mobile gate is every foreground)

4. **Reconciliation:**
   - **Web PIN vs Mobile Biometric:** Web/MVP uses PIN for dev testing; production uses Google OAuth; mobile will use native Google Sign-In at same flow point
   - **Web Google OAuth vs Mobile Google Sign-In:** Both flow through same token-validate-onboard sequence; transport differs (web browser, mobile native SDK)
   - **Biometric pref sync:** Web onboarding Step 5 calls `setBiometrics(true/false)` → mobile bridge receives → writes SecureStore → mobile biometric gate reads on next foreground

---

## Current Mobile State

### What's Already Implemented

1. **Biometric Lock Gate** (`mobile/app/(tabs)/_layout.tsx`):
   - Runs on app launch / return from background
   - Checks `SecureStore("biometric_lock")` preference
   - If "0" (disabled) → skip; show tabs
   - If hardware not available → skip
   - If preference "1" → prompt with `LocalAuthentication.authenticateAsync()`
   - On success → show tabs
   - On fail → show "Dashboard locked" card with retry button
   - Loading state: ActivityIndicator (large, indigo)

2. **Auth Context** (`mobile/lib/AuthContext.tsx`):
   - Manages token state via SecureStore
   - `setToken(token)` → persists to SecureStore
   - `signOut()` → clears SecureStore

3. **Deep Link Handler** (`mobile/app/auth-complete.tsx`):
   - Listens for deep link `wealthdash://auth-complete` (OAuth redirect)
   - On route match: dismiss WebBrowser, navigate to home (`/`)

### What's Missing (Gaps vs Web)

| Feature | Web | Mobile | Status |
|---------|-----|--------|--------|
| **PIN login gate** | Implemented (hardcoded "8048") | None; WebView runs web app | Need native screen |
| **Google OAuth button** | LoginScreen.tsx (present, unused) | None | Need native Google Sign-In integration |
| **Onboarding shell + dots** | Onboarding.tsx (full flow) | None | Need native RN rebuild |
| **Profile name input** | Step 2 in web | None | Need native screen |
| **Payday picker** | Step 3 in web | None | Need native screen |
| **Bank connect button + sheet** | Step 4 in web | None; BankPickerSheet imports TrueLayer API | Need native sheet + API call |
| **Biometric opt-in prompt** | Step 5 onboarding (one-time ask) | Native gate on every foreground | Different UX; mobile is stricter |
| **Dark mode** | Light + dark CSS variants | ThemeContext implemented | Need dark variants on all screens |

### Biometric Preference Storage (Web → Mobile Sync)

**Web approach (Onboarding Step 5, only in WebView):**
- User sees prompt: "Enable biometric unlock?" (ONLY if bioSupported === true, i.e., running in mobile WebView)
- Web calls `setBiometrics(true/false)` → posts `{ type: "biometrics:set", enabled: true/false }` to ReactNativeWebView
- Mobile native layer (bridge code, e.g., in mobile/app/auth-complete.tsx listener) receives message and writes to SecureStore("biometric_lock") as "1" or "0"

**Mobile approach (Ongoing, native gate):**
- On app foreground (AppState or useFocusEffect), `(tabs)/_layout.tsx` calls `tryUnlock()`
- Reads SecureStore("biometric_lock") — three cases:
  - **"0" (disabled explicitly):** Skip biometric prompt; show tabs immediately
  - **null (unset, first install):** Fall through to hardware availability check (no prompt if no hardware or not enrolled)
  - **"1" (enabled):** Check hardware availability (hasHardware && enrolled); if true → prompt LocalAuthentication.authenticateAsync()
- On successful auth → show tabs; on fail → show "Dashboard locked" card with retry button

**Current implementation verified:**
- (tabs)/_layout.tsx:28-29 checks `if (pref === "0") { setUnlocked(true); return; }` — correctly skips all checks if pref is "0"
- If pref is null or not "0", code falls through to hardware check: `const [hasHardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])`
- Only prompts if both hasHardware && enrolled are true
- Web onboarding Step 5 calls `setBiometrics(true/false)` → mobile bridge should receive and write "1" or "0" to SecureStore

---

## React Native Port Notes

### PIN Pad (Web Input → Native)

**Web:**
```jsx
<input
  type="password"
  inputMode="numeric"
  maxLength={4}
  onKeyDown={(e) => e.key === "Enter" && unlock()}
/>
```

**Mobile (React Native):**
```jsx
<TextInput
  value={pin}
  onChangeText={setPin}
  maxLength={4}
  secureTextEntry={true}
  keyboardType="number-pad"
  onSubmitEditing={unlock}
  // NativeWind/StyleSheet:
  style={{
    width: "100%",
    paddingVertical: tw.space[4],
    fontSize: tw.text.sm.fontSize, // 14
    borderWidth: 2,
    borderRadius: tw.radius.xl, // 12
    borderColor: error ? tw.color.red600 : tw.color.slate700,
    color: tw.color.white,
    backgroundColor: tw.color.slate800,
    textAlign: "center",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 14), // 0.1em for "••••" spacing
  }}
/>
```

**Key Differences:**
- `secureTextEntry` instead of `type="password"`
- `onSubmitEditing` instead of `onKeyDown` for Enter
- Letter-spacing computed via `tw.tracking()` helper
- BorderWidth/BorderRadius use StyleSheet, not className

### Secure Storage (localStorage → expo-secure-store)

**Web:**
```javascript
localStorage.setItem("wealth_auth", "true");
localStorage.getItem("wealth_auth");
localStorage.removeItem("wealth_auth");
```

**Mobile:**
```javascript
import * as SecureStore from "expo-secure-store";

await SecureStore.setItemAsync("wealth_auth", "true");
const value = await SecureStore.getItemAsync("wealth_auth");
await SecureStore.deleteItemAsync("wealth_auth");
```

**Storage Keys to Sync:**
- `wealth_auth` — boolean flag (or JWT token)
- `biometric_lock` — "0" | "1" (disabled / enabled)
- `wealth_tutorial_pending` — "1" flag (onboarding walkthrough)

### Biometric Authentication (Web Bridge → Native API)

**Web (inside WebView, posts to native bridge):**
```javascript
const rn = window.ReactNativeWebView;
if (rn) {
  rn.postMessage(JSON.stringify({ 
    type: "biometrics:set", 
    enabled: true // or false
  }));
}
```

**Mobile (native layer, listens & responds):**
```javascript
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// On receiving "biometrics:set" from web:
async function setBiometric(enabled) {
  await SecureStore.setItemAsync("biometric_lock", enabled ? "1" : "0");
}

// On receiving "biometrics:get" from web:
async function checkBiometric(id) {
  const supported = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
  // Post back via injectedJavaScript or fetch bridge
}

// On tab load (native gate):
async function tryUnlock() {
  const pref = await SecureStore.getItemAsync("biometric_lock");
  if (pref !== "1") return true; // bypass
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock your dashboard",
  });
  return res.success;
}
```

### Onboarding Shell (Layout)

**Web:**
```jsx
<div className="min-h-dvh flex flex-col items-center justify-center px-6 py-10">
  <div className="flex gap-2 mb-8">{/* dots */}</div>
  <div className="w-full max-w-sm">{/* content */}</div>
</div>
```

**Mobile:**
```jsx
<SafeAreaView style={[styles.shell, { paddingBottom: insets.bottom }]}>
  <ScrollView contentContainerStyle={styles.scrollContent}>
    <View style={styles.dotsContainer}>{/* dots */}</View>
    <View style={styles.contentWrapper}>{/* content */}</View>
  </ScrollView>
</SafeAreaView>

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: tw.color.canvasLight, // or dark variant
    paddingHorizontal: tw.space[6], // 24px ≈ px-6
    paddingVertical: tw.space[2.5], // 10px padding
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  dotsContainer: {
    flexDirection: "row",
    gap: tw.space[2],
    marginBottom: tw.space[8],
  },
  contentWrapper: {
    width: "100%",
    maxWidth: 448, // max-w-sm
  },
});
```

### Typography & Tokens

**Web CSS Classes → Mobile Styles:**

| Web | Mobile | Notes |
|-----|--------|-------|
| `text-3xl font-bold` | `{ fontSize: tw.text["3xl"].fontSize, fontWeight: tw.weight.bold }` | 30px / 700 weight |
| `text-xl font-bold` | `tw.text.xl` + `tw.weight.bold` | 20px / 700 weight |
| `text-sm text-slate-500` | `{ ...tw.text.sm, color: tw.color.slate500 }` | 14px / #64748b |
| `text-xs font-semibold uppercase tracking-wide` | `{ ...tw.text.xs, fontWeight: tw.weight.semibold, letterSpacing: tw.tracking(tw.trackingEm.wide, 12) }` | 12px / 600 / 0.025em |
| `rounded-3xl` | `borderRadius: tw.radius["3xl"]` | 24px |
| `shadow-sm` | `shadowColor: "#000", shadowOpacity: 0.05, shadowOffset: { height: 1 }, shadowRadius: 2, elevation: 1` | Approximate via shadow props |
| `gap-4` | `gap: tw.space[4]` | 16px |
| `p-6` | `padding: tw.space[6]` | 24px all sides |
| `py-3.5` | `paddingVertical: tw.space[3.5]` | 14px vert |

### Dark Mode

Every mobile screen must support dark mode via `useTheme()` hook + `backgroundColor`, `color` conditional:

```jsx
const { dark: darkMode } = useTheme();

<View
  style={{
    backgroundColor: darkMode ? tw.color.slate900 : tw.color.white,
    borderColor: darkMode ? tw.color.slate700 : tw.color.slate200,
  }}
>
  <Text style={{ color: darkMode ? tw.color.slate100 : tw.color.slate900 }}>
    Text
  </Text>
</View>
```

### Input Field Focus States (No Ring in RN)

**Web:** `focus:outline-none focus:ring-2 focus:ring-indigo-500` (ring-based)

**Mobile:** Implement via border colour change on focus:

```jsx
const [focused, setFocused] = useState(false);

<TextInput
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  style={{
    borderColor: focused ? tw.color.indigo600 : tw.color.slate700,
    borderWidth: 2,
    // ... other styles
  }}
/>
```

### Button Press Feedback (No CSS :active:scale)

**Web:** `active:scale-[0.97]` (3% scale-down on press)

**Mobile:** Implement via Pressable state:

```jsx
<Pressable
  onPress={handlePress}
  style={({ pressed }) => ({
    opacity: pressed ? 0.95 : 1,
    transform: [{ scale: pressed ? 0.97 : 1 }],
  })}
>
  <Text>Button</Text>
</Pressable>
```

---

## Open Questions & Risks

### Web → Mobile Auth Reconciliation

1. **PIN vs Biometric Security Model:**
   - Web: PIN is one-time gate (dev-only, hardcoded "8048"); onboarding Step 5 asks to enable biometrics
   - Mobile: Biometric gate runs every foreground if enabled; no PIN screen exists yet
   - **Risk:** Different unlock UX on web vs mobile; mobile more restrictive
   - **Recommendation:** Define canonical unlock flow (PIN for setup, biometric for ongoing?) and align both platforms

2. **Google OAuth is Production Gate (AuthProvider is Canonical):**
   - Web's AuthProvider.tsx renders `<LoginScreen>` (Google OAuth) when no user token
   - `/login` (PIN page) is a separate, unused MVP stub route — not integrated into AuthProvider flow
   - **Status:** Google OAuth is the REAL authentication gate; PIN route exists for development bypass only
   - **For mobile:** Port Google OAuth logic from AuthProvider + LoginScreen, not the PIN route
   - **Recommendation:** Mobile should implement native Google Sign-In (or OAuth via WebBrowser) to match web's AuthProvider flow

3. **Biometric Preference Sync (Web ↔ Mobile):**
   - Web onboarding Step 5 posts `{ type: "biometrics:set", enabled: true/false }` to ReactNativeWebView
   - Mobile's biometric gate checks SecureStore("biometric_lock") on app foreground
   - **Current status:** Web posts messages; mobile needs bridge listener to receive and persist to SecureStore
   - **Recommendation:** Add message handler in mobile (e.g., in auth-complete.tsx or a bridge module) to intercept "biometrics:set" and call `SecureStore.setItemAsync("biometric_lock", enabled ? "1" : "0")`

4. **Onboarding Completion Flag:**
   - Web's `Onboarding.tsx` finish() function sets `localStorage.setItem("wealth_tutorial_pending", "1")` at end
   - Mobile (if running web in WebView) can read this flag from localStorage or fetch from `/api/profile`
   - Mobile (if native rebuild) needs to check `localStorage` or call `/api/profile` to detect incomplete onboarding
   - **Current status:** Flag written by web onboarding; mobile must check it on app launch to decide whether to show tutorial prompts
   - **Recommendation:** On mobile app init, check `profile.onboarding_complete` via API or read local flag to gate tutorial display

5. **BankPickerSheet OAuth Redirect:**
   - Web (in WebView) opens BankPickerSheet → selects bank → OAuth opens in CustomTab/WebBrowser
   - On OAuth success, TrueLayer redirects to `wealthdash://auth-complete` deep link
   - Mobile's `/auth-complete.tsx` catches the deep link: dismisses browser → navigates to `/` (home remounts, reloads profile with new bank)
   - **Current status:** Deep link handler verified correct; OAuth flow wired up
   - **Verification needed:** Confirm `wealthdash://auth-complete` is registered in Expo app.json and tested end-to-end

6. **Dark Mode Default:**
   - Web: auto-detects user preference via CSS media query `prefers-color-scheme`
   - Mobile: ThemeContext stores preference in SecureStore, defaults to system setting
   - **Risk:** User might see different default theme on first launch (web auto, mobile explicit)
   - **Recommendation:** Ensure mobile default matches web; consider syncing theme pref via API

### Visual Parity Risks

1. **PIN Input Placeholder:** Web shows `••••` placeholder; mobile may render differently with `secureTextEntry`
   - **Test:** Enter PIN on mobile WebView vs native PIN screen side-by-side

2. **Button Scale Animation:** Web uses `active:scale-[0.97]`; React Native Pressable scale may feel different
   - **Test:** Compare press feedback with native iOS/Android buttons for consistency

3. **Progress Dots:** Web animates width via `transition-[width] duration-200`; RN may need Reanimated for smooth motion
   - **Recommendation:** Start with static dots; add Reanimated for polish later

4. **Onboarding Cards:** Web feature cards have category-coloured icon badges; mobile emoji fallback may look jarring
   - **Recommendation:** Port lucide-react-native icons for feature cards (Building2, Wallet, Sparkles)

---

## Implementation Checklist for Mobile

- [ ] **PIN Login Screen** (new native screen)
  - [ ] Dark slate-950 background, centered card
  - [ ] PIN input (4 digits, password mode, letter-spacing)
  - [ ] Shield icon badge (indigo neutral, red error)
  - [ ] Unlock button (indigo, scale feedback)
  - [ ] Error message (red, conditional)
  - [ ] Validation logic (hardcoded "8048" or Google OAuth)

- [ ] **Onboarding Shell** (new native component)
  - [ ] Progress dots (4 dots, conditional visibility)
  - [ ] SafeAreaView wrapper, responsive padding
  - [ ] ScrollView for tall content
  - [ ] Dark mode support

- [ ] **Welcome Step** (new native screen)
  - [ ] Hero title + subtitle
  - [ ] Gradient icon badge (indigo → violet)
  - [ ] 3 feature cards with lucide icons + colours
  - [ ] CTA button "Get started" with `<ChevronRight size={16} />` icon

- [ ] **Profile Step** (new native screen)
  - [ ] 2×1 grid for first/last name inputs
  - [ ] Postcode input + helper text
  - [ ] Error display
  - [ ] CTA button "Continue"

- [ ] **Payday Step** (new native screen)
  - [ ] 7 hardcoded options in list
  - [ ] Radio-like selection (highlight + checkmark)
  - [ ] CTA button "Continue"

- [ ] **Bank Connect Step** (new native screen)
  - [ ] Conditional icon (Building2 / Check) + heading + subheading
  - [ ] 3 trust badges (emoji + text)
  - [ ] Main CTA (text changes based on connected state)
  - [ ] Secondary CTA "Skip for now"
  - [ ] BankPickerSheet integration (fetch providers, OAuth flow)

- [ ] **Secure Step** (new native screen)
  - [ ] Shield icon badge (indigo)
  - [ ] Heading + subheading
  - [ ] "Enable biometric unlock" button → calls native biometric API + stores preference
  - [ ] "Maybe later" button → skips biometric setup

- [ ] **Biometric Integration**
  - [ ] SecureStore("biometric_lock") writes on onboarding Step 5
  - [ ] Native biometric gate reads preference and prompts if enabled
  - [ ] Bridge handler receives "biometrics:set" from web onboarding

- [ ] **Dark Mode**
  - [ ] All text colours conditional (`darkMode ? slate-100 : slate-900`)
  - [ ] All backgrounds conditional (card light/dark)
  - [ ] All borders conditional (hairline light/dark)
  - [ ] Test in system dark mode + app theme toggle

- [ ] **API & Naming**
  - [ ] Use mobile AuthContext.signOut() (not logout()) to clear token — note: web AuthProvider uses logout(), mobile uses signOut()

- [ ] **Testing**
  - [ ] PIN entry, correct/incorrect, unlock success
  - [ ] Onboarding flow end-to-end (all 5 steps)
  - [ ] Bank OAuth redirect (deep link handling)
  - [ ] Biometric preference persists across app restart
  - [ ] Dark mode rendering on all steps
  - [ ] Responsive layout on iPhone SE + iPhone 14 Pro + iPad

---

## Design References

### Colours (Hex)

**Backgrounds:**
- Canvas light: #f0f2f7
- Canvas dark: #0f172a
- Card light: #ffffff
- Card dark: #1e293b

**Brand & Status:**
- Indigo (primary): #4f46e5
- Indigo hover: #4338ca (indigo-700)
- Indigo light bg: #eef2ff (indigo-50)
- Indigo dark bg: #312e81 (indigo-900, opacity 30%)
- Violet (Penny): #7c3aed
- Red (error): #ef4444
- Red dark bg: #7f1d1d (red-900, opacity 30%)
- Emerald (success): #10b981
- Slate (neutral): #64748b

**Text:**
- Ink light: #0f172a
- Ink dark: #f1f5f9
- Muted: #94a3b8

### Typography

- **Display (hero figure):** 700, 30px, line-height 1.2, letter-spacing -0.025em
- **Headline (page title):** 700, 20px, line-height 1.3
- **Title (card header):** 600, 14px, line-height 1.4
- **Body (description):** 400, 14px, line-height 1.5
- **Label (captions):** 600, 11px, line-height 1.3, letter-spacing 0.05em, always #94a3b8

### Radii

- Chip: 8px
- Control: 12px
- Card: 16px
- Hero: 24px
- Pill: 9999px

### Spacing

All Tailwind units × 4px:
- 1 = 4px
- 2 = 8px
- 3 = 12px
- 4 = 16px
- 5 = 20px
- 6 = 24px
- 8 = 32px

---

## Key Named Rules (Design System)

1. **The Calm Cockpit Rule:** Verdicts lead; colour is information; red = genuine risk only.
2. **The Red Is Risk Rule:** Red only for financial liability (over-budget, at-risk bills, debt). Never for emphasis or non-financial errors.
3. **The Penny Gradient Rule:** Indigo→violet gradient (135°) belongs to AI adviser alone. Only on Penny surfaces (chat, advice).
4. **The Numbers Lead Rule:** Money figure is visually heaviest; label whispers above/beside in muted caps.
5. **The One Shadow Rule:** Resting cards get one soft shadow or none. Fix tone/border contrast instead of stacking shadows.
6. **The Category Voice Rule:** ~15% tint background + full-strength icon. Never flood a surface with colour.

---

## Next Steps

1. **Wait for Kevin's direction on PIN vs Google OAuth canonical flow**
2. **Confirm TrueLayer API endpoint + OAuth redirect URL for mobile**
3. **Port PIN screen first** (simplest; validates styling/interaction model)
4. **Then port onboarding shell + welcome step** (establish layout pattern)
5. **Then profile, payday, bank steps** (main flow)
6. **Finally secure step + biometric bridge** (security integration)
7. **Test dark mode + responsive on multiple devices**
8. **Run against 00-foundation.md & DESIGN.md for visual compliance**
