"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff, ShieldCheck, TriangleAlert } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import styles from "./preview.module.css";

type FixtureName = "one" | "two" | "overdue" | "none";

type Fixture = {
  source: { name: string; amount: number }[];
  destination: string;
  amount: number;
  payments: number;
  paymentsTotal: number;
  firstDue: string;
  lastDue: string;
  overdue?: boolean;
};

const fixtures: Record<FixtureName, Fixture> = {
  one: { source: [{ name: "Barclays current account", amount: 300 }], destination: "Bills account", amount: 300, payments: 14, paymentsTotal: 957, firstDue: "Monday", lastDue: "31 Oct" },
  two: { source: [{ name: "Barclays current account", amount: 180 }, { name: "Starling personal", amount: 120 }], destination: "Bills account", amount: 300, payments: 14, paymentsTotal: 957, firstDue: "Monday", lastDue: "31 Oct" },
  overdue: { source: [{ name: "Barclays current account", amount: 76 }], destination: "Bills account", amount: 76, payments: 3, paymentsTotal: 214, firstDue: "yesterday", lastDue: "31 Oct", overdue: true },
  none: { source: [], destination: "Bills account", amount: 0, payments: 14, paymentsTotal: 957, firstDue: "Monday", lastDue: "31 Oct" },
};

const labels: Record<FixtureName, string> = { one: "One source", two: "Two sources", overdue: "Overdue payment", none: "No move needed" };
const money = (amount: number, hidden: boolean) => hidden ? "£••••" : `£${amount.toLocaleString("en-GB")}`;

function Route({ fixture }: { fixture: Fixture }) {
  const from = fixture.source.length === 1 ? fixture.source[0].name : `${fixture.source.length} accounts`;
  return <div className={styles.route} aria-label={`From ${from} to ${fixture.destination}`}>
    <span><small>From</small><strong>{from}</strong></span><ArrowRight size={17} aria-hidden="true" /><span><small>To</small><strong>{fixture.destination}</strong></span>
  </div>;
}

function Breakdown({ fixture, hidden, variant }: { fixture: Fixture; hidden: boolean; variant: "a" | "b" }) {
  return <details className={styles.breakdown}>
    <summary>{variant === "a" ? "How this move is worked out" : "Move and payment details"}<ChevronDown size={17} aria-hidden="true" /></summary>
    <div className={styles.detailBody}>
      {fixture.source.map((source) => <div className={styles.detailLine} key={source.name}><span>From {source.name}</span><strong>{money(source.amount, hidden)}</strong></div>)}
      <div className={styles.detailLine}><span>Already in the Bills account</span><strong>{money(fixture.paymentsTotal - fixture.amount, hidden)}</strong></div>
      <div className={styles.detailLine}><span>{fixture.payments} payments in the Bills account</span><strong>{money(fixture.paymentsTotal, hidden)}</strong></div>
      <p>Moving {money(fixture.amount, hidden)} brings the Bills account up to what it needs. The {money(fixture.paymentsTotal, hidden)} is the total of the payments it protects, not an extra amount to move.</p>
    </div>
  </details>;
}

function CardA({ fixture, hidden }: { fixture: Fixture; hidden: boolean }) {
  if (!fixture.amount) return <section className={styles.card}><div className={styles.kicker}><PennyMark size={14} />Penny · Cover plan</div><h2>No move needed</h2><p className={styles.copy}>Your Bills account already covers {fixture.payments} upcoming payments through {fixture.lastDue}.</p><a className={styles.action} href="#due">See what’s due</a></section>;
  return <section className={styles.card}>
    <div className={styles.kicker}><PennyMark size={14} />Penny · Cover plan</div>
    <div className={styles.lead}><div><p className={styles.eyebrow}>Suggested move</p><h2 className={styles.amount}>{money(fixture.amount, hidden)}</h2></div><p className={fixture.overdue ? styles.risk : styles.paymentNote}>{fixture.overdue ? <><TriangleAlert size={15} aria-hidden="true" />1 payment overdue</> : <>{fixture.payments} payments covered<br />First due {fixture.firstDue}</>}</p></div>
    <Route fixture={fixture} />
    <p className={styles.assurance}>{fixture.overdue ? `This would provide the money for ${fixture.payments} payments. Check whether the overdue payment still needs paying.` : `This would cover ${fixture.payments} payments through ${fixture.lastDue}.`} Your {fixture.source.length === 1 ? "source account still covers its own bills" : "source accounts still cover their own bills"}.</p>
    <Breakdown fixture={fixture} hidden={hidden} variant="a" />
    <a className={styles.action} href="#due">See what’s due</a>
  </section>;
}

