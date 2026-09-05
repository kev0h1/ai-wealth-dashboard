"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Transaction } from "@/lib/api";

// Module-level cache: one fetch per TTL across all consumers, in-flight dedupe.
//
// Window audit (both consumers checked): api.allTransactions() defaults to
// 365 days (lib/api.ts). The two callers of this shared cache are
// SpendPage.tsx's `useAllTransactions` (feeding SpendTrends' allTxns prop)
// and AccountsPage.tsx's `getAllTransactionsCached` (the rule-builder's
// match-preview pool). Within SpendTrends, only PeriodCompareWidget reads
// allTxns at all (every other widget reads the current period only), and it
// walks back just 6 pay periods (~180 days worst case, since every pay
// period here runs payday-to-payday, roughly a calendar month) — nowhere
// near a year. The 365-day window is kept anyway for AccountsPage's rule
// builder: its live match-preview count needs to see as much of the
// account's real history as possible, since a rule's `backfill` applies
// server-side against the FULL history regardless of what this cache
// fetched — a shorter window here would just make the preview undercount
// against what actually gets backfilled. 365 is generous headroom for the
// chart (roughly double its real need) and the better number for the rule
// builder, so it stays; this comment exists so a future reader doesn't
// "fix" it down to ~180 days on the chart's account alone and quietly
// break the rule builder's preview accuracy.
let cache: { data: Transaction[]; at: number } | null = null;
let inflight: Promise<Transaction[]> | null = null;
const TTL_MS = 300_000;

async function fetchAll(force = false): Promise<Transaction[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = api.allTransactions()
      .then(d => { cache = { data: d, at: Date.now() }; return d; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function invalidateTransactionsCache() { cache = null; inflight = null; }

export function useAllTransactions(enabled = true) {
  const [transactions, setTransactions] = useState<Transaction[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!cache);
  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    const d = await fetchAll(force).catch(() => cache?.data ?? []);
    setTransactions(d);
    setLoading(false);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchAll()
      .catch(() => cache?.data ?? [])
      .then((data) => {
        if (cancelled) return;
        setTransactions(data);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return { transactions, loading: enabled && loading, refresh, setTransactions };
}

/** Cached, lazy accessor for consumers that need the full set on demand
 *  (e.g. rule-builder search) without subscribing on mount. */
export function getAllTransactionsCached(): Promise<Transaction[]> { return fetchAll(); }
