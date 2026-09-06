"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  RotateCcw,
  LogOut,
  Loader2,
  AlertCircle,
  Bell,
  BellOff,
  ChevronRight,
  ChevronDown,
  Moon,
  Wallet,
  Landmark,
  ShieldCheck,
  Database,
  UserRound,
  HelpCircle,
  AlertTriangle,
  Wand2,
  KeyRound,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { api, NotificationPrefs, Account, IdentitiesResponse } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { isNativePlatform, isIOSNative, linkAppleIdentity } from "@/lib/nativeAuth";
import { initCapacitorPush, getCapacitorPushPermission, onPushReceivedOnce } from "@/lib/capacitorPush";
import {
  isAvailable as checkBiometryAvailability,
  authenticate as authenticateBiometrics,
  isLockEnabled as isBiometricLockEnabled,
  setLockEnabled as setBiometricLockEnabled,
} from "@/lib/biometrics";
import BottomNav from "@/components/BottomNav";
import { useTutorial, TUTORIAL_FLOWS } from "@/components/TutorialContext";
import Toggle from "@/components/Toggle";
import ConfirmDialog from "@/components/ConfirmDialog";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { useRouter } from "next/navigation";

const INDIGO = "#4f46e5";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const RED = "#ef4444";

const SECTION_ACCOUNTS = "settings-accounts";
const SECTION_SECURITY = "settings-security";

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

// ~15%-alpha tinted icon chip — the Category Voice Rule (DESIGN.md): colour
// as a tinted chip + full-strength icon, never a flooded surface.
function IconChip({ icon: Icon, hex }: { icon: LucideIcon; hex: string }) {
  return (
    <span
      className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: `${hex}26` }}
      aria-hidden="true"
    >
      <Icon size={16} style={{ color: hex }} />
    </span>
  );
}

