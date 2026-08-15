"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Moon,
  Bell,
  Wallet,
  Landmark,
  ShieldCheck,
  Database,
  UserRound,
  AlertTriangle,
  PieChart,
  ChevronRight,
  ChevronDown,
  LogOut,
  RotateCcw,
} from "lucide-react";
import Toggle from "@/components/Toggle";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";

// Static design preview — "Variant A: Refined Cockpit" — Settings redesign.
// Fully self-contained: hardcoded mock state only, no API calls, no auth.
// Not linked from app nav — deep-link only (/design/settings-a).
// Safe to delete once the Settings redesign work is confirmed.

// ── Mock data ────────────────────────────────────────────────────────────

const MOCK_ACCOUNTS: Account[] = [
  { id: "acc-1", name: "Premier Current Account", type: "transaction", subtype: "current", balance: 3421.9, currency: "GBP", provider: "Barclays", status: "active" },
  { id: "acc-2", name: "Personal GBP", type: "transaction", subtype: "current", balance: 812.4, currency: "GBP", provider: "Barclays", status: "active" },
  { id: "acc-3", name: "THE NUMBER ONE", type: "transaction", subtype: "current", balance: 5210.0, currency: "GBP", provider: "NatWest", status: "active" },
  { id: "acc-4", name: "MAINGI K M", type: "transaction", subtype: "current", balance: 1104.62, currency: "GBP", provider: "HSBC", status: "active" },
  { id: "acc-5", name: "Kevin Maingi", type: "transaction", subtype: "current", balance: 276.15, currency: "GBP", provider: "Revolut", status: "active" },
  { id: "acc-6", name: "Excess", type: "savings", subtype: "savings", balance: 9800.0, currency: "GBP", provider: "Revolut", status: "active" },
  { id: "acc-7", name: "Kevin Mbithi Maingi", type: "transaction", subtype: "current", balance: 642.33, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "acc-8", name: "Saving Challenge (2026)", type: "savings", subtype: "savings", balance: 1250.0, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "acc-9", name: "Holiday", type: "savings", subtype: "savings", balance: 480.0, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "acc-10", name: "Personal", type: "transaction", subtype: "current", balance: 2033.77, currency: "GBP", provider: "Starling", status: "active" },
  { id: "acc-11", name: "Bills", type: "transaction", subtype: "current", balance: 918.2, currency: "GBP", provider: "Starling", status: "active" },
  { id: "acc-12", name: "Savings", type: "savings", subtype: "savings", balance: 14200.5, currency: "GBP", provider: "HSBC", status: "active" },
  { id: "acc-13", name: "Digital saver", type: "savings", subtype: "savings", balance: 3000.0, currency: "GBP", provider: "Digital saver", manual: true, status: "active" },
];

const NOTIFY_ROWS: { key: string; title: string; desc: string }[] = [
  { key: "insights", title: "Tips & insights", desc: "Ways to save money we spot for you" },
  { key: "budget_alerts", title: "Budget alerts", desc: "When you go over a budget category" },
  { key: "bill_alerts", title: "Bill alerts", desc: "When an upcoming bill may not clear" },
  { key: "goal_milestones", title: "Goal milestones", desc: "When you reach a savings goal" },
  { key: "period_digest", title: "Pay-period digest", desc: "A fresh-start goals summary each new pay period" },
  { key: "transactions", title: "New transactions", desc: "Each time new transactions arrive" },
];

// ── Small shared bits ───────────────────────────────────────────────────

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

const INDIGO = "#4f46e5";
const EMERALD = "#10b981";
const RED = "#ef4444";

// Card entrance stagger — fully self-contained (this preview must not depend
// on globals.css or any other file). Scoped keyframes are declared in the
// <style> tag below; this just computes each card's stagger delay (0, 50,
// 100... ms), matching the 260ms/cubic-bezier(0.23,1,0.32,1) rise used
// elsewhere in the app.
function cardStyle(index: number): React.CSSProperties {
  return { animationDelay: `${index * 50}ms` };
}

