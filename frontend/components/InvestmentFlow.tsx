import { ArrowRight, FileText, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { DisclosureSummary } from "./Disclosure";
import { STATEMENT_FLOW_STEPS, STATEMENT_PRIVACY_LINE, STAY_CURRENT_COPY } from "@/lib/investmentFlow";
import s from "./InvestmentFlow.module.css";

function Paper({ note = false }: { note?: boolean }) {
  return <div className={`${s.paper} ${note ? s.note : ""}`} aria-hidden="true">
    {note ? <ReceiptText size={19} /> : <FileText size={22} />}
    <span className={s.paperTitle}>{note ? "Contract note" : "Statement"}</span>
    <span className={s.inkLine} /><span className={s.inkLine} />
    <span className={s.paperValue}>{note ? "+2 bought" : "12 units"}</span>
  </div>;
}

/** G272: approved C, Paper to portfolio. Keep the complete example accessible. */
export default function InvestmentFlow() {
  return <section className={s.root} aria-label="How statement imports work">
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
    <ol className={s.steps} role="list">
      {STATEMENT_FLOW_STEPS.map((step, i) => <li key={step.key}>
        <span className={s.stepNumber} aria-hidden="true">{i + 1}</span>
        <div><strong>{step.label}</strong><span>{step.line}</span></div>
      </li>)}
    </ol>
    <p className={s.caveat}>Add contract notes when you trade. Prices may be delayed.</p>
    <details className={s.details}>
      <DisclosureSummary className="items-center justify-between gap-3">When you add a new statement</DisclosureSummary>
      <p>{STAY_CURRENT_COPY}</p>
    </details>
    <p className={s.privacy}>
      <ShieldCheck size={18} aria-hidden="true" />
      <span>{STATEMENT_PRIVACY_LINE}</span>
    </p>
  </section>;
}
