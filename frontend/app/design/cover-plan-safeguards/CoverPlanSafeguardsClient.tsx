"use client";

// TEMPORARY PREVIEW, G200 cover plan safeguards redesign round.
// Static fixtures only. No API requests and no production settings changes.
//
// Three art directions for the card (A Permission slip, B Cover route,
// C Permission ledger) plus "now", the shipped component rendered through its
// real props with a live move, as the comparison. A, B and C take the same
// props as CoverPlanSourcesCard, so the picked one can replace it in place.
// The fixture is the 17-account estate from cover-plan-sources-scale plus the
// two upper-case names from the owner's own screenshot.
//
// /design/cover-plan-safeguards?variant=a|b|c|now
//   &state=default|all|none|stuck  (which accounts the user turned off)
//   &estate=std|long               (long: ten accounts cannot spare anything today)
//   &frame=inline|page             (inside Settings, or as its own drill-in page)
//   &mode=light|dark

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import type { Account } from "@/lib/api";
import CoverPlanSourcesCard, { type LiveCoverRoute } from "@/components/CoverPlanSourcesCard";
import { CoverRoute, PermissionLedger, PermissionSlip } from "./variants";

type Variant = "a" | "b" | "c" | "now";
type State = "default" | "all" | "none" | "stuck";
type Estate = "std" | "long";
type Frame = "inline" | "page";
type Mode = "light" | "dark";

type Seed = {
  id: string;
  name: string;
  provider: string;
  kind: "current" | "savings";
  balance: number;
  manual?: boolean;
  short?: boolean;
  /** Also cannot spare anything today in the long estate. */
  longShort?: boolean;
};

