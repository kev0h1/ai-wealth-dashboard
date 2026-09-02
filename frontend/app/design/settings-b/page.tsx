"use client";

import { useState } from "react";
import {
  Moon,
  Bell,
  Wallet,
  Landmark,
  ShieldCheck,
  Database,
  UserRound,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  LogOut,
  CircleCheck,
} from "lucide-react";
import Toggle from "@/components/Toggle";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account, NotificationPrefs } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────
// /design/settings-b — "Variant B: Grouped Estate"
// Static preview only. Hardcoded mock state, no API calls, no auth context.
// Compare against Variant A on Kevin's phone before anything touches the
// real SettingsPage.tsx.
// ─────────────────────────────────────────────────────────────────────────

const MOCK_ACCOUNTS: Account[] = [
  { id: "a1", name: "Premier Current Account", type: "transaction", subtype: "current", balance: 3120.44, currency: "GBP", provider: "Barclays", status: "active" },
  { id: "a2", name: "Personal GBP", type: "transaction", subtype: "current", balance: 842.10, currency: "GBP", provider: "Barclays", status: "active" },
  { id: "a3", name: "THE NUMBER ONE", type: "transaction", subtype: "current", balance: 1560.00, currency: "GBP", provider: "NatWest", status: "active" },
  { id: "a4", name: "MAINGI K M", type: "transaction", subtype: "current", balance: 2110.67, currency: "GBP", provider: "HSBC", status: "active" },
  { id: "a5", name: "Kevin Maingi", type: "transaction", subtype: "current", balance: 430.22, currency: "GBP", provider: "Revolut", status: "active" },
  { id: "a6", name: "Excess", type: "savings", subtype: "savings", balance: 5200.00, currency: "GBP", provider: "Revolut", status: "active" },
  { id: "a7", name: "Kevin Mbithi Maingi", type: "transaction", subtype: "current", balance: 970.51, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "a8", name: "Saving Challenge (2026)", type: "savings", subtype: "savings", balance: 1284.00, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "a9", name: "Holiday", type: "savings", subtype: "savings", balance: 640.00, currency: "GBP", provider: "Monzo", status: "active" },
  { id: "a10", name: "Personal", type: "transaction", subtype: "current", balance: 1875.30, currency: "GBP", provider: "Starling", status: "active" },
  { id: "a11", name: "Bills", type: "transaction", subtype: "current", balance: 512.90, currency: "GBP", provider: "Starling", status: "active" },
  { id: "a12", name: "Savings", type: "savings", subtype: "savings", balance: 8340.00, currency: "GBP", provider: "HSBC", status: "active" },
  { id: "a13", name: "Digital saver", type: "savings", subtype: "savings", balance: 2000.00, currency: "GBP", provider: "Manual", status: "active", manual: true },
];

const NOTIFY_ROWS: { key: keyof NotificationPrefs; title: string; desc: string }[] = [
  { key: "insights", title: "Tips & insights", desc: "Ways to save money we spot for you" },
  { key: "bill_alerts", title: "Bill alerts", desc: "When an upcoming bill may not clear" },
  { key: "goal_milestones", title: "Goal milestones", desc: "When you reach a savings goal" },
  { key: "period_digest", title: "Pay-period digest", desc: "A fresh-start goals summary each new pay period" },
  { key: "transactions", title: "New transactions", desc: "Each time new transactions arrive" },
];

function rise(index: number): React.CSSProperties {
  return { "--card-index": index } as React.CSSProperties;
}

