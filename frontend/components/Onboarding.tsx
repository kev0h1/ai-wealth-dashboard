"use client";

import { useRef, useState, useEffect } from "react";
import { Wallet, ChevronRight, Check, Building2, ShieldCheck } from "lucide-react";
import { api, type SubscriptionInfo } from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import PlanPicker from "@/components/PlanPicker";
import { isNativePlatform } from "@/lib/nativeAuth";
import { createPreferenceSaver } from "@/lib/preferenceSave";
import { createSerialQueue } from "@/lib/serialQueue";
import {
  isAvailable as checkBiometryAvailability,
  authenticate as authenticateBiometrics,
  setLockEnabled as setBiometricLockEnabled,
} from "@/lib/biometrics";
import BankPickerSheet from "@/components/BankPickerSheet";

interface OnboardingProps {
  defaultName?: string;
  onComplete: () => void;
}

type Step = "welcome" | "profile" | "payday" | "plan" | "income" | "bank" | "secure";

const PAY_OPTIONS: { label: string; sub: string; value: object | null }[] = [
  { label: "Last Friday of month",  sub: "Typical UK monthly salary",         value: { type: "last_friday" } },
  { label: "1st of the month",      sub: "e.g. civil service, some pensions", value: { type: "monthly_pay_date", day: 1 } },
  { label: "15th of the month",     sub: "",                                   value: { type: "monthly_pay_date", day: 15 } },
  { label: "25th of the month",     sub: "Common for many employers",          value: { type: "monthly_pay_date", day: 25 } },
  { label: "28th of the month",     sub: "",                                   value: { type: "monthly_pay_date", day: 28 } },
  { label: "End of the month",      sub: "Calendar month view",                value: { type: "calendar_month" } },
  { label: "I'll set this later",   sub: "",                                   value: null },
];

const STEP_DOTS: Step[] = ["profile", "payday", "plan", "income", "bank", "secure"];

