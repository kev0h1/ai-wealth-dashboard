// PUSH-vs-POP detection for ScrollReset.tsx, extracted so the decision rule
// itself is unit-testable without a real browser (see
// scripts/scroll-nav-detect.test.mjs, which also ports the OLD
// history.length heuristic side by side and proves it misclassifies the
// exact sequence Kevin reported).
//
// The rule: stamp a monotonically increasing index into `history.state` the
// first time we land on an entry that doesn't already carry one, and read
// that stamp's mere PRESENCE (not its value) as the POP/PUSH signal. This is
// not a guess — it is Next.js's own internal contract, verified by reading
// its source (this repo's copy, checked against next@ in package.json):
//
// - Every fresh navigation (a Link tap, router.push, router.replace) goes
//   through `completeSoftNavigation`
//   (node_modules/next/dist/client/components/segment-cache/navigation.js),
//   which sets `pushRef.preserveCustomHistoryState: false`. app-router.js's
//   `HistoryUpdater` (~L46-58) then builds the entry's new state as
//   `{ __NA, __PRIVATE_NEXTJS_INTERNALS_TREE }` ONLY — it does NOT spread
//   `window.history.state`, so whatever custom field we stamped on the
//   PREVIOUS entry is simply absent from the new one.
// - A browser back/forward (a history TRAVERSAL), by contrast, goes through
//   `completeTraverseNavigation` (segment-cache/navigation.js ~L483-493),
//   which explicitly sets `preserveCustomHistoryState: true` — its own
//   comment reads "Ensures that the custom history state that was set is
//   preserved when applying this update." `HistoryUpdater` then spreads
//   `window.history.state` (the entry being traversed TO, already restored
//   natively by the browser before any of our code runs) into the rebuilt
//   state, so whatever we stamped on that entry the last time we visited it
//   survives the round trip untouched, regardless of how many entries the
//   jump crossed.
//
// So a fresh PUSH/REPLACE always arrives with the stamp stripped, and a
// TRAVERSAL — one step or several, backward or forward — always arrives with
// the previous stamp intact. Presence is therefore a hard signal, not a
// heuristic: unlike `window.history.length` (the old approach — see
// ScrollReset.tsx's git history), it never depends on how far the jump was,
// or on what happened to the forward stack.
export interface NavDetectResult {
  /** True when this landing is a history traversal (real back/forward, in
   *  either direction, of any distance) and the saved scroll position for
   *  this route should be restored. False for a fresh push/replace — and for
   *  the very first load, which has nothing stamped yet either — meaning the
   *  route should start at the top. */
  isPop: boolean;
  /** The state object to write back via `history.replaceState` when
   *  `isPop` is false, so a future traversal back to this same entry is
   *  correctly recognised. Callers should not call replaceState at all when
   *  `isPop` is true — the existing stamp is already correct. */
  stampedState: Record<string, unknown>;
}

const STAMP_KEY = "__wdNavSeq";

/** Pure decision function. `historyState` is whatever `window.history.state`
 *  currently holds (read AFTER Next.js's own HistoryUpdater has run for this
 *  navigation — see ScrollReset.tsx for why that ordering is safe to rely
 *  on). `nextSeq` is the index to stamp if this turns out to be a fresh
 *  entry; callers own incrementing their own counter only when it's used. */
export function classifyNavigation(historyState: unknown, nextSeq: number): NavDetectResult {
  const state: Record<string, unknown> =
    historyState != null && typeof historyState === "object"
      ? (historyState as Record<string, unknown>)
      : {};
  if (typeof state[STAMP_KEY] === "number") {
    return { isPop: true, stampedState: state };
  }
  return { isPop: false, stampedState: { ...state, [STAMP_KEY]: nextSeq } };
}
