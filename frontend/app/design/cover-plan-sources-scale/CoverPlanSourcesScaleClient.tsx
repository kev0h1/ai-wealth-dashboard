"use client";

// TEMPORARY PREVIEW — G51, cover-plan source settings scale round.
// Static fixtures only. No API requests and no production settings changes.
//
// Kevin picked variant B, the search-first exceptions manager (2026-09-12).
// This preview now renders the SHIPPED production component directly
// (components/CoverPlanSourcesCard.tsx) against a seventeen-account fixture
// shaped like the owner's own estate, rather than a standalone
// reimplementation — production Settings pages are authenticated and can't
// be screenshotted, so this is the only way to see the real component at
// scale before Kevin does.
//
// H40 (2026-09-13): CoverOutcome in the production card has six branches.
// The original three states (all, savings, short) only reached three of
// them (current-usable default, savings-covers-it-today, and the
// uncovered-gap risk case respectively). Three states were added so every
// branch is reachable by URL rather than by scripting toggle clicks against
// a running build: current-only (current accounts are the only source,
// every savings account excluded), no-headroom (every allowed account is
// short or empty, reached by excluding everything except the fixture's
// already-short current account and its four zero-balance pots), and
// savings-only (savings would be checked first, every current account
// excluded). Nothing about the existing three states changed.
// /design/cover-plan-sources-scale?state=all|savings|short|current-only|no-headroom|savings-only&mode=light|dark

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, CircleAlert, ShieldCheck } from "lucide-react";
import type { Account } from "@/lib/api";
import CoverPlanSourcesCard from "@/components/CoverPlanSourcesCard";

type PreviewState = "all" | "savings" | "short" | "current-only" | "no-headroom" | "savings-only";
type Mode = "light" | "dark";

type Seed = {
  id: string;
  name: string;
  provider: string;
  kind: "current" | "savings";
  balance: number;
  manual?: boolean;
  /** This account is short per the engine's OWN eligibility (G50): the
   *  fixture hardcodes it here rather than deriving it from any move card,
   *  the bug this round fixes. */
  short?: boolean;
};

// Kevin's real estate: 4 current accounts (one manual, one short) and 13
// savings pots (one manual, four sitting at zero) — seventeen non-credit
// accounts total, the shape the shipped card could not scale to.
const SEED: Seed[] = [
  { id: "barclays-current", name: "Everyday household joint current account", provider: "Barclays", kind: "current", balance: 610 },
  { id: "monzo-current", name: "Monzo current", provider: "Monzo", kind: "current", balance: 260 },
  { id: "starling-bills", name: "Bills account", provider: "Starling", kind: "current", balance: -35, short: true },
  { id: "petty-cash", name: "Petty cash tin", provider: "Offline", kind: "current", balance: 120, manual: true },
  { id: "rainy-day", name: "Rainy day", provider: "NatWest", kind: "savings", balance: 2390 },
  { id: "emergency-fund", name: "Emergency fund", provider: "Chase", kind: "savings", balance: 3400 },
  { id: "isa", name: "ISA", provider: "NatWest", kind: "savings", balance: 1200 },
  { id: "house-deposit", name: "House deposit", provider: "NatWest", kind: "savings", balance: 5200 },
  { id: "wedding-fund", name: "Wedding fund", provider: "Starling", kind: "savings", balance: 890 },
  { id: "car-fund", name: "Car fund", provider: "Monzo", kind: "savings", balance: 150 },
  { id: "gift-fund", name: "Gift fund", provider: "Monzo", kind: "savings", balance: 60 },
  { id: "christmas-pot", name: "Christmas pot", provider: "Monzo", kind: "savings", balance: 40 },
  { id: "cash-reserve", name: "Cash reserve", provider: "Offline", kind: "savings", balance: 790, manual: true },
  { id: "groceries-pot", name: "Groceries", provider: "Monzo", kind: "savings", balance: 0 },
  { id: "transport-pot", name: "Transport", provider: "Monzo", kind: "savings", balance: 0 },
  { id: "roundup-pot", name: "Round up", provider: "Monzo", kind: "savings", balance: 0 },
  { id: "holiday-pot", name: "Holiday", provider: "Monzo", kind: "savings", balance: 0 },
];

const ACCOUNTS: Account[] = SEED.map((seed) => ({
  id: seed.id,
  name: seed.name,
  type: "bank",
  subtype: seed.kind === "savings" ? "SAVINGS" : "TRANSACTION",
  balance: seed.balance,
  currency: "GBP",
  provider: seed.provider,
  status: "connected",
  manual: seed.manual,
}));

const SHORT_ACCOUNT_IDS = new Set(SEED.filter((seed) => seed.short).map((seed) => seed.id));

