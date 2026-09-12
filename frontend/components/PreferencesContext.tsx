"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { api, DebtBurndownOverrides } from "@/lib/api";
import { PayPeriodConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { shouldAcceptPreferencesSnapshot } from "@/lib/preferencesVersion";
import { createPreferenceSaver } from "@/lib/preferenceSave";
import { createSerialQueue } from "@/lib/serialQueue";

export type Region = "UK" | "Kenya";

/** G60: which of this context's six server-backed setters last failed to
 * save, and what to tell the user. A single slot, not one per field — only
 * `dark_mode` has a wired consumer today (the toggle in SettingsPage.tsx),
 * so a second field failing while an unrelated one's message is still
 * showing is not a scenario any current screen can even present; should a
 * future control for hideNetWorth/payPeriodConfig/region/debtTargetMonths/
 * debtTrackingStart want its own message, widening this to a per-field map
 * is a small change, not a redesign of the mechanism. Every one of the six
 * setters still fully reverts-and-reconciles on failure regardless of
 * whether anything reads this field — the correctness guarantee never
 * depends on a message being shown. */
export interface PreferencesSaveError {
  field: string;
  message: string;
}

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
  /** See PreferencesSaveError above. Cleared automatically the next time
   * the same field's setter is called (success or failure). */
  preferencesSaveError: PreferencesSaveError | null;
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
   * fetch, or (G45, and now G60) a caller reconciling after a failed
   * direct api.updatePreferences() call that needs the server's ACTUAL
   * current value, not a locally-captured pre-write snapshot. Returns the
   * accepted snapshot (the same shape as api.getPreferences()), or null if
   * the fetch failed or was discarded as stale by the version-freshness
   * rule below — a null return means "nothing changed, rawPrefs is still
   * whatever it was", not "the server has no data". */
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
  preferencesSaveError: null,
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
  const [preferencesSaveError, setPreferencesSaveError] = useState<PreferencesSaveError | null>(null);

  // G60: every setState below that must also stay in step with a ref (so a
  // queued lib/preferenceSave.ts save always reads the TRUE current value,
  // never one captured when the caller invoked the setter — see that
  // module's own docstring, point 3) is routed through one of these
  // apply* wrappers rather than the raw setState. Each wrapper is the ONE
  // place its field's ref and localStorage mirror (where one exists) are
  // kept in lockstep with state, whether the new value came from the
  // mount-time GET, a direct setter call, or a failure-path reconciliation.
  const hideNetWorthRef = useRef(hideNetWorth);
  const applyHideNetWorth = useCallback((v: boolean) => {
    hideNetWorthRef.current = v;
    setHideNetWorthState(v);
    try { localStorage.setItem("wd_hide_balances", v ? "1" : "0"); } catch {}
  }, []);

  const darkModeRef = useRef(darkMode);
  const applyDarkMode = useCallback((v: boolean) => {
    darkModeRef.current = v;
    setDarkModeState(v);
    try { localStorage.setItem("wd_dark", v ? "1" : "0"); } catch {}
  }, []);

  const payPeriodConfigRef = useRef(payPeriodConfig);
  const applyPayPeriodConfig = useCallback((v: PayPeriodConfig) => {
    payPeriodConfigRef.current = v;
    setPayPeriodConfigState(v);
  }, []);

  const regionRef = useRef(region);
  const applyRegion = useCallback((v: Region) => {
    regionRef.current = v;
    setRegionState(v);
  }, []);

  const debtTargetMonthsRef = useRef(debtTargetMonths);
  const applyDebtTargetMonths = useCallback((v: number) => {
    debtTargetMonthsRef.current = v;
    setDebtTargetMonthsState(v);
  }, []);

  const debtTrackingStartRef = useRef(debtTrackingStart);
  const applyDebtTrackingStart = useCallback((v: string) => {
    debtTrackingStartRef.current = v;
    setDebtTrackingStartState(v);
  }, []);

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

  // Shared by the mount effect below, refreshPreferences() (B13), and now
  // every field's failure-path reconciliation (G60, via lib/preferenceSave.ts's
  // `reconcile`): ONE place that fetches GET /preferences and applies every
  // field, so a caller that changed a preference through a different
  // endpoint (DELETE /penny/agent-consent, not PATCH /preferences), or one
  // reconciling after a failed write, can bring this context's cached state
  // back in sync without duplicating the field-by-field apply logic.
  // useCallback with no deps: every apply* wrapper above is itself a stable
  // useCallback, so this identity never needs to change.
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
      applyHideNetWorth(p.hide_net_worth);
      if (p.dark_mode !== undefined) applyDarkMode(p.dark_mode);
      if ((p as any).pay_period_config) applyPayPeriodConfig((p as any).pay_period_config as PayPeriodConfig);
      if ((p as any).region) applyRegion((p as any).region as Region);
      if ((p as any).debt_target_months) applyDebtTargetMonths((p as any).debt_target_months as number);
      if ((p as any).debt_tracking_start) applyDebtTrackingStart((p as any).debt_tracking_start as string);
      if (Array.isArray(p.spend_widgets)) setSpendWidgetsState(p.spend_widgets as string[]);
      if (p.home_pinned_widget !== undefined) setHomePinnedWidgetState(p.home_pinned_widget ?? null);
      if ((p as any).debt_burndown_overrides !== undefined) setDebtBurndownOverridesState((p as any).debt_burndown_overrides ?? null);
      setRawPrefs(p as any);
      return p as any;
    }).catch(() => null);
  }, [applyHideNetWorth, applyDarkMode, applyPayPeriodConfig, applyRegion, applyDebtTargetMonths, applyDebtTrackingStart]);

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

  // G60: sets/clears preferencesSaveError for exactly one field, leaving any
  // other field's currently-shown message alone (see PreferencesSaveError's
  // own docstring above for why this is a single slot rather than a map).
  const makeFieldErrorHandler = useCallback((field: string) => (message: string | null) => {
    setPreferencesSaveError(prev => {
      if (message === null) return prev && prev.field === field ? null : prev;
      return { field, message };
    });
  }, []);

  // G60: the six setters below used to fire setState (impure updater risk
  // was never present here — they always took a plain value, not an
  // updater — but still) then `api.updatePreferences(...).catch(() => {})`,
  // so a failed save left the app displaying a setting the server never
  // stored, forever, with nothing told to the user and no way for a later
  // refetch to correct it (the mount-time GET had already run once).
  // lib/preferenceSave.ts's createPreferenceSaver gives all six the same
  // shape G45/G52/G58 established for cover-plan exclusions, notification
  // prefs and child benefit: one write in flight per field (its own
  // serialQueue), `previous` read from the ref above rather than a value
  // closed over here, and on failure a reconcile-from-server (this
  // context's own refreshPreferences/loadPreferences) with a fall back to
  // `previous` only when the server has nothing to offer either.
  //
  // Each saver is created exactly once (useRef) and only ever closes over
  // stable identities — the apply* wrappers and notePreferencesVersion are
  // useCallback with empty deps, refreshPreferences is useCallback keyed
  // only on the (itself stable) loadPreferences, and makeFieldErrorHandler
  // is useCallback with empty deps — so there is no staleness risk from
  // creating it once.
  const hideNetWorthSaver = useRef(createPreferenceSaver<boolean>({
    queue: createSerialQueue(),
    getCurrent: () => hideNetWorthRef.current,
    apply: applyHideNetWorth,
    save: (v) => api.updatePreferences({ hide_net_worth: v }),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server ? (server.hide_net_worth as boolean) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("hide_net_worth"),
  })).current;

  const darkModeSaver = useRef(createPreferenceSaver<boolean>({
    queue: createSerialQueue(),
    getCurrent: () => darkModeRef.current,
    apply: applyDarkMode,
    save: (v) => api.updatePreferences({ dark_mode: v }),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server && server.dark_mode !== undefined ? (server.dark_mode as boolean) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("dark_mode"),
  })).current;

  const payPeriodConfigSaver = useRef(createPreferenceSaver<PayPeriodConfig>({
    queue: createSerialQueue(),
    getCurrent: () => payPeriodConfigRef.current,
    apply: applyPayPeriodConfig,
    save: (v) => api.updatePreferences({ pay_period_config: v } as any),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server && (server as any).pay_period_config ? ((server as any).pay_period_config as PayPeriodConfig) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("pay_period_config"),
  })).current;

  const regionSaver = useRef(createPreferenceSaver<Region>({
    queue: createSerialQueue(),
    getCurrent: () => regionRef.current,
    apply: applyRegion,
    save: (v) => api.updatePreferences({ region: v } as any),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server && (server as any).region ? ((server as any).region as Region) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("region"),
  })).current;

  const debtTargetMonthsSaver = useRef(createPreferenceSaver<number>({
    queue: createSerialQueue(),
    getCurrent: () => debtTargetMonthsRef.current,
    apply: applyDebtTargetMonths,
    save: (v) => api.updatePreferences({ debt_target_months: v } as any),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server && (server as any).debt_target_months ? ((server as any).debt_target_months as number) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("debt_target_months"),
  })).current;

  const debtTrackingStartSaver = useRef(createPreferenceSaver<string>({
    queue: createSerialQueue(),
    getCurrent: () => debtTrackingStartRef.current,
    apply: applyDebtTrackingStart,
    save: (v) => api.updatePreferences({ debt_tracking_start: v } as any),
    reconcile: async () => {
      const server = await refreshPreferences();
      return server && (server as any).debt_tracking_start ? ((server as any).debt_tracking_start as string) : undefined;
    },
    noteVersion: notePreferencesVersion,
    onError: makeFieldErrorHandler("debt_tracking_start"),
  })).current;

  const setHideNetWorth = useCallback((v: boolean) => { void hideNetWorthSaver.run(v); }, [hideNetWorthSaver]);
  const setDarkMode = useCallback((v: boolean) => { void darkModeSaver.run(v); }, [darkModeSaver]);
  const setPayPeriodConfig = useCallback((c: PayPeriodConfig) => { void payPeriodConfigSaver.run(c); }, [payPeriodConfigSaver]);
  const setRegion = useCallback((r: Region) => { void regionSaver.run(r); }, [regionSaver]);
  const setDebtTargetMonths = useCallback((n: number) => { void debtTargetMonthsSaver.run(n); }, [debtTargetMonthsSaver]);
  const setDebtTrackingStart = useCallback((s: string) => { void debtTrackingStartSaver.run(s); }, [debtTrackingStartSaver]);

  // spend_widgets and home_pinned_widget are NOT persisted from here — the
  // one caller (components/SpendTrends.tsx) owns the api.updatePreferences
  // call itself (via its own lib/preferenceSave.ts savers, G60) and calls
  // these purely to keep this context's copy — read by other consumers,
  // e.g. HomePage's pinned-widget card — in step. Unchanged from before G60.
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
      spendWidgets, homePinnedWidget, debtBurndownOverrides, rawPrefs, preferencesSaveError,
      setHideNetWorth, setDarkMode, setPayPeriodConfig, setRegion, setDebtTargetMonths, setDebtTrackingStart,
      setSpendWidgets, setHomePinnedWidget, setDebtBurndownOverrides, refreshPreferences,
      notePreferencesVersion,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePreferences() { return useContext(Ctx); }
