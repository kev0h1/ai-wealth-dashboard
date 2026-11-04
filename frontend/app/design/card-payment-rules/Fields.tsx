"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";
import { maskLongDigits } from "@/lib/maskLongDigits";
import { ACCOUNTS, METHODS, dueLabel, matchingPayments, money, ordinal, payerName, recentDebits, shortDate, type Case, type PaymentDraft } from "./fixtures";
import styles from "./preview.module.css";

export function BankMark({ bank }: { bank: string }) {
  const meta = BANK_META[bankKey({ provider: bank })];
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? bank.slice(0, 2)} altText="" initialsSize={meta?.initialsSize} brandBg={meta?.bg} size={32} />;
}

/** Header Back consumes the same history entry as Cancel, Escape and X. */
export function CloseOnRequest({ requested, close }: { requested: boolean; close: () => void }) {
  useEffect(() => { if (requested) close(); }, [requested, close]);
  return null;
}

/** Same two-pill strictness and radio-row language as the offline rule UI.
 * Native radios add Arrow-key behaviour without changing that vocabulary. */
export function Choices<T extends string>({ label, value, options, onChange, pills = false }: { label: string; value: T; options: readonly { id: T; label: string; detail?: string }[]; onChange: (value: T) => void; pills?: boolean }) {
  const id = useId();
  return <fieldset className={styles.group}>
    <legend className={styles.fieldLabel}>{label}</legend>
    <div className={`${styles.two} ${pills ? styles.pills : ""}`}>
      {options.map(option => <label className={styles.choice} key={option.id}>
        <input type="radio" name={id} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
        <span className={styles.radio} aria-hidden="true" /><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
      </label>)}
    </div>
  </fieldset>;
}

function DayField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details className={styles.dayField} ref={ref}>
    <summary><span>{label}<small>{value ? `${ordinal(value)} each month` : "Not set"}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className={styles.dayGrid} role="group" aria-label={label}>
      {[null, ...Array.from({ length: 31 }, (_, i) => i + 1)].map(day => <button key={day ?? "none"} type="button" aria-pressed={day === value} aria-label={`${label}: ${day ? ordinal(day) : "not set"}`} onClick={() => { onChange(day); ref.current?.removeAttribute("open"); }}>{day ?? "Not set"}</button>)}
    </div>
  </details>;
}

export function TextField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span className={styles.fieldLabel}>{label}</span>{children}</label>;
}

export function ScheduleFields({ draft, onChange }: { draft: PaymentDraft; onChange: (draft: PaymentDraft) => void }) {
  const hidden = useBalancesHidden();
  const set = (patch: Partial<PaymentDraft>) => onChange({ ...draft, ...patch });
  return <div className={styles.stack}>
    <section className={styles.group} aria-label="Statement and payment dates">
      <h3>Statement and payment dates</h3>
      <DayField label="Statement closes on" value={draft.closes} onChange={closes => set({ closes })} />
      <Choices label="Payment due" value={draft.dueMode} options={[{ id: "day", label: "Day of the month" }, { id: "after", label: "Days after closing" }]} onChange={dueMode => set({ dueMode })} pills />
      {draft.dueMode === "day" ? <DayField label="Payment due on" value={draft.dueDay} onChange={dueDay => set({ dueDay })} /> : <TextField label="Days after the statement closes"><input name="days-after-close" autoComplete="off" className={styles.input} inputMode="numeric" value={draft.daysAfter} onChange={e => set({ daysAfter: e.target.value })} maxLength={2} /></TextField>}
      <p>Use the dates on your statement. This does not change your bank instructions.</p>
    </section>
    <section className={styles.group} aria-label="How you pay">
      <h3>How you pay</h3>
      <Choices label="Payment method" value={draft.method} options={METHODS} onChange={method => set({ method })} />
      {draft.method === "fixed" && <><TextField label="Fixed payment amount (£)"><input name="fixed-payment" autoComplete="off" data-fixed-payment className={`${styles.input} money`} inputMode="decimal" value={hidden ? "" : draft.fixed} placeholder={hidden ? "Amount hidden" : "0.00"} disabled={hidden} onChange={e => set({ fixed: e.target.value })} /></TextField>{hidden && <p>Show balances to edit the fixed amount.</p>}</>}
    </section>
  </div>;
}

