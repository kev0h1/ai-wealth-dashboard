"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronDown, Eye, EyeOff, Info, RefreshCw } from "lucide-react";
import styles from "./preview.module.css";

type Variant = "a" | "b";
type State = "covered" | "pennies" | "payments-short" | "plans-gap" | "checking" | "unknown" | "error";

type Example = {
  balance: number;
  available?: number;
  after?: number;
  lowest?: number;
  shortfall?: number;
  moveSuggested?: boolean;
};

const examples: Record<State, Example> = {
  covered: { balance: 108.36, available: 108.36, after: 108.36, lowest: 108.36 },
  pennies: { balance: 41.06, available: 0.06, after: 0.06, lowest: 0.06 },
  "payments-short": { balance: 89, available: 0, after: -288.65, lowest: -288.65, shortfall: 288.65, moveSuggested: true },
  "plans-gap": { balance: 41, available: 0, after: 0.06, lowest: -18.12, shortfall: 18.12 },
  checking: { balance: 89 },
  unknown: { balance: 89 },
  error: { balance: 89 },
};

const stateLabels: Record<State, string> = {
  covered: "Covered",
  pennies: "6p available",
  "payments-short": "Payments short",
  "plans-gap": "Plans gap",
  checking: "Checking",
  unknown: "Not available yet",
  error: "Could not check",
};

