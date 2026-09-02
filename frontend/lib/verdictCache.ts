import { api, SpendVerdict } from "@/lib/api";

// ── Verdict cache (module level, per period offset) ──────────────────────────
// Shared between SpendPage.tsx (the Trends tab, full verdict) and
// PinnedWidgetCard in components/SpendTrends.tsx (the pace_curve home
// widget, pace_series only) so a visit to one never forces a second request
// the other already paid for. Same shape as the signals cache in
// SpendPage.tsx, for the same reason: a revisit should paint the last-known
// verdict immediately instead of a spinner at near-zero height. Unlike
// signals, every read here also kicks off a silent revalidation against the
// server so a stale cached verdict never lingers past one paint.
export const VERDICT_TTL_MS = 90_000; // matches the server's own /spend/verdict cache window
const verdictCache = new Map<number, { data: SpendVerdict; at: number }>();
const verdictInflight = new Map<number, Promise<SpendVerdict>>();

export function invalidateVerdictCache() {
  verdictCache.clear();
  verdictInflight.clear();
}

export function cachedVerdict(offset: number): SpendVerdict | null {
  const hit = verdictCache.get(offset);
  return hit && Date.now() - hit.at < VERDICT_TTL_MS ? hit.data : null;
}

export function fetchVerdictData(offset: number): Promise<SpendVerdict> {
  const pending = verdictInflight.get(offset);
  if (pending) return pending;
  const p = api.spendVerdict(offset)
    .then(v => {
      verdictCache.set(offset, { data: v, at: Date.now() });
      return v;
    })
    .finally(() => { verdictInflight.delete(offset); });
  verdictInflight.set(offset, p);
  return p;
}
