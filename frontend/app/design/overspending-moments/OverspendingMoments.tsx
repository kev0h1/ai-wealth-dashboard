"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { CASES, dateLabel, fixture, fundingSentence, money, type Case, type Fixture, type Moment, type Variant } from "./fixtures";
import styles from "./preview.module.css";

// All new markup is disposable design-round work. No product component, API,
// preference or notification changes. Acknowledgement lives only in this
// browser tab, independently per variant, and expires at the period boundary.
// G493 must supply a real period acknowledgement, server-authored readings,
// freshness and a separate once-per-period notification dedupe on fold-in.
const PERIOD = "2026-10-30:2026-11-26";
const MOMENTS: { id: Moment; label: string }[] = [{ id: "home", label: "Before · Home" }, { id: "spend", label: "Crossed · Spend" }, { id: "close", label: "Closed · Home" }];
type Snapshot = "early" | "crossed" | "closed";
type Config = { variant: Variant; moment: Moment; state: Case; dark: boolean; hidden: boolean; drivers: boolean; ack: boolean; snapshot: Snapshot };

const subscribeReady = () => () => {};
const clientReady = () => true;
const serverFlag = () => false;
function readFlag(key: string) {
  try { return typeof window !== "undefined" && sessionStorage.getItem(key) === "1"; } catch { return false; }
}
function subscribeStorage(listener: () => void) {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

function href(config: Config, changes: Partial<Config> = {}) {
  const c = { ...config, ...changes };
  const params = new URLSearchParams({ variant: c.variant, moment: c.moment, state: c.state, mode: c.dark ? "dark" : "light", snapshot: c.snapshot });
  if (c.hidden) params.set("hidden", "1");
  if (c.drivers) params.set("drivers", "1");
  if (c.ack) params.set("ack", "1");
  return `?${params}`;
}
// Review controls intentionally replay the fictional early moment; the
// in-example navigation and a normal reload preserve its seen-once state.
const reviewHref = (config: Config, changes: Partial<Config> = {}) => `${href(config, changes)}&replay=1`;
const M = ({ value, className = "" }: { value: number; className?: string }) => <MoneyText text={money(value)} className={className} />;
const Dot = () => <span className={styles.dot} aria-hidden="true" />;
function Balanced({ children, name, className = "" }: { children: ReactNode; name: string; className?: string }) {
  return <div data-balanced-row={name} className={`${styles.balanced} ${className}`}><div data-row-content>{children}</div></div>;
}
function Disclosure({ title, children, name }: { title: ReactNode; children: ReactNode; name: string }) {
  return <details className={styles.disclosure}><summary data-balanced-row={name}><span data-row-content><span>{title}</span><ChevronDown size={16} aria-hidden="true" /></span></summary><div className={styles.disclosed}>{children}</div></details>;
}

function ReviewBar({ config, acknowledged, reset }: { config: Config; acknowledged: boolean; reset: () => void }) {
  return <header className={styles.review}>
    <div className={styles.reviewTop}><a href="/design" className={styles.back}><ArrowLeft size={15} aria-hidden="true" />All designs</a><span>G494 · Fictional examples</span></div>
    <div className={styles.reviewHeading}><h1>Overspending, without the nagging</h1><a className={styles.theme} href={reviewHref(config, { dark: !config.dark })}>{config.dark ? "Light theme" : "Dark theme"}</a></div>
    <div className={styles.direction}><nav aria-label="Design direction"><a aria-current={config.variant === "a" ? "page" : undefined} href={reviewHref(config, { variant: "a" })}>A · A clear moment</a><a aria-current={config.variant === "b" ? "page" : undefined} href={reviewHref(config, { variant: "b" })}>B · A quieter note</a></nav><p>{config.variant === "a" ? "A compact Home card. The funding reading stays visible on Spend." : "A Home note on the canvas. The Spend chip opens the funding reading."}</p></div>
    <nav className={styles.momentTabs} aria-label="Moment in the pay period">{MOMENTS.map(item => <a key={item.id} aria-current={item.id === config.moment ? "page" : undefined} href={reviewHref(config, { moment: item.id, drivers: false, snapshot: item.id === "home" ? "early" : item.id === "close" ? "closed" : "crossed" })}>{item.id === config.moment && item.id === "spend" && config.snapshot === "early" ? "Before · Spend" : item.id === config.moment && item.id === "home" && config.snapshot !== "early" ? "After · Home" : item.label}</a>)}</nav>
    <details className={styles.reviewCases}><summary>Review cases <ChevronDown size={15} aria-hidden="true" /><span>{CASES.find(item => item.id === config.state)?.label}</span></summary><div><nav aria-label="Fictional scenarios">{CASES.map(item => <a key={item.id} aria-current={config.state === item.id ? "page" : undefined} href={reviewHref(config, { state: item.id })}>{item.label}</a>)}</nav><div className={styles.reviewOptions}><a href={reviewHref(config, { hidden: !config.hidden })}>{config.hidden ? "Show figures" : "Hide figures"}</a><a href={reviewHref(config, { ack: true, moment: "home", drivers: false })}>Acknowledged example</a><button type="button" onClick={reset}>Replay this period{acknowledged && <Check size={14} aria-hidden="true" />}</button></div><p>Hand-authored previews over proposed G493 data. Actions stay in this example. One-off is remembered in this tab for this period and variant only. Review controls replay the moment; returning Home within the example does not. No push is sent. Proposed push: at most once per period, under Category pace, and suppressed after acknowledgement. Product screens are unchanged.</p></div></details>
  </header>;
}

function Sidebar({ config }: { config: Config }) {
  return <aside className={styles.sidebar}><div className={styles.wordmark}>Sorted<span aria-hidden="true">.</span></div><nav aria-label="Example screens">{(["home", "spend"] as const).map(tab => <a key={tab} href={href(config, { moment: tab, drivers: false })} aria-current={(config.moment === "spend" ? "spend" : "home") === tab ? "page" : undefined}><PhosphorNavIcon tab={tab} selected={(config.moment === "spend" ? "spend" : "home") === tab} appearance="ink" />{tab === "home" ? "Home" : "Spend"}</a>)}{(["upcoming", "planning"] as const).map(tab => <span key={tab} className={styles.contextNav}><PhosphorNavIcon tab={tab} selected={false} appearance="ink" />{tab === "upcoming" ? "Upcoming" : "Planning"}</span>)}</nav><p>Fictional pay period<br />30 Oct to 26 Nov</p></aside>;
}

function Forecast({ data, variant, acknowledge, spendHref }: { data: Fixture; variant: Variant; acknowledge: () => void; spendHref: string }) {
  return <section data-forecast className={variant === "a" ? styles.forecast : styles.canvasNote} aria-labelledby="forecast-title">
    <div className={styles.kind}><Dot /><span>Ahead of payday</span></div>
    <h3 id="forecast-title">At this pace, spending may pass income</h3>
    <p className={styles.forecastAmount}><M value={data.projectedGap} /><span>more out than in · estimated</span></p>
    <p className={styles.body}>By {dateLabel("2026-11-27")}, if this pace continues. Mostly {data.drivers.map(item => item.name).join(" and ")}.</p>
    <p className={styles.caption}>You’ll only see this heads-up once this pay period.</p>
    <div className={styles.actions}><a href={spendHref} className={styles.primary}>Show me where<ArrowRight size={16} aria-hidden="true" /></a><button type="button" data-acknowledge onClick={acknowledge} className={styles.secondary}>Expected, it’s a one-off</button></div>
    <p className={styles.consent}>Choosing one-off silences overspending heads-ups for this pay period.</p>
  </section>;
}

function HomeHero({ fresh, closed }: { fresh: boolean; closed: boolean }) {
  return <section className={styles.hero} aria-labelledby="home-hero-title"><div className={styles.heroTop}><h3 id="home-hero-title" className={styles.label}>{fresh ? "Estimated left to spend" : "Last known left to spend"}</h3><span className={styles.neutralChip}>{fresh ? <><span className={styles.greenDot} aria-hidden="true" />Looks on track</> : "Last checked 20 Nov"}</span></div><p className={styles.display}><M value={236} /></p><p className={styles.body}>Until {dateLabel(closed ? "2026-12-24" : "2026-11-27")}, after bills, plans and your buffer.</p><p className={styles.caption}>Based on your connected current accounts and the bills Sorted knows about.{!fresh && " Last checked on 20 Nov."}</p><div className={styles.heroFoot}><Disclosure name="estimate-counts" title="What this estimate counts"><p>It doesn’t include other accounts, payments still pending, or bills Sorted hasn’t spotted yet.</p><p>An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.</p></Disclosure></div></section>;
}

function Funding({ data }: { data: Fixture }) {
  const gap = data.out - data.income;
  return <div className={styles.funding} data-funding>
    <p className={styles.body}><MoneyText text={fundingSentence(data)} /></p>
    {data.funding.unknown > 0 && <p className={styles.caption}><MoneyText text={`Your accounts don’t show what covered the remaining ${money(data.funding.unknown)}.`} /></p>}
    <Disclosure name="funding-working" title="How this adds up"><dl className={styles.ledger}>
      <div><dt>Out</dt><dd><M value={data.out} /></dd></div><div><dt>In</dt><dd><M value={-data.income} /></dd></div><div className={styles.total}><dt>More out than in</dt><dd><M value={gap} /></dd></div>
    </dl><dl className={styles.ledger} aria-label="What covered the gap">{[{ name: "New card debt", amount: data.funding.cards }, { name: "Net from savings", amount: data.funding.savings }, { name: "Current accounts drawn down", amount: data.funding.current }, { name: "Source not established", amount: data.funding.unknown }].filter(row => row.amount > 0).map(row => <div key={row.name}><dt>{row.name}</dt><dd><M value={row.amount} /></dd></div>)}<div className={styles.total}><dt>Total gap</dt><dd><M value={gap} /></dd></div></dl><p className={styles.caption}>In is money from outside your own accounts, including refunds. Out is spending, including card purchases. Card repayments and transfers between your own accounts count in neither.</p><p className={styles.caption}>Savings is money moved out, less money moved back in this period. The source split is an estimate from your connected accounts, not a tracing of each purchase.</p></Disclosure>
  </div>;
}

function SavingsObservation({ data }: { data: Fixture }) {
  if (!data.trend || !data.fresh) return null;
  return <section className={styles.observation} aria-labelledby="savings-pattern-title"><h3 id="savings-pattern-title">A pattern across pay periods</h3><p className={styles.body}>Money left savings in {data.trend.covered} of the last {data.trend.periods} completed pay periods when spending was higher than income.</p><Disclosure name="savings-history" title="See the pay periods"><p className={styles.caption}>Net money moved out of savings in each completed pay period.</p><dl className={styles.history}>{[{ date: "3 Jul to 30 Jul", amount: 550, crossed: true }, { date: "31 Jul to 27 Aug", amount: 180, crossed: true }, { date: "28 Aug to 24 Sep", amount: 0, crossed: false }, { date: "25 Sep to 29 Oct", amount: 300, crossed: true }].map(row => <Balanced key={row.date} name="history-period"><dt>{row.date}<span>{row.crossed ? "More out than in" : "Spending within income"}</span></dt><dd><M value={row.amount} /></dd></Balanced>)}</dl><p className={styles.caption}>Transfers back into savings have already been taken off these amounts. This describes a pattern; it doesn’t set a target.</p></Disclosure></section>;
}

function Drivers({ data, filtered, config }: { data: Fixture; filtered: boolean; config: Config }) {
  const [selected, setSelected] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (filtered) {
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
      heading.current?.focus({ preventScroll: true });
    }
  }, [filtered]);
  return <section className={styles.drivers} aria-labelledby="drivers-title"><div className={styles.sectionHeading}><h3 id="drivers-title" ref={heading} tabIndex={-1}>{!data.fresh ? "Last known spending" : filtered ? "Behind this pace" : "What’s changed"}</h3>{filtered && <a href={href(config, { drivers: false })}>All spending</a>}</div><p className={styles.caption}>{!data.fresh ? "Category figures from the last check on 20 Nov. Update your accounts for a current reading." : filtered ? "Travel and Eating out, the two main drivers. This is a filtered view, not all of Out." : "The two main categories running above usual pace."}</p><div className={styles.categoryList}>{data.drivers.map(driver => {
    const Icon = getCategoryIcon(driver.category);
    return <div key={driver.category}><button type="button" className={styles.categoryRow} data-balanced-row={`driver-${driver.category}`} aria-expanded={selected === driver.category} aria-controls={`payments-${driver.category.replaceAll(" ", "-")}`} onClick={() => setSelected(selected === driver.category ? null : driver.category)}><span data-row-content><span className={`${styles.categoryIcon} ${driver.category === "Travel" ? styles.travel : styles.eating}`}><Icon size={18} aria-hidden="true" /></span><span className={styles.categoryName}><strong>{driver.name}</strong><span><M value={driver.usual} /> usual by this point</span></span><span className={styles.categoryAmount}><M value={driver.amount} /><ChevronDown size={15} aria-hidden="true" /></span></span></button><div className={styles.payments} hidden={selected !== driver.category} id={`payments-${driver.category.replaceAll(" ", "-")}`}><p className={styles.caption}>Fictional payments included in {driver.name}.</p><dl>{driver.payments.map(payment => <Balanced name="payment" key={payment.name}><dt>{payment.name}<span>{dateLabel(payment.date)}</span></dt><dd><M value={payment.amount} /></dd></Balanced>)}</dl></div></div>;
  })}</div></section>;
}

