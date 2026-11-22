// G488: Home and the other tabs show placeholders until the data has loaded,
// never empty-state copy or "Good morning, there". Each card is covered in its
// loading, loaded-empty and loaded-with-data states.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import HomeBrief from "../components/HomeBrief.tsx";
import HomeGreetingHeader from "../components/HomeGreetingHeader.tsx";
import HomeEstateSection from "../components/HomeEstateSection.tsx";
import { DebtPosition } from "../app/planning/LongTermPlanningPage.tsx";
import { buildGreeting } from "../lib/greeting.ts";
import { briefGate, accountsGenuinelyEmpty, recentActivityState } from "../lib/homeLoadGates.ts";
import { readCachedFirstName, writeCachedFirstName, clearCachedFirstName } from "../lib/firstNameCache.ts";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { COVER_MOVE_ITEM } from "./fixtures/g292-home-anatomy.ts";

const noop = () => {};
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const withRouter = (el) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, el));

// 1. Greeting: a name, a placeholder while it loads, nothing when there is none. Never "there".
assert.deepEqual(buildGreeting(9, "Kevin", true), { text: "Good morning, Kevin", namePending: false });
assert.deepEqual(buildGreeting(9, "Kevin", false), { text: "Good morning, Kevin", namePending: false }, "a cached name shows at once");
assert.deepEqual(buildGreeting(9, undefined, false), { text: "Good morning,", namePending: true }, "loading: placeholder");
assert.deepEqual(buildGreeting(14, undefined, true), { text: "Good afternoon", namePending: false }, "resolved, no name: no name at all");
assert.deepEqual(buildGreeting(20, "", true), { text: "Good evening", namePending: false });
assert.equal(buildGreeting(null, undefined, false).text, "Hello,", "first paint before the clock is read");
for (const state of [[9, "Kevin", true], [9, undefined, false], [9, undefined, true], [null, undefined, false]]) {
  assert.doesNotMatch(buildGreeting(...state).text, /there/i);
}
{
  const loadingHeader = renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Good morning,", avatarInitials: null, namePending: true }));
  assert.match(loadingHeader, /Good morning,/);
  assert.match(loadingHeader, /data-greeting-name-pending/, "loading: skeleton pill");
  assert.match(loadingHeader, /animate-pulse/);
  assert.doesNotMatch(loadingHeader, /there/i);
  const emptyHeader = renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Good morning", avatarInitials: null }));
  assert.doesNotMatch(emptyHeader, /data-greeting-name-pending/, "resolved: no pill");
  assert.match(emptyHeader, />Good morning</);
  const named = renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Good morning, Kevin", avatarInitials: "K" }));
  assert.match(named, /Good morning, Kevin/);
}

// 2. First-name cache (wd_hide_balances pattern): per email, cleared on sign-out.
{
  const data = new Map();
  const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  assert.equal(readCachedFirstName(store, "a@x.uk"), undefined, "nothing cached yet");
  writeCachedFirstName(store, "a@x.uk", "Kevin");
  assert.equal(readCachedFirstName(store, "a@x.uk"), "Kevin");
  assert.equal(readCachedFirstName(store, "A@X.uk"), "Kevin", "email match ignores case");
  assert.equal(readCachedFirstName(store, "b@x.uk"), undefined, "another account never sees it");
  writeCachedFirstName(store, "a@x.uk", null);
  assert.equal(readCachedFirstName(store, "a@x.uk"), undefined, "a nameless profile forgets the name");
  writeCachedFirstName(store, "a@x.uk", "Kevin");
  clearCachedFirstName(store);
  assert.equal(readCachedFirstName(store, "a@x.uk"), undefined, "sign-out clears it");
  data.set("wd_first_name", "not json");
  assert.equal(readCachedFirstName(store, "a@x.uk"), undefined, "garbage is ignored");
}

// 3. Penny's line: loading, loaded-empty, loaded-with-data, failed.
const base = { loading: false, stsLoading: false, todaySettled: true, syncStatusKnown: true, syncStatusError: false, loadError: false, stsError: false, todayStatus: "ready" };
assert.equal(briefGate(base), "ready");
for (const [name, patch] of [["accounts", { loading: true }], ["left to spend", { stsLoading: true }], ["companion items", { todaySettled: false }], ["sync status", { syncStatusKnown: false }]]) {
  assert.equal(briefGate({ ...base, ...patch }), "loading", `${name} still loading`);
}
assert.equal(briefGate({ ...base, syncStatusKnown: false, syncStatusError: true }), "ready", "a failed sync status has its own error card");
assert.equal(briefGate({ ...base, todayStatus: "failed" }), "failed");
assert.equal(briefGate({ ...base, stsError: true }), "failed");
assert.equal(briefGate({ ...base, stsError: true, loadError: true }), "ready", "the page-level load error owns the retry");
assert.equal(briefGate({ ...base, loading: true, todayStatus: "failed" }), "loading", "loading outranks failed");

