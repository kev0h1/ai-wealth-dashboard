"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Moon, Sun, X } from "lucide-react";
import { BANK_META, BankBadge, bankLogoSrc } from "@/components/AccountMiniCard";
import FixtureBottomNav from "@/app/design/_components/FixtureBottomNav";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import UpcomingDetailsSheet from "@/components/upcoming/UpcomingDetailsSheet";
import UpcomingRowDetails from "@/components/upcoming/UpcomingRowDetails";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingAccountDetails from "@/components/upcoming/UpcomingAccountDetails";
import { canDismissUpcomingOccurrence } from "@/lib/upcomingAttention";
import { AccountOverview, DayGroups } from "./CoverageViews";
import { accountSummariesForForecast, buildForecast, dateLabel, money, SCENARIOS, type AccountForecast, type AccountId, type Forecast, type ForecastPayment, type FixtureEdits, type Scenario } from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type Selected = { kind: "account"; id: AccountId } | { kind: "payment" | "edit"; id: string } | null;
const VARIANTS = [
  { id: "a" as const, name: "By account", description: "Each day groups payments by the account they leave. One account subtotal holds the context." },
  { id: "b" as const, name: "Cash view", description: "Compare cash with what is due in each account, then scan the familiar day-by-day list." },
  { id: "c" as const, name: "Needs a look", description: "Payments needing attention lead each day. Covered payments stay one tap away." },
];
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const mono = "font-mono tabular-nums";

