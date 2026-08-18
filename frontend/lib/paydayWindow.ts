// Shared "payday window" rule — the single source of truth for when the
// Home payday-plan entry affordance (and the nav's Penny attention dot)
// should be considered "timely" enough to surface without being asked.
// Pure function (no fetching) so components with different data-loading
// shapes — HomeBrief/PaydayPlanSection (already has safeToSpend/companion
// items as props) and BottomNav (fetches its own lightweight copy) — share
// one rule instead of drifting.
//
// Window = last 5 days BEFORE the pay period ends (1..5, exclusive of day 0)
// OR whenever a live payday_plan companion item already exists (the engine's
// own execution-window decision — see backend/app/services/companion.py, the
// `payday_window` branch, which emits the live plan for days_into_period <=
// 3 of the NEW period). Day 0 of `days_until_payday` is that new period's
// first day, not "before" it — backend period_end = next_payday - 1 — so
// day 0 is deliberately excluded from the entry-row window; it's already
// covered by `hasLivePlan` once the engine has actually produced the plan.
// Outside both: nothing on Home (the plan's permanent home is the Penny
// screen, where it's always visible).
export function isPaydayWindowActive(opts: {
  hasLivePlan: boolean;
  /** SafeToSpend's `days_until_payday` when status === "ok"; null/undefined otherwise. */
  daysUntilPayday: number | null | undefined;
}): boolean {
  if (opts.hasLivePlan) return true;
  if (opts.daysUntilPayday == null) return false;
  return opts.daysUntilPayday >= 1 && opts.daysUntilPayday <= 5;
}

// localStorage key for the nav's Penny-dot cache (BottomNav.tsx) — exported
// so the write-through helper below and the hook's own read use the exact
// same key instead of two hardcoded string literals drifting apart.
export const PAYDAY_DOT_CACHE_KEY = "wd_penny_dot";

/**
 * Write-through cache for the Penny nav dot. Pages that already fetch
 * safeToSpend + today for their own purposes (Home's brief, the Penny
 * screen itself) call this once their data resolves, so BottomNav's own
 * `usePaydayWindowActive` hook can read a fresh value instead of firing a
 * redundant copy of the same two requests — on those two pages the hook
 * skips its self-fetch entirely (see BottomNav.tsx), relying wholly on this
 * write; on every other page it's a plain freshness cache (5-minute TTL,
 * matching the hook's own read), cutting repeat fetches across navigation
 * without any prop-drilling or new shared context.
 */
export function writePaydayDotCache(active: boolean): void {
  try {
    localStorage.setItem(PAYDAY_DOT_CACHE_KEY, JSON.stringify({ v: active, at: Date.now() }));
  } catch {}
}
