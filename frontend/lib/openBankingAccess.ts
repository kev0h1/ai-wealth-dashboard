"use client";

// A67: does this user's plan include connecting a bank at all?
//
// The backend has always refused open banking on the Statements tier —
// `app.core.subscription.check_open_banking_allowed` raises 402
// (OPEN_BANKING_NOT_IN_TIER) at the top of every connect-link endpoint. The
// frontend never asked, so a free-tier user was shown a Connect button,
// tapped it, and got an error dialogue. This module is what lets Home,
// Accounts and the signup bank step ask first.
//
// The gate is `limits.open_banking`, not `tier === "statements"`: that field
// IS the server's own condition (`sub.limit("open_banking") is False`), so
// the two can never disagree, and a future tier with the same restriction
// needs no change here. `tier` is only the fallback for an older API
// response that carries no `limits` block at all.
//
// ── Why this is a notifying store, not just a cache ─────────────────────
//
// The cache itself mirrors lib/accountsCache.ts (module-level value +
// in-flight promise + TTL, invalidated explicitly on write). What that
// pattern does NOT give you, and what this module needs, is a way to tell an
// ALREADY-MOUNTED reader that the answer changed.
//
// Signup is exactly that case and it is not a corner: `AuthProvider` mounts
// `Onboarding` once (AuthProvider.tsx:190) and every step after that is a
// `setStep` inside that same instance, with no navigation anywhere in the
// file. So the plan step and the bank step are the same mount. A user on
// today's configuration (DEFAULT_TIER unset, so "max") reads `max` at mount,
// accepts the free Statements plan the very next screen offers, and then
// meets a bank step still rendering "Connect your first bank" — because
// clearing a cache nothing re-reads changes nothing. Picking a bank there
// returns 402, which is the precise defect A67 exists to remove.
//
// So `invalidateOpenBankingAccess` both clears the cache and NOTIFIES every
// live reader. The alternative considered was to leave the store inert and
// have Onboarding derive the answer from the `planInfo` it already holds.
// That was rejected: it fixes one screen and leaves the exported
// `invalidateOpenBankingAccess` a function whose name promises something it
// does not do, for the next caller to trip over the same way. Note that Home
// and Accounts are correct today only incidentally, because they mount after
// signup, and the paid path only because PlanPicker's
// `window.location.assign(checkoutUrl)` remounts the world. None of that is
// a guarantee anyone wrote down.
//
// `watchOpenBankingAccess` below holds the whole read/invalidate/re-read
// cycle with no React in it, so it can be driven directly by
// scripts/open-banking-access.test.mjs; the hook is a one-line binding of it
// to component state.

import { useEffect, useState } from "react";
// `SubscriptionInfo` is imported with `import type` rather than folded into
// the value import above (the style lib/accountsCache.ts uses): Node's
// --experimental-strip-types does not elide a type name sitting in a value
// import clause, so scripts/open-banking-access.test.mjs would fail to load
// this module at all with "does not provide an export named".
import { api } from "@/lib/api";
import type { SubscriptionInfo } from "@/lib/api";

export const OPEN_BANKING_TTL_MS = 5 * 60_000;

let cache: { data: SubscriptionInfo; at: number } | null = null;
let inflight: Promise<SubscriptionInfo> | null = null;
const readers = new Set<() => Promise<void>>();

// Bumped by every invalidation. A read captures the generation it was issued
// under and drops its own result if that generation is no longer current.
// Without it, "last to RESOLVE wins" rather than "last to be ISSUED wins":
// invalidation nulls `inflight` while an earlier read is still in the air,
// so that earlier read's `.then` would still write `cache` and still notify,
// and a stale answer would then sit in the cache for the full TTL. Not
// reachable through today's call graph, but silent and sticky if it ever is,
// and this module's own contract invites a caller that would hit it.
let generation = 0;

/** Call after anything that changes the user's plan (PlanPicker's free-plan
 *  selection does). Clears the cache AND re-reads it on behalf of every
 *  mounted reader, so a component that is already on screen sees the new
 *  plan rather than the snapshot it happened to mount with.
 *
 *  RETURNS A PROMISE THAT CALLERS MUST AWAIT before navigating onward.
 *  Signup is the reason: `PlanPicker`'s free-plan branch invalidates and then
 *  advances to the income step, which is one synchronous `setStep` and one
 *  user tap away from the bank step (`Onboarding.skipIncome` is exactly
 *  `setStep("bank")`, and `saveIncome` with an empty field falls straight
 *  through without saving). Against a single-worker API where a cold
 *  `GET /subscription` over 500 ms is ordinary, a fire-and-forget
 *  invalidation loses that race often enough to matter: the bank step paints
 *  "Connect your first bank", then swaps to the statements copy when the
 *  read lands, and in the gap a tap reaches a 402. Awaiting closes the
 *  window. */
