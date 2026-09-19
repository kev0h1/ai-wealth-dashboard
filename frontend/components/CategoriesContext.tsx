"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { CATEGORIES, getCategoryColour, type CategoryKind } from "@/lib/categories";
import { api, type CategoryKind as ApiCategoryKind } from "@/lib/api";
import { addCategoryAndInvalidate, deleteCategoryAndInvalidate } from "@/lib/categoryMutations";

interface CatsCtx {
  allCategories: string[];
  customCategories: string[];
  /** Kind for every category, built-in and custom — from GET /categories. */
  kinds: Record<string, ApiCategoryKind>;
  addCategory: (name: string, kind?: CategoryKind) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;
  isCustom: (name: string) => boolean;
  defaultColour: (name: string) => string;
}

const Ctx = createContext<CatsCtx>({
  allCategories: [...CATEGORIES],
  customCategories: [],
  kinds: {},
  addCategory: async () => {},
  deleteCategory: async () => {},
  isCustom: () => false,
  defaultColour: (n) => getCategoryColour(n),
});

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [allCategories, setAll] = useState<string[]>([...CATEGORIES]);
  const [customCategories, setCustom] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Record<string, ApiCategoryKind>>({});

  useEffect(() => {
    api.getCategories()
      .then(({ all, custom, kinds }) => { setAll(all); setCustom(custom); setKinds(kinds); })
      .catch(() => {});
  }, []);

  // G83 fix-round (2026-09-18 review): the write-plus-invalidate logic
  // lives in lib/categoryMutations.ts (a category add/delete is the ONLY
  // client-side action that can change a category's KIND, and kind is what
  // both /money-shape and /spend/verdict are built from — see that
  // module's own docstring), not inline here, so scripts/category-
  // mutations.test.mjs can import and exercise the REAL functions a plain
  // Node script — this was the exact gap the review caught (money-shape
  // had no invalidating caller at all beyond logout).
  const addCategory = useCallback(async (name: string, kind?: CategoryKind) => {
    const result = await addCategoryAndInvalidate(name, kind);
    setAll(result.all);
    setCustom(result.custom);
    setKinds(result.kinds);
  }, []);

  const deleteCategory = useCallback(async (name: string) => {
    await deleteCategoryAndInvalidate(name);
    setAll(prev => prev.filter(c => c !== name));
    setCustom(prev => prev.filter(c => c !== name));
  }, []);

  const isCustom = useCallback((name: string) => customCategories.includes(name), [customCategories]);
  // Canonical colour resolution — custom categories fall back to the shared
  // indigo, NOT to Other's grey (see lib/categories.ts:getCategoryColour).
  const defaultColour = useCallback((name: string) => getCategoryColour(name), []);

  return (
    <Ctx.Provider value={{ allCategories, customCategories, kinds, addCategory, deleteCategory, isCustom, defaultColour }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCategories() { return useContext(Ctx); }
