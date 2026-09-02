import { api, CategorySignal } from "@/lib/api";

// ── Category-signal cache (module level, per period offset) ──────────────────
// Lives here (rather than inline in SpendPage.tsx) so it can be invalidated
// from outside the Spend route — e.g. AuthProvider's logout(), which must
// clear every module-scope cache holding the previous user's figures before
// a different user signs in on the same tab. Same shape/reasoning as
// lib/verdictCache.ts, which made the same move for the same reason.
//
// The tiles themselves render from `useAllTransactions`, which is memoised
// for 60s — so on a revisit or a period swipe the amounts paint instantly
// while a freshly-fetched multiple lands a round trip later. That gap is the
// whole "× usual appears late" symptom. Mirroring the transactions cache
// (same TTL, same in-flight dedupe) closes it: a period we have already
// read is instant. Any mutation that can move a multiple clears this cache
// explicitly.
export type SignalMap = Record<string, CategorySignal>;
const SIGNALS_TTL_MS = 60_000;
const signalsCache = new Map<number, { data: SignalMap; at: number }>();
const signalsInflight = new Map<number, Promise<SignalMap>>();

export function invalidateSignalsCache() {
  signalsCache.clear();
  signalsInflight.clear();
}

export function cachedSignals(offset: number): SignalMap | null {
  const hit = signalsCache.get(offset);
  return hit && Date.now() - hit.at < SIGNALS_TTL_MS ? hit.data : null;
}

export function fetchSignals(offset: number, force = false): Promise<SignalMap> {
  if (!force) {
    const hit = cachedSignals(offset);
    if (hit) return Promise.resolve(hit);
    const pending = signalsInflight.get(offset);
    if (pending) return pending;
  }
  const p = api.categorySignals(offset)
    .then(d => {
      const data = d.signals ?? {};
      signalsCache.set(offset, { data, at: Date.now() });
      return data;
    })
    .finally(() => { signalsInflight.delete(offset); });
  signalsInflight.set(offset, p);
  return p;
}
