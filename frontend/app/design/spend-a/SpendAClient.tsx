"use client";

// TEMPORARY PREVIEW — delete after review.
// Variant A ("Dossier") of the redesigned Spend → Categories view. Static
// mockup with hardcoded figures — no live data, no API calls, no shared
// lib/component imports (deliberately self-contained per the build brief).
// Deep-linkable: /design/spend-a?mode=light|dark&state=normal|nothing|everything|nobaseline|early

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
  PiggyBank,
  CreditCard,
  TrendingUp,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

type Mode = "light" | "dark";
type PageState = "normal" | "nothing" | "everything" | "nobaseline" | "early";

const STATES: PageState[] = ["normal", "nothing", "everything", "nobaseline", "early"];
const STATE_LABEL: Record<PageState, string> = {
  normal: "Normal",
  nothing: "Nothing",
  everything: "Everything",
  nobaseline: "No baseline",
  early: "Early",
};

// Local copy of the category colour/icon tokens (frontend/lib/categories.ts,
// frontend/lib/categoryIcons.ts) — duplicated intentionally so this preview
// route has zero lib/component dependencies. Values verified against
// DESIGN.md's frontmatter cat-* tokens.
const CAT_COLOUR: Record<string, string> = {
  Bills: "#fb7185",
  Transport: "#60a5fa",
  Health: "#2dd4bf",
  Groceries: "#34d399",
  Subscriptions: "#22d3ee",
  Travel: "#818cf8",
  Cash: "#facc15",
  Golf: "#6366f1", // custom category → DEFAULT_CUSTOM_COLOUR
  Software: "#a3e635",
  Charity: "#f9a8d4",
  "Eating Out": "#fb923c",
  Entertainment: "#c084fc",
  Savings: "#fbbf24",
  Debt: "#f87171",
  Investment: "#38bdf8",
};

const CAT_ICON: Record<string, LucideIcon> = {
  Bills: Receipt,
  Transport: Bus,
  Health: HeartPulse,
  Groceries: ShoppingCart,
  Subscriptions: Repeat,
  Travel: Plane,
  Cash: Coins,
  Golf: Flag,
  Software: Laptop,
  Charity: HandHeart,
  "Eating Out": Utensils,
  Entertainment: Film,
  Savings: PiggyBank,
  Debt: CreditCard,
  Investment: TrendingUp,
};

function fmt(n: number): string {
  return `£${n.toLocaleString("en-GB")}`;
}

const READING: Record<PageState, string> = {
  normal:
    "Three categories are running above your usual pace — mostly Bills. Everything else looks normal.",
  nothing: "Nothing unusual to report — all 9 categories are running close to usual.",
  everything:
    "Spending is running high across the board — about £680 more than a typical 12 days in. The biggest three:",
  nobaseline:
    "Still learning your usual — I need about two full pay periods before I can compare. Here's where this period's money went so far.",
  early: "3 days in — too soon to compare against usual.",
};

interface NotableCard {
  category: string;
  multiple: string;
  big: string;
  verdict: string;
  cause: string;
  evidence: string;
  tickPct: number;
}

const NOTABLE_CARDS: NotableCard[] = [
  {
    category: "Bills",
    multiple: "2× usual",
    big: "£2,028",
    verdict: "about twice your usual pace for day 13.",
    cause: "Biggest: British Gas £340 · EDF £180 · Council Tax £167.",
    evidence: "See the 14 payments →",
    tickPct: 50,
  },
  {
    category: "Transport",
    multiple: "1.4× usual",
    big: "£449",
    verdict: "running about £129 ahead of usual for day 13.",
    cause: "Mostly fuel — 3 stops this week.",
    evidence: "See the 22 payments →",
    tickPct: 71,
  },
  {
    category: "Health",
    multiple: "2× usual",
    big: "£228",
    verdict: "about twice usual — mostly one payment.",
    cause: "David Lloyd £117 on 2 Aug.",
    evidence: "See the 7 payments →",
    tickPct: 50,
  },
];

