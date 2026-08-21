// impeccable-disable design-system-font-size: all literal px sizes here (12px, 13px, 15px) are project-approved in .impeccable/config.json ignoreValues
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api, DebtPlanView, DebtPlanViewCard, CardTermsCard } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import { usePreferences } from "@/components/PreferencesContext";
import { BANK_META, BankBadge, bankKey } from "@/components/AccountMiniCard";
import CardTermsSheet from "@/components/CardTermsSheet";
import BottomNav from "@/components/BottomNav";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number, hide: boolean): string {
  if (hide) return "••••";
  return "£" + Math.round(Math.abs(n)).toLocaleString("en-GB");
}

const THIS_YEAR = new Date().getFullYear();

function fmtMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const d = new Date(y, m - 1, 1);
  if (y === THIS_YEAR) return d.toLocaleDateString("en-GB", { month: "short" });
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** Is the given "YYYY-MM" promo end-month within 60 days of today?
 *  Convention: the promo runs to the last day of that month. */
function isCliff(until: string): boolean {
  const y = parseInt(until.slice(0, 4), 10);
  const m = parseInt(until.slice(5, 7), 10);
  const lastDay = new Date(y, m, 0); // last day of that month
  const now = Date.now();
  return (lastDay.getTime() - now) / 86_400_000 <= 60;
}

function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: meta?.logoFile
      ? `/banks/${meta.logoFile}`
      : meta?.domain
      ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
      : null,
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Card"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl glass-card p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
        <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
    </div>
  );
}

// ── Whisper label ──────────────────────────────────────────────────────────────

function WhisperLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-3">
      {children}
    </p>
  );
}

// ── Verdict block ──────────────────────────────────────────────────────────────

function VerdictBlock({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  const { totals } = plan;
  const buckets = totals.buckets;

  let sentence: React.ReactNode;
  const amberDot = (
    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-2 align-middle" aria-hidden />
  );

  if (totals.verdict === "bad") {
    if (!totals.debt_free_month) {
      sentence = (
        <>
          {amberDot}At your current pace the cards aren&apos;t coming down.
          {plan.history?.rising && (
            <> Your carried debt has risen <span className="font-mono tabular-nums">{fmtMoney(plan.history.trend_3m, hide)}</span> over the last three months.</>
          )}
        </>
      );
    } else {
      sentence = (
        <>
          {amberDot}At your current pace the cards clear in {fmtMonth(totals.debt_free_month)}, further out than five years.
          {plan.history?.rising && (
            <> Your carried debt has risen <span className="font-mono tabular-nums">{fmtMoney(plan.history.trend_3m, hide)}</span> over the last three months.</>
          )}
        </>
      );
    }
  } else if (totals.verdict === "drifting") {
    sentence = (
      <>{amberDot}At your current pace the cards clear in {fmtMonth(totals.debt_free_month!)}, <span className="font-mono tabular-nums">{fmtMoney(totals.interest_to_clear, hide)}</span> of that will be interest.</>
    );
  } else {
    // good
    if (totals.debt < 50 || !totals.debt_free_month) {
      sentence = <>Nothing material on the cards right now.</>;
    } else {
      sentence = (
        <>At your current pace the cards clear in {fmtMonth(totals.debt_free_month)}, with <span className="font-mono tabular-nums">{fmtMoney(totals.interest_to_clear, hide)}</span> interest.</>
      );
    }
  }

  // Split line — only when buckets are present and float_total >= 1
  let splitLine: React.ReactNode = null;
  if (buckets && buckets.float_total >= 1) {
    const carried = buckets.carried_total;
    const float = buckets.float_total;
    const interest = buckets.carried_interest;
    const zero = buckets.carried_zero;
    let splitText: React.ReactNode;
    if (interest >= 1) {
      splitText = <><span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(carried, hide)}</span> carried, <span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(interest, hide)}</span> of it costing interest · <span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(float, hide)}</span> of monthly spending you clear as you go</>;
    } else if (zero >= 0.9 * carried) {
      splitText = <><span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(carried, hide)}</span> carried on 0% deals · <span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(float, hide)}</span> of monthly spending you clear as you go</>;
    } else {
      splitText = <><span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(carried, hide)}</span> carried · <span className="font-mono tabular-nums">{hide ? "••••" : fmtMoney(float, hide)}</span> of monthly spending you clear as you go</>;
    }
    splitLine = (
      <p className="text-[13px] mt-1 text-slate-600 dark:text-slate-300">
        {splitText}
      </p>
    );
  }

  const showFloatBuckets = buckets && buckets.float_total >= 1;

  return (
    <div className="glass-hero rounded-3xl p-5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300">
        {showFloatBuckets ? "CARRIED ON YOUR CARDS" : "ACROSS YOUR CARDS"}
      </p>
      <p className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight mt-1 font-mono tabular-nums">
        {showFloatBuckets
          ? (hide ? "••••" : "£" + Math.round(buckets!.carried_total).toLocaleString("en-GB"))
          : (hide ? "••••" : "£" + Math.round(totals.debt).toLocaleString("en-GB"))
        }
      </p>
      {splitLine}
      <p className="text-[15px] leading-relaxed mt-2 text-slate-700 dark:text-slate-200">
        {sentence}
      </p>
      {plan.commitments_reserved && totals.debt_free_month && (
        <p className="text-[11px] mt-2 text-slate-400 dark:text-slate-500 leading-snug">
          Assumes your recent payment pace continues. Your plans reserve{" "}
          <span className="font-mono tabular-nums">{fmtMoney(plan.commitments_reserved.total_slice, hide)}</span>{" "}
          {plan.commitments_reserved.period_label
            ? `each pay period (${plan.commitments_reserved.period_label})`
            : "a period"}
          , which can change this.
        </p>
      )}
    </div>
  );
}