function matchesFor(draft: PaymentDraft, state: Case) {
  return matchingPayments(draft).filter(payment => state !== "history" || payment.date >= "2026-09-01");
}
export function ruleIssue(draft: PaymentDraft, state: Case) {
  if (!draft.ruleOn) return null;
  if (!draft.payer) return "Choose the account this payment leaves from.";
  if (draft.text.replace(/[^a-z0-9]/gi, "").length < 3) return "Enter at least 3 letters or digits from the payment description.";
  if (new Set(matchesFor(draft, state).map(p => p.reference).filter(Boolean)).size > 1) return "Payments for two cards match. Use the reference ending to narrow the rule.";
  return null;
}

export function RuleEvidence({ draft, state, failed, onRetry }: { draft: PaymentDraft; state: Case; failed: boolean; onRetry: () => void }) {
  if (!draft.ruleOn) return null;
  const matches = matchesFor(draft, state), latest = matches[0];
  const broad = new Set(matches.map(p => p.reference).filter(Boolean)).size > 1;
  return <div data-match-evidence className={styles.evidence} role="status" aria-live="polite" aria-atomic="true">
    {!draft.payer ? <p>Choose a paying account to check the rule.</p> : state === "checking" ? <p>Checking recent payments…</p> : failed ? <><p>Recent payments could not be checked. Your text is still here.</p><button type="button" className={styles.link} onClick={onRetry}>Try checking again</button></> : draft.text.replace(/[^a-z0-9]/gi, "").length < 3 ? <p>Enter at least 3 letters or digits to check for matches.</p> : <>
      <p><strong>{matches.length === 0 ? "No payments match" : `Matches ${matches.length} ${matches.length === 1 ? "payment" : "payments"}`}</strong>{state === "history" ? " since 1 September." : " in the last 6 months."}</p>
      {latest ? <p><MoneyText text={`Latest ${shortDate(latest.date)}, ${money(latest.pence)}.`} /></p> : <p>Check the description or choose a recent payment to fill it in.</p>}
      {state === "history" && <p>Only 2 months of history are available. Older payments have not been checked.</p>}
      {broad && <p className={styles.caution}>Payments for two card references match. Add the ending for this card so another card’s payment is not claimed.</p>}
    </>}
  </div>;
}

function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" name={label.toLowerCase().replaceAll(" ", "-")} autoComplete="off" className={styles.input} aria-label={label} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} /></div>;
}