export function invalidateOpenBankingAccess(): Promise<void> {
  cache = null;
  inflight = null;
  generation += 1;
  return Promise.all([...readers].map((read) => read())).then(() => undefined);
}

/** The shared, deduped GET /subscription. Exported so a caller that needs
 *  the whole subscription (Onboarding's plan picker) reuses this request
 *  rather than issuing a second one. */
export function getSubscriptionCached(): Promise<SubscriptionInfo> {
  if (cache && Date.now() - cache.at < OPEN_BANKING_TTL_MS) {
    return Promise.resolve(cache.data);
  }
  if (!inflight) {
    const gen = generation;
    const pending: Promise<SubscriptionInfo> = api.getSubscription().then((data) => {
      // Superseded reads return their data to whoever is holding this exact
      // promise, but never become the cached answer for anyone else.
      if (gen === generation) cache = { data, at: Date.now() };
      return data;
    });
    // Deliberately not `.finally`: that would clear `inflight` even when it
    // no longer refers to this promise, so a read issued in the window
    // between an invalidation and the superseded promise settling would
    // start a third, redundant request.
    pending.catch(() => {}).then(() => { if (inflight === pending) inflight = null; });
    inflight = pending;
  }
  return inflight;
}

export function openBankingAllowed(sub: SubscriptionInfo): boolean {
  return sub.limits ? sub.limits.open_banking !== false : sub.tier !== "statements";
}

/** Reads the answer now, and again on every `invalidateOpenBankingAccess()`,
 *  calling `onChange` each time it settles. Returns an unsubscribe.
 *
 *  A failed read settles to TRUE — an unreachable subscription endpoint must
 *  not lock a paying user out of connecting their bank, and the server still
 *  enforces the real gate either way.
 *
 *  A re-read does NOT reset to false first: it keeps reporting the previous
 *  answer until the new one lands, so a paid user never sees Connect a Bank
 *  blink out and back. The only caller of invalidate today is a move TO the
 *  free plan, whose re-read resolves during the step after it, long before
 *  the bank step is reached. */
export function watchOpenBankingAccess(onChange: (allowed: boolean) => void): () => void {
  let cancelled = false;
  // `cancelled` covers a read that is STILL IN FLIGHT when the caller
  // unsubscribes (React unmount): deleting the closure from `readers` stops
  // FUTURE invalidations reaching it, but does nothing about a request
  // already in the air, whose `.then` would otherwise call `onChange` and,
  // from the hook, setState on an unmounted component. `generation` is the
  // separate case: a read superseded by an invalidation must not report an
  // answer the caller has already been told is out of date.
  const read = (): Promise<void> => {
    const gen = generation;
    return getSubscriptionCached()
      .then((sub) => { if (!cancelled && gen === generation) onChange(openBankingAllowed(sub)); })
      .catch(() => { if (!cancelled && gen === generation) onChange(true); });
  };
  readers.add(read);
  void read();
  return () => {
    cancelled = true;
    readers.delete(read);
  };
}

/** Whether this plan includes connecting a bank.
 *
 *  Returns a plain boolean, deliberately, with no separate "still loading"
 *  state for a caller to branch on: the pending answer and "no" are meant to
 *  render identically. It starts FALSE and only ever becomes true once the
 *  answer is known, so Upload Statement (the action every plan has) is what
 *  shows while the plan resolves, and Connect a Bank is revealed additively.
 *  Nothing flashes up and disappears, and nobody is offered a button that
 *  answers with a 402. An earlier version of this module returned `ready` and
 *  `tier` alongside this so a caller could tell "pending" from "denied" —
 *  no caller ever wanted to, so they are gone rather than left as a
 *  documented contract nothing obeys.
 *
 *  Nothing here blocks rendering: the caller renders immediately, then
 *  re-renders once the answer lands, and again if the plan changes under it. */
export function useOpenBankingAccess(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => watchOpenBankingAccess(setAllowed), []);
  return allowed;
}
