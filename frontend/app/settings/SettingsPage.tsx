"use client";

import { useEffect, useState } from "react";
import { RotateCcw, LogOut, Loader2, AlertCircle, Bell, BellOff, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { api, NotificationPrefs } from "@/lib/api";
import BottomNav from "@/components/BottomNav";
import TutorialTrigger from "@/components/TutorialTrigger";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { darkMode, setDarkMode } = usePreferences();

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
    api.getPreferences().then(p => {
      if (p.notification_prefs) setNotifPrefs(p.notification_prefs);
      if (p.income_bracket) setIncomeBracket(p.income_bracket);
      if (p.income_value) setIncomeInput(String(p.income_value));
      if (p.pension_annual) setPensionAnnual(String(p.pension_annual));
      if (p.has_child_benefit) setHasChildBenefit(p.has_child_benefit);
    }).catch(() => {});
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

  function handleIncomeBlur() {
    const n = parseInt(incomeInput.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setIncomeInput(value === 0 ? "" : String(value));
    // Bracket is derived from the salary — mirror the backend derivation locally
    // so the pension/child-benefit fields appear without a refetch
    setIncomeBracket(value < 100_000 ? "under_100k" : value <= 125_140 ? "100k_125k" : "125k_plus");
    api.updatePreferences({ income_value: value }).catch(() => {});
  }

  function handlePensionBlur() {
    const n = parseInt(pensionAnnual.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    setPensionAnnual(value === 0 ? "" : String(value));
    api.updatePreferences({ pension_annual: value }).catch(() => {});
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

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="mx-4 mt-4 rounded-3xl px-4 pt-5 pb-6 text-white" style={{ background: "linear-gradient(135deg, #475569 0%, #1e293b 100%)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Settings</h1>
            <p className="text-sm opacity-70 mt-1">Customise your dashboard</p>
          </div>
          <TutorialTrigger />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {/* ── Display ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Display</p>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Dark Mode</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Easier on the eyes at night</p>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`relative w-12 h-6 rounded-full transition-colors ${darkMode ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${darkMode ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </div>
        </div>

        {/* ── Notifications ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
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
                <p className="text-xs text-slate-400 dark:text-slate-500">Push notifications aren&apos;t supported in this browser.</p>
              </div>
            ) : notifPermission === "denied" ? (
              <div className="flex items-start gap-3">
                <BellOff size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Notifications blocked</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">To receive transaction alerts, allow notifications for this site in your browser settings.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={16} className={notifEnabled ? "text-indigo-500" : "text-slate-400"} />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Push notifications</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Allow alerts on this device</p>
                  </div>
                </div>
                <button
                  onClick={handleToggleNotifications}
                  disabled={notifLoading}
                  className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${notifEnabled ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"}`}
                >
                  {notifLoading
                    ? <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white" />
                    : <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifEnabled ? "translate-x-6" : "translate-x-0"}`} />
                  }
                </button>
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
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Notify me about</p>
              </div>
              {([
                { key: "insights", title: "Tips & insights", desc: "Ways to save money we spot for you" },
                { key: "budget_alerts", title: "Budget alerts", desc: "When you go over a budget category" },
                { key: "goal_milestones", title: "Goal milestones", desc: "When you reach a savings goal" },
                { key: "transactions", title: "New transactions", desc: "Each time new transactions arrive" },
              ] as { key: keyof NotificationPrefs; title: string; desc: string }[]).map((row) => (
                <div key={row.key} className="flex items-center justify-between px-4 py-3 border-t border-slate-50 dark:border-slate-700/50">
                  <div className="pr-3">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{row.title}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{row.desc}</p>
                  </div>
                  <button
                    onClick={() => toggleNotifPref(row.key)}
                    className={`relative w-12 h-6 rounded-full flex-shrink-0 transition-colors ${notifPrefs[row.key] ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifPrefs[row.key] ? "translate-x-6" : "translate-x-0"}`} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Financial profile ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Financial profile</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Self-declared — unlocks personalised tax insights</p>
          </div>

          <div className="px-4 py-3.5">
                <label className="text-sm font-medium text-slate-800 dark:text-slate-100 block mb-1">
                  Approximate income (£/yr)
                </label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Used to personalise your tax calculations — over £100k unlocks the Tax tab</p>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={incomeInput}
                    onChange={e => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={handleIncomeBlur}
                    placeholder="e.g. 110000"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
          </div>

          {(incomeBracket === "100k_125k" || incomeBracket === "125k_plus") && (
            <>
              <div className="px-4 pb-3.5 border-t border-slate-50 dark:border-slate-700/50 pt-3.5">
                <label className="text-sm font-medium text-slate-800 dark:text-slate-100 block mb-1">
                  Pension contributions this year (£/yr)
                </label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">Used to calculate your adjusted net income</p>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pensionAnnual}
                    onChange={e => setPensionAnnual(e.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={handlePensionBlur}
                    placeholder="0"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pb-3.5 border-t border-slate-50 dark:border-slate-700/50 pt-3.5">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Receiving Child Benefit</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">High income charge applies over £60k</p>
                </div>
                <button
                  onClick={handleChildBenefitToggle}
                  className={`relative w-12 h-6 rounded-full transition-colors ${hasChildBenefit ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-600"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${hasChildBenefit ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>

              <button
                onClick={() => router.push("/insights?tab=tax")}
                className="w-full flex items-center justify-between px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 text-violet-600 dark:text-violet-400 active:bg-violet-50 dark:active:bg-violet-900/10 transition-colors"
              >
                <span className="text-sm font-semibold">View tax breakdown</span>
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* ── Data ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Data</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Sync all history</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks.</p>
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
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
            {user?.email && <p className="text-xs text-slate-400 dark:text-slate-500">{user.email}</p>}
          </div>

          {/* Profile — full name feeds transfer categorisation, postcode feeds fuel prices */}
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700 space-y-3">
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Full name <span className="opacity-70">— used to recognise transfers between your own accounts</span></p>
              <input
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-indigo-300"
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="First Last"
              />
            </div>
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Home postcode <span className="opacity-70">— used for local fuel prices</span></p>
              <input
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-indigo-300"
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
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 active:bg-red-100 transition-colors"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>

        {/* ── Danger zone ── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden border border-red-100 dark:border-red-900/40">
          <div className="px-4 py-3">
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">Danger zone</p>
            {!deleteOpen ? (
              <button onClick={() => setDeleteOpen(true)} className="text-sm font-medium text-red-500">
                Delete account &amp; all data…
              </button>
            ) : (
              <div className="space-y-2.5">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  This permanently erases everything — bank connections, transactions, budgets, plans,
                  insights and chat history. It cannot be undone. Type <span className="font-bold">DELETE</span> to confirm.
                </p>
                <input
                  className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 outline-none border border-red-200 dark:border-red-800 focus:border-red-400"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE"
                  autoCapitalize="characters"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirm !== "DELETE" || deleting}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 disabled:opacity-40 active:scale-[0.98] transition-transform"
                  >
                    {deleting ? "Deleting…" : "Delete everything"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
      <BottomNav />
    </div>
  );
}
