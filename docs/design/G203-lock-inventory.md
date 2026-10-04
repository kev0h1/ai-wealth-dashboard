# G203 app-lock inventory

Source: `frontend/components/BiometricLock.tsx` on main at 34b9be3e (654 lines). Read end to end on 2026-10-04.

## Locked-state UI elements (all inside one `fixed inset-0 z-[999]` node, portalled to `document.body`)

| # | Element | Shipped treatment | Shown when |
|---|---|---|---|
| 1 | Glyph tile | 80px rounded-3xl indigo-500 tile, shadow-xl, lucide `Fingerprint` 36px white | always |
| 2 | Heading | "Sorted is locked", 18px bold ink | always |
| 3 | Status line | 14px slate-500, max-w-xs, centred. Idle text "Confirm it's you to see your accounts."; failed text is the gate's `errorMessage` verbatim | always |
| 4 | Primary button | "Unlock" / "Try again" (when `errorMessage`), indigo-600, `ShieldCheck` 16px, 12px 20px padding (about 44px tall), rounded-2xl | not while the OS prompt is up (`!awaitingAuth`) |
| 5 | Escape hatch | "Sign out and use Google instead", 12px slate text link with `LogOut` icon, about 32px tall | only when `errorMessage` is set and not prompting |
| 6 | Build tag | whisper 10px `BUILD_TAG`, absolute bottom-6 | always |
| 7 | Background | vertical gradient #f0f2f7 to #e4e8f5 (dark #0f172a to #131c33) | always |
| 8 | Auto-disabled toast | separate `role="status"` node above the lock, "Biometric lock turned off, it's no longer available on this device." | only after the lock auto-disables (device lost biometrics); unlocked by then. NOT part of the lock screen presentation |

## States

- **idle**: locked, no attempt running, no error (first paint on cold start, before the effect sets `awaitingAuth`). Heading, idle line, Unlock button.
- **prompting**: `awaitingAuth` true, the OS Face ID / fingerprint sheet is up over the screen. Heading and status line only, NO buttons.
- **failed**: `errorMessage` set. Two texts: "Face/fingerprint wasn't confirmed. Try again." (prompt returned false) and "Face/fingerprint didn't respond. Try again." (the 20s `AUTH_TIMEOUT_MS` won). Try again + escape hatch both shown.
- **timed out**: same as failed with the second text. Resume after 1s+ in background (`shouldRelockOnResume`) re-enters prompting.

## Actions

- Unlock / Try again: `attemptUnlock()`.
- Sign out and use Google instead: `signOutInstead()` (turns lock pref off, clears lock state, `logout()`). Must stay always-available once an attempt settled without unlocking, and must never be hardened away (see the component's own comment).

## Gate regions NOT touched (line numbers in the post-G203 file; the pre-G203 numbers are in brackets where they moved)

Everything in `BiometricLock.tsx` except three edits: the import line 7 (lucide icons swapped for the `LockScreenView` import), a 10-line presentation-hint helper `nativeLockPlatform()` added at lines 32-40 (read only by the props below, never by the gate), and the `{locked && (...)}` body at lines 609-619 [was 600-641] now rendering `<LockScreenView/>`.

Untouched, by region: `APP_LOCK_UNLOCKED_EVENT` and `nativePlatform()`; `PROMPT_GRACE_MS`, `UNLOCK_GRACE_MS`, `AUTH_TIMEOUT_MS`, `withTimeout`; all component state and refs (`locked`, `awaitingAuth`, `errorMessage`, `autoDisabledNotice`, `inFlightRef`, `hiddenAtRef`, `promptingRef`, `unlockedAtRef`, `mountedRef`); `setLockedState` (the `setAppLocked` + `setLocked` seam); `attemptUnlock` in full (A121 mounted guards, `isAvailable`, `withTimeout(authenticate(...))`, the `!supported` fail-open); the cold-start `useLayoutEffect` and `useEffect`; the A125 unmount reset; the pause/resume re-lock effect; the A122 privacy-cover effect; the A121 part 2c inert effect and MutationObserver; `signOutInstead`; the portal wrapper, `data-app-lock-overlay` node, `z-[999]` root and the auto-disabled toast.

Proof command: `git diff origin/main...HEAD -- frontend/components/BiometricLock.tsx` shows only those three hunks.

## Extraction

`frontend/components/LockScreenView.tsx` is new and purely presentational: props `platform, biometry, state (idle|prompting|failed), errorMessage, failure, buildTag, onUnlock, onSignOut`. It currently renders the shipped markup byte for byte, so the extraction changes no pixels. The three variants take the same props interface and replace its body once Kevin picks.

## Biometric naming

`isAvailable()` already returns `biometryType` (1 Touch ID, 2 Face ID, 3 Android fingerprint, 4 Android face, 5 iris). `biometryKindFromType()` maps it. Today the gate discards the value, so after the pick, naming the right biometric needs a read-only `isAvailable()` call in a presentation-side hook (the gate stays untouched), or the reviewer-approved one-line state capture in `attemptUnlock`. The previews take `biometry` as a prop so every wording is shown now.
