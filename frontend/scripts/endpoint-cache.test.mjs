// G425: plain-Node test for lib/endpointCache.ts and lib/miscategorisedCount.ts.
// Run: npm run -s check:endpoint-cache
import { api, gatedFetch } from "../lib/api";
import {
  cachedEndpoint, peekEndpoint, invalidateEndpoint, invalidateAllEndpoints,
  bindEndpointInvalidation, __setEndpointClock, ENDPOINT, TRANSACTIONS_CHANGED_KEYS, ENDPOINT_MAX_AGE_MS,
} from "../lib/endpointCache";
import {
  loadMiscategorisedCount, invalidateMiscategorisedCount, bindMiscategorisedInvalidation,
  __setMiscategorisedClock, MISCATEGORISED_COUNT_TTL_MS,
} from "../lib/miscategorisedCount";
import { invalidateAllAccountData } from "../lib/accountMutations";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

let t = 1_000_000;
__setEndpointClock(() => t);
__setMiscategorisedClock(() => t);
let calls = 0;
const fetcher = (value) => () => { calls++; return Promise.resolve(value); };

// 1. Concurrent callers share one request.
invalidateAllEndpoints(); calls = 0;
const [a, b] = await Promise.all([cachedEndpoint("k", fetcher({ v: 1 })), cachedEndpoint("k", fetcher({ v: 1 }))]);
check("concurrent calls dedupe to one request", calls, 1);
check("both callers get the payload", [a, b], [{ v: 1 }, { v: 1 }]);

// 2. TTL hit: no request within the TTL.
await cachedEndpoint("k", fetcher({ v: 2 }), { ttlMs: 60_000 });
check("fresh entry is served with no request", calls, 1);
t += 59_000;
const hit = await cachedEndpoint("k", fetcher({ v: 2 }), { ttlMs: 60_000 });
check("still fresh just inside the TTL", [calls, hit], [1, { v: 1 }]);

// 3. Stale-while-revalidate: serves cached immediately, replaces only on change.
t += 2_000;
let updates = [];
const stale = await cachedEndpoint("k", fetcher({ v: 1 }), { ttlMs: 60_000, onUpdate: (d) => updates.push(d) });
await tick();
check("stale entry is served immediately", stale, { v: 1 });
check("stale entry revalidates in the background", calls, 2);
check("unchanged revalidation does not replace the view", updates, []);
t += 61_000;
await cachedEndpoint("k", fetcher({ v: 9 }), { ttlMs: 60_000, onUpdate: (d) => updates.push(d) });
await tick();
check("changed revalidation replaces the view once", updates, [{ v: 9 }]);
check("cache now holds the new payload", peekEndpoint("k"), { v: 9 });

// 4. A failed background revalidation keeps serving the stale payload.
t += 61_000;
const kept = await cachedEndpoint("k", () => Promise.reject(new Error("net")), { ttlMs: 60_000 });
await tick();
check("failed revalidation keeps the stale payload", [kept, peekEndpoint("k")], [{ v: 9 }, { v: 9 }]);

// 5. Explicit refresh bypasses a fresh entry.
calls = 0;
await cachedEndpoint("k2", fetcher({ n: 1 }));
const forced = await cachedEndpoint("k2", fetcher({ n: 2 }), { force: true });
check("force refetches despite a fresh entry", [calls, forced], [2, { n: 2 }]);

// 6. Per-endpoint TTL (sync status is shorter).
check("sync status TTL is shorter than the default", ENDPOINT.syncStatus.ttlMs < ENDPOINT.today.ttlMs, true);
calls = 0;
await cachedEndpoint(ENDPOINT.syncStatus.key, fetcher({ s: 1 }), { ttlMs: ENDPOINT.syncStatus.ttlMs });
t += ENDPOINT.syncStatus.ttlMs + 1;
await cachedEndpoint(ENDPOINT.syncStatus.key, fetcher({ s: 1 }), { ttlMs: ENDPOINT.syncStatus.ttlMs });
await tick();
check("sync status revalidates after its own TTL", calls, 2);

// 7. Invalidation on each event, and identity payloads survive transaction changes.
const target = new EventTarget();
bindEndpointInvalidation(target, { "sorted:transactions-changed": TRANSACTIONS_CHANGED_KEYS, "x:all": "all" });
invalidateAllEndpoints();
for (const e of Object.values(ENDPOINT)) await cachedEndpoint(e.key, fetcher({ k: e.key }));
target.dispatchEvent(new Event("sorted:transactions-changed"));
check("transactions-changed drops today", peekEndpoint(ENDPOINT.today.key), undefined);
check("transactions-changed drops safe-to-spend", peekEndpoint(ENDPOINT.safeToSpend.key), undefined);
check("transactions-changed drops cashflow", peekEndpoint(ENDPOINT.cashflow.key), undefined);
check("transactions-changed keeps profile", peekEndpoint(ENDPOINT.profile.key) !== undefined, true);
check("transactions-changed keeps subscription", peekEndpoint(ENDPOINT.subscription.key) !== undefined, true);
target.dispatchEvent(new Event("x:all"));
check("an 'all' event drops every key", Object.values(ENDPOINT).every((e) => peekEndpoint(e.key) === undefined), true);

// 8. A response in flight when an invalidation lands is not stored.
let resolveLate;
const late = cachedEndpoint("late", () => new Promise((r) => { resolveLate = r; }));
invalidateEndpoint("other");
resolveLate({ old: true });
await late;
check("in-flight response from before an invalidation is not cached", peekEndpoint("late"), undefined);

