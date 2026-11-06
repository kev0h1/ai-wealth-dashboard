// G425: per-endpoint client cache with a short TTL, in-flight de-duplication
// and stale-while-revalidate. Extends the accountsCache / homeCache pattern
// (module-level value + inflight promise + TTL) to the GETs that every tab
// change used to refire (today, safe-to-spend, cashflow, profile, offers,
// sync/status, recent transactions, investment accounts, spotlight,
// subscription, miscategorised count).
//
// Rules, per DESIGN.md's no-flip and no visibility-gating doctrine:
//   - A fresh entry (younger than its TTL) is served as-is with no request.
//   - A stale entry is served immediately and revalidated in the background;
//     the view is replaced (onUpdate) ONLY when the payload actually changed,
//     so a cached payload never flashes a loading state and then the same data.
//   - `force` (pull-to-refresh, the sync button, retries) always refetches.
//   - Money payloads live in module memory only, never localStorage, and are
//     dropped by invalidateAllEndpoints() on sign-out and user change (wired
//     through lib/accountMutations.ts's invalidateAllAccountData()).
//
// No imports on purpose: scripts/endpoint-cache.test.mjs loads this module
// directly under Node's --experimental-strip-types.

export type EndpointOptions<T> = {
  /** Time a payload counts as fresh. Defaults to DEFAULT_ENDPOINT_TTL_MS. */
  ttlMs?: number;
  /** Always refetch (still de-duplicated against a concurrent call). */
  force?: boolean;
  /** Called with revalidated data, only when it differs from what was served. */
  onUpdate?: (data: T) => void;
};

export const DEFAULT_ENDPOINT_TTL_MS = 60_000;

type Entry = { data: unknown; at: number; json: string };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
// Bumped by every invalidation so a response that was in flight when the data
// changed is never stored (it was computed against the old state).
let generation = 0;
let now: () => number = () => Date.now();

/** Test hook: swap the clock. */
export function __setEndpointClock(fn: (() => number) | null): void {
  now = fn ?? (() => Date.now());
}

function serialise(data: unknown): string {
  try { return JSON.stringify(data) ?? ""; } catch { return ""; }
}

function fetchAndStore<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const startedAt = generation;
  const p = fetcher()
    .then((data) => {
      if (startedAt === generation) {
        entries.set(key, { data, at: now(), json: serialise(data) });
      }
      return data;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** The cached payload for `key` regardless of age, or undefined. Use it to
 *  seed initial component state so a remount paints without a skeleton. */
export function peekEndpoint<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined;
}

/** True when `key` has an entry younger than `ttlMs`. */
export function isEndpointFresh(key: string, ttlMs = DEFAULT_ENDPOINT_TTL_MS): boolean {
  const e = entries.get(key);
  return !!e && now() - e.at < ttlMs;
}

/** Read-through with stale-while-revalidate. Resolves with the cached payload
 *  when there is one (fresh or stale), otherwise with the network result. */
export function cachedEndpoint<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: EndpointOptions<T> = {},
): Promise<T> {
  const ttl = options.ttlMs ?? DEFAULT_ENDPOINT_TTL_MS;
  if (options.force) return fetchAndStore(key, fetcher);
  const hit = entries.get(key);
  if (hit) {
    if (now() - hit.at < ttl) return Promise.resolve(hit.data as T);
    // Stale: serve now, revalidate quietly, replace only on change.
    const servedJson = hit.json;
    void fetchAndStore(key, fetcher)
      .then((fresh) => {
        if (serialise(fresh) !== servedJson) options.onUpdate?.(fresh);
      })
      .catch(() => { /* keep serving the stale payload */ });
    return Promise.resolve(hit.data as T);
  }
  return fetchAndStore(key, fetcher);
}

/** Drop one key (or several). */
export function invalidateEndpoint(...keys: string[]): void {
  generation++;
  for (const k of keys) { entries.delete(k); inflight.delete(k); }
}

/** Drop every key. Sign-out, user change and account mutations call this. */
export function invalidateAllEndpoints(): void {
  generation++;
  entries.clear();
  inflight.clear();
}

/** Keys per invalidation trigger. "all" drops everything. */
export type EndpointInvalidationMap = Record<string, string[] | "all">;

/** Subscribe `target` events to cache invalidation. Returns an unsubscribe. */
export function bindEndpointInvalidation(target: EventTarget, map: EndpointInvalidationMap): () => void {
  const handlers: [string, () => void][] = Object.entries(map).map(([event, keys]) => [
    event,
    () => { if (keys === "all") invalidateAllEndpoints(); else invalidateEndpoint(...keys); },
  ]);
  for (const [event, handler] of handlers) target.addEventListener(event, handler);
  return () => { for (const [event, handler] of handlers) target.removeEventListener(event, handler); };
}

// ── Endpoint registry ───────────────────────────────────────────────────────
// One place for every cached endpoint's key and TTL.
export const ENDPOINT = {
  today: { key: "today", ttlMs: 60_000 },
  safeToSpend: { key: "safe-to-spend", ttlMs: 60_000 },
  cashflow: { key: "cashflow", ttlMs: 60_000 },
  profile: { key: "profile", ttlMs: 60_000 },
  offers: { key: "offers", ttlMs: 60_000 },
  syncStatus: { key: "sync-status", ttlMs: 15_000 },
  recentTransactions: { key: "transactions-search-recent", ttlMs: 60_000 },
  investmentAccounts: { key: "investment-accounts", ttlMs: 60_000 },
  spotlight: { key: "savings-insights-spotlight", ttlMs: 60_000 },
  subscription: { key: "subscription", ttlMs: 60_000 },
  connections: { key: "connections", ttlMs: 60_000 },
} as const;

/** Money keys: everything except identity-only payloads. */
const MONEY_KEYS = Object.values(ENDPOINT)
  .map((e) => e.key)
  .filter((k) => k !== ENDPOINT.profile.key && k !== ENDPOINT.subscription.key);

export const TRANSACTIONS_CHANGED_KEYS = MONEY_KEYS;
