"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, Eye, EyeOff, Moon, Plus, Sun, X } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import { DateField } from "@/components/DatePicker";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { BankMark, Choices, CloseOnRequest, PaymentSummary, RuleFields, ScheduleFields, TextField, ruleIssue } from "./Fields";
import { CASES, METHODS, TODAY, dueLabel, matchingPayments, money, paymentFor, payerName, ratesFor, type Case, type PaymentDraft, type RatesDraft, type Variant } from "./fixtures";
import styles from "./preview.module.css";

type MainSheet = "payment" | "rates" | null;
type SubSheet = "rule" | "schedule" | null;

function validatePayment(draft: PaymentDraft, state: Case) {
  if (draft.dueMode === "after" && draft.daysAfter && (!/^\d+$/.test(draft.daysAfter) || +draft.daysAfter < 1 || +draft.daysAfter > 60)) return "Enter 1 to 60 days after the statement closes.";
  if (draft.method === "fixed" && (!/^\d+(\.\d{1,2})?$/.test(draft.fixed) || +draft.fixed <= 0)) return "Enter a fixed payment greater than zero, with up to 2 decimal places.";
  return ruleIssue(draft, state);
}

function PaymentEditor({ initial, state, variant, themeClass, initialSub, initialPicker, onClose, onSave }: { initial: PaymentDraft; state: Case; variant: Variant; themeClass: string; initialSub: SubSheet; initialPicker: "accounts" | "payments" | null; onClose: () => void; onSave: (value: PaymentDraft) => void }) {
  const [draft, setDraft] = useState({ ...initial });
  const [sub, setSub] = useState<SubSheet>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!initialSub) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setSub(initialSub)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [initialSub]);
  const save = (close: () => void) => {
    const issue = validatePayment(draft, state);
    if (issue || (state === "save-error" && !saveFailed)) {
      setError(issue ?? "Payment settings could not be saved. Your changes are still here. Try saving again."); setSaveFailed(true);
      requestAnimationFrame(() => errorRef.current?.focus()); return;
    }
    onSave(draft); close();
  };
  return <SheetFrame variant="focused" title="Payment" description="American Express · Card ending 41009" themeClass={themeClass} onClose={onClose} bodyClassName={styles.body}
    footer={({ close }) => <>{error && <p className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}<div className={styles.footer}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={close}>Cancel</button><button type="button" data-save-payment className={styles.button} onClick={() => save(close)}>Save payment</button></div></>}>
    <div data-payment-editor={variant} className={styles.stack}>
      {state !== "new" && <section className={styles.group} aria-label="Current card bill"><p className={styles.fieldLabel}>Estimated payment due 24 November</p><strong data-estimated-bill className={styles.billAmount}><MoneyText text={money(9980)} /></strong><p>This is the card bill, not a second payment to add to it.</p></section>}
      {variant === "a" ? <><ScheduleFields draft={draft} onChange={setDraft} /><RuleFields draft={draft} onChange={setDraft} state={state} themeClass={themeClass} initialPicker={initialPicker} /></> : <>
        <PaymentSummary draft={draft} onSchedule={() => setSub("schedule")} onRule={() => setSub("rule")} />
        <p className={styles.helper}>Your dates and payment rule identify this card’s bill. They do not instruct your bank to pay it.</p>
      </>}
      <p className={styles.helper}>Sample settings only. Save changes this preview, not your account.</p>
    </div>
    {sub && <SubEditor key={sub} kind={sub} initial={draft} state={state} themeClass={themeClass} initialPicker={initialPicker} onClose={() => setSub(null)} onUse={setDraft} />}
  </SheetFrame>;
}

