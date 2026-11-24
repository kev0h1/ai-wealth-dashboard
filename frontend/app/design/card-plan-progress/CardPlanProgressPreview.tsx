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

function ProgressRail({ plan, hidden }: { plan: PlanFixture; hidden: boolean }) {
  if (hidden) return null;
  if (plan.unavailable) return null;
  return <div className={styles.progressBlock} data-g492-rail>
    <span className={styles.progressKey} aria-hidden="true"><span><i className={styles.fillKey} />Recorded</span><span><i className={styles.markerKey} />Expected pace</span></span>
    <div className={styles.trackWrap} role="progressbar" aria-label={`${plan.progressAria} The fill is recorded repayments. The tick marks expected pace. Open details for the exact expected-by-now amount.`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.progressPercent}>
      <span className={styles.marker} data-g492-marker style={{ left: plan.markerLeft }} aria-hidden="true" />
      <span className={styles.track}><span className={`${styles.fill} ${styles[plan.progressTone ?? "neutral"]}`} data-g492-fill style={{ width: plan.progressWidth }} /></span>
    </div>
  </div>;
}

function shortStatus(plan: PlanFixture) {
  if (plan.status.startsWith("Would clear before ")) return "Would clear in time.";
  if (plan.status.startsWith("Would not clear by ")) return "Would not clear in time.";
  return plan.status;
}

function PlanRow({ plan, variant, hidden, onOpen }: { plan: PlanFixture; variant: Variant; hidden: boolean; onOpen: () => void }) {
  const schedule = hiddenPayment(plan.scheduledLine, hidden);
  const status = shortStatus(plan);
  const progress = <span id={`progress-${plan.id}`} className={styles.progressLine}>
    <span className={variant === "a" ? styles.leading : undefined}>{hidden ? "Figures hidden" : <MoneyText text={plan.progressFigure ?? plan.progressLine} unmasked />}</span>
    {plan.offerDeadline && <span className={styles.deadline}>{plan.offerDeadline}</span>}
  </span>;
  const scheduleLine = <span id={`schedule-${plan.id}`} className={styles.scheduled}><MoneyText text={schedule} unmasked /></span>;
  return <article className={styles.plan} data-g492-row>
    <button type="button" onClick={onOpen} className={styles.planOpen} aria-labelledby={`name-${plan.id}`} aria-describedby={`schedule-${plan.id} progress-${plan.id} status-${plan.id}`} />
    <div className={styles.rowContent} data-g492-row-content>
      {variant === "a" ? <>
        <span id={`name-${plan.id}`} className={styles.planName}>{plan.name}<span className="sr-only">. View plan details</span></span>
        {progress}
        <ProgressRail plan={plan} hidden={hidden} />
        {scheduleLine}
      </> : <div className={styles.paymentLead}>
        <span id={`name-${plan.id}`} className={styles.planName}>{plan.name}<span className="sr-only">. View plan details</span></span>
        <span className={styles.paymentRow}><span>Payment</span>{scheduleLine}</span>
        {progress}
      </div>}
      {variant === "b" && <ProgressRail plan={plan} hidden={hidden} />}
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
    <a className={styles.control} aria-current={variant === "a" ? "page" : undefined} href={href("a")}>A Progress first</a>
    <a className={styles.control} aria-current={variant === "b" ? "page" : undefined} href={href("b")}>B Payment row</a>
    {states.map((item) => <a key={item} className={styles.control} aria-current={state === item ? "page" : undefined} href={href(variant, item, mode, item === "hidden" ? true : hidden)}>{stateLabels[item]}</a>)}
    <a className={styles.control} href={href(variant, state, mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light" : "Dark"}</a>
    <a className={styles.control} data-hidden={hidden ? "true" : undefined} href={href(variant, state, mode, !hidden)}>{hidden ? "Show figures" : "Hide figures"}</a>
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
