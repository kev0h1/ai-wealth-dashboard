"use client";

// TEMPORARY PREVIEW — delete after review.
// Variant B — "Reading + rows" — of the redesigned Spend → Categories view.
// The normal majority (categories running close to usual) always renders as
// compact always-visible rows in one flat list, never collapsed away. The
// only difference from Variant A is that normal-majority treatment; every
// other section (header, period card, summary pills, the reading, notable
// cards, the ask card, money-you-moved) is identical spec between the two.
// Deep-linkable: /design/spend-b?mode=light|dark&state=normal|nothing|everything|nobaseline|early
// Static mockup: no live data, no network calls, most controls are inert.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Receipt,
  Bus,
  HeartPulse,
  ShoppingCart,
  Repeat,
  Plane,
  Coins,
  Flag,
  Laptop,
  HandHeart,
  Utensils,
  Film,
  Fuel,
  ReceiptText,
  Info,
  PiggyBank,
  CreditCard,
  TrendingUp,
  Search,
  X,
} from "lucide-react";

type Mode = "light" | "dark";
type StateKey = "normal" | "nothing" | "everything" | "nobaseline" | "early";

const STATES: StateKey[] = ["normal", "nothing", "everything", "nobaseline", "early"];

const STATE_LABEL: Record<StateKey, string> = {
  normal: "Normal",
  nothing: "Nothing",
  everything: "Everything",
  nobaseline: "No baseline",
  early: "Early",
};

const READING: Record<StateKey, string> = {
  normal:
    "Three categories are running above your usual pace — mostly Bills. Everything else looks normal.",
  nothing: "Nothing unusual to report — all 9 categories are running close to usual.",
  everything:
    "Spending is running high across the board — about £680 more than a typical 12 days in. The biggest three:",
  nobaseline:
    "Still learning your usual — I need about two full pay periods before I can compare. Here's where this period's money went so far.",
  early: "3 days in — too soon to compare against usual.",
};

// − U+2212 before £, per copy rules (never ASCII hyphen-minus for money).
const MINUS = "−";
const fmt = (n: number) => `£${n.toLocaleString("en-GB")}`;
const fmtNeg = (n: number) => `${MINUS}£${Math.abs(n).toLocaleString("en-GB")}`;

interface NotableCard {
  key: string;
  name: string;
  colour: string;
  Icon: LucideIcon;
  multiplePill: string;
  total: number;
  verdict: string;
  cause: string;
  paymentsLabel: string;
  paceFillPct: number;
  paceTickPct: number;
  footerHint?: { label: string; Icon: LucideIcon };
}

const NOTABLES: NotableCard[] = [
  {
    key: "bills",
    name: "Bills",
    colour: "#fb7185",
    Icon: Receipt,
    multiplePill: "2× usual",
    total: 2028,
    verdict: "about twice your usual pace for day 13.",
    cause: "Biggest: British Gas £340 · EDF £180 · Council Tax £167.",
    paymentsLabel: "See the 14 payments →",
    paceFillPct: 92,
    paceTickPct: 50,
  },
  {
    key: "transport",
    name: "Transport",
    colour: "#60a5fa",
    Icon: Bus,
    multiplePill: "1.4× usual",
    total: 449,
    verdict: "running about £129 ahead of usual for day 13.",
    cause: "Mostly fuel — 3 stops this week.",
    paymentsLabel: "See the 22 payments →",
    paceFillPct: 82,
    paceTickPct: 71,
    footerHint: { label: "cheaper fuel inside", Icon: Fuel },
  },
  {
    key: "health",
    name: "Health",
    colour: "#2dd4bf",
    Icon: HeartPulse,
    multiplePill: "2× usual",
    total: 228,
    verdict: "about twice usual — mostly one payment.",
    cause: "David Lloyd £117 on 2 Aug.",
    paymentsLabel: "See the 7 payments →",
    paceFillPct: 90,
    paceTickPct: 50,
  },
];

interface MajorityRow {
  key: string;
  name: string;
  colour: string;
  Icon: LucideIcon;
  total: number;
  count: number;
  amberTag?: string;
  hint?: { label: string; Icon: LucideIcon };
}

