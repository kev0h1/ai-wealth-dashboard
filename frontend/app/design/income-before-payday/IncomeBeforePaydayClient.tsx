"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import IncomeEvidence from "./IncomeEvidence";
import TransactionHistory from "./TransactionHistory";
import { ALL_SERIES, BASE_LEFT_PENCE, BEFORE_PAYDAY, DAYS_LEFT, EXPECTED_PAY, PREVIEW_STATES, RESERVES_PENCE, incomingMoney, money, type IncomeSeries, type PreviewCategory, type PreviewState } from "./fixtures";
import styles from "./preview.module.css";

type Variant = "a" | "b";
type Detail = "income" | "pay";

export default function IncomeBeforePaydayClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const state = PREVIEW_STATES.find(item => item.value === params.get("state"))?.value ?? "income";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const surface = params.get("surface") === "penny" ? "penny" : "home";
  const detail = params.get("detail") === "pay" ? "pay" : params.get("detail") === "income" ? "income" : null;
  const transactions = params.get("view") === "transactions" ? params.get("series") ?? "all" : null;
  return <Preview key={`${variant}-${state}-${dark}-${hidden}-${surface}-${detail}-${transactions}`} variant={variant} initialState={state} dark={dark} initialHidden={hidden} surface={surface} initialDetail={detail} initialTransactions={transactions} clean={params.get("clean") === "1"} />;
}