function CardB({ fixture, hidden }: { fixture: Fixture; hidden: boolean }) {
  if (!fixture.amount) return <CardA fixture={fixture} hidden={hidden} />;
  return <section className={styles.card}>
    <div className={styles.kicker}><PennyMark size={14} />Penny · Cover plan</div>
    <h2>Cover {fixture.payments} {fixture.overdue ? "payments" : "upcoming payments"}</h2>
    <p className={styles.copy}>{fixture.overdue ? "One payment is overdue. Check whether it still needs paying." : `From ${fixture.firstDue} to ${fixture.lastDue}.`}</p>
    <div className={styles.answer}><span><small>Suggested move to Bills</small><strong>{money(fixture.amount, hidden)}</strong></span>{fixture.overdue ? <span className={styles.risk}><TriangleAlert size={15} aria-hidden="true" />Overdue</span> : <span>{fixture.payments} payments</span>}</div>
    <Route fixture={fixture} />
    <Breakdown fixture={fixture} hidden={hidden} variant="b" />
    <p className={styles.assurance}>Your {fixture.source.length === 1 ? "source account still covers its own bills" : "source accounts still cover their own bills"}.</p>
    <a className={styles.action} href="#due">See what’s due</a>
  </section>;
}

export default function Preview() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const initialFixture = (Object.keys(fixtures) as FixtureName[]).includes(params.get("state") as FixtureName) ? params.get("state") as FixtureName : "one";
  const [state, setState] = useState<FixtureName>(initialFixture);
  const [dark, setDark] = useState(params.get("mode") !== "light");
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  const [ready, setReady] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; setReady(true); }, [dark]);
  const href = (next: string) => `?${new URLSearchParams({ variant: next, state, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0" })}`;
  const fixture = fixtures[state];
  return <main className={styles.page} data-g383-ready={ready}>
    <div className={styles.shell}>
      <a className={styles.back} href="/design"><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <header className={styles.review}><h1>Cover plan move card · G383</h1><p>Two ways to make one recommendation legible: one suggested amount, a clear route and one detail disclosure. Synthetic examples only, no transfer is made.</p>
        <nav className={styles.controls} aria-label="Design options"><a href={href("a")} aria-current={variant === "a" ? "page" : undefined} className={variant === "a" ? styles.selected : ""}>A · One move, one reason</a><a href={href("b")} aria-current={variant === "b" ? "page" : undefined} className={variant === "b" ? styles.selected : ""}>B · Payment-led</a></nav>
        <details className={styles.examples}><summary>Examples and display</summary><label>Example<select value={state} onChange={event => setState(event.target.value as FixtureName)}>{(Object.keys(fixtures) as FixtureName[]).map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label><div className={styles.controls}><button type="button" onClick={() => setDark(value => !value)}>{dark ? "Light theme" : "Dark theme"}</button><button type="button" onClick={() => setHidden(value => !value)}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{hidden ? "Show figures" : "Hide figures"}</button></div></details>
      </header>
      <div className={styles.preview}>{variant === "a" ? <CardA fixture={fixture} hidden={hidden} /> : <CardB fixture={fixture} hidden={hidden} />}</div>
      <p id="due" className={styles.note}>Preview action only. In the product, this would open Upcoming so you can review the payments before making a transfer in your bank.</p>
    </div>
  </main>;
}
