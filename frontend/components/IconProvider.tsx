"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadIcons, persistIcon, clearIcon } from "@/lib/iconStore";

interface IconContextValue {
  icons: Record<string, string>; // category → ICON_LIBRARY key overrides
  setIcon: (cat: string, icon: string) => void;
  resetIcon: (cat: string) => void;
}

const IconContext = createContext<IconContextValue>({
  icons: {},
  setIcon: () => {},
  resetIcon: () => {},
});

export function useCategoryIcons() {
  return useContext(IconContext);
}

export function IconProvider({ children }: { children: React.ReactNode }) {
  const [icons, setIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    setIcons(loadIcons());
  }, []);

  const setIcon = useCallback((cat: string, icon: string) => {
    persistIcon(cat, icon);
    setIcons(prev => ({ ...prev, [cat]: icon }));
  }, []);

  const resetIcon = useCallback((cat: string) => {
    clearIcon(cat);
    setIcons(prev => {
      const next = { ...prev };
      delete next[cat];
      return next;
    });
  }, []);

  return (
    <IconContext.Provider value={{ icons, setIcon, resetIcon }}>
      {children}
    </IconContext.Provider>
  );
}
