"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import PlanPicker from "@/components/PlanPicker";
import { accountReading, fixtureFor, gbp, offerFor, PERIODS, planFor, plansFor, SCENARIOS, type PeriodId, type Platform, type Provider, type Scenario, type TierId } from "./model";
import type { SubscriptionBillingPeriodDetail, SubscriptionInfo } from "@wealth/shared";
import styles from "./styles.module.css";

type Variant = "a" | "b";
type Context = "settings" | "onboarding";

function RadioKeys(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number, set: (index: number) => void) {
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else return;
  event.preventDefault();
  const group = event.currentTarget.closest('[role="radiogroup"]');
  set(next);
  requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus());
}

function Preview({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const platform: Platform = params.get("platform") === "ios" ? "ios" : params.get("platform") === "android" ? "android" : "web";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const context: Context = params.get("context") === "onboarding" ? "onboarding" : "settings";
  const scenario = (SCENARIOS.some(item => item.id === (params.get("scenario") ?? params.get("state"))) ? (params.get("scenario") ?? params.get("state")) : "free") as Scenario;
  const source: Provider | undefined = params.get("source") === "apple" ? "apple" : params.get("source") === "google" ? "google" : params.get("source") === "stripe" ? "stripe" : undefined;
  const connect = params.get("connect") === "1";
  const fixture = fixtureFor(scenario, platform, source) as ReturnType<typeof fixtureFor> & { info: SubscriptionInfo & { billing_periods: Record<string, SubscriptionBillingPeriodDetail[]> } };
  const visiblePlans = plansFor(platform, connect);
  const requestedPlan = params.get("plan") as TierId | null;
  const initialPlan = visiblePlans.some(p => p.id === requestedPlan) ? requestedPlan! : visiblePlans.some(p => p.id === fixture.info.tier) ? fixture.info.tier : "standard";
  const requestedPeriod = params.get("period") as PeriodId | null;
  const [selected, setSelected] = useState<TierId>(initialPlan);
  const [period, setPeriod] = useState<PeriodId>(requestedPeriod && PERIODS.some(p => p.id === requestedPeriod) ? requestedPeriod : "monthly");
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState(fixture.phase);
  const examplesId = useId(), comparisonId = useId(), referenceId = useId();
  const activeFixture = { ...fixture, phase };
  const ready = phase === "ready";
  const chosen = planFor(selected);
  const periodDetail = fixture.info.billing_periods?.[selected]?.find(item => item.id === period);
  const offer = offerFor(activeFixture, platform, selected, period, context);
  const reading = ready ? accountReading(activeFixture) : null;
  const native = platform !== "web";

  useEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains("dark");
    html.classList.toggle("dark", mode === "dark");
    const priorScheme = html.style.colorScheme;
    html.style.colorScheme = mode;
    return () => { html.classList.toggle("dark", wasDark); html.style.colorScheme = priorScheme; };
  }, [mode]);

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-plan-picker-v2] [role='radiogroup']").forEach(group => {
      group.querySelectorAll<HTMLButtonElement>("[role='radio']").forEach(radio => {
        radio.tabIndex = radio.getAttribute("aria-checked") === "true" ? 0 : -1;
      });
    });
  }, [period, selected]);

  const href = (next: Record<string, string>) => {
    const copy = new URLSearchParams(search);
    copy.set("plan", selected);
    copy.set("period", period);
    Object.entries(next).forEach(([key, value]) => copy.set(key, value));
    return `?${copy.toString()}`;
  };
  const selectPlan = (id: TierId) => { setSelected(id); setNotice(""); };
  const action = () => setNotice(offer.localNotice);
  const savings = periodDetail?.saving_gbp ?? 0;
  const leadFor = (plan: ReturnType<typeof planFor>) => scenario === "long-copy" ? `${plan.lead} Includes ${plan.includes.join(", ")}.` : plan.lead;

  return <div className={`${styles.shell} ${mode === "dark" ? styles.dark : ""}`} style={{ colorScheme: mode }} data-plan-picker-v2 data-variant={variant}>
    <a className={styles.skip} href="#plan-preview">Skip to plan choices</a>
    <main id="plan-preview" className={styles.main}>
      <header className={styles.header}>
        <h1>Choose what fits</h1>
        <p>Design preview, synthetic account state dated 17 October 2026. Selection changes this illustration only.</p>
        <div className={styles.variantControls} aria-label="Preview variant">
          <a aria-current={variant === "a" ? "page" : undefined} href={href({ variant: "a" })}>A: Room to compare</a>
          <a aria-current={variant === "b" ? "page" : undefined} href={href({ variant: "b" })}>B: One clear choice</a>
        </div>
        <button className={styles.disclosure} aria-expanded={examplesOpen} aria-controls={examplesId} onClick={() => setExamplesOpen(v => !v)}>{examplesOpen ? "Hide examples & display" : "Show examples & display"}</button>
        {examplesOpen && <div className={styles.examples} id={examplesId}>
          <span>Fixture</span>{SCENARIOS.map(item => <a key={item.id} href={href({ scenario: item.id })} aria-current={scenario === item.id ? "page" : undefined}>{item.label}</a>)}
          <span>Display</span>
          {(["web", "ios", "android"] as Platform[]).map(value => <a key={value} href={href({ platform: value })} aria-current={platform === value ? "page" : undefined}>{value}</a>)}
          {(["light", "dark"] as const).map(value => <a key={value} href={href({ mode: value })} aria-current={mode === value ? "page" : undefined}>{value}</a>)}
          {(["settings", "onboarding"] as Context[]).map(value => <a key={value} href={href({ context: value })} aria-current={context === value ? "page" : undefined}>{value}</a>)}
          {(["stripe", "apple", "google"] as Provider[]).map(value => <a key={value} href={href({ source: value })} aria-current={source === value ? "page" : undefined}>{value}</a>)}
          <a href={href({ connect: connect ? "0" : "1" })}>{connect ? "Hide Connect sample" : "Enable web Connect sample"}</a>
        </div>}
      </header>

      {!ready ? <section className={styles.state} aria-live="polite"><h2>{phase === "loading" ? "Loading your plan example" : "We could not load this plan example"}</h2><p>{phase === "loading" ? "No current plan, price or offer is shown while this synthetic fixture loads." : "No request was sent. Retry restores the ready synthetic fixture."}</p>{phase === "error" && <button onClick={() => { setPhase("ready"); setNotice("Ready synthetic fixture restored. No request sent."); }}>Retry locally</button>}</section> : <>
        {reading && <section className={`${styles.current} ${reading.attention ? styles.attention : ""}`}>{reading.attention && <span className={styles.amberDot} aria-hidden="true" />}<div><h2>{reading.title}</h2><p><MoneyText text={reading.detail} /></p></div></section>}
        <section className={styles.periods}><h2>Billing period</h2><div role="radiogroup" aria-label="Billing period">{PERIODS.map((item, index) => <button key={item.id} role="radio" tabIndex={period === item.id ? 0 : -1} aria-checked={period === item.id} onClick={() => setPeriod(item.id)} onKeyDown={event => RadioKeys(event, index, PERIODS.length, i => setPeriod(PERIODS[i].id))}>{item.label}</button>)}</div></section>
        {variant === "a" ? <section className={styles.variantA}><div className={styles.planList} role="radiogroup" aria-label="Choose a plan">{visiblePlans.map((plan, index) => <button key={plan.id} role="radio" aria-checked={selected === plan.id} className={selected === plan.id ? styles.selected : ""} onClick={() => selectPlan(plan.id)} onKeyDown={event => RadioKeys(event, index, visiblePlans.length, i => selectPlan(visiblePlans[i].id))}><span className={styles.planTop}><strong>{plan.name}</strong>{fixture.info.tier === plan.id && <em>Current account plan</em>}</span><span className={styles.lead}>{leadFor(plan)}</span><span className={styles.planPrice}>{plan.id === "statements" ? "Free" : fixture.priceReady ? <><MoneyText text={gbp(fixture.info.billing_periods[plan.id]?.find(x => x.id === period)?.total ?? 0)} /> <small>{PERIODS.find(x => x.id === period)?.renewal}</small></> : "Price unavailable"}</span></button>)}</div><Decision plan={chosen} detail={periodDetail} offer={offer} native={native} savings={savings} notice={notice} action={action} /></section> : <section className={styles.variantB}><div className={styles.compactSelector} role="radiogroup" aria-label="Choose a plan">{visiblePlans.map((plan, index) => <button key={plan.id} role="radio" aria-checked={selected === plan.id} className={selected === plan.id ? styles.selected : ""} onClick={() => selectPlan(plan.id)} onKeyDown={event => RadioKeys(event, index, visiblePlans.length, i => selectPlan(visiblePlans[i].id))}>{plan.name}</button>)}</div><Decision plan={chosen} detail={periodDetail} offer={offer} native={native} savings={savings} notice={notice} action={action} /><button className={styles.disclosure} aria-expanded={comparisonOpen} aria-controls={comparisonId} onClick={() => setComparisonOpen(v => !v)}>{comparisonOpen ? "Hide comparison" : "Show comparison"}</button>{comparisonOpen && <div className={styles.comparison} id={comparisonId}>{visiblePlans.map(plan => <article key={plan.id}><h3>{plan.name}</h3><p>{leadFor(plan)}</p><ul>{plan.includes.map(item => <li key={item}>{item}</li>)}</ul></article>)}</div>}</section>}
        <section className={styles.reference}><button className={styles.disclosure} aria-expanded={referenceOpen} aria-controls={referenceId} onClick={() => setReferenceOpen(v => !v)}>{referenceOpen ? "Hide current reference" : "Show current reference"}</button>{referenceOpen && <div id={referenceId}><p>Current production reference, pre-B51. It can show Connect and does not represent newly offered native products.</p><PlanPicker info={fixture.info} context={context} previewOnly nativeOverride={native} /></div>}</section>
      </>}
    </main>
  </div>;
}

