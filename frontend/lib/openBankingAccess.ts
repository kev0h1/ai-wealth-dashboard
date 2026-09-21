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
// Caching mirrors lib/accountsCache.ts (module-level value + in-flight
// promise + TTL, invalidated explicitly on write) for the same reason: Home,
// Accounts and Onboarding all need this, and the answer changes only when a
// plan changes. Onboarding's plan step reads the SAME cached subscription
// (it needs the full object, not just this one bit) and invalidates it after
// selecting a plan, so signup makes one request, not two, and the bank step
// immediately afterwards sees the plan that was just chosen.

import { useEffect, useState } from "react";
import { api, SubscriptionInfo } from "@/lib/api";

export const OPEN_BANKING_TTL_MS = 5 * 60_000;

let cache: { data: SubscriptionInfo; at: number } | null = null;
let inflight: Promise<SubscriptionInfo> | null = null;

/** Call after anything that changes the user's plan (Onboarding's plan
 *  selection does), so the next read is forced fresh rather than serving the
 *  pre-change snapshot for up to the full TTL. */
export function invalidateOpenBankingAccess() {
  cache = null;
  inflight = null;
}

/** The shared, deduped GET /subscription. Exported so a caller that needs
 *  the whole subscription (Onboarding's plan picker) reuses this request
 *  rather than issuing a second one. */
export function getSubscriptionCached(): Promise<SubscriptionInfo> {
  if (cache && Date.now() - cache.at < OPEN_BANKING_TTL_MS) {
    return Promise.resolve(cache.data);
  }
  if (!inflight) {
    inflight = api.getSubscription()
      .then((data) => {
        cache = { data, at: Date.now() };
        return data;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function openBankingAllowed(sub: SubscriptionInfo): boolean {
  return sub.limits ? sub.limits.open_banking !== false : sub.tier !== "statements";
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
 *  re-renders once the answer lands. A failed fetch settles to TRUE — an
 *  unreachable subscription endpoint must not lock a paying user out of
 *  connecting their bank, and the server still enforces the real gate. */
export function useOpenBankingAccess(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSubscriptionCached()
      .then((sub) => { if (!cancelled) setAllowed(openBankingAllowed(sub)); })
      .catch(() => { if (!cancelled) setAllowed(true); });
    return () => { cancelled = true; };
  }, []);

  return allowed;
}
