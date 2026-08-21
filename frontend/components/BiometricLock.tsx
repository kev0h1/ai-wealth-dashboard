"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { ShieldCheck, Fingerprint, LogOut } from "lucide-react";
import { isAvailable, authenticate, isLockEnabled, setLockEnabled } from "@/lib/biometrics";
import { useAuth } from "@/components/AuthProvider";
import { BUILD_TAG } from "@/lib/buildTag";

function nativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// A `resume` must follow a `pause` that was at least this long ago to count
// as a genuine background -> foreground transition. Filters out any resume
// that fires with little/no measured time paused (e.g. a spurious event with
// no matching pause at all, which is treated as 0ms hidden below).
const MIN_HIDDEN_MS = 1000;

// How long after `authenticate()` settles we keep ignoring pause/resume
// events. On Android the native prompt is a separate Activity (see
// `promptingRef` below for the full story), so its own onActivityResult
// delivery and our promise settling are two independently-scheduled
// events — this grace window covers the gap between them so a resume that
// arrives slightly *after* the promise already resolved still gets
// swallowed.
const PROMPT_GRACE_MS = 1500;

// Belt-and-braces on top of `promptingRef`: for a short window after a
// successful unlock, ignore any re-lock trigger outright. Cheap insurance
// against any trailing pause/resume we didn't anticipate re-triggering
// `attemptUnlock` and instantly re-locking a screen the user just unlocked.
const UNLOCK_GRACE_MS = 2000;

