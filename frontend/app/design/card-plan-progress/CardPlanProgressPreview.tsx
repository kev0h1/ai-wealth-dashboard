"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { DAILY_CHALLENGE_NOTE, GOALS, PREVIEW_STATES, type PlanFixture, type PreviewState } from "./fixtures";
import styles from "./preview.module.css";

type Variant = "a" | "b";
type Mode = "light" | "dark";
type DataState = Exclude<PreviewState, "hidden">;

const states: readonly PreviewState[] = ["ready", "future", "paused", "loading", "stale", "unavailable", "empty", "hidden", "long"];
const stateLabels: Record<PreviewState, string> = { ready: "Ready", future: "Future", loading: "Loading", unavailable: "Unavailable", hidden: "Hidden", long: "Long names", paused: "Paused", stale: "Updating", empty: "Empty" };

function hiddenEvidenceValue(label: string, value: string, hidden: boolean) {
  if (!hidden || !value.includes("£")) return value;
  if (/planned|paid|repayments|reserved/i.test(label)) return "Payment hidden";
  if (/expected by now/i.test(label)) return "Hidden";
  return "Figures hidden";
}

function hiddenPayment(text: string, hidden: boolean) {
  return hidden && text.includes("£") ? "Payment hidden" : text;
}

function DetailSheet({ plan, hidden, onClose }: { plan: PlanFixture | null; hidden: boolean; onClose: () => void }) {
  if (!plan) return null;
  return <SheetFrame title={plan.name} description="Fictional preview evidence only" onClose={onClose} bodyClassName="px-5 py-5">
    <div className={styles.sheetBody}>
      <p>{plan.detailIntro}</p>
      <dl>
        {plan.evidence.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{hiddenEvidenceValue(item.label, item.value, hidden)}</dd></div>)}
      </dl>
      <p className={styles.sheetNote}>This preview does not edit a plan, move money, or open a product route.</p>
    </div>
  </SheetFrame>;
}

function ProgressUnavailable({ hidden, unavailable, id }: { hidden: boolean; unavailable?: boolean; id: string }) {
  if (hidden) return <span id={id} className={styles.hiddenProgress}>Figures hidden</span>;
  if (unavailable) return <span id={id} className={styles.hiddenProgress}>Progress unavailable</span>;
  return null;
}

