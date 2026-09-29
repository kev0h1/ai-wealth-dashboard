"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { ShieldCheck, Fingerprint, LogOut } from "lucide-react";
import { isAvailable, authenticate, isLockEnabled, setLockEnabled } from "@/lib/biometrics";
import { useAuth } from "@/components/AuthProvider";
import { BUILD_TAG } from "@/lib/buildTag";
import { setAppLocked } from "@/lib/appLock";
import { createInertTracker, APP_LOCK_OVERLAY_ATTR } from "@/lib/appLockInert";
import { isColdStartLocked, shouldRelockOnResume } from "@/lib/appLockTiming";
import { coverAfterEvent, type PrivacyCoverEvent } from "@/lib/privacyCover";
import { syncNativePrivacyScreen } from "@/lib/privacyScreen";

// A121 (pentest IOS-07/IOS-03, HIGH): dispatched on `window` right after a
// successful unlock. Nothing that runs on a genuine background→foreground
// transition today refetches financial data on `resume` (BiometricLock's own
// pause/resume listener below only re-triggers the biometric prompt, never
// an api.* call) — Home's data loads once on mount and simply survives
// backgrounding, since `{children}` is never unmounted. This event exists
// for the case that DOES change once the request gate below lands: anything
// that happened to attempt an api.* call while locked (a page's own
// interval, a queued retry) got refused with AppLockedError rather than
// served, and must not be left showing stale/failed data forever once the
// user is back in. Home listens for this and reloads; wire any future
// resume-triggered fetch consumer to the same event rather than inventing a
// second signal.
export const APP_LOCK_UNLOCKED_EVENT = "applock:unlocked";

function nativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// MIN_HIDDEN_MS itself now lives in lib/appLockTiming.ts (imported above),
// alongside the pure `isColdStartLocked`/`shouldRelockOnResume` decisions
// this file's effects below delegate to — pulled out for the same reason
// lib/appLockInert.ts's DOM-attribute logic was: testable in
// scripts/app-lock-gate.test.mjs without a browser or jsdom, neither of
// which is available in this repo's plain-Node test runner.

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
  // A121 review: `attemptUnlock` is async and awaits real I/O (the hardware
  // availability check, the native OS prompt) — a remote sign-out, or any
  // other unmount, can land mid-await. Checked before every mutating call
  // in that function past its first `await` (see attemptUnlock's own
  // guards below) so a continuation that resolves after unmount never
  // calls setLockedState(true)/setAppLocked(true) with no lock screen left
  // mounted to ever clear it — the exact way a failed/cancelled prompt
  // racing a remote sign-out would otherwise strand the NEXT sign-in
  // behind the gate. Plain ref, not state: it must be readable synchronously
  // inside a promise continuation, not just at render time.
  const mountedRef = useRef(true);

  // A121: the single seam every DOM lock/unlock transition passes through,
  // so `locked` (this component's own render state) and the shared
  // lib/appLock.ts signal (which lib/api.ts's request gate reads) can never
  // drift apart. setAppLocked() writes a plain module variable and is
  // synchronous/immediate; setLocked() only schedules a re-render — calling
  // both here, together, at every one of the six places that used to call
  // setLocked() alone, means the signal is already correct before React
  // ever gets to paint the DOM state it describes.
  const setLockedState = useCallback((next: boolean) => {
    setAppLocked(next);
    setLocked(next);
  }, []);

  useEffect(() => {
    if (!autoDisabledNotice) return;
    const t = setTimeout(() => setAutoDisabledNotice(false), 5000);
    return () => clearTimeout(t);
  }, [autoDisabledNotice]);

  const attemptUnlock = useCallback(async () => {
    // A121 review: guards a call that races the unmount itself — e.g. the
    // pause/resume listener's own `cancelled` flag (see that effect below)
    // stops it re-registering its native handle, but not a callback that
    // was already invoked and is mid-flight as teardown begins.
    if (!mountedRef.current) return;
    if (!nativePlatform() || !isLockEnabled()) {
      setLockedState(false);
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
    setLockedState(true);
    setAwaitingAuth(true);
    setErrorMessage(null);
    try {
      const { supported } = await isAvailable();
      // A121 review: unmounted while awaiting the hardware check (e.g. a
      // remote sign-out landed mid-check) — nothing left to update, and
      // critically `setLockedState(true)`/`setAppLocked(true)` further down
      // this function must not run with no lock screen left mounted to
      // ever clear it again, which is exactly what would strand the NEXT
      // sign-in behind the gate.
      if (!mountedRef.current) return;
      if (!supported) {
        // Lock was enabled previously but hardware/enrolment is no longer
        // available on this device — gating on a check that can never
        // succeed again would strand the user permanently, so fail open:
        // turn the preference off, unlock, and say so briefly.
        setLockEnabled(false);
        setAwaitingAuth(false);
        setLockedState(false);
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
      // A121 review: unmounted while awaiting the native prompt itself —
      // this is the guard that closes the actual finding: a prompt that
      // resolves failed/cancelled (`ok === false`) after a remote sign-out
      // unmounted this component mid-prompt must NOT reach
      // `setLockedState(!ok)` below, which would call
      // setAppLocked(true)/setLocked(true) with no lock screen left
      // mounted to ever clear it again — stranding the NEXT sign-in behind
      // AppLockedError (lib/api.ts's gate) indefinitely.
      if (!mountedRef.current) return;
      setAwaitingAuth(false);
      setLockedState(!ok);
      if (ok) {
        unlockedAtRef.current = Date.now();
        // A121 part 3: tell anything that queued a refetch while locked (and
        // was refused with AppLockedError) that it can safely retry now. See
        // this event's own doc comment above for what actually listens.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(APP_LOCK_UNLOCKED_EVENT));
        }
      } else {
        setErrorMessage("Face/fingerprint wasn't confirmed. Try again.");
      }
    } catch {
      // Reached only if the 20s timeout above wins the race (the native
      // prompt never resolved) — lib/biometrics.ts's authenticate() itself
      // never throws, it resolves false on any recognized failure. Either
      // way: don't leave the lock screen with no controls.
      // A121 review: same unmount-race guard as above — a timeout that
      // fires after this component is gone has no controls left to leave
      // in any particular state, and must not touch React state on an
      // unmounted component.
      if (!mountedRef.current) return;
      setAwaitingAuth(false);
      setErrorMessage("Face/fingerprint didn't respond. Try again.");
    } finally {
      inFlightRef.current = false;
    }
    // setLockedState is itself a useCallback with an empty dependency array
    // (see its own definition above), so its identity never changes across
    // renders — listing it here satisfies exhaustive-deps without changing
    // when this callback is recreated.
  }, [setLockedState]);

  // Synchronously flip to locked BEFORE the browser paints, if applicable —
  // this is what prevents a flash of unlocked content on native.
  useLayoutEffect(() => {
    if (isColdStartLocked(nativePlatform(), isLockEnabled())) {
      setLockedState(true);
    }
    // setLockedState has a stable identity (see its own definition above) —
    // listed for exhaustive-deps, this still only ever runs once on mount.
  }, [setLockedState]);

  // Kick off the actual biometric prompt after mount (the check + OS prompt
  // are inherently async, so they can't run inside useLayoutEffect itself).
  useEffect(() => {
    if (isColdStartLocked(nativePlatform(), isLockEnabled())) {
      void attemptUnlock();
    }
  }, [attemptUnlock]);

  // A125: this component only exists while there is a session —
  // components/AuthProvider.tsx renders LoginScreen/Onboarding/AppOnlyPage
  // in its place otherwise, unmounting this one, see that file's own
  // routing. Whatever caused the unmount (an ordinary sign-out, A124's
  // auto-logout-on-401, the escape hatch below) must leave the shared
  // lib/appLock.ts signal false behind it: a stale `true` left over from a
  // lock that was engaged right up to sign-out would silently block the
  // NEXT session's own requests, since lib/nativeAuth.ts's native sign-in
  // exchange and AuthProvider's own session/validate check both now route
  // through lib/api.ts's shared `gatedFetch` (closing the A125 structural
  // gap below) — with no lock screen mounted any more to unlock it from,
  // that would stall a fresh login behind AppLockedError indefinitely.
  // Unconditional and unmount-only: every unlock path this component
  // already knows about clears the signal itself, so this is pure
  // belt-and-braces for any path that doesn't (or a future one that
  // forgets to). Also flips `mountedRef` (see its own definition above),
  // the guard `attemptUnlock`'s own async continuations check below.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      setAppLocked(false);
    };
  }, []);

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
      if (!shouldRelockOnResume(hiddenFor)) return;
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

  // A122: app-switcher privacy cover. Whenever the lock pref is on, an
  // opaque, figure-free node is appended to document.body the instant the app
  // is paused / resigns active / the document is hidden, and removed on the
  // matching return. Plain DOM, not React state, so the node lands
  // synchronously inside the event handler with no render pass in between.
  // The native pieces (Android FLAG_SECURE, iOS overlay) cover what this
  // cannot: on iOS the snapshot can be taken before the WKWebView process
  // paints a JS-driven node, so this layer alone is best-effort there.
  useEffect(() => {
    if (!nativePlatform()) return;
    // Bring the Android window flag in line with the stored pref on every
    // cold start (the pref lives in localStorage, native cannot read it).
    syncNativePrivacyScreen(isLockEnabled());

    let cover: HTMLElement | null = null;
    const apply = (event: PrivacyCoverEvent) => {
      const want = coverAfterEvent(cover != null, event, true, isLockEnabled(), Capacitor.getPlatform());
      if (want && !cover) {
        const el = document.createElement("div");
        el.setAttribute("data-privacy-cover", "true");
        el.setAttribute("aria-hidden", "true");
        // Plain canvas token (Mist / Midnight Canvas via --background), no
        // gradient, no brand colour, no figures. Mirrored in the iOS cover.
        el.style.cssText =
          "position:fixed;inset:0;z-index:2147483647;background:var(--background,#f0f2f7);";
        document.body.appendChild(el);
        cover = el;
      } else if (!want && cover) {
        cover.remove();
        cover = null;
      }
    };

    // Lock switched off while the cover is up: drop it. setLockEnabled has no
    // event, so re-check on the next lifecycle signal (below) and on a poll of
    // the pref while covered.
    const offTimer = setInterval(() => {
      if (cover && !isLockEnabled()) apply("active");
    }, 500);

    const onVisibility = () => apply(document.visibilityState === "hidden" ? "inactive" : "active");
    document.addEventListener("visibilitychange", onVisibility);

    const handles: { remove: () => void }[] = [];
    let cancelled = false;
    const track = (p: Promise<{ remove: () => void }>) =>
      p.then((h) => (cancelled ? h.remove() : handles.push(h)));
    track(App.addListener("pause", () => apply("pause")));
    track(App.addListener("resume", () => apply("resume")));
    track(App.addListener("appStateChange", ({ isActive }) => apply(isActive ? "active" : "inactive")));

    return () => {
      cancelled = true;
      clearInterval(offTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      handles.forEach((h) => h.remove());
      cover?.remove();
      cover = null;
    };
  }, []);

  // A121 part 2c: while locked, every OTHER direct child of document.body
  // (the Next root that holds BottomNav and #app-shell, Sidebar, and any
  // portal node — PennySheet's chip layer chief among them, since that is
  // literally the leak this item closes) becomes `inert` and
  // `aria-hidden="true"`. Structural, not cosmetic: `inert` removes the
  // subtree from focus, hit-testing AND the accessibility tree, so a tap on
  // a chip behind the overlay has nothing to land on, whatever the overlay's
  // own stacking/paint behaviour turns out to be on a given WebKit/Chromium
  // build (see the portal + z-index reasoning below this component's return
  // for why we no longer trust paint order alone).
  //
  // A MutationObserver on document.body's own childList (not a one-off scan)
  // is required, not optional: a sheet or toast that portals to body can
  // mount WHILE already locked (a queued event, a push notification banner),
  // and this is what catches that new node and inerts it too, rather than
  // leaving a one-shot scan's blind spot as the next bypass.
  //
  // lib/appLockInert.ts's tracker is what makes the unlock-time restore
  // exact: it snapshots each element's PRIOR inert/aria-hidden state before
  // touching it, and only elements THIS effect touched are ever restored —
  // an element that was already inert before the lock engaged for its own,
  // unrelated reason (components/TipsLine.tsx's collapsed-panel usage is
  // the existing example) is never a direct child of body, so it is never
  // snapshotted or modified here at all, in either direction.
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (!locked) return;

    const tracker = createInertTracker();
    const isOverlayNode = (el: Element): boolean =>
      el instanceof HTMLElement && el.hasAttribute(APP_LOCK_OVERLAY_ATTR);
    const maybeLock = (el: Element) => {
      if (el instanceof HTMLElement && !isOverlayNode(el)) tracker.lock(el);
    };

    Array.from(document.body.children).forEach(maybeLock);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) maybeLock(node);
        });
      }
    });
    observer.observe(document.body, { childList: true });

    return () => {
      observer.disconnect();
      tracker.restoreAll();
    };
  }, [locked]);

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
    setLockedState(false);
    setAwaitingAuth(false);
    setErrorMessage(null);
    // Order kept as belt-and-braces (unlock signal before logout()), but it
    // is NOT load-bearing: lib/api.ts's request gate exempts POST
    // /auth/logout by path regardless of lock state (A118/A121), so
    // logout()'s server-side session revocation would go through even if
    // this ran while still locked.
    logout();
    // setLockedState has a stable identity (see its own definition above) —
    // listed for exhaustive-deps only.
  }, [logout, setLockedState]);

  // A121 part 2a/2b: portaled straight to document.body instead of rendered
  // as a sibling inside #app-shell. #app-shell picks up `filter:
  // blur(8px) brightness(0.92)` whenever a sheet is open (globals.css's
  // `.sheet-open`, toggled by lib/useSheetOpen.ts) — a non-none `filter` on
  // an ancestor creates a containing block for `position: fixed`
  // descendants, which traps a `fixed` overlay inside THAT ancestor's own
  // stacking context. A body-level portal (PennySheet's own chip/panel
  // layer, z-[56]/z-[58]) can then paint above a `fixed` child of
  // #app-shell regardless of that child's z-index, which is the likely
  // mechanism behind the iOS bypass this item closes (WebKit and Chromium
  // have historically differed on exactly this). Portaling to body removes
  // #app-shell as a possible containing block entirely.
  //
  // The `data-app-lock-overlay` wrapper is a plain, unstyled div (its
  // children are `fixed`, so they position against the viewport regardless
  // of the wrapper) — its only job is being the one node the inert effect
  // above, and any MutationObserver-driven late-comer, can recognise and
  // skip by attribute rather than by ref-identity timing.
  //
  // z-index: z-[999] sits ABOVE every documented tier in the app, including
  // PennySheet's own inventory (components/PennySheet.tsx, ~line 94) — z-40
  // (nav), z-50 (BottomNav rail), z-[56]/z-[58] (PennySheet), z-[60]
  // (TutorialModal/Overlay), z-[65]/z-[70] (the sheet backdrop/panel tier),
  // and z-[80] (SpendPage's toast alerts, the highest tier that inventory
  // names). This is deliberate, not an oversight left over from the old
  // sibling-render approach: a privacy lock screen has exactly one job, and
  // that job means outranking literally everything else the app can put on
  // screen, including a toast that was already in flight when the lock
  // engaged. Keeping it a fixed z-[999] rather than folding it into that
  // inventory's own numbering keeps the "everything else" tiers free to
  // grow toward it without ever needing to renumber the lock.
  const overlay = (locked || autoDisabledNotice) && typeof document !== "undefined"
    ? createPortal(
        <div data-app-lock-overlay="true">
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
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {children}
      {overlay}
    </>
  );
}
