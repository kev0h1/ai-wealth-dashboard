// G83 fix-round (2026-09-18 review): the write-plus-invalidate body of
// CategoriesContext.tsx's addCategory/deleteCategory, pulled out into a
// framework-free pair of functions — same reason lib/preferenceSave.ts and
// lib/preferencesSnapshot.ts exist rather than leaving this logic inline in
// a React component: a plain Node script (scripts/category-mutations.
// test.mjs) can import the REAL functions and prove the exact regression
// (a category-kind edit leaving the verdict/money-shape caches serving
// their pre-edit value) fails on the old code and passes on the new,
// without a React renderer in this repo's test toolchain.
//
// A category add/delete is the ONLY client-side action that changes a
// category's KIND (add is also the idempotent "update an existing custom
// category's kind" path — see backend/app/routers/categories.py's
// add_category), and kind is what both /money-shape's fixed/committed/free
// split and /spend/verdict's notable/majority/unresolved split are built
// from (the backend's own _invalidate_kind_caches unsets money_shape_cache_
// col's computed_at and calls response_cache.invalidate, which covers
// spend_verdict's cache too, on exactly these two calls and no others).
import { api, type CategoriesResponse, type CategoryKind as ApiCategoryKind } from "@/lib/api";
import type { CategoryKind } from "@/lib/categories";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { invalidateMoneyShapeCache } from "@/lib/moneyShape";

export async function addCategoryAndInvalidate(
  name: string,
  kind?: CategoryKind,
): Promise<CategoriesResponse> {
  const result = await api.addCategory(name, kind);
  invalidateMoneyShapeCache();
  invalidateVerdictCache();
  return result;
}

export async function deleteCategoryAndInvalidate(name: string): Promise<{ deleted: string }> {
  const result = await api.deleteCategory(name);
  invalidateMoneyShapeCache();
  invalidateVerdictCache();
  return result;
}

// Re-exported purely so callers/tests that only need the type don't have to
// know it actually lives on lib/api.ts under a different name.
export type { ApiCategoryKind };