export default function SettingsAPreview() {
  // Display
  const [darkMode, setDarkMode] = useState(true);

  // Notifications
  const [pushOn, setPushOn] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    insights: true,
    budget_alerts: true,
    bill_alerts: true,
    goal_milestones: true,
    period_digest: true,
    transactions: true,
  });

  // Where money can come from
  const [coverOpen, setCoverOpen] = useState(true);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Financial profile — income bracket fixed at "100k_125k" so the pension
  // and Child Benefit rows are shown, per the mock spec.
  const incomeBracket: "under_100k" | "100k_125k" | "125k_plus" = "100k_125k";
  const [incomeInput, setIncomeInput] = useState("107000");
  const [pensionInput, setPensionInput] = useState("24000");
  const [hasChildBenefit, setHasChildBenefit] = useState(false);

  // Security
  const [bioOn, setBioOn] = useState(false);

  // Data
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Account
  const [fullName, setFullName] = useState("Kevin Maingi");
  const [postcode, setPostcode] = useState("");

  // Danger zone
  const [dangerConfirming, setDangerConfirming] = useState(false);

  const fmtDigits = (v: string) => (v ? Number(v).toLocaleString("en-GB") : "");

  function toggleCoverAccount(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleNotifPref(key: string) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSyncHistory() {
    setSyncing(true);
    setSyncMsg(null);
    setTimeout(() => {
      setSyncing(false);
      setSyncMsg("Full sync complete");
      setTimeout(() => setSyncMsg(null), 4000);
    }, 700);
  }

  const total = MOCK_ACCOUNTS.length;
  const allowedCount = MOCK_ACCOUNTS.filter((a) => !excludedIds.has(a.id)).length;
  const summaryText =
    allowedCount === total
      ? `Any of your ${total} accounts`
      : `${allowedCount} of ${total} accounts`;

  const headerStats = [
    `${total} accounts connected`,
    "Face ID available",
    "Synced today",
  ].join(" · ");

  return (
    <div className="dark">
      {/* Scoped entrance animation for this preview only — no dependency on
          globals.css. Mirrors the app's standard card-rise pattern (8px
          translateY, opacity 0->1, 260ms cubic-bezier(0.23,1,0.32,1)) and
          respects prefers-reduced-motion (opacity only, no transform). */}
      <style>{`
        @keyframes settingsARiseIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .settings-a-rise-in {
          animation: settingsARiseIn 260ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .settings-a-rise-in {
            animation-duration: 1ms;
            animation-delay: 0ms;
            transform: none;
          }
        }
      `}</style>
      <div
        className="min-h-dvh bg-[#0f172a] pb-24 lg:max-w-6xl lg:mx-auto"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-4 pt-6 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
            CUSTOMISE YOUR DASHBOARD
          </p>
          <h1 className="text-xl font-bold text-slate-100">Settings</h1>
          <p className="text-[13px] mt-1.5" style={{ color: "#94a3b8" }}>
            {headerStats}
          </p>
        </div>

        <div className="px-4 pt-4 space-y-3">
          {/* ── Display ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(0)}>
            <SectionHeader icon={Moon} hex={INDIGO} title="Display" />
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-slate-100">Dark Mode</p>
                <p className="text-xs text-slate-400 mt-0.5">Easier on the eyes at night</p>
              </div>
              <Toggle checked={darkMode} onChange={() => setDarkMode((v) => !v)} label="Dark mode" />
            </div>
          </div>

          {/* ── Notifications ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(1)}>
            <SectionHeader icon={Bell} hex={INDIGO} title="Notifications" />
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={16} className={pushOn ? "text-indigo-400" : "text-slate-500"} />
                  <div>
                    <p className="text-sm font-medium text-slate-100">Push notifications</p>
                    <p className="text-xs text-slate-400 mt-0.5">Allow alerts on this device</p>
                  </div>
                </div>
                <Toggle checked={pushOn} onChange={() => setPushOn((v) => !v)} label="Push notifications" />
              </div>
            </div>

            <div className="border-t border-slate-700">
              <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Notify me about</p>
              </div>
              {NOTIFY_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between px-4 py-3 border-t border-slate-700/50"
                >
                  <div className="pr-3">
                    <p className="text-sm font-medium text-slate-100">{row.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{row.desc}</p>
                  </div>
                  <Toggle
                    checked={!!notifPrefs[row.key]}
                    onChange={() => toggleNotifPref(row.key)}
                    label={row.title}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ── Where money can come from ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(2)}>
            <button
              type="button"
              aria-expanded={coverOpen}
              aria-controls="settings-a-cover-body"
              onClick={() => setCoverOpen((o) => !o)}
              className={`w-full text-left flex items-center gap-3 px-4 py-3 active:opacity-70 transition-transform duration-150 ease-out${
                coverOpen ? " border-b border-slate-700" : ""
              }`}
            >
              <IconChip icon={Wallet} hex={INDIGO} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Where money can come from
                </span>
                <span className="block text-sm font-medium text-slate-100 mt-0.5">{summaryText}</span>
              </span>
              <ChevronDown
                size={16}
                className={`text-slate-500 flex-shrink-0 transition-transform${coverOpen ? " rotate-180" : ""}`}
              />
            </button>
            {coverOpen && (
              <div id="settings-a-cover-body">
                <p className="px-4 pt-3 text-[13px] text-slate-400 leading-snug">
                  By default Penny can move from any of your accounts. Turn one off and it will never be suggested.
                </p>
                <div className="mt-2 divide-y divide-slate-700/60">
                  {MOCK_ACCOUNTS.map((acc) => {
                    const brand = accountBrand(acc);
                    const allowed = !excludedIds.has(acc.id);
                    return (
                      <div
                        key={acc.id}
                        className="flex items-center gap-3 px-4 py-3 min-h-[44px]"
                      >
                        <BankBadge
                          logoSrc={brand.logoSrc}
                          initials={brand.initials}
                          altText={brand.label}
                          brandBg={brand.background}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-slate-100 truncate">{acc.name}</span>
                          {(acc.manual || acc.provider) && (
                            <span className="block text-xs text-slate-500 truncate">
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

          {/* ── Financial profile ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(3)}>
            <SectionHeader
              icon={Landmark}
              hex={INDIGO}
              title="Financial profile"
              subtitle="Self-declared — unlocks personalised tax insights"
            />

            <div className="px-4 py-3.5">
              <label htmlFor="settings-a-income" className="text-sm font-medium text-slate-100 block mb-1">
                Approximate income (£/yr)
              </label>
              <p className="text-xs text-slate-400 mb-2">
                Used to personalise your tax levers and calculations for your income band
              </p>
              <div className="relative w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                <input
                  id="settings-a-income"
                  type="text"
                  inputMode="numeric"
                  value={fmtDigits(incomeInput)}
                  onChange={(e) => setIncomeInput(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 110000"
                  className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-600 bg-slate-700 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {(incomeBracket === "100k_125k" || incomeBracket === "125k_plus") && (
              <>
                <div className="px-4 pb-3.5 border-t border-slate-700/50 pt-3.5">
                  <label htmlFor="settings-a-pension" className="text-sm font-medium text-slate-100 block mb-1">
                    Pension contributions this year (£/yr)
                  </label>
                  <p className="text-xs text-slate-400 mb-2">Used to calculate your adjusted net income</p>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                    <input
                      id="settings-a-pension"
                      type="text"
                      inputMode="numeric"
                      value={fmtDigits(pensionInput)}
                      onChange={(e) => setPensionInput(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-600 bg-slate-700 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between px-4 pb-3.5 border-t border-slate-700/50 pt-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Receiving Child Benefit</p>
                    <p className="text-xs text-slate-400 mt-0.5">High income charge applies over £60k</p>
                  </div>
                  <Toggle
                    checked={hasChildBenefit}
                    onChange={() => setHasChildBenefit((v) => !v)}
                    label="Receiving Child Benefit"
                    onColor="bg-indigo-500"
                  />
                </div>
              </>
            )}

            {incomeBracket && (
              <button
                type="button"
                className="w-full flex items-center gap-3 justify-between px-4 py-3.5 border-t border-slate-700 text-indigo-400 active:opacity-70 active:bg-indigo-900/10 transition-transform duration-150 ease-out"
              >
                <span className="flex items-center gap-2.5">
                  <PieChart size={16} />
                  <span className="text-sm font-semibold">View tax breakdown</span>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          {/* ── Security ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(4)}>
            <SectionHeader icon={ShieldCheck} hex={EMERALD} title="Security" />
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-slate-100">Biometric unlock</p>
                <p className="text-xs text-slate-400 mt-0.5">Require fingerprint or face to open the app</p>
              </div>
              <Toggle checked={bioOn} onChange={() => setBioOn((v) => !v)} label="Biometric login" />
            </div>
          </div>

          {/* ── Data ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(5)}>
            <SectionHeader icon={Database} hex={INDIGO} title="Data" />
            <div className="px-4 py-3.5">
              <p className="text-sm font-medium text-slate-100">Sync all history</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks.</p>
              <button
                type="button"
                onClick={handleSyncHistory}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-transform duration-150 ease-out"
              >
                <RotateCcw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync history (90 days)"}
              </button>
              {syncMsg && <p className="mt-2 text-xs font-medium text-emerald-400">{syncMsg}</p>}
            </div>
          </div>

          {/* ── Account ── */}
          <div className="glass-card rounded-2xl overflow-hidden settings-a-rise-in" style={cardStyle(6)}>
            <div className="px-4 py-3 border-b border-slate-700 flex items-start gap-2.5">
              <IconChip icon={UserRound} hex={INDIGO} />
              <div className="min-w-0 pt-0.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
                <p className="text-xs text-slate-400">kevin.maingi12@gmail.com</p>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-slate-700 space-y-3">
              <div>
                <label htmlFor="settings-a-name" className="text-xs text-slate-400 mb-1 block">
                  Full name <span className="opacity-70">— used to recognise transfers between your own accounts</span>
                </label>
                <input
                  id="settings-a-name"
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="First Last"
                />
              </div>
              <div>
                <label htmlFor="settings-a-postcode" className="text-xs text-slate-400 mb-1 block">
                  Home postcode <span className="opacity-70">— used for local fuel prices</span>
                </label>
                <input
                  id="settings-a-postcode"
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="e.g. B91 2AB"
                />
              </div>
            </div>

            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-slate-300 hover:bg-slate-700/60 active:opacity-70 transition-transform duration-150 ease-out"
            >
              <LogOut size={16} />
              <span className="text-sm font-medium">Sign out</span>
            </button>
          </div>

          {/* ── Danger zone ── */}
          <div
            className="glass-card rounded-2xl overflow-hidden border border-red-900/40 settings-a-rise-in"
            style={cardStyle(7)}
          >
            <div className="px-4 py-3 flex items-start gap-2.5">
              <IconChip icon={AlertTriangle} hex={RED} />
              <div className="min-w-0 pt-0.5 flex-1">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1">Danger zone</p>
                <button
                  type="button"
                  onClick={() => setDangerConfirming((v) => !v)}
                  className="px-4 py-2.5 -ml-4 text-sm font-medium text-red-400 rounded-xl hover:bg-red-900/10 active:scale-[0.98] transition-transform duration-150 ease-out"
                >
                  Delete account &amp; all data…
                </button>
                {dangerConfirming && (
                  <p className="text-xs text-red-400/80 mt-1">
                    Design preview only — deletion is disabled on this route.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
