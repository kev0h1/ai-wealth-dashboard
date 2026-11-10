"use client";

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { loadIcons, persistIcon, clearIcon } from "@/lib/iconStore";
import { CATEGORIES } from "@/lib/categories";
import { normaliseIconKey } from "@/lib/categoryIcons";
import { useCategories } from "@/components/CategoriesContext";

interface IconContextValue {
  icons: Record<string, string>; // category → ICON_LIBRARY key overrides
  setIcon: (cat: string, icon: string) => Promise<void>;
  resetIcon: (cat: string) => Promise<void>;
}

const IconContext = createContext<IconContextValue>({
  icons: {},
  setIcon: async () => {},
  resetIcon: async () => {},
});

export function useCategoryIcons() {
  return useContext(IconContext);
}

export function IconProvider({ children }: { children: React.ReactNode }) {
  const { icons: saved, isCustom, saveCategoryIcon } = useCategories();
  const [legacy, setLegacy] = useState<Record<string, string>>({});

  useEffect(() => {
    // The old store has no account identity. Retain only built-in device
    // choices; never upload or reuse unattributable custom choices for a
    // different signed-in account. Account-saved customs are authoritative.
    queueMicrotask(() => setLegacy(Object.fromEntries(Object.entries(loadIcons()).flatMap(([name, key]) => {
      const canonical = normaliseIconKey(key);
      return CATEGORIES.some(category => category === name) && canonical ? [[name, canonical]] : [];
    }))));
  }, []);

  const icons = useMemo(() => ({ ...saved, ...legacy }), [saved, legacy]);

  const setIcon = useCallback(async (cat: string, icon: string) => {
    const canonical = normaliseIconKey(icon);
    if (!canonical) throw new Error("Choose an icon from the list.");
    if (isCustom(cat)) { await saveCategoryIcon(cat, canonical); return; }
    if (!CATEGORIES.some(name => name === cat)) throw new Error("This category is no longer available.");
    persistIcon(cat, canonical);
    setLegacy(prev => ({ ...prev, [cat]: canonical }));
  }, [isCustom, saveCategoryIcon]);

  const resetIcon = useCallback(async (cat: string) => {
    if (isCustom(cat)) { await saveCategoryIcon(cat, null); return; }
    clearIcon(cat);
    setLegacy(prev => {
      const next = { ...prev };
      delete next[cat];
      return next;
    });
  }, [isCustom, saveCategoryIcon]);

  return (
    <IconContext.Provider value={{ icons, setIcon, resetIcon }}>
      {children}
    </IconContext.Provider>
  );
}
