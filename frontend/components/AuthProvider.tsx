"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getToken, setTokenAsync, clearToken, hydrateToken } from "@/lib/auth";
import { resumePendingLogin } from "@/lib/nativeAuth";
import { api, API_BASE, gatedFetch, setUnauthorizedHandler, resetUnauthorizedGate } from "@/lib/api";
import { WEB_PRODUCT_OFF } from "@/lib/webProduct";
import LoginScreen from "@/components/LoginScreen";
import AppOnlyPage from "@/components/AppOnlyPage";
import Onboarding from "@/components/Onboarding";
import { unregisterCapacitorPush } from "@/lib/capacitorPush";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
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
  async function establishSession(): Promise<SessionOutcome> {
    if (!getToken()) return "rejected";
    invalidateAllAccountData();
    const profileP = api.getProfile().catch(() => null);
    let outcome = await validateOnce();
    if (outcome === "unreachable") {
      // One bounded retry (no loop) for a transient failure; the token is kept
      // either way so LoginScreen can offer "tap to try again".
      await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
      outcome = await validateOnce();
    }
    if (outcome !== "ok") return outcome;
    const profile = await profileP;
    if (profile && !profile.onboarding_complete) setNeedsOnboarding(true);
    return "ok";
  }

  // One POST /auth/session/validate for establishSession. Clears the token
  // only on a definite 401/403 or a missing email. A network error, timeout or
  // 5xx/429 says nothing about the token, so it is kept ("unreachable").
  async function validateOnce(): Promise<SessionOutcome> {
    const token = getToken();
    if (!token) return "rejected";
    try {
      lastValidateAtRef.current = Date.now();
      const res = await gatedFetch(`${API_BASE}/auth/session/validate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
      setAuthError(null);
      setUser({ email: data.email, name: data.name || "", owner: !!data.owner });
      resetUnauthorizedGate();
      return "ok";
    } catch {
      return "unreachable";
    }
  }

  useEffect(() => {
    async function init() {
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
        try {
          await resumePendingLogin(() => { void establishSession(); });
        } catch {
          /* never block start-up on this */
        }
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
        setChecking(false);
        return;
      }

      const profileP = api.getProfile().catch(() => null);

      lastValidateAtRef.current = Date.now();
      try {
        const res = await gatedFetch(`${API_BASE}/auth/session/validate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.email) {
            setUser({ email: data.email, name: data.name || "", owner: !!data.owner });
            // A124: a session confirmed good here can be revoked again
            // later, and lib/api.ts's own 401 gate only fires its
            // sign-out hook once per revoke — reopen it now so a LATER
            // revocation of THIS session is not silently swallowed by a
            // gate an earlier session's sign-out already closed.
            resetUnauthorizedGate();

            // F2: the OAuth consent page (/oauth/consent) stashes its own
            // `req` id in sessionStorage before sending the browser off to
            // Google, because the sign-in round trip always lands back on
            // this root path (backend's google_callback redirects to
            // `${APP_URL}/?token=...`, never back to /oauth/consent
            // itself). Once a session is confirmed here, restore that
            // detour rather than falling through to the normal app shell.
            if (urlToken) {
              try {
                const pendingOauthReq = sessionStorage.getItem("wd_oauth_consent_req");
                if (pendingOauthReq) {
                  sessionStorage.removeItem("wd_oauth_consent_req");
                  window.location.replace(`/oauth/consent?req=${encodeURIComponent(pendingOauthReq)}`);
                  return;
                }
              } catch {}
            }

            const profile = await profileP;
            if (profile && !profile.onboarding_complete) setNeedsOnboarding(true);
          } else {
            // Old PIN-format token — no email, force re-auth via Google
            clearToken();
          }
        } else {
          clearToken();
        }
      } catch {
        clearToken();
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
    return <LoginScreen error={authError} onSignedIn={establishSession} />;
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
