"use client";
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { PayPeriodConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";

interface Prefs { hideNetWorth: boolean; darkMode: boolean; payPeriodConfig: PayPeriodConfig }
interface PrefsCtx extends Prefs {
  setHideNetWorth: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setPayPeriodConfig: (c: PayPeriodConfig) => void;
}

const Ctx = createContext<PrefsCtx>({
  hideNetWorth: false,
  darkMode: false,
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  setHideNetWorth: () => {},
  setDarkMode: () => {},
  setPayPeriodConfig: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [hideNetWorth, setHideNetWorthState] = useState(false);
  const [darkMode, setDarkModeState] = useState(false);
  const [payPeriodConfig, setPayPeriodConfigState] = useState<PayPeriodConfig>(DEFAULT_PAY_PERIOD_CONFIG);

  useEffect(() => {
    api.getPreferences().then(p => {
      setHideNetWorthState(p.hide_net_worth);
      if (p.dark_mode !== undefined) setDarkModeState(p.dark_mode);
      if ((p as any).pay_period_config) setPayPeriodConfigState((p as any).pay_period_config as PayPeriodConfig);
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

  return (
    <Ctx.Provider value={{ hideNetWorth, darkMode, payPeriodConfig, setHideNetWorth, setDarkMode, setPayPeriodConfig }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() { return useContext(Ctx); }