function SubEditor({ kind, initial, state, themeClass, initialPicker, onClose, onUse }: { kind: Exclude<SubSheet, null>; initial: PaymentDraft; state: Case; themeClass: string; initialPicker: "accounts" | "payments" | null; onClose: () => void; onUse: (draft: PaymentDraft) => void }) {
  const [draft, setDraft] = useState({ ...initial });
  const [error, setError] = useState<string | null>(null);
  const [backRequested, setBackRequested] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const issue = () => kind === "rule" ? ruleIssue(draft, state) : validatePayment({ ...draft, ruleOn: false }, state);
  return <SheetFrame nested variant="focused" title={kind === "rule" ? "Payment match rule" : "Dates and payment method"} description="American Express · Card ending 41009" themeClass={themeClass} onClose={onClose} onBack={() => setBackRequested(true)} backLabel="Back to Payment" bodyClassName={styles.body}
    footer={({ close }) => <>{error && <p className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}<div className={styles.footer}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={close}>Cancel</button><button type="button" data-use-details className={styles.button} onClick={() => { const message = issue(); if (message) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); return; } onUse(draft); close(); }}>{kind === "rule" ? "Use this rule" : "Use these details"}</button></div></>}>
    {({ close }) => <><CloseOnRequest requested={backRequested} close={close} /><div data-focused-editor={kind} className={styles.stack}>
      {kind === "rule" ? <RuleFields draft={draft} onChange={setDraft} state={state} themeClass={themeClass} initialPicker={initialPicker} /> : <ScheduleFields draft={draft} onChange={setDraft} />}
      <p className={styles.helper}>Your changes are saved when you choose Save payment.</p>
    </div></>}
  </SheetFrame>;
}

