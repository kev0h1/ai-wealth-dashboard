import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { CATEGORY_COLOURS, CATEGORY_ICONS, DEFAULT_CUSTOM_COLOUR } from "@/lib/shared";
import { api } from "@/lib/api";

const BUILTIN_CATEGORIES = Object.keys(CATEGORY_COLOURS);

interface CatsCtx {
  allCategories: string[];
  customCategories: string[];
  addCategory: (name: string) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;
  isCustom: (name: string) => boolean;
  defaultColour: (name: string) => string;
  defaultIcon: (name: string) => string;
}

const Ctx = createContext<CatsCtx>({
  allCategories: BUILTIN_CATEGORIES,
  customCategories: [],
  addCategory: async () => {},
  deleteCategory: async () => {},
  isCustom: () => false,
  defaultColour: (n) => CATEGORY_COLOURS[n] ?? DEFAULT_CUSTOM_COLOUR,
  defaultIcon: (n) => CATEGORY_ICONS[n] ?? "📦",
});

export function CategoriesProvider({ children }: { children: React.ReactNode }) {
  const [allCategories, setAll] = useState<string[]>(BUILTIN_CATEGORIES);
  const [customCategories, setCustom] = useState<string[]>([]);

  useEffect(() => {
    api.getCategories()
      .then(({ all, custom }) => { setAll(all); setCustom(custom); })
      .catch(() => {});
  }, []);

  const addCategory = useCallback(async (name: string) => {
    const result = await api.addCategory(name);
    setAll(result.all);
    setCustom(result.custom);
  }, []);

  const deleteCategory = useCallback(async (name: string) => {
    await api.deleteCategory(name);
    setAll((prev) => prev.filter((c) => c !== name));
    setCustom((prev) => prev.filter((c) => c !== name));
  }, []);

  const isCustom = useCallback((name: string) => customCategories.includes(name), [customCategories]);
  const defaultColour = useCallback((name: string) => CATEGORY_COLOURS[name] ?? DEFAULT_CUSTOM_COLOUR, []);
  const defaultIcon = useCallback((name: string) => CATEGORY_ICONS[name] ?? "📦", []);

  return (
    <Ctx.Provider value={{ allCategories, customCategories, addCategory, deleteCategory, isCustom, defaultColour, defaultIcon }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCategories() { return useContext(Ctx); }
