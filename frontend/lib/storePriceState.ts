// G294: what the plan picker may say about a store price. A store call that
// succeeds but omits the selected product must read as unavailable, never as
// "loading", otherwise an inactive or not-yet-propagated product looks like a
// hang. Kept pure (no plugin, no DOM) so it is unit-testable.
import { api } from "@/lib/api";

export type StoreLoadState = "idle" | "loading" | "ready" | "failed";
export type StorePriceState = "loading" | "unavailable" | "ready";

export function storePriceState(state: StoreLoadState, hasView: boolean): StorePriceState {
  if (hasView) return "ready";
  return state === "ready" || state === "failed" ? "unavailable" : "loading";
}

/** One diagnostic line: which product ids were asked for and which came back.
 *  Product ids are not secrets; no prices, tokens or user details go in. */
export function describeProductLookup(requested: string[], returned: string[]): string {
  const back = new Set(returned);
  const missing = requested.filter((id) => !back.has(id));
  return `requested=[${requested.join(",")}] returned=[${returned.join(",")}] missing=${missing.length}`;
}

/** The class/name of an error, never its message body. */
export function errorKind(err: unknown): string {
  if (err instanceof Error) return err.name || err.constructor?.name || "Error";
  return typeof err;
}

/** Best effort: reports to /push/client-diagnostic and never throws. */
export function reportStoreDiagnostic(stage: string, detail: string, platform: "android" | "ios"): void {
  try {
    api.reportPushDiagnostic(stage, detail, platform).catch(() => { /* best effort */ });
  } catch { /* best effort */ }
}
