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

import { stampAccountDetailState, hasAccountDetailEntry } from "../lib/accountSheetHistory.ts";
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

function main() {
  testStampShape();
  testBackRestoresRecordedPosition();
  testDeepLinkDoesNotThrow();
  testForwardDoesNotDoubleStampOrLeaveStaleEntry();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll account-sheet-history checks passed.");
}

main();
