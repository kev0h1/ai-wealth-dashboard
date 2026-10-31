"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarDays, Eye, EyeOff, Layers, TrendingUp } from "lucide-react";
import { DailyChart, PeriodChart, SizeChart } from "./Charts";
import { dailyValues, exampleData, gbp, sizeBands, type Example } from "./model";
import styles from "./preview.module.css";

const examples: { value: Example; label: string }[] = [
  { value: "large", label: "One large payment" }, { value: "ordinary", label: "Everyday spending" },
  { value: "multiple", label: "Two large payments" }, { value: "not-counted", label: "Payment marked Not counted" },
  { value: "sparse", label: "Incomplete history" }, { value: "empty", label: "No transactions" },
  { value: "loading", label: "Loading" }, { value: "error", label: "Could not load" },
];
type Question = "daily" | "pace" | "periods" | "sizes";

const Card = ({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) => <section className={`${styles.card} ${wide ? styles.wide : ""}`}><h3>{title}</h3>{children}</section>;

export default function Preview() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const initial = examples.find(e => e.value === params.get("state"))?.value ?? "large";
  const [example, setExample] = useState<Example>(initial);
  const [dark, setDark] = useState(params.get("mode") !== "light");
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState<Question>(["pace", "periods", "sizes"].includes(params.get("question") ?? "") ? params.get("question") as Question : "daily");
  const [leaveOut, setLeaveOut] = useState(params.get("separate") === "1");
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; setReady(true); }, [dark]);
  const data = exampleData(example);
  const incomplete = example === "sparse";
  const hasLarge = data.larger.length > 0;
  const money = (value: number) => <span className="font-mono tabular-nums">{hidden ? "£••••" : gbp(value)}</span>;
  const subtitle = incomplete ? "1–4 Oct · incomplete history" : "1–30 Oct · completed pay period";
  const href = (next: string) => `?${new URLSearchParams({ variant: next, state: example, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0" })}`;
  const changeExample = (value: Example) => { setExample(value); setLeaveOut(false); };

  const PaymentList = () => <div className="mt-3">{data.larger.map(payment => <div key={payment.id} className={styles.payment}><div><p className="text-sm font-semibold">{payment.name}</p><p className={styles.label}>{payment.day} Oct · counted in spending</p></div><strong>{money(payment.amount)}</strong></div>)}</div>;
  const CountExplanation = () => <details className={`${styles.divider} ${styles.muted}`}><summary>How these charts count money</summary><p className="mt-2">These charts use payments counted as spending. Money moved and payments you mark Not counted stay out of spending charts. They still reduce the cash in the account they left.</p>{hasLarge && <p className="mt-3">Payments over {money(data.threshold)} can be shown separately. The threshold is the higher of {money(1000)} or ten times the middle payment amount. This only changes the view, not how a payment is counted.</p>}</details>;
  const Daily = ({ split }: { split: boolean }) => {
    const separated = hasLarge && (split || leaveOut);
    const daily = dailyValues(separated ? data.rest : data.counted);
    return <>
      <p className={`${styles.muted} mt-2`}>{separated ? <>Daily spending, with {data.larger.length === 1 ? "the large payment" : "larger payments"} shown separately.</> : "All spending, day by day."}</p>
      {!split && hasLarge && <div className={styles.divider}><label className={styles.switch}><input type="checkbox" checked={leaveOut} onChange={e => setLeaveOut(e.target.checked)} />Separate {data.larger.length === 1 ? "the large payment" : "larger payments"}</label><p className={styles.label}>{leaveOut ? <>Leaving {money(data.largeTotal)} out of this chart only. Your total stays the same.</> : <>Includes {money(data.largeTotal)} in {data.larger.length === 1 ? "one large payment" : "larger payments"}.</>}</p></div>}
      {separated && <div className={styles.line}><span>Shown in the daily chart</span><strong>{money(data.restTotal)}</strong></div>}
      <DailyChart values={daily} hidden={hidden} />
      {separated && <div className={styles.divider}><p className="text-sm font-semibold">Shown separately</p>{PaymentList()}<div className={`${styles.line} border-t border-slate-200 dark:border-slate-700`}><span>All spending</span><strong>{money(data.total)}</strong></div></div>}
      {!separated && hasLarge && <p className={`${styles.muted} mt-3`}>{data.larger.length === 1 ? "The tall bar includes " : "The tall bars include "}{money(data.largeTotal)} in {data.larger.length === 1 ? "one payment" : "larger payments"}. {variant === "b" ? "Use the option above to see the rest more clearly." : ""}</p>}
    </>;
  };
  const Pace = () => <>
    {data.usual === null ? <p className={`${styles.muted} mt-3`}>There isn’t enough history to compare spending yet. We need at least one earlier complete pay period.</p> : <>
      <p className={styles.figure}>{money(Math.abs(data.total - data.usual))}</p>
      <p className={styles.muted}>{data.total >= data.usual ? "More" : "Less"} than your previous average.</p>
      <PeriodChart periods={[{ label: "This period", value: data.total }, { label: "Previous average", value: data.usual }]} hidden={hidden} caption="All spending compared with your previous average." tableLabel="Show comparison figures as a table" />
      {hasLarge && <p className={`${styles.muted} mt-4`}>This period includes {money(data.largeTotal)} in {data.larger.length === 1 ? "one large payment" : "larger payments"}. All other spending came to {money(data.restTotal)}.</p>}
      <p className={`${styles.label} mt-3`}>Compared with the average of your three previous complete pay periods, each 30 days long. This is a comparison, not a spending target.</p>
    </>}
  </>;
  const Periods = () => <><p className={`${styles.muted} mt-2`}>All spending in each complete pay period.</p><PeriodChart periods={data.periods} hidden={hidden} /><p className={`${styles.label} mt-3`}>Each period covers 30 days. No data means we can’t calculate a total, not that you spent nothing.</p></>;
  const Sizes = () => {
    const bands = sizeBands(data.counted);
    const most = bands.reduce((best, band) => band.count > best.count ? band : best, bands[0]);
    return <><p className={`${styles.muted} mt-2`}>{hidden ? "Figures hidden." : <>The most common payment size was <span className="font-mono tabular-nums">{most.label.toLowerCase()}</span>.</>}</p><SizeChart bands={bands} hidden={hidden} /><p className={`${styles.label} mt-3`}>Bar length shows how many payments you made, not their total value.</p></>;
  };

  return <main className={styles.page} data-g380-ready={ready}>
    <a className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11" href="#spending-patterns">Skip to spending patterns</a><div className={styles.shell}>
      <header className={styles.review}>
        <a href="/design" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300"><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
        <h1 className="mt-2 text-xl font-bold">Spend patterns · G380</h1>
        <p className={`${styles.muted} mt-2`}>A keeps the daily pattern and larger payments together. B lets you explore one question at a time. Synthetic examples.</p>
        <nav aria-label="Design options" className={styles.controls}>{[["a", "A · A clearer overview"], ["b", "B · One question at a time"]].map(([id, name]) => <a key={id} href={href(id)} className={`${styles.button} ${variant === id ? "!bg-indigo-600 !text-white" : ""}`} aria-current={variant === id ? "page" : undefined}>{name}</a>)}</nav>
        <details className="mt-3"><summary className="text-sm font-semibold">Examples and display</summary><div className={styles.controls}><label className="flex flex-col gap-2 text-sm">Example<select value={example} onChange={e => changeExample(e.target.value as Example)}>{examples.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}</select></label></div><div className={styles.controls}><button type="button" className={styles.button} onClick={() => setDark(!dark)}>{dark ? "Light theme" : "Dark theme"}</button><button type="button" className={styles.button} aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}{hidden ? "Show figures" : "Hide figures"}</button></div><p className={`${styles.label} mt-4`}>Both options remove Card balance ahead from Patterns. Card balances belong in Accounts; the flat forecast adds little here. Nothing in this preview saves a rule or changes a transaction.</p></details>
      </header>
      <div id="spending-patterns" className={styles.heading}><div><h2>Your spending patterns</h2><p className={`${styles.muted} mt-2`}>{subtitle}</p></div><BarChart3 className="mt-1 shrink-0 text-indigo-600 dark:text-indigo-300" size={24} aria-hidden="true" /></div>

      {example === "loading" ? <div className={styles.card} role="status"><h3>Loading your spending</h3><p className={`${styles.muted} mt-2`}>Your charts will appear when the transactions are ready.</p></div> : example === "error" ? <div className={styles.card} role="alert"><h3>Your spending couldn’t load</h3><p className={`${styles.muted} mt-2`}>Try again to see your charts.</p><button type="button" className={`${styles.button} mt-4`} onClick={() => changeExample("large")}>Try again</button></div> : example === "empty" ? <div className={styles.card}><h3>No spending to show yet</h3><p className={`${styles.muted} mt-2`}>Charts appear when your connected accounts have transactions counted as spending.</p></div> : incomplete ? <div className={styles.card}><h3>Only part of this period is available</h3><p className={styles.figure}>{money(data.total)}</p><p className={`${styles.muted} mt-2`}>Recorded spending from 1 to 4 Oct. The other days haven’t been received, so a full-period chart or comparison would be misleading.</p>{CountExplanation()}</div> : <>
        <div className={`${variant === "b" ? styles.focused : ""} mb-6`}><p className={styles.label}>All spending this period</p><p className={`${styles.figure} !mt-1`}>{money(data.total)}</p><p className={`${styles.muted} mt-2`}>{hasLarge ? <>Includes {money(data.largeTotal)} in {data.larger.length === 1 ? "one large payment" : `${data.larger.length} larger payments`}.</> : "No payments need a separate scale this period."}</p>{data.excluded.length > 0 && <p className={`${styles.muted} mt-2`}>{money(data.excluded[0].amount)} marked Not counted is outside this total. It still left your account.</p>}</div>
        {variant === "a" ? <div className={styles.grid}>
          <Card title="What did you spend each day?">{Daily({split: true})}</Card>
          <Card title="How did this period compare?">{Pace()}</Card>
          <Card title="What changed between pay periods?">{Periods()}</Card>
          <Card title="Were they small or large payments?">{Sizes()}</Card>
        </div> : <div className={styles.focused}>
          <nav aria-label="Spending questions" className={styles.focusNav}>{([{ id: "daily", label: "Day by day", icon: CalendarDays }, { id: "pace", label: "Compared with usual", icon: TrendingUp }, { id: "periods", label: "Pay periods", icon: BarChart3 }, { id: "sizes", label: "Payment sizes", icon: Layers }] as const).map(item => <button type="button" key={item.id} aria-pressed={question === item.id} aria-controls="question-content" className={styles.button} onClick={() => setQuestion(item.id)}><item.icon size={16} className="shrink-0" aria-hidden="true" /><span>{item.label}</span></button>)}</nav>
          <div id="question-content" aria-live="polite"><Card title={{ daily: "What did you spend each day?", pace: "How did this period compare?", periods: "What changed between pay periods?", sizes: "Were they small or large payments?" }[question]}>{question === "daily" ? Daily({split: false}) : question === "pace" ? Pace() : question === "periods" ? Periods() : Sizes()}</Card></div>
        </div>}
        <div className={variant === "b" ? styles.focused : ""}>{CountExplanation()}</div>
      </>}
    </div>
  </main>;
}