interface DossierRow {
  category: string;
  amount: number;
  payments: number;
}

// Sorted £ desc, as the collapsed chip row and the expanded rows both need.
const DOSSIER_ROWS: DossierRow[] = [
  { category: "Groceries", amount: 421, payments: 18 },
  { category: "Subscriptions", amount: 122, payments: 6 },
  { category: "Travel", amount: 118, payments: 4 },
  { category: "Cash", amount: 115, payments: 5 },
  { category: "Golf", amount: 36, payments: 3 },
  { category: "Software", amount: 22, payments: 2 },
  { category: "Charity", amount: 5, payments: 1 },
  { category: "Eating Out", amount: 0, payments: 0 },
  { category: "Entertainment", amount: 0, payments: 0 },
];

// Money that moved resolves to a DESTINATION, never a category — spending
// gets vocabulary, movement gets destinations (ENGINE.md doctrine).
interface MovedRow {
  label: string;
  amount: string;
  sub: string;
  Icon: LucideIcon;
}

const MONEY_MOVED_ROWS: MovedRow[] = [
  { label: "To your pots", amount: "£2,724", sub: "Japan · Rainy Day Saver · 49 payments", Icon: PiggyBank },
  { label: "To your credit cards", amount: "£834", sub: "2 payments", Icon: CreditCard },
  { label: "To your investments", amount: "£400", sub: "1 payment", Icon: TrendingUp },
];

function CategoryChip({ category, size = 36, iconSize = 16 }: { category: string; size?: number; iconSize?: number }) {
  const colour = CAT_COLOUR[category] ?? "#94a3b8";
  const Icon = CAT_ICON[category] ?? Receipt;
  return (
    <div
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: `${colour}26` }}
    >
      <Icon size={iconSize} style={{ color: colour }} />
    </div>
  );
}

function PaceBar({ tickPct }: { tickPct: number }) {
  return (
    <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-700">
      <div className="h-1.5 rounded-full bg-amber-400 dark:bg-amber-500" style={{ width: "100%" }} />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-slate-400 dark:bg-slate-500"
        style={{ left: `${tickPct}%` }}
      />
    </div>
  );
}

function NotableCardView({ card }: { card: NotableCard }) {
  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <CategoryChip category={card.category} />
        <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
          {card.category}
        </span>
        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          {card.multiple}
        </span>
      </div>
      <p className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-100">{card.big}</p>
      <p className="mt-1 text-[13px] text-slate-700 dark:text-slate-300">{card.verdict}</p>
      <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{card.cause}</p>
      <button type="button" className="mt-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">
        {card.evidence}
      </button>
      <div className="mt-3">
        <PaceBar tickPct={card.tickPct} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[13px] font-semibold active:scale-95 transition-transform"
        >
          One-off
        </button>
        <button
          type="button"
          className="flex-1 h-11 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[13px] font-semibold active:scale-95 transition-transform"
        >
          New normal
        </button>
      </div>
      <div className="mt-2 text-right">
        <button
          type="button"
          className="text-[12px] font-medium text-slate-400 dark:text-slate-500 active:opacity-70 transition-opacity"
        >
          Set an aim
        </button>
      </div>
    </div>
  );
}

