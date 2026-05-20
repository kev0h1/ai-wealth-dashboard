"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { CATEGORIES, CATEGORY_COLOURS } from "@/lib/categories";
import { api } from "@/lib/api";

interface CatsCtx {
  allCategories: string[];
  customCategories: string[];
  addCategory: (name: string) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;
  isCustom: (name: string) => boolean;
  defaultColour: (name: string) => string;
}

const Ctx = createContext<CatsCtx>({
  allCategories: [...CATEGORIES],
  customCategories: [],
  addCategory: async () => {},
  deleteCategory: async () => {},
  isCustom: () => false,
  defaultColour: (n) => CATEGORY_COLOURS[n] ?? CATEGORY_COLOURS.Other,
});

const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [allCategories, setAll] = useState<string[]>([...CATEGORIES]);
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
    setAll(prev => prev.filter(c => c !== name));
    setCustom(prev => prev.filter(c => c !== name));
  }, []);

  const isCustom = useCallback((name: string) => customCategories.includes(name), [customCategories]);
  const defaultColour = useCallback((name: string) => CATEGORY_COLOURS[name] ?? DEFAULT_CUSTOM_COLOUR, []);

  return (
    <Ctx.Provider value={{ allCategories, customCategories, addCategory, deleteCategory, isCustom, defaultColour }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCategories() { return useContext(Ctx); }
