"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight, CircleHelp, LoaderCircle, Pencil, Repeat2, Search, Target, Wallet } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DateField } from "@/components/DatePicker";
import { RhythmToggle, type AllocationRhythm } from "@/components/AllocationFields";
import { tidyAccountText } from "@/lib/accountDisplay";
import type { Account } from "@/lib/api";
import { ALL_ACCOUNTS, BANK_ACCOUNTS, POTS, rankedTransfers, allSourceTransfers, amountForGoal, type EditorKind } from "./fixtures";
import styles from "./editor.module.css";

type Variant = "a" | "b";
type Scenario = "suggested" | "tight" | "no-match" | "unassigned" | "partial";
type View = "main" | "details" | "route" | "source" | "destination" | "tracking" | "payments" | "manual";
type Rule = { reference: string; label: string; type: "description_contains" | "description_equals"; amount?: number; occurrences?: number };
type Draft = { name: string; target: string; date: string; amount: string; source: string; destinations: string[]; rhythm: AllocationRhythm };
const money = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const sourceAccounts = BANK_ACCOUNTS.filter(account => !`${account.type} ${account.subtype}`.toLowerCase().includes("credit") && account.include_in_safe_to_spend !== false);
const scenarios: [Scenario, string][] = [["suggested", "Suggested"], ["tight", "Tight"], ["no-match", "No match"], ["unassigned", "Unassigned"], ["partial", "Partial period"]];
const initialDraft = (kind: EditorKind, scenario: Scenario): Draft => ({ name: kind === "goal" ? "Japan" : "Annual costs", target: "1800", date: "2027-08-01", amount: "80", source: scenario === "unassigned" ? "" : "barclays-premier", destinations: kind === "goal" ? ["barclays-japan"] : [], rhythm: "every_period" });
const accountName = (account: Account) => account.manual ? account.name : tidyAccountText(account.name);

function Money({ value }: { value: number }) { return <span className={styles.money}>{money(value)}</span>; }

function Choices({ label, children }: { label: string; children: ReactNode }) { return <nav aria-label={label} className={styles.previewChoices}><p>{label}</p><div>{children}</div></nav>; }

function AccountIdentity({ account, caption }: { account: Account; caption?: string }) {
  const brand = accountBrand(account);
  return <div className={styles.identity}>
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} />
    <span><strong>{accountName(account)}</strong><small>{caption ?? brand.label}</small></span>
  </div>;
}

