"use client";

// TEMPORARY PREVIEW — design proposal for backlog item G16, not live
// navigation. Nothing here is imported by, or imports from, the real
// components/SafeToSpendCard.tsx / backend/app/routers/analytics.py /
// backend/app/services/net_position.py — this is a hand-built replica of
// what those files' OUTPUT would look like under the proposed rule, run
// against invented, public-safe fixture numbers (see fixtures.ts). See
// docs/design/g16-cash-led-engine.md for the full written proposal this
// preview illustrates.
//
// What G16 changes versus today (G14, shipped 2026-09-09): G14 made the
// Home HERO cash-led (it already renders safe_to_spend_cash, floored at £0
// for a card-funded shortfall). The ENGINE underneath — the `safe_to_spend`
// field itself, and every reader of it (Penny, can_i, pace, spend_impact,
// grow's period gate) — stayed net of ALL unpaid card growth,
// unconditionally. G16 proposes the engine catch up: card growth stops
// being reserved by default, and becomes a separate FACT (the amber line
// under the hero, worded from the card's declared terms), reserved only as
// a FALLBACK when a card has growth but no learned repayment series at all
// (fail-closed for a pay-in-full user whose bill hasn't been learned yet).
//
// /design/cash-led-engine?case=carried|cleared|fallback&mode=light|dark

import { useEffect, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, ChevronDown, ShieldCheck } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { CASES, CASE_ORDER, CASE_LABEL, type CaseFixture, type CaseSlug } from "./fixtures";

type Treatment = "today" | "proposed";
type Mode = "light" | "dark";

function fmt(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function zeroSafe(value: number): number {
  return Math.abs(value) < 1 ? 0 : value;
}

function ThemeEffect({ mode }: { mode: Mode }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const scheme = document.querySelector('meta[name="color-scheme"]');
    const oldScheme = scheme?.getAttribute("content") ?? null;

    root.classList.toggle("dark", mode === "dark");
    scheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");

    return () => {
      root.classList.toggle("dark", hadDark);
      if (oldScheme === null) scheme?.removeAttribute("content");
      else scheme?.setAttribute("content", oldScheme);
    };
  }, [mode]);

  return null;
}

