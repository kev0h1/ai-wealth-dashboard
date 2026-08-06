import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { AsyncStorage } from "@/lib/asyncStorage";
import { api } from "@/lib/api";

const PREFS_CACHE_KEY = "wd_prefs_cache";

export type Region = "UK" | "Kenya";

export interface PayPeriodConfig {
  type: "weekly" | "biweekly" | "day_of_month" | "last_weekday" | null;
  weekday?: number;
  day?: number;
  anchor?: string;
}

export const DEFAULT_PAY_PERIOD_CONFIG: PayPeriodConfig = { type: null };

interface Prefs {
  hideNetWorth: boolean;
  darkMode: boolean;
  payPeriodConfig: PayPeriodConfig;
  region: Region;
  debtTargetMonths: number;
  homePinnedWidget: string | null;
  rawPrefs: Record<string, unknown> | null;
}

interface PrefsCtx extends Prefs {
  setHideNetWorth: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setPayPeriodConfig: (c: PayPeriodConfig) => void;
  setRegion: (r: Region) => void;
  setDebtTargetMonths: (n: number) => void;
  setHomePinnedWidget: (v: string | null) => void;
}

const Ctx = createContext<PrefsCtx>({
  hideNetWorth: false,
  darkMode: false,
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  region: "UK",
  debtTargetMonths: 12,
  homePinnedWidget: null,
  rawPrefs: null,
  setHideNetWorth: () => {},
  setDarkMode: () => {},
  setPayPeriodConfig: () => {},
  setRegion: () => {},
  setDebtTargetMonths: () => {},
  setHomePinnedWidget: () => {},
});

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [hideNetWorth, setHideNetWorthState] = useState(false);
  const [darkMode, setDarkModeState] = useState(false);
  const [payPeriodConfig, setPayPeriodConfigState] = useState<PayPeriodConfig>(DEFAULT_PAY_PERIOD_CONFIG);
  const [region, setRegionState] = useState<Region>("UK");
  const [debtTargetMonths, setDebtTargetMonthsState] = useState(12);
  const [homePinnedWidget, setHomePinnedWidgetState] = useState<string | null>(null);
  const [rawPrefs, setRawPrefs] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    // Load from cache first for instant render
    AsyncStorage.getItem(PREFS_CACHE_KEY)
      .then((raw) => {
        if (raw) {
          const p = JSON.parse(raw) as Record<string, unknown>;
          applyPrefs(p);
        }
      })
      .catch(() => {});

    // Then fetch fresh from API
    api.getPreferences()
      .then((p) => {
        const raw = p as unknown as Record<string, unknown>;
        applyPrefs(raw);
        AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(raw)).catch(() => {});
        setRawPrefs(raw);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPrefs(p: Record<string, unknown>) {
    if (typeof p.hide_net_worth === "boolean") setHideNetWorthState(p.hide_net_worth);
    if (typeof p.dark_mode === "boolean") setDarkModeState(p.dark_mode);
    if (p.pay_period_config) setPayPeriodConfigState(p.pay_period_config as PayPeriodConfig);
    if (typeof p.region === "string") setRegionState(p.region as Region);
    if (typeof p.debt_target_months === "number") setDebtTargetMonthsState(p.debt_target_months);
    if (p.home_pinned_widget !== undefined) setHomePinnedWidgetState((p.home_pinned_widget as string) ?? null);
  }

  const setHideNetWorth = useCallback((v: boolean) => {
    setHideNetWorthState(v);
    api.updatePreferences({ hide_net_worth: v }).catch(() => {});
  }, []);

  const setDarkMode = useCallback((v: boolean) => {
    setDarkModeState(v);
    api.updatePreferences({ dark_mode: v }).catch(() => {});
  }, []);

  const setPayPeriodConfig = useCallback((config: PayPeriodConfig) => {
    setPayPeriodConfigState(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.updatePreferences({ pay_period_config: config } as any).catch(() => {});
  }, []);

  const setRegion = useCallback((r: Region) => {
    setRegionState(r);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.updatePreferences({ region: r } as any).catch(() => {});
  }, []);

  const setDebtTargetMonths = useCallback((n: number) => {
    setDebtTargetMonthsState(n);
  }, []);

  const setHomePinnedWidget = useCallback((v: string | null) => {
    setHomePinnedWidgetState(v);
  }, []);

  return (
    <Ctx.Provider value={{
      hideNetWorth, darkMode, payPeriodConfig, region, debtTargetMonths,
      homePinnedWidget, rawPrefs,
      setHideNetWorth, setDarkMode, setPayPeriodConfig, setRegion,
      setDebtTargetMonths, setHomePinnedWidget,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() { return useContext(Ctx); }
