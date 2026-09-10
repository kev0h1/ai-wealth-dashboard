"use client";

import { AlertCircle, AlertTriangle, ArrowRight, ChevronDown, CreditCard, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { SafeToSpend } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";

interface SafeToSpendCardProps {
  data: SafeToSpend | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

function zeroSafe(value: number): number {
  return Math.abs(value) < 1 ? 0 : value;
}

function fmt(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function listPhrase(items: string[]): string {
  if (items.length === 0) return "the cash forecast";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function dateLabel(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const day = new Date(`${isoString.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(day.getTime())) return null;
  return day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function CalculationRow({
  operator,
  label,
  value,
  spokenValue,
  detail,
  total = false,
  risk = false,
}: {
  operator: "" | "+" | "−" | "→" | "=";
  label: string;
  value: string;
  spokenValue?: string;
  detail?: string;
  total?: boolean;
  risk?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2 py-2.5 ${total ? "mt-1 border-t border-slate-300 pt-3.5 dark:border-slate-600" : "border-b border-slate-100 last:border-b-0 dark:border-white/[0.07]"}`}>
      <span className={`money pt-px text-xs font-semibold ${total ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} aria-hidden="true">{operator}</span>
      <div className="min-w-0">
        <dt className={`${total ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-200"} text-[13px] leading-snug`}>{label}</dt>
        {detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{detail}</p>}
      </div>
      <dd aria-label={spokenValue} className={`money shrink-0 text-sm font-semibold ${risk ? "text-red-600 dark:text-red-400" : total ? "text-slate-950 dark:text-white" : "text-slate-800 dark:text-slate-100"}`}>{value}</dd>
    </div>
  );
}

function CardBalanceFact({
  growth,
  newSpend,
  reserve,
  finalPosition,
  wording,
  dueDate,
  amount,
}: {
  growth: number;
  newSpend: number;
  reserve: number;
  finalPosition: number;
  wording: "carried" | "cleared_monthly" | null | undefined;
  dueDate: string | null;
  amount: (value: number) => string;
}) {
  const hasUnconfirmedReserve = reserve > 0;
  const due = dateLabel(dueDate);
  // G24: while a card repayment is unconfirmed, the reserve maths (and the
  // "held back" sentence below) is about real debt owed, so the headline
  // stays the TRUE balance change — showing spend-only here could make the
  // reserve look bigger than the figure it's held back from, which reads as
  // broken and, worse, understates the risk. Once there's nothing
  // unconfirmed, there's no safety story left to tell and the headline can
  // show what Kevin actually asked Home to lead with: new spend only,
  // because a balance transfer is deliberate debt-shuffling, not spending.
  const headline = hasUnconfirmedReserve ? growth : newSpend;

  return (
    <aside className={`mt-5 rounded-2xl border px-3.5 py-3.5 ${hasUnconfirmedReserve ? "border-amber-200/80 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-400/[0.04]" : "border-slate-200/80 bg-slate-50/80 dark:border-white/[0.08] dark:bg-white/[0.035]"}`} aria-label="Card balance activity">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${hasUnconfirmedReserve ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/10"}`}>
          <CreditCard size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.075em] text-slate-500 dark:text-slate-400">{hasUnconfirmedReserve ? "Card balances this pay period" : "Went on cards this pay period"}</p>
            <p aria-label={`${hasUnconfirmedReserve ? "increase of" : "spent"} ${amount(headline)}`} className="money shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">+{amount(headline)}</p>
          </div>

          {hasUnconfirmedReserve ? (
            <>
              <div className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/12 dark:text-amber-200">
                <AlertCircle size={13} aria-hidden="true" />
                Repayment not confirmed
              </div>
              <p className="mt-2 text-[13px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
                <MoneyText text={`${amount(reserve)} of this is held back because its repayment has not been identified.`} />
              </p>
              {finalPosition < 0 && (
                <p className="mt-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                  <MoneyText text={`That leaves a ${amount(Math.abs(finalPosition))} safety shortfall.`} />
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
                {wording === "cleared_monthly" && due
                  ? `Due around ${due}. It is not deducted from today’s cash figure.`
                  : wording === "cleared_monthly"
                    ? "Its repayment is forecast separately. It is not deducted from today’s cash figure."
                    : "This added to your card balances this pay period. It is not deducted from the cash above."}
              </p>
              <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">Purchases only. Balance transfers and repayments are not counted here.</p>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function SafeToSpendCard({ data, loading, error, onRetry }: SafeToSpendCardProps) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const router = useRouter();
  const hidden = hideNetWorth || !preferencesReady;

  if (loading && !data) {
    return (
      <div className="rounded-3xl p-5 glass-hero" aria-busy="true" aria-label="Loading Safe to Spend">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <div className="mb-3 h-6 w-56 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-unavailable">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <h2 id="safe-to-spend-unavailable" className="text-base font-bold text-slate-900 dark:text-slate-100">Your Safe to Spend figure is unavailable</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">Your accounts may still be visible, but we can&apos;t safely calculate what is free until payday.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Try again</button>}
      </section>
    );
  }

  if (!data || data.status === "insufficient_data") {
    const unsupported = data?.calculation_status === "unsupported";
    return (
      <section className="rounded-3xl p-5 glass-hero" aria-labelledby="safe-to-spend-history">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <h2 id="safe-to-spend-history" className="text-base font-bold text-slate-900 dark:text-slate-100">{unsupported ? "Safe to Spend isn’t available for these accounts yet" : "Your figure isn’t ready yet"}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">{unsupported ? "We won’t show a spending figure until this account and currency setup can be calculated safely." : "We need a little more account history to map bills and work out what is safe until payday."}</p>
        {onRetry && !unsupported && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Check again</button>}
      </section>
    );
  }

  if (data.calculation_status === "degraded") {
    return (
      <section className="rounded-3xl p-5 glass-hero" role="alert" aria-labelledby="safe-to-spend-incomplete">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <h2 id="safe-to-spend-incomplete" className="text-base font-bold text-slate-900 dark:text-slate-100">We couldn&apos;t verify every set-aside</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 text-pretty">We&apos;re withholding the figure rather than risk showing more money as available than is actually safe.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Try again</button>}
      </section>
    );
  }

  const freeAmount = zeroSafe(data.safe_to_spend);
  const cashRunway = data.safe_to_spend_cash == null ? freeAmount : zeroSafe(data.safe_to_spend_cash);
  const exactCashRunway = data.safe_to_spend_cash ?? data.safe_to_spend;
  const exactLowestProjected = data.lowest_projected_balance ?? null;
  const cardGrowth = zeroSafe(data.card_growth_total ?? 0);
  const cardNewSpend = zeroSafe(data.card_new_spend_total ?? 0);
  const cardReserve = zeroSafe(data.card_growth_reserved ?? 0);
  const isCardsUnconfirmedShort = data.state === "short" && data.short_reason === "cards_unconfirmed";
  const state: "comfortable" | "tight" | "short" = data.state === "short" && !data.short_reason && freeAmount > -1 ? "comfortable" : data.state;

  const amount = (value: number) => hidden ? "£••••" : fmt(value);
  const exactAmount = (value: number) => hidden ? "£••••" : fmt2(value);
  const signedExactAmount = (value: number) => hidden
    ? `${value < 0 ? "−" : "+"}£••••`
    : `${value < 0 ? "−" : "+"}${fmt2(value)}`;

  const paydayDate = new Date(data.next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - today.getTime()) / 86400000);
  const paydayLabel = daysAway <= 0 ? "today" : daysAway === 1 ? "tomorrow" : daysAway < 7
    ? new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const StateIcon = state === "comfortable" ? ShieldCheck : state === "tight" || isCardsUnconfirmedShort ? AlertCircle : AlertTriangle;
  const stateLabel = state === "comfortable" ? "On track" : state === "tight" ? "Tight" : isCardsUnconfirmedShort ? "Check card bill" : "Short";
  const stateChipClass = state === "comfortable"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
    : state === "tight" || isCardsUnconfirmedShort
      ? "bg-slate-100 text-amber-800 dark:bg-slate-700/70 dark:text-amber-200"
      : "bg-slate-100 text-red-700 dark:bg-slate-700/70 dark:text-red-300";
  const figureClass = state === "comfortable"
    ? "text-emerald-700 dark:text-emerald-300"
    : state === "short" && !isCardsUnconfirmedShort
      ? "text-red-600 dark:text-red-400"
      : "text-slate-900 dark:text-slate-100";

  const heroAmount = state === "short"
    ? isCardsUnconfirmedShort ? 0 : Math.abs(cashRunway)
    : freeAmount;
  const heroCaption = state === "short" && !isCardsUnconfirmedShort
    ? "short before payday"
    : `available in cash until ${paydayLabel}`;

  const calculationItems = [
    { label: "Plans reserved", shortLabel: "plans", value: data.commitments_reserved ?? 0 },
    { label: "Envelopes reserved", shortLabel: "envelopes", value: data.allocations_reserved ?? 0 },
  ].filter((item) => item.value > 0);
  const contextParts = [
    data.bills_total > 0 ? "upcoming bills" : "the cash forecast",
    ...calculationItems.map((item) => item.shortLabel),
    ...(data.buffer > 0 ? [`your ${amount(data.buffer)} buffer`] : []),
  ];
  const heroContext = isCardsUnconfirmedShort
    ? `The cash forecast found ${amount(cashRunway)}, then held back ${amount(cardReserve)} for an unconfirmed card repayment.`
    : `After ${listPhrase(contextParts)}.`;

  const pace = data.pace;
  const showPace = pace != null && ["comfortable", "on_pace", "ahead", "early"].includes(pace.state) && pace.sustainable != null;
  const freshnessLabel = syncAgeLabel(data.last_synced);
  const summaryLabel = state === "short" && !isCardsUnconfirmedShort
    ? `How we got ${amount(heroAmount)} short`
    : `How we got ${amount(heroAmount)}`;
  const cashTotalLabel = exactCashRunway < 0 ? "Cash position before payday" : "Cash available until payday";
  const cashFlowDetailParts = [
    data.bills_total > 0 ? `${exactAmount(data.bills_total)} of bills` : null,
    data.income_before_payday > 0 ? `${exactAmount(data.income_before_payday)} of income` : null,
  ].filter((item): item is string => Boolean(item));
  const cashFlowDetail = cashFlowDetailParts.length > 0
    ? `After applying ${listPhrase(cashFlowDetailParts)} in date order.`
    : "After applying the dated cash forecast.";
  // Bills and income are applied in date order, so the lowest point in the
  // window is not always cash now minus the full bill total plus the full
  // income total (it can land mid-window, before every event has fired).
  // Only show the bills/income rows when that simple sum actually
  // reconciles with the server's own lowest-balance walk; otherwise fall
  // back to the prose sentence rather than display rows that do not add up.
  // Even when the rows do reconcile, the sentence stays on as a footnote
  // under the "Lowest cash before payday" row: it is what tells the reader
  // this figure is a date-ordered running minimum, not just simple
  // arithmetic on the totals above it — exactly the distinction that can
  // make the two diverge for a different payload.
  const canShowLedgerBreakdown = data.spendable_now != null && exactLowestProjected != null
    && Math.abs((data.spendable_now - data.bills_total + data.income_before_payday) - exactLowestProjected) < 0.02;
  const recovery = state === "short"
    ? isCardsUnconfirmedShort ? { label: "Review card bill", href: "/cards" } : { label: "See what’s due", href: "/upcoming" }
    : state === "tight" && (data.card_debt ?? 0) >= 1000 ? { label: "See your cards", href: "/cards" } : null;

  return (
    <section className="hero-arrive sts-card relative rounded-3xl p-5 glass-hero" aria-labelledby="safe-to-spend-heading">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${stateChipClass}`}>
          <StateIcon size={13} className="shrink-0" aria-hidden="true" />
          {stateLabel}
        </span>
      </div>

      {error && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30" role="status"><p className="text-xs text-slate-700 dark:text-slate-200">Couldn&apos;t refresh. Showing your last figure.</p>{onRetry && <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Retry</button>}</div>}

      <h2 id="safe-to-spend-heading" className="mt-5">
        <span className={`money block text-[38px] font-bold leading-none tracking-[-0.05em] ${figureClass}`}>{amount(heroAmount)}</span>
        <span className="mt-2 block text-[15px] font-semibold text-slate-700 dark:text-slate-200">
          {heroCaption}{data.estimated && <span className="font-normal text-slate-500 dark:text-slate-400"> · estimated</span>}
        </span>
      </h2>

      <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400 text-pretty"><MoneyText text={heroContext} /></p>

      {cardGrowth > 0 && (
        <CardBalanceFact
          growth={cardGrowth}
          newSpend={cardNewSpend}
          reserve={cardReserve}
          finalPosition={data.safe_to_spend}
          wording={data.card_growth_wording}
          dueDate={data.card_growth_due_date ?? null}
          amount={amount}
        />
      )}

      <div className="mt-3 border-t border-slate-100 dark:border-white/10">
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-semibold text-indigo-600 hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
            {summaryLabel}
            <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>

          <div className="pb-2 pt-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.085em] text-slate-500 dark:text-slate-400">Cash calculation</h3>
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Exact steps</span>
            </div>

            <dl className="mt-1.5">
              {data.spendable_now != null && <CalculationRow operator="+" label="Cash available now" value={exactAmount(data.spendable_now)} spokenValue={`plus ${exactAmount(data.spendable_now)}`} detail="Across included current accounts." />}
              {canShowLedgerBreakdown && data.bills_total > 0 && <CalculationRow operator="−" label="Bills before payday" value={exactAmount(data.bills_total)} spokenValue={`minus ${exactAmount(data.bills_total)}`} />}
              {canShowLedgerBreakdown && data.income_before_payday > 0 && <CalculationRow operator="+" label="Income before payday" value={exactAmount(data.income_before_payday)} spokenValue={`plus ${exactAmount(data.income_before_payday)}`} />}
              {exactLowestProjected != null && <CalculationRow operator={canShowLedgerBreakdown ? "=" : "→"} label="Lowest cash before payday" value={signedExactAmount(exactLowestProjected)} spokenValue={signedExactAmount(exactLowestProjected)} detail={cashFlowDetail} risk={exactLowestProjected < 0} />}
              {data.buffer > 0 && <CalculationRow operator="−" label="Safety buffer" value={exactAmount(data.buffer)} spokenValue={`minus ${exactAmount(data.buffer)}`} />}
              {calculationItems.map((item) => <CalculationRow key={item.label} operator="−" label={item.label} value={exactAmount(item.value)} spokenValue={`minus ${exactAmount(item.value)}`} />)}
              <CalculationRow operator="=" label={cashTotalLabel} value={signedExactAmount(exactCashRunway)} spokenValue={signedExactAmount(exactCashRunway)} total risk={exactCashRunway < 0} />
            </dl>

            {cardReserve > 0 && (
              <section className="mt-5" aria-labelledby="card-safety-check">
                <h3 id="card-safety-check" className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.085em] text-slate-600 dark:text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />Card safety check</h3>
                <dl className="mt-1.5">
                  <CalculationRow operator="+" label="From cash calculation" value={signedExactAmount(exactCashRunway)} spokenValue={signedExactAmount(exactCashRunway)} />
                  <CalculationRow operator="−" label="Unconfirmed card reserve" value={exactAmount(cardReserve)} spokenValue={`minus ${exactAmount(cardReserve)}`} detail="Held back because no repayment forecast has been learned." />
                  <CalculationRow operator="=" label="Safety position" value={signedExactAmount(data.safe_to_spend)} spokenValue={signedExactAmount(data.safe_to_spend)} detail={data.safe_to_spend < 0 ? "The amount available above cannot fall below £0, so the shortfall stays visible here." : undefined} total />
                </dl>
              </section>
            )}

            {cardGrowth > 0 && cardReserve <= 0 && (
              <p className="mt-4 border-l-2 border-slate-200 pl-3 text-[12px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 text-pretty">
                <MoneyText text={`The ${amount(cardNewSpend)} spent on cards is shown above for context. It is not part of this cash calculation.`} />
              </p>
            )}

            {(data.pooled_transfers_excluded ?? 0) > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">Transfers between your own included accounts do not change the total, so they are left out of this calculation.</p>
            )}
          </div>
        </details>
      </div>

      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-white/10">
        <p className="text-[12px] text-slate-500 dark:text-slate-400 text-pretty"><MoneyText text={showPace ? `${hidden ? "£••••" : fmt2(pace!.sustainable!)}/day until ${paydayLabel}` : `Pay period ends ${paydayLabel}`} />{(data.payday_income ?? 0) > 0 && <><span aria-hidden="true"> · </span><MoneyText text={`~${hidden ? "£••••" : fmt(data.payday_income!)} expected`} /></>}</p>
        {freshnessLabel && <p className="text-sm text-slate-500 dark:text-slate-400">{freshnessLabel}</p>}
      </div>

      {recovery && <button type="button" onClick={() => router.push(recovery.href)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-sm font-semibold text-indigo-700 transition-[transform,background-color] hover:bg-indigo-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/15">{recovery.label}<ArrowRight size={15} aria-hidden="true" /></button>}
    </section>
  );
}
