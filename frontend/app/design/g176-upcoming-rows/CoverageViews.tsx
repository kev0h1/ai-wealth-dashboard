"use client";

import { ChevronDown } from "lucide-react";
import { BANK_META, BankBadge, bankLogoSrc } from "@/components/AccountMiniCard";
import UpcomingDayCard from "@/components/upcoming/UpcomingDayCard";
import UpcomingRow from "@/components/upcoming/UpcomingRow";
import { DAYS, type AccountForecast, type Forecast, type ForecastPayment, money } from "./fixtures";

function AccountMark({ account }: { account: AccountForecast }) {
  const meta = BANK_META[account.account.bankKey];

  return (
    <BankBadge
      logoSrc={bankLogoSrc(meta)}
      initials={meta?.initials ?? account.account.name.slice(0, 2).toUpperCase()}
      initialsSize={meta?.initialsSize}
      altText={`${account.account.name} logo`}
      brandBg={meta?.bg}
      size={32}
    />
  );
}

function AccountResult({ account, optionalMoves }: { account: AccountForecast; optionalMoves: boolean }) {
  if (account.shortfall > 0) {
    return <><span className="font-mono tabular-nums">{money(account.shortfall)}</span> {optionalMoves ? "unfunded" : "short"}</>;
  }

  return <><span className="font-mono tabular-nums">{money(account.closing)}</span> left</>;
}

function paymentLabel(forecast: Forecast) {
  return forecast.optionalMoves ? "Moves" : "Payments";
}

function AccountBars({ account, scale, optionalMoves }: { account: AccountForecast; scale: number; optionalMoves: boolean }) {
  const cashWidth = (account.opening / scale) * 100;
  const covered = Math.min(account.opening, account.outgoing);
  const coveredWidth = (covered / scale) * 100;
  const missingWidth = (Math.max(0, account.outgoing - account.opening) / scale) * 100;
  const missingTone = optionalMoves ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="mb-2 mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_4rem] items-center gap-2">
        <span>Cash</span>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${cashWidth}%` }} /></div>
        <span className="text-right font-mono tabular-nums">{money(account.opening)}</span>
      </div>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_4rem] items-center gap-2">
        <span>{optionalMoves ? "Moves" : "Due"}</span>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true">
          <span className="h-full bg-slate-400 dark:bg-slate-500" style={{ width: `${coveredWidth}%` }} />
          <span className={`h-full ${missingTone}`} style={{ width: `${missingWidth}%` }} />
        </div>
        <span className="text-right font-mono tabular-nums">{money(account.outgoing)}</span>
      </div>
    </div>
  );
}

export function AccountOverview({
  forecast,
  visual,
  onAccount,
}: {
  forecast: Forecast;
  visual: boolean;
  onAccount: (account: AccountForecast) => void;
}) {
  const scale = Math.max(1, ...forecast.accounts.flatMap((account) => [account.opening, account.outgoing]));
  const label = paymentLabel(forecast);

  return (
    <section aria-labelledby="account-coverage-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="px-4 pb-3 pt-4">
        <h2 id="account-coverage-heading" className="text-base font-bold text-slate-950 dark:text-slate-50">By account</h2>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{label} through Wed 30 Sept</p>
      </div>
      <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
        {forecast.accounts.map((account) => (
          <div key={account.account.id} className="px-4 py-2">
            <button
              type="button"
              onClick={() => onAccount(account)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg text-left hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/50"
              aria-label={`Open ${account.account.name}: ${money(account.opening)} cash, ${money(account.outgoing)} ${label.toLowerCase()}, ${account.shortfall > 0 ? `${money(account.shortfall)} ${forecast.optionalMoves ? "unfunded" : "short"}` : `${money(account.closing)} left`}`}
            >
              <span className="w-8 shrink-0"><AccountMark account={account} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{account.account.name}</span>
                <span className="block text-xs text-slate-600 dark:text-slate-400">{account.account.detail}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-right text-xs font-semibold text-slate-700 dark:text-slate-200">
                {account.shortfall > 0 && <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${forecast.optionalMoves ? "bg-amber-500" : "bg-rose-500"}`} />}
                <span><AccountResult account={account} optionalMoves={forecast.optionalMoves} /></span>
              </span>
            </button>
            {visual && <AccountBars account={account} scale={scale} optionalMoves={forecast.optionalMoves} />}
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 pt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{visual ? "Bars use the same scale. Coloured ends show the gap. " : ""}Tap an account for its working.</p>
    </section>
  );
}