function Decision({ plan, detail, offer, native, savings, notice, action }: { plan: ReturnType<typeof planFor>; detail: SubscriptionBillingPeriodDetail | undefined; offer: ReturnType<typeof offerFor>; native: boolean; savings: number; notice: string; action: () => void }) {
  const unavailable = offer.kind === "unavailable";
  const [restoreNotice, setRestoreNotice] = useState("");
  const visibleNotice = restoreNotice || notice;
  return <section aria-label="Selected plan and offer" className={styles.decision} aria-live="polite"><h2>{plan.name}</h2><p className={styles.reading}>{plan.lead}</p><ul>{plan.includes.map(item => <li key={item}>{item}</li>)}</ul><div className={styles.total}>{plan.id === "statements" ? <strong>Free</strong> : unavailable ? <strong>Price unavailable</strong> : <><strong><MoneyText text={gbp(detail?.total ?? 0)} /></strong><span>{detail?.id === "monthly" ? "every month" : detail?.id === "six_months" ? "every 6 months" : "every year"}</span>{savings > 0 && <small><MoneyText text={`Save ${gbp(savings)} against monthly`} /></small>}{detail && detail.id !== "monthly" && <small><MoneyText text={`${gbp(detail.per_month_gbp)} equivalent per month`} /></small>}</>}</div>{native && <p className={styles.native}>Proposed store-ready example. Product and eligibility responses are mocked, not currently live.</p>}<button className={styles.primary} disabled={offer.disabled} onClick={action}>{offer.label}</button><div className={styles.offer}>{offer.details.map(line => <p key={line}><MoneyText text={line} /></p>)}</div>{native && <button className={styles.restore} onClick={() => setRestoreNotice("Preview only. Restore purchases is illustrated locally. No restore or account request was sent.")}>Restore purchases</button>}{visibleNotice && <p className={styles.notice} role="status">{visibleNotice}</p>}<p className={styles.links}><a href="/terms">Terms</a><a href="/privacy">Privacy</a></p></section>;
}

export default function PlanPickerV2Client() {
  const search = useSearchParams().toString();
  return <Preview key={search} search={search} />;
}
