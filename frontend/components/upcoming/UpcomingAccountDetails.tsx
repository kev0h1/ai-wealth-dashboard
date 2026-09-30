import type { UpcomingAccountEvent, UpcomingAccountSummary } from "@/lib/upcomingAccounts";

export interface UpcomingAccountDetailsProps {
  account: UpcomingAccountSummary;
  periodLabel: string;
}

function money(value: number, showPositiveSign = false) {
  return `${value < 0 ? "−" : showPositiveSign ? "+" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function LedgerLine({ label, value, total = false, showPositiveSign = false }: { label: string; value: number; total?: boolean; showPositiveSign?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 ${total ? "border-t border-slate-200 pt-3 font-semibold dark:border-slate-700" : ""}`}>
    <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
    <dd className="shrink-0 font-mono tabular-nums text-slate-900 dark:text-slate-100">{money(value, showPositiveSign)}</dd>
  </div>;
}

function EventLine({ event }: { event: UpcomingAccountEvent }) {
  return <li className="flex items-baseline justify-between gap-4 py-3">
    <span className="min-w-0"><span className="block break-words text-sm text-slate-800 dark:text-slate-100">{event.name}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{dateLabel(event.date)}</span></span>
    <span className="shrink-0 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100">{Number.isFinite(event.amount) ? money(event.amount, true) : "Amount unavailable"}</span>
  </li>;
}

/** Detail content for the shared Upcoming detail sheet. Values arrive precomputed. */
export default function UpcomingAccountDetails({ account, periodLabel }: UpcomingAccountDetailsProps) {
  if (account.status === "unknown" || account.opening === null || account.closing === null || account.shortfall === null) {
    return <div className="space-y-5">
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">Coverage unavailable for this account.</p>
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">We could not verify the opening balance or where every incoming payment is due. This account is not shown as covered.</p>
      {account.events.length > 0 && <section aria-labelledby="account-events-heading">
        <h3 id="account-events-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Expected activity</h3>
        <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">{account.events.map((event) => <EventLine key={event.id} event={event} />)}</ul>
      </section>}
    </div>;
  }

  return <div className="space-y-5">
    <dl className="space-y-3 text-sm">
      <LedgerLine label="Cash now" value={account.opening} />
      {account.income > 0 && <LedgerLine label="Expected income" value={account.income} showPositiveSign />}
      {account.transfersIn > 0 && <LedgerLine label="Transfers in" value={account.transfersIn} showPositiveSign />}
      <LedgerLine label="Payments to come" value={-account.outgoing} />
      <LedgerLine label="Expected balance" value={account.closing} total />
    </dl>

    {account.status === "short" && account.firstShortDate && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Up to <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{money(account.shortfall)}</span> is needed to cover these payments. The first shortfall is on {dateLabel(account.firstShortDate)}. Money arriving later cannot fund a payment that leaves first.</p>}
    {account.status === "unfunded" && <p className="flex items-start gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" />A planned move is not fully funded at the time it leaves. It may stay put, with no fee.</p>}

    {account.hasUnassignedIncome && <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Income without a confirmed destination is not included in this account’s working.</p>}

    <section aria-labelledby="account-events-heading">
      <h3 id="account-events-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Expected activity</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{periodLabel}</p>
      <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">{account.events.map((event) => <EventLine key={event.id} event={event} />)}</ul>
    </section>
  </div>;
}
