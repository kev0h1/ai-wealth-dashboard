"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Check, ChevronRight, Info, Wallet } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { RhythmToggle, type AllocationRhythm } from "@/components/AllocationFields";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { PlanContribution } from "@/components/plans/PlanEditorSummary";
import MoneyText from "@/components/MoneyText";
import { tidyAccountName } from "@/lib/accountName";
import type { Account } from "@/lib/api";
import s from "./keep.module.css";

type Scenario = "one" | "many" | "global" | "none";
type Page = "details" | "review" | "source" | "destination" | "tracking";
type Draft = { name: string; amount: number; source: string; destination: string | null; rule: string | null; recurrence: AllocationRhythm };
const accounts: Account[] = [
  { id: "monzo", name: "Personal account", provider: "Monzo", type: "bank", subtype: "TRANSACTION", balance: 1200, currency: "GBP", status: "connected" },
  { id: "barclays", name: "PREMIER CURRENT ACCOUNT", provider: "Barclays", type: "bank", subtype: "TRANSACTION", balance: 560, currency: "GBP", status: "connected" },
  { id: "natwest", name: "Household bills", provider: "NatWest", type: "bank", subtype: "TRANSACTION", balance: 400, currency: "GBP", status: "connected" },
  { id: "holiday", name: "Holiday", provider: "Monzo", type: "bank", subtype: "SAVINGS", balance: 350, currency: "GBP", status: "connected" },
  { id: "rainy-day", name: "Rainy day", provider: "Chase", type: "bank", subtype: "SAVINGS", balance: 2000, currency: "GBP", status: "connected" },
  { id: "offline", name: "Car fund", provider: "Offline", type: "bank", subtype: "SAVINGS", balance: 100, currency: "GBP", status: "connected", manual: true },
];
const focusNext = (ref: { current: HTMLButtonElement | null }) => requestAnimationFrame(() => ref.current?.focus());

function Identity({ account }: { account: Account }) {
  const brand = accountBrand(account);
  return <span className={s.identity}>
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
    <span><strong>{tidyAccountName(account.name)}</strong><small>{account.provider}</small></span>
  </span>;
}

