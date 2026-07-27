import React, { createContext, useContext, useEffect, useState } from "react";
import { getToken, saveToken, deleteToken } from "./storage";

export interface AuthContextValue {
  token: string | null;
  setToken: (token: string) => Promise<void>;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  setToken: async () => {},
  isLoading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getToken()
      .then((t) => setTokenState(t))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setToken = async (newToken: string) => {
    await saveToken(newToken);
    setTokenState(newToken);
  };

  const signOut = async () => {
    await deleteToken();
    setTokenState(null);
  };

  return (
    <AuthContext.Provider value={{ token, setToken, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