function RepaymentRing({ plan }: { plan: PlanFixture }) {
  return <svg className={styles.ring} data-g492-actual viewBox="0 0 48 48" role="progressbar" aria-label={`Repaid. ${plan.progressAria}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.progressPercent}>
    <circle className={styles.ringTrack} cx="24" cy="24" r="18" pathLength="100" />
    <circle className={`${styles.ringFill} ${styles[plan.progressTone ?? "neutral"]}`} cx="24" cy="24" r="18" pathLength="100" strokeDasharray={`${plan.progressPercent} 100`} />
  </svg>;
}

function splitAt(text: string, separator: string) {
  const index = text.indexOf(separator);
  return index < 0 ? [text, ""] as const : [text.slice(0, index), text.slice(index + separator.length)] as const;
}

function PaymentMetric({ plan, hidden }: { plan: PlanFixture; hidden: boolean }) {
  const payment = hiddenPayment(plan.scheduledLine, hidden);
  const isMonetary = payment.includes("£");
  const [amount, qualifier] = hidden || !isMonetary ? [payment, ""] as const : splitAt(payment, " ");
  return <span id={`schedule-${plan.id}`} className={styles.paymentMetric} data-g492-payment>
    {!hidden && <span className={styles.metricLabel}>Payment</span>}
    <span className={`${styles.paymentAmount} ${!isMonetary ? styles.paymentNote : ""}`}> <MoneyText text={amount} unmasked /></span>
    {qualifier && <span className={styles.metricDetail}> {qualifier}</span>}
  </span>;
}

function DeadlineMetric({ plan }: { plan: PlanFixture }) {
  if (!plan.offerDeadline) return null;
  const [prefix, date] = splitAt(plan.offerDeadline, " ends ");
  return <span id={`deadline-${plan.id}`} className={styles.deadlineMetric} data-g492-deadline>
    <span className={styles.metricLabel}>{date ? `${prefix} ends` : "Offer deadline"}</span>
    <span className={styles.deadlineDate}> {date || prefix}</span>
  </span>;
}

function RepaidFigure({ plan }: { plan: PlanFixture }) {
  const [repaid, target] = splitAt(plan.progressFigure ?? plan.progressLine, " of ");
  return <span id={`progress-${plan.id}`} className={styles.repaidFigure}>
    <MoneyText text={repaid} unmasked />{target && <span className={styles.repaidTarget}><span className={styles.of}> of </span><MoneyText text={target} unmasked /></span>}
  </span>;
}

function shortStatus(plan: PlanFixture) {
  if (plan.status.startsWith("Would clear before ")) return "Would clear in time.";
  if (plan.status.startsWith("Would not clear by ")) return "Would not clear in time.";
  return plan.status;
}

function PlanRow({ plan, variant, hidden, onOpen }: { plan: PlanFixture; variant: Variant; hidden: boolean; onOpen: () => void }) {
  const status = shortStatus(plan);
  const hasProgress = !hidden && !plan.unavailable;
  const facts = plan.offerDeadline ? <div className={styles.factsGrid}>
    <PaymentMetric plan={plan} hidden={hidden} />
    <DeadlineMetric plan={plan} />
  </div> : <span id={`schedule-${plan.id}`} className={styles.scheduleLine}><MoneyText text={hiddenPayment(plan.scheduledLine, hidden)} unmasked /></span>;
  return <article className={styles.plan} data-g492-row data-g492-kind={variant}>
    <button type="button" onClick={onOpen} className={styles.planOpen} aria-labelledby={`name-${plan.id}`} aria-describedby={`progress-${plan.id}${plan.offerDeadline ? ` deadline-${plan.id}` : ""} schedule-${plan.id} status-${plan.id}${plan.targetQualifier ? ` target-qualifier-${plan.id}` : ""}`} />
    <div className={styles.rowContent} data-g492-row-content>
      <span id={`name-${plan.id}`} className={styles.planName}>{plan.name}<span className="sr-only">. View plan details</span></span>
      {hasProgress && variant === "a" && <div className={styles.pairedAmounts} data-g492-ring-layout="paired">
        <RepaymentRing plan={plan} />
        <div className={styles.repaidMetric}><span className={styles.metricLabel}>Repaid</span><RepaidFigure plan={plan} /></div>
        <PaymentMetric plan={plan} hidden={hidden} />
      </div>}
      {hasProgress && variant === "a" && <div className={styles.deadlineLine}><DeadlineMetric plan={plan} /></div>}
      {hasProgress && variant === "b" && <div className={styles.ringRight} data-g492-ring-layout="right">
        <div className={styles.repaidMetric}><span className={styles.metricLabel}>Repaid</span><RepaidFigure plan={plan} /></div>
        <RepaymentRing plan={plan} />
      </div>}
      {hasProgress && variant === "b" && facts}
      {!hasProgress && <><ProgressUnavailable id={`progress-${plan.id}`} hidden={hidden} unavailable={plan.unavailable} />{facts}</>}
      <div className={styles.statusFooter}>
        <span id={`status-${plan.id}`} className={styles.status} aria-describedby={plan.targetQualifier ? `target-qualifier-${plan.id}` : undefined}>{plan.caution && !plan.unavailable && <span className={styles.watchDot} aria-hidden="true" />}{status}</span>
        <span className={styles.viewDetail} aria-hidden="true">Details</span>
      </div>
      {plan.targetQualifier && <span id={`target-qualifier-${plan.id}`} className={styles.targetQualifier}>{plan.targetQualifier}</span>}
    </div>
  </article>;
}

function Toolbar({ variant, state, mode, hidden }: { variant: Variant; state: PreviewState; mode: Mode; hidden: boolean }) {
  const href = (nextVariant = variant, nextState = state, nextMode = mode, nextHide = hidden) => `?variant=${nextVariant}&state=${nextState}&mode=${nextMode}${nextHide ? "&hide=1" : nextState === "hidden" ? "&hide=0" : ""}`;
  return <nav className={styles.toolbar} aria-label="Card plan preview controls"><div className={styles.toolbarInner}>
    <span className={styles.fixtureLabel}>Fictional fixtures</span>
    <a className={styles.control} aria-current={variant === "a" ? "page" : undefined} href={href("a")}>A Paired amounts</a>
    <a className={styles.control} aria-current={variant === "b" ? "page" : undefined} href={href("b")}>B Ring right</a>
    <a className={styles.control} href={href(variant, state, mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light" : "Dark"}</a>
    <details className={styles.reviewCases} data-g492-review-cases><summary><span data-row-content>Review cases</span></summary><div className={styles.reviewCaseLinks}>
      {states.map((item) => <a key={item} className={styles.control} aria-current={state === item ? "page" : undefined} href={href(variant, item, mode, item === "hidden" ? true : hidden)}>{stateLabels[item]}</a>)}
      <a className={styles.control} data-hidden={hidden ? "true" : undefined} href={href(variant, state, mode, !hidden)}>{hidden ? "Show figures" : "Hide figures"}</a>
    </div></details>
  </div></nav>;
}

export default function CardPlanProgressPreview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const requestedState = params.get("state");
  const state: PreviewState = states.includes(requestedState as PreviewState) ? requestedState as PreviewState : "ready";
  const dataState: DataState = state === "hidden" ? "ready" : state;
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const hidden = params.get("hide") === "1" || (state === "hidden" && params.get("hide") !== "0");
  const fixture = PREVIEW_STATES[dataState];
  const [detail, setDetail] = useState<PlanFixture | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", mode === "dark");
    return () => { root.classList.toggle("dark", wasDark); };
  }, [mode]);

  return <div className={`${styles.preview} ${mode === "dark" ? styles.dark : ""}`}>
    <a href="#card-plan-preview" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:p-4 focus:text-slate-950">Skip to card plan preview</a>
    <Toolbar variant={variant} state={state} mode={mode} hidden={hidden} />
    <main id="card-plan-preview" className={styles.shell}>
      <header className={styles.pageHeader}><div><h1>Planning</h1><p>Your card plans, progress and offer deadlines.</p></div></header>
      <p className={styles.variantDescription}>{variant === "a" ? "The ring, repayment and payment share one compact reading." : "The ring sits on the right, with payment and offer deadline paired below."}</p>
      <div className={styles.context}>
        <section aria-labelledby="debt-heading"><div className={styles.sectionHead}><h2 id="debt-heading">Debt</h2><span>Repayment plans</span></div>
          <div className={styles.debtCard}>
            <div className={styles.debtSummary}><div><p>Across your credit cards</p><strong><MoneyText text={fixture.debtTotal === null ? "Figure unavailable" : hidden ? "Figures hidden" : `${fixture.debtTotal} owed`} unmasked /></strong></div></div>
            {dataState === "loading" ? <div className={styles.loading} aria-label="Loading card repayment plans…"><span className={styles.skeleton} /><span className={styles.skeleton} /><span className={styles.skeleton} /></div>
              : dataState === "stale" ? <div className={styles.unavailable} role="status"><strong>Updating plan progress…</strong><p>The latest plan figures are being prepared.</p></div>
              : dataState === "empty" ? <div className={styles.unavailable}><strong>No card repayment plans yet</strong><p>A saved plan will show its schedule and offer progress here.</p></div>
              : dataState === "unavailable" ? <div className={styles.unavailable}><strong>Plan progress is unavailable</strong><p>We could not load the latest plan figures.</p><a className={styles.recover} href={`?variant=${variant}&state=ready&mode=${mode}${hidden ? "&hide=1" : ""}`}>Try again</a></div>
              : <div className={styles.planList}>{fixture.plans.map((plan) => <PlanRow key={plan.id} plan={plan} variant={variant} hidden={hidden} onOpen={() => setDetail(plan)} />)}</div>}
          </div>
        </section>
        <div className={styles.goalsColumn}><section aria-labelledby="goals-heading"><div className={styles.sectionHead}><h2 id="goals-heading">Long-term goals</h2></div><div className={styles.goalCard}><div className={styles.goals}>{GOALS.map((goal) => <div key={goal.name} className={styles.goal}><p>{goal.name}</p><MoneyText text={hidden ? "Figures hidden" : goal.detail} unmasked /></div>)}</div></div></section>
          {dataState === "future" && <p className={styles.note}>{DAILY_CHALLENGE_NOTE}</p>}
        </div>
      </div>
    </main>
    <DetailSheet plan={detail} hidden={hidden} onClose={() => setDetail(null)} />
  </div>;
}