function ReserveEditor({ variant, scenario, editing, empty, state, onClose, onSaved }: {
  variant: "a" | "b"; scenario: Scenario; editing: boolean; empty: boolean; state: string;
  onClose(): void; onSaved(draft: Draft): void;
}) {
  const available = scenario === "one" ? accounts.slice(0, 1) : scenario === "none" ? accounts.slice(3) : accounts;
  const sources = available.filter(a => a.subtype === "TRANSACTION");
  const initialTransfer = editing && scenario === "many";
  const [name, setName] = useState(empty ? "" : "Car service");
  const [amount, setAmount] = useState(empty ? "" : "80");
  const [cadence, setCadence] = useState<AllocationRhythm>("every_period");
  const [sourceId, setSourceId] = useState(scenario === "global" || scenario === "none" ? "" : "monzo");
  const [transfer, setTransfer] = useState(initialTransfer);
  const [destinationId, setDestinationId] = useState(initialTransfer ? "holiday" : "");
  const [rule, setRule] = useState(initialTransfer ? "Monthly car fund" : "");
  const [page, setPage] = useState<Page>("details");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(state === "load-error");
  const [error, setError] = useState("");
  const [failedOnce, setFailedOnce] = useState(false);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const destinationButton = useRef<HTMLButtonElement>(null);
  const trackingButton = useRef<HTMLButtonElement>(null);
  const returnPage = useRef<Page>("details");
  const id = useId();
  const source = sources.find(a => a.id === sourceId);
  const destinations = available.filter(a => a.id !== sourceId);
  const destination = destinations.find(a => a.id === destinationId);
  const numeric = Number(amount.replaceAll(",", ""));
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount.replaceAll(",", "")) && numeric >= 0.01 && numeric <= 1000000;
  const detailsValid = name.trim().length > 0 && amountValid;
  const valid = detailsValid && Boolean(source) && (!transfer || Boolean(destination && rule.trim()));
  const subview = page === "source" || page === "destination" || page === "tracking";
  function back() {
    const previous = page;
    setPage(returnPage.current);
    focusNext(previous === "source" ? sourceButton : previous === "destination" ? destinationButton : trackingButton);
  }
  function open(next: Page) { returnPage.current = page; setPage(next); }
  function changeSource(next: string) {
    if (sourceId !== next) { setRule(""); if (destinationId === next) setDestinationId(""); }
    setSourceId(next); setError("");
  }
  function changeMode(next: boolean) {
    if (next !== transfer) { setDestinationId(""); setRule(""); }
    setTransfer(next); setError("");
  }
  async function confirm() {
    if (!valid || busy) return;
    setBusy(true); setError("");
    await new Promise(resolve => setTimeout(resolve, 650));
    if (state === "save-error" && !failedOnce) {
      setFailedOnce(true); setBusy(false); setError("The example could not be saved. Your draft is still here. Try again."); return;
    }
    onSaved({ name: name.trim(), amount: numeric, source: sourceId, destination: transfer ? destinationId : null, rule: transfer ? rule.trim() : null, recurrence: cadence });
    setSaved(true); setBusy(false);
  }
  const accountSection = <section className={s.accountSection}>
    <h3>Where the money stays</h3>
    {source ? <div className={s.accountRow}>
      <Identity account={source} />
      {sources.length > 1 && <button ref={sourceButton} type="button" onClick={() => open("source")} className={s.link} aria-label="Change paying account">Change</button>}
    </div> : sources.length ? <button ref={sourceButton} type="button" onClick={() => open("source")} className={s.choiceRow}>Choose the account to reserve from<ChevronRight size={17} aria-hidden="true" /></button> : <p>No paying account is available. A set-aside needs a counted GBP current account.</p>}
    {scenario === "one" ? <p>You only need this account. The money does not have to move.</p> : source && <fieldset className={s.modes}>
      <legend className="sr-only">Keep money here or track a transfer</legend>
      <label><input type="radio" name={`${id}-place`} checked={!transfer} onChange={() => changeMode(false)} /><span><strong>Keep it in this account</strong><small>Reserve it here, without moving it.</small></span></label>
      <label><input type="radio" name={`${id}-place`} checked={transfer} onChange={() => changeMode(true)} /><span><strong>I’ll move it to another account</strong><small>Optional: recognise your transfer when it arrives.</small></span></label>
    </fieldset>}
    {transfer && source && <div className={s.transfer}>
      <ArrowLeftRight size={18} aria-hidden="true" />
      <div className={s.transferCopy}>
        <button ref={destinationButton} type="button" onClick={() => open("destination")} className={s.choiceRow}><span>{destination ? <>To <strong>{tidyAccountName(destination.name)}</strong></> : "Choose a receiving account"}</span><ChevronRight size={17} aria-hidden="true" /></button>
        {destination && <button ref={trackingButton} type="button" onClick={() => open("tracking")} className={s.choiceRow}><span>{rule || "Choose a transfer to recognise"}</span><ChevronRight size={17} aria-hidden="true" /></button>}
      </div>
    </div>}
    <p className={s.explanation}>{transfer ? "Only a matching transfer arriving in the receiving account counts towards this set-aside. Sorted does not move money." : "The full amount stays reserved for the applicable pay period. It is not automatically marked as filled."}</p>
  </section>;
  return <SheetFrame title={saved ? "Preview confirmed" : subview ? page === "source" ? "Reserve from" : page === "destination" ? "Receiving account" : "Recognise your transfer" : page === "review" ? "Check your set-aside" : editing ? "Edit set-aside" : "Set money aside"}
    description={saved ? "Example only. No changes were saved to your account." : subview ? "Your draft stays in this sheet." : "Money can stay exactly where it is."}
    onClose={onClose} dismissDisabled={busy} onEscape={subview ? back : undefined}
    onBack={subview ? back : page === "review" ? () => setPage("details") : undefined}
    footer={({ close }) => saved ? <button type="button" className={s.primary} onClick={close}>Done</button> : loadFailed ? <button type="button" className={s.primary} onClick={() => setLoadFailed(false)}>Try loading accounts again</button> : <div className={s.footer}>
      <button type="button" className={s.secondary} onClick={subview ? back : close} disabled={busy}>{subview ? "Back" : "Cancel"}</button>
      <button type="button" className={s.primary} onClick={subview ? back : variant === "b" && page === "details" ? () => setPage("review") : () => void confirm()}
        disabled={busy || (!subview && !(variant === "b" && page === "details" ? detailsValid && sources.length > 0 : valid))}>
        {busy ? "Confirming…" : subview ? "Use this choice" : variant === "b" && page === "details" ? "Review set-aside" : "Confirm set-aside"}
      </button>
    </div>}>
    <fieldset className={s.editor} disabled={busy}>
      {saved ? <div className={s.success} role="status"><Check size={26} aria-hidden="true" /><h3>{name}</h3><PlanContribution amount={numeric} cadence={cadence === "once" ? "this pay period" : "each pay period"} /><p>{transfer ? "Transfer tracking confirmed in this example." : `Reserved in ${source?.provider}. Nothing needs to move.`}</p><p>No real set-aside was created.</p></div> : loadFailed ? <div role="alert"><h3>Accounts could not be loaded</h3><p>No account has been chosen or changed. Try loading them again.</p></div> : <>
        {page === "details" && <>
          {variant === "b" && <p className={s.step}>1 of 2 · What is it for?</p>}
          <div className={s.fields}>
            <label htmlFor={`${id}-name`}>What is it for?<input id={`${id}-name`} name="set-aside-name" autoComplete="off" value={name} onChange={event => {setName(event.target.value); setError("");}} maxLength={40} placeholder="e.g. Car service" /></label>
            <label htmlFor={`${id}-amount`}>Amount (£)<input id={`${id}-amount`} name="set-aside-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={event => {setAmount(event.target.value); setError("");}} placeholder="e.g. 80" aria-describedby={`${id}-amount-help`} /></label>
          </div>
          <p id={`${id}-amount-help`} className={s.help}><MoneyText text="An amount from £0.01 to £1,000,000, with up to two decimal places." /></p>
          <RhythmToggle value={cadence} onChange={setCadence} />
          {variant === "a" ? accountSection : <p className={s.quiet}><Wallet size={18} aria-hidden="true" />{source ? `Next: check the reserve in ${source.provider}. No transfer is needed.` : sources.length ? "Next: choose where this reserve belongs. It does not need a second account." : "No paying account is available. A set-aside needs a counted GBP current account."}</p>}
        </>}
        {page === "review" && <>
          <p className={s.step}>2 of 2 · Confirm where it stays</p>
          <PlanContribution amount={numeric} cadence={cadence === "once" ? "this pay period" : "each pay period"} />
          <div className={s.receipt}><strong>{name}</strong><button type="button" className={s.link} onClick={() => setPage("details")}>Edit details</button></div>
          {accountSection}
        </>}
        {page === "source" && <><p>This is the account whose spendable amount will be reduced. Choosing it does not move money.</p><AccountRadioPicker accounts={sources} value={sourceId} onChange={changeSource} label="Paying account" /></>}
        {page === "destination" && <><p>Only choose another account if you plan to move the money yourself.</p><AccountRadioPicker accounts={destinations} value={destinationId} onChange={next => {if(next !== destinationId) setRule("");setDestinationId(next);}} label="Receiving account" /></>}
        {page === "tracking" && <>
          <p>Choose the transfer arriving in {destination?.name}. Only matching incoming transfers count towards this period’s reserve.</p>
          <button type="button" className={s.choiceRow} aria-pressed={rule === "Monthly car fund"} onClick={() => setRule("Monthly car fund")}><span><strong>Monthly car fund</strong><small>Illustrative transfer · <MoneyText text="£80" /></small></span>{rule === "Monthly car fund" && <Check size={18} aria-hidden="true" />}</button>
          <label className={s.ruleLabel} htmlFor={`${id}-rule`}>Or use a description containing<input id={`${id}-rule`} autoComplete="off" maxLength={80} value={rule} onChange={event => setRule(event.target.value)} /></label>
          <p>No trading, shopping or unrelated payments are suggested.</p>
        </>}
        {!subview && <p className={s.quiet}><Info size={16} aria-hidden="true" />Confirming records the account shown. This is a planned reserve, not a bank payment. Upcoming shows its effect on your cash.</p>}
        {error && <p role="alert" className={s.error}>{error}</p>}
      </>}
    </fieldset>
  </SheetFrame>;
}

