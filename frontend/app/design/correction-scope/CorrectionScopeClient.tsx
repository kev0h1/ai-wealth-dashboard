"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { formatCurrency, MINUS } from "@/lib/currency";
import ScopePanelA from "./ScopePanelA";
import ScopePanelB from "./ScopePanelB";
import { applyScope, fixturePayments, protectedPayments, RESOLUTIONS, scopeOptions, type Payment, type Resolution, type Scenario, type Scope } from "./model";
import styles from "./preview.module.css";

type Rule = { category: string; resolution: Resolution; destination?: string };
type Result = { changed: number; protected: number; future: boolean };
const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "start", label: "Choose classification" }, { value: "savings", label: "Savings" },
  { value: "protected", label: "Earlier choices protected" }, { value: "empty", label: "No earlier matches" },
  { value: "count-error", label: "Count unavailable" }, { value: "save-error", label: "Save failure" },
  { value: "refresh-error", label: "Saved, refresh failed" }, { value: "hidden", label: "Hidden amounts" },
  { value: "long", label: "Long payee" }, { value: "older", label: "Older selected payment" },
];
const wait = () => new Promise(resolve => setTimeout(resolve, 240));

export default function CorrectionScopeClient() {
  const params = useSearchParams();
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const variant = params.get("variant") === "b" ? "b" : "a";
  const requested = params.get("state") || "start";
  const scenario = SCENARIOS.find(option => option.value === requested)?.value ?? "start";
  const [rows, setRows] = useState<Payment[]>(() => fixturePayments(scenario));
  const [open, setOpen] = useState(true);
  const [resolution, setResolution] = useState<Resolution | null>(scenario === "start" ? null : "savings");
  const [destinationStep, setDestinationStep] = useState<"goal" | "offline" | "spending" | null>(null);
  const [goal, setGoal] = useState("Holiday");
  const [offlineName, setOfflineName] = useState("Away savings");
  const [spendingCategory, setSpendingCategory] = useState("Groceries");
  const [scope, setScope] = useState<Scope>("one");
  const [countsReady, setCountsReady] = useState(scenario !== "count-error");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [rule, setRule] = useState<Rule | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [removedRule, setRemovedRule] = useState<Rule | null>(null);
  const [notice, setNotice] = useState("");
  const before = useRef<{ rows: Payment[]; rule: Rule | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hidden = scenario === "hidden";
  const current = rows.find(row => row.id === "current")!;
  const chosen = RESOLUTIONS.find(option => option.value === resolution);
  const category = resolution === "spending" ? spendingCategory : chosen?.category;
  const chosenDetail = resolution === "goal" ? `Money for your ${goal} goal.` : resolution === "offline" ? `Money for your ${offlineName.trim()} account.` : resolution === "spending" ? `Spending filed as ${spendingCategory}.` : chosen?.detail;
  const options = scopeOptions(rows, countsReady);
  const count = options.find(option => option.value === scope)?.count ?? null;
  const protectedCount = protectedPayments(rows).length;
  const money = `${MINUS}${hidden ? "£••••" : formatCurrency(current.amount, current.currency)}`;
  const paymentDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${current.date}T12:00:00Z`));
  const title = destinationStep ? (destinationStep === "goal" ? "Which goal?" : destinationStep === "spending" ? "Which category?" : "Which account?") : result ? `Updated ${result.changed} ${result.changed === 1 ? "payment" : "payments"}` : resolution && variant === "a" ? "Which payments should change?" : "Tell me what this was";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [resolution, result, destinationStep]);

  function choose(next: Resolution) { setDestinationStep(null); setResolution(next); setScope("one"); setError(""); }
  function begin(next: Resolution) { if (next === "goal" || next === "offline" || next === "spending") { setDestinationStep(next); setError(""); } else choose(next); }
  async function apply() {
    if (!chosen || !category || busy || count === null || count === 0) return;
    setBusy(true); setError("");
    await wait();
    if (scenario === "save-error" && !saveFailed) {
      setSaveFailed(true); setBusy(false); setError("Those payments could not be updated. Nothing changed. Try again."); return;
    }
    before.current = { rows, rule };
    const next = applyScope(rows, scope, category);
    setRows(next.rows);
    if (scope === "history-future") setRule({ category, resolution: chosen.value, ...(chosen.value === "goal" ? { destination: goal } : chosen.value === "offline" ? { destination: offlineName.trim() } : {}) });
    setResult({ changed: next.changed, protected: protectedCount, future: scope === "history-future" });
    setRefreshPending(scenario === "refresh-error"); setBusy(false);
  }
  function undo() {
    if (!before.current) return;
    setRows(before.current.rows); setRule(before.current.rule); before.current = null;
    setResult(null); setRefreshPending(false); setScope("one"); setNotice("Changes undone.");
  }
  const href = (next: { variant?: string; state?: string; mode?: string }) => `?variant=${next.variant ?? variant}&state=${next.state ?? scenario}&mode=${next.mode ?? mode}`;

  return <main className={styles.preview}>
    <div className={styles.previewControls}>
      <a href="/design">Design previews</a><h1>Correction scope · G453</h1>
      <p>Fictional payments. Changes stay in this preview.</p>
      <div className={styles.previewLinks}><a href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · Separate scope step</a><a href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Inline review</a><a href={href({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light theme" : "Dark theme"}</a></div>
      <div className={styles.previewLinks}>{SCENARIOS.map(option => <a key={option.value} href={href({ state: option.value })} aria-current={scenario === option.value ? "page" : undefined}>{option.label}</a>)}</div>
      <button type="button" className={styles.primary} onClick={() => setOpen(true)}>Open correction</button>
      <a className={styles.textButton} href={href({})}>Reset fictional data</a>
      <div className={styles.fixtureSummary}><p>{current.payee}</p><MoneyText text={money} /><p>Category: {current.customCategory ?? "Other"}</p>{rule ? <button type="button" className={styles.textButton} onClick={() => setRuleOpen(true)}>View future rule</button> : <p>No future rule saved.</p>}</div>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    {open && <SheetFrame title={title} headingRef={headingRef} description={result ? "Your correction is saved" : `${paymentDate} · Monzo Current`} onClose={() => setOpen(false)} dismissDisabled={busy}
      footer={({ close }) => destinationStep ? <div className={styles.footer}>
        {destinationStep === "offline" ? <button type="button" className={styles.primary} disabled={!offlineName.trim()} onClick={() => choose("offline")}>Use this account</button> : null}
        <button type="button" className={styles.secondary} onClick={() => setDestinationStep(null)}>Back</button>
      </div> : result ? <div className={styles.footer}>
        {refreshPending ? <button type="button" className={styles.primary} disabled={busy} onClick={async () => { setBusy(true); await wait(); setRefreshPending(false); setBusy(false); setNotice("Figures refreshed. No payments were updated again."); }}>{busy ? "Refreshing…" : "Refresh figures"}</button> : <button type="button" className={styles.primary} onClick={close}>Done</button>}
        <button type="button" className={styles.textButton} disabled={busy} onClick={undo}>Undo correction</button>
      </div> : chosen ? <div className={styles.footer}>
        <button type="button" className={styles.primary} disabled={busy || count === null || count === 0} onClick={apply}>{busy ? "Updating…" : count === null ? "Check matching payments" : `Update ${count} ${count === 1 ? "payment" : "payments"}`}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setResolution(null); setScope("one"); setError(""); }}>Back</button>
      </div> : <button type="button" className={styles.secondary} onClick={close}>Cancel</button>}>
      <div className={styles.body}>
        <div className={styles.payment}><strong>{current.payee}</strong><MoneyText className="money" text={money} /></div>
        {destinationStep === "goal" ? <section className={styles.resolutionChoices} aria-label="Choose a goal">{["Holiday", "House repairs"].map(name => <button type="button" key={name} onClick={() => { setGoal(name); choose("goal"); }}><strong>{name}</strong><small>Existing goal</small></button>)}</section> : destinationStep === "offline" ? <section className={styles.destination}>
          <label htmlFor="g453-offline-name">Account name</label><input id="g453-offline-name" name="offline-account-name" autoComplete="off" maxLength={60} value={offlineName} onChange={event => setOfflineName(event.target.value)} />
          <p>This account name stays visible with the destination.</p>
        </section> : destinationStep === "spending" ? <section className={styles.resolutionChoices} aria-label="Choose a category">{["Groceries", "Eating Out", "Shopping", "Other"].map(name => <button type="button" key={name} onClick={() => { setSpendingCategory(name); choose("spending"); }}><strong>{name}</strong><small>Existing category</small></button>)}</section> : result ? <section className={styles.confirmation} data-correction-saved>
          <h3>Filed as {category}.</h3><p>{result.protected} payments you already categorised were not changed.</p>
          {result.future && rule ? <p>New matching outgoing payments will be filed as {rule.category}.</p> : <p>No future rule was changed.</p>}
          {refreshPending ? <p className={styles.message} role="status">Your changes are saved, but the figures have not refreshed. Refresh figures to check the latest totals.</p> : <p>The payment list and figures are refreshed.</p>}
          {rule ? <button type="button" className={styles.textButton} onClick={() => setRuleOpen(true)}>View future rule</button> : null}
        </section> : chosen ? <>
          <div className={styles.chosen}>{variant === "a" ? <p>Change to <strong>{category}</strong></p> : null}<p>{chosenDetail}</p>{variant === "b" ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => { setResolution(null); setScope("one"); }}>Change classification</button> : null}</div>
          {!countsReady ? <div className={styles.message} role="status"><p>Earlier payments could not be checked. You can still update this payment only.</p><button type="button" className={styles.textButton} disabled={busy} onClick={async () => { setBusy(true); await wait(); setCountsReady(true); setBusy(false); }}>Try checking again</button></div> : null}
          {variant === "a" ? <ScopePanelA options={options} scope={scope} onChange={setScope} category={category!} protectedCount={protectedCount} disabled={busy} /> : <ScopePanelB options={options} scope={scope} onChange={setScope} category={category!} protectedCount={protectedCount} disabled={busy} />}
          {error ? <p className={styles.message} role="alert">{error}</p> : null}
        </> : <section className={styles.resolutionChoices} aria-label="What was this payment?">{RESOLUTIONS.map(option => <button type="button" key={option.value} onClick={() => begin(option.value)}><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</section>}
      </div>
    </SheetFrame>}
    {ruleOpen && <SheetFrame title="Future filing rule" description="Saving Challenge (2026)" nested={open} onClose={() => setRuleOpen(false)} footer={({ close }) => <button type="button" className={styles.secondary} onClick={close}>Done</button>}>
      <div className={styles.body} role="status" aria-live="polite">{rule ? <><h3 className={styles.ruleHeading}>File new outgoing payments as {rule.category}</h3>{rule.destination ? <p>Destination: {rule.destination}</p> : null}<p>Only matching payments to this payee use the rule. Your existing categories stay protected.</p><p>Removing the rule leaves payments already updated unchanged.</p><button type="button" className={styles.textButton} onClick={() => { setRemovedRule(rule); setRule(null); setNotice("Future rule removed. Existing payments are unchanged."); }}>Remove future rule</button></> : <><h3 className={styles.ruleHeading}>Future rule removed</h3><p>Existing payments are unchanged. New ones will follow normal categorisation.</p>{removedRule ? <button type="button" className={styles.textButton} onClick={() => { setRule(removedRule); setRemovedRule(null); setNotice("Future rule restored."); }}>Undo rule removal</button> : null}</>}</div>
    </SheetFrame>}
  </main>;
}
