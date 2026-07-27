import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

const THEME_KEY = "theme_dark";

interface ThemeContextValue {
  dark: boolean;
  setDark: (d: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  dark: false,
  setDark: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDarkState] = useState(false);

  // Hydrate from SecureStore on mount (default light)
  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY)
      .then((val) => {
        if (val === "1") setDarkState(true);
      })
      .catch(() => {});
  }, []);

  const setDark = (d: boolean) => {
    setDarkState(d);
    SecureStore.setItemAsync(THEME_KEY, d ? "1" : "0").catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ dark, setDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
