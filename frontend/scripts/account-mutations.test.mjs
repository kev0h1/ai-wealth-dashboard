// Plain-Node test for G138: deleting a bank account (or any other account
// mutation — a new connection landing, a reconnect, a statement upload)
// left Spend still listing a deleted account's transaction as an unplaced
// payment and counting it in Out, until a hard refresh. Server-side was
// verified clean (all six transaction collections searched on UAT for the
// missing transaction, found nothing; services/account_cascade.py deletes
// the transactions, the account doc, cashflow_cache, companion items and
// derived caches, and bumps the data version). The leak was client-side:
// AccountsPage.tsx's delete handler called only invalidateAccounts(),
// leaving the verdict/money-shape/Home/signals caches (and two localStorage
// badge counts) still serving their pre-deletion payload.
//
// This proves the CLASS fix, not the instance fix: lib/accountMutations.ts's
// invalidateAllAccountData() must clear EVERY module-scope cache that holds
// account- or transaction-derived data, not just the accounts list. Same
// framework-free pattern as scripts/category-mutations.test.mjs and
// scripts/verdict-cache.test.mjs: imports the REAL production modules and
// stubs `api.*` in place. No network, no Mongo, no real account, no React
// renderer.
//
// Run with:
//   npm run -s check:account-mutations
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/account-mutations.test.mjs

import { api } from "../lib/api";
import { invalidateAllAccountData } from "../lib/accountMutations";
import { getAccountsCached, invalidateAccounts } from "../lib/accountsCache";
import { getAllTransactionsCached, invalidateTransactionsCache } from "../lib/useAllTransactions";
import { getHomeCache, setHomeCache, clearHomeCache } from "../lib/homeCache";
import { fetchVerdictData, invalidateVerdictCache } from "../lib/verdictCache";
import { loadMoneyShape, invalidateMoneyShapeCache } from "../lib/moneyShape";
import { fetchSignals, invalidateSignalsCache } from "../lib/signalsCache";
import { PAYDAY_DOT_CACHE_KEY } from "../lib/paydayWindow";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// A tiny fake localStorage — Node has no global `localStorage` outside a
// browser/jsdom context, and lib/accountMutations.ts reads the real global
// at call time (not an injected dependency, matching every other
// localStorage-touching module in lib/), so the fake is installed on
// globalThis itself rather than passed in as a parameter.
function makeFakeLocalStorage() {
  const store = new Map();
  return {
    setItem: (k, v) => store.set(k, String(v)),
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => store.delete(k),
    has: (k) => store.has(k),
  };
}
const fakeStorage = makeFakeLocalStorage();
globalThis.localStorage = fakeStorage;

// ── invalidateAllAccountData clears the accounts cache ──────────────────────
{
  invalidateAccounts();
  let calls = 0;
  api.accounts = async () => { calls += 1; return [{ id: `a${calls}` }]; };

  const before = await getAccountsCached();
  check("accounts cache warmed with the pre-mutation value", before[0].id, "a1");
  await getAccountsCached();
  check("cache genuinely warm (no second network call yet)", calls, 1);

  invalidateAllAccountData();

  const after = await getAccountsCached();
  check("invalidateAllAccountData forces the accounts cache to refetch", calls, 2);
  check("the refetched accounts list is NOT the pre-mutation one", after[0].id !== before[0].id, true);
}

// ── invalidateAllAccountData clears the all-transactions cache ─────────────
{
  invalidateTransactionsCache();
  let calls = 0;
  api.allTransactions = async () => { calls += 1; return [{ id: `t${calls}` }]; };

  const before = await getAllTransactionsCached();
  check("transactions cache warmed with the pre-mutation value", before[0].id, "t1");
  await getAllTransactionsCached();
  check("cache genuinely warm (no second network call yet)", calls, 1);

  invalidateAllAccountData();

  const after = await getAllTransactionsCached();
  check("invalidateAllAccountData forces the transactions cache to refetch", calls, 2);
  check("the refetched transactions are NOT the pre-mutation ones", after[0].id !== before[0].id, true);
}

// ── invalidateAllAccountData clears the Home warm-paint cache ──────────────
{
  clearHomeCache();
  setHomeCache({
    accounts: [{ id: "barclays-savings" }],
    investmentAccounts: [],
    safeToSpend: null,
    companionItems: [],
    accountEligibility: undefined,
    // G148: HomeCacheSnapshot now also carries the outcome of the GET /today
    // that was supposed to deliver `accountEligibility` above, and
    // setHomeCache refuses any snapshot missing a key the shape declares
    // (see lib/homeCache.ts's shape guard and
    // scripts/home-cache-shape.test.mjs). Without this key the write below
    // is correctly rejected and the cache stays null.
    todayStatus: "ready",
    recentTxns: [],
    needle: null,
    needleStatus: "ready",
  });
  check("Home cache warmed with the pre-mutation snapshot", getHomeCache()?.accounts[0].id, "barclays-savings");

  invalidateAllAccountData();

  check("invalidateAllAccountData clears the Home cache back to null", getHomeCache(), null);
}