function Preview({ variant, initialState, dark, initialHidden, surface, initialDetail, initialTransactions, clean }: {
  variant: Variant;
  initialState: PreviewState;
  dark: boolean;
  initialHidden: boolean;
  surface: "home" | "penny";
  initialDetail: Detail | null;
  initialTransactions: string | null;
  clean: boolean;
}) {
  const [state, setState] = useState(initialState);
  const [hidden, setHidden] = useState(initialHidden);
  const [categories, setCategories] = useState<Record<string, PreviewCategory>>({});
  const [sheet, setSheet] = useState<Detail | null>(variant === "b" ? initialDetail : null);
  const [transactionIds, setTransactionIds] = useState<string[] | null>(initialTransactions ? initialTransactions === "all" ? BEFORE_PAYDAY.map(s => s.id) : [initialTransactions] : null);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const transactionsRef = useRef<HTMLDivElement>(null);
  const workingRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const allSeries = ALL_SERIES.map(item => state !== "long" ? item : {
    ...item,
    payer: item.id === "morgan" ? "Jonathan Morgan household account contribution reference November" : item.payer,
    accountName: item.id === "morgan" ? "Halifax · Joint current account for household bills and everyday spending" : item.accountName,
  });
  const isActive = (item: IncomeSeries) => state !== "none" && (!categories[item.id] || categories[item.id] === "Income");
  const before = allSeries.filter(item => item.id !== EXPECTED_PAY.id && isActive(item));
  const pay = allSeries.filter(item => item.id === EXPECTED_PAY.id && isActive(item));
  const incomePence = before.reduce((n, item) => n + Math.round(item.amount * 100), 0);
  const originalIncomePence = BEFORE_PAYDAY.reduce((n, item) => n + Math.round(item.amount * 100), 0);
  const leftPence = BASE_LEFT_PENCE - originalIncomePence + incomePence;
  const left = leftPence / 100;
  const expectedPay = pay.reduce((sum, item) => sum + item.amount, 0);
  const syncing = state === "syncing";
  const historyStatus = state === "loading" ? "loading source history" : state === "error" ? "source history could not load" : state === "partial" ? "source history unavailable" : "estimated";
  const noPay = !pay.length;

  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.classList.toggle("dark", wasDark);
      document.documentElement.style.colorScheme = previousScheme;
    };
  }, [dark]);

  useEffect(() => {
    if (transactionIds) transactionsRef.current?.querySelector<HTMLElement>("#transactions-heading")?.focus();
  }, [transactionIds]);

  const href = (patch: Record<string, string>) => `/design/income-before-payday?${new URLSearchParams({ variant, state: initialState, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0", surface, ...patch })}`;
  const openTransactions = (items: IncomeSeries[]) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTransactionIds(items.map(item => item.id));
    window.scrollTo(0, 0);
  };
  const backToEstimate = () => {
    setTransactionIds(null);
    requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected ? returnFocus.current : workingRef.current;
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
  };
  const onSaveCategory = (id: string, category: PreviewCategory) => {
    setCategories(previous => ({ ...previous, [id]: category }));
    const item = allSeries.find(series => series.id === id);
    setNotice(`${item?.payer ?? "The selected credits"} ${category === "Income" ? "is counted as predicted income again" : "is no longer listed as predicted income"}. The example has refreshed. The pay period still ends on 1 Dec.`);
  };
  const evidence = (kind: Detail, onTransactions = openTransactions) => <IncomeEvidence
    series={kind === "income" ? before : pay} total={kind === "income" ? incomePence / 100 : expectedPay}
    hidden={hidden} state={state} payday={kind === "pay"} onTransactions={onTransactions} onRetry={() => setState("income")} />;

  const incomeRow = (kind: Detail) => {
    const title = kind === "income" ? "Income before payday" : "Expected pay";
    const value = kind === "income" ? <MoneyText text={incomingMoney(incomePence / 100, hidden)} /> : noPay ? "Not known yet" : <><MoneyText text={`About ${incomingMoney(expectedPay, hidden, false)}`} /><small>Due Tue 1 Dec</small></>;
    return variant === "a" ? <details className={styles.incomeDisclosure} open={initialDetail === kind} data-income-row={kind}>
      <DisclosureSummary className={`${styles.summary} ${styles.incomeSummary}`}><span>{title}</span><span className={styles.summaryValue}>{value}</span></DisclosureSummary>
      {evidence(kind)}
    </details> : <div className={styles.incomeDisclosure} data-income-row={kind}>
      <button type="button" onClick={() => setSheet(kind)} className={styles.sheetRow} aria-haspopup="dialog"><span className={styles.rowLabel}>{title}</span><span className={styles.summaryValue}>{value}<small>See what is counted</small></span></button>
    </div>;
  };

  const working = <section className={styles.disclosures} aria-label="Estimate details">
    <details className={styles.disclosure}>
      <DisclosureSummary className={styles.summary}><span>What this estimate counts</span></DisclosureSummary>
      <div className={styles.body}><p>It doesn&apos;t include other accounts, payments still pending, or bills Sorted hasn&apos;t spotted yet.</p><p>An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.</p></div>
    </details>
    <details className={styles.disclosure} open data-working>
      <DisclosureSummary ref={workingRef} className={styles.summary}><span>How we got</span><span className={styles.amount}><MoneyText text={money(left, hidden, false)} /></span></DisclosureSummary>
      <div className={styles.body}>
        <dl>
          <div className={styles.ledgerRow}><dt>Your current accounts after predicted money in and out before payday<span>Across counted current accounts.</span></dt><dd><MoneyText text={money((leftPence + RESERVES_PENCE) / 100, hidden)} /></dd></div>
          <div className={styles.ledgerRow}><dt>Buffer</dt><dd><MoneyText text={money(-100, hidden)} /></dd></div>
          <div className={styles.ledgerRow}><dt>Goal contributions</dt><dd><MoneyText text={money(-300, hidden)} /></dd></div>
          <div className={styles.ledgerRow}><dt>Set-asides</dt><dd><MoneyText text={money(-200, hidden)} /></dd></div>
          <div className={`${styles.ledgerRow} ${styles.total}`}><dt>Left to spend</dt><dd><MoneyText text={money(left, hidden)} /></dd></div>
        </dl>
        <p className={styles.ledgerNote}>Each current account on its own: its balance plus the money expected in, less the payments expected out. A move between your own accounts does not change it.</p>
        <dl className={styles.facts}><div className={styles.fact}><dt>Daily amount</dt><dd>{left < 0 ? "Not available" : <MoneyText text={`${money(left / DAYS_LEFT, hidden)} a day`} />}</dd></div></dl>
        {incomeRow("pay")}
        {incomeRow("income")}
        {syncing && <p className={styles.freshness}>Using your last known figures while bank data updates.</p>}
        <p className={styles.freshness}>Last updated 9 Nov, 10:24</p>
      </div>
    </details>
    <details className={styles.disclosure}>
      <DisclosureSummary className={styles.summary}><span>Card spending this pay period</span><span className={styles.amount}><MoneyText text={money(368.47, hidden, false)} /></span></DisclosureSummary>
      <div className={styles.body}><p>Known card repayments due before payday are included in your estimate. Card purchases aren&apos;t deducted again.</p></div>
    </details>
  </section>;

  return <div data-g446-preview data-ready={ready} className={`${styles.page} ${dark ? "dark" : ""}`}>
    <a className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:text-indigo-700" href="#g446-content">Skip to preview</a>
    <div className={styles.container}>
      {!clean && <header className={styles.reviewHeader}>
        <Link className={styles.link} href="/design">All design previews</Link>
        <h1>Explain income before payday</h1>
        <p>G446 · Two proposals for the income rows inside the existing working. Fictional accounts and local category changes only. The Home context and recalculation are illustrative; this round proposes the income evidence.</p>
        <nav className={styles.variants} aria-label="Design variants">
          <Link className={styles.control} href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · Explain in place</Link>
          <Link className={styles.control} href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Income detail sheet</Link>
        </nav>
        <p>{variant === "a" ? "A opens the payments and their history directly beneath each income row." : "B keeps the working compact and opens the same evidence in a focused sheet."} The working starts open for review. Penny uses the same list.</p>
        <details className={styles.examples}>
          <DisclosureSummary>Examples and display</DisclosureSummary>
          <div className={styles.controls}>
            <label className={styles.selectLabel}>Example<select value={initialState} onChange={event => { window.location.href = href({ state: event.target.value }); }}>{PREVIEW_STATES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <Link className={styles.control} href={href({ mode: dark ? "light" : "dark" })}>{dark ? "Light theme" : "Dark theme"}</Link>
            <button type="button" className={styles.control} aria-pressed={hidden} onClick={() => setHidden(value => !value)}>{hidden ? "Show balances" : "Hide balances"}</button>
            <button type="button" className={styles.control} onClick={() => { setCategories({}); setNotice(""); setState(initialState); setTransactionIds(null); setSheet(null); }}>Reset example</button>
          </div>
        </details>
      </header>}
      <div id="g446-content" tabIndex={-1} role="region" aria-label="Income evidence preview" className="outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
      {clean && <p className={styles.notice}>Illustrative preview · fictional accounts and local example changes</p>}
      {notice && <p className={styles.notice} role="status"><MoneyText text={notice} /></p>}
      {transactionIds ? <div className={styles.transactions} ref={transactionsRef}>
        <TransactionHistory series={allSeries.filter(item => transactionIds.includes(item.id))} categories={categories} hidden={hidden} simulateSaveError={state === "save-error"} onSave={onSaveCategory} onBack={backToEstimate} />
      </div> : <>
        <nav className={styles.surfaceTabs} aria-label="Preview surface"><Link className={styles.control} href={href({ surface: "home" })} aria-current={surface === "home" ? "page" : undefined}>Home</Link><Link className={styles.control} href={href({ surface: "penny" })} aria-current={surface === "penny" ? "page" : undefined}>Penny</Link></nav>
        <div className={styles.grid}>
          <section className={styles.column} data-mobile-hidden={surface !== "home"} aria-label="Home preview">
            <h2 className={styles.surfaceTitle}>Home</h2>
            <div className={styles.hero}>
              <div className={styles.heroHead}><p className={styles.eyebrow}>{left < 0 ? "Shortfall before payday" : "Estimated left to spend"}</p><span className={`${styles.status} ${syncing ? styles.neutral : left < 0 ? styles.risk : ""}`}>{syncing ? "Updating" : left < 0 ? "Short" : "Looks on track"}</span></div>
              <p className={`${styles.heroMoney} ${syncing ? styles.neutral : ""}`}><MoneyText text={money(left, hidden, false)} /></p>
              <p>{syncing ? "Last known amount · as of 10:24" : left < 0 ? "Your accounts look short after expected payments, your buffer, goals and set-asides." : "Across your counted current accounts, after expected payments, your buffer, goals and set-asides."}</p>
              <p className={styles.counts}>Based on your connected current accounts and the bills Sorted knows about.</p>
              <p className={styles.period}>Until Tue 1 Dec · 22 days</p>
            </div>
            {working}
          </section>
          <section className={styles.column} data-mobile-hidden={surface !== "penny"} aria-label="Penny answer preview">
            <h2 className={styles.surfaceTitle}>In Penny</h2>
            <p className={styles.question}>What is behind my left to spend?</p>
            <div className={styles.penny}>
              <p><MoneyText text={`Your estimated left to spend is ${money(left, hidden, false)} until 1 Dec, after predicted money in and out, your buffer, goals and set-asides.`} />{syncing ? " This is the last known amount while your bank data updates." : ""}</p>
              <h3>Income before payday · <MoneyText text={incomingMoney(incomePence / 100, hidden)} /></h3>
              {evidence("income")}
              <h3>Expected pay · {noPay ? "not known yet" : <MoneyText text={incomingMoney(expectedPay, hidden)} />}</h3>
              {evidence("pay")}
              <p className={styles.freshness}>An estimate from your bank data. Check your bank for your latest balance.</p>
            </div>
          </section>
        </div>
      </>}
      </div>
    </div>
    {sheet && <SheetFrame title={sheet === "income" ? "Income before payday" : "Expected pay"} themeClass={dark ? "dark" : ""} onClose={() => setSheet(null)} footer={({ close }) => <div className={styles.sheetContent}><button type="button" className={styles.allTransactions} onClick={close}>Back to the working</button></div>}>
      {({ closeThen }) => <div className={styles.sheetContent}>
        <p className={styles.sheetTotal}>{sheet === "pay" && noPay ? "Not known yet" : <MoneyText text={incomingMoney(sheet === "income" ? incomePence / 100 : expectedPay, hidden)} />}<small>{sheet === "income" ? "Expected before Tue 1 Dec" : "Expected on Tue 1 Dec"} · {historyStatus}</small></p>
        {evidence(sheet, items => closeThen(() => openTransactions(items)))}
      </div>}
    </SheetFrame>}
  </div>;
}
