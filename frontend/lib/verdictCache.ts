import { api, type SpendVerdict } from "@/lib/api";

// ── Verdict cache (module level, per period offset) ──────────────────────────
// Shared between SpendPage.tsx (the Trends tab, full verdict) and
// PinnedWidgetCard in components/SpendTrends.tsx (the pace_curve home
// widget, pace_series only) so a visit to one never forces a second request
// the other already paid for. Same shape as the signals cache in
// SpendPage.tsx, for the same reason: a revisit should paint the last-known
// verdict immediately instead of a spinner at near-zero height.
//
// G83 (2026-09-18): `fetchVerdictData` now checks `cachedVerdict` itself
// before ever calling the network — previously it only deduped CONCURRENT
// calls (`verdictInflight`), so two calls a few seconds apart (HomePage's
// idle warm-up, then SpendPage.tsx's own mount effect) each hit the server
// even though the second one's data could not possibly have changed. The
// check lives HERE, in the one function every caller funnels through,
// rather than in each call site, so a future caller can't reintroduce the
// bug by forgetting to check freshness first (the exact shape of the G83
// bug: SpendPage.tsx's mount effect already read `cachedVerdict` to decide
// whether to paint instantly, but then called the fetcher unconditionally
// anyway "to revalidate" — which, given `cachedVerdict` only ever returns a
// hit that's already fresh, was never actually revalidating anything, only
// repeating the same request for no reason).
//
// VERDICT_TTL_MS is a CLIENT-side policy, not a mirror of a server window:
// the backend's own cache for GET /spend/verdict (app/services/response_
// cache.py) is version-pinned — exact invalidation the moment a write that
// could change the verdict lands (sync, category edit, dismiss, etc.) —
// with only a 6-HOUR safety bound behind that, not a short rolling TTL, so
// there is no server-side window to "match". 90 seconds is chosen purely
// for the client: long enough that a normal Home → Spend → Home lap (or a
// glance at /spend/shape and back) never pays for a second round trip, but
// short enough that a browser tab left open for several minutes still
// checks in periodically — the only way a change made in the background
// (another device, a worker-driven sync) with no explicit
// `invalidateVerdictCache()` call in THIS tab would ever be noticed.
export const VERDICT_TTL_MS = 90_000;
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
  const fresh = cachedVerdict(offset);
  if (fresh) return Promise.resolve(fresh);
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
