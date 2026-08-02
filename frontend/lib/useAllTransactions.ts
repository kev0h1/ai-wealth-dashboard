"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Transaction } from "@/lib/api";

// Module-level cache: one fetch per TTL across all consumers, in-flight dedupe.
let cache: { data: Transaction[]; at: number } | null = null;
let inflight: Promise<Transaction[]> | null = null;
const TTL_MS = 60_000;

async function fetchAll(force = false): Promise<Transaction[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = api.allTransactions()
      .then(d => { cache = { data: d, at: Date.now() }; return d; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function invalidateTransactionsCache() { cache = null; }

export function useAllTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>(cache?.data ?? []);
  const [loading, setLoading] = useState(!cache);
  const refresh = useCallback(async (force = false) => {
    const d = await fetchAll(force).catch(() => cache?.data ?? []);
    setTransactions(d);
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { transactions, loading, refresh, setTransactions };
}

/** Cached, lazy accessor for consumers that need the full set on demand
 *  (e.g. rule-builder search) without subscribing on mount. */
export function getAllTransactionsCached(): Promise<Transaction[]> { return fetchAll(); }
