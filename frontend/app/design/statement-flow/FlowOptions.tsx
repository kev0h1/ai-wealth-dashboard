"use client";

import { useId, useRef, useState } from "react";
import { ArrowRight, FileText, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { STATEMENT_FLOW_STEPS, STATEMENT_PRIVACY_LINE, STAY_CURRENT_COPY } from "@/lib/investmentFlow";
import s from "./flow.module.css";

export type NewVariant = "c" | "d" | "e";

function Paper({ note = false }: { note?: boolean }) {
  return <div className={`${s.paper} ${note ? s.note : ""}`} aria-hidden="true">
    {note ? <ReceiptText size={19} /> : <FileText size={22} />}
    <span className={s.paperTitle}>{note ? "Contract note" : "Statement"}</span>
    <span className={s.inkLine} /><span className={s.inkLine} />
    <span className={s.paperValue}>{note ? "+2 bought" : "12 units"}</span>
  </div>;
}

function PaperBridge() {
  return <>
    <h3 className={s.heading}>From a PDF to your portfolio</h3>
    <div className={s.bridge} aria-hidden="true">
      <div className={s.papers}><Paper /><Paper note /></div>
      <ArrowRight className={s.bridgeArrow} size={19} />
      <div className={s.portfolio}>
        <span className={s.portfolioLabel}>Your holdings</span>
        <strong>14 <span>units</span></strong>
        <span className={s.refresh}><RefreshCw size={14} />Daily prices</span>
      </div>
    </div>
    <p className={s.example}>Illustrative example: 12 units + 2 bought = 14 units.</p>
    <ol className={s.steps}>
      {STATEMENT_FLOW_STEPS.map((step, i) => <li key={step.key}>
        <span className={s.stepNumber}>{i + 1}</span>
        <div><strong>{step.label}</strong><span>{step.line}</span></div>
      </li>)}
    </ol>
  </>;
}

function AccountLedger() {
  return <>
    <h3 className={s.heading}>One portfolio, kept up to date</h3>
    <p className={s.intro}>You add the documents. Prices refresh each day.</p>
    <div className={s.ledger}>
      <div className={s.ledgerHead}><FileText size={17} /><strong>Example holding</strong><span>Units</span></div>
      <div className={s.ledgerRow}>
        <div><strong>Statement</strong><span>Sets your holdings and units.</span></div><b>12</b>
      </div>
      <div className={s.ledgerRow}>
        <div><strong>Contract note</strong><span>Add each buy or sell between statements.</span></div><b>+2</b>
      </div>
      <div className={s.ledgerTotal}><span>Holdings after this buy</span><b>14 units</b></div>
      <div className={s.priceBand}><RefreshCw size={19} /><div><strong>Daily prices</strong><span>Refresh the value of those 14 units.</span></div></div>
    </div>
    <p className={s.example}>Illustrative example, not your holdings.</p>
  </>;
}

function StepThrough() {
  const [step, setStep] = useState(0);
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels = ["Statement", "Trades", "Prices"];
  return <>
    <h3 className={s.heading}>How your portfolio takes shape</h3>
    <div className={s.tabs} role="tablist" aria-label="Statement flow" onKeyDown={event => {
      let next = step;
      if (event.key === "ArrowRight") next = (step + 1) % 3;
      else if (event.key === "ArrowLeft") next = (step + 2) % 3;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 2;
      else return;
      event.preventDefault(); setStep(next); refs.current[next]?.focus();
    }}>
      {labels.map((label, i) => <button key={label} ref={el => { refs.current[i] = el; }} type="button"
        role="tab" aria-selected={step === i} aria-controls={`${id}-panel-${i}`} id={`${id}-tab-${i}`}
        tabIndex={step === i ? 0 : -1} onClick={() => setStep(i)}>
        <span>{i + 1}</span>{label}
      </button>)}
    </div>
    {STATEMENT_FLOW_STEPS.map((item, i) => <div key={item.key} role="tabpanel" id={`${id}-panel-${i}`}
      aria-labelledby={`${id}-tab-${i}`} hidden={step !== i} className={s.tabPanel}>
      <div className={s.stageArt} aria-hidden="true">
        {i < 2 ? <Paper note={i === 1} /> : <div className={s.priceArt}><RefreshCw size={30} /><span>Daily price check</span><i /><i /><i /></div>}
      </div>
      <div className={s.stageCopy}><strong>{item.label}</strong><p>{item.line}</p>
        <span>{i === 0 ? "Start by importing your statement above." : i === 1 ? "Add a contract note whenever you trade." : "Prices may be delayed."}</span>
      </div>
    </div>)}
  </>;
}

export default function FlowOptions({ variant }: { variant: NewVariant }) {
  return <section className={s.root} aria-label="How statement imports work">
    {variant === "c" ? <PaperBridge /> : variant === "d" ? <AccountLedger /> : <StepThrough />}
    {variant !== "e" && <p className={s.caveat}>Add contract notes when you trade. Prices may be delayed.</p>}
    <details className={s.details}><summary>When you add a new statement</summary><p>{STAY_CURRENT_COPY}</p></details>
    <p className={s.privacy}><ShieldCheck size={18} aria-hidden="true" /><span>{STATEMENT_PRIVACY_LINE}</span></p>
  </section>;
}