// Section shell: icon chip + title + whisper description, generous whitespace.
function SectionHeader({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 pt-4 pb-3">
      <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
        <Icon size={18} />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-[15px] font-bold text-slate-100">{title}</h2>
        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// Collapsible summary row — CSS grid-template-rows height trick, <=300ms ease-out.
function Collapsible({
  open,
  onToggle,
  summaryLabel,
  summaryValue,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  summaryLabel: string;
  summaryValue: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[44px] active:opacity-70 transition-opacity duration-150 ease-out${open ? " border-b border-slate-700/60" : ""}`}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{summaryLabel}</span>
          <span className="block text-sm font-medium text-slate-100 mt-0.5 truncate">{summaryValue}</span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-500 flex-shrink-0 transition-transform duration-300 ease-out${open ? " rotate-180" : ""}`}
        />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden min-h-0">{children}</div>
      </div>
    </div>
  );
}

export default function Page() {
  // Display
  const [darkModeOn, setDarkModeOn] = useState(true);

  // Notifications
  const [pushOn, setPushOn] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    transactions: true,
    goal_milestones: true,
    insights: true,
    period_digest: true,
    bill_alerts: true,
  });

  // Where money can come from
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Financial profile
  const [profileOpen, setProfileOpen] = useState(false);
  const [hasChildBenefit, setHasChildBenefit] = useState(false);

  // Security
  const [bioOn, setBioOn] = useState(false);

  // Data
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  // Account
  const [fullName, setFullName] = useState("Kevin Maingi");
  const [postcode, setPostcode] = useState("");

  const allowedCount = MOCK_ACCOUNTS.length - excludedIds.size;

  function toggleAccount(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleNotify(key: keyof NotificationPrefs) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSynced(false);
    setTimeout(() => {
      setSyncing(false);
      setSynced(true);
      setTimeout(() => setSynced(false), 2500);
    }, 900);
  }

  return (
    <div className="dark min-h-dvh bg-[#0f172a] pb-24">
      <div className="mx-auto max-w-xl px-4 pt-6" style={{ paddingTop: "env(safe-area-inset-top, 24px)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1">CUSTOMISE YOUR DASHBOARD</p>
        <h1 className="text-xl font-bold text-slate-100 mb-4">Settings</h1>

        {/* ── Status hero — the cockpit instrument panel ── */}
        <div className="glass-hero rounded-3xl p-5 card-rise-in" style={rise(0)}>
          <div className="flex items-center gap-2 mb-1">
            <CircleCheck size={18} className="text-indigo-400" />
            <p className="text-lg font-bold text-slate-100">You&apos;re all set</p>
          </div>
          <p className="text-xs text-slate-400 mb-4">Everything&apos;s connected and up to date — a couple of things worth a glance below.</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="glass-tile rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform duration-150 ease-out">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Accounts</p>
              <p className="text-[15px] font-bold text-slate-100 mt-1">13 connected</p>
            </div>
            <div className="glass-tile rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform duration-150 ease-out">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Security</p>
              <p className="text-[15px] font-bold text-amber-400 mt-1">Face ID off</p>
            </div>
            <div className="glass-tile rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform duration-150 ease-out">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last sync</p>
              <p className="text-[15px] font-bold text-emerald-400 mt-1">Today</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 mt-6">

          {/* ── Display ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(1)}>
            <SectionHeader icon={Moon} title="Display" desc="Tune how Sorted looks on this device" />
            <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-700/60">
              <div>
                <p className="text-sm font-medium text-slate-100">Dark Mode</p>
                <p className="text-xs text-slate-400 mt-0.5">Easier on the eyes at night</p>
              </div>
              <Toggle checked={darkModeOn} onChange={() => setDarkModeOn((v) => !v)} label="Dark mode" />
            </div>
          </div>

          {/* ── Notifications ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(2)}>
            <SectionHeader icon={Bell} title="Notifications" desc="Control what Penny and Sorted send you" />
            <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-700/60">
              <div className="flex items-center gap-3">
                <Bell size={16} className={pushOn ? "text-indigo-400" : "text-slate-500"} />
                <div>
                  <p className="text-sm font-medium text-slate-100">Push notifications</p>
                  <p className="text-xs text-slate-400 mt-0.5">Allow alerts on this device</p>
                </div>
              </div>
              <Toggle checked={pushOn} onChange={() => setPushOn((v) => !v)} label="Push notifications" />
            </div>
            <div className="border-t border-slate-700/60">
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Notify me about</p>
              {NOTIFY_ROWS.map((row) => (
                <div key={row.key} className="flex items-center justify-between px-4 py-3 border-t border-slate-700/30">
                  <div className="pr-3">
                    <p className="text-sm font-medium text-slate-100">{row.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{row.desc}</p>
                  </div>
                  <Toggle checked={!!notifPrefs[row.key]} onChange={() => toggleNotify(row.key)} label={row.title} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Where money can come from ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(3)}>
            <SectionHeader icon={Wallet} title="Where money can come from" desc="Accounts Penny is allowed to move money from" />
            <div className="border-t border-slate-700/60">
              <Collapsible
                open={accountsOpen}
                onToggle={() => setAccountsOpen((v) => !v)}
                summaryLabel="Eligible accounts"
                summaryValue={allowedCount === MOCK_ACCOUNTS.length ? `Any of your ${MOCK_ACCOUNTS.length} accounts` : `${allowedCount} of ${MOCK_ACCOUNTS.length} accounts`}
              >
                <p className="px-4 pt-3 text-[13px] text-slate-400 leading-snug">
                  By default Penny can move from any of your accounts. Turn one off and it will never be suggested.
                </p>
                <div className="mt-2 divide-y divide-slate-700/40">
                  {MOCK_ACCOUNTS.map((acc) => {
                    const brand = accountBrand(acc);
                    const allowed = !excludedIds.has(acc.id);
                    return (
                      <div key={acc.id} className="flex items-center gap-3 px-4 py-3 min-h-[44px]">
                        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-slate-100 truncate">{acc.name}</span>
                          <span className="block text-xs text-slate-500 truncate">{acc.manual ? "Offline account" : acc.provider}</span>
                        </span>
                        <Toggle checked={allowed} onChange={() => toggleAccount(acc.id)} label={`Allow transfers from ${acc.name}`} />
                      </div>
                    );
                  })}
                </div>
              </Collapsible>
            </div>
          </div>

          {/* ── Financial profile ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(4)}>
            <SectionHeader icon={Landmark} title="Financial profile" desc="Self-declared — unlocks personalised tax insights" />
            <div className="border-t border-slate-700/60">
              <Collapsible
                open={profileOpen}
                onToggle={() => setProfileOpen((v) => !v)}
                summaryLabel="Income declared"
                summaryValue="£107,000/yr · pension & Child Benefit factored in"
              >
                <div className="px-4 pt-3 pb-3.5">
                  <label htmlFor="settingsb-income" className="text-sm font-medium text-slate-100 block mb-1">Approximate income (£/yr)</label>
                  <p className="text-xs text-slate-400 mb-2">Used to personalise your tax levers and calculations for your income band</p>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                    <input id="settingsb-income" type="text" inputMode="numeric" defaultValue="107,000" className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-600 bg-slate-700 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="px-4 pb-3.5 border-t border-slate-700/40 pt-3.5">
                  <label htmlFor="settingsb-pension" className="text-sm font-medium text-slate-100 block mb-1">Pension contributions this year (£/yr)</label>
                  <p className="text-xs text-slate-400 mb-2">Used to calculate your adjusted net income</p>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                    <input id="settingsb-pension" type="text" inputMode="numeric" defaultValue="24,000" className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-600 bg-slate-700 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 pb-3.5 border-t border-slate-700/40 pt-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Receiving Child Benefit</p>
                    <p className="text-xs text-slate-400 mt-0.5">High income charge applies over £60k</p>
                  </div>
                  <Toggle checked={hasChildBenefit} onChange={() => setHasChildBenefit((v) => !v)} label="Receiving Child Benefit" onColor="bg-indigo-500" />
                </div>
                <button type="button" className="w-full flex items-center justify-between px-4 py-3.5 border-t border-slate-700/60 text-indigo-400 active:opacity-70 transition-opacity duration-150 ease-out">
                  <span className="text-sm font-semibold">View tax breakdown</span>
                  <ChevronRight size={16} />
                </button>
              </Collapsible>
            </div>
          </div>

          {/* ── Security ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(5)}>
            <SectionHeader icon={ShieldCheck} title="Security" desc="Keep the app locked to you, even if your phone is unlocked" />
            <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-700/60">
              <div>
                <p className="text-sm font-medium text-slate-100">Biometric unlock</p>
                <p className="text-xs text-slate-400 mt-0.5">Require fingerprint or face to open the app</p>
              </div>
              <Toggle checked={bioOn} onChange={() => setBioOn((v) => !v)} label="Biometric login" />
            </div>
          </div>

          {/* ── Data ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(6)}>
            <SectionHeader icon={Database} title="Data" desc="Keep your transaction history fresh" />
            <div className="px-4 py-3.5 border-t border-slate-700/60">
              <p className="text-sm font-medium text-slate-100">Sync all history</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">Re-fetch the last 90 days from all connected banks. Last synced today.</p>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-transform duration-150 ease-out"
              >
                <RotateCcw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync history (90 days)"}
              </button>
              {synced && <p className="mt-2 text-xs font-medium text-emerald-400">Synced — you&apos;re up to date</p>}
            </div>
          </div>

          {/* ── Account ── */}
          <div className="glass-card rounded-2xl overflow-hidden card-rise-in" style={rise(7)}>
            <SectionHeader icon={UserRound} title="Account" desc="kevin.maingi12@gmail.com" />
            <div className="px-4 py-3 border-t border-slate-700/60 space-y-3">
              <div>
                <label htmlFor="settingsb-name" className="text-xs text-slate-400 mb-1 block">
                  Full name <span className="opacity-70">— used to recognise transfers between your own accounts</span>
                </label>
                <input
                  id="settingsb-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="First Last"
                />
              </div>
              <div>
                <label htmlFor="settingsb-postcode" className="text-xs text-slate-400 mb-1 block">
                  Home postcode <span className="opacity-70">— used for local fuel prices</span>
                </label>
                <input
                  id="settingsb-postcode"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. B91 2AB"
                />
              </div>
            </div>
            <button type="button" className="min-h-[44px] w-full flex items-center gap-3 px-4 py-3.5 text-left text-slate-300 active:bg-slate-700/60 transition-colors duration-150 ease-out border-t border-slate-700/60">
              <LogOut size={16} />
              <span className="text-sm font-medium">Sign out</span>
            </button>
          </div>

          {/* ── Danger zone — recessed, quiet, well separated from everything else ── */}
          <div className="rounded-2xl border border-red-900/30 px-4 py-3.5 card-rise-in" style={rise(8)}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={13} className="text-red-500/80" />
              <p className="text-[11px] font-semibold text-red-500/80 uppercase tracking-wide">Danger zone</p>
            </div>
            <button type="button" className="min-h-[44px] text-xs font-medium text-red-500/90 active:opacity-70 transition-opacity duration-150 ease-out">
              Delete account &amp; all data…
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
