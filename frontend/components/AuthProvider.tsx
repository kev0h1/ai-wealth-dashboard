"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getToken, setToken, clearToken } from "@/lib/auth";
import { api, API_BASE } from "@/lib/api";
import LoginScreen from "@/components/LoginScreen";
import Onboarding from "@/components/Onboarding";

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
        setAuthError(errParam === "unauthorized" ? "Access denied — this account is not authorised." : "Sign-in failed. Please try again.");
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
  }

  // /design/* pages are static mockups with zero user data — always public.
  if (pathname?.startsWith("/design")) {
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
