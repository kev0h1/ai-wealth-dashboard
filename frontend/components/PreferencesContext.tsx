"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { api, DebtBurndownOverrides } from "@/lib/api";
import { PayPeriodConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { shouldAcceptPreferencesSnapshot } from "@/lib/preferencesVersion";

export type Region = "UK" | "Kenya";

interface Prefs {
  hideNetWorth: boolean;
  /** False until the server preference has settled. Consumers showing money
   * should mask while this is false to avoid a privacy flash. */
  preferencesReady: boolean;
  darkMode: boolean;
  payPeriodConfig: PayPeriodConfig;
  region: Region;
  debtTargetMonths: number;
  debtTrackingStart: string;
  spendWidgets: string[] | null;
  homePinnedWidget: string | null;
  // "What-if" overrides for the debt_burndown Spend widget — local
  // experimentation only, never written back to the account/card records.
  debtBurndownOverrides: DebtBurndownOverrides | null;
  rawPrefs: Record<string, any> | null;
}
interface PrefsCtx extends Prefs {
  setHideNetWorth: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setPayPeriodConfig: (c: PayPeriodConfig) => void;
  setRegion: (r: Region) => void;
  setDebtTargetMonths: (n: number) => void;
  setDebtTrackingStart: (s: string) => void;
  setSpendWidgets: (v: string[]) => void;
  setHomePinnedWidget: (v: string | null) => void;
  setDebtBurndownOverrides: (v: DebtBurndownOverrides | null) => void;
  /** Re-runs the same GET /preferences fetch the mount effect uses and
   * re-applies every field, including `rawPrefs`. For callers (B13:
   * Settings' Penny "Turn off" control) that just made a server-side
   * preferences change through a DIFFERENT endpoint (DELETE
   * /penny/agent-consent, not PATCH /preferences) and need the locally
   * cached `rawPrefs` to catch up rather than issuing a second bespoke
   * fetch, or (G45) a caller reconciling after a failed direct
   * api.updatePreferences() call that needs the server's ACTUAL current
   * value, not a locally-captured pre-write snapshot. Returns the accepted
   * snapshot (the same shape as api.getPreferences()), or null if the fetch
   * failed or was discarded as stale by the version-freshness rule below —
   * a null return means "nothing changed, rawPrefs is still whatever it
   * was", not "the server has no data". */
  refreshPreferences: () => Promise<Record<string, any> | null>;
  /** Registers a version a caller already knows about — typically the
   * `version` field on the response of a DIRECT api.updatePreferences()
   * call a component made itself (e.g. SettingsPage's cover-plan toggle),
   * without going through refreshPreferences()/loadPreferences(). This is
   * what lets the freshness rule reject a GET snapshot that predates that
   * write even though the write never went through this context's own
   * fetch path. A no-op if `version` isn't a finite number, or isn't newer
   * than what's already been accepted. */
  notePreferencesVersion: (version: number | null | undefined) => void;
}

const todayYM = () => new Date().toISOString().slice(0, 7);

const Ctx = createContext<PrefsCtx>({
  hideNetWorth: true,
  preferencesReady: false,
  darkMode: false,
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  region: "UK",
  debtTargetMonths: 12,
  debtTrackingStart: todayYM(),
  spendWidgets: null,
  homePinnedWidget: null,
  debtBurndownOverrides: null,
  rawPrefs: null,
  setHideNetWorth: () => {},
  setDarkMode: () => {},
  setPayPeriodConfig: () => {},
  setRegion: () => {},
  setDebtTargetMonths: () => {},
  setDebtTrackingStart: () => {},
  setSpendWidgets: () => {},
  setHomePinnedWidget: () => {},
  setDebtBurndownOverrides: () => {},
  refreshPreferences: () => Promise.resolve(null),
  notePreferencesVersion: () => {},
});

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [hideNetWorth, setHideNetWorthState] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem("wd_hide_balances");
      return saved == null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [darkMode, setDarkModeState] = useState(() => {
    // Match the pre-paint inline script in layout.tsx so hydration doesn't undo it
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("wd_dark") === "1"; } catch { return false; }
  });
  const [payPeriodConfig, setPayPeriodConfigState] = useState<PayPeriodConfig>(DEFAULT_PAY_PERIOD_CONFIG);
  const [region, setRegionState] = useState<Region>("UK");
  const [debtTargetMonths, setDebtTargetMonthsState] = useState(12);
  const [debtTrackingStart, setDebtTrackingStartState] = useState(todayYM());
  const [spendWidgets, setSpendWidgetsState] = useState<string[] | null>(null);
  const [homePinnedWidget, setHomePinnedWidgetState] = useState<string | null>(null);
  const [debtBurndownOverrides, setDebtBurndownOverridesState] = useState<DebtBurndownOverrides | null>(null);
  const [rawPrefs, setRawPrefs] = useState<Record<string, any> | null>(null);

  // G45 (second re-review): the highest preferences `version` this context
  // has ever accepted, from ANY source — its own GET, or a direct
  // api.updatePreferences() caller reporting its own PATCH response via
  // notePreferencesVersion(). -1 means "nothing accepted yet", which is
  // deliberately lower than the 0 GET /preferences returns for a user with
  // no document at all, so that very first real snapshot is always
  // accepted. A ref, not state: this is a monotonic bookkeeping value for
  // the freshness comparison, not something a screen re-renders on.
  const preferencesVersionRef = useRef<number>(-1);

  const notePreferencesVersion = useCallback((version: number | null | undefined) => {
    if (typeof version !== "number" || !Number.isFinite(version)) return;
    if (version > preferencesVersionRef.current) {
      preferencesVersionRef.current = version;
    }
  }, []);

  // Shared by the mount effect below and refreshPreferences() (B13): ONE
  // place that fetches GET /preferences and applies every field, so a
  // caller that changed a preference through a different endpoint (DELETE
  // /penny/agent-consent, not PATCH /preferences) can bring this context's
  // cached state back in sync without duplicating the field-by-field apply
  // logic. useCallback with no deps: every setter here is itself a stable
  // setState function, so this identity never needs to change.
  //
  // G45 (second re-review): every fetched snapshot is checked against
  // shouldAcceptPreferencesSnapshot() before anything is applied. A stale
  // snapshot (e.g. a slow app-boot GET that resolves after a PATCH has
  // already landed and been accepted) is discarded wholesale — no partial
  // apply — and this resolves to null so a caller (refreshPreferences())
  // knows nothing changed. A snapshot that IS accepted updates
  // preferencesVersionRef so a still-slower, even-more-stale response
  // arriving later is rejected too.
  const loadPreferences = useCallback((): Promise<Record<string, any> | null> => {
    return api.getPreferences().then(p => {
      const incomingVersion = (p as any).version;
      if (!shouldAcceptPreferencesSnapshot(incomingVersion, preferencesVersionRef.current)) {
        return null;
      }
      if (typeof incomingVersion === "number" && Number.isFinite(incomingVersion)) {
        preferencesVersionRef.current = incomingVersion;
      }
      setHideNetWorthState(p.hide_net_worth);
      try { localStorage.setItem("wd_hide_balances", p.hide_net_worth ? "1" : "0"); } catch {}
      if (p.dark_mode !== undefined) {
        setDarkModeState(p.dark_mode);
        try { localStorage.setItem("wd_dark", p.dark_mode ? "1" : "0"); } catch {}
      }
      if ((p as any).pay_period_config) setPayPeriodConfigState((p as any).pay_period_config as PayPeriodConfig);
      if ((p as any).region) setRegionState((p as any).region as Region);
      if ((p as any).debt_target_months) setDebtTargetMonthsState((p as any).debt_target_months as number);
      if ((p as any).debt_tracking_start) setDebtTrackingStartState((p as any).debt_tracking_start as string);
      if (Array.isArray(p.spend_widgets)) setSpendWidgetsState(p.spend_widgets as string[]);
      if (p.home_pinned_widget !== undefined) setHomePinnedWidgetState(p.home_pinned_widget ?? null);
      if ((p as any).debt_burndown_overrides !== undefined) setDebtBurndownOverridesState((p as any).debt_burndown_overrides ?? null);
      setRawPrefs(p as any);
      return p as any;
    }).catch(() => null);
  }, []);

  useEffect(() => {
    loadPreferences().finally(() => setPreferencesReady(true));
  }, [loadPreferences]);

  const refreshPreferences = useCallback(() => loadPreferences(), [loadPreferences]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const setHideNetWorth = useCallback((v: boolean) => {
    setHideNetWorthState(v);
    try { localStorage.setItem("wd_hide_balances", v ? "1" : "0"); } catch {}
    api.updatePreferences({ hide_net_worth: v }).catch(() => {});
  }, []);

  const setDarkMode = useCallback((v: boolean) => {
    setDarkModeState(v);
    try { localStorage.setItem("wd_dark", v ? "1" : "0"); } catch {}
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

  const setSpendWidgets = useCallback((v: string[]) => {
    setSpendWidgetsState(v);
  }, []);

  const setHomePinnedWidget = useCallback((v: string | null) => {
    setHomePinnedWidgetState(v);
  }, []);

  const setDebtBurndownOverrides = useCallback((v: DebtBurndownOverrides | null) => {
    setDebtBurndownOverridesState(v);
  }, []);

  return (
    <Ctx.Provider value={{
      hideNetWorth, preferencesReady, darkMode, payPeriodConfig, region, debtTargetMonths, debtTrackingStart,
      spendWidgets, homePinnedWidget, debtBurndownOverrides, rawPrefs,
      setHideNetWorth, setDarkMode, setPayPeriodConfig, setRegion, setDebtTargetMonths, setDebtTrackingStart,
      setSpendWidgets, setHomePinnedWidget, setDebtBurndownOverrides, refreshPreferences,
      notePreferencesVersion,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() { return useContext(Ctx); }
