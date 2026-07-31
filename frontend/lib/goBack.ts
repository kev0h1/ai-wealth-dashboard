import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Safe back navigation: uses router.back() when history exists,
 * falls back to router.push(fallback) when the page was deep-linked
 * directly (no browser history).
 */
export function goBack(router: AppRouterInstance, fallback = "/"): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
  } else {
    router.push(fallback);
  }
}
