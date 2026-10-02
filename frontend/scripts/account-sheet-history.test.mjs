// Plain-Node test for G116: the Accounts page's account-detail sheet pushed
// a bare `{ accountDetail: id }` history entry on open, with no spread of
// the outgoing entry's existing state. That silently dropped whatever
// ScrollReset.tsx (lib/scrollNavDetect.ts, G108) had already stamped on the
// /accounts entry (`__wdNavSeq`), so a later traversal back onto that entry
// — open the detail sheet, navigate to another route, press back — read as
// a FRESH push rather than a POP, and the accounts list scrolled to the top
// instead of restoring the remembered position.
//
// Same framework-free pattern as scripts/scroll-nav-detect.test.mjs: imports
// the REAL production modules (lib/accountSheetHistory.ts, the two exported
// functions app/components/AccountsPage.tsx now calls instead of building
// the pushState payload inline, and lib/scrollNavDetect.ts, the module
// ScrollReset.tsx actually reads). No DOM, no React renderer — AccountsPage
// itself pulls in useRouter/usePathname/data fetching and isn't something
// this runner can mount; the two extracted functions are the whole of the
// history-state DECISION this item is about, matching the class fix
// scripts/scroll-nav-detect.test.mjs already proved for G108's own half.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/account-sheet-history.test.mjs
// or:
//   npm run -s check:account-sheet-history

import { decideAccountPop, accountDetailIdFromState, stampAccountDetailState, hasAccountDetailEntry } from "../lib/accountSheetHistory.ts";
import { attachAccountPopListener } from "../lib/accountSheetHistory.ts";
import { beginTeardownPop, openSheetCount, pendingTeardownPopCount, resetTeardownPops } from "../lib/sheetTeardownPops.ts";
import { classifyNavigation } from "../lib/scrollNavDetect.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// --- 1. Opening the sheet stamps the entry with the expected shape ------
function testStampShape() {
  // The /accounts entry, already visited once, so ScrollReset has stamped
  // its own __wdNavSeq marker on it (plus a stand-in for the internal
  // fields Next.js's own HistoryUpdater keeps on every entry).
  const current = { __wdNavSeq: 3, __NA: true };
  const stamped = stampAccountDetailState(current, "acc-1");

  check(
    "stamping preserves the pre-existing __wdNavSeq stamp",
    stamped.__wdNavSeq === 3
  );
  check(
    "stamping preserves other pre-existing fields",
    stamped.__NA === true
  );
  check(
    "stamping adds the accountDetail marker",
    stamped.accountDetail === "acc-1"
  );
  check(
    "stamping does not mutate the caller's object",
    current.accountDetail === undefined
  );
  check(
    "hasAccountDetailEntry reads the freshly stamped entry as ours",
    hasAccountDetailEntry(stamped) === true
  );
}

// --- 2. Back restores the recorded position ------------------------------
//
// Reproduces the exact bug sequence end to end through the REAL
// classifyNavigation this page's fix depends on: cold-load /accounts (POP
// detection stamps __wdNavSeq) -> open the detail sheet (our fix must
// preserve that stamp) -> push to another route (a real Next.js push,
// which never carries custom state forward) -> browser BACK onto the
// detail-sheet entry. Before the fix, the entry pushed by
// handleSelectAccount carried only `{ accountDetail }`, no __wdNavSeq, so
// classifyNavigation on the way back would have misread this as a fresh
// push (isPop === false) and ScrollReset would have reset the list to the
// top instead of restoring it.
function testBackRestoresRecordedPosition() {
  // Tiny in-memory history-stack model, same rules as
  // scripts/scroll-nav-detect.test.mjs: push replaces the current entry's
  // "forward" slot with a BARE entry (Next.js's completeSoftNavigation
  // never spreads outgoing state into a fresh push); traverse only moves
  // the index and never touches stored state.
  const entries = [{ state: null }];
  let index = 0;
  const push = (state) => {
    entries.length = index + 1;
    entries.push({ state });
    index += 1;
  };
  const traverse = (delta) => {
    index += delta;
  };
  const current = () => entries[index].state;
  const setCurrent = (state) => {
    entries[index].state = state;
  };

  let seq = 0;
  const land = () => {
    const { isPop, stampedState } = classifyNavigation(current(), seq + 1);
    if (!isPop) {
      seq += 1;
      setCurrent(stampedState);
    }
    return isPop;
  };

  check("cold load of /accounts is not a POP", land() === false);

  // handleSelectAccount: push the detail-sheet entry via the real fix.
  push(stampAccountDetailState(current(), "acc-1"));
  check(
    "the pushed detail-sheet entry carries the __wdNavSeq stamp forward",
    typeof current().__wdNavSeq === "number"
  );
  check(
    "the pushed detail-sheet entry also carries the accountDetail marker",
    current().accountDetail === "acc-1"
  );

  // Router.push to an unrelated route — Next's real HistoryUpdater builds
  // this entry's state from scratch (only its own internal fields), never
  // spreading the outgoing entry's custom state.
  push(null);
  check("landing on the other route is not a POP", land() === false);

  // Browser back, onto the detail-sheet entry pushed above.
  traverse(-1);
  check(
    "back onto the detail-sheet entry IS a POP (this is the G116 fix)",
    land() === true
  );
}

