"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { ShieldCheck, Fingerprint } from "lucide-react";
import { isAvailable, authenticate, isLockEnabled } from "@/lib/biometrics";

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
  const [locked, setLocked] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);

  // Single-flight guard: true for the whole duration of an in-progress check
  // (including the native OS prompt). Presenting that prompt itself is not
  // allowed to start a second, overlapping check — see the `resume` listener
  // below for why that would otherwise happen.
  const inFlightRef = useRef(false);
  // Timestamp of the last `pause` event, used to measure how long the app
  // was actually hidden before the matching `resume`.
  const hiddenAtRef = useRef<number | null>(null);

  const attemptUnlock = useCallback(async () => {
    if (!nativePlatform() || !isLockEnabled()) {
      setLocked(false);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLocked(true);
    setAwaitingAuth(true);
    try {
      const { supported } = await isAvailable();
      if (!supported) {
        // Lock was enabled previously but hardware is no longer available —
        // fail open rather than stranding the user with no way to unlock.
        setAwaitingAuth(false);
        setLocked(false);
        return;
      }
      const ok = await authenticate("Unlock Sorted");
      setAwaitingAuth(false);
      setLocked(!ok);
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
  // `willEnterForegroundNotification`, which only fire when the app truly
  // leaves/re-enters the background (home button, app switcher, screen
  // lock) — presenting an in-process system sheet like Face ID does not
  // move the app into the `.background` state, so these never fire for it.
  //
  // Two more guards on top, as defence in depth:
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
      hiddenAtRef.current = Date.now();
    }).then((h) => {
      if (cancelled) {
        h.remove();
      } else {
        pauseHandle = h;
      }
    });

    App.addListener("resume", () => {
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

  return (
    <>
      {children}
      {locked && (
        <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gradient-to-b from-[#f0f2f7] to-[#e4e8f5] dark:from-[#0f172a] dark:to-[#131c33] px-6">
          <div className="w-20 h-20 rounded-3xl bg-indigo-500 shadow-xl flex items-center justify-center mb-6">
            <Fingerprint size={36} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">Sorted is locked</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8 max-w-xs">
            Confirm it&apos;s you to see your accounts.
          </p>
          {!awaitingAuth && (
            <button
              onClick={() => void attemptUnlock()}
              className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition-all shadow-md shadow-indigo-200 dark:shadow-none"
            >
              <ShieldCheck size={16} />
              Unlock
            </button>
          )}
        </div>
      )}
    </>
  );
}