export default function SpendAClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const rawState = searchParams.get("state");
  const state: PageState = (STATES as string[]).includes(rawState ?? "")
    ? (rawState as PageState)
    : "normal";

  const [dossierExpanded, setDossierExpanded] = useState(false);
  const [movedExpanded, setMovedExpanded] = useState(false);
  // The correction/teaching sheet — mocks the engine-teaching surface opened
  // from the ask card. Two deep-linkable demo modes: `?sheet=move` (default,
  // opened from "Tell me what this was" — the WISE transfer) and
  // `?sheet=spend` (opened from the quiet "see a spending correction" link —
  // the Playtomic miscategorisation). Doctrine: spending gets vocabulary,
  // movement gets destinations — the two modes are deliberately different UIs.
  const sheetParam = searchParams.get("sheet");
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

  // Expanded-by-default only pre-baseline, where there is nothing to collapse
  // behind ("show the compact rows expanded by default with plain totals").
  useEffect(() => {
    setDossierExpanded(state === "nobaseline" || state === "early");
  }, [state]);

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

  const showNotable = state === "normal" || state === "everything";
  const showAsk = state === "normal" || state === "everything" || state === "early";
  const dossierPlain = state === "nobaseline" || state === "early";

  function rowTag(row: DossierRow): { text: string; amber: boolean } | null {
    if (dossierPlain) return null;
    if (state === "everything") return { text: "above usual", amber: false };
    if (state === "normal" && row.category === "Subscriptions") {
      return { text: "4.2× usual — small amounts", amber: true };
    }
    return null;
  }

  const dossierTotal = DOSSIER_ROWS.reduce((sum, row) => sum + row.amount, 0);
  const dossierHeader = dossierPlain
    ? `This period so far · ${fmt(dossierTotal)} across ${DOSSIER_ROWS.length} categories`
    : `Looking normal · ${fmt(dossierTotal)} across ${DOSSIER_ROWS.length} categories`;

  function linkFor(s: PageState) {
    return `?mode=${mode}&state=${s}`;
  }

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-28">
          {/* Preview badge — parity with other /design routes */}
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview · Variant A "Dossier" · {mode} · {state}
          </p>

          {/* 1. Header */}
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

          {/* 2. Period card */}
          <div className="glass-card rounded-2xl p-3 mt-4">
            <div className="flex items-center justify-between">
              <div
                aria-hidden
                className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 opacity-40"
              >
                <ChevronLeft size={16} color="#64748b" />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                31 Jul → 27 Aug{" "}
                <span className="font-normal text-slate-500 dark:text-slate-400">· Current period</span>
              </p>
              <div
                aria-hidden
                className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 opacity-40"
              >
                <ChevronRight size={16} color="#64748b" />
              </div>
            </div>
          </div>

          {/* 3. Three pills */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Spent</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">£4,564</span>
            </div>
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Income</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">£253</span>
            </div>
            <div className="glass-tile rounded-xl px-3 py-2.5 flex flex-col items-center">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Net</span>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">−£4,311</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">so far</span>
            </div>
          </div>

          {/* 4. Quiet Patterns toggle — replaces the old three-tab segmented
              control. Categories is no longer a named view (the reading page
              IS the page) and Transactions moved to the global search hub
              above; only the Trends split survives, as minor chrome. */}
          <div aria-hidden className="flex items-center gap-1.5 mt-3">
            <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm">
              This period
            </span>
            <span className="px-3 py-1 rounded-full text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Patterns
            </span>
          </div>

          {/* 5. THE READING */}
          <p className="mt-4 text-base font-bold text-slate-900 dark:text-slate-100">
            {READING[state]}
          </p>

          {/* 6. Notable cards */}
          {showNotable && (
            <div className="mt-3 space-y-3">
              {NOTABLE_CARDS.map((card) => (
                <NotableCardView key={card.category} card={card} />
              ))}
            </div>
          )}

          {/* 7. The ask card */}
          {showAsk && (
            <div className="glass-tile rounded-2xl p-4 mt-3">
              <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                One payment I can&apos;t place yet — <span className="font-bold">£1,020</span> to WISE on 4 Aug.
              </p>
              <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
                It sits in Other until I know more.
              </p>
              <div className="mt-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setSheetMode("move");
                    setTeachOpen(true);
                  }}
                  className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                >
                  Tell me what this was
                </button>
                <button type="button" className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
                  Leave it for now
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                Opens the teaching sheet ↑ (preview)
              </p>
              <button
                type="button"
                onClick={() => {
                  setSheetMode("spend");
                  setTeachOpen(true);
                }}
                className="mt-1 block text-[11px] font-medium text-indigo-500/80 dark:text-indigo-400/80 active:opacity-70 transition-opacity"
              >
                see a spending correction ↗ (preview)
              </button>
            </div>
          )}

          {/* 8. Normal majority — the collapsed dossier line */}
          <div className="glass-card-flat rounded-2xl overflow-hidden mt-3">
            <button
              type="button"
              onClick={() => setDossierExpanded((v) => !v)}
              className="w-full p-4 text-left flex items-center justify-between gap-2 active:opacity-70 transition-opacity"
            >
              <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                {dossierHeader}
              </span>
              <ChevronDown
                size={16}
                className={`flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${
                  dossierExpanded ? "rotate-180" : ""
                }`}
              />
            </button>

            {!dossierExpanded && (
              <div className="px-4 pb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                {DOSSIER_ROWS.map((row, i) => (
                  <span
                    key={row.category}
                    className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CAT_COLOUR[row.category] ?? "#94a3b8" }}
                    />
                    {row.category} {fmt(row.amount)}
                    {i < DOSSIER_ROWS.length - 1 && (
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div
              className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
              style={{ gridTemplateRows: dossierExpanded ? "1fr" : "0fr", opacity: dossierExpanded ? 1 : 0 }}
            >
              <div className="overflow-hidden">
                <div className="px-2 pb-2">
                  {DOSSIER_ROWS.map((row) => {
                    const tag = rowTag(row);
                    return (
                      <div key={row.category} className="flex items-center gap-2.5 h-11 px-2">
                        <CategoryChip category={row.category} size={28} iconSize={14} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                            {row.category}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.payments} payment{row.payments !== 1 ? "s" : ""}
                            {tag && (
                              <span
                                className={
                                  tag.amber
                                    ? "ml-1 text-amber-700 dark:text-amber-300"
                                    : "ml-1 text-slate-400 dark:text-slate-500"
                                }
                              >
                                · {tag.text}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100 flex-shrink-0">
                          {fmt(row.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 9. Money you moved */}
          <div className="glass-card-flat rounded-2xl overflow-hidden mt-3">
            <button
              type="button"
              onClick={() => setMovedExpanded((v) => !v)}
              className="w-full p-4 text-left flex items-center justify-between gap-2 active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
                Money you moved · <span className="font-semibold text-slate-700 dark:text-slate-300">£3,958</span> — not counted in spending
              </span>
              <ChevronDown
                size={16}
                className={`flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 motion-reduce:transition-none ${
                  movedExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
              style={{ gridTemplateRows: movedExpanded ? "1fr" : "0fr", opacity: movedExpanded ? 1 : 0 }}
            >
              <div className="overflow-hidden">
                <div className="px-4 pb-3">
                  {MONEY_MOVED_ROWS.map((row) => {
                    const Icon = row.Icon;
                    return (
                      <div key={row.label} className="flex items-center gap-2.5 min-h-[44px] py-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700/60">
                          <Icon size={13} className="text-slate-400 dark:text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                            {row.label}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {row.sub}
                          </p>
                        </div>
                        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0">
                          {row.amount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 10. Footer — quiet link + state hopper, fixed so it's always
              reachable while scrolling on a phone. */}
          <div className="fixed bottom-0 inset-x-0 z-10 pointer-events-none">
            <div className="mx-auto w-full max-w-[430px] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-[#f0f2f7] dark:from-[#0f172a] from-60% to-transparent">
              <div className="pointer-events-auto flex flex-col items-center gap-2">
                <button type="button" className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                  How we categorise your money
                </button>
                <div className="flex items-center gap-1.5 overflow-x-auto max-w-full">
                  {STATES.map((s) => (
                    <a
                      key={s}
                      href={linkFor(s)}
                      className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold active:scale-95 transition-transform ${
                        s === state
                          ? "bg-indigo-600 text-white"
                          : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      {STATE_LABEL[s]}
                    </a>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                  <a href={`?mode=light&state=${state}`}>Light</a>
                  <a href={`?mode=dark&state=${state}`}>Dark</a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The correction/teaching sheet — mocks the surface opened from the
            ask card's "Tell me what this was". Static content, no real
            logic. Dark-first, no amber (nothing here is anomalous), no
            Penny gradient (this is the engine teaching, not Penny
            advising). */}
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
