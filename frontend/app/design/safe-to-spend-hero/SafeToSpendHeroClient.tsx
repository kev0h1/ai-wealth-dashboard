"use client";

// TEMPORARY PREVIEW — design proposal for backlog item G14, not live
// navigation. Renders a faithful, hand-copied replica of the real
// components/SafeToSpendCard.tsx markup (that file is untouched by this
// round) so Kevin can compare today's shipped behaviour against the
// proposed cash-led hero, side by side, before anything is built for real.
//
// What G14 changes versus G6: G6 (shipped earlier) made the cards-short
// hero show the NET safe-to-spend figure. Kevin has now reversed that after
// living with it — the asymmetry he flagged is that bills-short shows a NET
// figure (cash gap + unpaid card growth added in, e.g. his own screen: £42
// cash gap + £761 card growth rendered as £803 red) while cards-short
// clamps to £0. This proposal makes BOTH short states cash-led: the hero is
// always the cash position, card growth is never added to it and can only
// floor it at £0 (the existing cards-short clamp), and one secondary line
// ("£761 went on cards unpaid this period") reports the card growth instead
// of folding it into the headline number or the two-figure breakdown bar.
//
// The backend's net `safe_to_spend` field (services/net_position.py,
// short_reason_for) is DELIBERATELY unchanged here — Penny and Can I...?
// keep reasoning over the net figure; only which figure this card's HERO
// renders is in scope for G14.
//
// /design/safe-to-spend-hero?treatment=today|proposed&state=<slug>&mode=light|dark

import { useEffect, type ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, AlertTriangle, ChevronDown, ShieldCheck } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { HERO_FIXTURES, HERO_STATE_LABEL, HERO_STATE_ORDER, type HeroStateSlug, type SafeToSpendOk } from "./fixtures";

type Treatment = "today" | "proposed";
type Mode = "light" | "dark";