const SAVINGS_IDS = SEED.filter((seed) => seed.kind === "savings").map((seed) => seed.id);
const CURRENT_IDS = SEED.filter((seed) => seed.kind === "current").map((seed) => seed.id);
// The five short-or-empty accounts left allowed for "no-headroom":
// starling-bills is the fixture's own short current account, and the four
// zero-balance pots are already empty, so every allowed account is
// unusable without inventing a new kind of account.
const HEADROOM_ALLOWED = new Set(["starling-bills", "groceries-pot", "transport-pot", "roundup-pot", "holiday-pot"]);

const PRESET_EXCLUSIONS: Record<PreviewState, string[]> = {
  all: [],
  savings: ["barclays-current", "monzo-current", "petty-cash"],
  short: SEED.map((seed) => seed.id),
  // H40: every savings account excluded, all four current accounts
  // (including the short one) left allowed, so the three non-short current
  // accounts are usable and savings has nothing to enter with.
  "current-only": SAVINGS_IDS,
  // H40: only the fixture's own short current account and its four
  // zero-balance savings pots stay allowed. Every allowed account is short
  // or empty, so nothing is usable even though something is allowed.
  "no-headroom": SEED.filter((seed) => !HEADROOM_ALLOWED.has(seed.id)).map((seed) => seed.id),
  // H40: every current account excluded, every savings account left
  // allowed, so the plan would start with savings.
  "savings-only": CURRENT_IDS,
};

const STATE_LABEL: Record<PreviewState, string> = {
  all: "Nothing excluded",
  savings: "A few excluded",
  short: "Everything excluded",
  "current-only": "Savings excluded",
  "no-headroom": "Only short/empty left",
  "savings-only": "Current excluded",
};

const PREVIEW_STATES: PreviewState[] = ["all", "savings", "short", "current-only", "no-headroom", "savings-only"];

function SettingsContext() {
  return (
    <>
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          className="grid size-11 shrink-0 place-items-center rounded-full text-slate-600 active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-slate-800"
        >
          <ChevronLeft size={21} aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-[21px] font-bold text-slate-950 dark:text-white">Settings</h1>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Money decisions</p>
        </div>
      </header>
      <div className="glass-card flex min-h-16 items-center gap-3 rounded-2xl px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Your plan</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">Standard, bank data up to date</span>
        </span>
        <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Manage</span>
      </div>
    </>
  );
}

function Controls({ state, mode }: { state: PreviewState; mode: Mode }) {
  const currentIndex = PREVIEW_STATES.indexOf(state);
  const nextState = PREVIEW_STATES[(currentIndex + 1) % PREVIEW_STATES.length];
  return (
    <nav
      aria-label="Preview controls"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        <a
          href={`?state=${nextState}&mode=${mode}`}
          className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none"
        >
          {STATE_LABEL[state]}
        </a>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a
          href={`?state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function CoverPlanSourcesScaleClient() {
  const params = useSearchParams();
  const rawState = params.get("state");
  const state: PreviewState = (PREVIEW_STATES as string[]).includes(rawState ?? "")
    ? (rawState as PreviewState)
    : "all";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(PRESET_EXCLUSIONS[state]));
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setExcluded(new Set(PRESET_EXCLUSIONS[state]));
  }

  function toggleAccount(id: string) {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-32 pt-5 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[880px] px-4">
          <div className="grid items-start gap-5 lg:grid-cols-[280px_430px] lg:justify-center">
            <aside className="glass-card rounded-2xl p-4 lg:sticky lg:top-5">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <CircleAlert size={15} aria-hidden="true" />
                <p className="text-[10px] font-semibold uppercase tracking-widest">G51, shipped</p>
              </div>
              <p className="mt-3 text-[13px] font-bold text-slate-900 dark:text-slate-100">
                Search-first exceptions manager
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                This renders the real production component
                (components/CoverPlanSourcesCard.tsx), not a standalone
                reimplementation. The ranking becomes a static strip (Current
                N of M, Savings N of M), the account list shows only
                accounts turned off or skipped, and past five turned-off
                exceptions the list collapses to a count with a disclosure
                so the worst case cannot grow without bound.
              </p>
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700/70">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Fixture</p>
                <p className="mt-1 text-[17px] font-bold text-slate-950 dark:text-white">17 non-credit accounts</p>
                <p className="mt-1 hidden text-[12px] leading-relaxed text-slate-500 dark:text-slate-400 lg:block">
                  4 current (1 short, 1 manual) and 13 savings (1 manual, 4
                  at zero balance), the shape of the owner&rsquo;s own
                  estate. Use the bottom state control to switch which
                  accounts are turned off, or toggle accounts directly.
                </p>
              </div>
            </aside>

            <div className="mx-auto min-w-0 w-full max-w-[430px] space-y-4">
              <SettingsContext />
              <CoverPlanSourcesCard
                accounts={ACCOUNTS}
                excludedIds={excluded}
                shortAccountIds={SHORT_ACCOUNT_IDS}
                onToggle={toggleAccount}
              />
            </div>
          </div>
        </div>
        <Controls state={state} mode={mode} />
      </main>
    </div>
  );
}