// The 9 categories that make up the always-normal majority.
const MAJORITY_BASE: MajorityRow[] = [
  {
    key: "groceries",
    name: "Groceries",
    colour: "#34d399",
    Icon: ShoppingCart,
    total: 421,
    count: 4,
    hint: { label: "scan receipts inside", Icon: ReceiptText },
  },
  {
    key: "subscriptions",
    name: "Subscriptions",
    colour: "#22d3ee",
    Icon: Repeat,
    total: 122,
    count: 9,
    amberTag: "4.2× usual — small amounts",
  },
  { key: "travel", name: "Travel", colour: "#818cf8", Icon: Plane, total: 118, count: 4 },
  { key: "cash", name: "Cash", colour: "#facc15", Icon: Coins, total: 115, count: 2 },
  { key: "golf", name: "Golf", colour: "#94a3b8", Icon: Flag, total: 36, count: 2 },
  { key: "software", name: "Software", colour: "#a3e635", Icon: Laptop, total: 22, count: 1 },
  { key: "charity", name: "Charity", colour: "#f9a8d4", Icon: HandHeart, total: 5, count: 1 },
  { key: "eating-out", name: "Eating Out", colour: "#fb923c", Icon: Utensils, total: 0, count: 0 },
  { key: "entertainment", name: "Entertainment", colour: "#c084fc", Icon: Film, total: 0, count: 0 },
];

// Bills/Transport/Health rendered as plain majority rows when they are not
// promoted to notable cards (nothing / nobaseline / early states).
const DEMOTED_ROWS: MajorityRow[] = [
  { key: "bills", name: "Bills", colour: "#fb7185", Icon: Receipt, total: 2028, count: 14 },
  {
    key: "transport",
    name: "Transport",
    colour: "#60a5fa",
    Icon: Bus,
    total: 449,
    count: 22,
    hint: { label: "cheaper fuel inside", Icon: Fuel },
  },
  { key: "health", name: "Health", colour: "#2dd4bf", Icon: HeartPulse, total: 228, count: 7 },
];

function AskCard({ onTeachMove, onTeachSpend }: { onTeachMove: () => void; onTeachSpend: () => void }) {
  return (
    <div className="glass-tile rounded-2xl p-4">
      <p className="text-sm text-slate-800 dark:text-slate-100 leading-snug">
        One payment I can&apos;t place yet — <span className="font-bold">£1,020</span> to WISE on 4 Aug.
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
        It sits in Other until I know more.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={onTeachMove}
          className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
        >
          Tell me what this was
        </button>
        <button
          type="button"
          className="text-[13px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Leave it for now
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        Opens the teaching sheet ↑ (preview)
      </p>
      <button
        type="button"
        onClick={onTeachSpend}
        className="mt-1 block text-[11px] font-medium text-indigo-500/80 dark:text-indigo-400/80 active:opacity-70 transition-opacity"
      >
        see a spending correction ↗ (preview)
      </button>
    </div>
  );
}

function PaceBar({ fillPct, tickPct }: { fillPct: number; tickPct: number }) {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
      <div className="h-full rounded-full bg-amber-500" style={{ width: `${fillPct}%` }} />
      <div
        className="absolute top-0 bottom-0 w-px bg-slate-400 dark:bg-slate-300"
        style={{ left: `${tickPct}%` }}
        title="usual"
      />
    </div>
  );
}

function NotableCardView({ card }: { card: NotableCard }) {
  const { Icon, colour } = card;
  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${colour}26` }}
        >
          <Icon size={16} style={{ color: colour }} />
        </span>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">
          {card.name}
        </p>
        <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {card.multiplePill}
        </span>
      </div>

      <p className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-100">{fmt(card.total)}</p>
      <p className="mt-0.5 text-[13px] text-slate-700 dark:text-slate-300">{card.verdict}</p>
      <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{card.cause}</p>

      <button
        type="button"
        className="mt-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400"
      >
        {card.paymentsLabel}
      </button>

      <div className="mt-3">
        <PaceBar fillPct={card.paceFillPct} tickPct={card.paceTickPct} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="flex-1 min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform"
        >
          One-off
        </button>
        <button
          type="button"
          className="flex-1 min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform"
        >
          New normal
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="text-[11px] font-medium text-slate-400 dark:text-slate-500 active:opacity-70 transition-opacity"
        >
          Set an aim
        </button>
      </div>

      {card.footerHint && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
            <card.footerHint.Icon size={10} style={{ color: card.colour }} />
            <span>{card.footerHint.label}</span>
            <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
          </span>
        </div>
      )}
    </div>
  );
}

function MajorityRowView({ row, quiet }: { row: MajorityRow; quiet: boolean }) {
  const { Icon, colour } = row;
  return (
    <button
      type="button"
      className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
    >
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${colour}26` }}
      >
        <Icon size={13} style={{ color: colour }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.name}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center flex-wrap gap-x-1">
          <span>
            {row.count} payment{row.count === 1 ? "" : "s"}
          </span>
          {!quiet && row.amberTag && (
            <span className="text-amber-700 dark:text-amber-300 font-semibold">· {row.amberTag}</span>
          )}
          {row.hint && (
            <span className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300">
              <row.hint.Icon size={9} style={{ color: row.colour }} />
              <span>{row.hint.label}</span>
            </span>
          )}
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">
        {fmt(row.total)}
      </span>
    </button>
  );
}

