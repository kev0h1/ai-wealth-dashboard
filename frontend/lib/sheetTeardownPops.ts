// Pending teardown pops. When a parent unmounts a history-owning sheet without
// calling close() (a success callback flipping `show...(false)`), useSheetA11y's
// cleanup removes the sheet from its open stack and then issues history.back()
// to consume the entry. That pop arrives AFTER the sheet is gone from the
// stack, so a page-level popstate listener would see "no sheet open" and treat
// it as the user's own Back. Counting the pending pop as an open sheet until it
// is delivered keeps those listeners honest.
//
// Leak safety: every token is removed by exactly one of (a) the next popstate,
// delivered in the BUBBLE phase so capture listeners have already read the
// count, or (b) a timeout, in case history.back() produced no popstate (no
// entry to go back to). Coalesced teardowns hold one token each and one pop
// retires one token. The array is also capped.

const MAX_PENDING = 8;
const TOKEN_TTL_MS = 1000;

interface Token { timer: ReturnType<typeof setTimeout> }
const pending: Token[] = [];
let installedOn: EventTarget | null = null;

function retireOldest() {
  const token = pending.shift();
  if (token) clearTimeout(token.timer);
}

export function pendingTeardownPopCount(): number {
  return pending.length;
}

/** The production open-sheet count: sheets still on the history stack plus
 * teardown pops not yet delivered. useSheetA11y's openSheetHistoryCount is
 * exactly this, and the behavioural tests call it too. */
export function openSheetCount(stackLength: number): number {
  return stackLength + pending.length;
}

/** Call immediately BEFORE history.back() in a teardown. */
export function beginTeardownPop(target: EventTarget = window): void {
  if (installedOn !== target) {
    installedOn?.removeEventListener("popstate", retireOldest);
    target.addEventListener("popstate", retireOldest); // bubble phase, on purpose
    installedOn = target;
  }
  if (pending.length >= MAX_PENDING) retireOldest();
  const token: Token = {
    timer: setTimeout(() => {
      const i = pending.indexOf(token);
      if (i !== -1) pending.splice(i, 1);
    }, TOKEN_TTL_MS),
  };
  pending.push(token);
}

/** Test hook: drop all state. */
export function resetTeardownPops(): void {
  while (pending.length) retireOldest();
  installedOn?.removeEventListener("popstate", retireOldest);
  installedOn = null;
}