function PaymentRow({ payment, onPayment, hideAccountLabel = false }: { payment: ForecastPayment; onPayment: (payment: ForecastPayment) => void; hideAccountLabel?: boolean }) {
  return (
    <UpcomingRow
      key={payment.id}
      model={payment.model}
      treatment="account-coverage"
      hideAccountLabel={hideAccountLabel}
      onOpen={() => onPayment(payment)}
      onDismiss={() => {}}
    />
  );
}

function AccountDayGroup({
  account,
  payments,
  dayLabel,
  onAccount,
  onPayment,
}: {
  account: AccountForecast;
  payments: ForecastPayment[];
  dayLabel: string;
  onAccount: (account: AccountForecast) => void;
  onPayment: (payment: ForecastPayment) => void;
}) {
  const closing = payments[payments.length - 1]?.after ?? account.closing;
  const optionalMoves = payments.some((payment) => payment.optionalMove);
  const status = optionalMoves ? "unfunded" : "short";
  const amount = closing < 0 ? `${money(Math.abs(closing))} ${status}` : `${money(closing)} left`;

  return (
    <div>
      <button
        type="button"
        onClick={() => onAccount(account)}
        className="flex min-h-11 w-full items-center gap-2.5 bg-slate-50 px-4 py-2 text-left hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:bg-slate-900/40 dark:hover:bg-slate-700"
        aria-label={`Open ${account.account.name}, ${amount} after ${dayLabel.toLowerCase()}`}
      >
        <span className="w-8 shrink-0"><AccountMark account={account} /></span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{account.account.name}</span>
        <span className="shrink-0 text-right">
          <span className="block text-xs text-slate-600 dark:text-slate-400">After {dayLabel.toLowerCase()}</span>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200"><span className="font-mono tabular-nums">{closing < 0 ? money(Math.abs(closing)) : money(closing)}</span> {closing < 0 ? status : "left"}</span>
        </span>
      </button>
      <div className="divide-y divide-slate-100 dark:divide-slate-700">
        {payments.map((payment) => <PaymentRow key={payment.id} payment={payment} onPayment={onPayment} hideAccountLabel />)}
      </div>
    </div>
  );
}

export function DayGroups({
  forecast,
  variant,
  onPayment,
  onAccount,
}: {
  forecast: Forecast;
  variant: "a" | "b" | "c";
  onPayment: (payment: ForecastPayment) => void;
  onAccount: (account: AccountForecast) => void;
}) {
  return (
    <div className="space-y-4">
      {DAYS.map((day) => {
        const payments = forecast.payments.filter((payment) => payment.date === day.date);
        if (payments.length === 0) return null;

        let activeRows: React.ReactNode[];
        if (variant === "a") {
          activeRows = forecast.accounts.flatMap((account) => {
            const accountPayments = payments.filter((payment) => payment.accountId === account.account.id);
            return accountPayments.length > 0
              ? [<AccountDayGroup key={account.account.id} account={account} payments={accountPayments} dayLabel={day.heading.startsWith("Today") ? "today" : "tomorrow"} onAccount={onAccount} onPayment={onPayment} />]
              : [];
          });
        } else if (variant === "b") {
          activeRows = payments.map((payment) => <PaymentRow key={payment.id} payment={payment} onPayment={onPayment} />);
        } else {
          const visiblePayments = payments.filter((payment) => payment.shortfall > 0);
          const coveredPayments = payments.filter((payment) => payment.shortfall <= 0);
          activeRows = [
            ...visiblePayments.map((payment) => <PaymentRow key={payment.id} payment={payment} onPayment={onPayment} />),
            ...(coveredPayments.length > 0 ? [
              <details key="covered" className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-700 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">{coveredPayments.length} covered {forecast.optionalMoves ? (coveredPayments.length === 1 ? "move" : "moves") : (coveredPayments.length === 1 ? "payment" : "payments")} · <span className="font-mono tabular-nums">{money(coveredPayments.reduce((sum, payment) => sum + payment.pence, 0))}</span></span>
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span>
                  <ChevronDown size={15} className="shrink-0 transition-transform motion-reduce:transition-none group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
                  {coveredPayments.map((payment) => <PaymentRow key={payment.id} payment={payment} onPayment={onPayment} />)}
                </div>
              </details>,
            ] : []),
          ];
        }

        return <UpcomingDayCard key={day.date} dayKeyIso={day.date} heading={day.heading} activeRows={activeRows} settlingRows={[]} />;
      })}
    </div>
  );
}