export function RuleFields({ draft, onChange, state, themeClass, initialPicker = null }: { draft: PaymentDraft; onChange: (draft: PaymentDraft) => void; state: Case; themeClass: string; initialPicker?: "accounts" | "payments" | null }) {
  const [picker, setPicker] = useState<"accounts" | "payments" | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(state === "error");
  const [backRequested, setBackRequested] = useState(false);
  useEffect(() => {
    if (!initialPicker) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setPicker(initialPicker)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [initialPicker]);
  const selected = ACCOUNTS.find(a => a.id === draft.payer);
  const set = (patch: Partial<PaymentDraft>) => onChange({ ...draft, ...patch });
  const openPicker = (next: "accounts" | "payments") => { setBackRequested(false); setQuery(""); setPicker(next); };
  const accounts = ACCOUNTS.filter(a => `${a.bank} ${a.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const payments = recentDebits(draft.payer).filter(p => (state !== "history" || p.date >= "2026-09-01") && `${p.description} ${shortDate(p.date)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const showRecent = Boolean(draft.payer);
  return <div className={styles.stack} data-rule-area>
    <section className={styles.group}>
      <h3>Paid from</h3>
      <button type="button" data-payer-open className={styles.pickedAccount} onClick={() => openPicker("accounts")} aria-label={`Choose paying account, ${payerName(draft.payer)}`}>
        {selected && <BankMark bank={selected.bank} />}<span><strong>{selected?.bank ?? "Choose an account"}</strong><small>{selected?.name ?? "The account the card payment leaves from"}</small></span><ChevronRight size={16} aria-hidden="true" />
      </button>
    </section>
    <section className={styles.group} data-rule-fields>
      <div className={styles.ruleHeader}><h3>Match the payment</h3>{draft.ruleOn && <button type="button" className={styles.link} onClick={() => set({ ruleOn: false, text: "" })}>Remove rule</button>}</div>
      <p>Use how the payment appears on the paying account’s statement.</p>
      {!draft.ruleOn ? <button type="button" data-add-rule className={`${styles.button} ${styles.secondary}`} onClick={() => set({ ruleOn: true })}>Add a payment rule</button> : <>
        <TextField label="Payment description"><input name="payment-description" data-rule-text className={`${styles.input} ${styles.textInput}`} type="text" value={draft.text} onChange={e => set({ text: maskLongDigits(e.target.value) })} maxLength={80} placeholder="For example, 41009" autoComplete="off" spellCheck={false} /></TextField>
        <Choices label="How should it match?" value={draft.matchMode} options={[{ id: "description_equals", label: "Exactly this" }, { id: "description_contains", label: "Contains this" }]} onChange={matchMode => set({ matchMode })} pills />
        <p>{draft.matchMode === "description_equals" ? "Matches the whole description, ignoring capitals." : "Matches descriptions containing this text, ignoring capitals."}</p>
        {showRecent && <button type="button" data-payment-search-open className={styles.link} onClick={() => openPicker("payments")}><Search size={16} aria-hidden="true" />Choose a recent payment to fill this in</button>}
        <RuleEvidence draft={draft} state={state} failed={failed} onRetry={() => setFailed(false)} />
        <p className={styles.helper}>The matched regular payment is replaced by this card’s defined bill. When its payment arrives, the bill is marked paid.</p>
      </>}
    </section>
    {picker && <SheetFrame variant="focused" nested title={picker === "accounts" ? "Paying account" : "Choose a payment"} description={picker === "accounts" ? "Choose the account this card payment leaves from." : `${selected?.bank ?? "Your account"} · Debits in the last 6 months`} themeClass={themeClass} onClose={() => setPicker(null)} onBack={() => setBackRequested(true)} backLabel="Back to the payment rule" bodyClassName={styles.body}
      bodyHeader={<div className={styles.pickerSearch}><SearchField label={picker === "accounts" ? "Search paying accounts" : "Search recent payments"} placeholder={picker === "accounts" ? "Search accounts" : "Search payment descriptions"} value={query} onChange={setQuery} /></div>}
      footer={({ close }) => <button type="button" className={`${styles.button} ${styles.secondary} w-full`} onClick={close}>Cancel</button>}>
      {({ close }) => <><CloseOnRequest requested={backRequested} close={close} /><div className={styles.list}>
        {picker === "accounts" ? <>{accounts.map(account => <button type="button" key={account.id} data-account-option={account.id} aria-current={draft.payer === account.id} className={styles.pickRow} onClick={() => { if (draft.payer !== account.id) set({ payer: account.id, text: "" }); close(); }}><BankMark bank={account.bank} /><span><strong>{account.bank}</strong><small>{account.name}</small></span>{draft.payer === account.id && <Check size={18} aria-hidden="true" />}</button>)}{accounts.length === 0 && <p className={styles.empty}>No accounts match. Try another bank or account name.</p>}</> : <>{payments.map(payment => <button type="button" key={payment.id} data-payment-option={payment.id} className={styles.pickRow} onClick={() => { set({ text: maskLongDigits(payment.description) }); close(); }}><span><strong>{maskLongDigits(payment.description)}</strong><small>{shortDate(payment.date)}</small></span><span className={styles.paymentAmount}><MoneyText text={money(payment.pence)} /></span><ChevronRight size={14} aria-hidden="true" /></button>)}{payments.length === 0 && <p className={styles.empty}>{query ? "No payments match your search. Try another description." : "No recent debits from this account. You can type the description yourself."}</p>}</>}
      </div></>}
    </SheetFrame>}
  </div>;
}

export function PaymentSummary({ draft, onSchedule, onRule }: { draft: PaymentDraft; onSchedule: () => void; onRule: () => void }) {
  const method = METHODS.find(m => m.id === draft.method)?.label ?? "Not set";
  return <div>
    <button type="button" data-edit-schedule className={styles.entry} onClick={onSchedule}><span><strong>Statement and payment dates</strong><small>{draft.closes ? `Closes ${ordinal(draft.closes)} · Due ${dueLabel(draft)}` : "No dates recorded"}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
    <button type="button" className={styles.entry} onClick={onSchedule}><span><strong>How you pay</strong><small>{draft.method === "fixed" ? <MoneyText text={`Fixed £${draft.fixed || "0.00"}`} /> : method}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
    <button type="button" className={styles.entry} onClick={onRule}><span><strong>Paid from</strong><small>{payerName(draft.payer)}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
    <button type="button" data-edit-rule className={styles.entry} onClick={onRule}><span><strong>Payment match rule</strong><small>{draft.ruleOn ? `${draft.matchMode === "description_equals" ? "Exactly" : "Contains"} “${maskLongDigits(draft.text)}”` : "No rule recorded"}</small></span><ChevronRight size={16} aria-hidden="true" /></button>
  </div>;
}