function RatesEditor({ initial, state, themeClass, onClose, onSave }: { initial: RatesDraft; state: Case; themeClass: string; onClose: () => void; onSave: (rates: RatesDraft) => void }) {
  const [draft, setDraft] = useState<RatesDraft>({ apr: initial.apr, deals: initial.deals.map(d => ({ ...d })), offers: initial.offers.map(o => ({ ...o })) });
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const fail = (message: string) => { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); };
  const serial = useRef(10);
  const charge = state === "charge";
  const save = (close: () => void) => {
    const percent = (value: string, max: number) => /^\d+(\.\d{1,2})?$/.test(value) && +value >= 0 && +value <= max;
    if (draft.apr && !percent(draft.apr, 100)) { fail("Enter a standard rate from 0 to 100%, with up to 2 decimal places."); return; }
    if (draft.deals.some(d => !d.until)) { fail("Choose the month each 0% deal ends."); return; }
    if (draft.offers.some(o => o.fee && !percent(o.fee, 15))) { fail("Enter an offer fee from 0 to 15%, or leave it blank."); return; }
    if (state === "save-error" && !saveFailed) { setSaveFailed(true); fail("Rates could not be saved. Your changes are still here. Try saving again."); return; }
    onSave(draft); close();
  };
  const dateField = (value: string, label: string, onChange: (v: string) => void) => <TextField label={label}><DateField mode="month" label={label} value={value} onChange={onChange} today={TODAY} allowClear themeClass={themeClass} /></TextField>;
  return <SheetFrame variant="focused" title="Rates and deals" description="American Express · Card ending 41009" themeClass={themeClass} onClose={onClose} bodyClassName={styles.body}
    footer={({ close }) => charge ? <button type="button" className={`${styles.button} w-full`} onClick={close}>Done</button> : <>{error && <p className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}<div className={styles.footer}><button type="button" className={`${styles.button} ${styles.secondary}`} onClick={close}>Cancel</button><button type="button" data-save-rates className={styles.button} onClick={() => save(close)}>Save rates and deals</button></div></>}>
    <div data-rates-editor className={styles.stack}>
      {charge ? <section className={styles.group}><h3>No interest rate to record</h3><p>A charge card has no APR or promotional offers to record. Its payment settings are kept separately.</p></section> : <>
        <section className={styles.group}><h3>Standard rate</h3><TextField label="Standard purchase rate (% APR)"><input name="standard-purchase-apr" autoComplete="off" data-apr className={styles.input} inputMode="decimal" value={draft.apr} onChange={e => setDraft({ ...draft, apr: e.target.value })} placeholder="Not recorded" maxLength={6} /></TextField><p>Copy the rate on your card statement. Leave it blank if you are unsure.</p></section>
        <section className={styles.group}><h3>0% deals you are using</h3><p>A deal already applying to this card.</p>
          {draft.deals.map((deal, index) => <div className={styles.record} key={deal.id}><div className={styles.recordHeading}>Deal {index + 1}<button type="button" className={styles.iconButton} aria-label={`Remove deal ${index + 1}`} onClick={() => setDraft({ ...draft, deals: draft.deals.filter(d => d.id !== deal.id) })}><X size={17} aria-hidden="true" /></button></div><Choices label={`Deal ${index + 1} applies to`} value={deal.kind} options={[{ id: "purchases", label: "Purchases" }, { id: "transfers", label: "Balance transfers" }, { id: "both", label: "Both" }]} onChange={kind => setDraft({ ...draft, deals: draft.deals.map(d => d.id === deal.id ? { ...d, kind } : d) })} pills />{dateField(deal.until, `Deal ${index + 1} ends`, until => setDraft({ ...draft, deals: draft.deals.map(d => d.id === deal.id ? { ...d, until } : d) }))}</div>)}
          {draft.deals.length === 0 && <p>None recorded.</p>}<button type="button" data-add-deal className={styles.link} onClick={() => setDraft({ ...draft, deals: [...draft.deals, { id: `deal-${serial.current++}`, kind: "purchases", until: "" }] })}><Plus size={16} aria-hidden="true" />Add a 0% deal</button>
        </section>
        <section className={styles.group}><h3>Unused offers</h3><p>An offer available to you, but not yet taken.</p>
          {draft.offers.map((offer, index) => <div className={styles.record} key={offer.id}><div className={styles.recordHeading}>Offer {index + 1}<button type="button" className={styles.iconButton} aria-label={`Remove offer ${index + 1}`} onClick={() => setDraft({ ...draft, offers: draft.offers.filter(o => o.id !== offer.id) })}><X size={17} aria-hidden="true" /></button></div>{dateField(offer.until, `Offer ${index + 1} available until`, until => setDraft({ ...draft, offers: draft.offers.map(o => o.id === offer.id ? { ...o, until } : o) }))}<TextField label={`Offer ${index + 1} transfer fee (%)`}><input name={`offer-${index + 1}-fee`} autoComplete="off" className={styles.input} inputMode="decimal" value={offer.fee} onChange={e => setDraft({ ...draft, offers: draft.offers.map(o => o.id === offer.id ? { ...o, fee: e.target.value } : o) })} placeholder="Not recorded" maxLength={5} /></TextField><TextField label={`Offer ${index + 1} note (optional)`}><input name={`offer-${index + 1}-note`} autoComplete="off" className={styles.input} value={offer.note} maxLength={120} onChange={e => setDraft({ ...draft, offers: draft.offers.map(o => o.id === offer.id ? { ...o, note: e.target.value } : o) })} /></TextField></div>)}
          {draft.offers.length === 0 && <p>None recorded.</p>}<button type="button" data-add-offer className={styles.link} onClick={() => setDraft({ ...draft, offers: [...draft.offers, { id: `offer-${serial.current++}`, until: "", fee: "", note: "" }] })}><Plus size={16} aria-hidden="true" />Add an unused offer</button>
        </section><p className={styles.helper}>Sample settings only. Save changes this preview, not your account.</p>
      </>}
    </div>
  </SheetFrame>;
}

function DetailEntry({ title, children, onClick, marker }: { title: string; children: ReactNode; onClick: () => void; marker: string }) {
  return <button type="button" data-card-entry={marker} onClick={onClick} className={styles.entry}><span><strong>{title}</strong><small>{children}</small></span><ChevronRight size={16} aria-hidden="true" /></button>;
}

