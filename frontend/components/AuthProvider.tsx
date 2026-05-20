"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getToken, setToken, clearToken } from "@/lib/auth";
import LoginScreen from "@/components/LoginScreen";

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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

      try {
        const res = await fetch("/api/auth/session/validate", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.email) {
            setUser({ email: data.email, name: data.name || "" });
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

  if (checking) {
    return <div className="min-h-dvh bg-[#f0f2f7]" />;
  }

  if (!user) {
    return <LoginScreen error={authError} />;
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