// ── Agency block ("what it would take") ──────────────────────────────────────

function AgencyBlock({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  const extra = plan.extra_to_clear;
  const wins = plan.whats_working ?? [];
  const hasFloat = (plan.totals.buckets?.float_total ?? 0) >= 1;
  const cardWord = hasFloat ? "carried card" : "card";

  const hasExtra = extra != null;
  const hasWins = wins.length > 0;
  if (!hasExtra && !hasWins) return null;

  return (
    <div>
      <WhisperLabel>WHAT IT WOULD TAKE</WhisperLabel>
      <div className="glass-card rounded-2xl p-4 space-y-2">
        {hasExtra && (
          extra.amount === 0 ? (
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              Your current pace already clears every {cardWord} by {fmtMonth(extra.debt_free_month)}.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono tabular-nums">{fmtMoney(extra.amount, hide)}</span> more a month
              </span>{" "}
              clears every {cardWord} by {fmtMonth(extra.debt_free_month)}.
            </p>
          )
        )}
        {wins.map(win => (
          <p key={win.account_id} className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            {win.name} is on its way out, clearing{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {fmtMonth(win.payoff_month)}
            </span>{" "}
            at your pace.
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Missing-rates callout ─────────────────────────────────────────────────────

function MissingRatesCallout({
  plan,
  onAddRates,
}: {
  plan: DebtPlanView;
  onAddRates: () => void;
}) {
  const n = plan.cards.filter(c => c.flags.terms_missing && c.debt > 0).length;
  if (n === 0) return null;

  const primary =
    n === 1
      ? "1 card has no rate on file, so its interest isn't counted."
      : `${n} cards have no rate on file, so their interest isn't counted.`;

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</p>
      <p className="text-[13px] text-slate-600 dark:text-slate-300 mt-1">
        Add them once and the plan can count every pound of interest.
      </p>
      <button
        onClick={onAddRates}
        className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Add rates
      </button>
    </div>
  );
}

// ── Penny insight block ───────────────────────────────────────────────────────

function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

function PennyInsight({
  plan,
  hide,
  onAddRates,
  onOpenCard,
}: {
  plan: DebtPlanView;
  hide: boolean;
  onAddRates: () => void;
  onOpenCard: (accountId: string) => void;
}) {
  const narration = plan.narration;
  if (!narration?.text) return null;

  const text = hide ? maskAmounts(narration.text) : narration.text;
  const hasMissingRates = plan.cards.some(c => c.flags.terms_missing && c.debt > 0);
  const ask = narration.ask ?? null;

  return (
    <section className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        >
          <PennyMark size={11} />
          Penny
        </span>
      </div>
      <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 max-w-prose">
        <MoneyText text={text} />
      </p>
      {ask ? (
        <button
          onClick={() => onOpenCard(ask.account_id)}
          className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {ask.kind === "usage" ? "How I use this card" : "Add the deal"}
        </button>
      ) : hasMissingRates ? (
        <button
          onClick={onAddRates}
          className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-95 transition-[transform,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Add rates
        </button>
      ) : null}
    </section>
  );
}

// ── Trajectory blocks: AS IT STANDS (monthly bleed) + DEAREST CARD FIRST ──────
// One stated comparison window; every figure reconcilable by subtraction.
// No horizon-capped interest integrals anywhere.

function TrajectoryBlocks({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  const { scenario_b, totals, cards } = plan;
  const nc = totals.nonclearing;

  const showAsItStands = totals.monthly_interest_now >= 1 || (nc.count > 0 && nc.monthly_interest_share >= 1) || totals.potential_monthly_interest >= 1;

  const sb = "note" in scenario_b ? null : scenario_b;
  const showDearest =
    sb != null &&
    sb.debt_free_month != null &&
    sb.interest_saved != null && sb.interest_saved >= 50;

  if (!showAsItStands && !showDearest) return null;

  const pool = Math.round(
    cards
      .filter(c => c.debt > 0 && c.movement.monthly != null && c.movement.monthly! > 0)
      .reduce((sum, c) => sum + c.movement.monthly!, 0)
  );
  const poolStr = hide ? "••••" : "£" + pool.toLocaleString("en-GB");

  // Dearest-card-first sentence — one window (the scenario's own payoff month)
  let dearestSentence: React.ReactNode = null;
  if (sb != null && sb.debt_free_month != null) {
    const clearsWhat = sb.covers_all_debt ? "everything" : "every card you’re paying down";
    const byMonth = fmtMonth(sb.debt_free_month);
    if (!sb.as_is_clears && sb.as_is_interest_over_window != null) {
      const k = sb.pooled_nonclearing_count;
      const dontClear =
        k === sb.pooled_count
          ? "none of those cards clear at all"
          : k === 1
          ? "1 of those cards doesn’t clear at all"
          : `${k} of those cards don’t clear at all`;
      dearestSentence = (
        <>
          <MoneyText text={`Same ${poolStr} a month, dearest card first, clears ${clearsWhat} by `} />
          <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{byMonth}</span>
          <MoneyText text={` with ${fmtMoney(sb.total_interest, hide)} interest. As it stands, ${dontClear}; by ${byMonth} they’d have cost ${fmtMoney(sb.as_is_interest_over_window, hide)}.`} />
        </>
      );
    } else if (sb.as_is_clears && sb.as_is_interest_over_window != null) {
      const soonerClause =
        sb.months_sooner != null && sb.months_sooner > 0
          ? `, ${sb.months_sooner} months sooner than your current pace${sb.as_is_debt_free_month ? ` (${fmtMonth(sb.as_is_debt_free_month)})` : ""}`
          : "";
      dearestSentence = (
        <>
          <MoneyText text={`Same ${poolStr} a month, dearest card first, clears ${clearsWhat} by `} />
          <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{byMonth}</span>
          <MoneyText text={` with ${fmtMoney(sb.total_interest, hide)} interest${soonerClause}. As it stands the same cards would have cost ${fmtMoney(sb.as_is_interest_over_window, hide)} by ${byMonth}.`} />
        </>
      );
    }
  }

  return (
    <div className="space-y-3">
      {showAsItStands && (
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300">
            As it stands
          </p>
          {totals.monthly_interest_now >= 1 ? (
            <>
              <p className="mt-1">
                <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                  {fmtMoney(totals.monthly_interest_now, hide)}
                </span>{" "}
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  a month in interest right now
                </span>
              </p>
              {nc.count > 0 && nc.monthly_interest_share >= 1 && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mt-2">
                  <span className="font-mono tabular-nums">{fmtMoney(nc.monthly_interest_share, hide)}</span> of that is on {nc.count}{" "}
                  {nc.count === 1 ? "card that isn’t" : "cards that aren’t"} clearing at your pace.
                </p>
              )}
              {totals.interest_to_clear >= 1 && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mt-1">
                  <span className="font-mono tabular-nums">{fmtMoney(totals.interest_to_clear, hide)}</span> to clear{" "}
                  {nc.count > 0 ? "the rest" : "them at your pace"}.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 mt-2">
                No interest is hitting your cards right now.
              </p>
              {totals.potential_monthly_interest >= 1 && (
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mt-1">
                  If these balances ran past their 0% windows at the rates on file, they&apos;d cost about{" "}
                  <span className="font-mono tabular-nums">{fmtMoney(totals.potential_monthly_interest, hide)}</span> a month.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {showDearest && sb != null && (
        <div className="glass-card rounded-2xl p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300">
            Dearest card first
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            {dearestSentence}
          </p>
          {sb.interest_saved != null && sb.interest_saved >= 1 && (
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              That&apos;s{" "}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                {fmtMoney(sb.interest_saved, hide)}
              </span>{" "}
              less interest.
            </p>
          )}
          {plan.history?.rising && (
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              Your carried debt has risen <span className="font-mono tabular-nums">{fmtMoney(plan.history.trend_3m, hide)}</span> over the last three months.
            </p>
          )}
          {sb.assumption && (
            <p className="text-[12px] text-slate-600 dark:text-slate-300 italic">{sb.assumption}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Rate pill for a card ──────────────────────────────────────────────────────

function RatePill({
  card,
  onClick,
}: {
  card: DebtPlanViewCard;
  onClick: () => void;
}) {
  const seg = card.rate_schedule[0];

  if (card.flags.terms_missing || !seg) {
    return (
      <button
        onClick={onClick}
        aria-label={`Add rate for ${card.name}`}
        className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
      >
        Add rate
      </button>
    );
  }

  if (seg.source === "promo") {
    const cliff = seg.until ? isCliff(seg.until) : false;
    const label = seg.until
      ? `${seg.apr_pct ?? 0}% until ${fmtMonth(seg.until)}`
      : `${seg.apr_pct ?? 0}%`;

    if (cliff) {
      return (
        <button
          onClick={onClick}
          aria-label={`Edit rate for ${card.name}: ${label}, ending soon`}
          className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
        >
          {label}
        </button>
      );
    }

    return (
      <button
        onClick={onClick}
        aria-label={`Edit rate for ${card.name}: ${label}`}
        className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
      >
        {label}
      </button>
    );
  }

  // standard or unknown
  const rateLabel = seg.apr_pct != null ? `${seg.apr_pct}%` : "Rate on file";
  return (
    <button
      onClick={onClick}
      aria-label={`Edit rate for ${card.name}: ${rateLabel}`}
      className="rounded-full text-[12px] font-semibold px-2.5 py-2 border active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
    >
      {rateLabel}
    </button>
  );
}

// ── Per-card section ──────────────────────────────────────────────────────────

function CardRows({
  cards,
  hide,
  onOpenSheet,
}: {
  cards: DebtPlanViewCard[];
  hide: boolean;
  onOpenSheet: (accountId: string) => void;
}) {
  return (
    <div>
      <WhisperLabel>THE CARDS</WhisperLabel>
      <div className="glass-card rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/60">
        {cards.map(card => {
          const chip = resolveBankChip(card.provider);
          const isCleared = card.classification === "cleared_monthly";

          // Movement line (only for non-cleared cards)
          const hasMovement = !isCleared && card.movement.monthly != null && card.movement.monthly > 1;
          const projectedFlat = !isCleared && !hasMovement
            ? (card.flags.assumptions ?? []).find(a => a.includes("projected flat"))
            : undefined;

          return (
            <div key={card.account_id} className="p-4 space-y-2">
              {/* Line 1: badge + name + debt */}
              <div className="flex items-center gap-3">
                <BankBadge
                  logoSrc={chip.logoSrc}
                  initials={chip.initials}
                  initialsSize={chip.initialsSize}
                  altText={chip.label}
                  brandBg={chip.bg}
                />
                <p className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{card.name}</p>
                <p className="text-base font-bold text-slate-900 dark:text-slate-100 flex-shrink-0 font-mono tabular-nums">
                  {card.debt === 0 ? "£0" : fmtMoney(card.debt, hide)}
                </p>
              </div>

              {/* Line 2: rate pill */}
              <RatePill card={card} onClick={() => onOpenSheet(card.account_id)} />

              {isCleared ? (
                /* Cleared-monthly: no movement, no payoff projection */
                <p className="text-[13px] text-slate-600 dark:text-slate-300">
                  Cleared monthly: this is spending, not carried debt.
                </p>
              ) : (
                <>
                  {/* Line 3: movement */}
                  {hasMovement && (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      <span className="font-mono tabular-nums">+{fmtMoney(card.movement.monthly!, hide)}/mo</span> at your pace
                    </p>
                  )}
                  {!hasMovement && projectedFlat && (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">{projectedFlat}</p>
                  )}

                  {/* Line 4: payoff */}
                  {card.payoff_month && (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      Clears {fmtMonth(card.payoff_month)}
                      {card.total_interest != null && card.total_interest >= 1 && (
                        <> · <span className="font-mono tabular-nums">{fmtMoney(card.total_interest, hide)}</span> interest</>
                      )}
                    </p>
                  )}
                  {!card.payoff_month && card.debt > 0 && card.monthly_interest_now >= 1 && (
                    <p className="text-[13px] text-slate-600 dark:text-slate-300">
                      Not clearing at your pace · <span className="font-mono tabular-nums">{fmtMoney(card.monthly_interest_now, hide)}/mo</span> interest right now
                    </p>
                  )}
                </>
              )}

              {/* Usage conflict flag — amber dot signifier, slate text, calm not red */}
              {card.usage_conflict && (
                <p className="flex items-start gap-1.5 text-[13px] text-slate-600 dark:text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500" aria-hidden="true" />
                  <span>You said you clear this monthly, but interest charges are appearing, worth a look.</span>
                </p>
              )}

              {/* Muted note: payment already tracked in upcoming bills */}
              {card.near_term_source === "upcoming bills" && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Its usual payment is already in your upcoming bills
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transfer routes section ───────────────────────────────────────────────────

function TransferRoutes({ plan, hide }: { plan: DebtPlanView; hide: boolean }) {
  if (!plan.refinance_options || plan.refinance_options.length === 0) return null;

  return (
    <div className="space-y-3">
      <WhisperLabel>TRANSFER ROUTES</WhisperLabel>
      {plan.refinance_options.map((opt, i) => {
        // Find source card's standard rate
        const srcCard = plan.cards.find(c => c.account_id === opt.source_account_id);
        const stdSeg = srcCard?.rate_schedule.find(s => s.source === "standard");
        const rateParenthetical = stdSeg?.apr_pct != null ? ` (${stdSeg.apr_pct}%)` : "";
        const monthly = opt.window_months > 0 ? Math.round(opt.interest_saved / opt.window_months) : 0;

        return (
          <div key={i} className="glass-card rounded-2xl p-4">
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              Moving <span className="font-mono tabular-nums">{fmtMoney(opt.transferable, hide)}</span> from {opt.source_name}{rateParenthetical} to{" "}
              {opt.destination_name}&apos;s offer: <span className="font-mono tabular-nums">{fmtMoney(opt.fee, hide)}</span> fee once instead of{" "}
              <span className="font-mono tabular-nums">~{fmtMoney(monthly, hide)}</span> interest a month.
              {opt.break_even_weeks != null && ` Break-even in ${opt.break_even_weeks} weeks.`}
            </p>
            {opt.assumptions.length > 0 && (
              <p className="text-[12px] text-slate-600 dark:text-slate-300 italic mt-2">
                {opt.assumptions.join(" · ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DebtPlanPage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();

  // ALL state hooks before any conditional logic
  const [plan, setPlan] = useState<DebtPlanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [cardTermsCards, setCardTermsCards] = useState<CardTermsCard[]>([]);
  const [cardTermsReady, setCardTermsReady] = useState(false);
  const [cardTermsOpen, setCardTermsOpen] = useState(false);
  const [cardTermsStartId, setCardTermsStartId] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    try {
      const data = await api.getDebtPlanView();
      setPlan(data);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCardTerms = useCallback(() => {
    api.getCardTerms()
      .then(r => { setCardTermsCards(r.cards); setCardTermsReady(true); })
      .catch(() => setCardTermsReady(true));
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);
  useEffect(() => { loadCardTerms(); }, [loadCardTerms]);

  function openSheet(accountId: string | null) {
    setCardTermsStartId(accountId);
    setCardTermsOpen(true);
  }

  function handleSaved() {
    loadCardTerms();
    loadPlan();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const showMissingRates = plan != null && plan.cards.some(c => c.flags.terms_missing && c.debt > 0);
  const showTwoTrajectory = plan != null && (
    plan.totals.monthly_interest_now >= 1 ||
    (plan.totals.nonclearing.count > 0 && plan.totals.nonclearing.monthly_interest_share >= 1) ||
    plan.totals.potential_monthly_interest >= 1 ||
    (!("note" in plan.scenario_b) &&
      plan.scenario_b.debt_free_month != null &&
      (plan.scenario_b.interest_saved ?? 0) >= 50)
  );
  const showTransferRoutes = (plan?.refinance_options?.length ?? 0) > 0;

  const showAgency = plan != null && (
    (plan.extra_to_clear != null) ||
    ((plan.whats_working?.length ?? 0) > 0)
  );

  const showPennyInsight = plan != null && !!plan.narration?.text;

  // Sequential rise-in indices over visible sections (computed once, stable)
  let riseIdx = 1; // verdict always 1
  const riseVerdictIdx = riseIdx++;
  const risePennyInsightIdx = showPennyInsight ? riseIdx++ : 0;
  const riseAgencyIdx = showAgency ? riseIdx++ : 0;
  const riseMissingRatesIdx = showMissingRates ? riseIdx++ : 0;
  const riseTwoTrajectoryIdx = showTwoTrajectory ? riseIdx++ : 0;
  const riseCardRowsIdx = riseIdx++;
  const riseTransferRoutesIdx = showTransferRoutes ? riseIdx++ : 0;

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto">
        {/* Back nav */}
        <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
          <button
            onClick={() => goBack(router)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 active:opacity-70 transition-[transform,opacity] mb-5"
          >
            <ChevronLeft size={15} />
            Back
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : fetchError || !plan ? (
          <div className="rise-in glass-card rounded-2xl p-5" style={{ "--rise-index": 1 } as React.CSSProperties}>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              The plan couldn&apos;t load, pull back and try again.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Verdict — always visible */}
            <div className="rise-in" style={{ "--rise-index": riseVerdictIdx } as React.CSSProperties}>
              <VerdictBlock plan={plan} hide={hideNetWorth} />
            </div>

            {/* Penny insight */}
            {showPennyInsight && (
              <div className="rise-in" style={{ "--rise-index": risePennyInsightIdx } as React.CSSProperties}>
                <PennyInsight plan={plan} hide={hideNetWorth} onAddRates={() => openSheet(null)} onOpenCard={id => openSheet(id)} />
              </div>
            )}

            {/* Agency block — "what it would take" */}
            {showAgency && (
              <div className="rise-in" style={{ "--rise-index": riseAgencyIdx } as React.CSSProperties}>
                <AgencyBlock plan={plan} hide={hideNetWorth} />
              </div>
            )}

            {/* Missing-rates callout */}
            {showMissingRates && (
              <div className="rise-in" style={{ "--rise-index": riseMissingRatesIdx } as React.CSSProperties}>
                <MissingRatesCallout
                  plan={plan}
                  onAddRates={() => openSheet(null)}
                />
              </div>
            )}

            {/* Trajectory blocks: monthly bleed + dearest-card-first comparison */}
            {showTwoTrajectory && (
              <div className="rise-in" style={{ "--rise-index": riseTwoTrajectoryIdx } as React.CSSProperties}>
                <TrajectoryBlocks plan={plan} hide={hideNetWorth} />
              </div>
            )}

            {/* Per-card rows — always visible */}
            <div className="rise-in" style={{ "--rise-index": riseCardRowsIdx } as React.CSSProperties}>
              <CardRows
                cards={plan.cards}
                hide={hideNetWorth}
                onOpenSheet={openSheet}
              />
            </div>

            {/* Transfer routes */}
            {showTransferRoutes && (
              <div className="rise-in" style={{ "--rise-index": riseTransferRoutesIdx } as React.CSSProperties}>
                <TransferRoutes plan={plan} hide={hideNetWorth} />
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />

      {cardTermsOpen && (
        <CardTermsSheet
          cards={cardTermsCards}
          ready={cardTermsReady}
          startAccountId={cardTermsStartId}
          onClose={() => { setCardTermsOpen(false); setCardTermsStartId(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