function Controls({ variant, scenario, mode }: { variant: Variant; scenario: Scenario; mode: Mode }) {
  const href = (next: { variant?: Variant; scenario?: Scenario; mode?: Mode }) => `?variant=${next.variant ?? variant}&state=${next.scenario ?? scenario}&mode=${next.mode ?? mode}`;
  return (
    <div className="border-b border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/design" className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm text-slate-600 active:opacity-70 dark:text-slate-300 ${focus}`}><ArrowLeft size={16} aria-hidden="true" /> Design rounds</Link>
          <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 ${focus}`}>
            {mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </Link>
        </div>
        <nav aria-label="Design variants" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
          {VARIANTS.map((item) => (
            <Link key={item.id} href={href({ variant: item.id })} aria-current={variant === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-center text-xs font-semibold active:scale-95 sm:text-sm ${focus} ${variant === item.id ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:bg-white/50 dark:text-slate-300 dark:hover:bg-slate-700/60"}`}>
              <span>{item.id.toUpperCase()}</span><span>{item.name}</span>
            </Link>
          ))}
        </nav>
        <details className="group mt-1">
          <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs text-slate-600 active:opacity-70 dark:text-slate-300 [&::-webkit-details-marker]:hidden ${focus}`}>
            <span>Example: <span className="font-semibold">{SCENARIOS.find((item) => item.id === scenario)?.label}</span></span>
            <span className="flex items-center gap-1">Change example <ChevronDown size={14} className="group-open:rotate-180" aria-hidden="true" /></span>
          </summary>
          <nav aria-label="Example scenarios" className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-4">
            {SCENARIOS.map((item) => <Link key={item.id} href={href({ scenario: item.id })} aria-current={scenario === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-xs font-semibold active:scale-95 ${focus} ${scenario === item.id ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200" : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}>{item.label}</Link>)}
          </nav>
        </details>
      </div>
    </div>
  );
}

function Verdict({ forecast }: { forecast: Forecast }) {
  const isShort = forecast.shortAccounts > 0;
  const empty = forecast.payments.length === 0;
  return (
    <section aria-labelledby="coverage-verdict" className="space-y-3">
      <h2 id="coverage-verdict" className="text-xl font-semibold leading-7 tracking-tight text-slate-950 dark:text-slate-50">
        {empty ? "Nothing left in this example" : isShort ? <>
          <span className={`${mono} text-3xl font-bold`}>{money(forecast.shortfall)}</span>
          <span className="mt-1 block">{forecast.optionalMoves ? "unfunded across" : "needed in"} {forecast.shortAccounts} {forecast.shortAccounts === 1 ? "account" : "accounts"}</span>
        </> : forecast.optionalMoves ? "Every shown move is covered" : "Every shown payment is covered"}
      </h2>
      <p className="max-w-prose text-sm leading-6 text-slate-600 dark:text-slate-300">
        {empty ? "Reset the example to compare the original six rows again." : forecast.optionalMoves
          ? <>After these moves, <span className={`${mono} font-medium`}>{money(forecast.closing)}</span> would remain in these source accounts. An unfunded move to your own savings may stay put, with no fee. Moving money does not reduce what you own.</>
          : !isShort ? <>Each account can cover its payments, leaving <span className={`${mono} font-medium`}>{money(forecast.closing)} overall</span>. Open a payment to see the working.</>
          : forecast.closing >= 0 ? <>There would be <span className={`${mono} font-medium`}>{money(forecast.closing)} left overall</span> after these payments. The gap is in the accounts they leave from.</>
          : <>Together, these accounts would end at <span className={`${mono} font-medium`}>{money(forecast.closing)}</span>. Check each short account before its payment is due.</>}
      </p>
      <details className="group">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 active:opacity-70 dark:text-slate-300 [&::-webkit-details-marker]:hidden ${focus}`}>
          Across these accounts <ChevronDown size={14} className="group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="space-y-2 pb-3 text-xs">
          <LedgerLine label="Cash now" value={forecast.cash} />
          <LedgerLine label={forecast.optionalMoves ? "Planned moves to savings" : "Payments over these two days"} value={-forecast.outgoing} />
          <div className="border-t border-slate-300 pt-2 dark:border-slate-600"><LedgerLine label={forecast.optionalMoves ? "Left in these source accounts" : "Left overall if all payments leave"} value={forecast.closing} /></div>
        </dl>
        <p className="pb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Account shortfalls are added separately from cash left overall. Cash in another account does not fund a payment automatically.</p>
      </details>
    </section>
  );
}

function LedgerLine({ label, value }: { label: string; value: number }) {
  return <div className="flex items-baseline justify-between gap-5"><dt className="text-slate-600 dark:text-slate-300">{label}</dt><dd className={`${mono} shrink-0 font-medium text-slate-900 dark:text-slate-100`}>{money(value)}</dd></div>;
}

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  useSheetOpen();
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true });
  return createPortal(
    <>
      <button type="button" tabIndex={-1} className="fixed inset-0 z-[65] bg-black/40" onClick={close} aria-label="Close details backdrop" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-6">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="g176-sheet-title" aria-describedby="g176-sheet-subtitle" className="glass-sheet pointer-events-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl lg:rounded-3xl">
          <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
            <div className="min-w-0"><h2 id="g176-sheet-title" className="break-words text-lg font-bold leading-6 text-slate-950 dark:text-white">{title}</h2><p id="g176-sheet-subtitle" className="mt-1 text-xs text-slate-600 dark:text-slate-300">{subtitle}</p></div>
            <button type="button" aria-label="Close details" onClick={close} className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-95 dark:bg-slate-800 dark:text-slate-300 ${focus}`}><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">{children}</div>
        </div>
      </div>
    </>, document.body,
  );
}

function AccountDetail({ account, optionalMoves, onPayment }: { account: AccountForecast; optionalMoves: boolean; onPayment: (payment: ForecastPayment) => void }) {
  const meta = BANK_META[account.account.bankKey];
  return <div className="space-y-5">
    <div className="flex items-center gap-3">
      <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta.initials} altText="" size={36} />
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100"><span className={`${mono} text-xl`}>{money(account.shortfall || account.closing)}</span> {account.shortfall ? (optionalMoves ? "unfunded" : "short") : optionalMoves ? "left after these moves" : "left after these payments"}</p>
    </div>
    <dl className="space-y-3 text-sm">
      <LedgerLine label={`Cash in ${account.account.name}`} value={account.opening} />
      <LedgerLine label={optionalMoves ? "Shown moves to savings" : "Shown payments"} value={-account.outgoing} />
      <div className="border-t border-slate-200 pt-3 dark:border-slate-700"><LedgerLine label={`Projected in ${account.account.name}`} value={account.closing} /></div>
    </dl>
    <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{optionalMoves ? "Moves in this forecast" : "Payments in this forecast"}</h3>
      <div className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">{account.payments.map((payment) => <button key={payment.id} type="button" onClick={() => onPayment(payment)} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg py-3 text-left active:opacity-70 ${focus}`}>
        <span className="min-w-0"><span className="block text-sm text-slate-800 dark:text-slate-100">{payment.name}</span><span className="text-xs text-slate-600 dark:text-slate-400">{dateLabel(payment.date)}</span></span>
        <span className={`${mono} shrink-0 text-sm text-slate-900 dark:text-slate-100`}>{money(-payment.pence)}</span>
      </button>)}</div>
    </div>
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">This example assumes only the {optionalMoves ? "moves" : "payments"} shown, in listed order, with no incoming money or overdraft. It does not identify money that is safe to spend.</p>
  </div>;
}

