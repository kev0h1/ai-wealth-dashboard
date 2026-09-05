// Shared GET /money-shape loader — module-level cache + in-flight dedupe,
// moved out of components/SpendPatternsSummary.tsx (retired 2026-09-05, the
// Patterns view no longer renders the shape) so both the Spend period
// view's SpendShapeCard and /spend/shape's ShapePage can share one warm
// value for the rest of the browser session, deduping a concurrent request
// if both mount while the first one is still running.
import { api, type MoneyShape } from "@/lib/api";

let cachedMoneyShape: MoneyShape | null = null;
let inFlightMoneyShape: Promise<MoneyShape> | null = null;

export function loadMoneyShape(): Promise<MoneyShape> {
  if (!inFlightMoneyShape) {
    inFlightMoneyShape = api.getMoneyShape()
      .then((shape) => {
        cachedMoneyShape = shape;
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
 *  initial state) while a fresh value is (re)requested in the background. */
export function peekMoneyShape(): MoneyShape | null {
  return cachedMoneyShape;
}