function SpendHero({ data, config, acknowledged }: { data: Fixture; config: Config; acknowledged: boolean }) {
  const crossed = data.signal && data.fresh && data.out > data.income;
  const paceDifference = data.signal ? config.snapshot === "early" ? 1000 : 2440 : -740;
  const paceText = `${paceDifference > 0 ? "+" : ""}${money(paceDifference)}`;
  return <section className={styles.hero} aria-labelledby="spend-hero-title"><div className={styles.heroTop}><h3 id="spend-hero-title" className={styles.label}>{!data.fresh ? "Out at last check" : config.snapshot === "closed" ? "Out in completed period" : "Out this pay period"}</h3>{!crossed && <span className={styles.neutralChip}>{data.fresh ? data.signal ? "Above usual" : "Within income" : "Last known figures"}</span>}</div>
    <div className={styles.spendAmountRow}><p className={styles.display}><M value={data.out} /></p>{crossed && (config.variant === "b" ? <a className={styles.statusChip} href="#funding-reading" onClick={() => { const details = document.getElementById("funding-reading") as HTMLDetailsElement | null; if (details) details.open = true; }}><Dot />More out than in<ChevronDown size={13} aria-hidden="true" /></a> : <span className={styles.statusChip}><Dot />More out than in</span>)}</div>
    <p className={styles.caption}>{!data.fresh ? "Last checked 20 Nov" : config.snapshot === "closed" ? "Completed period" : config.snapshot === "early" ? "Day 22 of 28" : "Day 25 of 28"} · {dateLabel("2026-10-30")} to {dateLabel("2026-11-26")}</p>
    {data.fresh && <p className={styles.pace}><MoneyText text={paceText} /> against usual pace {config.snapshot === "closed" ? "for the period" : config.snapshot === "early" ? "by day 22" : "by day 25"}.</p>}
    <Balanced name="spend-instrument" className={styles.instrument}><dl><div><dt>In</dt><dd><M value={data.income} /></dd></div><div><dt>Moved separately</dt><dd><M value={600} /></dd></div></dl></Balanced>
    {crossed && (config.variant === "a" ? <Funding data={data} /> : <details id="funding-reading" className={styles.fundingFold}><summary data-balanced-row="funding-chip-disclosure"><span data-row-content><span>What covered it</span><ChevronDown size={16} aria-hidden="true" /></span></summary><Funding data={data} /></details>)}
    {acknowledged && <p className={styles.ackCaption}>Marked as a one-off. Overspending heads-ups are quiet for this pay period.</p>}
  </section>;
}

