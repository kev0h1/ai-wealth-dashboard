import { useState, useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import type {
  Account, KPIs, InvestmentAccount, Transaction,
  CashflowData, GoalSummary, SavingsInsight, HomePreferences,
} from "./shared";

export interface HomeData {
  accounts: Account[];
  kpis: KPIs | null;
  investmentAccounts: InvestmentAccount[];
  transactions: Transaction[];
  cashflow: CashflowData | null;
  goals: GoalSummary[];
  spotlightInsight: SavingsInsight | null;
  preferences: HomePreferences | null;
  pinnedAccountIds: string[];
  region: string;
}

interface CachedData {
  data: HomeData;
  timestamp: number;
}

let cache: CachedData | null = null;

const CACHE_TTL = 60_000; // 60 seconds

export function useHomeData() {
  const [data, setData] = useState<HomeData | null>(cache?.data ?? null);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [hideBalances, setHideBalancesState] = useState(false);

  const isFetching = useRef(false);

  const fetchAll = useCallback(async (background = false) => {
    if (isFetching.current) return;
    isFetching.current = true;
    if (!background) setLoading(true);
    setError(false);

    try {
      // Parallel fetch: accounts, kpis, investmentAccounts
      const [accountsRes, kpisRes, investRes] = await Promise.allSettled([
        api.accounts(),
        api.kpis(),
        api.getInvestmentAccounts(),
      ]);

      const accounts = accountsRes.status === "fulfilled" ? accountsRes.value : [];
      const kpis = kpisRes.status === "fulfilled" ? kpisRes.value : null;
      const rawInvest = investRes.status === "fulfilled" ? investRes.value : [];
      // Map the raw investment response to InvestmentAccount shape
      const investmentAccounts: InvestmentAccount[] = rawInvest.map((r) => ({
        id: r.id,
        provider: r.provider,
        account_type: r.account_type,
        account_reference: "",
        currency: r.currency,
        total_value: r.total_value,
        statement_date: null,
        last_refreshed: null,
        updated_at: "",
      }));

      // If both accounts AND kpis fail → error state
      if (accountsRes.status === "rejected" && kpisRes.status === "rejected") {
        setError(true);
        return;
      }

      // Fetch transactions
      let transactions: Transaction[] = [];
      try {
        transactions = await api.transactionsDays(90);
      } catch {
        // non-fatal
      }

      // Parallel fetch remaining
      const [cashflowRes, goalsRes, spotlightRes, prefsRes, hideRes] = await Promise.allSettled([
        api.cashflow() as unknown as Promise<CashflowData>,
        api.goalsSummary(),
        api.getSpotlightInsight(),
        api.getHomePreferences(),
        SecureStore.getItemAsync("hide_balances"),
      ]);

      const cashflow = cashflowRes.status === "fulfilled" ? cashflowRes.value : null;
      const goals = goalsRes.status === "fulfilled" ? goalsRes.value.goals : [];
      const spotlightInsight = spotlightRes.status === "fulfilled" ? spotlightRes.value : null;
      const preferences = prefsRes.status === "fulfilled" ? prefsRes.value : null;
      const hideVal = hideRes.status === "fulfilled" ? hideRes.value : null;

      if (!background) {
        setHideBalancesState(hideVal === "1");
      }

      const pinnedAccountIds = preferences?.home_pinned_accounts ?? [];
      const region = preferences?.region ?? "GB";

      const homeData: HomeData = {
        accounts,
        kpis,
        investmentAccounts,
        transactions,
        cashflow,
        goals,
        spotlightInsight,
        preferences,
        pinnedAccountIds,
        region,
      };

      cache = { data: homeData, timestamp: Date.now() };
      setData(homeData);
    } catch {
      setError(true);
    } finally {
      isFetching.current = false;
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const stale = !cache || now - cache.timestamp > CACHE_TTL;

      if (cache && !stale) {
        // Use cache immediately
        setData(cache.data);
        setLoading(false);
      } else if (cache && stale) {
        // Use cache immediately, refetch in background
        setData(cache.data);
        setLoading(false);
        fetchAll(true);
      } else {
        // No cache — full load
        fetchAll(false);
      }
    }, [fetchAll]),
  );

  const refresh = useCallback(async () => {
    cache = null;
    await fetchAll(false);
  }, [fetchAll]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(false);
    try {
      await api.syncAll();
      cache = null;
      await fetchAll(true);
    } catch {
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  }, [fetchAll]);

  const toggleHideBalances = useCallback(async () => {
    const next = !hideBalances;
    setHideBalancesState(next);
    await SecureStore.setItemAsync("hide_balances", next ? "1" : "0");
  }, [hideBalances]);

  return {
    data,
    loading,
    error,
    refresh,
    syncing,
    syncError,
    handleSync,
    hideBalances,
    toggleHideBalances,
  };
}