// --- 3. Deep-link open does not throw ------------------------------------
//
// A deep link (/accounts?id=X) sets the detail view open without ever
// calling stampAccountDetailState — there is no prior /accounts entry to
// spread, and the entry's state may be null, undefined, or an object with
// no accountDetail field at all (e.g. Next's own bare internal state after
// the page's router.replace("/accounts") strips the query param).
function testDeepLinkDoesNotThrow() {
  const inputs = [null, undefined, {}, { __NA: true }, "not-an-object", 42];
  for (const input of inputs) {
    let threw = false;
    let result;
    try {
      result = hasAccountDetailEntry(input);
    } catch {
      threw = true;
    }
    check(`hasAccountDetailEntry(${JSON.stringify(input)}) does not throw`, !threw);
    check(`hasAccountDetailEntry(${JSON.stringify(input)}) is false`, result === false);
  }

  // stampAccountDetailState must also cope with a bare/absent prior state —
  // the very first call a fresh tab ever makes.
  let threw = false;
  let stamped;
  try {
    stamped = stampAccountDetailState(null, "acc-2");
  } catch {
    threw = true;
  }
  check("stampAccountDetailState(null, id) does not throw", !threw);
  check(
    "stampAccountDetailState(null, id) still produces a usable entry",
    stamped?.accountDetail === "acc-2"
  );
}

// --- 4. Forward again does not double-stamp or leave a stale entry -------
//
// After a back closes the sheet, pressing forward re-traverses onto the
// SAME stored entry — traversal never re-runs stampAccountDetailState (only
// tapping a row does), so the entry's shape must come back byte-for-byte
// identical, not accumulate a second accountDetail-shaped field or lose the
// __wdNavSeq stamp on the round trip. Also checks that re-selecting a row
// (a fresh stamp call on an entry that already carries a stale
// `accountDetail` from a previous selection) cleanly overwrites the single
// key rather than stacking.
function testForwardDoesNotDoubleStampOrLeaveStaleEntry() {
  const opened = stampAccountDetailState({ __wdNavSeq: 1 }, "acc-1");
  const roundTripped = opened; // traversal never mutates stored state
  check(
    "traversal (simulated: same stored object) is unchanged after a forward",
    JSON.stringify(roundTripped) === JSON.stringify(opened)
  );
  check(
    "the round-tripped entry still carries exactly one accountDetail key",
    Object.keys(roundTripped).filter((k) => k === "accountDetail").length === 1
  );

  // Re-selecting a different row from the list re-stamps cleanly, not
  // additively — the new accountDetail replaces the old one, no stale id
  // survives underneath it.
  const reselected = stampAccountDetailState(opened, "acc-2");
  check(
    "re-stamping for a newly selected account overwrites, not stacks",
    reselected.accountDetail === "acc-2"
  );
  check(
    "re-stamping keeps exactly one accountDetail key",
    Object.keys(reselected).filter((k) => k === "accountDetail").length === 1
  );
  check(
    "re-stamping still preserves the __wdNavSeq stamp underneath",
    reselected.__wdNavSeq === 1
  );
}

// --- 5. A child-sheet Back stays inside the account ----------------------
//
// SheetFrame pushes `{ __sheetA11yId }` above this entry. Its close/back
// traverses to the account marker, not the list. The parent must therefore
// reconcile the target marker, rather than clear account detail for every
// popstate. This is the exact sequence ManualTxSheet/TeachingSheet exercise.
function testChildSheetClosePreservesAccount() {
  const accountEntry = stampAccountDetailState({ __wdNavSeq: 4 }, "acc-1");
  const childEntry = { ...accountEntry, __sheetA11yId: "sheet-child" };
  check(
    "closing a child sheet lands on and retains the owning account",
    accountDetailIdFromState(accountEntry) === "acc-1"
  );
  check(
    "the child entry still identifies the same owning account",
    accountDetailIdFromState(childEntry) === "acc-1"
  );
  check(
    "back from account detail to the list clears the account marker",
    accountDetailIdFromState({ __wdNavSeq: 4 }) === null
  );
  check(
    "malformed markers never select an account",
    accountDetailIdFromState({ accountDetail: 42 }) === null
  );
}