function Editor({ variant, kind, scenario, mode, onClose }: { variant: Variant; kind: EditorKind; scenario: Scenario; mode: "light" | "dark"; onClose(): void }) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(kind, scenario));
  const [step, setStep] = useState(0);
  const [view, setView] = useState<View>("main");
  const [chosenRule, setChosenRule] = useState<Rule | null>(null);
  const [manualTracking, setManualTracking] = useState(kind === "set-aside");
  const [reference, setReference] = useState("");
  const [matchType, setMatchType] = useState<Rule["type"]>("description_contains");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [partialChoice, setPartialChoice] = useState<"roll" | "missed" | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const target = Number(draft.target);
  const contribution = kind === "goal" ? amountForGoal(Number.isFinite(target) ? target : 0, draft.date, 1000) : Number(draft.amount);
  const amount = Number.isFinite(contribution) ? contribution : 0;
  const source = ALL_ACCOUNTS.find(account => account.id === draft.source);
  const destinations = POTS.filter(account => draft.destinations.includes(account.id));
  const matches = scenario === "no-match" || !draft.source ? [] : rankedTransfers(draft.source, draft.destinations, amount);
  const proposed = matches[0];
  const effectiveRule: Rule | null = manualTracking ? null : chosenRule ?? (proposed ? { reference: proposed.description, label: proposed.displayName, type: "description_contains", amount: proposed.amount, occurrences: proposed.occurrences } : null);
  const routeLabel = destinations.length === 0 ? "Kept in the paying account" : destinations.length === 1 ? accountName(destinations[0]) : `${destinations.length} savings pots`;
  const detailView = view === "details" || (view === "main" && variant === "b" && step === 0);
  const routeView = view === "route" || (view === "main" && variant === "b" && step === 1);
  const trackingView = view === "tracking" || (view === "main" && variant === "b" && step === 2);
  const summaryView = view === "main" && variant === "a";
  const overview = kind === "goal" ? "plan" : "set-aside";
  const isRootStep = view === "main";

  function moveTo(next: View, trigger?: HTMLButtonElement) {
    if (trigger?.dataset.returnFocus) returnFocus.current = trigger.dataset.returnFocus;
    const rootStep = variant === "b" && ((next === "details" && step === 0) || (next === "route" && step === 1) || (next === "tracking" && step === 2));
    setView(rootStep ? "main" : next); setError(""); setQuery("");
    bodyRef.current?.scrollTo({ top: 0 });
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }
  function restorePartFocus() {
    requestAnimationFrame(() => {
      const key = returnFocus.current;
      const control = key ? bodyRef.current?.querySelector<HTMLButtonElement>(`[data-return-focus="${key}"]`) : null;
      if (control) control.focus();
      else headingRef.current?.focus({ preventScroll: true });
    });
  }
  function back() {
    if (view === "source" || view === "destination") { moveTo("route"); restorePartFocus(); }
    else if (view === "payments" || view === "manual") moveTo("tracking");
    else if (view !== "main") {
      moveTo("main");
      restorePartFocus();
    } else if (step > 0) { setStep(step - 1); setError(""); bodyRef.current?.scrollTo({ top: 0 }); requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true })); }
  }
  function update(values: Partial<Draft>, resetRule = false) {
    setDraft(current => ({ ...current, ...values })); setError("");
    if (resetRule) { setChosenRule(null); setManualTracking(false); }
  }
  function fail(message: string) {
    setError(message);
    requestAnimationFrame(() => {
      const field = bodyRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
      (field ?? errorRef.current)?.focus();
    });
  }
  function validateDetails() {
    if (!draft.name.trim()) { fail("Give this a name so you can recognise it."); return false; }
    if (kind === "goal" && (!Number.isFinite(target) || target <= 1000 || !draft.date || draft.date <= "2026-10-14" || amount <= 0)) { fail("Choose a target above the £1,000 already saved and a future date."); return false; }
    if (kind === "set-aside" && (!Number.isFinite(amount) || amount < 0.01 || amount > 1000000)) { fail("Enter an amount between £0.01 and £1,000,000."); return false; }
    return true;
  }
  function validateRoute() {
    if (!source) { fail("Choose the account this money will come from."); return false; }
    if (kind === "goal" && destinations.length === 0) { fail("Choose at least one savings pot for this goal."); return false; }
    return true;
  }
  function submit() {
    if (view === "manual") {
      if (!reference.trim()) { fail("Enter a specific transfer reference, or go back to choose a payment."); return; }
      setChosenRule({ reference: reference.trim(), label: reference.trim(), type: matchType }); setManualTracking(false); moveTo("tracking"); return;
    }
    if (view === "source" || view === "destination") { moveTo("route"); restorePartFocus(); return; }
    if (detailView && !validateDetails()) return;
    if (routeView && !validateRoute()) return;
    if (!isRootStep) { moveTo("main"); restorePartFocus(); return; }
    if (variant === "b" && step < 2) { setStep(step + 1); setError(""); bodyRef.current?.scrollTo({ top: 0 }); requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true })); return; }
    if (!validateDetails() || !validateRoute()) return;
    if (kind === "set-aside" && !destinations.length && !manualTracking) { moveTo("tracking"); fail("Choose ‘Check it yourself’, or select a receiving account to recognise a transfer."); return; }
    if (!effectiveRule && !manualTracking) { moveTo("tracking"); fail("Choose a transfer reference or select ‘Check it yourself’."); return; }
    if (scenario === "partial" && kind === "goal" && !partialChoice) { fail("Choose what to do with last period’s £20 before confirming."); return; }
    setBusy(true);
    saveTimer.current = setTimeout(() => { setBusy(false); setSaved(true); }, 500);
  }

  function renderAffordability() {
    const available = scenario === "tight" ? 42 : 220;
    return <div className={styles.affordability}><CircleHelp size={17} aria-hidden="true" /><p>{amount > available
      ? <>This needs <Money value={amount - available} /> more than the <Money value={available} /> left after usual costs and repayments. You can lower the amount or give it longer.</>
      : <><Money value={available - amount} /> left each pay period after this {overview}, usual costs and repayments.</>}<span>Estimate from this example’s monthly pattern.</span></p></div>;
  }

  function renderContribution(compact = false) {
    return <div className={compact ? styles.contributionCompact : styles.contribution}>
      <p className={styles.figure}><Money value={amount} /><span>{kind === "set-aside" && draft.rhythm === "once" ? "this pay period" : "each pay period"}</span></p>
      {kind === "goal" && <p className={styles.caption}><Money value={1000} /> saved of <Money value={Number.isFinite(target) ? target : 0} /> · by {date(draft.date)}</p>}
      {kind === "goal" && <div className={styles.progress} role="progressbar" aria-label="Japan savings progress" aria-valuenow={Math.min(100, Math.round(100000 / Math.max(target, 1000)))} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, 100000 / Math.max(target, 1000))}%` }} /></div>}
    </div>;
  }

  function renderRoute(editable = true) {
    return <section aria-label="Where the money comes from and goes" className={styles.route}>
      <button type="button" data-return-focus="source" className={styles.accountButton} disabled={!editable} onClick={event => moveTo("source", event.currentTarget)} aria-label="Change paying account">
        <span className={styles.rowLabel}>Pay from</span>
        {source ? <AccountIdentity account={source} /> : <strong>Choose a paying account</strong>}
        {editable && <ChevronRight size={16} aria-hidden="true" />}
      </button>
      <div className={styles.routeDivider}><ArrowDown size={15} aria-hidden="true" /><span>{kind === "goal" ? "Towards your goal" : destinations.length ? "Optional payment tracking" : "Reserved here, until you use it"}</span></div>
      <button type="button" data-return-focus="destination" className={styles.accountButton} disabled={!editable} onClick={event => moveTo("destination", event.currentTarget)} aria-label={kind === "goal" ? "Change savings pots" : "Change receiving account"}>
        <span className={styles.rowLabel}>{kind === "goal" ? "Save in" : "Set aside"}</span>
        {destinations.length === 1 ? <AccountIdentity account={destinations[0]} /> : <strong>{routeLabel}</strong>}
        {destinations.length > 1 && <small className={styles.caption}>{destinations.map(accountName).join(" · ")}</small>}
        {editable && <ChevronRight size={16} aria-hidden="true" />}
      </button>
    </section>;
  }

  function renderTrackingSummary() {
    return <div className={styles.trackingSummary}><span className={styles.trackingIcon}><Repeat2 size={18} aria-hidden="true" /></span><div>
      <p className={styles.rowLabel}>{effectiveRule ? "Suggested transfer rule" : manualTracking ? "Check it yourself" : "No matching transfer yet"}</p>
      <strong>{effectiveRule?.label ?? (manualTracking ? "No automatic match" : "Choose how to recognise it")}</strong>
      {effectiveRule?.amount !== undefined && <p className={styles.caption}><Money value={effectiveRule.amount} /> · {effectiveRule.occurrences} times in 90 days</p>}
    </div><ChevronRight size={16} aria-hidden="true" /></div>;
  }

  function renderPartialPeriod() {
    if (scenario !== "partial") return null;
    if (kind === "set-aside") return <section className={styles.partial}><h3>A fresh pay period</h3><p>Last period’s set-aside ended with <Money value={20} /> unused. A set-aside resets each period, without a goal balance to roll forward.</p></section>;
    return <section className={styles.partial}><h3>Last period needs a choice</h3><p><Money value={60} /> matched once. <Money value={20} /> of the <Money value={80} /> contribution remained.</p><div className={styles.choicePair}>
      <button type="button" aria-pressed={partialChoice === "roll"} onClick={() => setPartialChoice("roll")}>Roll over <Money value={20} /></button>
      <button type="button" aria-pressed={partialChoice === "missed"} onClick={() => setPartialChoice("missed")}>Mark it missed</button>
    </div>{partialChoice && <p role="status">{partialChoice === "roll" ? <>Next period would be <Money value={100} />, then the usual <Money value={80} />. This is within the 125% limit.</> : "The next period stays at the usual amount. The goal’s date would need a fresh check."}</p>}</section>;
  }

  const heading = saved ? "Your example is ready" : view === "source" ? "Choose the paying account" : view === "destination" ? (kind === "goal" ? "Choose savings pots" : "Where will you keep it?") : view === "payments" ? "Choose a different payment" : view === "manual" ? "Recognise a transfer" : detailView ? (variant === "b" && isRootStep ? `Edit ${overview}` : "Change the details") : routeView ? "Where the money goes" : trackingView ? "How we recognise it" : `Edit ${overview}`;
  const footerLabel = busy ? "Saving example…" : view === "manual" ? "Use this reference" : view === "source" ? "Use this account" : view === "destination" ? "Use these choices" : !isRootStep ? "Keep these changes" : variant === "b" && step < 2 ? (step === 0 ? "Choose accounts" : "Check the transfer") : `Confirm ${overview}`;

  return <SheetFrame title={heading} description={saved ? "Saved in this preview only." : <>{draft.name || "Untitled"} · {variant === "a" ? "Editable summary" : `Step ${step + 1} of 3`}</>} themeClass={mode === "dark" ? "dark" : ""} onClose={onClose} onBack={!saved && (view !== "main" || step > 0) ? back : undefined} headingRef={headingRef} bodyRef={bodyRef} bodyClassName={`px-5 py-5 ${styles.editor}`} dismissDisabled={busy}
    bodyHeader={!saved && variant === "b" ? <nav aria-label="Editor steps" className={styles.stepper}>{["Details", "Accounts", "Tracking"].map((label, index) => <span key={label} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{label}</span>)}</nav> : undefined}
    footer={<div className={styles.footer}>{error && <p ref={errorRef} data-editor-error tabIndex={-1} role="status" className={styles.error}>{error}</p>}{saved ? <button className={styles.primary} type="button" onClick={onClose}>Back to the designs</button> : <><p>{!isRootStep || (variant === "b" && step < 2) ? "Your draft stays here while you make changes." : "Confirms these choices. It does not move money."}</p><button className={styles.primary} disabled={busy} type="button" onClick={submit}>{busy && <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />}{footerLabel}{!busy && <ArrowRight size={16} aria-hidden="true" />}</button></>}</div>}>
    {saved ? <section className={styles.saved}><span><Check size={25} aria-hidden="true" /></span><h3>{draft.name}</h3>{renderContribution()}<p>From {source ? accountName(source) : "your paying account"} · {routeLabel}.</p><p>{effectiveRule ? <>Using the {effectiveRule.type === "description_equals" ? "exact" : "contains"} reference “{effectiveRule.reference}”.</> : "You will check each period yourself."}</p><p className={styles.caption}>Only this fictional example changed. Your accounts and plans have not been touched.</p></section> : <>
      {summaryView && <>{renderContribution()}{renderAffordability()}<button type="button" data-return-focus="details" className={styles.editRow} onClick={event => moveTo("details", event.currentTarget)}><span><strong>{draft.name}</strong><small>{kind === "goal" ? <>Target <Money value={target} /> · {date(draft.date)}</> : draft.rhythm === "once" ? "Just this period" : "Every pay period"}</small></span><Pencil size={16} aria-hidden="true" /><span className={styles.srOnly}>Change details</span></button>{renderRoute()}<p className={styles.suggestionNote}>{source ? "Suggested from recent transfers. Confirm below to use it." : "Choose a paying account before confirming."}</p><button type="button" data-return-focus="tracking" className={styles.editRow} onClick={event => moveTo("tracking", event.currentTarget)}>{renderTrackingSummary()}<span className={styles.srOnly}>Change transfer rule</span></button>{renderPartialPeriod()}</>}

      {detailView && <div className={styles.stack}><h3>{kind === "goal" ? "What are you saving for?" : "What is this money for?"}</h3><label className={styles.fieldLabel}>Name<input name="plan-name" autoComplete="off" maxLength={60} value={draft.name} aria-invalid={Boolean(error && !draft.name.trim())} onChange={event => update({ name: event.target.value })} className={styles.field} /></label>{kind === "goal" ? <><label className={styles.fieldLabel}>Total to save (£)<input name="plan-target" autoComplete="off" inputMode="decimal" type="number" min="1000.01" max="1000000" step="0.01" value={draft.target} aria-invalid={Boolean(error && target <= 1000)} onChange={event => update({ target: event.target.value }, true)} className={`${styles.field} ${styles.money}`} /></label><div><label className={styles.fieldLabel} htmlFor="plan-date">By when?</label><DateField id="plan-date" mode="day" label="Target date" value={draft.date} onChange={value => update({ date: value }, true)} min="2026-10-15" today="2026-10-14" themeClass={mode === "dark" ? "dark" : ""} /></div><div className={styles.calculation}><p>With <Money value={1000} /> already saved</p>{renderContribution(true)}<p className={styles.caption}>Worked from your target and the pay periods left.</p></div></> : <><label className={styles.fieldLabel}>Amount (£)<input name="set-aside-amount" autoComplete="off" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={draft.amount} onChange={event => update({ amount: event.target.value }, true)} className={`${styles.field} ${styles.money}`} /></label><RhythmToggle value={draft.rhythm} onChange={rhythm => update({ rhythm })} /><p className={styles.caption}>A set-aside keeps money out of Safe to Spend. It has no savings target or progress to track.</p></>}{renderAffordability()}</div>}

      {routeView && <div className={styles.stack}><h3>One clear money route</h3><p className={styles.bodyCopy}>Suggested from your recent transfers. Tap either part to change it.</p>{renderRoute()}<p className={styles.caption}>{kind === "goal" ? "Savings pots hold this goal’s progress. The paying account is where each contribution leaves." : "This money can stay in the paying account. A receiving account is optional, for recognising a payment."}</p>{renderAffordability()}</div>}

      {view === "source" && <div className={styles.stack}><p className={styles.bodyCopy}>Choose the current account this contribution leaves. Cards and accounts outside Safe to Spend are left out.</p><AccountRadioPicker accounts={sourceAccounts.filter(account => !draft.destinations.includes(account.id))} value={draft.source} onChange={sourceId => update({ source: sourceId }, true)} label="Pay from" /><p className={styles.caption}>Saving will confirm this account. An unassigned draft cannot be confirmed.</p></div>}

      {view === "destination" && <div className={styles.stack}><p className={styles.bodyCopy}>{kind === "goal" ? "Choose the pots that hold this goal. You can select more than one." : "Keep the money in your paying account, or recognise a transfer into a receiving account. Neither choice moves it."}</p>{kind === "set-aside" && <button type="button" className={styles.potChoice} aria-pressed={draft.destinations.length === 0} onClick={() => update({ destinations: [] }, true)}><Wallet size={20} aria-hidden="true" /><span><strong>Keep it in the paying account</strong><small>No savings progress or receiving pot</small></span><span className={styles.checkBox}>{draft.destinations.length === 0 && <Check size={14} aria-hidden="true" />}</span></button>}<div role="group" aria-label="Receiving pots" className={styles.potList}>{POTS.map(account => { const checked = draft.destinations.includes(account.id); return <button type="button" key={account.id} className={styles.potChoice} aria-pressed={checked} onClick={() => update({ destinations: kind === "goal" ? checked ? draft.destinations.filter(id => id !== account.id) : [...draft.destinations, account.id] : [account.id] }, true)}><AccountIdentity account={account} /><span className={styles.checkBox}>{checked && <Check size={14} aria-hidden="true" />}</span></button>; })}</div><p className={styles.caption}>Receiving pots are outside Safe to Spend. Their balances still belong to you.</p></div>}

      {trackingView && <div className={styles.stack}>
        <h3>{destinations.length ? "Is this the transfer?" : "How will you check it?"}</h3>
        <p className={styles.bodyCopy}>{kind === "goal" ? "Recognise your outgoing transfer. It counts once towards this period." : destinations.length ? "Recognise the payment into the receiving account, without tracking a savings target." : "The money stays in your paying account. You can check it yourself each period."}</p>
        {effectiveRule ? <section className={styles.ruleCard}>
          {renderTrackingSummary()}
          <p className={styles.ruleReason}>{chosenRule ? "Chosen in this example." : "A regular transfer to the selected pot."}</p>
          <details><summary>Transfer reference</summary><p className={styles.rawReference}>{effectiveRule.reference}</p><p className={styles.caption}>{effectiveRule.type === "description_equals" ? "Exactly this reference" : "Contains this reference"}{kind === "goal" ? " on payments leaving your paying account." : " on payments into the receiving account."}</p></details>
        </section> : <p className={styles.empty}>{manualTracking ? "You will check it yourself. No transaction rule will be saved." : "No suitable transfer in this example’s 90-day history. Choose a reference or check it yourself."}</p>}
        {variant === "b" && isRootStep && <section className={styles.finalSummary}>
          <h3>Ready to confirm</h3><p><Money value={amount} /> {draft.rhythm === "once" && kind === "set-aside" ? "this period" : "each pay period"} from {source ? accountName(source) : "an account still to choose"}.</p>
          <p className={styles.caption}>{routeLabel}{kind === "goal" ? ` · by ${date(draft.date)}` : ""}</p>{renderAffordability()}
        </section>}
        {kind === "goal" || destinations.length > 0 ? <>
          <button type="button" className={styles.linkButton} onClick={() => moveTo("payments")}>Choose a different payment<ChevronRight size={16} aria-hidden="true" /></button>
          <details className={styles.trackingOptions} open={!effectiveRule}>
            <summary>Other tracking options</summary>
            <button type="button" className={styles.linkButton} onClick={() => { setReference(effectiveRule?.reference ?? ""); moveTo("manual"); }}>Enter a transfer reference<ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" className={styles.manualChoice} aria-pressed={manualTracking} onClick={() => { setManualTracking(true); setChosenRule(null); setError(""); }}><span className={styles.checkBox}>{manualTracking && <Check size={14} aria-hidden="true" />}</span><span>Check it yourself<small>No automatic transaction match</small></span></button>
          </details>
        </> : <button type="button" className={styles.linkButton} onClick={() => moveTo("destination")}>Choose a receiving account<ChevronRight size={16} aria-hidden="true" /></button>}
        {renderPartialPeriod()}
        <p className={styles.caption}>{kind === "goal" ? "A partial contribution leaves only the remainder to account for. A credit into the pot confirms the transfer, rather than counting it again." : destinations.length ? "The receiving account is used for matching, not goal progress." : "This is a reservation in the paying account. It has no savings target or progress."}</p>
      </div>}

      {view === "payments" && <div className={styles.stack}><p className={styles.bodyCopy}>Transfers from the paying account, with the receiving pot shown. Card purchases are left out.</p><label className={styles.search}><Search size={17} aria-hidden="true" /><input name="payment-search" aria-label="Search transfers" autoComplete="off" placeholder="Search transfer references…" value={query} onChange={event => setQuery(event.target.value)} /></label><div className={styles.paymentList}>{allSourceTransfers(draft.source).filter(item => `${item.displayName} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map(item => { const matchesPot = draft.destinations.includes(item.destinationId); const destination = ALL_ACCOUNTS.find(account => account.id === item.destinationId); return <button type="button" key={item.id} className={styles.paymentChoice} disabled={!matchesPot} onClick={() => { setChosenRule({ reference: item.description, label: item.displayName, type: "description_contains", amount: item.amount, occurrences: item.occurrences }); setManualTracking(false); moveTo("tracking"); }}><span><strong>{item.displayName}</strong><small>{destination ? accountName(destination) : "Receiving account unknown"} · {item.occurrences} times</small>{!matchesPot && <small>Different receiving account</small>}</span><span className={styles.money}>−{money(item.amount)}</span></button>; })}</div>{allSourceTransfers(draft.source).filter(item => `${item.displayName} ${item.description}`.toLowerCase().includes(query.toLowerCase())).length === 0 && <p className={styles.empty}>No transfers match. Try another reference or enter one yourself.</p>}<button type="button" className={styles.linkButton} onClick={() => { setReference(""); moveTo("manual"); }}>Enter a reference instead<ChevronRight size={16} aria-hidden="true" /></button></div>}

      {view === "manual" && <div className={styles.stack}><p className={styles.bodyCopy}>Use a specific reference for the transfer {kind === "goal" ? "leaving the paying account" : "arriving in the receiving account"}. A broad word could match the wrong payment.</p><label className={styles.fieldLabel}>Transfer reference<input name="transfer-reference" autoComplete="off" spellCheck={false} maxLength={80} value={reference} onChange={event => { setReference(event.target.value); setError(""); }} className={styles.field} placeholder="e.g. Alex Taylor Japan…" /></label><fieldset><legend className={styles.fieldLabel}>Match the reference</legend><div className={styles.choicePair}>{(["description_contains", "description_equals"] as const).map(type => <button type="button" key={type} aria-pressed={matchType === type} onClick={() => setMatchType(type)}>{type === "description_contains" ? "Contains this" : "Exactly this"}</button>)}</div></fieldset><p className={styles.caption}>This sets a recognition rule. It does not schedule or make a bank payment.</p></div>}
    </>}
  </SheetFrame>;
}

