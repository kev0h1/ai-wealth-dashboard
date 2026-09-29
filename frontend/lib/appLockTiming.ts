// A121 follow-up: the pure, DOM/Capacitor-free half of the biometric lock's
// timing decisions, pulled out of components/BiometricLock.tsx for the same
// reason lib/appLockInert.ts pulls out the DOM-attribute half — neither
// jsdom nor any other DOM implementation is installed in this repo's plain
// -Node test runner, so a decision that lives inline inside a component's
// effect can only be exercised on a real device. These two decisions don't
// need a DOM or the Capacitor bridge at all, just their own inputs, so they
// are testable as plain functions in scripts/app-lock-gate.test.mjs.
//
// components/BiometricLock.tsx is the only caller of both.

/**
 * A `resume` must follow a `pause` that was at least this long ago to count
 * as a genuine background -> foreground transition, rather than the native
 * biometric prompt's own Activity transition (Android) or a spurious event
 * with no matching pause at all (treated as 0ms hidden). See
 * BiometricLock.tsx's own pause/resume listener comment for the full
 * Android-vs-iOS story this constant is part of.
 */
export const MIN_HIDDEN_MS = 1000;

/**
 * Should the lock be engaged on the very first render, before anything
 * async (the biometric hardware check, the OS prompt) has had a chance to
 * run? True exactly when this is a native build with the lock preference
 * on — the same two-part condition BiometricLock.tsx's `attemptUnlock`
 * checks before doing any real work. Kept as its own named function (not
 * just inlined `native && lockEnabled`) so the "cold start starts locked"
 * contract has one place to test and one place to change, rather than the
 * three call sites in BiometricLock.tsx each repeating the same two-part
 * check and risking drifting apart.
 */
export function isColdStartLocked(nativePlatform: boolean, lockEnabled: boolean): boolean {
  return nativePlatform && lockEnabled;
}

/**
 * Does a `resume` that followed a `pause` by `hiddenForMs` count as a
 * genuine background -> foreground transition that should re-lock and
 * re-prompt? False for a resume with no recorded pause (hiddenForMs = 0,
 * e.g. a spurious event) or one that follows implausibly quickly — see
 * `MIN_HIDDEN_MS`'s own doc comment above.
 */
export function shouldRelockOnResume(hiddenForMs: number): boolean {
  return hiddenForMs >= MIN_HIDDEN_MS;
}