function CloseNeedle({ data, config, acknowledged }: { data: Fixture; config: Config; acknowledged: boolean }) {
  const reading = `Out passed in by ${money(data.out - data.income)}.${data.funding.unknown > 0 ? ` ${money(data.funding.unknown)} has no clear source.` : data.funding.cards > 0 ? ` Cards absorbed about ${money(data.funding.cards)}.` : data.funding.savings > 0 ? ` About ${money(data.funding.savings)} came from savings.` : ""}`;
  return <section className={config.variant === "a" ? styles.needle : styles.canvasNeedle} aria-labelledby="closed-title"><p className={styles.kind}>Pay period closed</p><h3 id="closed-title">Your month closed on Thursday.</h3>{data.signal && data.fresh && !acknowledged && <p data-close-reading className={styles.body}><MoneyText text={reading} /></p>}<a href={href(config, { moment: "spend", drivers: false, snapshot: "closed" })} className={styles.storyLink}>Here’s how it went<ChevronRight size={16} aria-hidden="true" /></a></section>;
}

function DataState({ state, retry }: { state: "loading" | "error" | "stale"; retry: () => void }) {
  return <section className={styles.dataState} aria-live="polite"><h3>{state === "loading" ? "Checking this pay period…" : state === "error" ? "We couldn’t check the spending picture" : "Your bank data needs an update"}</h3><p className={styles.body}>{state === "loading" ? "The spending picture will appear when your accounts have been checked." : state === "error" ? "Try again to check whether more has gone out than come in." : "These figures were last checked on 20 Nov. Update your accounts before relying on a pace or funding reading."}</p>{state !== "loading" && <button type="button" className={styles.secondary} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{state === "stale" ? "Update example" : "Try again"}</button>}</section>;
}

