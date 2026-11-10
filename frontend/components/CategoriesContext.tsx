"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { CATEGORIES, getCategoryColour, type CategoryKind } from "@/lib/categories";
import { api, type CategoriesResponse, type CategoryKind as ApiCategoryKind } from "@/lib/api";
import { addCategoryAndInvalidate, deleteCategoryAndInvalidate } from "@/lib/categoryMutations";
import { useAuth } from "@/components/AuthProvider";

interface CatsCtx {
  allCategories: string[];
  customCategories: string[];
  /** Kind for every category, built-in and custom — from GET /categories. */
  kinds: Record<string, ApiCategoryKind>;
  icons: Record<string, string>;
  iconSources: Record<string, "auto" | "user">;
  categoriesReady: boolean;
  categoriesError: string | null;
  refreshCategories: () => Promise<void>;
  addCategory: (name: string, kind?: CategoryKind, iconKey?: string) => Promise<void>;
  saveCategoryIcon: (name: string, iconKey: string | null) => Promise<void>;
  deleteCategory: (name: string) => Promise<void>;
  isCustom: (name: string) => boolean;
  defaultColour: (name: string) => string;
}

const Ctx = createContext<CatsCtx>({
  allCategories: [...CATEGORIES],
  customCategories: [],
  kinds: {},
  icons: {},
  iconSources: {},
  categoriesReady: false,
  categoriesError: null,
  refreshCategories: async () => {},
  addCategory: async () => {},
  saveCategoryIcon: async () => {},
  deleteCategory: async () => {},
  isCustom: () => false,
  defaultColour: (n) => getCategoryColour(n),
});

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <CategoryState key={user?.email ?? "anonymous"}>{children}</CategoryState>;
}

function CategoryState({ children }: { children: ReactNode }) {
  const [allCategories, setAll] = useState<string[]>([...CATEGORIES]);
  const [customCategories, setCustom] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Record<string, ApiCategoryKind>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [iconSources, setIconSources] = useState<Record<string, "auto" | "user">>({});
  const [categoriesReady, setReady] = useState(false);
  const [categoriesError, setError] = useState<string | null>(null);
  const readEpoch = useRef(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readEpoch.current += 1; };
  }, []);

  const accept = useCallback((result: CategoriesResponse) => {
    if (!mounted.current) return;
    setAll(result.all); setCustom(result.custom); setKinds(result.kinds);
    setIcons(result.icons ?? {}); setIconSources(result.icon_sources ?? {});
    setReady(true); setError(null);
  }, []);

  // Sequence this provider's writes; invalidate in-flight reads both before
  // and after a save, so a late pre-save GET cannot restore an old icon.
  const enqueue = useCallback((write: () => Promise<void>) => {
    const next = writes.current.catch(() => {}).then(async () => {
      if (!mounted.current) throw new Error("Your account changed. Open the category again to save its icon.");
      readEpoch.current += 1;
      try { await write(); } finally { readEpoch.current += 1; }
    });
    writes.current = next.catch(() => {});
    return next;
  }, []);

  const refreshCategories = useCallback(async () => {
    await writes.current;
    if (!mounted.current) throw new Error("Your account changed. Open the category again.");
    const epoch = ++readEpoch.current;
    try {
      const result = await api.getCategories();
      if (epoch === readEpoch.current) accept(result);
    } catch (error) {
      if (epoch === readEpoch.current) setError("Your categories could not be loaded. Try again.");
      throw error;
    }
  }, [accept]);
  useEffect(() => {
    let live = true;
    const epoch = ++readEpoch.current;
    api.getCategories().then(result => {
      if (live && epoch === readEpoch.current) accept(result);
    }).catch(() => {
      if (live && epoch === readEpoch.current) setError("Your categories could not be loaded. Try again.");
    });
    return () => { live = false; };
  }, [accept]);

  // G83 fix-round (2026-09-18 review): the write-plus-invalidate logic
  // lives in lib/categoryMutations.ts (a category add/delete is the ONLY
  // client-side action that can change a category's KIND, and kind is what
  // both /money-shape and /spend/verdict are built from — see that
  // module's own docstring), not inline here, so scripts/category-
  // mutations.test.mjs can import and exercise the REAL functions a plain
  // Node script — this was the exact gap the review caught (money-shape
  // had no invalidating caller at all beyond logout).
  const addCategory = useCallback((name: string, kind?: CategoryKind, iconKey?: string) => enqueue(async () => {
    accept(await addCategoryAndInvalidate(name, kind, iconKey));
  }), [accept, enqueue]);

  const saveCategoryIcon = useCallback((name: string, iconKey: string | null) => enqueue(async () => {
    // Appearance alone never invalidates or recomputes financial forecasts.
    accept(await api.saveCategoryIcon(name, iconKey));
  }), [accept, enqueue]);

  const deleteCategory = useCallback((name: string) => enqueue(async () => {
    await deleteCategoryAndInvalidate(name);
    setAll(prev => prev.filter(c => c !== name));
    setCustom(prev => prev.filter(c => c !== name));
    const without = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== name));
    setKinds(without); setIcons(without); setIconSources(without);
  }), [enqueue]);

  const isCustom = useCallback((name: string) => customCategories.some(category => category.trim().toLowerCase() === name.trim().toLowerCase()), [customCategories]);
  // Canonical colour resolution — custom categories fall back to the shared
  // indigo, NOT to Other's grey (see lib/categories.ts:getCategoryColour).
  const defaultColour = useCallback((name: string) => getCategoryColour(name), []);

  return (
    <Ctx.Provider value={{ allCategories, customCategories, kinds, icons, iconSources, categoriesReady, categoriesError, refreshCategories, addCategory, saveCategoryIcon, deleteCategory, isCustom, defaultColour }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCategories() { return useContext(Ctx); }