function formatRoundedMoney(value: number, hidden: boolean) {
  if (hidden) return value < 0 ? "−£••••" : "£••••";
  return `${value < 0 ? "−" : ""}£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
}

function formatExactMoney(value: number, hidden: boolean) {
  if (hidden) return value < 0 ? "−£••••" : "£••••";
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function AccountMark() {
  return <span className={styles.mark} aria-hidden="true">N</span>;
}

function Working({ example, hidden }: { example: Example; hidden: boolean }) {
  if (example.after === undefined || example.lowest === undefined) return null;
  return <details className={styles.working}>
    <summary>Working <ChevronDown size={16} aria-hidden="true" /></summary>
    <dl>
      <div><dt>After payments and plans</dt><dd>{formatExactMoney(example.after, hidden)}</dd></div>
      <div><dt>Lowest point before payday</dt><dd>{formatExactMoney(example.lowest, hidden)}</dd></div>
    </dl>
    <p>Estimate from your bank data until Friday.</p>
  </details>;
}

function Availability({ variant, state, example, hidden, compact = false }: { variant: Variant; state: State; example: Example; hidden: boolean; compact?: boolean }) {
  if (state === "checking") return <p className={styles.status}><RefreshCw size={13} aria-hidden="true" /> Checking availability</p>;
  if (state === "unknown") return <p className={styles.status}><Info size={13} aria-hidden="true" /> Availability not available yet</p>;
  if (state === "error") return <p className={styles.status}><Info size={13} aria-hidden="true" /> Could not check availability</p>;
  const paymentRisk = state === "payments-short";
  const plansGap = state === "plans-gap";
  const amount = formatRoundedMoney(example.available ?? 0, hidden);
  const shortfall = formatRoundedMoney(example.shortfall ?? 0, hidden);
  if (variant === "a") return <div className={`${styles.availability} ${compact ? styles.compact : ""}`}>
    <p>Available: <strong>{amount}</strong></p>
    {paymentRisk && <p className={styles.risk}><AlertTriangle size={13} aria-hidden="true" /><span>{shortfall} short before payday</span></p>}
    {plansGap && <p className={styles.plan}><Info size={13} aria-hidden="true" /><span>{shortfall} short for plans</span></p>}
  </div>;
  return <div className={`${styles.availability} ${styles.verdict} ${compact ? styles.compact : ""}`}>
    <p><span>Available</span> <strong>{amount}</strong></p>
    {paymentRisk && <p className={styles.risk}><AlertTriangle size={13} aria-hidden="true" /><span>This account is {shortfall} short before payday</span></p>}
    {plansGap && <p className={styles.plan}><Info size={13} aria-hidden="true" /><span>This account is {shortfall} short for plans</span></p>}
  </div>;
}

function AccountRow({ variant, state, example, hidden }: { variant: Variant; state: State; example: Example; hidden: boolean }) {
  return <div className={styles.row}>
    <AccountMark />
    <div className={styles.accountName}><strong>The Number One</strong><span>NATWEST · Current</span></div>
    <div className={styles.rowFigures}><strong>{formatRoundedMoney(example.balance, hidden)}</strong><Availability variant={variant} state={state} example={example} hidden={hidden} compact /></div>
  </div>;
}

function Detail({ variant, state, example, hidden, moveSuggested }: { variant: Variant; state: State; example: Example; hidden: boolean; moveSuggested: boolean }) {
  const paymentRisk = state === "payments-short";
  return <section className={`${styles.detail} ${variant === "b" ? styles.detailB : ""}`} aria-label="Account detail">
    <div className={styles.detailHead}><div><h3>The Number One</h3><p>NatWest · Current account</p></div><strong>{formatRoundedMoney(example.balance, hidden)}</strong></div>
    <Availability variant={variant} state={state} example={example} hidden={hidden} />
    {paymentRisk && moveSuggested && <a href="#cover-plan" className={styles.cover}>A cover plan could help <span aria-hidden="true">→</span></a>}
    <Working example={example} hidden={hidden} />
  </section>;
}

export default function Preview() {
  const search = useSearchParams();
  const [variant, setVariant] = useState<Variant>(search.get("variant") === "b" ? "b" : "a");
  const initialState = (Object.keys(examples) as State[]).includes(search.get("state") as State) ? search.get("state") as State : "payments-short";
  const [state, setState] = useState<State>(initialState);
  const [dark, setDark] = useState(search.get("mode") !== "light");
  const [hidden, setHidden] = useState(search.get("hidden") === "1");
  const [moveSuggested, setMoveSuggested] = useState(true);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; }, [dark]);
  const example = examples[state];

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.review}>
        <a href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
        <h1>Account availability · G385</h1>
        <p>Two compact readings for the same account row. Available never goes below zero. A real payment shortfall is named beside it, not hidden in the working.</p>
        <div className={styles.controls} aria-label="Preview controls">
          <div role="group" aria-label="Design option">{(["a", "b"] as Variant[]).map((item) => <button key={item} type="button" aria-pressed={variant === item} className={variant === item ? styles.selected : ""} onClick={() => setVariant(item)}>{item === "a" ? "A · Paired figures" : "B · Verdict line"}</button>)}</div>
          <label>Example<select value={state} onChange={(event) => setState(event.target.value as State)}>{(Object.keys(examples) as State[]).map((item) => <option key={item} value={item}>{stateLabels[item]}</option>)}</select></label>
          <button type="button" onClick={() => setDark(!dark)}>{dark ? "Light theme" : "Dark theme"}</button>
          <button type="button" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{hidden ? "Show figures" : "Hide figures"}</button>
          {state === "payments-short" && <label className={styles.check}><input type="checkbox" checked={moveSuggested} onChange={(event) => setMoveSuggested(event.target.checked)} /> Cover plan suggested</label>}
        </div>
      </header>

      <section className={styles.canvas}>
        <div className={styles.pageTitle}><div><h2>Your accounts</h2><p>Account balances and what is available to spend.</p></div><span aria-hidden="true"><RefreshCw size={18} /></span></div>
        <section className={styles.list} aria-label="Accounts list"><div className={styles.listHeading}><div><h3>Current</h3><p>1 account</p></div><strong>{formatRoundedMoney(example.balance, hidden)}</strong></div><AccountRow variant={variant} state={state} example={example} hidden={hidden} /></section>

        <section className={styles.home} aria-label="Home Your estate"><p className={styles.eyebrow}>Your estate</p><h3>Where you can spend</h3><div className={styles.homeRow}><AccountMark /><div><strong>The Number One</strong><Availability variant={variant} state={state} example={example} hidden={hidden} /></div><strong>{formatRoundedMoney(example.balance, hidden)}</strong></div></section>

        <p className={styles.eyebrow}>Account detail</p><Detail variant={variant} state={state} example={example} hidden={hidden} moveSuggested={moveSuggested} />
        <p id="cover-plan" className={styles.note}>{state === "payments-short" && moveSuggested && <>The cover plan link would open the suggested move for this account. </>}<strong>Why these figures relate:</strong> Available uses the conservative Spend from limit. The shortfall is the account’s lowest known point before payday. Plans-only gaps stay informational, not red.</p>
      </section>
    </div>
  </main>;
}