function PaymentDetail({ payment, onAccount, onDismiss, onClose }: { payment: ForecastPayment; onAccount: () => void; onDismiss: () => void; onClose: () => void }) {
  const needsCash = payment.shortfall > 0;
  return <div className="space-y-5">
    <p className={`${mono} text-3xl font-bold text-slate-950 dark:text-white`}>{money(-payment.pence, true)}</p>
    <section aria-labelledby="payment-coverage" className="space-y-2">
      <h3 id="payment-coverage" className="flex items-start gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {needsCash ? <span className={`mt-1.5 size-2 shrink-0 rounded-full ${payment.optionalMove ? "bg-amber-500" : "bg-rose-500"}`} aria-hidden="true" /> : <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
        {needsCash ? payment.optionalMove ? "This move may stay put" : "This payment is not fully covered" : `Covered from ${payment.account.name}`}
      </h3>
      <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">After earlier shown {payment.optionalMove ? "moves" : "payments"}, the forecast for {payment.account.name} is <span className={mono}>{money(payment.before)}</span>. This {payment.optionalMove ? "move" : "payment"} needs <span className={mono}>{money(payment.pence)}</span>.</p>
      {payment.optionalMove && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Planned for {dateLabel(payment.model.originalDate!)} and still waiting to leave. There is no fee if it stays put.</p>}
    </section>
    <dl className="space-y-3 text-sm">
      <LedgerLine label={payment.optionalMove ? "Before this move" : "Before this payment"} value={payment.before} />
      <LedgerLine label={payment.optionalMove ? "Planned move" : "Payment"} value={-payment.pence} />
      <div className="border-t border-slate-200 pt-3 dark:border-slate-700"><LedgerLine label={`After, in ${payment.account.name}`} value={payment.after} /></div>
    </dl>
    <button type="button" onClick={onAccount} className={`min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-indigo-700 active:scale-95 dark:border-slate-700 dark:text-indigo-300 ${focus}`}>See {payment.account.name}’s other {payment.optionalMove ? "moves" : "payments"}</button>
    <div className="space-y-2">
      <button type="button" onClick={onClose} className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 ${focus}`}>Back to upcoming</button>
      {payment.optionalMove && <button type="button" onClick={onDismiss} className={`min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 ${focus}`}>Dismiss for this month</button>}
    </div>
    <p className="text-center text-xs text-slate-600 dark:text-slate-400">Invented example. No bank or forecast changes are made.</p>
  </div>;
}

// Local fixture editor only. The authenticated page hands the same sheet's
// edit action to its existing prediction/planned-payment editors instead.
function EditExample({ payment, onSave }: { payment: ForecastPayment; onSave: (edit: FixtureEdits[string]) => void }) {
  const [name, setName] = useState(payment.name);
  const [amount, setAmount] = useState((payment.pence / 100).toFixed(2));
  const [error, setError] = useState("");
  const input = `mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white ${focus}`;
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    const pence = Math.round(Number(amount) * 100);
    if (!name.trim() || !Number.isFinite(pence) || pence <= 0 || pence > 100000000) { setError("Enter a name and an amount between £0.01 and £1,000,000."); return; }
    onSave({ name: name.trim(), pence });
  }}>
    <label className="block text-sm font-semibold">Name<input name="example-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required className={input} autoComplete="off" /></label>
    <label className="block text-sm font-semibold">Amount (£)<input name="example-amount" type="number" min="0.01" max="1000000" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={input} autoComplete="off" /></label>
    {error && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{error}</p>}
    <button type="submit" className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 ${focus}`}>Save example</button>
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Only these invented figures change. Your accounts and predictions are untouched.</p>
  </form>;
}