export default function KeepMoneyHereClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const scenario: Scenario = ["one", "many", "global", "none"].includes(params.get("scenario") ?? "") ? params.get("scenario") as Scenario : "many";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const state = params.get("state") ?? "ready";
  const editing = params.get("edit") === "1";
  const [open, setOpen] = useState(params.get("open") !== "0");
  const [saved, setSaved] = useState<Draft | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.classList.contains("dark");
    const apply = () => root.classList.toggle("dark", mode === "dark");
    apply();
    const observer = new MutationObserver(() => { if (root.classList.contains("dark") !== (mode === "dark")) apply(); });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); root.classList.toggle("dark", previous); };
  }, [mode]);
  const url = (patch: Record<string, string>) => `?${new URLSearchParams({variant, scenario, mode, state, edit: editing ? "1" : "0", ...patch})}`;
  return <main className={s.preview}>
    <div className={s.review}>
      <Link href="/design" className={s.link}>Back to design previews</Link>
      <h1>A simpler set-aside</h1>
      <p>G274 · Fictional accounts and local drafts only. No money moves and nothing is saved to your account.</p>
      <nav aria-label="Design options"><Link href={url({variant:"a"})}>A · Reserve here</Link><Link href={url({variant:"b"})}>B · Details then review</Link></nav>
      <nav aria-label="Example scenarios">{["one", "many", "global", "none"].map(value => <Link key={value} href={url({scenario:value})}>{value === "one" ? "One account" : value === "many" ? "Several accounts" : value === "global" ? "No account context" : "No eligible account"}</Link>)}</nav>
      <nav aria-label="Review states"><Link href={url({mode:mode === "dark" ? "light" : "dark"})}>{mode === "dark" ? "Light" : "Dark"} theme</Link><Link href={url({edit:editing ? "0" : "1"})}>{editing ? "New set-aside" : "Edit existing transfer"}</Link><Link href={url({state:"save-error"})}>Save failure</Link><Link href={url({state:"load-error"})}>Load failure</Link><Link href={url({state:"ready"})}>Ready</Link></nav>
      <button type="button" className={s.primary} onClick={() => setOpen(true)}>Open option {variant.toUpperCase()}</button>
      {saved && <p role="status">Local example confirmed: {saved.name}, <MoneyText text={`£${saved.amount}`} />. No real changes.</p>}
    </div>
    {open && <ReserveEditor key={`${variant}-${scenario}-${state}-${editing}`} variant={variant} scenario={scenario} editing={editing} empty={params.get("empty") === "1"} state={state} onClose={() => setOpen(false)} onSaved={setSaved} />}
  </main>;
}