// Defined outside Onboarding so its identity is stable across renders —
// an inner component would remount on every state change and steal focus.
function Shell({ dotIndex, children }: { dotIndex: number; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 py-10">
      {dotIndex >= 0 && (
        <div className="flex gap-2 mb-8">
          {STEP_DOTS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-[width] duration-200 ${
                i === dotIndex
                  ? "w-6 bg-indigo-500"
                  : i < dotIndex
                  ? "w-4 bg-indigo-300 dark:bg-indigo-700"
                  : "w-4 bg-slate-200 dark:bg-slate-700"
              }`}
            />
          ))}
        </div>
      )}
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export default function Onboarding({ defaultName = "", onComplete }: OnboardingProps) {
  const [step, setStep]           = useState<Step>("welcome");
  const [firstName, setFirstName] = useState(() => defaultName.split(" ")[0] ?? "");
  const [lastName, setLastName]   = useState(() => defaultName.split(" ").slice(1).join(" ") ?? "");
  const [postcode, setPostcode]   = useState("");
  const [payIdx, setPayIdx]       = useState(0);
  const [paydaySaving, setPaydaySaving] = useState(false);
  const [paydayErrorMsg, setPaydayErrorMsg] = useState<string | null>(null);
  const [incomeInput, setIncomeInput]     = useState("");
  const [incomeFocused, setIncomeFocused] = useState(false);
  const [incomeSaving, setIncomeSaving]   = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [bankAdded, setBankAdded] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioVerifying, setBioVerifying] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [planInfo, setPlanInfo] = useState<SubscriptionInfo | null | undefined>(undefined);

  useEffect(() => {
    if (isNativePlatform()) {
      checkBiometryAvailability().then(({ supported }) => setBioSupported(supported)).catch(() => {});
      return;
    }
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    if (!rn) return;
    const id = Math.random().toString(36).slice(2);
    const onResult = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.id !== id) return;
      window.removeEventListener("native-biometrics", onResult);
      setBioSupported(!!d.supported);
    };
    window.addEventListener("native-biometrics", onResult);
    rn.postMessage(JSON.stringify({ type: "biometrics:get", id }));
    return () => window.removeEventListener("native-biometrics", onResult);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || localStorage.getItem("wealth_onboarding_resume") !== "plan") return;
    const billingResult = new URLSearchParams(window.location.search).get("billing");
    queueMicrotask(() => setStep(billingResult === "success" ? "income" : "plan"));
  }, []);

  useEffect(() => {
    if (step !== "plan" || planInfo !== undefined) return;
    api.getSubscription()
      .then(setPlanInfo)
      .catch(() => setPlanInfo(null));
  }, [planInfo, step]);

  function setBiometrics(enabled: boolean) {
    if (isNativePlatform()) {
      setBiometricLockEnabled(enabled);
      return;
    }
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    rn?.postMessage(JSON.stringify({ type: "biometrics:set", enabled }));
  }

  // BiometricLock gates every route including /settings, so a lock pref
  // must never be persisted without a confirmed successful auth — otherwise
  // a failed/denied first Face ID prompt would strand the user with no
  // in-app way to turn it back off. Mirrors SettingsPage's toggleBiometrics.
  async function handleEnableBiometrics() {
    if (isNativePlatform()) {
      setBioVerifying(true);
      setBioError(null);
      const ok = await authenticateBiometrics("Enable biometric unlock");
      setBioVerifying(false);
      if (!ok) {
        setBioError("Couldn't verify. Try again, or skip for now.");
        return;
      }
      setBiometricLockEnabled(true);
      finish();
      return;
    }
    // Expo bridge: fire-and-forget, matching its existing (pre-existing,
    // unchanged) behaviour — the native wrapper owns confirmation there.
    setBiometrics(true);
    finish();
  }

  function bankDoneNext() {
    if (bioSupported) setStep("secure");
    else finish();
  }

  const dotIndex = STEP_DOTS.indexOf(step);

  async function finish() {
    // Mark onboarding complete only here — at the very end — so refreshing
    // mid-flow doesn't skip the pay-period and bank steps.
    try { await api.updateProfile(`${firstName.trim()} ${lastName.trim()}`, postcode.trim()); } catch {}
    localStorage.removeItem("wealth_onboarding_resume");
    localStorage.setItem("wealth_tutorial_pending", "1");
    onComplete();
  }

  async function saveProfile() {
    const first = firstName.trim();
    const last  = lastName.trim();
    if (!first) { setError("Please enter your first name."); return; }
    if (!last)  { setError("Please enter your last name."); return; }
    setSaving(true);
    setError(null);
    try {
      // Save name WITHOUT completing onboarding so refresh still shows steps 3 & 4.
      await api.updateProfile(`${first} ${last}`, postcode.trim(), false);
      setStep("payday");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // G60: this used to fire api.updatePreferences(...).catch(() => {}) and
  // always advance to "plan" regardless of outcome, so a failed save left
  // the whole app's Home/Spend/Planning runway calculations keyed to a pay
  // schedule the user never actually confirmed, with no sign anything went
  // wrong. Onboarding runs OUTSIDE PreferencesContext (AuthProvider renders
  // it INSTEAD of the Providers tree's children while onboarding is
  // pending, see components/AuthProvider.tsx) — there is no
  // refreshPreferences()/notePreferencesVersion to reconcile against and no
  // local value elsewhere in this flow that would need reverting, so the
  // optimistic-apply-and-revert half of lib/preferenceSave.ts's shape does
  // not apply here (both `getCurrent`/`apply` below are trivial no-ops).
  // What DOES apply, and is exactly why this still goes through the shared
  // saver rather than a bespoke try/catch: one write in flight at a time
  // (protects against a double-tap firing the PATCH twice) and a clean
  // success/failure signal via onSuccess/onError, used here to decide
  // whether to advance at all.
  //
  // A real pay schedule (anything but "I'll set this later", which never
  // calls save() at all) BLOCKS progress on failure -- staying put with the
  // button re-enabled is preferred over silently proceeding with an
  // unsaved, load-bearing setting. First attempt at this (rejected on
  // review, 2026-09-12) blocked with NO other signal: paydaySaving resets
  // to false, the button just flips back from "Saving..." to "Continue" and
  // sits there, which on the very first screen a new user meets reads as a
  // dead button, not a deliberate retry state. Fixed by paydayErrorMsg
  // below, rendered with the same ink-plus-amber-dot role="status" pattern
  // already used in this diff for SpendTrends' widgetsSaveMsg and
  // PreferencesContext's preferencesSaveError, wording the escape
  // explicitly (retry, or pick "I'll set this later" above).
  const paydayOutcomeRef = useRef<"ok" | "failed">("ok");
  const paydaySaverRef = useRef(createPreferenceSaver<object>({
    queue: createSerialQueue(),
    getCurrent: () => ({}),
    apply: () => {},
    save: (v) => api.updatePreferences({ pay_period_config: v }),
    reconcile: async () => undefined,
    onSuccess: () => { paydayOutcomeRef.current = "ok"; setPaydayErrorMsg(null); },
    // Rejected on review (2026-09-12): blocking progress with the button
    // simply reverting to "Continue" reads as a dead button on the very
    // first screen a new user meets -- there is no OTHER visible sign
    // anything went wrong. onError already runs with `null` at the start of
    // every attempt (clearing a stale message before this one begins) and
    // with a real message on failure -- see lib/preferenceSave.ts's own
    // docstring, point 6 -- so this just needs to show it, same
    // ink-plus-amber-dot role="status" pattern already used in this diff
    // for SpendTrends' widgetsSaveMsg and PreferencesContext's
    // preferencesSaveError.
    onError: (msg) => {
      if (msg !== null) paydayOutcomeRef.current = "failed";
      setPaydayErrorMsg(msg);
    },
  })).current;

  async function savePayday() {
    const chosen = PAY_OPTIONS[payIdx].value;
    if (!chosen) {
      // "I'll set this later" — nothing to save, always proceeds.
      setStep("plan");
      return;
    }
    setPaydaySaving(true);
    await paydaySaverRef.run(chosen);
    setPaydaySaving(false);
    if (paydayOutcomeRef.current === "ok") setStep("plan");
    // On failure: stay on this step. The button below is enabled again
    // (paydaySaving is back to false), so tapping Continue simply retries.
  }

  // Show 107,000 not 107000 while not focused — mirrors SettingsPage's fmtDigits.
  const fmtDigits = (v: string) => (v ? Number(v).toLocaleString("en-GB") : "");

  // G60: income is explicitly optional (the copy on this step says so, and
  // "I'll set this later" is always one tap away via skipIncome below) and,
  // unlike pay period, nothing elsewhere depends on it being set correctly
  // from day one — the same "Financial profile" field is editable in
  // Settings with its own full revert-and-surface handling (financeMsg /
  // handleIncomeBlur). So this keeps its pre-existing behaviour of never
  // blocking progression on a save error, and still has nowhere on this
  // step to show a failure message (see savePayday's comment above for why
  // Onboarding has no PreferencesContext to reconcile against) — the one
  // thing this move to the shared saver adds is the same single-flight
  // protection savePayday gets, for consistency, even though a double-tap
  // here is lower-stakes.
  const incomeSaverRef = useRef(createPreferenceSaver<number>({
    queue: createSerialQueue(),
    getCurrent: () => 0,
    apply: () => {},
    save: (v) => api.updatePreferences({ income_value: v }),
    reconcile: async () => undefined,
  })).current;

  async function saveIncome() {
    const n = parseInt(incomeInput.replace(/[^0-9]/g, ""), 10);
    const value = isNaN(n) ? 0 : n;
    if (value > 0) {
      setIncomeSaving(true);
      await incomeSaverRef.run(value);
      setIncomeSaving(false);
    }
    setStep("bank");
  }

  function skipIncome() {
    setStep("bank");
  }

  // ── welcome ────────────────────────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl shadow-xl mb-6 overflow-hidden">
            {/* Plain <img>, not next/image: the mobile Capacitor build is a
                static export without images.unoptimized set, so next/image
                would emit a /_next/image?url=... optimizer URL that 404s in
                the exported bundle. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="Sorted" width={80} height={80} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Welcome to Sorted
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm leading-relaxed">
            Your money, all in one place. Set up takes 2 minutes.
          </p>
        </div>

        <div className="space-y-3 mb-10">
          {[
            { icon: Building2, color: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-600 dark:text-blue-400",    text: "Connect all your banks automatically via open banking" },
            { icon: Wallet,    color: "bg-emerald-50 dark:bg-emerald-900/30", iconColor: "text-emerald-600 dark:text-emerald-400", text: "Track spending and set budgets that actually stick" },
            { icon: PennyMark, color: "bg-violet-50 dark:bg-violet-900/30", iconColor: "text-violet-600 dark:text-violet-400", text: "Get AI-powered insights to save more money" },
          ].map(({ icon: Icon, color, iconColor, text }) => (
            <div key={text} className="flex items-center gap-4 bg-white dark:bg-slate-800 rounded-2xl px-4 py-3.5 shadow-sm">
              <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={iconColor} />
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug">{text}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => setStep("profile")}
          className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition flex items-center justify-center gap-2 shadow-md shadow-indigo-200 dark:shadow-none"
        >
          Get started <ChevronRight size={16} />
        </button>
      </Shell>
    );
  }

  // ── profile ────────────────────────────────────────────────────────────────
  if (step === "profile") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s your name?</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            We use your name to recognise transfers between your own accounts.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">First name</label>
              <input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveProfile(); }}
                maxLength={40}
                placeholder="Kevin"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Last name</label>
              <input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveProfile(); }}
                maxLength={40}
                placeholder="Maingi"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Postcode <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              value={postcode}
              onChange={e => setPostcode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveProfile(); }}
              maxLength={10}
              autoCapitalize="characters"
              placeholder="e.g. SW1A 1AA"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 uppercase placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">Used to find cheaper fuel near you.</p>
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <button
            onClick={saveProfile}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-sm font-semibold text-white disabled:opacity-50 transition-all"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      </Shell>
    );
  }

  // ── payday ─────────────────────────────────────────────────────────────────
  if (step === "payday") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">When do you get paid?</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            This powers your spending runway and budget periods.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm overflow-hidden mb-4">
          {PAY_OPTIONS.map((opt, i) => (
            <button
              key={i}
              onClick={() => setPayIdx(i)}
              className={`w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0 ${
                payIdx === i
                  ? "bg-indigo-50 dark:bg-indigo-900/30"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
              }`}
            >
              <div>
                <p className={`text-sm font-medium ${payIdx === i ? "text-indigo-700 dark:text-indigo-300" : "text-slate-800 dark:text-slate-100"}`}>
                  {opt.label}
                </p>
                {opt.sub && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{opt.sub}</p>
                )}
              </div>
              {payIdx === i && (
                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0">
                  <Check size={11} stroke="white" strokeWidth={3} />
                </div>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={savePayday}
          disabled={paydaySaving}
          className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {paydaySaving ? "Saving…" : "Continue"}
        </button>

        {/* Rejected on review (2026-09-12): staying on this step with no
            visible sign anything failed reads as a dead button on the very
            first screen a new user meets. Ink-plus-amber-dot role="status",
            the same pattern already used in this diff for SpendTrends'
            widgetsSaveMsg and PreferencesContext's preferencesSaveError
            (DESIGN.md:142), naming the actual escape this exact step
            offers: pick "I'll set this later" above and continue. */}
        {paydayErrorMsg && (
          <p role="status" aria-live="polite" className="mt-3 flex items-start gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
            <span>Could not save that. Try again, or choose &quot;I&apos;ll set this later&quot; above and continue.</span>
          </p>
        )}
      </Shell>
    );
  }

  // ── plan ───────────────────────────────────────────────────────────────────
  if (step === "plan") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Choose your plan</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Statements is free and selected for you. Paid plans can renew monthly, every 3 months, every 6 months or yearly.
          </p>
        </div>
        {planInfo === undefined ? (
          <div className="rounded-2xl bg-white p-4 text-sm text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">Checking plan availability…</div>
        ) : planInfo === null ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Could not load the plans</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">Check your connection, then try again. No plan has been selected.</p>
            <button type="button" onClick={() => setPlanInfo(undefined)} className="mt-3 min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 outline-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200">Try again</button>
          </div>
        ) : (
          <PlanPicker info={planInfo} context="onboarding" onContinue={() => { localStorage.removeItem("wealth_onboarding_resume"); setStep("income"); }} />
        )}
      </Shell>
    );
  }

  // ── income ─────────────────────────────────────────────────────────────────
  if (step === "income") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">What do you earn?</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Optional, this just helps Penny personalise your insights.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-6 space-y-4">
          <div>
            <label htmlFor="onboarding-income" className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              Approximate income (£/yr)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
              <input
                id="onboarding-income"
                type="text"
                inputMode="numeric"
                value={incomeFocused ? incomeInput : fmtDigits(incomeInput)}
                onChange={e => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))}
                onFocus={() => setIncomeFocused(true)}
                onBlur={() => setIncomeFocused(false)}
                onKeyDown={e => { if (e.key === "Enter") saveIncome(); }}
                placeholder="e.g. 45000"
                className="w-full pl-7 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
              Used to personalise your tax insights and what Sorted suggests you do with spare money. You can change it later in Account.
            </p>
          </div>

          <button
            onClick={saveIncome}
            disabled={incomeSaving}
            className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-sm font-semibold text-white disabled:opacity-50 transition-all"
          >
            {incomeSaving ? "Saving…" : "Continue"}
          </button>
        </div>

        <button
          onClick={skipIncome}
          className="w-full py-2.5 mt-3 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          I&apos;ll set this later
        </button>
      </Shell>
    );
  }

  // ── secure (app shell with biometrics only) ─────────────────────────────────
  if (step === "secure") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 bg-indigo-50 dark:bg-indigo-900/30">
            <ShieldCheck size={28} className="text-indigo-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Protect your dashboard</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            Your finances live here. Require your fingerprint or face every time
            the app opens, you can change this any time in Settings.
          </p>
        </div>

        <button
          onClick={() => void handleEnableBiometrics()}
          disabled={bioVerifying}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-[0.98] disabled:opacity-50 mb-3"
        >
          {bioVerifying ? "Verifying…" : "Enable biometric unlock"}
        </button>
        {bioError && (
          <p className="text-xs text-rose-500 text-center mb-3">{bioError}</p>
        )}
        <button
          onClick={() => { setBiometrics(false); finish(); }}
          className="w-full py-2.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Maybe later
        </button>
      </Shell>
    );
  }

  // ── bank ───────────────────────────────────────────────────────────────────
  return (
    <Shell dotIndex={dotIndex}>
      <div className="text-center mb-6">
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 ${bankAdded ? "bg-emerald-50 dark:bg-emerald-900/30" : "bg-blue-50 dark:bg-blue-900/30"}`}>
          {bankAdded
            ? <Check size={28} className="text-emerald-500" strokeWidth={2.5} />
            : <Building2 size={28} className="text-blue-500" />
          }
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          {bankAdded ? "Bank connected!" : "Connect your first bank"}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
          {bankAdded
            ? "Your transactions are syncing in the background."
            : "Link your account in seconds via secure open banking. Wealth can only read data, it can never move your money."
          }
        </p>
      </div>

      {!bankAdded && (
        <div className="grid grid-cols-3 gap-2 mb-6">
          {[
            { badge: "🔒", text: "Read-only access" },
            { badge: "🏦", text: "Bank-grade encryption" },
            { badge: "✕",  text: "Revoke anytime" },
          ].map(({ badge, text }) => (
            <div key={text} className="bg-white dark:bg-slate-800 rounded-2xl p-3 text-center shadow-sm">
              <p className="text-lg mb-1">{badge}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{text}</p>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => bankAdded ? bankDoneNext() : setShowSheet(true)}
        className={`w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.98] mb-3 ${
          bankAdded
            ? "bg-emerald-500 hover:bg-emerald-600"
            : "bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none"
        }`}
      >
        {bankAdded ? "Let's go ›" : "Connect a bank"}
      </button>

      {!bankAdded && (
        <button
          onClick={bankDoneNext}
          className="w-full py-2.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          Skip for now, I&apos;ll add banks later
        </button>
      )}

      {showSheet && (
        <BankPickerSheet
          onClose={() => setShowSheet(false)}
          onConnecting={() => { setShowSheet(false); setBankAdded(true); }}
        />
      )}
    </Shell>
  );
}
