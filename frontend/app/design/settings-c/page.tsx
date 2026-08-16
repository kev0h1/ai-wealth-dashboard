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
  HelpCircle,
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

// ─────────────────────────────────────────────────────────────────────────
// /design/settings-c — "Variant C: Merged Settings"
// Static design preview only. Hardcoded mock state, no API calls, no auth
// context. Not linked from app nav — deep-link only. Safe to delete once the
// Settings redesign work is confirmed.
//
// Structural base: settings-a (self-contained scoped-CSS, SectionHeader/
// IconChip pattern, conditional-render collapsible — never animation-gated).
// Idea borrowed (not copied) from settings-b: a status hero doubling as an
// account hub, now built from real <button>s that jump to their section.
//
// Horizontal-overflow diagnosis (see report): could not reproduce actual
// clipping in headless Chromium at a 430px viewport for settings-a/b as
// currently deployed (document.scrollWidth === document.clientWidth === 430,
// both collapsed and with every collapsible force-opened — verified via
// puppeteer-core against the live /design/settings-a and /design/settings-b
// routes). The structural risk the brief describes is real even though it
// didn't reproduce here: several rows pair a fixed-width Toggle (48px track)
// directly against a text sibling with NO `min-w-0`/`flex-1` guard (e.g. the
// "Notify me about" rows, the Child Benefit row, the Security row). Flexbox's
// default `min-width: auto` means a flex item's shrink floor is its content's
// *min-content* width — normally saved here because body text wraps at word
// boundaries, but a font-metric difference (e.g. real San Francico on iOS vs.
// the Linux fallback used in this headless check), a longer bank/category
// name, or a locale-formatted number could push that floor past the
// available width and shove the Toggle off-canvas with no wrap fallback.
// This file defensively wraps EVERY row that pairs a Toggle with text in an
// explicit `flex-1 min-w-0` text wrapper plus a `flex-shrink-0` span around
// the Toggle, and adds `overflow-x-hidden` on the page shell as a backstop.
// ─────────────────────────────────────────────────────────────────────────

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

const INDIGO = "#4f46e5";
const EMERALD = "#10b981";
const AMBER = "#f59e0b";
const RED = "#ef4444";

// Section anchors the hero tiles jump to.
const SECTION_ACCOUNTS = "settings-c-accounts";
const SECTION_SECURITY = "settings-c-security";
const SECTION_DATA = "settings-c-data";

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

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
    <div className="px-4 py-3 border-b border-slate-700 flex items-start gap-2.5">
      <IconChip icon={icon} hex={hex} />
      <div className="min-w-0 pt-0.5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// A row pairing text with a fixed-width Toggle — always gets an explicit