// 9. Sign-out / user change (invalidateAllAccountData) clears every client cache.
await cachedEndpoint(ENDPOINT.profile.key, fetcher({ name: "A" }));
await cachedEndpoint(ENDPOINT.today.key, fetcher({ items: [1] }));
invalidateAllAccountData();
check("sign-out clears profile", peekEndpoint(ENDPOINT.profile.key), undefined);
check("sign-out clears today", peekEndpoint(ENDPOINT.today.key), undefined);

// 10. Miscategorised count: dedupe per offset, TTL, offset keying, events, force.
const original = api.getMiscategorisedCount;
let mc = 0;
api.getMiscategorisedCount = (offset = 0) => { mc++; return Promise.resolve({ count: offset, ids: [] }); };
invalidateMiscategorisedCount();
const [m1, m2] = await Promise.all([loadMiscategorisedCount(0), loadMiscategorisedCount(0)]);
check("miscategorised: concurrent callers (Home + Spend) share one request", mc, 1);
check("miscategorised: both get the same payload", m1 === m2, true);
await loadMiscategorisedCount(-1);
check("miscategorised: a different offset is its own request", mc, 2);
await loadMiscategorisedCount(0);
check("miscategorised: cached within the TTL", mc, 2);
await loadMiscategorisedCount(0, true);
check("miscategorised: force refetches", mc, 3);
const t2 = new EventTarget();
bindMiscategorisedInvalidation(t2, ["sorted:transactions-changed"]);
t2.dispatchEvent(new Event("sorted:transactions-changed"));
await loadMiscategorisedCount(0);
check("miscategorised: transactions-changed invalidates", mc, 4);
t += MISCATEGORISED_COUNT_TTL_MS + 1;
await loadMiscategorisedCount(0);
check("miscategorised: refetches after the TTL", mc, 5);
invalidateAllAccountData();
await loadMiscategorisedCount(0);
check("miscategorised: sign-out clears it", mc, 6);
api.getMiscategorisedCount = original;

// 11. Max age: previous London day or older than 10 minutes is a miss.
{
  invalidateAllEndpoints();
  const saved = t;
  t = Date.parse("2026-11-06T09:00:00Z");
  await cachedEndpoint("age", fetcher({ d: 1 }), { ttlMs: 60_000 });
  t += ENDPOINT_MAX_AGE_MS - 1000;
  check("age: just under 10 minutes still peeks", peekEndpoint("age") !== undefined, true);
  t += 2000;
  check("age: past 10 minutes peek is a miss", peekEndpoint("age"), undefined);
  calls = 0;
  const upd = [];
  const v = await cachedEndpoint("age", fetcher({ d: 2 }), { ttlMs: 60_000, onUpdate: (d) => upd.push(d) });
  check("age: expired entry takes the loading path (fetched, no stale paint)", [calls, v, upd], [1, { d: 2 }, []]);
  // Across London midnight (GMT in November): 23:59 then 00:01 next day, 2 minutes apart.
  invalidateAllEndpoints();
  t = Date.parse("2026-11-06T23:59:00Z");
  await cachedEndpoint("mid", fetcher({ m: 1 }), { ttlMs: 60_000 });
  t = Date.parse("2026-11-07T00:01:00Z");
  check("midnight: a previous-day entry is a miss", peekEndpoint("mid"), undefined);
  calls = 0;
  const m = await cachedEndpoint("mid", fetcher({ m: 2 }), { ttlMs: 60_000 });
  check("midnight: refetched rather than served", [calls, m], [1, { m: 2 }]);
  // BST: 23:30 UTC on 1 Jul is already 00:30 London on 2 Jul.
  invalidateAllEndpoints();
  t = Date.parse("2026-07-01T22:30:00Z");
  await cachedEndpoint("bst", fetcher({ b: 1 }), { ttlMs: 60_000 });
  t = Date.parse("2026-07-01T23:30:00Z");
  check("BST: London midnight is honoured (not UTC)", peekEndpoint("bst"), undefined);
  t = saved;
}

// 12. Write exemption: read-only POSTs keep the cache, a real write clears it.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  const readOnly = ["/api/penny/chip", "/api/can-i", "/api/cashflow/preview-rule", "/api/commitments/preview", "/api/commitments/schedule-preview", "/api/spend/intent-preview", "/api/card-terms/abc123/payment-match-preview", "/api/baskets/scan-receipt"];
  for (const path of readOnly) {
    invalidateAllEndpoints();
    await cachedEndpoint(ENDPOINT.today.key, fetcher({ items: [] }));
    await gatedFetch(path, { method: "POST", body: "{}" });
    check(`read-only POST ${path} keeps the cache`, peekEndpoint(ENDPOINT.today.key) !== undefined, true);
  }
  for (const path of ["/api/today/abc/dismiss", "/api/commitments", "/api/accounts/sync"]) {
    invalidateAllEndpoints();
    await cachedEndpoint(ENDPOINT.today.key, fetcher({ items: [] }));
    await gatedFetch(path, { method: "POST", body: "{}" });
    check(`real write POST ${path} clears the cache`, peekEndpoint(ENDPOINT.today.key), undefined);
  }
  // 13. A write also drops the miscategorised count.
  api.getMiscategorisedCount = (o = 0) => { mc++; return Promise.resolve({ count: o, ids: [] }); };
  invalidateMiscategorisedCount();
  mc = 0;
  await loadMiscategorisedCount(0);
  await gatedFetch("/api/today/abc/dismiss", { method: "POST", body: "{}" });
  await loadMiscategorisedCount(0);
  check("a successful write drops the miscategorised count", mc, 2);
  await gatedFetch("/api/can-i", { method: "POST", body: "{}" });
  await loadMiscategorisedCount(0);
  check("a read-only POST keeps the miscategorised count", mc, 2);
  globalThis.fetch = realFetch;
  api.getMiscategorisedCount = original;
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll endpoint-cache checks passed");