function Content({ config, acknowledged, showForecast, acknowledge, restored, retry }: { config: Config; acknowledged: boolean; showForecast: boolean; acknowledge: () => void; restored: boolean; retry: () => void }) {
  const base = fixture(restored ? "full" : config.state);
  // Home is the earlier snapshot; Spend and close are after the crossing.
  const data = config.snapshot === "early" ? { ...base, out: base.earlyOut } : base;
  const state = restored ? "full" : config.state;
  if (state === "loading" || state === "error") return <DataState state={state} retry={retry} />;
  const spendHref = href(config, { moment: "spend", drivers: true, snapshot: "early" });
  if (config.moment === "spend") return <>{!data.fresh && <DataState state="stale" retry={retry} />}<div className={styles.spendGrid}><div className={styles.spendRail}><SpendHero data={data} config={config} acknowledged={acknowledged} /></div><div><Drivers key={`${config.drivers}-${state}`} data={data} filtered={config.drivers} config={config} />{!acknowledged && <SavingsObservation data={data} />}</div></div></>;
  return <div className={styles.homeGrid}><div className={styles.homeMain}>
    {!data.fresh && <DataState state="stale" retry={retry} />}
    {config.moment === "close" && <CloseNeedle data={data} config={config} acknowledged={acknowledged} />}
    {config.moment === "home" && config.snapshot === "early" && showForecast && !acknowledged && data.signal && data.fresh && config.variant === "a" && <Forecast data={data} variant="a" acknowledge={acknowledge} spendHref={spendHref} />}
    {config.moment === "home" && acknowledged && <p className={styles.acknowledged} role="status"><Check size={16} aria-hidden="true" /><span>Noted as a one-off. No more overspending heads-ups this pay period.</span></p>}
    <HomeHero fresh={data.fresh} closed={config.snapshot === "closed"} />
    {config.moment === "home" && config.snapshot === "early" && showForecast && !acknowledged && data.signal && data.fresh && config.variant === "b" && <Forecast data={data} variant="b" acknowledge={acknowledge} spendHref={spendHref} />}
  </div><aside className={styles.context}><h3>Your money</h3><div className={styles.contextAccounts}><Balanced name="account-identity"><span><strong>Everyday account</strong><small>Northbridge · Current account</small></span><M value={842} /></Balanced><Balanced name="account-identity"><span><strong>Rainy day</strong><small>Northbridge · Savings</small></span><M value={2200} /></Balanced></div>{config.moment === "close" && !acknowledged && <SavingsObservation data={data} />}</aside></div>;
}