function BreakdownRow({ label, value, detail, tone = "default", derived = false, operator = "=" }: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "risk";
  derived?: boolean;
  operator?: "=" | "→";
}) {
  return (
    <div className={`flex items-start justify-between gap-3 py-2.5 ${derived ? "mt-1 border-t-2 border-slate-300 pt-3 dark:border-slate-600" : "border-b border-slate-100 last:border-b-0 dark:border-white/10"}`}>
      <div className="min-w-0">
        <dt className={`text-[11px] font-semibold uppercase tracking-wide ${derived ? "text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>
          {derived && <span aria-hidden="true">{operator} </span>}{label}
        </dt>
        {detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 text-pretty">{detail}</p>}
      </div>
      <dd className={`money shrink-0 text-sm font-semibold ${tone === "risk" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100"}`}>{value}</dd>
    </div>
  );
}

// ── Today's engine (routers/analytics.py step 6c, unchanged): every card's
// growth is reserved out of the pot, unconditionally, regardless of whether
// a repayment series is learned. ────────────────────────────────────────
type EngineResult = {
  netSafeToSpend: number;
  cardGrowthReserved: number;
  state: "comfortable" | "tight" | "short";
  shortReason: "bills" | "cards" | "cards_unconfirmed" | null;
};

function deriveToday(c: CaseFixture): EngineResult {
  const reserved = c.cardGrowth;
  const net = round2(c.safeToSpendCash - reserved);
  const tightThreshold = Math.max(100, c.monthlySpend * 0.10);
  let state: EngineResult["state"];
  let shortReason: EngineResult["shortReason"] = null;
  if (net <= 0) {
    state = "short";
    shortReason = c.safeToSpendCash <= 0 ? "bills" : "cards";
  } else if (net < tightThreshold) {
    state = "tight";
  } else {
    state = "comfortable";
  }
  return { netSafeToSpend: net, cardGrowthReserved: reserved, state, shortReason };
}

// ── Proposed engine (this doc's §1): only the portion of growth with NO
// learned repayment series is reserved. Everything else is cash-led. ─────
function deriveProposed(c: CaseFixture): EngineResult {
  const reserved = c.hasForecastSeries ? 0 : c.cardGrowth;
  const net = round2(c.safeToSpendCash - reserved);
  const tightThreshold = Math.max(100, c.monthlySpend * 0.10);
  let state: EngineResult["state"];
  let shortReason: EngineResult["shortReason"] = null;
  if (net <= 0) {
    state = "short";
    shortReason = c.safeToSpendCash <= 0 ? "bills" : "cards_unconfirmed";
  } else if (net < tightThreshold) {
    state = "tight";
  } else {
    state = "comfortable";
  }
  return { netSafeToSpend: net, cardGrowthReserved: reserved, state, shortReason };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Hero rendering — the SAME convention components/SafeToSpendCard.tsx
// already uses (untouched by this proposal): the hero is always the cash
// position, clamped to £0 for a card-related short state, and the cash GAP
// (never the net figure) for a genuine bills-short. Only the ENGINE inputs
// (state / short_reason / card_growth_reserved) differ between treatments —
// this rendering function is identical for both. ──────────────────────────
function deriveHero(c: CaseFixture, engine: EngineResult) {
  const isCardShort = engine.state === "short" && (engine.shortReason === "cards" || engine.shortReason === "cards_unconfirmed");
  const freeAmount = zeroSafe(engine.netSafeToSpend);
  let heroAmount: number;
  let heroCaption: string;
  if (engine.state === "comfortable") {
    heroAmount = freeAmount;
    heroCaption = "free until payday";
  } else if (engine.state === "tight") {
    heroAmount = freeAmount;
    heroCaption = "left until payday";
  } else if (isCardShort) {
    heroAmount = 0;
    heroCaption = "free until payday";
  } else {
    heroAmount = Math.abs(zeroSafe(c.safeToSpendCash));
    heroCaption = "short";
  }
  const StateIcon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }> =
    engine.state === "comfortable" ? ShieldCheck : engine.state === "tight" || isCardShort ? AlertCircle : AlertTriangle;
  const stateChipClass = engine.state === "comfortable"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
    : engine.state === "tight" || isCardShort
      ? "bg-slate-100 text-amber-800 dark:bg-slate-700/70 dark:text-amber-200"
      : "bg-slate-100 text-red-700 dark:bg-slate-700/70 dark:text-red-300";
  const figureClass = engine.state === "comfortable"
    ? "text-emerald-700 dark:text-emerald-300"
    : engine.state === "short" && !isCardShort
      ? "text-red-600 dark:text-red-400"
      : "text-slate-900 dark:text-slate-100";
  return { heroAmount, heroCaption, isCardShort, freeAmount, StateIcon, stateChipClass, figureClass };
}

function stateLabel(engine: EngineResult, treatment: Treatment): string {
  if (engine.state === "comfortable") return "On track";
  if (engine.state === "tight") return "Tight";
  if (engine.shortReason === "cards") return "Cards used the spare";
  if (engine.shortReason === "cards_unconfirmed") return "Card bill unconfirmed";
  return "Short";
}

// ── Secondary line copy ───────────────────────────────────────────────────
function todaySecondaryLine(c: CaseFixture, engine: EngineResult): string | null {
  if (engine.cardGrowthReserved <= 0) return null;
  return `${fmt(engine.cardGrowthReserved)} went on cards unpaid this period.`;
}

function proposedSecondaryLine(c: CaseFixture, engine: EngineResult): string | null {
  if (c.cardGrowth <= 0) return null;
  if (engine.state === "short" && engine.shortReason === "cards_unconfirmed") {
    return `${fmt(c.cardGrowth)} grew on a card with no bill forecast yet. Held back until one is confirmed.`;
  }
  if (c.usage === "clear_monthly" && c.forecastBillDateLabel) {
    return `${fmt(c.cardGrowth)} on cards, due around ${c.forecastBillDateLabel}.`;
  }
  return `${fmt(c.cardGrowth)} added to your cards this period.`;
}

// ── Penny mock copy — today's flat _nothing_spare_line vs the proposed
// combined sentence (the proposed carried/cleared wording is Kevin's own,
// quoted verbatim from the G16 backlog item). ─────────────────────────────
function pennyToday(c: CaseFixture): string {
  return `Bills are covered, but nothing spare until ${c.nextPaydayLabel}, it's gone on cards.`;
}

function pennyProposed(c: CaseFixture, engine: EngineResult): string {
  if (engine.state === "short" && engine.shortReason === "cards_unconfirmed") {
    return `Nothing spare until ${c.nextPaydayLabel}. ${fmt(c.cardGrowth)} on a card isn't confirmed yet, so it's held back.`;
  }
  return `${fmt(zeroSafe(engine.netSafeToSpend))} free until payday, and ${fmt(c.cardGrowth)} has gone on cards this period.`;
}

function HeroCard({ label, treatment, c, engine }: { label: string; treatment: Treatment; c: CaseFixture; engine: EngineResult }) {
  const { heroAmount, heroCaption, StateIcon, stateChipClass, figureClass } = deriveHero(c, engine);
  const secondary = treatment === "today" ? todaySecondaryLine(c, engine) : proposedSecondaryLine(c, engine);
  const hasCardReserve = engine.cardGrowthReserved > 0;
  const cashPositionLabel = round2(c.safeToSpendCash - engine.cardGrowthReserved) < 0
    ? "Cash after set-asides"
    : "Cash left after set-asides";

  return (
    <section className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero" aria-labelledby={`sts-heading-${treatment}-${c.slug}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${stateChipClass}`}>
          <StateIcon size={13} className="shrink-0" aria-hidden />
          {stateLabel(engine, treatment)}
        </span>
      </div>

      <h2 id={`sts-heading-${treatment}-${c.slug}`} className="mt-5">
        <span className={`money block text-[34px] font-bold leading-none tracking-[-0.045em] sm:text-[38px] ${figureClass}`}>{fmt(heroAmount)}</span>
        <span className="mt-2 block text-[15px] font-medium text-slate-600 dark:text-slate-300">{heroCaption}</span>
      </h2>

      {secondary && (
        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
          <MoneyText text={secondary} />
        </p>
      )}

      <div className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
        <details className="group">
          <summary className="min-h-11 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
            Full calculation
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="pb-2 pt-3">
            <div className="space-y-5">
              <section aria-labelledby={`cash-stage-${treatment}-${c.slug}`}>
                <h3 id={`cash-stage-${treatment}-${c.slug}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">1 · Cash forecast</h3>
                <dl className="mt-1.5">
                  <BreakdownRow label="Available now" value={fmt(c.spendableNow)} />
                  <BreakdownRow label="Bills due before payday" value={`−${fmt(c.billsTotal)}`} />
                  <BreakdownRow label="Buffer" value={`−${fmt(c.buffer)}`} />
                  <BreakdownRow
                    label={hasCardReserve ? "Cash left after set-asides" : "Safe to spend"}
                    value={fmt(c.safeToSpendCash)}
                    derived
                  />
                </dl>
              </section>

              <section aria-labelledby={`card-stage-${treatment}-${c.slug}`}>
                <h3 id={`card-stage-${treatment}-${c.slug}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">2 · Card position</h3>
                <dl className="mt-1.5">
                  <BreakdownRow label="Cash brought forward" value={fmt(c.safeToSpendCash)} />
                  <BreakdownRow
                    label={treatment === "today" ? "Unpaid card growth (reserved)" : hasCardReserve ? "Unpaid card growth (fallback reserve)" : "Unpaid card growth (fact only, not reserved)"}
                    value={hasCardReserve ? `−${fmt(engine.cardGrowthReserved)}` : fmt(0)}
                    detail={treatment === "proposed" ? (hasCardReserve ? "No repayment series learned for this card yet — reserved out of caution." : "A repayment series is learned for this card — reported, not reserved.") : undefined}
                  />
                  <BreakdownRow label="Safe to spend" value={fmt(engine.netSafeToSpend)} derived tone={engine.state === "short" && engine.shortReason === "bills" ? "risk" : "default"} />
                </dl>
              </section>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function WordingSwatch({ c }: { c: CaseFixture }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.usage === "clear_monthly" ? "Cleared monthly" : "Carried balance"}</p>
      <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200 text-pretty">
        <MoneyText text={c.usage === "clear_monthly" ? `${fmt(c.cardGrowth)} on cards, due around ${c.forecastBillDateLabel}.` : `${fmt(c.cardGrowth)} added to your cards this period.`} />
      </p>
    </div>
  );
}

function PennyMock({ c, engine, treatment }: { c: CaseFixture; engine: EngineResult; treatment: Treatment }) {
  const text = treatment === "today" ? pennyToday(c) : pennyProposed(c, engine);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{treatment === "today" ? "Today" : "Proposed"}</p>
      <div className="mt-2 flex items-start gap-2.5">
        <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" aria-hidden />
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200 text-pretty"><MoneyText text={text} /></p>
      </div>
    </div>
  );
}

function Switcher({ caseSlug, mode }: { caseSlug: CaseSlug; mode: Mode }) {
  const href = (nextCase: CaseSlug, nextMode: Mode) => `?case=${nextCase}&mode=${nextMode}`;
  return (
    <nav aria-label="Preview controls" className="sticky top-0 z-10 -mx-4 mb-5 space-y-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-900/90">
      <div className="flex flex-wrap gap-1.5">
        {CASE_ORDER.map((slug) => (
          <a
            key={slug}
            href={href(slug, mode)}
            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-semibold ${
              caseSlug === slug
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]"
            }`}
          >
            {CASE_LABEL[slug]}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <a
          href={href(caseSlug, mode === "dark" ? "light" : "dark")}
          className="min-h-9 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function CashLedEngineClient() {
  const params = useSearchParams();
  const caseParam = params.get("case");
  const caseSlug: CaseSlug = CASE_ORDER.includes(caseParam as CaseSlug) ? (caseParam as CaseSlug) : "carried";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const c = CASES[caseSlug];
  const today = deriveToday(c);
  const proposed = deriveProposed(c);

  return (
    <div className={`min-h-screen bg-slate-50 pb-16 dark:bg-slate-950 ${mode === "dark" ? "dark" : ""}`}>
      <ThemeEffect mode={mode} />
      <div className="mx-auto max-w-md px-4 pt-4">
        <Switcher caseSlug={caseSlug} mode={mode} />

        <header className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">G16 proposal</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Cash-led Safe to Spend engine</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">
            {caseSlug === "fallback"
              ? "No repayment series is learned for this card yet, so the proposed engine still reserves the growth, the same way today's engine reserves every card unconditionally."
              : "A repayment series is learned for this card, so the proposed engine stops reserving its growth and reports it as a fact instead."}
          </p>
        </header>

        <section className="mb-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Today</p>
          <HeroCard label="Safe to Spend" treatment="today" c={c} engine={today} />
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 pt-3">Proposed</p>
          <HeroCard label="Safe to Spend" treatment="proposed" c={c} engine={proposed} />
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Both card-terms wordings (proposed)</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WordingSwatch c={CASES.carried} />
            <WordingSwatch c={CASES.cleared} />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Penny's affordability answer</h2>
          <div className="space-y-3">
            <PennyMock c={c} engine={today} treatment="today" />
            <PennyMock c={c} engine={proposed} treatment="proposed" />
          </div>
        </section>
      </div>
    </div>
  );
}
