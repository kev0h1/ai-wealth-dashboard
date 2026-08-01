"use client";

import { useState, useEffect } from "react";
import { Wallet, Sparkles, ChevronRight, Check, Building2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import BankPickerSheet from "@/components/BankPickerSheet";

interface OnboardingProps {
  defaultName?: string;
  onComplete: () => void;
}

type Step = "welcome" | "profile" | "payday" | "bank" | "secure";

const PAY_OPTIONS: { label: string; sub: string; value: object | null }[] = [
  { label: "Last Friday of month",  sub: "Typical UK monthly salary",         value: { type: "last_friday" } },
  { label: "1st of the month",      sub: "e.g. civil service, some pensions", value: { type: "monthly_pay_date", day: 1 } },
  { label: "15th of the month",     sub: "",                                   value: { type: "monthly_pay_date", day: 15 } },
  { label: "25th of the month",     sub: "Common for many employers",          value: { type: "monthly_pay_date", day: 25 } },
  { label: "28th of the month",     sub: "",                                   value: { type: "monthly_pay_date", day: 28 } },
  { label: "End of the month",      sub: "Calendar month view",                value: { type: "calendar_month" } },
  { label: "I'll set this later",   sub: "",                                   value: null },
];

const STEP_DOTS: Step[] = ["profile", "payday", "bank", "secure"];

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
  const [showSheet, setShowSheet] = useState(false);
  const [bankAdded, setBankAdded] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [bioSupported, setBioSupported] = useState(false);

  useEffect(() => {
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

  function setBiometrics(enabled: boolean) {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    rn?.postMessage(JSON.stringify({ type: "biometrics:set", enabled }));
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

  async function savePayday() {
    const chosen = PAY_OPTIONS[payIdx].value;
    if (chosen) {
      try { await api.updatePreferences({ pay_period_config: chosen }); } catch {}
    }
    setStep("bank");
  }

  // ── welcome ────────────────────────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <Shell dotIndex={dotIndex}>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl mb-6">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Welcome to Wealth
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm leading-relaxed">
            Your money, all in one place. Set up takes 2 minutes.
          </p>
        </div>

        <div className="space-y-3 mb-10">
          {[
            { icon: Building2, color: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-600 dark:text-blue-400",    text: "Connect all your banks automatically via open banking" },
            { icon: Wallet,    color: "bg-emerald-50 dark:bg-emerald-900/30", iconColor: "text-emerald-600 dark:text-emerald-400", text: "Track spending and set budgets that actually stick" },
            { icon: Sparkles,  color: "bg-violet-50 dark:bg-violet-900/30", iconColor: "text-violet-600 dark:text-violet-400", text: "Get AI-powered insights to save more money" },
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
          className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition"
        >
          Continue
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
            the app opens — you can change this any time in Settings.
          </p>
        </div>

        <button
          onClick={() => { setBiometrics(true); finish(); }}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-[0.98] mb-3"
        >
          Enable biometric unlock
        </button>
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
            : "Link your account in seconds via secure open banking. Wealth can only read data — it can never move your money."
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
          Skip for now — I&apos;ll add banks later
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
