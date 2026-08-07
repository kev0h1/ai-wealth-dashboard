"use client";

import { useEffect, useLayoutEffect, useState, useCallback } from "react";
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

  const attemptUnlock = useCallback(async () => {
    if (!nativePlatform() || !isLockEnabled()) {
      setLocked(false);
      return;
    }
    setLocked(true);
    setAwaitingAuth(true);
    const { supported } = await isAvailable();
    if (!supported) {
      // Lock was enabled previously but hardware is no longer available —
      // fail open rather than stranding the user with no way to unlock.
      setAwaitingAuth(false);
      setLocked(false);
      return;
    }
    const ok = await authenticate("Unlock Wealth Dashboard");
    setAwaitingAuth(false);
    setLocked(!ok);
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

  // Re-check every time the app resumes from background.
  useEffect(() => {
    if (!nativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    let cancelled = false;
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void attemptUnlock();
    }).then((h) => {
      if (cancelled) {
        h.remove();
      } else {
        handle = h;
      }
    });
    return () => {
      cancelled = true;
      handle?.remove();
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
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">Wealth Dashboard is locked</h1>
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
