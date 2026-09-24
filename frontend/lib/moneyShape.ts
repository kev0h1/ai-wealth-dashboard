// Shared GET /money-shape loader — module-level cache + in-flight dedupe,
// moved out of components/SpendPatternsSummary.tsx (retired 2026-09-05, the
// Patterns view no longer renders the shape) so both the Spend period
// view's SpendShapeCard and /spend/shape's ShapePage can share one warm
// value for the rest of the browser session, deduping a concurrent request
// if both mount while the first one is still running.
//
// G83 (2026-09-18): `loadMoneyShape` used to have no freshness concept at
// all — every caller re-fetched unconditionally (`peekMoneyShape` was
// read-only, paint-from-cache-while-a-background-fetch-runs-anyway), so a
// Home → Spend → Home → Spend lap within the same minute hit GET
// /money-shape every single time even though nothing about the user's
// spending pattern could have changed that fast. Same fix shape as
// lib/verdictCache.ts's `fetchVerdictData`: a TTL-checked cache entry, read
// by `loadMoneyShape` itself before it ever calls the network, so callers
// (SpendPage.tsx, ShapePage.tsx) don't each need to remember to check
// freshness first. MONEY_SHAPE_TTL_MS reuses the same 90-second client-side
// policy as VERDICT_TTL_MS, for the same reason: the backend's own cache
// (app/services/money_shape.py:get_money_shape_cached) is a real 6-hour
// TTL, explicitly invalidated on the writes that actually change the shape
// (category-kind edits — see app/routers/categories.py), so there is no
// short server window to match; 90 seconds just covers a realistic
// within-session lap without going so long that a long-open tab stops
// checking in at all.
import { api, type MoneyShape } from "@/lib/api";

export const MONEY_SHAPE_TTL_MS = 90_000;
let cachedEntry: { data: MoneyShape; at: number } | null = null;
let inFlightMoneyShape: Promise<MoneyShape> | null = null;

function freshMoneyShape(): MoneyShape | null {
  return cachedEntry && Date.now() - cachedEntry.at < MONEY_SHAPE_TTL_MS ? cachedEntry.data : null;
}

export function loadMoneyShape(): Promise<MoneyShape> {
  const fresh = freshMoneyShape();
  if (fresh) return Promise.resolve(fresh);
  if (!inFlightMoneyShape) {
    inFlightMoneyShape = api.getMoneyShape()
      .then((shape) => {
        cachedEntry = { data: shape, at: Date.now() };
        return shape;
      })
      .finally(() => {
        inFlightMoneyShape = null;
      });
  }
  return inFlightMoneyShape;
}

/** The last successfully loaded shape, without triggering a fetch — for a
 *  warm initial render (SpendShapeCard's skeleton-avoidance, ShapePage's
 *  initial state) while a fresh value is (re)requested in the background.
 *  Deliberately NOT TTL-gated (unlike `loadMoneyShape`/`freshMoneyShape`):
 *  this is a synchronous "is there anything to paint immediately" read for
 *  first-render seeding, where even a stale value beats a skeleton for one
 *  frame — the follow-up `loadMoneyShape()` call every caller also makes is
 *  what corrects it, cheaply, once the TTL above has actually expired. */
export function peekMoneyShape(): MoneyShape | null {
  return cachedEntry?.data ?? null;
}

/** Drop the cached shape and any in-flight request — mirrors
 *  invalidateVerdictCache's role in components/AuthProvider.tsx's logout
 *  path, so a different user signing in on the same tab never paints the
 *  previous user's money shape for a moment before the refetch lands. */
export function invalidateMoneyShapeCache() {
  cachedEntry = null;
  inFlightMoneyShape = null;
}
