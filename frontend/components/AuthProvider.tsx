"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getToken, setToken, clearToken } from "@/lib/auth";
import { api, API_BASE } from "@/lib/api";
import LoginScreen from "@/components/LoginScreen";
import Onboarding from "@/components/Onboarding";
import { invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { clearHomeCache } from "@/lib/homeCache";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { invalidateSignalsCache } from "@/lib/signalsCache";
import { clearHomeDismissedAdvice } from "@/lib/homeDismissedAdvice";
import { PAYDAY_DOT_CACHE_KEY } from "@/lib/paydayWindow";

interface AuthUser {
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({ user: null, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    async function init() {
      // Pick up token from Google OAuth redirect
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      const errParam = params.get("error");

      if (urlToken) {
        setToken(urlToken);
        params.delete("token");
      }
      if (errParam) {
        setAuthError(errParam === "unauthorized" ? "Access denied, this account is not authorised." : "Sign-in failed. Please try again.");
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

      try {
        const res = await fetch(`${API_BASE}/auth/session/validate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.email) {
            setUser({ email: data.email, name: data.name || "" });
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

  function logout() {
    clearToken();
    setUser(null);

    // Clear every module-scope cache that holds the previous user's
    // financial data, so a different user signing in on the same tab never
    // gets a moment of the old user's figures painting before the refetch
    // lands. See each cache's own file for what it holds and why it exists.
    invalidateTransactionsCache();
    clearHomeCache();
    invalidateVerdictCache();
    invalidateSignalsCache();

    // Same reasoning for user-scoped localStorage entries that aren't
    // covered by an in-memory cache above. Left untouched: device-scoped
    // preferences (theme, biometric lock, colour/icon customisation),
    // one-shot self-clearing sessionStorage flags, and tutorial/tour
    // "seen" flags — none of these carry financial figures. See the
    // logout audit for the full list and reasoning.
    try {
      localStorage.removeItem("reconnect_expected"); // holds a real account number + sort code
      localStorage.removeItem("wd_bracket"); // income tax bracket
      localStorage.removeItem(PAYDAY_DOT_CACHE_KEY); // payday-window boolean derived from the user's pay period
      localStorage.removeItem("wd_insight_badge"); // count derived from the user's insights
      localStorage.removeItem("wd_spend_badge"); // count derived from the user's spend
      localStorage.removeItem("tax_checklist_done"); // per-user tax checklist progress
    } catch {}
    clearHomeDismissedAdvice();
  }

  // /design/* pages are static mockups with zero user data — always public.
  // /terms and /privacy are the published legal documents — anonymous
  // visitors and regulators need to read them without signing in.
  if (pathname?.startsWith("/design") || pathname === "/terms" || pathname === "/privacy") {
    return <>{children}</>;
  }

  if (checking) {
    return <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />;
  }

  if (!user) {
    return <LoginScreen error={authError} />;
  }

  if (needsOnboarding) {
    return <Onboarding defaultName={user.name} onComplete={() => setNeedsOnboarding(false)} />;
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
