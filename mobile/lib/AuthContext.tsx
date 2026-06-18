import { createContext, useContext } from "react";

export interface AuthUser {
  name: string;
  email: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