// --- 6. Every sheet close route over account detail keeps the account -----
//
// Cancel, Save, X, backdrop, Escape, Delete and hardware Back all end in
// history.back() from SheetFrame; each lands on the account marker (or, for a
// deep-linked account that never stamped one, on the bare list entry) with a
// sheet still registered when the pop begins.
function testSheetCloseRoutesKeepAccount() {
  const accountEntry = stampAccountDetailState({ __wdNavSeq: 4 }, "acc-1");
  const sheetEntry = { ...accountEntry, __sheetA11yId: "sheet-1" };
  let d = decideAccountPop(accountEntry, 1);
  check("sheet over stamped account: account kept, nothing cleared", d.accountId === "acc-1" && !d.clearTransaction);
  d = decideAccountPop({ __wdNavSeq: 4 }, 1);
  check("sheet over deep-linked account (no marker): account left untouched", d.accountId === undefined && !d.clearTransaction);
  d = decideAccountPop(sheetEntry, 1);
  check("nested sheet closing onto its parent sheet entry leaves everything", d.accountId === undefined && !d.clearTransaction);
  d = decideAccountPop({ __wdNavSeq: 4 }, 0);
  check("Back from account detail with no sheet open returns to the list", d.accountId === null && d.clearTransaction);
  d = decideAccountPop(accountEntry, 0);
  check("Forward onto the account marker restores the account", d.accountId === "acc-1" && d.clearTransaction);
}

// --- 7. Behavioural: parent unmounts a sheet without close() --------------
//
// A fake window (EventTarget) stands in for the browser. The "sheet stack" is
// a plain counter so the test controls exactly what useSheetA11y's cleanup does
// (remove itself from the stack, then beginTeardownPop + history.back()). The
// pop is delivered asynchronously, after the stack no longer holds the sheet.
function popEvent(state) {
  const e = new Event("popstate");
  e.state = state;
  return e;
}

function harness() {
  resetTeardownPops();
  const win = new EventTarget();
  const sheets = { open: 0 };
  const view = { id: "acc-1", tx: "open" };
  const detach = attachAccountPopListener(
    win,
    () => ({ setSelectedAccountId: id => { view.id = id; }, clearSelectedTransaction: () => { view.tx = null; } }),
    () => openSheetCount(sheets.open),
  );
  return { win, sheets, view, detach };
}

function teardownOverDetail(label, landingState) {
  const { win, sheets, view, detach } = harness();
  sheets.open = 1;            // sheet open over the detail
  sheets.open = 0;            // parent unmounts it: cleanup removes it from the stack...
  beginTeardownPop(win);      // ...and queues history.back()
  win.dispatchEvent(popEvent(landingState)); // popstate arrives with the stack empty
  check(`${label}: teardown pop keeps account detail`, view.id === "acc-1" && view.tx === "open");
  check(`${label}: token retired by the delivered pop`, pendingTeardownPopCount() === 0);
  win.dispatchEvent(popEvent({ __wdNavSeq: 4 }));
  check(`${label}: a subsequent real Back still closes detail`, view.id === null && view.tx === null);
  detach();
}

function testTeardownPops() {
  teardownOverDetail("deep-linked detail (no marker)", { __wdNavSeq: 4 });
  teardownOverDetail("in-page detail", stampAccountDetailState({ __wdNavSeq: 4 }, "acc-1"));

  // Leak safety: back() that never produces a popstate must not wedge the count.
  const { win, view, detach } = harness();
  beginTeardownPop(win);
  check("pending token counts while the pop is undelivered", pendingTeardownPopCount() === 1);
  resetTeardownPops();
  check("reset clears tokens", pendingTeardownPopCount() === 0);
  for (let i = 0; i < 50; i++) beginTeardownPop(win);
  check("pending tokens are bounded", pendingTeardownPopCount() <= 8);
  // Coalesced: each pop retires exactly one token.
  resetTeardownPops();
  beginTeardownPop(win); beginTeardownPop(win);
  win.dispatchEvent(popEvent({ __wdNavSeq: 4 }));
  check("two teardowns: first pop retires one token", pendingTeardownPopCount() === 1);
  win.dispatchEvent(popEvent({ __wdNavSeq: 4 }));
  check("two teardowns: second pop retires the other", pendingTeardownPopCount() === 0);
  void view; detach(); resetTeardownPops();
}

// A listener that re-registers during dispatch is skipped for that event; the
// once-registered listener must still see a pop delivered while another
// listener (Next's render flush) churns registrations in the same dispatch.
function testListenerSurvivesRenderFlush() {
  const win = new EventTarget();
  const view = { id: "acc-1" };
  const detach = attachAccountPopListener(
    win,
    () => ({ setSelectedAccountId: id => { view.id = id; }, clearSelectedTransaction: () => {} }),
    () => 0,
  );
  let churned = 0;
  const churn = () => {
    // what a re-registering effect does when a render flushes synchronously
    const fn = () => {};
    win.addEventListener("popstate", fn, true);
    win.removeEventListener("popstate", fn, true);
    churned++;
  };
  win.addEventListener("popstate", churn, true);
  win.dispatchEvent(popEvent({ __wdNavSeq: 4 }));
  check("listener sees a pop delivered during a render flush", churned === 1 && view.id === null);
  detach();
}

function main() {
  testTeardownPops();
  testListenerSurvivesRenderFlush();
  testSheetCloseRoutesKeepAccount();
  testStampShape();
  testBackRestoresRecordedPosition();
  testDeepLinkDoesNotThrow();
  testForwardDoesNotDoubleStampOrLeaveStaleEntry();
  testChildSheetClosePreservesAccount();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll account-sheet-history checks passed.");
}

main();
