"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./Declutter.module.css";
import VisibleAccounts, { AccountNotes, accountsNeedFullWidth } from "./VisibleAccounts";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CreditCard } from "lucide-react";
import SafeToSpendCard, { COUNTS_LINE } from "@/components/SafeToSpendCard";
import SpendFromAccountList from "@/components/SpendFromAccountList";
import ForecastStatusBadge from "@/components/ForecastStatusBadge";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { deriveSafeToSpendHeadline, homeForecastPresentation } from "@/lib/pennyScreenViews";
import { ACCOUNTS, ACCOUNT_EXAMPLES, COLD_SYNC, DEGRADED, FORECASTS, MOVE, STATES, WARM_SYNC, accountEntries, isReady, money, type AccountExample, type Forecast, type ReadyState } from "./fixtures";

const OPTIONS = [
  { id: "b1", name: "Beside the figure", tradeoff: "B Short scope with account names and limits beside the amount. Short names use the spare width; narrow cards, large amounts and detailed account names stack. The first counts sentence stays visible; exclusions and accuracy still need a tap." },
  { id: "b2", name: "Inside the hero", tradeoff: "B Short scope with a full-width account list after the scope. More height, with more room for names and limits. The first counts sentence stays visible; exclusions and accuracy still need a tap." },
  { id: "a", name: "Visible scope", tradeoff: "The full approved counts line stays on the card. The accuracy disclaimer and working are on tap. Closest to the current scope prominence, with more reading above the action." },
  { id: "b", name: "Short scope", tradeoff: "The first counts sentence stays visible. Excluded accounts, pending payments, unseen bills and the accuracy disclaimer need a tap. A quieter face, with less prominent limitations." },
  { id: "c", name: "Verdict first", tradeoff: "Only the estimated label and supporting line qualify the figure on the face. All counts and accuracy detail need a tap. The least clutter, with the greatest loss of caveat prominence." },
] as const;
type Variant = typeof OPTIONS[number]["id"];
const noop = () => {};
const copy = "text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300";
const caption = "text-pretty text-[12px] leading-5 text-slate-600 dark:text-slate-300";
const focus = "touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const summary = `min-h-11 cursor-pointer rounded-lg text-[13px] font-medium text-slate-700 dark:text-slate-200 ${focus}`;
const disclaimer = "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.";
const firstCounts = COUNTS_LINE.slice(0, COUNTS_LINE.indexOf(". ") + 1);
const exclusions = COUNTS_LINE.slice(firstCounts.length + 1);