const brief = (props) => withRouter(h(HomeBrief, { items: [], safeToSpend: null, syncError: false, loading: false, firstName: "Kevin", ...props }));
const fallbackCopy = /Nothing needs you today|Nothing new needs you|isn't ready yet|isn&#x27;t ready yet/;
{
  const loading = brief({ loading: true, safeToSpend: FIGURE_DATA["on-track"] });
  assert.doesNotMatch(text(loading), fallbackCopy, "loading: no empty-state line");
  assert.match(loading, /animate-pulse/, "loading: the brief skeleton");
  const loadedEmpty = brief({ safeToSpend: FIGURE_DATA["on-track"] });
  assert.match(text(loadedEmpty), /Nothing needs you today/, "loaded-empty: the all-clear line");
  const withData = brief({ items: [COVER_MOVE_ITEM], safeToSpend: FIGURE_DATA["on-track"] });
  assert.doesNotMatch(text(withData), /Nothing needs you today/, "loaded-with-data: no all-clear");
  assert.match(text(withData), /Suggested move/, "loaded-with-data: the item");
  const failed = brief({ loadFailed: true, onRefresh: noop });
  assert.match(text(failed), /couldn&#x27;t load your updates/, "failed: says so");
  assert.match(failed, /Try again/);
  assert.doesNotMatch(text(failed), fallbackCopy, "failed: not an all-clear");
}

// 4. Connect-your-first-bank and the account list: skeleton until loaded, empty only when genuinely empty.
const acct = { loading: false, loadError: false, accountsStatus: "ready", accountCount: 0, investmentCount: 0, hasConnectionEvidence: false };
assert.equal(accountsGenuinelyEmpty(acct), true, "loaded and empty");
assert.equal(accountsGenuinelyEmpty({ ...acct, loading: true }), false, "loading");
assert.equal(accountsGenuinelyEmpty({ ...acct, accountsStatus: "loading" }), false, "a cached snapshot taken mid-load is not an answer");
assert.equal(accountsGenuinelyEmpty({ ...acct, accountsStatus: "failed" }), false, "failed read is not empty");
assert.equal(accountsGenuinelyEmpty({ ...acct, loadError: true }), false);
assert.equal(accountsGenuinelyEmpty({ ...acct, accountCount: 2 }), false, "with data");
assert.equal(accountsGenuinelyEmpty({ ...acct, hasConnectionEvidence: true }), false, "a connection is known (G485)");
{
  const estate = (extra) => renderToStaticMarkup(h(HomeEstateSection, {
    loading: false, accountCount: 0, topPickAccounts: [], totalAccountCount: 0, pinnedIds: [],
    onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: h("p", null, "Connect your first bank"), ...extra,
  }));
  assert.doesNotMatch(estate({ loading: true }), /Connect your first bank/, "loading: skeleton");
  assert.match(estate({ loading: true }), /animate-pulse/);
  assert.match(estate({}), /Connect your first bank/, "loaded-empty: the card");
}
const home = read("../app/components/HomePage.tsx");
assert.match(home, /const homeCache = rawHomeCache && rawHomeCache\.accountsStatus === "ready" \? rawHomeCache : null/, "a mid-load snapshot is never warm");
assert.match(home, /accountsStatus !== "ready"\) return;\n\s+setHomeCache/, "a mid-load snapshot is never written");
assert.match(home, /isFreshUser = hasNoAccounts/, "the first-bank card hangs off the gated empty check");

// 5. Recent Transactions.
const tx = { txLoading: false, accountsLoading: false, error: null, pendingCount: 0, recentCount: 0 };
assert.equal(recentActivityState({ ...tx, txLoading: true }), "loading");
assert.equal(recentActivityState({ ...tx, accountsLoading: true }), "loading", "accounts not back: not yet 'No transactions yet'");
assert.equal(recentActivityState(tx), "empty", "loaded-empty");
assert.equal(recentActivityState({ ...tx, recentCount: 3 }), "rows", "loaded-with-data");
assert.equal(recentActivityState({ ...tx, pendingCount: 1, accountsLoading: true }), "rows");
assert.equal(recentActivityState({ ...tx, error: "Recent activity could not be loaded." }), "error", "an error is not an empty state");

// 6. Source guards: no "there" fallback, sign-out clears the name, skeleton shares the greeting.
const homeBrief = read("../components/HomeBrief.tsx");
assert.doesNotMatch(homeBrief, /firstName \|\| "there"/);
assert.doesNotMatch(home, /\|\| "there"/);
assert.match(read("../components/AuthProvider.tsx"), /clearCachedFirstName\(localStorage\)/, "sign-out clears the cached name");
assert.match(home, /namePending=\{greeting\.namePending\}/, "the first-paint skeleton uses the same placeholder");
assert.doesNotMatch(read("../components/HomeGreetingHeader.tsx"), /rise-in|animation-fill|fill-mode|opacity-0/, "no animation hides real content");

// 7. Planning: debt and goals are tri-state already (loading, loaded-empty, loaded-with-data).
const debt = (d) => renderToStaticMarkup(h(DebtPosition, { debt: d, hideValues: false, onOpen: noop }));
assert.doesNotMatch(debt(undefined), /No balance currently owed/, "loading: no empty line");
assert.match(debt(undefined), /Loading debt position/);
assert.match(debt({ cards: [] }), /No balance currently owed/, "loaded-empty");
assert.match(debt({ cards: [{ debt: 500, classification: "carried_interest", rate_schedule: [] }] }), /£500/, "loaded-with-data");
assert.match(debt(null), /Couldn.t load your card position/, "failed: error, not empty");

// 8. Upcoming waits for the account list as well as the cashflow before judging "Nothing more expected".
const planning = read("../app/planning/PlanningPage.tsx");
assert.match(planning, /\) : !cashflow \|\| !accountsLoaded \? \(/, "upcoming: spinner until cashflow and accounts are back");
assert.match(planning, /setAccounts\(list\); setAccountsLoaded\(true\)/);

console.log("g488 loading gates: ok");
