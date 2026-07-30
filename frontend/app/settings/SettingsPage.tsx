"use client";

import { useEffect, useState } from "react";
import { RotateCcw, LogOut, Loader2, AlertCircle, Bell, BellOff, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { api, NotificationPrefs } from "@/lib/api";
import BottomNav from "@/components/BottomNav";
import TutorialTrigger from "@/components/TutorialTrigger";
import Toggle from "@/components/Toggle";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { darkMode, setDarkMode, rawPrefs } = usePreferences();

  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncHistoryMsg, setSyncHistoryMsg] = useState<{ text: string; ok: boolean } | null>(null);

  type NotifPermission = "granted" | "denied" | "default" | "unsupported" | "native";
  const [notifPermission, setNotifPermission] = useState<NotifPermission>("unsupported");
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);

  const [incomeBracket, setIncomeBracket] = useState("");
  const [incomeInput, setIncomeInput] = useState("");
  const [pensionAnnual, setPensionAnnual] = useState("");
  const [hasChildBenefit, setHasChildBenefit] = useState(false);
  const [financeMsg, setFinanceMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Biometric lock — the preference lives in the native shell (the gate runs
  // before this page loads), so read/write goes over the message bridge
  const [bioState, setBioState] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  useEffect(() => {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    if (!rn) return;
    const id = Math.random().toString(36).slice(2);
    const onResult = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.id !== id) return;
      window.removeEventListener("native-biometrics", onResult);
      setBioState({ supported: !!d.supported, enabled: !!d.enabled });
    };
    window.addEventListener("native-biometrics", onResult);
    rn.postMessage(JSON.stringify({ type: "biometrics:get", id }));
    return () => window.removeEventListener("native-biometrics", onResult);
  }, []);

  function toggleBiometrics() {
    if (!bioState) return;
    const next = !bioState.enabled;
    setBioState({ ...bioState, enabled: next });
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    rn?.postMessage(JSON.stringify({ type: "biometrics:set", enabled: next }));
  }

  // Profile editing
  const [profileName, setProfileName] = useState("");
  const [profilePostcode, setProfilePostcode] = useState("");
  const [profileLoaded, setProfileLoaded] = useState<{ name: string; postcode: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const profileDirty = profileLoaded !== null &&
    (profileName !== profileLoaded.name || profilePostcode !== profileLoaded.postcode);

  // Account deletion
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (rawPrefs === null) return;
    if (rawPrefs.notification_prefs) setNotifPrefs(rawPrefs.notification_prefs);
    if (rawPrefs.income_bracket) setIncomeBracket(rawPrefs.income_bracket);
    if (rawPrefs.income_value) setIncomeInput(String(rawPrefs.income_value));
    if (rawPrefs.pension_annual) setPensionAnnual(String(rawPrefs.pension_annual));
    if (rawPrefs.has_child_benefit) setHasChildBenefit(rawPrefs.has_child_benefit);
  }, [rawPrefs]);

  useEffect(() => {
    api.getProfile().then(p => {
      setProfileName(p.full_name ?? "");
      setProfilePostcode(p.postcode ?? "");
      setProfileLoaded({ name: p.full_name ?? "", postcode: p.postcode ?? "" });
    }).catch(() => {});
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const p = await api.updateProfile(profileName.trim(), profilePostcode.trim());
      setProfileName(p.full_name ?? "");
      setProfilePostcode(p.postcode ?? "");
      setProfileLoaded({ name: p.full_name ?? "", postcode: p.postcode ?? "" });
      setProfileMsg({ text: "Profile saved", ok: true });
    } catch (e) {
      setProfileMsg({ text: e instanceof Error ? e.message : "Could not save profile", ok: false });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE" || deleting) return;
    setDeleting(true);
    try {
      await api.deleteUserAccount();
      logout();
    } catch {
      setDeleting(false);
      setProfileMsg({ text: "Deletion failed — try again", ok: false });
    }
  }

  // Show 107,000 not 107000 — state stays raw digits, parsing is unchanged
  const fmtDigits = (v: string) => (v ? Number(v).toLocaleString("en-GB") : "");

  function handleIncomeBlur() {
    const n = parseInt(incomeInput.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setIncomeInput(value === 0 ? "" : String(value));
    // Bracket is derived from the salary — mirror the backend derivation locally
    // so the pension/child-benefit fields appear without a refetch
    setIncomeBracket(value < 100_000 ? "under_100k" : value <= 125_140 ? "100k_125k" : "125k_plus");
    setFinanceMsg(null);
    api.updatePreferences({ income_value: value }).then(() => {
      setFinanceMsg({ text: "Saved", ok: true });
      setTimeout(() => setFinanceMsg(null), 2000);
    }).catch((e: unknown) => {
      setFinanceMsg({ text: e instanceof Error ? e.message : "Could not save", ok: false });
    });
  }

  function handlePensionBlur() {
    const n = parseInt(pensionAnnual.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setPensionAnnual(value === 0 ? "" : String(value));
    setFinanceMsg(null);
    api.updatePreferences({ pension_annual: value }).then(() => {
      setFinanceMsg({ text: "Saved", ok: true });
      setTimeout(() => setFinanceMsg(null), 2000);
    }).catch((e: unknown) => {
      setFinanceMsg({ text: e instanceof Error ? e.message : "Could not save", ok: false });
    });
  }

  function handleChildBenefitToggle() {
    const next = !hasChildBenefit;
    setHasChildBenefit(next);
    api.updatePreferences({ has_child_benefit: next }).catch(() => {});
  }

  function toggleNotifPref(key: keyof NotificationPrefs) {
    setNotifPrefs(prev => {
      if (!prev) return prev;
      const next = { ...prev, [key]: !prev[key] };
      api.updatePreferences({ notification_prefs: next }).catch(() => {});
      return next;
    });
  }

  useEffect(() => {
    // Inside the mobile app's WebView, push is handled natively via Expo —
    // web push APIs are absent but notifications still work.
    if (typeof window !== "undefined" && (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView) {
      setNotifPermission("native");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission as NotifPermission);
    if (Notification.permission === "granted") {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription()
      ).then((sub) => {
        setNotifEnabled(!!sub);
      }).catch(() => {});
    }
  }, []);

  async function handleToggleNotifications() {
    setNotifLoading(true);
    setNotifError("");
    try {
      if (notifEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.unsubscribePush(sub.endpoint);
          await sub.unsubscribe();
        }
        setNotifEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        setNotifPermission(permission as NotifPermission);
        if (permission !== "granted") return;

        const { public_key } = await api.getVapidPublicKey();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: public_key,
        });
        await api.subscribePush(sub.toJSON());
        setNotifEnabled(true);
      }
    } catch (e) {
      setNotifError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setNotifLoading(false);
    }
  }

  async function handleSyncHistory() {
    setSyncingHistory(true); setSyncHistoryMsg(null);
    try {
      const res = await api.syncHistory();
      setSyncHistoryMsg({ text: res.message || "Full sync complete", ok: true });
    } catch (e: unknown) {
      setSyncHistoryMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setSyncingHistory(false);
      setTimeout(() => setSyncHistoryMsg(null), 4000);
    }
  }

  const deleteDialogMessage = (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
        This permanently erases everything — bank connections, transactions, budgets, plans,
        insights and chat history. It cannot be undone. Type{" "}
        <span className="font-bold text-slate-700 dark:text-slate-200">DELETE</span> to confirm.
      </p>
      <input
        className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 border border-red-200 dark:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
        value={deleteConfirm}
        onChange={e => setDeleteConfirm(e.target.value)}
        placeholder="DELETE"
        autoCapitalize="characters"
      />
    </div>
  );

  return (
    <div className="min-h-dvh pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 glass-hero">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Customise your dashboard</p>
          </div>
          <TutorialTrigger />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* ── Display ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Display</p>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Dark Mode</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Easier on the eyes at night</p>
            </div>
            <Toggle
              checked={darkMode}
              onChange={() => setDarkMode(!darkMode)}
              label="Dark mode"
            />
          </div>
        </div>

        {/* ── Notifications ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Notifications</p>
          </div>
          <div className="px-4 py-3.5">
            {notifPermission === "native" ? (
              <div className="flex items-center gap-3">
                <Bell size={16} className="text-indigo-500 flex-shrink-0" />
                <p className="text-xs text-slate-500 dark:text-slate-400">Notifications are delivered by the app — manage them in your phone&apos;s notification settings.</p>
              </div>
            ) : notifPermission === "unsupported" ? (
              <div className="flex items-center gap-3">
                <BellOff size={16} className="text-slate-400 flex-shrink-0" />
                <p className="text-xs text-slate-500 dark:text-slate-400">Push notifications aren&apos;t supported in this browser.</p>
              </div>
            ) : notifPermission === "denied" ? (
              <div className="flex items-start gap-3">
                <BellOff size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Notifications blocked</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">To receive transaction alerts, allow notifications for this site in your browser settings.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={16} className={notifEnabled ? "text-indigo-500" : "text-slate-400"} />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Push notifications</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Allow alerts on this device</p>
                  </div>
                </div>
                {notifLoading ? (
                  <div className="relative w-12 h-6 flex items-center justify-center">
                    <Loader2 size={12} className="animate-spin text-slate-400" />
                  </div>
                ) : (
                  <Toggle
                    checked={notifEnabled}
                    onChange={handleToggleNotifications}
                    label="Push notifications"
                    disabled={notifLoading}
                  />
                )}
              </div>
            )}
            {notifError && (
              <div className="mt-2 flex items-center gap-1.5">
                <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-500">{notifError}</p>
              </div>
            )}
          </div>

          {notifPrefs && (
            <div className="border-t border-slate-100 dark:border-slate-700">
              <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Notify me about</p>
              </div>
              {([
                { key: "insights", title: "Tips & insights", desc: "Ways to save money we spot for you" },
                { key: "budget_alerts", title: "Budget alerts", desc: "When you go over a budget category" },
                { key: "bill_alerts", title: "Bill alerts", desc: "When an upcoming bill may not clear" },
                { key: "goal_milestones", title: "Goal milestones", desc: "When you reach a savings goal" },
                { key: "period_digest", title: "Pay-period digest", desc: "A fresh-start goals summary each new pay period" },
                { key: "transactions", title: "New transactions", desc: "Each time new transactions arrive" },
              ] as { key: keyof NotificationPrefs; title: string; desc: string }[]).map((row) => (
                <div key={row.key} className="flex items-center justify-between px-4 py-3 border-t border-slate-50 dark:border-slate-700/50">
                  <div className="pr-3">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{row.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{row.desc}</p>
                  </div>
                  <Toggle
                    checked={!!notifPrefs[row.key]}
                    onChange={() => toggleNotifPref(row.key)}
                    label={row.title}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Financial profile ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Financial profile</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Self-declared — unlocks personalised tax insights</p>
          </div>

          <div className="px-4 py-3.5">
                <label htmlFor="settings-income" className="text-sm font-medium text-slate-800 dark:text-slate-100 block mb-1">
                  Approximate income (£/yr)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Used to personalise your tax calculations — over £100k unlocks the Tax tab</p>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    id="settings-income"
                    type="text"
                    inputMode="numeric"
                    value={fmtDigits(incomeInput)}
                    onChange={e => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={handleIncomeBlur}
                    placeholder="e.g. 110000"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                {financeMsg && (
                  <p className={`mt-2 text-xs font-medium ${financeMsg.ok ? "text-emerald-500" : "text-red-500"}`}>{financeMsg.text}</p>
                )}
          </div>

          {(incomeBracket === "100k_125k" || incomeBracket === "125k_plus") && (
            <>
              <div className="px-4 pb-3.5 border-t border-slate-50 dark:border-slate-700/50 pt-3.5">
                <label htmlFor="settings-pension" className="text-sm font-medium text-slate-800 dark:text-slate-100 block mb-1">
                  Pension contributions this year (£/yr)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Used to calculate your adjusted net income</p>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    id="settings-pension"
                    type="text"
                    inputMode="numeric"
                    value={fmtDigits(pensionAnnual)}
                    onChange={e => setPensionAnnual(e.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={handlePensionBlur}
                    placeholder="0"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pb-3.5 border-t border-slate-50 dark:border-slate-700/50 pt-3.5">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Receiving Child Benefit</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">High income charge applies over £60k</p>
                </div>
                <Toggle
                  checked={hasChildBenefit}
                  onChange={handleChildBenefitToggle}
                  label="Receiving Child Benefit"
                  onColor="bg-indigo-500"
                />
              </div>

              <button
                onClick={() => router.push("/insights?tab=tax")}
                className="w-full flex items-center justify-between px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 active:bg-indigo-50 dark:active:bg-indigo-900/10 transition-colors"
              >
                <span className="text-sm font-semibold">View tax breakdown</span>
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* ── Security (app shell only) ── */}
        {bioState?.supported && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Security</p>
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Biometric unlock</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Require fingerprint or face to open the app</p>
              </div>
              <Toggle
                checked={bioState.enabled}
                onChange={toggleBiometrics}
                label="Biometric login"
              />
            </div>
          </div>
        )}

        {/* ── Data ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Data</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Sync all history</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks.</p>
            <button
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
            >
              <RotateCcw size={14} className={syncingHistory ? "animate-spin" : ""} />
              {syncingHistory ? "Syncing…" : "Sync history (90 days)"}
            </button>
            {syncHistoryMsg && (
              <p className={`mt-2 text-xs font-medium ${syncHistoryMsg.ok ? "text-emerald-500" : "text-red-500"}`}>{syncHistoryMsg.text}</p>
            )}
          </div>
        </div>

        {/* ── Account ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
            {user?.email && <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>}
          </div>

          {/* Profile — full name feeds transfer categorisation, postcode feeds fuel prices */}
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700 space-y-3">
            <div>
              <label htmlFor="settings-name" className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                Full name <span className="opacity-70">— used to recognise transfers between your own accounts</span>
              </label>
              <input
                id="settings-name"
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="First Last"
              />
            </div>
            <div>
              <label htmlFor="settings-postcode" className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                Home postcode <span className="opacity-70">— used for local fuel prices</span>
              </label>
              <input
                id="settings-postcode"
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={profilePostcode}
                onChange={e => setProfilePostcode(e.target.value)}
                placeholder="e.g. B91 2AB"
              />
            </div>
            {profileDirty && (
              <button
                onClick={saveProfile}
                disabled={profileSaving}
                className="w-full py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
            )}
            {profileMsg && <p className={`text-xs font-medium ${profileMsg.ok ? "text-emerald-500" : "text-red-500"}`}>{profileMsg.text}</p>}
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 active:bg-slate-100 transition-colors"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>

        {/* ── Danger zone ── */}
        <div className="glass-card rounded-2xl overflow-hidden border border-red-100 dark:border-red-900/40">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-1">Danger zone</p>
            <button
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2.5 text-sm font-medium text-red-500 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 active:bg-red-100 transition-colors"
            >
              Delete account &amp; all data…
            </button>
          </div>
        </div>

      </div>

      {/* Delete account confirmation dialog */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete everything?"
        message={deleteDialogMessage}
        confirmLabel="Delete my account"
        destructive
        confirmDisabled={deleteConfirm !== "DELETE"}
        onConfirm={handleDeleteAccount}
        onCancel={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
      />

      <BottomNav />
    </div>
  );
}