export default function PlanEditorPreview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const kind: EditorKind = params.get("kind") === "set-aside" ? "set-aside" : "goal";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const scenario = (scenarios.find(([key]) => key === (params.get("state") ?? params.get("fixture")))?.[0] ?? "suggested") as Scenario;
  const [open, setOpen] = useState(params.get("open") !== "0");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  const href = (values: { variant?: Variant; kind?: EditorKind; state?: Scenario; mode?: string }) => `?${new URLSearchParams({ variant, kind, state: scenario, mode, open: "0", ...values })}`;
  return <div className={mode === "dark" ? "dark" : ""}>
    <main id="plan-editor-preview" className={styles.workbench}>
      <Link href="/design" className={styles.libraryLink}>Design library</Link><h1>Less form. More plan.</h1><p className={styles.intro}>Check a suggested plan, then change only what needs changing. Both designs use the same goal and set-aside fields.</p>
      <Choices label="Design"><Link href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · Editable summary</Link><Link href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Three short steps</Link></Choices>
      <Choices label="Example"><Link href={href({ kind: "goal" })} aria-current={kind === "goal" ? "page" : undefined}>Goal plan</Link><Link href={href({ kind: "set-aside" })} aria-current={kind === "set-aside" ? "page" : undefined}>Set-aside</Link></Choices>
      <Choices label="Situation">{scenarios.map(([key, label]) => <Link key={key} href={href({ state: key })} aria-current={scenario === key ? "page" : undefined}>{label}</Link>)}</Choices>
      <Choices label="Appearance"><Link href={href({ mode: "light" })} aria-current={mode === "light" ? "page" : undefined}>Light</Link><Link href={href({ mode: "dark" })} aria-current={mode === "dark" ? "page" : undefined}>Dark</Link></Choices>
      <section className={styles.launch}><span className={styles.launchIcon}>{kind === "goal" ? <Target size={22} aria-hidden="true" /> : <Wallet size={22} aria-hidden="true" />}</span><h2>{variant === "a" ? "A quick check, with edits in place" : "One decision at a time"}</h2><p>{variant === "a" ? "Contribution, money route and transfer rule together. Tap any part to edit it inside the same sheet." : "Details, accounts, then recognition. Suggested choices keep each step short, with one final confirmation."}</p><button type="button" className={styles.primary} onClick={() => setOpen(true)}>Open {kind === "goal" ? "plan" : "set-aside"} editor<ArrowRight size={16} aria-hidden="true" /></button></section>
      <p className={styles.fixtureNote}>Design preview · 6 bank accounts, 5 savings pots and 40 fictional transactions. Changes stay in this example.</p>
      <p className={styles.fixtureNote}>Close the sheet to switch designs or situations. A receiving-account tracker for a set-aside uses an incoming match; goal plans use the outgoing transfer. A set-aside kept in its paying account is a proposed framework option.</p>
    </main>
    {open && <Editor key={`${variant}-${kind}-${scenario}-${mode}`} variant={variant} kind={kind} scenario={scenario} mode={mode} onClose={() => setOpen(false)} />}
  </div>;
}
