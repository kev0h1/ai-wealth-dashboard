"use client";
import { useCallback, useEffect, useState } from "react";
import { api, Transaction } from "@/lib/api";

// Module-level cache: one fetch per TTL across all consumers, in-flight dedupe.
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