// ── invalidateAllAccountData clears the Spend verdict cache ────────────────
{
  invalidateVerdictCache();
  let calls = 0;
  api.spendVerdict = async () => { calls += 1; return { tag: `v${calls}`, reading: "r", pace_series: [], notables: [], majority: [] }; };

  const before = await fetchVerdictData(0);
  check("verdict cache warmed with the pre-mutation value", before.tag, "v1");
  await fetchVerdictData(0);
  check("cache genuinely warm (no second network call yet)", calls, 1);

  invalidateAllAccountData();

  const after = await fetchVerdictData(0);
  // This is the EXACT bug: the £100 Barclays transaction stayed in Spend's
  // Out figure because this call would otherwise still be within the 90s
  // TTL and hand back `before` again, with `calls` staying at 1.
  check("invalidateAllAccountData forces the verdict cache to refetch, not serve the pre-deletion value", calls, 2);
  check("the refetched verdict is NOT the pre-mutation one", after.tag !== before.tag, true);
}

// ── invalidateAllAccountData clears the money-shape cache ──────────────────
{
  invalidateMoneyShapeCache();
  let calls = 0;
  api.getMoneyShape = async () => { calls += 1; return { tag: `s${calls}`, periods: [], averages: [], what_works: [] }; };

  const before = await loadMoneyShape();
  check("money-shape cache warmed with the pre-mutation value", before.tag, "s1");
  await loadMoneyShape();
  check("cache genuinely warm (no second network call yet)", calls, 1);

  invalidateAllAccountData();

  const after = await loadMoneyShape();
  check("invalidateAllAccountData forces the money-shape cache to refetch", calls, 2);
  check("the refetched shape is NOT the pre-mutation one", after.tag !== before.tag, true);
}

// ── invalidateAllAccountData clears the category-signals cache ─────────────
{
  invalidateSignalsCache();
  let calls = 0;
  api.categorySignals = async () => { calls += 1; return { signals: { Groceries: { multiple: calls } } }; };

  const before = await fetchSignals(0);
  check("signals cache warmed with the pre-mutation value", before.Groceries.multiple, 1);
  await fetchSignals(0);
  check("cache genuinely warm (no second network call yet)", calls, 1);

  invalidateAllAccountData();

  const after = await fetchSignals(0);
  check("invalidateAllAccountData forces the signals cache to refetch", calls, 2);
  check("the refetched signals are NOT the pre-mutation ones", after.Groceries.multiple !== before.Groceries.multiple, true);
}

// ── invalidateAllAccountData clears the localStorage badge counts ──────────
{
  fakeStorage.setItem("wd_spend_badge", JSON.stringify({ n: 3, at: Date.now() }));
  fakeStorage.setItem(PAYDAY_DOT_CACHE_KEY, JSON.stringify({ v: true, at: Date.now() }));
  fakeStorage.setItem("wd_insight_badge", "2");
  check("wd_spend_badge warmed before the mutation", fakeStorage.has("wd_spend_badge"), true);
  check("PAYDAY_DOT_CACHE_KEY warmed before the mutation", fakeStorage.has(PAYDAY_DOT_CACHE_KEY), true);

  invalidateAllAccountData();

  check("invalidateAllAccountData clears wd_spend_badge (named in the G138 item)", fakeStorage.has("wd_spend_badge"), false);
  check("invalidateAllAccountData clears the Penny nav dot cache", fakeStorage.has(PAYDAY_DOT_CACHE_KEY), false);
  check("invalidateAllAccountData clears wd_insight_badge", fakeStorage.has("wd_insight_badge"), false);
}

// ── invalidateAllAccountData must not touch preference-shaped storage ──────
// wd_hide_balances gates the "balances hidden until preferences resolve"
// behaviour (PreferencesContext.preferencesReady) — clearing it on an
// account mutation would flash real balances briefly visible for a user who
// has chosen to hide them, which is the opposite of what G138 asks for.
{
  fakeStorage.setItem("wd_hide_balances", "1");
  invalidateAllAccountData();
  check("invalidateAllAccountData leaves wd_hide_balances untouched", fakeStorage.getItem("wd_hide_balances"), "1");
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll account-mutations cache-invalidation checks passed.");