export default function Preview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state: Case = CASES.find(c => c.id === params.get("state"))?.id ?? "matched";
  const initialView = params.get("view");
  const initialPicker = initialView === "accounts" || initialView === "payments" ? initialView : null;
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  const [dark, setDark] = useState(params.get("mode") === "dark");
  const [payment, setPayment] = useState(() => paymentFor(state));
  const [rates, setRates] = useState(() => ratesFor(state));
  const [sheet, setSheet] = useState<MainSheet>(initialView === "rates" ? "rates" : initialView && ["payment", "rule", "schedule", "accounts", "payments"].includes(initialView) ? "payment" : null);
  const [toast, setToast] = useState("");
  const themeClass = styles.surface;
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; }, [dark]);
  const href = (next: { variant?: Variant; state?: Case }) => `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${dark ? "dark" : "light"}${hidden ? "&hidden=1" : ""}`;
  const initialSub: SubSheet = variant === "b" && (initialView === "rule" || initialPicker) ? "rule" : variant === "b" && initialView === "schedule" ? "schedule" : null;
  const method = METHODS.find(m => m.id === payment.method)?.label ?? "No payment details recorded";
  const matches = matchingPayments(payment);
  return <BalancesHiddenContext.Provider value={hidden}>
    <div className={styles.preview} data-preview-ready="true" data-g419-variant={variant} style={{ colorScheme: dark ? "dark" : "light" }}>
      <a href="#g419-content" className="sr-only focus:not-sr-only">Skip to card details</a>
      <nav className={styles.controls} aria-label="G419 preview controls"><a href="/design" className={styles.indexLink}><ArrowLeft size={16} aria-hidden="true" />Design rounds</a><div className={styles.variants}><a href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · One payment form</a><a href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Focused rule editor</a></div><button type="button" onClick={() => setDark(!dark)} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}{dark ? "Light" : "Dark"}</button><button type="button" onClick={() => setHidden(!hidden)} aria-pressed={hidden}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{hidden ? "Show balances" : "Hide balances"}</button></nav>
      <nav className={styles.states} aria-label="Sample states">{CASES.map(c => <a key={c.id} href={href({ state: c.id })} aria-current={state === c.id ? "page" : undefined}>{c.label}</a>)}</nav>
      <main id="g419-content" className={styles.main}>
        <div className={styles.intro}><h1>{variant === "a" ? "One place for the payment. Another for the rate." : "A clear payment overview. A focused rule editor."}</h1><p>{variant === "a" ? "Payment dates, how you pay and the matching rule stay together. Rates and deals open separately." : "Review how the card is paid, then open only the detail you want to change. The rule has room for its account, description and matching payments."}</p><p className={styles.sample}>G419 · Coded design options with fictional data. Nothing is connected or moved.</p></div>
        <div className={styles.stage}>
          <div className={styles.account}><BankMark bank="American Express" /><div><strong>American Express</strong><p>Card ending 41009</p></div><div className={styles.balance}><MoneyText text="−£724.60" /><small>Card balance</small></div></div>
          <section className={styles.details} aria-label="Account details"><h2>Account details</h2><DetailEntry marker="payment" title="Payment" onClick={() => { setSheet("payment"); setToast(""); }}>{method}{payment.method ? ` · Due ${dueLabel(payment)}` : ""}</DetailEntry><DetailEntry marker="rates" title="Rates and deals" onClick={() => { setSheet("rates"); setToast(""); }}>{state === "charge" ? "Not applicable to a charge card" : rates.apr ? `${rates.apr}% APR${rates.deals.length ? ` · ${rates.deals.length} ${rates.deals.length === 1 ? "deal" : "deals"}` : ""}` : "No rates or deals recorded"}</DetailEntry><div className={styles.connection}>Connected account · Connection controls stay here.</div></section>
          {toast && <p role="status" className={styles.toast}>{toast}</p>}
          <p className={styles.notice}>Payment matching stays inside Payment. An empty or unmatched rule adds no prompt to the account page.</p>
          <span className="sr-only" data-saved-payment={JSON.stringify({ payer: payment.payer, ruleOn: payment.ruleOn, mode: payment.matchMode, text: payment.text, matches: matches.length })} data-saved-rates={JSON.stringify({ apr: rates.apr, deals: rates.deals.length, offers: rates.offers.length })} />
        </div>
      </main>
    </div>
    {sheet === "payment" && <PaymentEditor initial={payment} state={state} variant={variant} themeClass={themeClass} initialSub={initialSub} initialPicker={initialPicker} onClose={() => setSheet(null)} onSave={value => { setPayment(value); setToast("Payment settings saved in this preview."); }} />}
    {sheet === "rates" && <RatesEditor initial={rates} state={state} themeClass={themeClass} onClose={() => setSheet(null)} onSave={value => { setRates(value); setToast("Rates and deals saved in this preview."); }} />}
  </BalancesHiddenContext.Provider>;
}