function Working({ data }: { data: Forecast }) {
  const cash = data.safe_to_spend_cash ?? data.safe_to_spend;
  const rows: [string, number, boolean][] = [
    ["Cash available now", data.spendable_now ?? 0, false],
    ["Bills before payday", -data.bills_total, true],
    ["Safety buffer", -data.buffer, true],
    ...(data.commitments_reserved ? [["Plans reserved", -data.commitments_reserved, true] as [string, number, boolean]] : []),
    ...(data.allocations_reserved ? [["Envelopes reserved", -data.allocations_reserved, true] as [string, number, boolean]] : []),
    ["Cash position before payday", cash, true],
  ];
  return <div data-g324-working className="pt-2">
    <dl>{rows.map(([label, value, signed], index) => <div key={label} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-[12px] ${index === rows.length - 1 ? "border-t border-slate-200 font-semibold dark:border-slate-600" : ""}`}><dt>{label}</dt><dd><MoneyText text={money(value, signed)} /></dd></div>)}</dl>
    <p className={caption}>Bills and income are applied in date order. No earlier income is expected in this example.</p>
    {data.card_growth_reserved != null && data.card_growth_reserved > 0 && <div className="mt-4">
      <h3 className="text-[13px] font-semibold">Card safety check</h3>
      <dl>{[["From cash calculation", cash], ["Unconfirmed card reserve", -data.card_growth_reserved], ["Safety position", data.safe_to_spend]].map(([label, value]) => <div key={label} className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[12px]"><dt>{label}</dt><dd><MoneyText text={money(Number(value), true)} /></dd></div>)}</dl>
      <p className={`mt-2 ${caption}`}>The available headline stays at zero; the safety shortfall remains visible.</p>
    </div>}
    <p className={`mt-4 ${caption}`}><MoneyText text={`Pay of about ${money(data.payday_income ?? 0)} due Fri 30 Oct.`} /> This is expected pay, not cash received before payday.</p>
  </div>;
}

function Accounts({ data, move }: { data: Forecast; move: boolean }) {
  const entries = ACCOUNTS.kind === "account" ? [ACCOUNTS.best, ...(ACCOUNTS.alternative ? [ACCOUNTS.alternative] : [])] : [];
  return <details data-g324-accounts className="border-b border-slate-200 dark:border-slate-700">
    <DisclosureSummary className={summary}>Held in NatWest or Starling</DisclosureSummary>
    <div className="pb-4"><SpendFromAccountList entries={entries} pool={data.safe_to_spend} amount={money} coverMoveVisible={false} kind="bank-rail" onLogoError={noop} />
      <p className={`mt-3 ${caption}`}>These are account ceilings, not amounts to add together. They may not add up to the estimate.</p>
      {move && <p className={`mt-2 ${caption}`}><MoneyText text={`${money(MOVE.amount)} kept back in ${MOVE.source} for the move to ${MOVE.destination}.`} /></p>}
    </div>
  </details>;
}

function Cards({ data }: { data: Forecast }) {
  const reserve = data.card_growth_reserved ?? 0;
  const amount = reserve ? data.card_growth_total ?? 0 : data.card_new_spend_total ?? 0;
  if (amount <= 0) return null;
  const monthly = data.card_growth_wording === "cleared_monthly";
  return <section data-g324-cards aria-label="Card activity" className="mt-3">
    <details><DisclosureSummary className={summary}><span className="flex min-w-0 items-center gap-2"><CreditCard size={15} className="shrink-0" aria-hidden="true" /><span><MoneyText text={`${money(amount)} ${reserve ? "card balance growth" : "went on cards"}`} /></span></span></DisclosureSummary>
      <p className={`pb-2 ${caption}`}>{reserve ? "This is net card balance growth, which sets the fallback reserve." : "Purchases only. Balance transfers and repayments are not counted here."}</p>
    </details>
    <p className={caption}>{reserve ? <MoneyText text={`${money(data.card_new_spend_total ?? 0)} of purchases is a separate figure, not the fallback reserve.`} /> : monthly ? "Repayment due 28 Oct is already in the bills forecast, not another deduction." : "Not deducted from the cash estimate above."}</p>
  </section>;
}

function Instrument({ variant, state, accountExample }: { variant: Variant; state: ReadyState; accountExample: AccountExample }) {
  const data: Forecast = FORECASTS[state];
  const headline = deriveSafeToSpendHeadline(data);
  const presentation = homeForecastPresentation(data, headline);
  const reserve = data.card_growth_reserved ?? 0;
  const canShowAccounts = state !== "no-account" && headline.state !== "short";
  const integrated = variant === "b1" || variant === "b2";
  const entries = accountEntries(accountExample, data.safe_to_spend);
  const showVisibleAccounts = integrated && canShowAccounts && data.safe_to_spend > 0 && entries.length > 0;
  const sideRail = showVisibleAccounts && variant === "b1";
  const stackRail = accountsNeedFullWidth(entries) || money(headline.heroAmount).length >= 6;
  const rail = <VisibleAccounts entries={entries} pool={data.safe_to_spend} />;
  const support = headline.isCardsUnconfirmedShort
    ? `${money(reserve)} held while a card bill is unconfirmed, leaving a ${money(Math.abs(data.safe_to_spend))} safety shortfall.`
    : headline.state === "short"
    ? headline.plansOnly ? "Short after the plans and envelopes you set aside." : "Your dated payments leave a gap before payday."
    : state === "no-account"
    ? "No current account has spare cash towards this estimate right now."
    : `About ${money(Math.round(headline.heroAmount / data.days_until_payday))} a day until Fri 30 Oct, after bills and envelopes.`;
  const action = headline.state === "short"
    ? headline.isCardsUnconfirmedShort ? { href: "/cards", label: "Review card bill" } : { href: "/upcoming", label: "See what’s due" }
    : headline.state === "tight" && (data.card_debt ?? 0) >= 1000 ? { href: "/cards", label: "See your cards" } : null;
  return <>
    <section data-g324-card className={`glass-hero rounded-2xl p-5 ${styles.instrument}`} aria-labelledby="g324-label g324-amount">
      <div className="flex items-center justify-between gap-3"><p id="g324-label" className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">{presentation.eyebrow}</p><ForecastStatusBadge status={presentation.status} /></div>
      <div className={`mt-5 ${sideRail ? styles.figureAndAccounts : ""} ${sideRail && stackRail ? styles.stackAccounts : ""}`}><h2 id="g324-amount" aria-describedby="g324-support"><span className="money block text-[30px] font-bold leading-[1.2] tracking-[-0.025em]"><MoneyText text={`${presentation.signed ? "−" : ""}${money(headline.heroAmount)}`} /></span></h2>{sideRail && rail}</div>
      <p id="g324-support" data-g324-warning={reserve > 0 || undefined} className={`mt-3 ${copy}`}><MoneyText text={support} /></p>
      {variant !== "c" && <p data-g324-counts className="mt-3 text-pretty text-[12px] leading-[1.45] text-slate-700 dark:text-slate-200">{variant === "a" ? COUNTS_LINE : firstCounts}</p>}
      {showVisibleAccounts && <div className="mt-4">{variant === "b2" && rail}<div className={variant === "b2" ? "mt-3" : ""}><AccountNotes move={state === "tight" && accountExample === "standard"} /></div></div>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">{action && <Link prefetch={false} href={action.href} className={`mr-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-50 px-3 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-100 active:opacity-70 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25 ${focus}`}>{action.label}<ArrowRight size={15} aria-hidden="true" /></Link>}<Link prefetch={false} href="/accounts" className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-[12px] font-medium text-slate-600 hover:text-slate-950 active:opacity-70 dark:text-slate-300 dark:hover:text-white ${focus}`}>Your accounts<ArrowRight size={15} aria-hidden="true" /></Link></div>
    </section>
    <div className="mt-3">
      <details data-g324-caveat className="border-b border-slate-200 dark:border-slate-700"><DisclosureSummary className={summary}>What this estimate counts</DisclosureSummary><div className={`space-y-2 pb-4 pt-1 ${caption}`}>{variant === "c" && <p data-g324-counts>{COUNTS_LINE}</p>}{(variant === "b" || integrated) && <p>{exclusions}</p>}<p data-g324-disclaimer>{disclaimer}</p></div></details>
      {canShowAccounts && !integrated && <Accounts data={data} move={state === "tight"} />}
      <details data-g324-calculation className="border-b border-slate-200 dark:border-slate-700"><DisclosureSummary className={summary}><MoneyText text={`How we got ${money(headline.heroAmount)}${headline.state === "short" && !headline.isCardsUnconfirmedShort ? " short" : ""}`} /></DisclosureSummary><Working data={data} /></details>
      <Cards data={data} />
    </div>
  </>;
}

export default function LeftToSpendDeclutterClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = OPTIONS.find(option => option.id === rawVariant)?.id ?? "b1";
  const accountExample = ACCOUNT_EXAMPLES.find(example => example.id === params.get("accounts"))?.id ?? "standard";
  const rawState = params.get("scenario") ?? params.get("state");
  const state = STATES.find(item => item.id === rawState)?.id ?? "tight";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hide") === "1";
  const href = (overrides: Record<string, string>) => `?${new URLSearchParams({ variant, scenario: state, accounts: accountExample, mode: dark ? "dark" : "light", hide: hidden ? "1" : "0", ...overrides })}`;
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark"), oldScheme = root.style.colorScheme;
    root.classList.toggle("dark", dark); root.style.colorScheme = dark ? "dark" : "light";
    root.dataset.g324Ready = "true";
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = oldScheme; delete root.dataset.g324Ready; };
  }, [dark]);
  const retry = () => { window.location.href = href({ scenario: "tight" }); };
  const fallback = state === "loading" ? <SafeToSpendCard data={null} loading />
    : state === "cold-sync" ? <SafeToSpendCard data={COLD_SYNC} spendFrom={{ kind: "unavailable", reason: "loading" }} />
    : state === "warm-sync" ? <SafeToSpendCard data={FORECASTS.tight} spendFrom={ACCOUNTS} syncing={WARM_SYNC} previewBalancesVisible={!hidden} />
    : state === "degraded" ? <SafeToSpendCard data={DEGRADED} onRetry={retry} />
    : state === "error" ? <SafeToSpendCard data={null} error onRetry={retry} />
    : <SafeToSpendCard data={{ status: "insufficient_data" }} onRetry={retry} />;
  return <BalancesHiddenContext.Provider value={hidden}><div className={dark ? "dark" : ""}>
    <main data-g324-ready="true" data-g324-variant={variant} data-g324-account-example={accountExample} className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 lg:px-8 lg:py-10"><div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold tracking-tight">Left to spend · B, accounts at a glance</h1><p className={`mt-2 max-w-xl ${copy}`}>B Short scope, with two ways to keep the account guidance inside the hero. No expansion needed. Fixed fictional examples from 23 Oct 2026.</p>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(250px,320px)_minmax(350px,430px)] lg:gap-10">
        <nav aria-label="Design preview controls" className="space-y-3 lg:sticky lg:top-6"><div className="grid grid-cols-2 gap-2">{OPTIONS.filter(option => option.id === "b1" || option.id === "b2").map(option => <Link prefetch={false} key={option.id} href={href({ variant: option.id })} aria-current={variant === option.id ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-[12px] active:opacity-70 ${focus} ${variant === option.id ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700" : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400"}`}><strong>{option.id.toUpperCase()}</strong>{option.name}</Link>)}</div>
          <details className="rounded-xl border border-slate-200 px-3 dark:border-slate-700"><DisclosureSummary className={summary}>Examples and display</DisclosureSummary><div className="space-y-3 pb-3"><p className={caption}>{OPTIONS.find(option => option.id === variant)?.tradeoff} These are review choices, not a legal approval.</p><div className="grid grid-cols-2 gap-1">{STATES.map(item => <Link prefetch={false} key={item.id} href={href({ scenario: item.id })} aria-current={state === item.id ? "true" : undefined} className={`flex min-h-11 items-center rounded-lg px-2 text-[12px] ${focus} ${state === item.id ? "bg-slate-200 font-semibold dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{item.label}</Link>)}</div><div className="flex gap-2"><Link prefetch={false} href={href({ mode: dark ? "light" : "dark" })} className={`inline-flex min-h-11 items-center px-2 text-[12px] hover:underline active:opacity-70 ${focus}`}>{dark ? "Light theme" : "Dark theme"}</Link><Link prefetch={false} href={href({ hide: hidden ? "0" : "1" })} className={`inline-flex min-h-11 items-center px-2 text-[12px] hover:underline active:opacity-70 ${focus}`}>{hidden ? "Show balances" : "Hide balances"}</Link></div></div></details>
          <details className="rounded-xl border border-slate-200 px-3 dark:border-slate-700"><DisclosureSummary className={summary}>Account examples and earlier layouts</DisclosureSummary><div className="space-y-2 pb-3"><p className={caption}>Account examples apply to B1 and B2. Earlier layouts keep their original account snapshot.</p><div className="grid gap-1">{ACCOUNT_EXAMPLES.map(example => <Link prefetch={false} key={example.id} href={href({ accounts: example.id })} aria-current={accountExample === example.id ? "true" : undefined} className={`flex min-h-11 items-center rounded-lg px-2 text-[12px] ${focus} ${accountExample === example.id ? "bg-slate-200 font-semibold dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{example.label}</Link>)}</div><p className={`pt-2 ${caption}`}>Previous round</p>{OPTIONS.filter(option => option.id !== "b1" && option.id !== "b2").map(option => <Link prefetch={false} key={option.id} href={href({ variant: option.id })} aria-current={variant === option.id ? "page" : undefined} className={`flex min-h-11 items-center rounded-lg px-2 text-[12px] hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 ${focus}`}>{option.id.toUpperCase()} · {option.name}</Link>)}</div></details>
        </nav>
        <div className={styles.preview}><div data-g324-main>{isReady(state) ? <Instrument key={`${variant}:${state}:${accountExample}`} variant={variant} state={state} accountExample={accountExample} /> : fallback}</div><p data-g324-tradeoff className={`mt-6 ${caption}`}><strong>Visibility trade-off: </strong>{OPTIONS.find(option => option.id === variant)?.tradeoff} This is a review proposal, not legal approval.</p></div>
      </div>
    </div></main>
  </div></BalancesHiddenContext.Provider>;
}