const SEED: Seed[] = [
  { id: "premier", name: "PREMIER CURRENT ACCOUNT", provider: "NatWest", kind: "current", balance: 340 },
  { id: "barclays-current", name: "Everyday household joint current account", provider: "Barclays", kind: "current", balance: 610 },
  { id: "monzo-current", name: "Monzo current", provider: "Monzo", kind: "current", balance: 260 },
  { id: "starling-bills", name: "Bills account", provider: "Starling", kind: "current", balance: -35, short: true },
  { id: "petty-cash", name: "Petty cash tin", provider: "Offline", kind: "current", balance: 120, manual: true },
  { id: "digital-saver", name: "DIGITAL SAVER", provider: "Offline", kind: "savings", balance: 500, manual: true },
  { id: "rainy-day", name: "Rainy day", provider: "NatWest", kind: "savings", balance: 2390 },
  { id: "emergency-fund", name: "Emergency fund", provider: "Chase", kind: "savings", balance: 3400 },
  { id: "isa", name: "ISA", provider: "NatWest", kind: "savings", balance: 1200 },
  { id: "house-deposit", name: "House deposit", provider: "NatWest", kind: "savings", balance: 5200 },
  { id: "wedding-fund", name: "Wedding fund", provider: "Starling", kind: "savings", balance: 890, longShort: true },
  { id: "car-fund", name: "Car fund", provider: "Monzo", kind: "savings", balance: 150, longShort: true },
  { id: "gift-fund", name: "Gift fund", provider: "Monzo", kind: "savings", balance: 60, longShort: true },
  { id: "christmas-pot", name: "Christmas pot", provider: "Monzo", kind: "savings", balance: 40, longShort: true },
  { id: "cash-reserve", name: "Cash reserve", provider: "Offline", kind: "savings", balance: 790, manual: true, longShort: true },
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

function shortIdsFor(estate: Estate): Set<string> {
  return new Set(SEED.filter((s) => s.short || (estate === "long" && s.longShort) || (estate === "long" && s.id === "starling-bills")).map((s) => s.id));
}

function exclusionsFor(state: State, estate: Estate): string[] {
  if (state === "all") return [];
  if (state === "none") return SEED.map((s) => s.id);
  if (state === "stuck") {
    // Everything that could help is turned off; only accounts that cannot
    // spare anything today stay allowed.
    const shorts = shortIdsFor(estate);
    return SEED.filter((s) => !shorts.has(s.id) && s.balance > 0).map((s) => s.id);
  }
  return ["wedding-fund", "house-deposit"];
}

const LIVE_ROUTE: LiveCoverRoute = {
  headline: "Move £45 to Premier Current Account",
  detail:
    "Premier Current Account is expected to dip below £10 before payday. Everyday household joint current account has £610 to spare after its own bills, so £45 moves from there and leaves it comfortable.",
  legs: [{ accountId: "barclays-current", name: "Everyday household joint current account", provider: "Barclays", amount: 45 }],
  risk: false,
};

const VARIANTS: Array<{ id: Variant; label: string }> = [
  { id: "a", label: "A Permission slip" },
  { id: "b", label: "B Cover route" },
  { id: "c", label: "C Permission ledger" },
  { id: "now", label: "Shipped today" },
];
const STATES: State[] = ["default", "all", "none", "stuck"];
const STATE_LABEL: Record<State, string> = {
  default: "Two turned off",
  all: "Nothing turned off",
  none: "Everything off",
  stuck: "Only cannot-spare left",
};

const CHIP =
  "flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none";

function Controls({ variant, state, estate, frame, mode }: { variant: Variant; state: State; estate: Estate; frame: Frame; mode: Mode }) {
  const href = (patch: Partial<{ variant: Variant; state: State; estate: Estate; frame: Frame; mode: Mode }>) => {
    const next = { variant, state, estate, frame, mode, ...patch };
    return `?variant=${next.variant}&state=${next.state}&estate=${next.estate}&frame=${next.frame}&mode=${next.mode}`;
  };
  const nextVariant = VARIANTS[(VARIANTS.findIndex((v) => v.id === variant) + 1) % VARIANTS.length].id;
  const nextState = STATES[(STATES.indexOf(state) + 1) % STATES.length];
  return (
    <nav
      aria-label="Preview controls"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-2"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-0.5 rounded-3xl border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        <a href={href({ variant: nextVariant })} className={CHIP}>{VARIANTS.find((v) => v.id === variant)?.label}</a>
        <a href={href({ state: nextState })} className={CHIP}>{STATE_LABEL[state]}</a>
        <a href={href({ estate: estate === "std" ? "long" : "std" })} className={CHIP}>{estate === "std" ? "5 cannot spare" : "10 cannot spare"}</a>
        <a href={href({ frame: frame === "inline" ? "page" : "inline" })} className={CHIP}>{frame === "inline" ? "In Settings" : "Own page"}</a>
        <a href={href({ mode: mode === "dark" ? "light" : "dark" })} className={CHIP}>{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
    </nav>
  );
}

function SettingsNeighbour() {
  return (
    <div className="glass-card flex min-h-16 items-center gap-3 rounded-2xl px-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <ShieldCheck size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Your plan</span>
        <span className="block text-[12px] text-slate-600 dark:text-slate-300">Standard, bank data up to date</span>
      </span>
      <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Manage</span>
    </div>
  );
}

export default function CoverPlanSafeguardsClient() {
  const params = useSearchParams();
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const raw = params.get(key) ?? "";
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  };
  const variant = pick<Variant>("variant", ["a", "b", "c", "now"], "a");
  const state = pick<State>("state", STATES, "default");
  const estate = pick<Estate>("estate", ["std", "long"], "std");
  const frame = pick<Frame>("frame", ["inline", "page"], "inline");
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const seedKey = `${state}-${estate}`;
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(exclusionsFor(state, estate)));
  const [lastKey, setLastKey] = useState(seedKey);
  if (seedKey !== lastKey) {
    setLastKey(seedKey);
    setExcluded(new Set(exclusionsFor(state, estate)));
  }
  const shortIds = shortIdsFor(estate);
  const toggle = (id: string) =>
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const props = { liveRoute: LIVE_ROUTE, accounts: ACCOUNTS, excludedIds: excluded, shortAccountIds: shortIds, hideAmounts: false, onToggle: toggle };

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-40 pt-5 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] space-y-5 px-4">
          <header className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Back"
              className="grid size-11 shrink-0 place-items-center rounded-full text-slate-600 active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-slate-800"
            >
              <ChevronLeft size={21} aria-hidden="true" />
            </button>
            <h1 className="text-[21px] font-bold text-slate-950 dark:text-white">
              {frame === "page" ? "Cover plan" : "Settings"}
            </h1>
          </header>
          <p className="rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-[12px] leading-snug text-slate-600 dark:border-slate-700 dark:bg-white/[0.04] dark:text-slate-300">
            Preview note: A, B and C are hand-authored explorations. &ldquo;Shipped today&rdquo; renders the
            production CoverPlanSourcesCard through its real props.
          </p>
          {frame === "inline" && <SettingsNeighbour />}
          {variant === "a" && <PermissionSlip {...props} />}
          {variant === "b" && <CoverRoute {...props} />}
          {variant === "c" && <PermissionLedger {...props} />}
          {variant === "now" && (
            <CoverPlanSourcesCard
              accounts={ACCOUNTS}
              excludedIds={excluded}
              shortAccountIds={shortIds}
              liveRoute={LIVE_ROUTE}
              onToggle={toggle}
            />
          )}
        </div>
        <Controls variant={variant} state={state} estate={estate} frame={frame} mode={mode} />
      </main>
    </div>
  );
}