export default function OverspendingMoments() {
  const params = useSearchParams();
  const state = CASES.some(item => item.id === params.get("state")) ? params.get("state") as Case : "full";
  const moment: Moment = params.get("moment") === "spend" ? "spend" : params.get("moment") === "close" ? "close" : "home";
  const rawSnapshot = params.get("snapshot");
  const snapshot: Snapshot = rawSnapshot === "early" || rawSnapshot === "crossed" || rawSnapshot === "closed" ? rawSnapshot : moment === "home" ? "early" : moment === "close" ? "closed" : "crossed";
  const config: Config = { variant: params.get("variant") === "b" ? "b" : "a", moment, state, dark: params.get("mode") === "dark", hidden: params.get("hidden") === "1", drivers: params.get("drivers") === "1", ack: params.get("ack") === "1", snapshot };
  const replay = params.get("replay") === "1";
  const storageKey = `g494:one-off:${config.variant}:${PERIOD}`;
  const seenKey = `g494:seen:${config.variant}:${PERIOD}`;
  const storedAcknowledgement = useSyncExternalStore(subscribeStorage, () => readFlag(storageKey), serverFlag);
  const [localAcknowledgement, setLocalAcknowledgement] = useState(false);
  const acknowledged = config.ack || storedAcknowledgement || localAcknowledgement;
  const [wasSeen] = useState(() => readFlag(seenKey));
  const showForecast = replay || !wasSeen;
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverFlag);
  const [restored, setRestored] = useState(false);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const oldDark = root.classList.contains("dark");
    const oldScheme = root.style.colorScheme;
    root.classList.toggle("dark", config.dark); root.style.colorScheme = config.dark ? "dark" : "light";
    return () => { root.classList.toggle("dark", oldDark); root.style.colorScheme = oldScheme; };
  }, [config.dark]);
  useEffect(() => {
    if (!ready || config.moment !== "home" || config.snapshot !== "early" || !(restored || !["quiet", "stale", "loading", "error"].includes(state))) return;
    try { sessionStorage.setItem(seenKey, "1"); } catch { /* The example still works without storage. */ }
  }, [ready, config.moment, config.snapshot, seenKey, state, restored]);
  function acknowledge() {
    try { sessionStorage.setItem(storageKey, "1"); } catch { /* Local interaction still works if storage is unavailable. */ }
    setLocalAcknowledgement(true);
    requestAnimationFrame(() => confirmation.current?.focus({ preventScroll: true }));
  }
  function reset() {
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(seenKey); } catch { /* Nothing to clear. */ }
    const next = href(config, { ack: false });
    window.location.assign(next);
  }
  return <div className={styles.preview} data-g494 data-ready={ready ? "true" : "false"}>
    <a className={styles.skip} href="#example-content">Skip to the example</a>
    <ReviewBar config={config} acknowledged={acknowledged} reset={reset} />
    <BalancesHiddenContext.Provider value={config.hidden}><div className={styles.app}><Sidebar config={config} /><main id="example-content" className={styles.main} tabIndex={-1}><header className={styles.pageHeader}><div>{config.moment === "spend" && <a className={styles.back} href={href(config, { moment: "home", drivers: false })}><ArrowLeft size={14} aria-hidden="true" />Back to Home</a>}<p>{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${snapshot === "closed" ? "2026-11-27" : snapshot === "early" ? "2026-11-20" : "2026-11-23"}T12:00:00Z`))}</p><h2>{config.moment === "spend" ? "Your spending" : "Good morning, Alex"}</h2></div><span className={styles.period}>30 Oct to 26 Nov</span></header><div ref={confirmation} tabIndex={-1} className={styles.confirmation} aria-label={acknowledged ? "One-off noted for this pay period" : undefined}>{ready && <Content config={config} acknowledged={acknowledged} showForecast={showForecast} acknowledge={acknowledge} restored={restored} retry={() => setRestored(true)} />}</div><footer className={styles.exampleFooter}>Fictional accounts and figures · {config.variant === "a" ? "A · A clear moment" : "B · A quieter note"}</footer></main></div></BalancesHiddenContext.Provider>
  </div>;
}