function SectionHeader({
  icon,
  hex,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  hex: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-start gap-2.5">
      <IconChip icon={icon} hex={hex} />
      <div className="min-w-0 pt-0.5">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function deriveInitials(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { darkMode, setDarkMode, rawPrefs } = usePreferences();
  const { startFlow } = useTutorial();

  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncHistoryMsg, setSyncHistoryMsg] = useState<{ text: string; ok: boolean } | null>(null);

  type NotifPermission = "granted" | "denied" | "default" | "unsupported" | "native";
  const [notifPermission, setNotifPermission] = useState<NotifPermission>("unsupported");
  const [notifEnabled, setNotifEnabled] = useState(false);
  // Native-only: OS push permission state. Registration itself is automatic
  // on native (resyncCapacitorPush self-heals on every launch), the OS
  // permission is the master switch, there is no in-app toggle to mirror it
  // with. Null until the first `getCapacitorPushPermission()` read resolves.
  const [nativePushStatus, setNativePushStatus] = useState<"granted" | "prompt" | "denied" | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null);
  const [testPushLoading, setTestPushLoading] = useState(false);
  const [testPushMsg, setTestPushMsg] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const [incomeBracket, setIncomeBracket] = useState("");
  const [incomeInput, setIncomeInput] = useState("");
  const [incomeFocused, setIncomeFocused] = useState(false);
  const [pensionAnnual, setPensionAnnual] = useState("");
  const [pensionFocused, setPensionFocused] = useState(false);
  const [hasChildBenefit, setHasChildBenefit] = useState(false);
  const [financeMsg, setFinanceMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Biometric lock.
  // - Capacitor: read/write goes straight to the plugin + localStorage
  //   (frontend/lib/biometrics.ts) — the gate (BiometricLock) reads the same pref.
  // - Expo shell: the preference lives in the native wrapper, so read/write
  //   goes over the message bridge instead.
  const [bioState, setBioState] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  useEffect(() => {
    if (isNativePlatform()) {
      checkBiometryAvailability().then(({ supported }) => {
        setBioState({ supported, enabled: supported && isBiometricLockEnabled() });
      }).catch(() => {});
      return;
    }
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

  async function toggleBiometrics() {
    if (!bioState) return;
    const next = !bioState.enabled;
    if (isNativePlatform()) {
      if (next) {
        // Confirm biometrics actually work before persisting the pref —
        // otherwise a failed/cancelled prompt would lock the user out next launch.
        const ok = await authenticateBiometrics("Enable biometric unlock");
        if (!ok) return;
      }
      setBiometricLockEnabled(next);
      setBioState({ ...bioState, enabled: next });
      return;
    }
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

  // Sign-in methods (Phase 1 linked identities: Apple only, native iOS)
  const [identities, setIdentities] = useState<IdentitiesResponse | null>(null);
  const [identitiesError, setIdentitiesError] = useState(false);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [appleLinking, setAppleLinking] = useState(false);
  const [appleLinkMsg, setAppleLinkMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [appleUnlinkOpen, setAppleUnlinkOpen] = useState(false);
  const [appleUnlinking, setAppleUnlinking] = useState(false);

  // No synchronous setState calls in the function body itself (only inside
  // the .then/.catch/.finally continuations) so this is safe to call
  // directly from the mount effect below without tripping
  // react-hooks/set-state-in-effect.
  function fetchIdentities() {
    api.getIdentities()
      .then(setIdentities)
      .catch(() => setIdentitiesError(true))
      .finally(() => setIdentitiesLoading(false));
  }
  // Same fetch, but resets the loading/error state first — for a refetch
  // after linking/unlinking, where identitiesLoading/identitiesError may
  // already have settled to their post-mount values.
  function refetchIdentities() {
    setIdentitiesLoading(true);
    setIdentitiesError(false);
    fetchIdentities();
  }
  useEffect(() => { fetchIdentities(); }, []);

  const appleIdentity = identities?.linked.find(l => l.provider === "apple") ?? null;
  // True when this account's only sign-in method is an automatic Apple
  // "Hide My Email" relay link (created via OPEN_SIGNUP), not linked from an
  // existing Google account.
  const isRelayPrimaryAccount = identities?.primary_email?.endsWith("@privaterelay.appleid.com") ?? false;

  async function handleLinkApple() {
    setAppleLinking(true);
    setAppleLinkMsg(null);
    const result = await linkAppleIdentity();
    setAppleLinking(false);
    if (result === "ok") {
      setAppleLinkMsg({ text: "Apple ID linked", ok: true });
      refetchIdentities();
    } else if (result === "conflict") {
      setAppleLinkMsg({ text: "That Apple ID is already linked to another account", ok: false });
    } else if (result === "failed") {
      setAppleLinkMsg({ text: "Could not link. Try again.", ok: false });
    }
    // "cancelled" — nothing to show, the user backed out of the OS sheet.
  }

  async function handleUnlinkApple() {
    setAppleUnlinking(true);
    try {
      await api.unlinkAppleIdentity();
      setAppleUnlinkOpen(false);
      refetchIdentities();
    } catch {
      setAppleLinkMsg({ text: "Could not unlink. Try again.", ok: false });
    } finally {
      setAppleUnlinking(false);
    }
  }

  // Account deletion
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Cover-plan source accounts
  const [coverAccounts, setCoverAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [coverOpen, setCoverOpen] = useState(false);
  useEffect(() => {
    getAccountsCached().then(accs => {
      const eligible = accs.filter(acc => {
        const type = (acc.type || "").toLowerCase();
        const sub = (acc.subtype || "").toLowerCase();
        if (type.includes("credit") || sub.includes("credit")) return false;
        return true;
      });
      setCoverAccounts(eligible);
      setAccountsLoaded(true);
    }).catch(() => {
      setAccountsLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (rawPrefs === null) return;
    const ids = rawPrefs.cover_plan_excluded_accounts ?? [];
    setExcludedIds(new Set(ids));
  }, [rawPrefs]);

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
      setProfileMsg({ text: "Deletion failed, try again", ok: false });
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

  function toggleCoverAccount(id: string) {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      api.updatePreferences({ cover_plan_excluded_accounts: [...next] }).catch(() => {});
      return next;
    });
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
    // Capacitor (iOS/Android app shell): push goes through our own APNs/FCM
    // client (frontend/lib/capacitorPush.ts) — Web Push APIs don't exist in
    // this WKWebView, so this must come first.
    if (isNativePlatform()) {
      setNotifPermission("native");
      const readPermission = () => {
        getCapacitorPushPermission().then(setNativePushStatus).catch(() => setNativePushStatus("denied"));
      };
      readPermission();
      // The old toggle re-checked live on every tap; without an equivalent
      // here, "denied" is a dead end: the row tells the user to enable
      // notifications in the phone's Settings app, but returning from there
      // never re-reads permission on its own, so this still-mounted screen
      // would keep showing blocked forever. Re-reading on visibility gets
      // this back for free, and the same mechanism also covers the
      // opposite direction, granted permission revoked in OS settings while
      // this screen sat mounted in the background.
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") readPermission();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
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

  // Native-only: the OS permission prompt, triggered by the "Turn on
  // notifications" row shown while `nativePushStatus === "prompt"`. There is
  // no native master toggle to unregister from, the OS permission is the
  // only on/off switch, `resyncCapacitorPush` (see NativePushResync.tsx)
  // handles re-registering on every subsequent launch on its own.
  async function handleEnableNativePush() {
    setNotifLoading(true);
    setNotifError("");
    try {
      const result = await initCapacitorPush();
      if (result === "granted") {
        setNativePushStatus("granted");
      } else if (result === "denied") {
        // The dedicated blocked-state row below covers this message, no
        // need to also surface it via notifError.
        setNativePushStatus("denied");
      } else if (result === "no-token") {
        // OS permission itself came back granted, only our own token
        // round-trip didn't finish, so the status row still promotes to
        // "granted"; the amber note below explains the rest.
        setNativePushStatus("granted");
        setNotifError("Your phone allowed notifications but didn't finish setting them up. This has been reported, please try again.");
      } else {
        setNotifError("Couldn't enable notifications on this device.");
      }
    } finally {
      setNotifLoading(false);
    }
  }

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

  async function handleTestPush() {
    setTestPushLoading(true);
    setTestPushMsg(null);
    // Start waiting for on-device receipt before sending, so a fast push
    // that arrives within a beat of the response is never missed.
    const receivedPromise = onPushReceivedOnce(8000);
    try {
      const res = await api.sendTestPush();
      if (!res.ok) {
        setTestPushMsg({
          text: "No device is registered yet. Turn notifications off and on again to register this device.",
          tone: "warn",
        });
        return;
      }
      const received = await receivedPromise;
      if (received) {
        setTestPushMsg({ text: "Delivered to this device.", tone: "ok" });
      } else {
        const count = res.devices.apns + res.devices.fcm + res.devices.webpush;
        setTestPushMsg({
          text: `Sent to ${count} device${count === 1 ? "" : "s"}. If nothing appeared, background the app and try again, Android hides notifications while the app is open.`,
          tone: "warn",
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (message.includes("429")) {
        setTestPushMsg({ text: "Too many tests, wait a minute and try again.", tone: "warn" });
      } else {
        setTestPushMsg({ text: message || "Something went wrong", tone: "warn" });
      }
    } finally {
      setTestPushLoading(false);
      setTimeout(() => setTestPushMsg(null), 5000);
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
        This permanently erases everything: bank connections, transactions, budgets, plans,
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

  const initials = deriveInitials(user?.name);
  const bioLabel = bioState?.enabled ? "Face ID on" : "Face ID off";

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
      </div>

      <div className="px-4 pt-4">
        {/* ── Account identity hero ── */}
        <div className="glass-hero rounded-3xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-base font-bold bg-indigo-500/15 dark:bg-indigo-400/20 text-indigo-600 dark:text-indigo-300"
              aria-hidden="true"
            >
              {initials || <UserRound size={20} />}
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">{user?.name || "—"}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>

          {(accountsLoaded || bioState?.supported) && (
            <div className={`grid gap-2 ${accountsLoaded && bioState?.supported ? "grid-cols-2" : "grid-cols-1"}`}>
              {accountsLoaded && (
                <button
                  type="button"
                  onClick={() => jumpTo(SECTION_ACCOUNTS)}
                  aria-label={`${coverAccounts.length} accounts connected, jump to Where money can come from`}
                  className="glass-tile rounded-2xl px-2.5 py-3 text-left min-h-[44px] active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Accounts</p>
                  <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100 mt-1 leading-tight">
                    {coverAccounts.length} connected
                  </p>
                </button>
              )}
              {bioState?.supported && (
                <button
                  type="button"
                  onClick={() => jumpTo(SECTION_SECURITY)}
                  aria-label={`${bioLabel}, jump to Security`}
                  className="glass-tile rounded-2xl px-2.5 py-3 text-left min-h-[44px] active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Security</p>
                  <p
                    className="text-[13px] font-bold mt-1 leading-tight"
                    style={{ color: bioState.enabled ? EMERALD : AMBER }}
                  >
                    {bioLabel}
                  </p>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-3 space-y-3">

        {/* ── Sign-in methods ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={KeyRound} hex={INDIGO} title="Sign-in methods" />

          {/* Google — always present, this account always has one */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Google</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{user?.email}</p>
            </div>
            <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2.5 py-1">
              Primary
            </span>
          </div>

          {/* Apple */}
          <div className="px-4 py-3.5">
            {identitiesLoading ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">Checking…</p>
            ) : identitiesError ? (
              <>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Apple</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Could not load sign-in methods</p>
              </>
            ) : appleIdentity ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Apple</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{appleIdentity.email_masked}</p>
                  {appleIdentity.relay && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Uses Hide My Email</p>
                  )}
                  {isRelayPrimaryAccount && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">This account was created with Hide My Email. If you already use Sorted with Google, sign in with Google and link your Apple ID there to keep one account.</p>
                  )}
                </div>
                {appleIdentity.auto && isRelayPrimaryAccount ? (
                  <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2.5 py-1">
                    Primary
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAppleUnlinkOpen(true)}
                    className="flex-shrink-0 min-h-[44px] px-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 active:bg-indigo-100 transition-colors"
                  >
                    Unlink
                  </button>
                )}
              </div>
            ) : isIOSNative() ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Apple</p>
                <button
                  type="button"
                  onClick={handleLinkApple}
                  disabled={appleLinking}
                  className="flex-shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-colors disabled:opacity-60 flex items-center gap-2"
                >
                  {appleLinking && <Loader2 size={14} className="animate-spin" />}
                  Link Apple ID
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Apple</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Link from the iPhone app</p>
              </>
            )}
            {appleLinkMsg && (
              <p className={`text-xs mt-2 ${appleLinkMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                {appleLinkMsg.text}
              </p>
            )}
          </div>
        </div>

        {/* ── Display ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={Moon} hex={INDIGO} title="Display" />
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

        {/* ── Penny (agent mode v1) ── */}
        {/* Consent-state row for Penny's agent mode (setting up envelopes/
            goals/one-offs on the user's behalf, always with a confirm card
            first — see PennyConversation.tsx's ConsentCard/ProposalConfirmCard).
            Reads `rawPrefs.penny_agent_consent` (an ISO timestamp when
            granted, absent/null otherwise) straight from the same
            preferences fetch every other row on this page already uses —
            no separate request.

            GAP, flagged deliberately rather than guessed around: the
            backend contract for this feature only specifies POST
            /penny/agent-consent (grant). There is no revoke/toggle-off
            endpoint in the contract, so this row is READ-ONLY — no Toggle
            component — with "ask Penny to stop" copy instead of a switch,
            per this feature's own instruction for exactly this situation.
            If a revoke endpoint lands later, this becomes a normal
            Toggle-backed row like every other preference on this page.

            Placement: this doesn't nest inside an existing card (no
            existing section is both an unconditional render and a clean
            semantic fit for "can Penny act on my behalf at all" — "Where
            money can come from" is conditional on having eligible accounts
            and is specifically about SOURCE accounts, a narrower and
            different permission). A small dedicated card, same
            glass-card/SectionHeader family as every other section here,
            was the more honest fit than forcing this into a card about
            something else. Icon is a plain INDIGO-tinted IconChip (Wand2),
            not the Penny gradient: DESIGN.md's Penny Gradient Rule reserves
            that gradient for surfaces that give advice, and Settings isn't
            one. */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={Wand2} hex={INDIGO} title="Penny" subtitle="What Penny can do on your behalf" />
          <div className="px-4 py-3.5">
            {rawPrefs?.penny_agent_consent ? (
              <>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Setting things up is on</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Penny can create envelopes, goals and one-off payments when you ask her to. You&apos;ll always see exactly what would change and confirm before anything happens.
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">To turn this off, ask Penny to stop in chat.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Setting things up is off</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Penny can only answer questions right now. Ask her to set something up, like an envelope or a goal, and she&apos;ll offer to turn this on.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Notifications ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={Bell} hex={INDIGO} title="Notifications" />
          <div className="px-4 py-3.5">
            {notifPermission === "native" ? (
              // No master toggle here, deliberately: on native, the OS
              // permission IS the master switch, and registration itself is
              // automatic (resyncCapacitorPush self-heals on every launch,
              // see NativePushResync.tsx). This just reports OS permission
              // state truthfully instead of duplicating it as a fake toggle.
              nativePushStatus === "granted" ? (
                <div className="flex items-center gap-3">
                  <Bell size={16} className="text-indigo-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Push notifications</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Delivered by your phone. Manage in your phone&apos;s Settings.</p>
                  </div>
                </div>
              ) : nativePushStatus === "denied" ? (
                <div className="flex items-start gap-3">
                  <BellOff size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Notifications blocked</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Notifications are blocked, enable them in your phone&apos;s Settings app.</p>
                  </div>
                </div>
              ) : nativePushStatus === "prompt" ? (
                <button
                  type="button"
                  onClick={handleEnableNativePush}
                  disabled={notifLoading}
                  className="min-h-[44px] w-full flex items-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-transform"
                >
                  {notifLoading ? (
                    <Loader2 size={16} className="animate-spin text-slate-400 flex-shrink-0" />
                  ) : (
                    <Bell size={16} className="text-indigo-500 flex-shrink-0" />
                  )}
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Turn on notifications</p>
                </button>
              ) : (
                // nativePushStatus still null: the permission read hasn't
                // resolved yet.
                <div className="flex items-center gap-3">
                  <Bell size={16} className="text-slate-400 flex-shrink-0" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">Checking notification status...</p>
                </div>
              )
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
              // Amber, not red: this is a setup hiccup (a permission prompt
              // that didn't finish registering, a device that couldn't
              // enable push), not genuine financial risk (DESIGN.md's Red
              // Is Risk Rule). A blocked/denied permission gets its own
              // dedicated amber row above instead of routing through here.
              <div className="mt-2 flex items-center gap-1.5">
                <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-500">{notifError}</p>
              </div>
            )}
            {notifPermission === "native" && nativePushStatus === "granted" && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleTestPush}
                  disabled={testPushLoading}
                  className="min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
                >
                  <Bell size={14} className={testPushLoading ? "animate-pulse" : ""} />
                  {testPushLoading ? "Sending…" : "Send a test notification"}
                </button>
                {testPushMsg && (
                  <p className={`mt-2 text-xs font-medium ${testPushMsg.tone === "ok" ? "text-emerald-500" : "text-amber-500"}`}>
                    {testPushMsg.text}
                  </p>
                )}
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
                { key: "category_pace", title: "Category running hot", desc: "When a category is well above your usual pace" },
                { key: "classification_attention", title: "Payments needing a look", desc: "Unplaced or possibly miscategorised payments" },
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

        {/* ── Where money can come from ── */}
        {coverAccounts.length > 0 && (() => {
          const total = coverAccounts.length;
          const allowedCount = coverAccounts.filter(a => !excludedIds.has(a.id)).length;
          const summaryText = allowedCount === total
            ? `Any of your ${total} ${total === 1 ? "account" : "accounts"}`
            : `${allowedCount} of ${total} ${total === 1 ? "account" : "accounts"}`;
          const bodyId = "cover-accounts-body";
          return (
            <div id={SECTION_ACCOUNTS} className="glass-card rounded-2xl overflow-hidden scroll-mt-4">
              <button
                type="button"
                aria-expanded={coverOpen}
                aria-controls={bodyId}
                onClick={() => setCoverOpen(o => !o)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 min-h-[44px] active:opacity-70${coverOpen ? " border-b border-slate-100 dark:border-slate-700" : ""}`}
              >
                <IconChip icon={Wallet} hex={INDIGO} />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Where money can come from</span>
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 mt-0.5">{summaryText}</span>
                </span>
                <ChevronDown
                  size={16}
                  className={`text-slate-400 dark:text-slate-500 flex-shrink-0 transition-transform${coverOpen ? " rotate-180" : ""}`}
                />
              </button>
              {coverOpen && (
                <div id={bodyId}>
                  <p className="px-4 pt-3 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
                    By default Penny can move from any of your accounts. Turn one off and it will never be suggested.
                  </p>
                  <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-700/60">
                    {coverAccounts.map(acc => {
                      const brand = accountBrand(acc);
                      const allowed = !excludedIds.has(acc.id);
                      return (
                        <div key={acc.id} className="flex items-center gap-3 px-4 py-3 min-h-[44px]">
                          <BankBadge
                            logoSrc={brand.logoSrc}
                            initials={brand.initials}
                            altText={brand.label}
                            brandBg={brand.background}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{acc.name}</span>
                            {(acc.manual || acc.provider) && (
                              <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">
                                {acc.manual ? "Offline account" : acc.provider}
                              </span>
                            )}
                          </span>
                          <Toggle
                            checked={allowed}
                            onChange={() => toggleCoverAccount(acc.id)}
                            label={`Allow transfers from ${acc.name}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Financial profile ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader
            icon={Landmark}
            hex={INDIGO}
            title="Financial profile"
            subtitle="Self-declared: unlocks personalised tax insights"
          />

          <div className="px-4 py-3.5">
                <label htmlFor="settings-income" className="text-sm font-medium text-slate-800 dark:text-slate-100 block mb-1">
                  Approximate income (£/yr)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Used to personalise your tax levers and calculations for your income band</p>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    id="settings-income"
                    type="text"
                    inputMode="numeric"
                    value={incomeFocused ? incomeInput : fmtDigits(incomeInput)}
                    onChange={e => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))}
                    onFocus={() => setIncomeFocused(true)}
                    onBlur={() => { setIncomeFocused(false); handleIncomeBlur(); }}
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
                    value={pensionFocused ? pensionAnnual : fmtDigits(pensionAnnual)}
                    onChange={e => setPensionAnnual(e.target.value.replace(/[^0-9]/g, ""))}
                    onFocus={() => setPensionFocused(true)}
                    onBlur={() => { setPensionFocused(false); handlePensionBlur(); }}
                    placeholder="0"
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pb-3.5 border-t border-slate-50 dark:border-slate-700/50 pt-3.5">
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Receiving Child Benefit</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">High income charge applies over <span className="font-mono tabular-nums">£60k</span></p>
                </div>
                <Toggle
                  checked={hasChildBenefit}
                  onChange={handleChildBenefitToggle}
                  label="Receiving Child Benefit"
                  onColor="bg-indigo-500"
                />
              </div>

            </>
          )}

          {incomeBracket && (
            <button
              onClick={() => router.push("/tax")}
              className="w-full flex items-center justify-between px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 active:bg-indigo-50 dark:active:bg-indigo-900/10 transition-colors"
            >
              <span className="text-sm font-semibold">View tax breakdown</span>
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        {/* ── Security (app shell only) ── */}
        {bioState?.supported && (
          <div id={SECTION_SECURITY} className="glass-card rounded-2xl overflow-hidden scroll-mt-4">
            <SectionHeader icon={ShieldCheck} hex={EMERALD} title="Security" />
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
          <SectionHeader icon={Database} hex={INDIGO} title="Data" />
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Sync all history</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks.</p>
            <button
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
            >
              <RotateCcw size={14} className={syncingHistory ? "animate-spin" : ""} />
              {syncingHistory ? "Syncing…" : "Sync history (90 days)"}
            </button>
            {syncHistoryMsg && (
              <p className={`mt-2 text-xs font-medium ${syncHistoryMsg.ok ? "text-emerald-500" : "text-red-500"}`}>{syncHistoryMsg.text}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => router.push("/upcoming/dismissed")}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 text-left active:opacity-70 transition-opacity"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">Set aside</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Payments and bills excluded from your projections</span>
            </span>
            <ChevronRight size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          </button>
        </div>

        {/* ── Account ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700 flex items-start gap-2.5">
            <IconChip icon={UserRound} hex={INDIGO} />
            <div className="min-w-0 pt-0.5">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
              {user?.email && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>}
            </div>
          </div>

          {/* Profile — full name feeds transfer categorisation, postcode feeds fuel prices */}
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700 space-y-3">
            <div>
              <label htmlFor="settings-name" className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                Full name <span className="opacity-70">(used to recognise transfers between your own accounts)</span>
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
                Home postcode <span className="opacity-70">(used for local fuel prices)</span>
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
            className="w-full min-h-[44px] flex items-center gap-3 px-4 py-3.5 text-left text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 active:bg-slate-100 transition-colors"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>

        {/* ── How Sorted works (tutorial replay, one row per per-screen flow) ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={HelpCircle} hex={INDIGO} title="How Sorted works" subtitle="Replay any screen's tour" />
          {TUTORIAL_FLOWS.map((flow, i) => (
            <button
              key={flow.id}
              type="button"
              onClick={() => startFlow(flow.id)}
              className={`w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-70 transition-opacity${
                i > 0 ? " border-t border-slate-100 dark:border-slate-700" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{flow.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{flow.blurb}</span>
              </span>
              <ChevronRight size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
            </button>
          ))}
        </div>

        {/* ── Help ── */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <SectionHeader icon={HelpCircle} hex={INDIGO} title="Help" />
          <button
            type="button"
            onClick={() => router.push("/terms")}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-70 transition-opacity"
          >
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Terms &amp; Conditions</span>
            <ChevronRight size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/privacy")}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 text-left active:opacity-70 transition-opacity"
          >
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Privacy Policy</span>
            <ChevronRight size={16} className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          </button>
        </div>

        {/* ── Danger zone ── */}
        <div className="glass-card rounded-2xl overflow-hidden border border-red-100 dark:border-red-900/40">
          <div className="px-4 py-3 flex items-start gap-2.5">
            <IconChip icon={AlertTriangle} hex={RED} />
            <div className="min-w-0 pt-0.5">
              <p className="text-xs font-semibold text-red-500 dark:text-red-400 uppercase tracking-wide mb-1">Danger zone</p>
              <button
                onClick={() => setDeleteOpen(true)}
                className="min-h-[44px] px-4 py-2.5 -ml-4 text-sm font-medium text-red-500 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/10 active:bg-red-100 transition-colors"
              >
                Delete account &amp; all data…
              </button>
            </div>
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

      {/* Unlink Apple ID confirmation dialog */}
      <ConfirmDialog
        open={appleUnlinkOpen}
        title="Unlink Apple ID?"
        message="You will not be able to sign in with Apple until you link it again."
        confirmLabel="Unlink"
        destructive
        confirmDisabled={appleUnlinking}
        onConfirm={handleUnlinkApple}
        onCancel={() => setAppleUnlinkOpen(false)}
      />

      <BottomNav />
    </div>
  );
}