// Money that moved resolves to a DESTINATION, never a category — spending
// gets vocabulary, movement gets destinations (ENGINE.md doctrine).
function MoneyYouMoved() {
  const [open, setOpen] = useState(false);
  const rows: { name: string; amount: string; sub: string; Icon: LucideIcon }[] = [
    { name: "To your pots", amount: "£2,724", sub: "Japan · Rainy Day Saver · 49 payments", Icon: PiggyBank },
    { name: "To your credit cards", amount: "£834", sub: "2 payments", Icon: CreditCard },
    { name: "To your investments", amount: "£400", sub: "1 payment", Icon: TrendingUp },
  ];
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl"
      >
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          Money you moved · £3,958 — not counted in spending
        </p>
        {open ? (
          <ChevronUp size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />
        ) : (
          <ChevronDown size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />
        )}
      </button>
      {open && (
        <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
          {rows.map((r) => {
            const Icon = r.Icon;
            return (
              <div key={r.name} className="flex items-center gap-2.5 px-4 py-2.5 min-h-[44px]">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700/60">
                  <Icon size={13} className="text-slate-400 dark:text-slate-500" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {r.name}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{r.sub}</p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0">
                  {r.amount}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SpendBClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: StateKey = STATES.includes(params.get("state") as StateKey)
    ? (params.get("state") as StateKey)
    : "normal";

  // The correction/teaching sheet — mocks the engine-teaching surface opened
  // from the ask card. Two deep-linkable demo modes: `?sheet=move` (default,
  // opened from "Tell me what this was" — the WISE transfer) and
  // `?sheet=spend` (opened from the quiet "see a spending correction" link —
  // the Playtomic miscategorisation). Doctrine: spending gets vocabulary,
  // movement gets destinations — the two modes are deliberately different UIs.
  const sheetParam = params.get("sheet");
  const [teachOpen, setTeachOpen] = useState(sheetParam === "move" || sheetParam === "spend");
  const [sheetMode, setSheetMode] = useState<"move" | "spend">(sheetParam === "spend" ? "spend" : "move");

  // Body scroll lock while the sheet is open (Bottom Sheets: "Body scroll
  // locks while open" — DESIGN.md §5).
  useEffect(() => {
    if (!teachOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [teachOpen]);

  useEffect(() => {
    // The page canvas lives outside this tree; PreferencesContext also writes
    // this class on mount, so apply after its effect has run.
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const showNotables = state === "normal" || state === "everything";
  const showAsk = state === "normal" || state === "everything" || state === "early";
  // Plain rendering suppresses amber tags / multiples anywhere in the
  // majority list — used whenever the reading itself asserts nothing (or
  // nothing comparable) is unusual.
  const quietRows = state === "nothing" || state === "nobaseline" || state === "early";

  const majorityRows: MajorityRow[] = showNotables
    ? MAJORITY_BASE
    : [...MAJORITY_BASE, ...DEMOTED_ROWS].sort((a, b) => b.total - a.total);

  const majorityHeader = (() => {
    const sum = majorityRows.reduce((s, r) => s + r.total, 0);
    return `LOOKING NORMAL · £${sum.toLocaleString("en-GB")} ACROSS ${majorityRows.length} CATEGORIES`;
  })();

  const hrefFor = (s: StateKey) => `?mode=${mode}&state=${s}`;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                Where your money goes
              </p>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Spending</h1>
            </div>
            <div
              aria-hidden
              className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
            >
              <Search size={20} className="text-slate-500 dark:text-slate-400" />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
            Search opens every payment, everywhere — the period below scopes this page only. (preview)
          </p>

          {/* Period card */}
          <div className="mt-4 glass-card rounded-2xl p-3">
            <div className="flex items-center justify-between">
              <span className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 opacity-30">
                <ChevronLeft size={16} color="#64748b" />
              </span>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  31 Jul → 27 Aug
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Current period</p>
              </div>
              <span className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 opacity-30">
                <ChevronRight size={16} color="#64748b" />
              </span>
            </div>
          </div>

          {/* Summary pills */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Spent</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmt(4564)}</span>
            </div>
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Income</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmt(253)}</span>
            </div>
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Net</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtNeg(4311)}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">so far</span>
            </div>
          </div>

          {/* Quiet Patterns toggle — replaces the old three-tab segmented
              control. Categories is no longer a named view (the reading page
              IS the page) and Transactions moved to the global search hub
              above; only the Trends split survives, as minor chrome. */}
          <div aria-hidden className="mt-3 flex items-center gap-1.5">
            <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm">
              This period
            </span>
            <span className="px-3 py-1 rounded-full text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Patterns
            </span>
          </div>

          {/* The reading — no card chrome */}
          <p className="mt-4 px-1 text-base font-bold leading-snug text-slate-900 dark:text-slate-100">
            {READING[state]}
          </p>

          {/* Notable cards */}
          {showNotables && (
            <div className="mt-3 flex flex-col gap-3">
              {NOTABLES.map((card) => (
                <NotableCardView key={card.key} card={card} />
              ))}
            </div>
          )}

          {/* The ask card */}
          {showAsk && (
            <div className="mt-3">
              <AskCard
                onTeachMove={() => {
                  setSheetMode("move");
                  setTeachOpen(true);
                }}
                onTeachSpend={() => {
                  setSheetMode("spend");
                  setTeachOpen(true);
                }}
              />
            </div>
          )}

          {/* Normal majority — always-visible compact rows */}
          <div className="mt-5">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {majorityHeader}
            </p>
            <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
              {majorityRows.map((row) => (
                <MajorityRowView key={row.key} row={row} quiet={quietRows} />
              ))}
            </div>
          </div>

          {/* Money you moved */}
          <div className="mt-3">
            <MoneyYouMoved />
          </div>

          {/* Footer */}
          <button
            type="button"
            className="mt-4 flex items-center gap-1.5 mx-auto text-slate-400 dark:text-slate-500 text-[11px] font-medium"
          >
            <Info size={11} />
            <span>How we categorise your money</span>
          </button>

          <div className="mt-3 flex items-center justify-center gap-3 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            <a href={`?mode=light&state=${state}`}>Light</a>
            <a href={`?mode=dark&state=${state}`}>Dark</a>
          </div>
        </div>

        {/* Fixed state-hopper footer */}
        <div
          className="fixed bottom-0 left-0 right-0 glass-sheet border-t border-slate-100 dark:border-slate-700 px-3 py-2"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto">
            {STATES.map((s) => (
              <a
                key={s}
                href={hrefFor(s)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  s === state
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {STATE_LABEL[s]}
              </a>
            ))}
          </div>
        </div>

        {/* The correction/teaching sheet — mocks the surface opened from the
            ask card's "Tell me what this was". Static content, no real
            logic. Dark-first, no amber (nothing here is anomalous), no
            Penny gradient (this is the engine teaching, not Penny
            advising). Identical to Variant A's sheet by design — duplicated
            intentionally, this preview route stays zero-dependency. */}
        {teachOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 fade-in"
              onClick={() => setTeachOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Tell us what this was"
              className="fixed inset-x-0 bottom-0 z-50"
              style={{ animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
            >
              <div
                className="mx-auto w-full max-w-[430px] glass-sheet rounded-t-3xl overflow-y-auto"
                style={{ maxHeight: "88dvh" }}
              >
                {/* Grabber */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-600" />
                </div>

                <button
                  type="button"
                  onClick={() => setTeachOpen(false)}
                  aria-label="Close"
                  className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:scale-95 transition-transform"
                >
                  <X size={18} />
                </button>

                <div className="px-5 pb-6 pt-1">
                  {/* 1. Header — shared shape, mode-dependent copy */}
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    {sheetMode === "move" ? "WISE *8827 TRANSFER" : "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC"}
                  </p>
                  <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                    {sheetMode === "move" ? "−£1,020.00" : "−£48.00"}
                  </p>
                  <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                    {sheetMode === "move" ? "4 Aug · Barclays" : "12 Jul · Barclays"}
                  </p>

                  {sheetMode === "move" ? (
                    <>
                      {/* 2. Movement framing — never a category */}
                      <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                        This looks like money you moved — it left Barclays for an account I
                        can&apos;t see.
                      </p>
                      <p className="mt-4 text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                        Is this account yours?
                      </p>

                      {/* 3. Three option cards */}
                      <div className="mt-3 space-y-2">
                        <div>
                          <button
                            type="button"
                            className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                          >
                            <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                              Yes — it funds a goal
                            </span>
                          </button>
                          <div className="mt-2 flex flex-wrap gap-2 pl-1">
                            <span className="min-h-[44px] px-3 flex items-center gap-1.5 rounded-full text-[13px] font-semibold bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-400/40">
                              House Fund
                              <span className="text-[10px] font-bold uppercase tracking-wide bg-white/20 rounded-full px-1.5 py-0.5">
                                New
                              </span>
                            </span>
                            {["Japan", "Rainy Day Saver"].map((g) => (
                              <span
                                key={g}
                                className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                              >
                                {g}
                              </span>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                        >
                          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                            Yes — just an account of mine elsewhere
                          </span>
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            tracked as an offline pot
                          </span>
                        </button>

                        <button
                          type="button"
                          className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                        >
                          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                            No — this was spending
                          </span>
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            opens the category picker
                          </span>
                        </button>
                      </div>

                      {/* 4. The engine's propagation offer */}
                      <div className="mt-4 glass-tile rounded-2xl p-4">
                        <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          Always treat WISE transfers as money to your{" "}
                          <span className="text-indigo-600 dark:text-indigo-400">House Fund</span>?
                        </p>
                        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                          Matches 3 past payments · will catch future ones
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform"
                          >
                            Always
                          </button>
                          <button
                            type="button"
                            className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[13px] font-semibold active:scale-95 transition-transform"
                          >
                            Just this once
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                          Won&apos;t count towards your spending. You can undo this any time.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 2. Spend framing — this one gets vocabulary */}
                      <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                        The engine files this as Shopping — correct it and it learns.
                      </p>

                      {/* 3. Category picker — own categories, then common ones,
                          then "Something else…" */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="min-h-[44px] px-3 flex items-center gap-1.5 rounded-full text-[13px] font-semibold bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-400/40">
                          Padel
                          <span className="text-[10px] font-bold uppercase tracking-wide bg-white/20 rounded-full px-1.5 py-0.5">
                            New
                          </span>
                        </span>
                        {["Golf", "Eating Out", "Entertainment", "Shopping"].map((c) => (
                          <span
                            key={c}
                            className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            {c}
                          </span>
                        ))}
                        <span className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400">
                          Something else…
                        </span>
                      </div>

                      {/* 4. Born-in-context — the category is created inline */}
                      <div className="mt-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-100 dark:ring-indigo-500/20 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-300">
                          New category
                        </p>
                        <div className="mt-1.5 h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 flex items-center">
                          <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                            Padel
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-start justify-between gap-3">
                          <p className="text-[13px] leading-snug text-slate-600 dark:text-slate-300">
                            Counted as →{" "}
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              Everyday spending
                            </span>{" "}
                            <span className="text-slate-400 dark:text-slate-500">·</span>{" "}
                            <span className="italic text-slate-500 dark:text-slate-400">
                              money you choose to spend
                            </span>
                          </p>
                          <button
                            type="button"
                            className="flex-shrink-0 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                          >
                            change
                          </button>
                        </div>
                      </div>

                      {/* 5. The engine's propagation offer */}
                      <div className="mt-4 glass-tile rounded-2xl p-4">
                        <p className="text-[14px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          Always file PLAYTOMIC as{" "}
                          <span className="text-indigo-600 dark:text-indigo-400">Padel</span>?
                        </p>
                        <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                          Matches 5 past payments · will catch future ones
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            className="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform"
                          >
                            Always
                          </button>
                          <button
                            type="button"
                            className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[13px] font-semibold active:scale-95 transition-transform"
                          >
                            Just this one
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                          You can undo this any time.
                        </p>
                      </div>
                    </>
                  )}

                  {/* 6. Footer whisper — unchanged, both modes */}
                  <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
                    The engine learns from every correction — you shouldn&apos;t have to do this twice.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
