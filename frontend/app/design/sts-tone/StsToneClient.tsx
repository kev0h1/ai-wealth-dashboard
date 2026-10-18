"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { deriveSafeToSpendHeadline } from "@/lib/pennyScreenViews";
import { SCENARIOS, SCENARIO_ORDER, type Scenario } from "./fixtures";
import styles from "./sts-tone.module.css";

type Variant = "a" | "b";
type Mode = "light" | "dark";

function amount(value: number, masked: boolean, signed = false) {
  if (masked) return signed && value < 0 ? "−£••••" : "£••••";
  return `${signed && value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function maskSentence(text: string, masked: boolean) {
  return masked ? text.replace(/[−-]?£[\d,]+(?:\.\d+)?/g, "£••••") : text;
}

function Ledger({ scenario, masked }: { scenario: Scenario; masked: boolean }) {
  const data = SCENARIOS[scenario].data;
  if (!data) return null;
  const plans = (data.commitments_reserved ?? 0) + (data.allocations_reserved ?? 0);
  return (
    <dl className={styles.ledger} aria-label="Safe to Spend working">
      <div className={styles.row}><dt>Available across counted accounts</dt><dd><MoneyText text={amount(data.spendable_now ?? 0, masked)} /></dd></div>
      <div className={styles.row}><dt>Bills due before payday</dt><dd><MoneyText text={`−${amount(data.bills_total, masked)}`} /></dd></div>
      {data.buffer > 0 && <div className={styles.row}><dt>Buffer held back</dt><dd><MoneyText text={`−${amount(data.buffer, masked)}`} /></dd></div>}
      {plans > 0 && <div className={styles.row}><dt>Plans and envelopes held back</dt><dd><MoneyText text={`−${amount(plans, masked)}`} /></dd></div>}
      <div className={`${styles.row} ${styles.total}`}><dt><strong>Safe to Spend</strong></dt><dd><strong><MoneyText text={amount(data.safe_to_spend, masked, true)} /></strong></dd></div>
    </dl>
  );
}

function ActionDetail({ scenario, masked }: { scenario: Scenario; masked: boolean }) {
  const data = SCENARIOS[scenario].data;
  if (!data) return null;
  if (scenario === "move") return <>
    <p className={styles.subtle}>An account gap, not a shortage across all counted accounts.</p>
    <dl className={styles.ledger}>
      <div className={styles.row}><dt>Barclays balance</dt><dd><MoneyText text={amount(0, masked)} /></dd></div>
      <div className={styles.row}><dt>Payment due Monday</dt><dd><MoneyText text={`−${amount(80, masked)}`} /></dd></div>
      <div className={`${styles.row} ${styles.total}`}><dt>Barclays gap</dt><dd><MoneyText text={amount(-80, masked, true)} /></dd></div>
    </dl>
    <p className={styles.subtle} style={{ marginTop: 20 }}>Monzo has <MoneyText text={amount(265, masked)} /> after its buffer. Moving <MoneyText text={amount(80, masked)} /> from Monzo to Barclays could cover this payment, leaving Monzo <MoneyText text={amount(185, masked)} />. The pooled estimate stays <MoneyText text={amount(185, masked)} />.</p>
    <p className={styles.subtle} style={{ marginTop: 12 }}>Nothing has moved. You would make any transfer with your bank; Barclays stays short until then.</p>
  </>;
  if (scenario === "plans") return <>
    <p className={styles.subtle}>Payments and the buffer are covered. These are the optional amounts still held back in this example.</p>
    <dl className={styles.ledger}>
      <div className={styles.row}><dt>Goal contribution</dt><dd><MoneyText text={amount(100, masked)} /></dd></div>
      <div className={styles.row}><dt>Envelope reserve</dt><dd><MoneyText text={amount(150, masked)} /></dd></div>
      <div className={`${styles.row} ${styles.total}`}><dt>Planned reserves</dt><dd><MoneyText text={amount(250, masked)} /></dd></div>
    </dl>
    <p className={styles.subtle} style={{ marginTop: 20 }}>In the product this would lead to the relevant plan or set-aside editor. This prototype changes neither the reserve nor your bank balance.</p>
  </>;
  return <>
    <p className={styles.subtle}>The payment forecast and cash available are shown together so you can inspect the gap. This is illustrative evidence, not a payment instruction.</p>
    <dl className={styles.ledger}>
      <div className={styles.row}><dt>Counted cash available</dt><dd><MoneyText text={amount(data.spendable_now ?? 0, masked)} /></dd></div>
      <div className={styles.row}><dt>{scenario === "urgent" ? "Payment expected tomorrow" : "Payments expected before payday"}</dt><dd><MoneyText text={`−${amount(scenario === "urgent" ? 573 : data.bills_total, masked)}`} /></dd></div>
      {scenario === "urgent" && <div className={styles.row}><dt>Other payments before payday</dt><dd><MoneyText text={`−${amount(350, masked)}`} /></dd></div>}
      <div className={`${styles.row} ${styles.total}`}><dt>Cash after these payments</dt><dd><MoneyText text={amount(data.lowest_projected_balance ?? 0, masked, true)} /></dd></div>
    </dl>
    <p className={styles.subtle} style={{ marginTop: 20 }}>The forecast leaves some payments without enough cash. A move between the counted accounts would not change this total. Check the payment dates and amounts with the provider before deciding what to do.</p>
  </>;
}

function Evidence({ scenario, masked }: { scenario: Scenario; masked: boolean }) {
  const item = SCENARIOS[scenario];
  const data = item.data;
  if (!data) return null;
  const isMove = scenario === "move";
  const plans = scenario === "plans";
  return (
    <section className={styles.evidence} aria-label="Evidence and next step">
      <h2 className={styles.evidenceTitle}>Why this needs attention</h2>
      {isMove ? <>
        <p className={styles.subtle} style={{ marginTop: 8 }}>Barclays has <MoneyText text={amount(0, masked)} /> for an <MoneyText text={amount(80, masked)} /> Monday bill. Monzo has <MoneyText text={amount(365, masked)} />, with <MoneyText text={amount(100, masked)} /> kept as its buffer, leaving <MoneyText text={amount(265, masked)} /> spare. The pooled forecast still has <MoneyText text={amount(185, masked)} /> left.</p>
        <p className={styles.subtle} style={{ marginTop: 10 }}>Consider moving money from Monzo to Barclays before Monday. This is a recommendation, not a transfer.</p>
      </> : plans ? <>
        <p className={styles.subtle} style={{ marginTop: 8 }}>Payments are covered. The gap comes from <MoneyText text={amount(250, masked)} /> held for plans and envelopes.</p>
        <p className={styles.subtle} style={{ marginTop: 10 }}>Plans are optional reserves, not bills due from your account.</p>
      </> : <>
        <p className={styles.subtle} style={{ marginTop: 8 }}><MoneyText text={maskSentence(item.note, masked)} /></p>
        {(scenario === "habitual" || scenario === "long") && <p className={styles.subtle} style={{ marginTop: 10 }}>Proposed evidence view: comparable completed periods were short in 4 of 6. This history is not currently available from the product API.</p>}
        {item.history === "withheld" && <p className={styles.subtle} style={{ marginTop: 10 }}>Comparable completed-period history is unknown, so it is withheld.</p>}
      </>}
      {data.lowest_projected_balance != null && <div className={styles.ledger}>
        <div className={styles.row}><span>Lowest cash forecast before buffer</span><strong><MoneyText text={amount(data.lowest_projected_balance, masked, true)} /></strong></div>
        <p className={styles.subtle}>The low point is after dated payments and before the buffer.</p>
      </div>}
    </section>
  );
}

export default function StsToneClient() {
  const params = useSearchParams();
  return <StsToneState key={params.toString()} params={params} />;
}

function StsToneState({ params }: { params: { get: (key: string) => string | null } }) {
  const rawScenario = params.get("scenario") ?? params.get("state");
  const scenario: Scenario = SCENARIO_ORDER.includes(rawScenario as Scenario) ? rawScenario as Scenario : "habitual";
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const masked = params.get("masked") === "1";
  const [sheet, setSheet] = useState(false);
  const [retried, setRetried] = useState(false);
  const displayScenario: Scenario = scenario === "error" && retried ? "habitual" : scenario === "stale" && retried ? "habitual" : scenario;
  const item = SCENARIOS[displayScenario];
  const data = item.data;
  const headline = data ? deriveSafeToSpendHeadline(data) : null;
  const href = (next: Partial<{ variant: Variant; scenario: Scenario; mode: Mode; masked: boolean }>) => {
    const values = { variant, scenario, mode, masked, ...next };
    return `?variant=${values.variant}&scenario=${values.scenario}&mode=${values.mode}&masked=${values.masked ? "1" : "0"}`;
  };
  const stale = scenario === "stale" && !retried;
  const genuineRisk = !!headline && headline.state === "short" && !headline.plansOnly && !stale;
  const actionLabel = scenario === "error" ? "Try again locally" : item.action;
  const asOf = data?.last_synced ? new Date(data.last_synced).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "unknown";

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", mode === "dark");
    return () => { root.classList.toggle("dark", wasDark); };
  }, [mode]);

  return <div className={`${styles.shell} ${mode === "dark" ? styles.dark : ""}`} style={{ colorScheme: mode }}>
    <main className={styles.main}>
      <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.3, fontWeight: 700 }}>Safe to Spend</h1>
      <p className={styles.intro}>G287 design preview. Synthetic examples. No account changes.</p>
      <nav className={styles.controls} aria-label="Preview controls">
        {(["a", "b"] as Variant[]).map((value) => <Link key={value} className={`${styles.control} ${variant === value ? styles.active : ""}`} href={href({ variant: value })}>{value === "a" ? "A · Quiet instrument" : "B · Next step first"}</Link>)}
      </nav>
      <details className={styles.scenarioMenu}><summary>Examples &amp; display</summary><nav className={styles.scenarioOptions} aria-label="Scenario and display">
        {SCENARIO_ORDER.map((value) => <Link key={value} className={`${styles.control} ${scenario === value ? styles.active : ""}`} href={href({ scenario: value })}>{SCENARIOS[value].label}</Link>)}
        <Link className={styles.control} href={href({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light mode" : "Dark mode"}</Link>
        <Link className={styles.control} href={href({ masked: !masked })}>{masked ? "Show figures" : "Mask figures"}</Link>
      </nav></details>

      {(displayScenario === "loading" || displayScenario === "error") ? <section className={styles.instrument} aria-live="polite">
        {displayScenario === "loading" ? <><div className={styles.loading} /><p className={styles.subtle} style={{ marginTop: 12 }}>Calculating from your bank data. No figures are shown until the estimate is ready.</p></> : <><p className={styles.label}>Safe to Spend</p><h2 style={{ fontSize: 19, margin: "10px 0 0" }}>We could not refresh this estimate</h2><p className={styles.subtle} style={{ marginTop: 8 }}>No figure is shown. Your bank data has not been changed.</p><button className={styles.button} type="button" onClick={() => setRetried(true)}><RefreshCw size={16} aria-hidden="true" /> {actionLabel}</button></>}
      </section> : data && headline ? <div className={styles.grid}>
        <section className={styles.instrument} aria-label="Proposed Safe to Spend instrument">
          {variant === "a" ? <>
            <p className={styles.label}>{stale ? "Last known Safe to Spend" : `Safe to Spend until ${headline.paydayLabel}`}</p>
            <h2 className={`${styles.figure} money`}><MoneyText text={amount(headline.heroAmount, masked)} /></h2>
            <p className={styles.subtle}>{stale ? `Last known gap. Bank data as of ${asOf}. Not a current estimate.` : headline.plansOnly ? "needed after plans and envelopes" : headline.state === "short" ? "needed before payday" : "left until payday"}</p>
            {genuineRisk && <p className={styles.risk}><span className={styles.riskDot} aria-hidden="true" />Payment risk: {scenario === "urgent" ? "a payment is due tomorrow" : "a payment is not covered"}</p>}
          </> : <>
            <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{stale ? "Last known estimate" : scenario === "move" ? "Check the paying account" : headline.plansOnly ? "Check planned reserves" : "Review the payment before payday"}</h2>
            <p className={styles.subtle} style={{ marginTop: 8 }}><MoneyText text={stale ? `Bank data as of ${asOf}. Refresh before relying on this estimate.` : maskSentence(item.note, masked)} /></p>
            <div className={styles.ledger}><div className={styles.row}><span>{stale ? "Last known cash gap" : scenario === "move" ? "Left across counted accounts" : headline.plansOnly ? "Reserved gap" : "Cash needed"}</span><strong><MoneyText text={amount(headline.heroAmount, masked)} /></strong></div></div>
            {genuineRisk && <p className={styles.risk}><AlertTriangle className={styles.riskIcon} size={14} aria-hidden="true" />Payment risk remains until it is covered</p>}
          </>}
          <button type="button" className={styles.button} onClick={() => stale ? setRetried(true) : setSheet(true)}>{item.action} <ArrowRight size={16} aria-hidden="true" /></button>
          <details className={styles.working}><summary>How this adds up</summary><Ledger scenario={displayScenario} masked={masked} /></details>
          <p className={styles.subtle} style={{ marginTop: 16 }}>An estimate from your bank data, not financial advice.</p>
        </section>
        <Evidence scenario={displayScenario} masked={masked} />
      </div> : null}
      {data && <details className={styles.reference}><summary>Current reference · existing Safe to Spend card</summary>{masked ? <p className={styles.subtle}>The reference figures are hidden while masking is on.</p> : <div className={styles.referenceCard} inert><SafeToSpendCard data={data} loading={false} error={false} onRetry={() => {}} previewBalancesVisible /></div>}</details>}
    </main>
    {sheet && data && <SheetFrame title={item.action} description="Preview-only local detail. No bank action will be taken." onClose={() => setSheet(false)} bodyClassName="px-5 py-4" footer={<button type="button" className={styles.button} onClick={() => setSheet(false)}>Close review</button>}>
      <ActionDetail scenario={displayScenario} masked={masked} />
    </SheetFrame>}
  </div>;
}
