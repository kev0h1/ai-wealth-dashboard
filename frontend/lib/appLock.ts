// A121: the shared biometric app-lock signal.
//
// components/BiometricLock.tsx is the SOLE writer. It calls setAppLocked(true)
// in the same synchronous useLayoutEffect pass that flips its own `locked`
// state — before the browser paints — and setAppLocked(false) only once a
// biometric check actually resolves the lock away (a successful
// authenticate(), the "hardware no longer supports this" auto-disable, or
// the escape-hatch sign-out; every one of those already removes the visible
// lock screen in the same effect, so the signal and the DOM stay in lock
// step by construction, never a frame apart).
//
// lib/api.ts is the sole reader that matters security-wise: it refuses to
// issue an authenticated request while this is true (see AppLockedError
// there). Everything else that imports isAppLocked/subscribeAppLock should
// treat this as read-only.
//
// A140: runWhenUnlocked is a reader plus a deferral, not a writer. Start-up
// work that the gate would refuse (push token upload, push resync) is held
// until the lock clears and then run once. It never bypasses the gate: the
// deferred function issues its requests only after setAppLocked(false).
//
// On web, or with the biometric-lock preference off, BiometricLock never
// calls setAppLocked(true) at all — nativePlatform() && isLockEnabled() gates
// every call site that sets it true, exactly like it already gates the
// component's own `locked` state.

let locked = false;
const listeners = new Set<() => void>();

export function isAppLocked(): boolean {
  return locked;
}

export function setAppLocked(next: boolean): void {
  if (locked === next) return;
  locked = next;
  for (const fn of listeners) fn();
}

/** useSyncExternalStore-compatible subscribe: returns the unsubscribe fn. */
export function subscribeAppLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** useSyncExternalStore-compatible snapshot getter (same value as isAppLocked). */
export function getAppLockSnapshot(): boolean {
  return locked;
}

/**
 * A140: run `fn` now if the app is unlocked, otherwise once, the next time the
 * lock clears. Returns a cancel function (a no-op if `fn` already ran). Pure,
 * no DOM: it only reads the lock signal and subscribes to it.
 */
export function runWhenUnlocked(fn: () => void): () => void {
  if (!locked) {
    fn();
    return () => {};
  }
  let done = false;
  const unsubscribe = subscribeAppLock(() => {
    if (done || locked) return;
    done = true;
    unsubscribe();
    fn();
  });
  return () => {
    done = true;
    unsubscribe();
  };
}
