"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Utensils } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import MirrorNextStep from "@/components/MirrorNextStep";
import { AimRing } from "@/components/AimProgress";
import { TraitCard } from "@/app/mirror/MirrorPage";
import type { Checkpoint, MirrorTrait } from "@/lib/api";
import { evidenceFor, exampleFor, fees, frequency, scenarios, type Scenario } from "./fixtures";
import styles from "./styles.module.css";

type Choice = "keep" | "change" | null;
const money = (n: number, masked: boolean) => masked ? "£••••" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);

function AimEditor({ amount, future, save, cancel }: { amount: number; future: boolean; save: (n: number) => void; cancel: () => void }) {
  const [draft, setDraft] = useState(String(amount));
  const [error, setError] = useState("");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  return <form noValidate className={styles.editor} onSubmit={event => {
    event.preventDefault();
    const value = Number(draft);
    if (!draft.trim() || !Number.isFinite(value) || value <= 0 || Math.round(value * 100) / 100 !== value) {
      setError("Enter an amount above £0 with no more than 2 decimal places.");
      field.current?.focus();
      return;
    }
    save(value);
  }}>
    <label htmlFor={id} className="text-sm font-semibold">{future ? "Next period’s aim (£)" : "Aim for this period (£)"}</label>
    <p className={styles.quiet}>{future ? "The completed period keeps its original aim. This is the pace for the next check." : "A pace to check against, not a spending limit."}</p>
    <div className="mt-3 flex gap-2">
      <input ref={field} id={id} name="illustrative-aim" autoComplete="off" type="number" inputMode="decimal" step="0.01" min="0.01" value={draft} onChange={event => { setDraft(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? id + "-error" : undefined} className={styles.input} />
      <button type="submit" className={styles.button}>Save local aim</button>
    </div>
    {error && <p id={id + "-error"} className={styles.quiet} role="alert">{error}</p>}
    <button type="button" className={styles.subtle} onClick={cancel}>Cancel</button>
  </form>;
}

function Evidence({ scenario, masked, unavailable, retry }: { scenario: Scenario; masked: boolean; unavailable: boolean; retry: () => void }) {
  const example = exampleFor(scenario);
  return <section className={styles.evidenceColumn} aria-label="Illustrative evidence">
    <section className={styles.surface}>
      <div className={styles.body}>
        <h2 className="text-base font-bold">The evidence behind it</h2>
        <p className={styles.quiet}>Illustrative transactions only. No account changes.</p>
        {unavailable ? <>
          <p className="mt-4 text-sm leading-6">{scenario === "thin" ? "There is not enough history to show a result yet." : scenario === "stale" ? "The history is out of date, so a result is withheld." : "The history could not be loaded. No result has been estimated."}</p>
          <button type="button" className={styles.button + " mt-3"} onClick={retry}>Retry locally</button>
        </> : <>
          <p className="mt-4 text-sm font-semibold">Eating Out · {example.period}</p>
          <p className={styles.quiet}>The named payments and grouped remainder reconcile to this example’s total.</p>
          <dl className="mt-3">
            {evidenceFor(scenario).map(row => <div className={styles.row} key={row.name}>
              <dt className="min-w-0"><span className={styles.quiet}>{row.date}</span><br />{row.name}</dt>
              <dd><MoneyText text={money(row.amount, masked)} /></dd>
            </div>)}
            <div className={styles.totalRow}><dt>Total shown</dt><dd><MoneyText text={money(example.spent, masked)} /></dd></div>
          </dl>
          <details className={styles.reference}>
            <summary>4 payment-related charges</summary>
            <p className={styles.quiet}>These charges total <MoneyText text={money(36, masked)} />. A fee alone does not prove a missed payment.</p>
            <dl>{fees.map(row => <div className={styles.row} key={row.name}><dt>{row.date}<br />{row.name}</dt><dd><MoneyText text={money(row.amount, masked)} /></dd></div>)}</dl>
          </details>
        </>}
      </div>
    </section>
    {!unavailable && <details className={styles.reference}>
      <summary>How the recent pattern changed</summary>
      <p className={styles.quiet}>Payment counts across 4 completed weeks, separate from the reviewed pay period. Snapshot: 17 Oct. Counts show what happened, not why.</p>
      <dl>{frequency.map(row => <div className={styles.row} key={row.week}><dt>{row.week}</dt><dd>{row.count} payments</dd></div>)}</dl>
    </details>}
  </section>;
}

export default function MirrorLoopClient() {
  const params = useSearchParams();
  return <MirrorLoopState key={params.toString()} params={params} />;
}

function MirrorLoopState({ params }: { params: { get: (key: string) => string | null } }) {
  const variant = params.get("variant") === "b" ? "b" : "a";
  const candidate = (params.get("scenario") ?? params.get("state")) as Scenario;
  const scenario = scenarios.includes(candidate) ? candidate : "active";
  const dark = params.get("mode") === "dark";
  const masked = params.get("masked") === "1";
  const example = exampleFor(scenario);
  const [choice, setChoice] = useState<Choice>(scenario === "kept" ? "keep" : scenario === "choose" ? null : "change");
  const [hasAim, setHasAim] = useState(!["choose", "kept"].includes(scenario));
  const [amount, setAmount] = useState(example.aim);
  const [stopped, setStopped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [retried, setRetried] = useState(false);
  const [notice, setNotice] = useState("");
  const unavailable = !retried && ["thin", "stale", "error"].includes(scenario);
  const consented = choice === "change";
  const focused = consented && hasAim && !stopped;
  const editTrigger = useRef<HTMLButtonElement>(null);
  const href = (next: Partial<{ variant: string; scenario: string; dark: boolean; masked: boolean }>) => {
    const state = { variant, scenario, dark, masked, ...next };
    return "?" + new URLSearchParams({ variant: state.variant, scenario: state.scenario, mode: state.dark ? "dark" : "light", masked: state.masked ? "1" : "0" });
  };
  useEffect(() => {
    const root = document.documentElement;
    const prior = root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    return () => { root.classList.toggle("dark", prior); };
  }, [dark]);

  function choose(next: Choice) {
    setChoice(next); setEditing(false); setConfirmStop(false); setNotice("");
  }
  function saveAim(value: number) {
    setAmount(value); setHasAim(true); setStopped(false); setEditing(false);
    setNotice(example.closed ? "Local pace chosen for next period. The completed result is unchanged." : "Local aim saved. No account data has changed.");
    editTrigger.current?.focus();
  }
  const editor = editing && !masked ? <AimEditor amount={amount} future={example.closed} save={saveAim} cancel={() => { setEditing(false); editTrigger.current?.focus(); }} /> : null;
  const stop = confirmStop ? <div className={styles.editor}>
    <p className="text-sm">Stop this local pace check? Your trait choice stays unchanged.</p>
    <div className="mt-2 flex gap-3">
      <button type="button" className={styles.button} onClick={() => { setStopped(true); setConfirmStop(false); setEditing(false); setNotice("Local aim stopped. Your trait choice has not changed."); }}>Confirm stop</button>
      <button type="button" className={styles.subtle} onClick={() => setConfirmStop(false)}>Keep checking</button>
    </div>
  </div> : null;

  const focus = !consented ? null : unavailable ? <p className={styles.quiet}>A result and next step wait until there is enough current transaction evidence.</p> : stopped ? <div><p className={styles.quiet}>This local aim is stopped. Your trait choice is unchanged.</p><button type="button" className={styles.subtle} onClick={() => { setStopped(false); setNotice("Local aim restarted."); }}>Restart local aim</button></div> : !hasAim ? <>
    {!editing && (masked ? <button type="button" className={styles.button} onClick={() => setNotice("Show figures to choose a local aim.")}>Set an aim</button> : <MirrorNextStep kind="aim" category="Eating Out" amount={example.aim} onAct={() => setEditing(true)} onSeeNext={() => setEditing(true)} />)}
    {editor}
  </> : example.closed ? <div>
    <h3 className="text-base font-bold">What happened · {example.period}</h3>
    <p className={styles.comparison}><MoneyText text={money(example.spent, masked)} /> <span className={styles.quiet}>against a</span> <MoneyText text={money(example.aim, masked)} /> <span className={styles.quiet}>aim</span></p>
    <p className={styles.quiet}>{masked ? "Comparison amounts are hidden." : <><MoneyText text={money(Math.abs(example.spent - example.aim), false)} /> {example.spent > example.aim ? "above" : "below"} the pace you chose.</>} Passing an aim is not a payment risk.</p>
    <p className="mt-3 text-sm leading-6">Does this pace still fit? Keep it for the next period, choose a different amount or stop the check.</p>
    <div className={styles.reviewActions}>
      <button type="button" className={styles.choice} onClick={() => { setAmount(example.aim); setNotice("Local choice: keep this pace for the next period."); }}>Keep aim</button>
      <button type="button" ref={editTrigger} className={styles.choice} onClick={() => { if (masked) setNotice("Show figures to adjust a local aim."); else setEditing(true); }}>Adjust aim</button>
      <button type="button" className={styles.choice} onClick={() => setConfirmStop(true)}>Stop aim</button>
    </div>
    <p className={styles.quiet}>Next period’s local pace: <MoneyText text={money(amount, masked)} />. Nothing has been saved to your account.</p>
    {editor}{stop}
  </div> : <div>
    <h3 className="text-base font-bold">Your chosen pace is being checked</h3>
    <p className={styles.comparison}><MoneyText text={money(example.spent, masked)} /> <span className={styles.quiet}>of a</span> <MoneyText text={money(amount, masked)} /> <span className={styles.quiet}>aim</span></p>
    <div className={styles.pace}><p className={styles.quiet}>3–30 Oct · snapshot 17 Oct<br />13 days left. A pace check, not a limit.</p>{!masked && <AimRing aim={{ id: "illustrative-eating-out", aim_amount: amount, spent_so_far: example.spent, days_left: 13, on_track: example.spent <= amount } satisfies Checkpoint} periodDays={28} />}</div>
    <p className="mt-3 text-sm leading-6">The result will be checked from transactions at period end. There is nothing to tick off.</p>
    <div className={styles.reviewActions}>
      <button ref={editTrigger} type="button" className={styles.subtle} onClick={() => { if (masked) setNotice("Show figures to adjust a local aim."); else setEditing(true); }}>Adjust this aim</button>
      <button type="button" className={styles.subtle} onClick={() => setConfirmStop(true)}>Stop checking this aim</button>
    </div>
    {editor}{stop}
  </div>;

  const trait = <section className={styles.surface} aria-label="Trait and choice">
    <div className={styles.head}>
      <div className="flex items-start gap-3"><span className={styles.category} aria-hidden="true"><Utensils size={18} /></span><div><h2 className="text-base font-bold">Your signature: Eating Out</h2><p className={styles.quiet}>A pattern in the example transactions, not a judgement or score.</p></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={styles.choice} aria-pressed={choice === "keep"} onClick={() => choose("keep")}>Keep this trait</button>
        <button type="button" className={styles.choice} aria-pressed={choice === "change"} onClick={() => choose("change")}>Change this trait</button>
      </div>
    </div>
    <div className={styles.body}>
      {choice === "keep" ? <p className={styles.quiet}>That is part of how you do things, so it stays as it is. No coaching on this trait.</p> : choice === null ? <p className={styles.quiet}>Choose what feels right for this trait. Coaching stays off until you choose change.</p> : variant === "b" && focused ? <p className={styles.quiet}>You chose to check one pace. Its {example.closed ? "review" : "progress"} is in focus above.</p> : focus}
    </div>
  </section>;
  const referenceTrait: MirrorTrait = { id: "reference", title: "Your Signature: Eating Out", narrative: "Current production card, shown with synthetic data.", evidence: ["Illustrative only."], kind: "pleasure", choice: null, ref_category: "Eating Out" };

  return <div className={[styles.shell, dark ? styles.dark + " dark" : ""].join(" ")}>
    <main className={styles.frame}>
      <header><h1 className="text-xl font-bold">How your money behaves</h1><p className="mt-2 text-sm">G286 design preview. Illustrative examples and local choices only.</p></header>
      <nav className={styles.previewNav} aria-label="Preview controls">
        <a className={styles.control} aria-current={variant === "a" ? "page" : undefined} href={href({ variant: "a" })}>A · Trait in motion</a>
        <a className={styles.control} aria-current={variant === "b" ? "page" : undefined} href={href({ variant: "b" })}>B · Period review</a>
        <details className={styles.exampleMenu}><summary>Examples &amp; display</summary><div>{scenarios.map(item => <a className={styles.menuLink} key={item} href={href({ scenario: item })}>{item}</a>)}<a className={styles.menuLink} href={href({ dark: !dark })}>{dark ? "Light mode" : "Dark mode"}</a><a className={styles.menuLink} href={href({ masked: !masked })}>{masked ? "Show figures" : "Mask figures"}</a></div></details>
      </nav>
      <p className={styles.quiet}>{variant === "a" ? "A keeps the whole loop with its trait." : "B brings one progress check or period review into focus."} History and period outcomes here are proposed views, not live API data.</p>
      <div role="status" className={styles.notice}>{notice}</div>
      <div className={styles.layout}>
        <div>
          {variant === "b" && focused && <section className={styles.surface} aria-label="Focused review"><div className={styles.body}>{focus}</div></section>}
          <div className={variant === "b" && focused ? "mt-4" : ""}>{trait}</div>
          <details className={styles.reference}><summary>Other patterns, kept quiet</summary><p className={styles.quiet}>These kept traits receive no coaching.</p>{unavailable ? <p className={styles.quiet}>Their evidence waits until the example history is available.</p> : <><p className="mt-3 text-sm font-semibold">The Daily Saver</p><p className={styles.quiet}><MoneyText text={money(14872, masked)} /> moved to savings in this illustration.</p><p className="mt-3 text-sm font-semibold">The Orchestrator</p><p className={styles.quiet}><MoneyText text={money(2270, masked)} /> moved between accounts in this illustration.</p></>}</details>
          <details className={styles.reference}><summary>Current reference card</summary><div inert className="mt-3"><TraitCard trait={referenceTrait} activeAim={null} onChoice={() => {}} onSetAim={() => {}} /></div></details>
        </div>
        <Evidence scenario={scenario} masked={masked} unavailable={unavailable} retry={() => { setRetried(true); setNotice("Illustrative snapshot restored locally. No bank refresh was requested."); }} />
      </div>
    </main>
  </div>;
}
