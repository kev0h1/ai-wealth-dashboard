"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getToken, setTokenAsync, clearToken, hydrateToken } from "@/lib/auth";
import { resumePendingLogin } from "@/lib/nativeAuth";
import { loadPendingLogin } from "@/lib/pendingLogin";
import { boundedSignal } from "@/lib/abortBound";
import type { ResumingLogin } from "@/lib/signInPhase";
import { api, API_BASE, gatedFetch, setUnauthorizedHandler, resetUnauthorizedGate } from "@/lib/api";
import { WEB_PRODUCT_OFF } from "@/lib/webProduct";
import LoginScreen from "@/components/LoginScreen";
import AppOnlyPage from "@/components/AppOnlyPage";
import Onboarding from "@/components/Onboarding";
import { unregisterCapacitorPush, hasPendingNotificationPaths } from "@/lib/capacitorPush";
import { hasPendingReturn } from "@/lib/bankConnectReturn";
import { postSignInDestination } from "@/lib/postSignInRoute";
import { invalidateAllAccountData } from "@/lib/accountMutations";
import { clearHomeDismissedAdvice } from "@/lib/homeDismissedAdvice";
import { resolveFullName } from "@/lib/displayName";

interface AuthUser {
  email: string;
  name: string;
  // True when the session email is PRIMARY_EMAIL (backend/app/core/config.py),
  // lower-cased and stripped. Only meaningful for the web-product lock below.
  owner: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  logout: () => Promise<void>;
  /** Local-only sign-out (no server revoke), for when the token is already revoked. */
  clearLocalSession: () => void;
}

const AuthContext = createContext<AuthContextValue>({ user: null, logout: async () => {}, clearLocalSession: () => {} });
export const useAuth = () => useContext(AuthContext);

// A124: how often the window-focus/app-resume listeners below are allowed
// to re-run POST /auth/session/validate. One cheap, bodyless call is well
// inside backend/app/core/ratelimit.py's own "/auth/" budget (30 requests
// per 60s), but a floor still stops a user alt-tabbing repeatedly from
// turning "check on focus" into "check on every window event".
const MIN_REVALIDATE_INTERVAL_MS = 60_000;

function nativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export type SessionOutcome = "ok" | "rejected" | "unreachable";
const SESSION_RETRY_DELAY_MS = 1500;
// G202: each session check is bounded, so the "signing in" state cannot
// outlive the copy we show for it. An abort reads as "unreachable" (token
// kept), exactly like any other transient failure.
const VALIDATE_TIMEOUT_MS = 15_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // G202: a Google sign-in started before a process kill or reload is still
  // being awaited. Handed to LoginScreen, which owns every phase decision.
  const [resuming, setResuming] = useState<ResumingLogin | null>(null);
  const resumeCancelledRef = useRef(false);
  // A135: true when init is resuming a persisted pending Google login (as
  // opposed to validating an already stored token).
  const pendingLoginRef = useRef(false);
  // Mirrors `user` for the ledger timer, which must not fire once a user is set.
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  // Set by cancelResume(discardSession) so a cancel that races a successful check knows whether to drop the token.
  const discardRef = useRef(false);
  // Aborts the late-success session check (resume) when Cancel is pressed.
  const lateAbortRef = useRef<AbortController | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // Stamped by both the mount-time validate below and the periodic
  // revalidate effect, so the two share one rate-limit clock rather than
  // each independently allowing a call within the same second.
  const lastValidateAtRef = useRef(0);

  // A135: in-place sign-in for the native flows. LoginScreen used to
  // window.location.reload() after "ok", which threw away a token that only
  // lived in memory (Keystore/Keychain write failed or timed out) and made
  // hydrateToken() read back nothing. This validates the in-memory token and
  // sets `user` with no page reload. What the reload used to give for free is
  // replicated explicitly: stale per-user caches are dropped
  // (invalidateAllAccountData, as clearLocalSession does), the A124 401 gate
  // is reopened, and onboarding is re-derived. The route is left as it was
  // (the reload kept it too), and everything under `children` (tutorial,
  // preferences, push resync) mounts fresh now that `user` is set, exactly as
  // after a reload. Resolves "ok", "rejected" (token refused) or "unreachable"
  // (transient failure, token kept).
  // D13: `fresh` is true only for a sign-in the user just did (LoginScreen's
  // onSignedIn and the resumed Google sign-in), never for a cold start with a
  // stored token. A fresh sign-in lands on Home (see lib/postSignInRoute.ts).
  async function establishSession(signal?: AbortSignal, fresh = false): Promise<SessionOutcome> {
    if (!getToken()) return "rejected";
    invalidateAllAccountData();
    // Snapshot BEFORE validate: DeepLinkHandler takes the stashed bank return on
    // wd:session-established, which fires as soon as the user is set.
    let signInDest: string | null = null;
    if (fresh) {
      let oauthDetour = false;
      try { oauthDetour = !!sessionStorage.getItem("wd_oauth_consent_req"); } catch {}
      let bank = false;
      try { bank = hasPendingReturn(window.sessionStorage); } catch {}
      signInDest = postSignInDestination({
        pendingBankReturn: bank,
        pendingNotificationPath: hasPendingNotificationPaths(),
        oauthDetour,
      });
    }
    const profileP = api.getProfile().catch(() => null);
    let outcome = await validateOnce(signal, signInDest);
    if (outcome === "unreachable") {
      // One bounded retry (no loop) for a transient failure; the token is kept
      // either way so LoginScreen can offer "tap to try again".
      await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
      if (signal?.aborted) return "unreachable";
      outcome = await validateOnce(signal, signInDest);
    }
    // A failed Try again after an earlier unreachable must not leave that stale
    // signal behind (a later cancel would resurface the panel with no token).
    if (outcome !== "unreachable") setResuming((r) => (r && r.ended === "unreachable" ? null : r));
    if (outcome !== "ok") return outcome;
    const profile = await profileP;
    if (profile && !profile.onboarding_complete) setNeedsOnboarding(true);
    return "ok";
  }

  // One POST /auth/session/validate for establishSession. Clears the token
  // only on a definite 401/403 or a missing email. A network error, timeout or
  // 5xx/429 says nothing about the token, so it is kept ("unreachable").
  async function validateOnce(signal?: AbortSignal, landOn: string | null = null): Promise<SessionOutcome> {
    const token = getToken();
    if (!token) return "rejected";
    const bound = boundedSignal(VALIDATE_TIMEOUT_MS, signal);
    try {
      lastValidateAtRef.current = Date.now();
      const res = await gatedFetch(`${API_BASE}/auth/session/validate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: bound.signal,
      });
      if (res.status === 401 || res.status === 403) {
        clearToken(); // a definite rejection of this token
        return "rejected";
      }
      if (!res.ok) return "unreachable";
      const data = await res.json();
      if (!data.email) {
        clearToken();
        return "rejected";
      }
      if (bound.signal.aborted) return "unreachable"; // cancelled or out of time: do not sign in
      setAuthError(null);
      // D13: navigate before the user is set, so a replayed bank return (which
      // runs after) is never clobbered. No reload: A133/A139 need the in-memory token.
      if (landOn && window.location.pathname !== landOn) router.replace(landOn);
      setUser({ email: data.email, name: data.name || "", owner: !!data.owner });
      resetUnauthorizedGate();
      return "ok";
    } catch {
      return "unreachable";
    } finally {
      bound.dispose();
    }
  }

  // G202: whenever a user is set (init validate, late success, establishSession)
  // the resume signal is spent. Without this a later sign-out would show a
  // stale "Checking your session" or "We could not sign you in" over the form.
  useEffect(() => {
    if (user) {
      setResuming(null);
      window.dispatchEvent(new Event("wd:session-established")); // A108: replays a stashed bank return
    }
  }, [user]);

  // A135 rule: cancelling a plain cold-start session check (or its Checking
  // screen) NEVER deletes a stored token, because the check says nothing
  // about whether the token is good. The token is cleared only when (a) the
  // user explicitly chose "Use a different account" (discardSession, from
  // LoginScreen.dismissPhase), or (b) the cancelled thing was a Google
  // sign-in the user started and is now abandoning (pendingLoginRef), whose
  // freshly minted token must not linger. A cancel that races a successful
  // check follows the same rule: the token is kept unless one of those holds.
  function cancelResume(discardSession?: boolean) {
    // The idle form shows at once; the init validate's result is ignored.
    resumeCancelledRef.current = true;
    discardRef.current = discardSession === true;
    lateAbortRef.current?.abort();
    if (discardSession === true || pendingLoginRef.current) clearToken();
    setResuming(null);
    setChecking(false);
  }

  useEffect(() => {
    // A135: a cold start with a stored token can now take several seconds
    // (Keystore read retries plus the session check), so after 1.5 s the
    // "Checking your session." ledger replaces the blank screen. Cleared on
    // every exit of init(), so a fast check never flashes it.
    let initDone = false;
    let ledgerTimer: ReturnType<typeof setTimeout> | null = null;
    async function init() {
      if (nativePlatform()) {
        ledgerTimer = setTimeout(() => {
          if (initDone || resumeCancelledRef.current || userRef.current) return;
          setResuming((r) => r ?? { startedAt: Date.now(), stage: "session" });
        }, 1500);
      }
      try {
        await initInner();
      } finally {
        initDone = true;
        if (ledgerTimer) clearTimeout(ledgerTimer);
      }
    }
    async function initInner() {
      // A135: reset before the first await so a Cancel pressed during the
      // Keystore read is not wiped out below.
      resumeCancelledRef.current = false;
      discardRef.current = false;
      pendingLoginRef.current = false;
      // A123: on native the token lives in Keychain/Keystore. Hydrate the
      // in-memory cache BEFORE anything reads or writes it (including the
      // ?token= write below, which hydration would otherwise overwrite).
      // `checking` stays true until this resolves, so no authed fetch fires.
      if (nativePlatform()) await hydrateToken();

      // A133/A135: a Google sign-in that was started but whose token was never
      // collected (the WebView reloaded or the OS killed the app while the
      // browser sheet was up) is redeemed here, before we conclude "signed
      // out". No-op when there is no pending login record.
      if (nativePlatform() && !getToken()) {
        // G202: the persisted login's own startedAt keeps the elapsed clock
        // honest across the kill.
        const pendingAtStart = loadPendingLogin();
        if (pendingAtStart) {
          pendingLoginRef.current = true;
          setResuming({ startedAt: pendingAtStart.startedAt, stage: "provider" });
        }
        try {
          const resumed = await resumePendingLogin(
            () => {
              // Late success: the token is in, now the session check.
              if (resumeCancelledRef.current) return;
              setResuming((r) => (r ? { ...r, stage: "session" } : r));
              const lateCtrl = new AbortController();
              lateAbortRef.current = lateCtrl;
              void establishSession(lateCtrl.signal, true).then((o) => {
                if (lateAbortRef.current === lateCtrl) lateAbortRef.current = null;
                if (resumeCancelledRef.current) return; // cancelled mid-check: nothing to show
                setResuming((r) => (o === "ok" ? null : r ? { ...r, ended: o === "unreachable" ? "unreachable" : "failed" } : r));
              });
            },
            (result) => {
              if (result === "ok") return; // onLateSuccess owns this branch
              if (result === "cancelled") setResuming(null);
              else if (result === "timeout") setResuming((r) => (r ? { ...r, ended: "timeout" } : r));
              else setResuming((r) => (r ? { ...r, ended: "failed" } : r));
            },
          );
          if (resumed === "ok") setResuming((r) => (r ? { ...r, stage: "session" } : r));
          else if (resumed === "none") setResuming(null);
        } catch {
          setResuming(null); /* never block start-up on this */
        }
      }
      if (resumeCancelledRef.current) {
        // Cancelled during resume: a pending-login token that raced in is
        // discarded; a stored token from a plain cold-start check is kept
        // (see cancelResume).
        if (pendingLoginRef.current) clearToken();
        setResuming(null);
        setChecking(false);
        return;
      }

      // Pick up token from Google OAuth redirect
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      const errParam = params.get("error");

      if (urlToken) {
        await setTokenAsync(urlToken);
        params.delete("token");
      }
      if (errParam) {
        // D5: "invite_only" is passed through as-is (not turned into a
        // human message here) — LoginScreen recognises that exact string
        // and renders its own dedicated "Sorted is invite-only right now"
        // screen instead of the generic red banner below.
        if (errParam === "invite_only") {
          setAuthError("invite_only");
        } else {
          setAuthError(errParam === "unauthorized" ? "Access denied, this account is not authorised." : "Sign-in failed. Please try again.");
        }
        params.delete("error");
      }
      if (urlToken || errParam) {
        const cleaned = params.toString()
          ? `${window.location.pathname}?${params}`
          : window.location.pathname;
        window.history.replaceState({}, "", cleaned);
      }

      const token = getToken();
      if (!token) {
        // Drop a ledger-only "Checking your session" signal (no outcome yet);
        // a resume that ended keeps its failed/timeout notice.
        setResuming((r) => (r && !r.ended ? null : r));
        setChecking(false);
        return;
      }

      // A135: the same classification as the in-place sign-in. Only a
      // definite 401/403 (or a missing email) clears the token; a network
      // error, timeout, 5xx or 429 keeps it and offers Try again, so a cold
      // WebView or a 503 "Session check unavailable" never signs the user out.
      const initCtrl = new AbortController();
      lateAbortRef.current = initCtrl;
      const outcome = await establishSession(initCtrl.signal);
      if (lateAbortRef.current === initCtrl) lateAbortRef.current = null;

      if (outcome === "ok") {
        setResuming(null); // the ledger timer or a slow profile fetch must not leave a stale signal
        if (resumeCancelledRef.current) {
          // Cancel raced a successful check: show the form, and drop the
          // token only per the cancelResume rule.
          if (discardRef.current || pendingLoginRef.current) clearToken();
          setUser(null);
          setResuming(null);
        } else if (urlToken) {
          // F2: the OAuth consent page (/oauth/consent) stashes its own
          // `req` id in sessionStorage before sending the browser off to
          // Google, because the sign-in round trip always lands back on
          // this root path. Once a session is confirmed, restore that detour.
          try {
            const pendingOauthReq = sessionStorage.getItem("wd_oauth_consent_req");
            if (pendingOauthReq) {
              sessionStorage.removeItem("wd_oauth_consent_req");
              window.location.replace(`/oauth/consent?req=${encodeURIComponent(pendingOauthReq)}`);
              return;
            }
          } catch {}
        }
      } else if (resumeCancelledRef.current) {
        // Cancelled mid-check: token left as is (see cancelResume).
      } else if (outcome === "rejected") {
        setResuming(null); // token already cleared by validateOnce
      } else {
        // Unreachable: token KEPT; LoginScreen shows UnreachablePanel.
        setResuming((r) => ({ startedAt: r?.startedAt ?? Date.now(), stage: "session", ended: "unreachable" }));
      }
      setChecking(false);
    }
    init();
  }, []);

  // A118 review: a deliberate user tap (Settings sign out, BiometricLock's
  // "sign out instead") revokes the session server-side FIRST, which signs
  // out EVERY device for this email. authHeaders() reads the token at call
  // time, so the request MUST go before the local clear or it would be sent
  // unauthenticated and the tombstone never written. Best-effort: a failed
  // or timed-out request (api.logout aborts at ~4s) never blocks local
  // sign-out. The 401 handler, revalidate and account deletion must NOT use
  // this: their token is already revoked, and a stray 401 on an unrelated
  // route must never sign out every device. They use clearLocalSession().
  //
  // A120: the device's native push registration is dropped FIRST (it also
  // needs the still-live token for its DELETE), bounded to ~3s so it can
  // never block sign-out. The server-side /auth/logout then deletes every
  // push registration for the email as the backstop.
  async function logout() {
    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        unregisterCapacitorPush(),
        new Promise<void>((resolve) => { pushTimer = setTimeout(resolve, 3000); }),
      ]);
    } catch (e) {
      console.error("[AuthProvider] push unregister failed", e);
    } finally {
      clearTimeout(pushTimer);
    }
    try {
      await api.logout();
    } catch (e) {
      console.error("[AuthProvider] logout request failed", e);
    }
    clearLocalSession();
  }

  // Local-only sign-out: no network call. See logout() above for who uses which.
  function clearLocalSession() {
    // A120: session already revoked (or being deleted), so the server has
    // dropped the registrations; tear the device side down without a call.
    void unregisterCapacitorPush({ remote: false });
    clearToken();
    setUser(null);

    // Clear every module-scope cache and derived localStorage count that
    // holds the previous user's financial data, so a different user signing
    // in on the same tab never gets a moment of the old user's figures
    // painting before the refetch lands. G138 (2026-09-22) pulled this list
    // out into lib/accountMutations.ts's invalidateAllAccountData() so an
    // account mutation (delete, connect, reconnect, statement upload) can
    // clear the exact same set without a second, driftable copy of the
    // list living here — see that file for what each entry holds and why.
    invalidateAllAccountData();

    // Logout-only entries: user-scoped, but not re-derived by any account
    // mutation, so they don't belong in invalidateAllAccountData(). Left
    // untouched: device-scoped preferences (theme, biometric lock, colour/
    // icon customisation), one-shot self-clearing sessionStorage flags, and
    // tutorial/tour "seen" flags — none of these carry financial figures.
    // See the logout audit for the full list and reasoning.
    try {
      localStorage.removeItem("reconnect_expected"); // holds a provider, an account id, and a masked last-4 only
      localStorage.removeItem("wd_bracket"); // income tax bracket
      localStorage.removeItem("tax_checklist_done"); // per-user tax checklist progress
    } catch {}
    clearHomeDismissedAdvice();
    // D13: sign-out lives on /settings; without this the login screen renders
    // over that route and the next sign-in stays there. No reload on native.
    router.replace("/");
  }

  // A124: registers the ONE hook lib/api.ts's get/post/del/toJson call on a
  // 401 from any authenticated route (see that file's own comment for the
  // exempt login/session-validate/public list). Re-registered whenever
  // `user` changes so the closure below always checks the CURRENT signed-in
  // state, not whatever it was when the effect first ran — a stale `user`
  // captured once at mount would still read `null` after a real sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // No signed-in user means there is no session to have been revoked —
      // most likely this already IS the login screen. LoginScreen's own
      // sign-in never goes through lib/api.ts's get/post/del in the first
      // place (lib/nativeAuth.ts calls Google/Apple with a raw `fetch`), so
      // this should be unreachable in practice; bailing here is what stops
      // it looping if that ever changes.
      if (!user) return;
      clearLocalSession();
      setAuthError("You were signed out on another device.");
    });
    return () => setUnauthorizedHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // A124: periodic re-validation, so a backgrounded tab, a second tab, or
  // a second device learns of a revoke without waiting for its next data
  // fetch to 401. Runs on window focus, tab visibility, and (native only)
  // Capacitor's `resume` — the same event BiometricLock.tsx already uses
  // for "the app genuinely returned from the background" (see that file's
  // own comment for why `resume`, not `appStateChange`, is the right one on
  // Android). No promptingRef-style guard is needed here the way that file
  // needs one: this call is idempotent and rate-limited by
  // lastValidateAtRef/MIN_REVALIDATE_INTERVAL_MS below, so an extra
  // spurious `resume` is just silently dropped rather than re-triggering
  // anything visible.
  useEffect(() => {
    async function revalidate() {
      const token = getToken();
      if (!token) return; // already signed out — nothing to check
      const now = Date.now();
      if (now - lastValidateAtRef.current < MIN_REVALIDATE_INTERVAL_MS) return;
      lastValidateAtRef.current = now;
      try {
        const res = await gatedFetch(`${API_BASE}/auth/session/validate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          clearLocalSession();
          setAuthError("You were signed out on another device.");
          return;
        }
        if (res.ok) resetUnauthorizedGate();
      } catch {
        // Offline, or a network hiccup — not a reason to sign anyone out.
        // A real request's own 401 (lib/api.ts) or the next successful
        // revalidate is the backstop.
      }
    }

    function onFocus() { void revalidate(); }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void revalidate();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    let resumeHandle: { remove: () => void } | undefined;
    let cancelled = false;
    if (nativePlatform()) {
      App.addListener("resume", () => { void revalidate(); }).then((h) => {
        if (cancelled) h.remove();
        else resumeHandle = h;
      });
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelled = true;
      resumeHandle?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // /design/* pages are static mockups with zero user data — always public.
  // /terms and /privacy are the published legal documents — anonymous
  // visitors and regulators need to read them without signing in.
  // /oauth/consent (F2) manages its own auth: an MCP client's browser
  // lands there straight off GET /auth/oauth/authorize with no session at
  // all, so the page renders LoginScreen itself when needed rather than
  // this provider's own gate below.
  if (pathname?.startsWith("/design") || pathname === "/terms" || pathname === "/privacy" || pathname?.startsWith("/oauth/consent")) {
    return <>{children}</>;
  }

  if (checking) {
    // G202: a resumed sign-in shows its progress instead of a blank slate.
    if (resuming) return <LoginScreen error={authError} onSignedIn={(sig, fresh) => establishSession(sig, fresh === true)} resuming={resuming} onCancelResume={cancelResume} />;
    return <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />;
  }

  // Web-product lock (backlog A10). When NEXT_PUBLIC_WEB_PRODUCT=off, only
  // the owner's own account (the `owner` flag from POST /auth/session/validate)
  // reaches the real product on the web build — everyone else, signed in or
  // not, sees the "Sorted is an app" shell instead. AppOnlyPage is rendered
  // here in place of `children`, so it also replaces every descendant of
  // this provider (Sidebar, BottomNav, the Penny sheet, TutorialProvider —
  // see app/layout.tsx/Providers.tsx for how they nest under AuthProvider),
  // the same way the `!user` branch below already suppresses them for a
  // signed-out visitor.
  const webProductLocked = WEB_PRODUCT_OFF && !(user && user.owner);
  if (webProductLocked) {
    return <AppOnlyPage />;
  }

  if (!user) {
    return <LoginScreen error={authError} onSignedIn={(sig, fresh) => establishSession(sig, fresh === true)} resuming={resuming} onCancelResume={cancelResume} />;
  }

  if (needsOnboarding) {
    // D7: `user.name` is the raw sign-in provider claim on the session
    // token — an old token issued before the apple_native() fix (or any
    // other path that still hands over an email-shaped name) could carry
    // an Apple relay local part or similar junk here. Route it through
    // the same never-email-derived resolution as the rest of the app
    // rather than pre-filling Onboarding's name field with it — see
    // lib/displayName.ts.
    const prefillName = resolveFullName({ sessionName: user.name, email: user.email }) ?? "";
    return <Onboarding defaultName={prefillName} onComplete={() => setNeedsOnboarding(false)} />;
  }

  return (
    <AuthContext.Provider value={{ user, logout, clearLocalSession }}>
      {children}
    </AuthContext.Provider>
  );
}