// Upper bound on how long we'll wait for the native biometric prompt to
// settle. `authenticate()` (lib/biometrics.ts) is supposed to always resolve
// or reject, never hang — but the underlying native call goes through an
// Android activity (AuthActivity in @aparajita/capacitor-biometric-auth)
// launched with startActivityForResult, and if that activity is killed by
// the OS without delivering a result (e.g. backgrounded mid-prompt, low
// memory, a webview/activity focus hiccup), the Capacitor bridge call it's
// waiting on never resolves either — the `await` below would hang forever.
// Racing it against this timeout is what stops that from being a permanent
// lockout: past 20s we give up waiting, clear the single-flight guard, and
// hand control back to the user.
const AUTH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("biometric-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Native app-lock gate.
 *
 * `{children}` is ALWAYS rendered — the lock is a separate opaque overlay
 * layered on top, not a swap-out of the tree. This keeps the very first
 * render identical on the server (static export) and the client (no
 * `Capacitor.isNativePlatform()` branch in the initial state), so there is
 * no hydration mismatch.
 *
 * The overlay itself is only ever added in `useLayoutEffect`, which React
 * guarantees runs — and, if it schedules a state update, re-renders and
 * re-commits — before the browser paints. So on native with the lock pref
 * enabled, the very first painted frame already shows the lock screen; the
 * unlocked app shell is never visible, even for one frame. On web this
 * effect is a no-op and nothing ever mounts.
 */
export default function BiometricLock({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const [locked, setLocked] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);
  // Set whenever an attempt finished without unlocking (timeout, hard
  // error, failed/cancelled prompt). Drives the honest status line and,
  // together with `!awaitingAuth`, the escape hatch below — see the button
  // block for why the escape hatch is unconditional once this is non-null.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Brief, non-blocking notice shown after we've auto-disabled the lock
  // because the device can no longer satisfy it (see the `!supported`
  // branch below). The app is already unlocked by the time this shows.
  const [autoDisabledNotice, setAutoDisabledNotice] = useState(false);

  // Single-flight guard: true for the whole duration of an in-progress check
  // (including the native OS prompt). Presenting that prompt itself is not
  // allowed to start a second, overlapping check — see the `resume` listener
  // below for why that would otherwise happen. Always cleared in `finally`,
  // including on timeout, so a fresh manual attempt can never be blocked by
  // a stuck previous one.
  const inFlightRef = useRef(false);
  // Timestamp of the last `pause` event, used to measure how long the app
  // was actually hidden before the matching `resume`.
  const hiddenAtRef = useRef<number | null>(null);
  // True from just before we call `authenticate()` until `PROMPT_GRACE_MS`
  // after it settles. On Android, the native biometric prompt is presented
  // by a *separate Activity* (AuthActivity in
  // @aparajita/capacitor-biometric-auth, launched via
  // `startActivityForResult` — see BiometricAuthNative.java), which means
  // showing and dismissing it genuinely pauses and resumes our own
  // MainActivity at the Android Activity-lifecycle level. Capacitor's
  // `@capacitor/app` plugin maps that unconditionally to JS "pause"/"resume"
  // events (AppPlugin.java's `handleOnPause`/`handleOnResume` — no check for
  // "was this actually backgrounding"). Without this guard, EVERY prompt —
  // including a successful one — looked exactly like a genuine
  // background/foreground cycle to the listener below, so it fired a brand
  // new `attemptUnlock()` after every single authentication, looping the
  // prompt forever and never actually letting the user in. (On iOS the
  // prompt is an in-process sheet, not a separate view controller/activity,
  // so pause/resume never fire for it in the first place — this guard is
  // inert there, not required.)
  const promptingRef = useRef(false);
  // Timestamp of the last successful unlock, used by the belt-and-braces
  // check in `attemptUnlock` below.
  const unlockedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!autoDisabledNotice) return;
    const t = setTimeout(() => setAutoDisabledNotice(false), 5000);
    return () => clearTimeout(t);
  }, [autoDisabledNotice]);

  const attemptUnlock = useCallback(async () => {
    if (!nativePlatform() || !isLockEnabled()) {
      setLocked(false);
      return;
    }
    // Belt-and-braces (see `unlockedAtRef` above): a re-lock trigger that
    // sneaks in just after a successful unlock is ignored outright, rather
    // than trusted to re-open the prompt correctly.
    if (unlockedAtRef.current != null && Date.now() - unlockedAtRef.current < UNLOCK_GRACE_MS) {
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLocked(true);
    setAwaitingAuth(true);
    setErrorMessage(null);
    try {
      const { supported } = await isAvailable();
      if (!supported) {
        // Lock was enabled previously but hardware/enrolment is no longer
        // available on this device — gating on a check that can never
        // succeed again would strand the user permanently, so fail open:
        // turn the preference off, unlock, and say so briefly.
        setLockEnabled(false);
        setAwaitingAuth(false);
        setLocked(false);
        setAutoDisabledNotice(true);
        return;
      }
      // Mark "prompting" for the whole native round-trip, so the
      // pause/resume this is about to cause (Android only — see
      // `promptingRef`'s definition above) doesn't get mistaken for a
      // genuine background/foreground cycle by the listener below.
      promptingRef.current = true;
      let ok = false;
      try {
        ok = await withTimeout(authenticate("Unlock Sorted"), AUTH_TIMEOUT_MS);
      } finally {
        // Trailing grace: on Android, the prompt Activity's result and this
        // promise settling are two separately-scheduled events, so the
        // "resume" from returning to our Activity can still arrive a beat
        // after we get here. Keep swallowing pause/resume a little longer
        // rather than dropping the guard the instant we resolve.
        setTimeout(() => {
          promptingRef.current = false;
        }, PROMPT_GRACE_MS);
      }
      setAwaitingAuth(false);
      setLocked(!ok);
      if (ok) {
        unlockedAtRef.current = Date.now();
      } else {
        setErrorMessage("Face/fingerprint wasn't confirmed. Try again.");
      }
    } catch {
      // Reached only if the 20s timeout above wins the race (the native
      // prompt never resolved) — lib/biometrics.ts's authenticate() itself
      // never throws, it resolves false on any recognized failure. Either
      // way: don't leave the lock screen with no controls.
      setAwaitingAuth(false);
      setErrorMessage("Face/fingerprint didn't respond. Try again.");
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Synchronously flip to locked BEFORE the browser paints, if applicable —
  // this is what prevents a flash of unlocked content on native.
  useLayoutEffect(() => {
    if (nativePlatform() && isLockEnabled()) {
      setLocked(true);
    }
  }, []);

  // Kick off the actual biometric prompt after mount (the check + OS prompt
  // are inherently async, so they can't run inside useLayoutEffect itself).
  useEffect(() => {
    if (nativePlatform() && isLockEnabled()) {
      void attemptUnlock();
    }
  }, [attemptUnlock]);

  // Re-check every time the app genuinely returns from the background.
  //
  // This deliberately uses `pause`/`resume`, NOT `appStateChange`.
  // `appStateChange` is wired (see @capacitor/app's iOS source) to
  // `UIApplication.willResignActiveNotification` /
  // `didBecomeActiveNotification`, which fire for ANY loss of "active"
  // status — including the native Face ID/passcode sheet that `authenticate`
  // itself presents. That made the old listener re-trigger `attemptUnlock`
  // every time its own biometric prompt appeared or dismissed: prompt ->
  // resign-active -> "app resumed" -> re-check -> new prompt -> repeat,
  // roughly once a second.
  //
  // `pause`/`resume` are wired to `didEnterBackgroundNotification` /
  // `willEnterForegroundNotification` on iOS, which only fire when the app
  // truly leaves/re-enters the background — an in-process sheet like Face ID
  // never triggers them, so no extra guard is needed there.
  //
  // ANDROID IS DIFFERENT, AND THIS BIT US: the native biometric prompt there
  // is not an in-process sheet, it's a separate Activity
  // (AuthActivity, launched via `startActivityForResult` — see
  // BiometricAuthNative.java / promptingRef's definition above for the full
  // trace). Showing/dismissing that Activity genuinely pauses and resumes
  // our MainActivity, and `@capacitor/app`'s Android side maps that
  // unconditionally to "pause"/"resume" (AppPlugin.java's
  // handleOnPause/handleOnResume have no "was this a real background" check
  // at all). Without `promptingRef` below, a resume caused by the prompt
  // itself returning — including after a *successful* authentication —
  // looked identical to the user genuinely backgrounding and reopening the
  // app, so it re-triggered `attemptUnlock` and re-showed the prompt, every
  // single time, forever: a total lockout, since the user could authenticate
  // correctly and it would just prompt again.
  //
  // Guards, in order of appearance below:
  //  - `promptingRef` (set for the duration of `authenticate()` plus a
  //    trailing `PROMPT_GRACE_MS`): pause/resume events that land while
  //    it's true are the prompt's own Activity transition, not real
  //    backgrounding, and are ignored outright — this is the actual fix for
  //    the Android loop.
  //  - `unlockedAtRef` / `UNLOCK_GRACE_MS` (checked in `attemptUnlock`):
  //    belt-and-braces — even if some pause/resume slipped past the guard
  //    above, a re-lock right after a successful unlock is refused.
  //  - `inFlightRef` (single-flight, in attemptUnlock): a `resume` that
  //    somehow arrives while a check is already running is ignored rather
  //    than stacking a second prompt on top of the first.
  //  - `MIN_HIDDEN_MS`: a `resume` only counts as "genuinely returned from
  //    background" if it followed a `pause` by at least a second. A resume
  //    with no recorded pause (hiddenFor = 0) or an implausibly short one is
  //    treated as noise, not a reason to re-lock and re-prompt.
  useEffect(() => {
    if (!nativePlatform()) return;
    let pauseHandle: { remove: () => void } | undefined;
    let resumeHandle: { remove: () => void } | undefined;
    let cancelled = false;

    App.addListener("pause", () => {
      // Our own prompt's Activity coming to the foreground (Android) —
      // not a real backgrounding. Don't record it as one.
      if (promptingRef.current) return;
      hiddenAtRef.current = Date.now();
    }).then((h) => {
      if (cancelled) {
        h.remove();
      } else {
        pauseHandle = h;
      }
    });

    App.addListener("resume", () => {
      // Our own prompt's Activity finishing and returning control
      // (Android) — not a real return from background. Ignore.
      if (promptingRef.current) return;
      const hiddenFor = hiddenAtRef.current != null ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (hiddenFor < MIN_HIDDEN_MS) return;
      void attemptUnlock();
    }).then((h) => {
      if (cancelled) {
        h.remove();
      } else {
        resumeHandle = h;
      }
    });

    return () => {
      cancelled = true;
      pauseHandle?.remove();
      resumeHandle?.remove();
    };
  }, [attemptUnlock]);

  // The escape hatch: turn the biometric-lock preference off and sign out
  // of the Google session, dropping back to the normal login screen.
  //
  // Important: the biometric lock is a *convenience privacy screen* in
  // front of an already-authenticated session, not the security boundary
  // itself — Google OAuth is. So this action can't leak anything a plain
  // sign-out wouldn't already expose; it exists purely so a device-side
  // biometry failure (missing enrolment, a hung native prompt, whatever)
  // can never become a permanent lockout. A future refactor must NOT
  // "harden" this into blocking sign-out to make the lock "more secure" —
  // that would defeat its only purpose here.
  const signOutInstead = useCallback(() => {
    setLockEnabled(false);
    setLocked(false);
    setAwaitingAuth(false);
    setErrorMessage(null);
    logout();
  }, [logout]);

  return (
    <>
      {children}
      {autoDisabledNotice && (
        <div
          role="status"
          className="fixed inset-x-4 z-[999] flex items-center justify-center rounded-2xl bg-slate-900/90 dark:bg-slate-800/90 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
        >
          Biometric lock turned off, it&apos;s no longer available on this device.
        </div>
      )}
      {locked && (
        <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gradient-to-b from-[#f0f2f7] to-[#e4e8f5] dark:from-[#0f172a] dark:to-[#131c33] px-6">
          <div className="w-20 h-20 rounded-3xl bg-indigo-500 shadow-xl flex items-center justify-center mb-6">
            <Fingerprint size={36} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">Sorted is locked</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8 max-w-xs">
            {errorMessage ?? "Confirm it's you to see your accounts."}
          </p>
          {!awaitingAuth && (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => void attemptUnlock()}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition-all shadow-md shadow-indigo-200 dark:shadow-none"
              >
                <ShieldCheck size={16} />
                {errorMessage ? "Try again" : "Unlock"}
              </button>
              {/* Always available once an attempt has settled without
                  unlocking — not just on a specific error type. We can't
                  reliably tell "the user just cancelled" apart from "this
                  device can never satisfy this prompt" from here, and the
                  cost of over-showing an escape hatch is nothing; the cost
                  of under-showing one is a locked-out owner. */}
              {errorMessage && (
                <button
                  onClick={signOutInstead}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  <LogOut size={13} />
                  Sign out and use Google instead
                </button>
              )}
            </div>
          )}
          {/* Whisper build tag — lets Kevin confirm from the phone itself
              which build is running, so a stuck screen can't be mistaken
              for "the fix didn't ship" when it's actually a stale APK
              download. See lib/buildTag.ts. */}
          <p className="absolute bottom-6 text-[10px] text-slate-400/70 dark:text-slate-500/60 tracking-wide">
            {BUILD_TAG}
          </p>
        </div>
      )}
    </>
  );
}