function fmt(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function zeroSafe(value: number): number {
  return Math.abs(value) < 1 ? 0 : value;
}

function syncAgeLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return null;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 3) return null;
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / (1000 * 60 * 60 * 24);
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  return `Synced on ${new Date(isoString).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
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

// ── Shared derivation (identical in both treatments — chip, label, icon and
// figure colour are untouched by G14; only the hero figure/caption and the
// content below it change). Copied from the live component's logic. ───────
function deriveShared(data: SafeToSpendOk) {
  const freeAmount = zeroSafe(data.safe_to_spend);
  const isCardsShort = data.state === "short" && data.short_reason === "cards";
  const state: "comfortable" | "tight" | "short" = data.state === "short" && !isCardsShort && freeAmount > -1 ? "comfortable" : data.state;
  const cashRunway = data.safe_to_spend_cash == null ? null : zeroSafe(data.safe_to_spend_cash);
  const cardReserve = data.card_growth_reserved == null ? null : zeroSafe(data.card_growth_reserved);
  const exactCashRunway = data.safe_to_spend_cash ?? null;
  const exactCardReserve = data.card_growth_reserved ?? null;
  const exactLowestProjected = data.lowest_projected_balance ?? null;
  const gap = Math.abs(freeAmount);

  const StateIcon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }> =
    state === "comfortable" ? ShieldCheck : state === "tight" || isCardsShort ? AlertCircle : AlertTriangle;
  const stateLabel = state === "comfortable" ? "On track" : state === "tight" ? "Tight" : isCardsShort ? "Cards used the spare" : "Short";
  const stateChipClass = state === "comfortable"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
    : state === "tight" || isCardsShort
      ? "bg-slate-100 text-amber-800 dark:bg-slate-700/70 dark:text-amber-200"
      : "bg-slate-100 text-red-700 dark:bg-slate-700/70 dark:text-red-300";
  const figureClass = state === "comfortable"
    ? "text-emerald-700 dark:text-emerald-300"
    : state === "short" && !isCardsShort
      ? "text-red-600 dark:text-red-400"
      : "text-slate-900 dark:text-slate-100";

  return { freeAmount, isCardsShort, state, cashRunway, cardReserve, exactCashRunway, exactCardReserve, exactLowestProjected, gap, StateIcon, stateLabel, stateChipClass, figureClass };
}

// ── Today: byte-identical to the live component's hero + "what makes up
// the safety gap" logic. ──────────────────────────────────────────────────
function deriveTodayHero(shared: ReturnType<typeof deriveShared>) {
  const { state, isCardsShort, freeAmount, gap } = shared;
  let heroAmount: number;
  let heroCaption: string;
  if (state === "comfortable") {
    heroAmount = freeAmount;
    heroCaption = "free until payday";
  } else if (state === "tight") {
    heroAmount = freeAmount;
    heroCaption = "left until payday";
  } else if (isCardsShort) {
    heroAmount = 0;
    heroCaption = "free until payday";
  } else {
    heroAmount = gap;
    heroCaption = "safety gap before payday";
  }
  return { heroAmount, heroCaption };
}

// ── Proposed: hero is always the cash position. Card growth is never added
// to it, and can only floor it at £0 (the pre-existing cards-short clamp,
// unchanged). Comfortable and tight are untouched — same figure, same
// caption as today, so Kevin can confirm nothing else moves. ─────────────
function deriveProposedHero(shared: ReturnType<typeof deriveShared>) {
  const { state, isCardsShort, freeAmount, cashRunway } = shared;
  let heroAmount: number;
  let heroCaption: string;
  if (state === "comfortable") {
    heroAmount = freeAmount;
    heroCaption = "free until payday";
  } else if (state === "tight") {
    heroAmount = freeAmount;
    heroCaption = "left until payday";
  } else if (isCardsShort) {
    heroAmount = 0;
    heroCaption = "free until payday";
  } else {
    // bills-short: cash gap only, never the net figure.
    heroAmount = cashRunway == null ? 0 : Math.abs(cashRunway);
    heroCaption = "short";
  }
  return { heroAmount, heroCaption };
}

function ReplicaCard({ label, treatment, data, hidden }: { label: string; treatment: Treatment; data: SafeToSpendOk; hidden: boolean }) {
  const shared = deriveShared(data);
  const { state, isCardsShort, cashRunway, cardReserve, exactCashRunway, exactCardReserve, exactLowestProjected, StateIcon, stateLabel, stateChipClass, figureClass } = shared;
  const { heroAmount, heroCaption } = treatment === "today" ? deriveTodayHero(shared) : deriveProposedHero(shared);

  const amount = (value: number) => hidden ? "£••••" : fmt(value);
  const pennies = (value: number) => Math.abs(value) < 0.005 ? 0 : value;
  const exactAmount = (value: number) => hidden ? "£••••" : fmt2(pennies(value));
  const signedExactAmount = (value: number) => {
    const exact = pennies(value);
    return hidden ? `${exact < 0 ? "−" : ""}£••••` : `${exact < 0 ? "−" : ""}${fmt2(exact)}`;
  };
  const debitExactAmount = (value: number) => hidden ? "−£••••" : `−${fmt2(value)}`;

  const paydayDate = new Date(data.next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - today.getTime()) / 86400000);
  const paydayLabel = daysAway <= 0 ? "today" : daysAway === 1 ? "tomorrow" : daysAway < 7
    ? new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const freshnessLabel = syncAgeLabel(data.last_synced);
  const calculationItems = [
    { label: "Buffer", value: data.buffer },
    { label: "Plans reserved", value: data.commitments_reserved ?? 0 },
    { label: "Allocations reserved", value: data.allocations_reserved ?? 0 },
  ].filter((item) => item.value > 0);
  const hasSetAsides = calculationItems.length > 0;
  const hasCardReserve = exactCardReserve != null && exactCardReserve > 0;
  const cashPositionLabel = cashRunway != null && cashRunway < 0
    ? "Cash after set-asides"
    : "Cash left after set-asides";

  // TODAY: the live "What makes up the safety gap" bar (bills-short only)
  // and its two-figure breakdown, else the older one-line fallback sentence
  // when there's card growth to mention. Copied verbatim, unchanged.
  const showGapComposition = treatment === "today" && state === "short" && !isCardsShort && cashRunway != null && cashRunway < 0 && cardReserve != null && cardReserve > 0;
  const compositionTotal = showGapComposition ? Math.abs(cashRunway!) + cardReserve! : 0;
  const cashShare = compositionTotal > 0 ? Math.max(6, Math.min(94, Math.abs(cashRunway!) / compositionTotal * 100)) : 50;
  const showOldSentence = treatment === "today" && !showGapComposition && cashRunway != null && cardReserve != null && cardReserve > 0;

  // PROPOSED: one secondary line, in both short states, only when there is
  // unpaid card growth to report. No bar, no two-figure breakdown, ever.
  const isShortState = state === "short";
  const showProposedLine = treatment === "proposed" && isShortState && cardReserve != null && cardReserve > 0;

  return (
    <section className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero" aria-labelledby={`safe-to-spend-heading-${treatment}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${stateChipClass}`}>
          <StateIcon size={13} className="shrink-0" aria-hidden />
          {stateLabel}
        </span>
      </div>

      <h2 id={`safe-to-spend-heading-${treatment}`} className="mt-5">
        <span className={`money block text-[34px] font-bold leading-none tracking-[-0.045em] sm:text-[38px] ${figureClass}`}>{amount(heroAmount)}</span>
        <span className="mt-2 block text-[15px] font-medium text-slate-600 dark:text-slate-300">
          {heroCaption}{data.estimated && <span className="font-normal text-slate-500 dark:text-slate-400"> · estimated</span>}
        </span>
      </h2>

      {showGapComposition && (
        <div className="mt-4" aria-label={`${amount(Math.abs(cashRunway!))} projected cash gap and ${amount(cardReserve!)} unpaid card balance growth make up the safety gap`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">What makes up the safety gap</p>
          <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
            <span className="h-full bg-rose-300/80 dark:bg-rose-400/60" style={{ width: `${cashShare}%` }} />
            <span className="h-full flex-1 bg-slate-300 dark:bg-slate-500" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="money text-base font-bold text-slate-900 dark:text-slate-100">{amount(Math.abs(cashRunway!))}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">Projected cash gap</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">after bills and set-asides</p>
            </div>
            <div className="text-right">
              <p className="money text-base font-bold text-slate-900 dark:text-slate-100">{amount(cardReserve!)}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">Unpaid card growth</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">net balance increase</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
            This is not your total card spending. It is how much your balance has grown this pay period after payments and refunds, less any card bill already forecast. Spend shows your actual purchases.
          </p>
        </div>
      )}

      {showOldSentence && (
        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
          {cashRunway! < 0
            ? <MoneyText text={`${amount(Math.abs(cashRunway!))} is the projected cash gap after bills and set-asides.`} />
            : <MoneyText text={`Bills and set-asides leave ${amount(cashRunway!)}, but ${amount(cardReserve!)} of unpaid card balance growth means nothing is free right now.`} />}
        </p>
      )}

      {showProposedLine && (
        <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
          <MoneyText text={`${amount(cardReserve!)} went on cards unpaid this period.`} />
        </p>
      )}

      <div className="mt-3 border-t border-slate-100 pt-1 dark:border-white/10">
        <details className="group">
          <summary className="min-h-11 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
            Full calculation
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="pb-2 pt-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 text-pretty">Each step starts with a carried balance. = means a direct sum; → marks the lowest point in the dated forecast. Exact pennies make every sum traceable.</p>

            <div className="mt-4 space-y-5">
              <section aria-labelledby={`cash-forecast-stage-${treatment}`}>
                <h3 id={`cash-forecast-stage-${treatment}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">1 · Cash forecast</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Bills and income are applied in date order.</p>
                <dl className="mt-1.5">
                  {data.spendable_now != null && <BreakdownRow label="Available now" value={signedExactAmount(data.spendable_now)} />}
                  {data.bills_total > 0 && <BreakdownRow label="Bills due before payday" value={debitExactAmount(data.bills_total)} />}
                  {data.income_before_payday > 0 && <BreakdownRow label="Income before payday" value={`+${exactAmount(data.income_before_payday)}`} />}
                  {exactLowestProjected != null && (
                    <BreakdownRow
                      label={!hasSetAsides && !hasCardReserve ? (state === "short" ? "Final safety position" : "Safe to spend") : "Lowest balance reached"}
                      value={signedExactAmount(exactLowestProjected)}
                      derived
                      operator="→"
                      detail="The lowest point after applying each bill and income item on its due date."
                      tone={!hasSetAsides && !hasCardReserve && state === "short" && !isCardsShort ? "risk" : "default"}
                    />
                  )}
                </dl>
              </section>

              {hasSetAsides && exactCashRunway != null && (
                <section aria-labelledby={`set-asides-stage-${treatment}`}>
                  <h3 id={`set-asides-stage-${treatment}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">2 · Set-asides</h3>
                  <dl className="mt-1.5">
                    {exactLowestProjected != null && <BreakdownRow label="From cash forecast" value={signedExactAmount(exactLowestProjected)} />}
                    {calculationItems.map((item) => <BreakdownRow key={item.label} label={item.label} value={debitExactAmount(item.value)} />)}
                    <BreakdownRow
                      label={!hasCardReserve ? (state === "short" ? "Final safety position" : "Safe to spend") : cashPositionLabel}
                      value={signedExactAmount(exactCashRunway)}
                      derived
                      tone={!hasCardReserve && state === "short" && !isCardsShort ? "risk" : "default"}
                    />
                  </dl>
                </section>
              )}

              {hasCardReserve && exactCashRunway != null && (
                <section aria-labelledby={`card-position-stage-${treatment}`}>
                  <h3 id={`card-position-stage-${treatment}`} className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200">{hasSetAsides ? "3" : "2"} · Card position</h3>
                  <dl className="mt-1.5">
                    <BreakdownRow label="Cash brought forward" value={signedExactAmount(exactCashRunway)} />
                    <BreakdownRow label="Unpaid card growth" value={debitExactAmount(exactCardReserve!)} detail="Net balance increase this pay period; not total card purchases." />
                    <BreakdownRow label={state === "short" ? "Final safety position" : "Safe to spend"} value={signedExactAmount(data.safe_to_spend)} derived tone={state === "short" && !isCardsShort ? "risk" : "default"} />
                  </dl>
                </section>
              )}
            </div>
            {(data.pooled_transfers_excluded ?? 0) > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
                Transfers between your own included accounts do not change the total, so they are left out of this calculation.
              </p>
            )}
            {cashRunway != null && cardReserve != null && cardReserve > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-pretty">The summary above is rounded to whole pounds; this calculation shows the exact values used.</p>}
          </div>
        </details>
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-[13px] text-slate-600 dark:text-slate-300 text-pretty"><MoneyText text={`Pay period ends ${paydayLabel}`} />{(data.payday_income ?? 0) > 0 && <><span aria-hidden> · </span><MoneyText text={`~${hidden ? "••" : fmt(data.payday_income!)} expected`} /></>}</p>
        {freshnessLabel && <p className="text-sm text-slate-500 dark:text-slate-400">{freshnessLabel}</p>}
      </div>
    </section>
  );
}

function Switcher({ stateSlug, treatment, mode }: { stateSlug: HeroStateSlug; treatment: Treatment | "both"; mode: Mode }) {
  const href = (nextState: HeroStateSlug, nextTreatment: Treatment | "both", nextMode: Mode) =>
    `?state=${nextState}&treatment=${nextTreatment}&mode=${nextMode}`;

  return (
    <nav data-hero-switcher aria-label="Preview controls" className="sticky top-0 z-10 -mx-4 mb-5 space-y-2 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-900/90">
      <div className="flex flex-wrap gap-1.5">
        {HERO_STATE_ORDER.map((slug) => (
          <a
            key={slug}
            href={href(slug, treatment, mode)}
            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-semibold ${
              stateSlug === slug
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]"
            }`}
          >
            {HERO_STATE_LABEL[slug]}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["both", "today", "proposed"] as const).map((t) => (
          <a
            key={t}
            href={href(stateSlug, t, mode)}
            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
              treatment === t
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]"
            }`}
          >
            {t === "both" ? "Today + Proposed" : t}
          </a>
        ))}
        <a
          href={href(stateSlug, treatment, mode === "dark" ? "light" : "dark")}
          className="min-h-9 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function SafeToSpendHeroClient() {
  const params = useSearchParams();
  const stateParam = params.get("state");
  const stateSlug: HeroStateSlug = HERO_STATE_ORDER.includes(stateParam as HeroStateSlug) ? (stateParam as HeroStateSlug) : "bills-short";
  const treatmentParam = params.get("treatment");
  const treatment: Treatment | "both" = treatmentParam === "today" || treatmentParam === "proposed" ? treatmentParam : "both";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  const data = HERO_FIXTURES[stateSlug];

  return (
    // Dark mode is scoped to this wrapper (a local ".dark" ancestor, per
    // globals.css's `@custom-variant dark (&:is(.dark, .dark *))`) rather
    // than toggled on <html>: PreferencesContext owns the <html> "dark"
    // class globally and re-asserts its own (unauthenticated-default,
    // light) state on every mount, which would otherwise fight this
    // preview's own ?mode= flag.
    <div className={`min-h-screen bg-slate-50 pb-16 dark:bg-slate-950 ${mode === "dark" ? "dark" : ""}`}>
      <ThemeEffect mode={mode} />
      <div className="mx-auto max-w-md px-4 pt-4">
        <Switcher stateSlug={stateSlug} treatment={treatment} mode={mode} />

        <header className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">G14 proposal</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Cash-led Safe to Spend hero</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">{HERO_STATE_LABEL[stateSlug]} state. The hero figure changes between treatments; the collapsible ledger below it does not.</p>
        </header>

        <div className="space-y-8">
          {(treatment === "both" || treatment === "today") && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Today</p>
              <ReplicaCard label="Safe to Spend" treatment="today" data={data} hidden={false} />
            </div>
          )}
          {(treatment === "both" || treatment === "proposed") && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Proposed</p>
              <ReplicaCard label="Safe to Spend" treatment="proposed" data={data} hidden={false} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
