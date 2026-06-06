"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { PayPeriodConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";

export type Region = "UK" | "Kenya";

interface Prefs {
  hideNetWorth: boolean;
  darkMode: boolean;
  payPeriodConfig: PayPeriodConfig;
  region: Region;
  debtTargetMonths: number;
  debtTrackingStart: string;
}
interface PrefsCtx extends Prefs {
  setHideNetWorth: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setPayPeriodConfig: (c: PayPeriodConfig) => void;
  setRegion: (r: Region) => void;
  setDebtTargetMonths: (n: number) => void;
  setDebtTrackingStart: (s: string) => void;
}

const todayYM = () => new Date().toISOString().slice(0, 7);

const Ctx = createContext<PrefsCtx>({
  hideNetWorth: false,
  darkMode: false,
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  region: "UK",
  debtTargetMonths: 12,
  debtTrackingStart: todayYM(),
  setHideNetWorth: () => {},
  setDarkMode: () => {},
  setPayPeriodConfig: () => {},
  setRegion: () => {},
  setDebtTargetMonths: () => {},
  setDebtTrackingStart: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [hideNetWorth, setHideNetWorthState] = useState(false);
  const [darkMode, setDarkModeState] = useState(false);
  const [payPeriodConfig, setPayPeriodConfigState] = useState<PayPeriodConfig>(DEFAULT_PAY_PERIOD_CONFIG);
  const [region, setRegionState] = useState<Region>("UK");
  const [debtTargetMonths, setDebtTargetMonthsState] = useState(12);
  const [debtTrackingStart, setDebtTrackingStartState] = useState(todayYM());

  useEffect(() => {
    api.getPreferences().then(p => {
      setHideNetWorthState(p.hide_net_worth);
      if (p.dark_mode !== undefined) setDarkModeState(p.dark_mode);
      if ((p as any).pay_period_config) setPayPeriodConfigState((p as any).pay_period_config as PayPeriodConfig);
      if ((p as any).region) setRegionState((p as any).region as Region);
      if ((p as any).debt_target_months) setDebtTargetMonthsState((p as any).debt_target_months as number);
      if ((p as any).debt_tracking_start) setDebtTrackingStartState((p as any).debt_tracking_start as string);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

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
    api.updatePreferences({ pay_period_config: config } as any).catch(() => {});
  }, []);

  const setRegion = useCallback((r: Region) => {
    setRegionState(r);
    api.updatePreferences({ region: r } as any).catch(() => {});
  }, []);

  const setDebtTargetMonths = useCallback((n: number) => {
    setDebtTargetMonthsState(n);
    api.updatePreferences({ debt_target_months: n } as any).catch(() => {});
  }, []);

  const setDebtTrackingStart = useCallback((s: string) => {
    setDebtTrackingStartState(s);
    api.updatePreferences({ debt_tracking_start: s } as any).catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ hideNetWorth, darkMode, payPeriodConfig, region, debtTargetMonths, debtTrackingStart, setHideNetWorth, setDarkMode, setPayPeriodConfig, setRegion, setDebtTargetMonths, setDebtTrackingStart }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() { return useContext(Ctx); }
