"use client";

// A67: does this user's plan include connecting a bank at all?
//
// The backend has always refused open banking on the Statements tier —
// `app.core.subscription.check_open_banking_allowed` raises 402
// (OPEN_BANKING_NOT_IN_TIER) at the top of every connect-link endpoint. The
// frontend never asked, so a free-tier user was shown a Connect button,
// tapped it, and got an error dialogue. This module is what lets Home and
// Accounts ask first.
//
// The gate is `limits.open_banking`, not `tier === "statements"`: that field
// IS the server's own condition (`sub.limit("open_banking") is False`), so
// the two can never disagree, and a future tier with the same restriction
// needs no change here. `tier` is exposed alongside it for copy that wants
// to name the plan, and is used as the fallback when an older API response
// carries no `limits` block at all.
//
// Caching mirrors lib/accountsCache.ts (module-level value + in-flight
// promise + TTL) for the same reason: Home and Accounts both need this on
// mount, and the answer changes only when a plan changes. `invalidate` is
// exported for whatever eventually performs an upgrade.

import { useEffect, useState } from "react";
import { api, SubscriptionInfo } from "@/lib/api";
import type { SubscriptionTier } from "@wealth/shared";

export const OPEN_BANKING_TTL_MS = 5 * 60_000;

let cache: { data: SubscriptionInfo; at: number } | null = null;
let inflight: Promise<SubscriptionInfo> | null = null;

export function invalidateOpenBankingAccess() {
  cache = null;
  inflight = null;
}

function getSubscriptionCached(): Promise<SubscriptionInfo> {
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

export interface OpenBankingAccess {
  /** False until the subscription has resolved. Callers must not render a
   *  Connect control while this is false — see the note below. */
  ready: boolean;
  /** Whether this plan includes open banking. Starts FALSE and only ever
   *  becomes true once the answer is known, which is what stops a Connect
   *  button flashing for a Statements-tier user and then vanishing (or
   *  worse, being tapped and answered with a 402). Upload Statement, the
   *  action every tier has, is therefore what shows while the answer is
   *  pending, and Connect is revealed additively. The alternative
   *  (optimistically showing Connect) fails in the direction that costs a
   *  free-tier user a dead end. */
  allowed: boolean;
  /** The plan name, for copy that wants to name it. Null until ready. */
  tier: SubscriptionTier | null;
}

/** Resolves the plan's open-banking entitlement without blocking the page.
 *  Nothing here gates rendering: the caller renders immediately with
 *  `ready: false`, then re-renders once the answer lands. A failed fetch
 *  settles to `ready: true, allowed: true` — an unreachable subscription
 *  endpoint must not lock a paying user out of connecting their bank, and
 *  the server still enforces the real gate either way. */
export function useOpenBankingAccess(): OpenBankingAccess {
  const [state, setState] = useState<OpenBankingAccess>({ ready: false, allowed: false, tier: null });

  useEffect(() => {
    let cancelled = false;
    getSubscriptionCached()
      .then((sub) => {
        if (cancelled) return;
        const allowed = sub.limits
          ? sub.limits.open_banking !== false
          : sub.tier !== "statements";
        setState({ ready: true, allowed, tier: sub.tier ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true, allowed: true, tier: null });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