// flex-1/min-w-0 text wrapper and a flex-shrink-0 guard on the Toggle. See
// the horizontal-overflow diagnosis at the top of this file.
function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  label,
  leading,
  border = true,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  leading?: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3.5${border ? " border-t border-slate-700/60" : ""}`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {leading}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{title}</p>
          {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
        </div>
      </div>
      <span className="flex-shrink-0">
        <Toggle checked={checked} onChange={onChange} label={label} />
      </span>
    </div>
  );
}

export default function SettingsCPreview() {
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

  // Where money can come from — default collapsed
  const [coverOpen, setCoverOpen] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Financial profile — bracket fixed at "100k_125k" so pension + Child
  // Benefit rows show, per the mock spec.
  const incomeBracket: "under_100k" | "100k_125k" | "125k_plus" = "100k_125k";
  const [incomeInput, setIncomeInput] = useState("107000");
  const [pensionInput, setPensionInput] = useState("24000");
  const [hasChildBenefit, setHasChildBenefit] = useState(false);

  // Security — supported, off
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

  return (
    <div className="dark">
      {/* Self-contained: no dependency on any file besides globals.css's
          already-global .glass-* tiers (already used by settings-a/b). No
          entrance/reveal animation gates content visibility (bug #1) — the
          only motion here is press feedback, chevron rotation and the
          Toggle's own internal transition, all under 250ms and respecting
          prefers-reduced-motion. */}
      <style>{`
        .settings-c-motion { transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
        @media (prefers-reduced-motion: reduce) {
          .settings-c-motion { transition-duration: 1ms !important; }
        }
      `}</style>
      <div
        className="min-h-dvh bg-[#0f172a] pb-24 overflow-x-hidden lg:max-w-6xl lg:mx-auto"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-4 pt-6 pb-2">
          <h1 className="text-xl font-bold text-slate-100">Settings</h1>
        </div>

        <div className="px-4 pt-4">
          {/* ── Account identity hero — doubles as the account hub ── */}
          <div className="glass-hero rounded-3xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <span
                className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-base font-bold"
                style={{ background: "rgba(79,70,229,0.18)", color: "#a5b4fc" }}
                aria-hidden="true"
              >
                KM
              </span>
              <div className="min-w-0">
                <p className="text-base font-bold text-slate-100 truncate">Kevin Maingi</p>
                <p className="text-xs text-slate-400 truncate">kevin.maingi12@gmail.com</p>
              </div>
            </div>

            <p className="text-sm font-medium text-slate-200 mb-4">
              You&apos;re all set — everything&apos;s connected and up to date.
            </p>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => jumpTo(SECTION_ACCOUNTS)}
                aria-label="13 accounts connected — jump to Where money can come from"
                className="settings-c-motion glass-tile rounded-2xl px-2.5 py-3 text-left min-h-[44px] active:scale-[0.98] transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Accounts</p>
                <p className="text-[13px] font-bold text-slate-100 mt-1 leading-tight">13 connected</p>
              </button>
              <button
                type="button"
                onClick={() => jumpTo(SECTION_SECURITY)}
                aria-label="Face ID off — jump to Security"
                className="settings-c-motion glass-tile rounded-2xl px-2.5 py-3 text-left min-h-[44px] active:scale-[0.98] transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Security</p>
                <p className="text-[13px] font-bold mt-1 leading-tight" style={{ color: AMBER }}>Face ID off</p>
              </button>
              <button
                type="button"
                onClick={() => jumpTo(SECTION_DATA)}
                aria-label="Last synced today — jump to Data"
                className="settings-c-motion glass-tile rounded-2xl px-2.5 py-3 text-left min-h-[44px] active:scale-[0.98] transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last sync</p>
                <p className="text-[13px] font-bold mt-1 leading-tight" style={{ color: EMERALD }}>Today</p>
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 space-y-3">
          {/* ── Display ── */}
          <div id="settings-c-display" className="glass-card rounded-2xl overflow-hidden">
            <SectionHeader icon={Moon} hex={INDIGO} title="Display" />
            <ToggleRow
              title="Dark Mode"
              desc="Easier on the eyes at night"
              checked={darkMode}
              onChange={() => setDarkMode((v) => !v)}
              label="Dark mode"
              border={false}
            />
          </div>

          {/* ── Notifications ── */}
          <div id="settings-c-notifications" className="glass-card rounded-2xl overflow-hidden">
            <SectionHeader icon={Bell} hex={INDIGO} title="Notifications" />
            <ToggleRow
              title="Push notifications"
              desc="Allow alerts on this device"
              checked={pushOn}
              onChange={() => setPushOn((v) => !v)}
              label="Push notifications"
              leading={<Bell size={16} className={`flex-shrink-0 ${pushOn ? "text-indigo-400" : "text-slate-500"}`} />}
              border={false}
            />

            <div className="border-t border-slate-700">
              <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Notify me about</p>
              </div>
              {NOTIFY_ROWS.map((row) => (
                <ToggleRow
                  key={row.key}
                  title={row.title}
                  desc={row.desc}
                  checked={!!notifPrefs[row.key]}
                  onChange={() => toggleNotifPref(row.key)}
                  label={row.title}
                  border
                />
              ))}
            </div>
          </div>

          {/* ── Where money can come from ── */}
          <div id={SECTION_ACCOUNTS} className="glass-card rounded-2xl overflow-hidden scroll-mt-4">
            <button
              type="button"
              aria-expanded={coverOpen}
              aria-controls="settings-c-cover-body"
              onClick={() => setCoverOpen((o) => !o)}
              className={`settings-c-motion w-full text-left flex items-center gap-3 px-4 py-3 min-h-[44px] active:opacity-70 transition-opacity duration-150 ease-out${
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
                className={`settings-c-motion text-slate-500 flex-shrink-0 transition-transform duration-200 ease-out${coverOpen ? " rotate-180" : ""}`}
              />
            </button>
            {coverOpen && (
              <div id="settings-c-cover-body">
                <p className="px-4 pt-3 text-[13px] text-slate-400 leading-snug">
                  By default Penny can move from any of your accounts. Turn one off and it will never be suggested.
                </p>
                <div className="mt-2 divide-y divide-slate-700/60">
                  {MOCK_ACCOUNTS.map((acc) => {
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
                          <span className="block text-sm font-medium text-slate-100 truncate">{acc.name}</span>
                          {(acc.manual || acc.provider) && (
                            <span className="block text-xs text-slate-500 truncate">
                              {acc.manual ? "Offline account" : acc.provider}
                            </span>
                          )}
                        </span>
                        <span className="flex-shrink-0">
                          <Toggle
                            checked={allowed}
                            onChange={() => toggleCoverAccount(acc.id)}
                            label={`Allow transfers from ${acc.name}`}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Financial profile ── */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <SectionHeader
              icon={Landmark}
              hex={INDIGO}
              title="Financial profile"
              subtitle="Self-declared — unlocks personalised tax insights"
            />

            <div className="px-4 py-3.5">
              <label htmlFor="settings-c-income" className="text-sm font-medium text-slate-100 block mb-1">
                Approximate income (£/yr)
              </label>
              <p className="text-xs text-slate-400 mb-2">
                Used to personalise your tax levers and calculations for your income band
              </p>
              <div className="relative w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                <input
                  id="settings-c-income"
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
                  <label htmlFor="settings-c-pension" className="text-sm font-medium text-slate-100 block mb-1">
                    Pension contributions this year (£/yr)
                  </label>
                  <p className="text-xs text-slate-400 mb-2">Used to calculate your adjusted net income</p>
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">£</span>
                    <input
                      id="settings-c-pension"
                      type="text"
                      inputMode="numeric"
                      value={fmtDigits(pensionInput)}
                      onChange={(e) => setPensionInput(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="0"
                      className="w-full pl-7 pr-3 py-2 rounded-xl border border-slate-600 bg-slate-700 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <ToggleRow
                  title="Receiving Child Benefit"
                  desc="High income charge applies over £60k"
                  checked={hasChildBenefit}
                  onChange={() => setHasChildBenefit((v) => !v)}
                  label="Receiving Child Benefit"
                  border
                />
              </>
            )}

            {incomeBracket && (
              <button
                type="button"
                className="settings-c-motion w-full flex items-center gap-3 justify-between px-4 py-3.5 min-h-[44px] border-t border-slate-700 text-indigo-400 active:opacity-70 active:bg-indigo-900/10 transition-transform duration-150 ease-out"
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
          <div id={SECTION_SECURITY} className="glass-card rounded-2xl overflow-hidden scroll-mt-4">
            <SectionHeader icon={ShieldCheck} hex={EMERALD} title="Security" />
            <ToggleRow
              title="Biometric unlock"
              desc="Require fingerprint or face to open the app"
              checked={bioOn}
              onChange={() => setBioOn((v) => !v)}
              label="Biometric login"
              border={false}
            />
          </div>

          {/* ── Data ── */}
          <div id={SECTION_DATA} className="glass-card rounded-2xl overflow-hidden scroll-mt-4">
            <SectionHeader icon={Database} hex={INDIGO} title="Data" />
            <div className="px-4 py-3.5">
              <p className="text-sm font-medium text-slate-100">Sync all history</p>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">
                Re-fetch the last 90 days from all connected banks. Last synced today.
              </p>
              <button
                type="button"
                onClick={handleSyncHistory}
                disabled={syncing}
                className="settings-c-motion min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-transform duration-150 ease-out"
              >
                <RotateCcw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync history (90 days)"}
              </button>
              {syncMsg && <p className="mt-2 text-xs font-medium text-emerald-400">{syncMsg}</p>}
            </div>
          </div>

          {/* ── Account ── */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 flex items-start gap-2.5">
              <IconChip icon={UserRound} hex={INDIGO} />
              <div className="min-w-0 pt-0.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
                <p className="text-xs text-slate-400 truncate">kevin.maingi12@gmail.com</p>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-slate-700 space-y-3">
              <div>
                <label htmlFor="settings-c-name" className="text-xs text-slate-400 mb-1 block">
                  Full name <span className="opacity-70">— used to recognise transfers between your own accounts</span>
                </label>
                <input
                  id="settings-c-name"
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="First Last"
                />
              </div>
              <div>
                <label htmlFor="settings-c-postcode" className="text-xs text-slate-400 mb-1 block">
                  Home postcode <span className="opacity-70">— used for local fuel prices</span>
                </label>
                <input
                  id="settings-c-postcode"
                  className="w-full text-sm bg-slate-700 text-slate-100 rounded-xl px-3 py-2 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="e.g. B91 2AB"
                />
              </div>
            </div>

            <button
              type="button"
              className="settings-c-motion min-h-[44px] w-full flex items-center gap-3 px-4 py-3.5 text-left text-slate-300 hover:bg-slate-700/60 active:opacity-70 transition-transform duration-150 ease-out"
            >
              <LogOut size={16} />
              <span className="text-sm font-medium">Sign out</span>
            </button>
          </div>

          {/* ── Help (new — replaces the "?" tutorial trigger relocated off Home) ── */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <SectionHeader icon={HelpCircle} hex={INDIGO} title="Help" />
            <button
              type="button"
              className="settings-c-motion min-h-[44px] w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-70 transition-transform duration-150 ease-out"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-100">How Sorted works</span>
                <span className="block text-xs text-slate-400 mt-0.5">A quick tour of Penny and the loop</span>
              </span>
              <ChevronRight size={16} className="flex-shrink-0 text-slate-500" />
            </button>
          </div>

          {/* ── Danger zone — recessed, quiet, well separated from everything else ── */}
          <div className="rounded-2xl border border-red-900/30 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <IconChip icon={AlertTriangle} hex={RED} />
              <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wide">Danger zone</p>
            </div>
            <button
              type="button"
              onClick={() => setDangerConfirming((v) => !v)}
              className="settings-c-motion min-h-[44px] text-xs font-medium text-red-400 -ml-1 px-1 rounded-lg active:opacity-70 transition-transform duration-150 ease-out"
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
  );
}