function Preview({ variant, scenario, mode }: { variant: Variant; scenario: Scenario; mode: Mode }) {
  const [selected, setSelected] = useState<Selected>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [lastDismissed, setLastDismissed] = useState<string | null>(null);
  const [edits, setEdits] = useState<FixtureEdits>({});
  const forecast = buildForecast(scenario, dismissed, edits);
  const accountSummaries = accountSummariesForForecast(forecast);
  const liveAccount = selected?.kind === "account" ? accountSummaries.find((account) => account.id === selected.id) : undefined;
  const payment = selected?.kind === "payment" || selected?.kind === "edit" ? forecast.payments.find((item) => item.id === selected.id) : undefined;
  const account = selected?.kind === "account" ? forecast.accounts.find((item) => item.account.id === selected.id) : undefined;
  const onPayment = (item: ForecastPayment) => setSelected({ kind: "payment", id: item.id });
  const onAccount = (item: AccountForecast) => setSelected({ kind: "account", id: item.account.id });
  const note = VARIANTS.find((item) => item.id === variant)!;
  const dismissPayment = (item: ForecastPayment) => {
    setDismissed((current) => new Set(current).add(item.id));
    setLastDismissed(item.id);
    setSelected(null);
  };

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const meta = document.querySelector('meta[name="color-scheme"]');
    const previous = meta?.getAttribute("content") ?? null;
    root.classList.toggle("dark", mode === "dark");
    meta?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    return () => { root.classList.toggle("dark", wasDark); if (previous === null) meta?.removeAttribute("content"); else meta?.setAttribute("content", previous); };
  }, [mode]);

  return <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
    <div inert={selected !== null} aria-hidden={selected ? true : undefined} className="min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100">
      <a href="#g176-main" className="sr-only fixed left-4 top-3 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only">Skip to preview</a>
      <Controls variant={variant} scenario={scenario} mode={mode} />
      <main id="g176-main" className="mx-auto max-w-6xl px-4 pb-40 pt-7 sm:px-6 lg:pb-16 lg:pt-10">
        <header className="mb-7">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-950 dark:text-white">Before payday</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">What will enter or leave, and whether every payment is covered.</p>
        </header>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
          <div data-account-summary className="space-y-6 lg:sticky lg:top-6">
            {variant === "c" ? <>
              <UpcomingHeroCard
                isCalendarMonth={false} daysToPayday={2} paydayLabel="Thu 1 Oct"
                spendableNow={forecast.cash / 100} runwayIncomeTotal={0}
                runwayBillsTotal={forecast.outgoing / 100} allocationsRemainingTotal={0}
                savingsNow={0} runway={forecast.closing / 100}
                runwayStatus={forecast.closing < 0 ? "short" : forecast.closing === 0 ? "even" : "left"}
              />
              <UpcomingAccountsCard accounts={accountSummaries} periodLabel="Payments through Wed 30 Sept" onOpen={(item) => setSelected({ kind: "account", id: item.id as AccountId })} />
            </> : <>
              <Verdict forecast={forecast} />
              <AccountOverview forecast={forecast} visual={variant === "b"} onAccount={onAccount} />
            </>}
          </div>
          <section aria-labelledby="payments-heading" className="min-w-0 space-y-4">
            <div className="flex items-baseline justify-between gap-3"><h2 id="payments-heading" className="text-base font-bold">{forecast.optionalMoves ? "Planned moves" : "Upcoming payments"}</h2><p className="text-xs text-slate-600 dark:text-slate-400">29–30 Sept · {forecast.payments.length} shown</p></div>
            {lastDismissed && <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 px-3 text-sm text-indigo-900 dark:bg-indigo-400/10 dark:text-indigo-100"><p>{forecast.optionalMoves ? "Move" : "Payment"} removed from this example.</p><button type="button" onClick={() => { setDismissed((current) => { const next = new Set(current); next.delete(lastDismissed); return next; }); setLastDismissed(null); }} className={`min-h-11 shrink-0 rounded-lg px-2 font-semibold active:opacity-70 ${focus}`}>Undo</button></div>}
            <DayGroups forecast={forecast} variant={variant} onPayment={onPayment} onAccount={onAccount} onDismiss={dismissPayment} />
            {forecast.payments.length === 0 && <button type="button" onClick={() => { setDismissed(new Set()); setEdits({}); setLastDismissed(null); }} className={`min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:scale-95 ${focus}`}>Reset example</button>}
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Coverage is checked in the account each payment leaves, after earlier payments shown. Tap a row for its calculation.</p>
          </section>
        </div>
        <footer className="mt-10 border-t border-slate-300 pt-5 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <p><span className="font-semibold">{variant.toUpperCase()} · {note.name}.</span> {note.description}</p>
          {variant === "c" && <p className="mt-2">Approved direction. The hero, By account view, account working, day groups and payment details all render the production components with invented figures.</p>}
          <p className="mt-2">G176 design example. Invented accounts and figures; no incoming money, overdraft or unlisted payments. Change the example above to compare mixed, short and covered accounts.</p>
        </footer>
      </main>
      <FixtureBottomNav active="Upcoming" />
    </div>
    {variant === "c" && liveAccount && <UpcomingDetailsSheet title={liveAccount.bank} subtitle={liveAccount.name} onClose={() => setSelected(null)}><UpcomingAccountDetails account={liveAccount} periodLabel="Payments through Wed 30 Sept" /></UpcomingDetailsSheet>}
    {variant !== "c" && account && <Sheet title={account.account.name} subtitle={`${account.account.detail} · 29–30 Sept`} onClose={() => setSelected(null)}><AccountDetail account={account} optionalMoves={forecast.optionalMoves} onPayment={onPayment} /></Sheet>}
    {payment && selected?.kind === "payment" && (variant === "c" ? <UpcomingDetailsSheet
      title={payment.name} subtitle={`${payment.account.name} · ${dateLabel(payment.date)}`} onClose={() => setSelected(null)}
      onEdit={() => setSelected({ kind: "edit", id: payment.id })} editLabel="Edit example"
      onSkipOccurrence={canDismissUpcomingOccurrence(payment.model) ? async () => dismissPayment(payment) : undefined}
    ><UpcomingRowDetails model={payment.model} /></UpcomingDetailsSheet> : <Sheet title={payment.name} subtitle={`${payment.account.name} · ${dateLabel(payment.date)}`} onClose={() => setSelected(null)}><PaymentDetail payment={payment} onAccount={() => setSelected({ kind: "account", id: payment.accountId })} onClose={() => setSelected(null)} onDismiss={() => dismissPayment(payment)} /></Sheet>)}
    {payment && selected?.kind === "edit" && <Sheet title="Edit example" subtitle="Invented figures, saved only in this preview" onClose={() => setSelected({ kind: "payment", id: payment.id })}><EditExample key={payment.id} payment={payment} onSave={(edit) => { setEdits((current) => ({ ...current, [payment.id]: edit })); setSelected({ kind: "payment", id: payment.id }); }} /></Sheet>}
  </div>;
}

export default function G176Client() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "a" || rawVariant === "b" ? rawVariant : "c";
  const rawState = params.get("state");
  const scenario: Scenario = rawState === "short" || rawState === "covered" || rawState === "moves" ? rawState : rawState === "late" ? "moves" : "mixed";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  return <Preview key={scenario} variant={variant} scenario={scenario} mode={mode} />;
}
