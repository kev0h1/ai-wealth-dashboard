import Link from "next/link";
import { AlertCircle, ArrowRight, CalendarDays, CreditCard } from "lucide-react";
import ForecastStatusBadge from "@/components/ForecastStatusBadge";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DisclosureSummary } from "@/components/Disclosure";
import { COUNTS_LINE } from "@/components/SafeToSpendCard";
import MoneyText from "@/components/MoneyText";
import PooledLedgerExplainer from "@/components/PooledLedgerExplainer";
import { deriveSafeToSpendHeadline, homeForecastPresentation } from "@/lib/pennyScreenViews";
import { fixtureHero, type Scenario } from "./fixtures";
import { displayModel, fixtureMoney } from "./model";

export function buildTasteModel(scenario: Scenario) {
  const data = fixtureHero(scenario);
  const headline = deriveSafeToSpendHeadline(data);
  const presentation = homeForecastPresentation(data, headline);
  const reserve = data.card_growth_reserved ?? 0;
  const cash = data.safe_to_spend_cash ?? data.safe_to_spend;
  const belowBuffer = presentation.status.label === "Below buffer";
  const parts = [data.bills_total > 0 ? "upcoming bills" : "the cash forecast", ...(data.commitments_reserved ? ["plans"] : []), ...(data.allocations_reserved ? ["envelopes"] : []), ...(data.buffer && !belowBuffer ? [`your ${fixtureMoney(data.buffer)} buffer`] : [])];
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const support = headline.isCardsUnconfirmedShort
    ? `Estimated cash left until ${headline.paydayLabel}. The cash forecast found ${fixtureMoney(cash)}, then held back ${fixtureMoney(reserve)} for an unconfirmed card repayment.`
    : belowBuffer
    ? `After ${joined}, this is below your ${fixtureMoney(data.buffer)} safety buffer.`
    : headline.plansOnly
    ? `Short after ${joined}.`
    : headline.state === "short"
    ? `After ${joined}, you are short before payday.`
    : `Estimated cash left until ${headline.paydayLabel}, after ${joined}.`;
  const due = data.card_growth_due_date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${data.card_growth_due_date.slice(0, 10)}T12:00:00Z`)) : null;
  const monthly = data.card_growth_wording === "cleared_monthly";
  const cards = (data.card_growth_total ?? 0) > 0 ? {
    title: reserve ? "Card balances this pay period" : "Went on cards this pay period",
    amount: reserve ? data.card_growth_total! : data.card_new_spend_total ?? 0,
    reserve,
    monthly,
    context: monthly ? due ? `Due around ${due}.` : "Its repayment is forecast separately." : "This added to your card balances this pay period.",
    separation: monthly ? "It is not deducted from today’s cash figure." : "It is not deducted from the cash above.",
    exclusion: "Purchases only. Balance transfers and repayments are not counted here.",
    shortfall: data.safe_to_spend < 0 ? Math.abs(data.safe_to_spend) : null,
  } : null;
  const recovery = headline.state === "short"
    ? headline.isCardsUnconfirmedShort ? { label: "Review card bill", href: "/cards" } : { label: "See what’s due", href: "/upcoming" }
    : headline.state === "tight" && (data.card_debt ?? 0) >= 1000 ? { label: "See your cards", href: "/cards" } : null;
  return { data, headline, presentation, support, cards, recovery, accounts: displayModel(scenario), heroText: `${presentation.signed ? "−" : ""}${fixtureMoney(headline.heroAmount)}`, largeCash: fixtureMoney(headline.heroAmount).length > 5 };
}
export type TasteModel = ReturnType<typeof buildTasteModel>;
type Props = { model: TasteModel };
const label = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400";
const body = "text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300";
const caption = "text-pretty text-[12px] leading-5 text-slate-600 dark:text-slate-300";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export function CashHeader({ model }: Props) {
  return <div className="flex items-center justify-between gap-3"><p id="taste-cash-label" className={label}>{model.presentation.eyebrow}</p><ForecastStatusBadge status={model.presentation.status} /></div>;
}
export function CashFigure({ model }: Props) {
  return <h2 id="taste-cash-heading" aria-describedby="taste-cash-scope" data-taste-cash className="min-w-0 text-slate-900 dark:text-slate-100"><span className="money block text-[30px] font-bold leading-[1.2] tracking-[-0.025em]"><MoneyText text={model.heroText} /></span></h2>;
}
export function CashScope({ model }: Props) {
  return <div className="mt-3 space-y-2"><p id="taste-cash-scope" className={body}><MoneyText text={model.data.estimated ? model.support.replace(/\.$/, "") : model.support} />{model.data.estimated && <span className="text-xs text-slate-500 dark:text-slate-400"> · early estimate</span>}</p><p data-sts-counts className="text-pretty text-[12px] leading-[1.45] text-slate-700 dark:text-slate-200">{COUNTS_LINE}</p></div>;
}
export function PeriodReadout({ model }: Props) {
  return <div className="shrink-0 text-right"><p className={`flex items-center justify-end gap-1.5 ${label}`}><CalendarDays size={13} aria-hidden="true" />Until payday</p><p className="mt-1 text-[13px] text-slate-700 dark:text-slate-200">{model.headline.paydayLabel}</p></div>;
}
export function Accounts({ model, compact = false }: Props & { compact?: boolean }) {
  if (!model.accounts.accounts.length) return <p className={`mt-4 ${caption}`}>No current account has spare cash towards this estimate right now. Checked account by account.</p>;
  return <section data-taste-accounts aria-label="Accounts holding the estimate" className={compact ? "mt-3" : "mt-4"}>
    <p className={label}>Held in</p>
    <ul className={`mt-2 grid gap-x-4 gap-y-3 ${model.accounts.accounts.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {model.accounts.accounts.map(account => {
        const brand = accountBrand(account.account);
        return <li key={account.id} data-g320-account={account.id} className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2">
          <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
          <div className="min-w-0"><span className="block break-words text-[12px] font-medium leading-4 text-slate-700 dark:text-slate-200">{account.label}</span>{account.detail && <span className="block break-words text-[12px] leading-4 text-slate-600 dark:text-slate-300">{account.detail}</span>}</div>
          {account.limit !== null && <p className="col-start-2 mt-1 text-[12px] leading-4 text-slate-600 dark:text-slate-300"><span data-g320-limit><MoneyText text={fixtureMoney(account.limit)} /></span> held</p>}
        </li>;
      })}
    </ul>
    <p className={`mt-2 ${caption}`}>Account limits share the estimate above. They are not amounts to add together.</p>
    {model.accounts.move && <p className={`mt-1 ${caption}`}><MoneyText text={`${fixtureMoney(model.accounts.move.amount)} is already held back in ${model.accounts.move.source} for the move above.`} /></p>}
  </section>;
}
export function CardReadout({ model }: Props) {
  if (!model.cards) return null;
  return <div data-taste-card-readout className="min-w-0"><p className={label}>{model.cards.title}</p><p data-taste-card-amount className="money mt-1 text-[19px] font-bold leading-6 text-slate-900 dark:text-slate-100"><MoneyText text={`+${fixtureMoney(model.cards.amount)}`} /></p>{model.cards.monthly && <p className={`mt-1 ${caption}`}>{model.cards.context}</p>}{!model.cards.reserve && <p className={`mt-1 ${caption}`}>{model.cards.separation}</p>}</div>;
}
function ReserveWarning({ model }: Props) {
  const cards = model.cards;
  if (!cards?.reserve) return null;
  return <div data-taste-reserve className="mt-3 space-y-2"><span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-[11px] font-semibold text-amber-800 dark:bg-slate-700 dark:text-amber-200"><AlertCircle size={13} aria-hidden="true" />Repayment not confirmed</span><p className={body}><MoneyText text={`${fixtureMoney(cards.reserve)} of this is held back because its repayment has not been identified.`} /></p>{cards.shortfall !== null && <p className="text-[12px] font-semibold leading-5 text-slate-700 dark:text-slate-200"><MoneyText text={`That leaves a ${fixtureMoney(cards.shortfall)} safety shortfall.`} /></p>}</div>;
}
export function CardExplanation({ model }: Props) {
  if (!model.cards) return null;
  if (model.cards.reserve) return <ReserveWarning model={model} />;
  return <div data-taste-card-context className="mt-3"><details data-taste-activity-details><DisclosureSummary className={`min-h-11 cursor-pointer rounded-lg text-[12px] font-medium text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white ${focus}`}>Card details</DisclosureSummary><div className="space-y-1 pb-2"><p className={caption}>{model.cards.context}</p><p className={caption}>{model.cards.exclusion}</p></div></details></div>;
}
export function CardActivity({ model, compact = false }: Props & { compact?: boolean }) {
  if (!model.cards) return null;
  const title = <span className={`flex min-w-0 items-center gap-2 ${label}`}><CreditCard size={16} className="shrink-0" aria-hidden="true" />{model.cards.title}</span>;
  const figure = <span data-taste-card-amount className={`money shrink-0 font-bold text-slate-900 dark:text-slate-100 ${compact ? "text-sm" : "text-[19px]"}`}><MoneyText text={`+${fixtureMoney(model.cards.amount)}`} /></span>;
  if (model.cards.reserve) return <section data-taste-card-activity aria-label="Card balance activity"><div className="flex items-start justify-between gap-3">{title}{figure}</div><ReserveWarning model={model} /></section>;
  return <section data-taste-card-activity aria-label="Card balance activity">
    {compact ? <details data-taste-activity-details><DisclosureSummary className={`min-h-12 cursor-pointer rounded-lg py-2 ${focus}`}><span className="flex min-w-0 flex-1 items-center justify-between gap-3">{title}{figure}</span></DisclosureSummary><div className="space-y-1 pb-2">{!model.cards.monthly && <p className={caption}>{model.cards.context}</p>}<p className={caption}>{model.cards.exclusion}</p></div></details> : <div className="flex items-start justify-between gap-3">{title}{figure}</div>}
    <div className="mt-2 space-y-1">{(!compact || model.cards.monthly) && <p className={body}>{model.cards.context}</p>}<p className={caption}>{model.cards.separation}</p>{!compact && <p className={caption}>{model.cards.exclusion}</p>}</div>
  </section>;
}
export function CashWorking({ model }: Props) {
  const d = model.data;
  const cash = d.safe_to_spend_cash ?? d.safe_to_spend;
  const signed = (value: number) => `${value < 0 ? "−" : ""}${fixtureMoney(Math.abs(value))}`;
  const reconciles = d.spendable_now != null && d.lowest_projected_balance != null && Math.abs(d.spendable_now - d.bills_total + d.income_before_payday - d.lowest_projected_balance) < 0.02;
  const rows = [
    ...(d.spendable_now != null ? [["Cash available now", fixtureMoney(d.spendable_now)]] : []),
    ...(reconciles && d.bills_total ? [["Bills before payday", `−${fixtureMoney(d.bills_total)}`]] : []),
    ...(reconciles && d.income_before_payday ? [["Income before payday", `+${fixtureMoney(d.income_before_payday)}`]] : []),
    ...(d.lowest_projected_balance != null ? [["Lowest cash before payday", signed(d.lowest_projected_balance)]] : []),
    ...(d.buffer ? [["Safety buffer", `−${fixtureMoney(d.buffer)}`]] : []),
    ...(d.commitments_reserved ? [["Plans reserved", `−${fixtureMoney(d.commitments_reserved)}`]] : []),
    ...(d.allocations_reserved ? [["Envelopes reserved", `−${fixtureMoney(d.allocations_reserved)}`]] : []),
    [cash < 0 ? "Cash position before payday" : "Cash available until payday", signed(cash)],
  ];
  return <details data-taste-working className="mt-4 border-t border-slate-100 dark:border-white/10"><DisclosureSummary className={`min-h-12 cursor-pointer rounded-lg text-[13px] font-semibold text-slate-600 dark:text-slate-300 ${focus}`}><MoneyText text={`How we got ${fixtureMoney(model.headline.heroAmount)}${model.headline.state === "short" && !model.headline.isCardsUnconfirmedShort ? " short" : ""}`} /></DisclosureSummary><div className="pb-3"><p className={`mb-2 ${label}`}>Cash calculation</p><dl>{rows.map(([name, value], index) => <div key={name} className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-slate-100 py-2 first:border-0 dark:border-white/10 ${index === rows.length - 1 ? "font-semibold" : ""}`}><dt className="text-[12px] text-slate-700 dark:text-slate-200">{name}</dt><dd className="money text-[12px] text-slate-900 dark:text-slate-100"><MoneyText text={value} /></dd></div>)}</dl><PooledLedgerExplainer pooled={model.accounts.accounts.length > 1} envelope={{ amount: d.allocations_reserved ?? 0, count: d.allocations_count }} plan={{ amount: d.commitments_reserved ?? 0, count: d.commitments_count }} format={fixtureMoney} /><p className={caption}>Bills and income are applied in date order.</p>{(d.card_growth_reserved ?? 0) > 0 && <div className="mt-4"><p className={`mb-2 ${label}`}>Card safety check</p><dl className="space-y-2">{[["From cash calculation", signed(cash)], ["Unconfirmed card reserve", `−${fixtureMoney(d.card_growth_reserved!)}`], ["Safety position", signed(d.safe_to_spend)]].map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[12px]"><dt>{name}</dt><dd className="money"><MoneyText text={value} /></dd></div>)}</dl><p className={`mt-2 ${caption}`}>The amount available above cannot fall below £0, so the shortfall stays visible here.</p></div>}</div></details>;
}
export function CashFooter({ model, periodInHeader = false }: Props & { periodInHeader?: boolean }) {
  return <div className="border-t border-slate-100 pt-3 dark:border-white/10"><p className={caption}>{!periodInHeader && `Pay period ends ${model.headline.paydayLabel}`}{!periodInHeader && model.data.payday_income != null && " · "}{model.data.payday_income != null && <MoneyText text={`~${fixtureMoney(model.data.payday_income)} expected`} />}</p><p data-sts-disclaimer className="mt-1 text-pretty text-[11px] leading-4 text-slate-500 dark:text-slate-400">An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.</p><div className="mt-3 flex flex-wrap items-center justify-end gap-2">{model.recovery && <Link href={model.recovery.href} className={`mr-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25 ${focus}`}>{model.recovery.label}<ArrowRight size={15} aria-hidden="true" /></Link>}<Link href="/accounts" className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-[12px] font-medium text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white ${focus}`}>Your accounts<ArrowRight size={15} aria-hidden="true" /></Link></div></div>;
}
