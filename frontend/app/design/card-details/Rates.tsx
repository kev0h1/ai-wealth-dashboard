"use client";

// Fixture-only G412 rate record. It deliberately has no persistence beyond its parent preview.
import { useState } from "react";
import { DateField } from "@/components/DatePicker";
import { money, type AccountFixture } from "./fixtures";
import styles from "./preview.module.css";

export type RatesRecord = {
  apr: string;
  activeBalanceTransfer: boolean;
  activeDealKind: "purchases" | "balance_transfer" | "both";
  activeBalanceTransferAmount: string;
  activeBalanceTransferEndDate: string;
  unusedBalanceTransfer: boolean;
  unusedBalanceTransferEndDate: string;
  unusedBalanceTransferFee: string;
};

const ACTIVE_END_DATE = "2027-05-31";
const UNUSED_END_DATE = "2027-08-31";

export function initialRates(account: AccountFixture): RatesRecord {
  const active = account.deals[0];
  const unused = account.unusedOffer ?? "";
  const activeName = active?.name.toLowerCase() ?? "";
  return {
    apr: /^\d/.test(account.apr) ? account.apr : "",
    activeBalanceTransfer: Boolean(active),
    activeDealKind: activeName.includes("purchase") && activeName.includes("balance transfer") ? "both" : activeName.includes("purchase") ? "purchases" : "balance_transfer",
    activeBalanceTransferAmount: active?.amount === undefined ? "" : String(active.amount),
    activeBalanceTransferEndDate: active ? ACTIVE_END_DATE : "",
    unusedBalanceTransfer: /balance transfer/i.test(unused) && !/^no unused/i.test(unused),
    unusedBalanceTransferEndDate: /balance transfer/i.test(unused) && !/^no unused/i.test(unused) ? UNUSED_END_DATE : "",
    unusedBalanceTransferFee: unused.match(/([0-9]+(?:\.[0-9]+)?)%\s*fee/i)?.[1] ?? "",
  };
}

function isValidNumber(value: string, min: number, max: number) {
  if (!value.trim()) return true;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function AmountField({ id, label, value, hidden, invalid, onChange, helper }: { id: string; label: string; value: string; hidden: boolean; invalid: boolean; onChange: (value: string) => void; helper?: string }) {
  return <label className={styles.input}>
    {label}
    <input id={id} name={id} autoComplete="off" inputMode="decimal" disabled={hidden} value={hidden ? "" : value} aria-label={hidden ? "Show figures to edit this amount" : label} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} placeholder={hidden ? "Show figures to edit amounts" : "0.00"} onChange={event => onChange(event.target.value)} />
    {helper && <span className={styles.helper}>{helper}</span>}
  </label>;
}

function dateLabel(value: string) {
  if (!value) return "date not recorded";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? "date not recorded" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function dealKindLabel(kind: RatesRecord["activeDealKind"]) {
  return kind === "purchases" ? "0% purchases" : kind === "both" ? "0% purchases and balance transfers" : "0% balance transfer";
}

export default function Rates({ account, hidden, value, onChange, editing, onEditingChange, embedded = false }: { account: AccountFixture; hidden: boolean; value: RatesRecord; onChange: (value: RatesRecord) => void; editing: boolean; onEditingChange: (editing: boolean) => void; embedded?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<{ field: "apr" | "activeAmount" | "unusedFee"; message: string } | null>(null);
  const isChargeCard = /charge card/i.test(account.subtitle);

  if (account.kind !== "card") return null;

  const edit = (changes: Partial<RatesRecord>) => { setDraft(current => ({ ...current, ...changes })); setError(null); };
  const save = () => {
    if (!isValidNumber(draft.apr, 0, 100)) { setError({ field: "apr", message: "APR must be a number from 0 to 100." }); document.getElementById("g412-apr")?.focus(); return; }
    if (draft.activeBalanceTransfer && !isValidNumber(draft.activeBalanceTransferAmount, 0, Number.POSITIVE_INFINITY)) { setError({ field: "activeAmount", message: "Balance transfer amount must be zero or more." }); document.getElementById("g412-active-amount")?.focus(); return; }
    if (draft.unusedBalanceTransfer && !isValidNumber(draft.unusedBalanceTransferFee, 0, 100)) { setError({ field: "unusedFee", message: "Offer fee must be a number from 0 to 100." }); document.getElementById("g412-unused-fee")?.focus(); return; }
    onChange(draft); onEditingChange(false);
  };
  const cancel = () => { setDraft(value); setError(null); onEditingChange(false); };
  const activeAmount = Number(value.activeBalanceTransferAmount);
  const activeDealLabel = dealKindLabel(draft.activeDealKind);

  return <section className={styles.section} data-g412-section="rates">
    <div className={styles.sectionHeading}>{!embedded && <h3>Rates and deals</h3>}{!isChargeCard && !editing && <button type="button" className={styles.linkButton} data-g412-edit-rates="true" aria-label="Edit rates and deals" onClick={() => onEditingChange(true)}>Edit</button>}</div>
    {isChargeCard ? <p className={styles.helper}>This charge card has no APR or promotional offers to record.</p> : editing ? <form id="g412-rates-form" className={styles.stack} onSubmit={event => { event.preventDefault(); save(); }} onReset={event => { event.preventDefault(); cancel(); }}>
      <label className={styles.input}>Standard purchase APR<input id="g412-apr" name="apr" autoComplete="off" inputMode="decimal" value={draft.apr} aria-invalid={error?.field === "apr" || undefined} aria-describedby={error?.field === "apr" ? "g412-apr-error" : undefined} placeholder="For example, 29.1" onChange={event => edit({ apr: event.target.value })} />{error?.field === "apr" && <span id="g412-apr-error" className={styles.error} role="alert">{error.message}</span>}<span className={styles.helper}>Enter 0 for a zero rate. Leave blank if you do not know it.</span></label>
      <fieldset className={styles.section}><legend className={styles.sectionHeading}>Active 0% deal</legend><label className={styles.checkRow}><input type="checkbox" checked={draft.activeBalanceTransfer} onChange={event => edit({ activeBalanceTransfer: event.target.checked })} /><span><strong>There is an active deal</strong><small>Record the balance still covered and when the rate ends.</small></span></label>
        {draft.activeBalanceTransfer && <div className={styles.stack}><fieldset className={styles.section}><legend className={styles.helper}>Which balance does the active 0% deal cover?</legend><div className={styles.stack} role="radiogroup" aria-label="Active 0% deal coverage">{(["purchases", "balance_transfer", "both"] as const).map(kind => <label key={kind} className={`${styles.radio} ${draft.activeDealKind === kind ? styles.selected : ""}`}><input type="radio" name="dealKind" value={kind} checked={draft.activeDealKind === kind} onChange={() => edit({ activeDealKind: kind })} /><span>{dealKindLabel(kind)}</span></label>)}</div></fieldset><AmountField id="g412-active-amount" label={`Amount covered by ${activeDealLabel}`} value={draft.activeBalanceTransferAmount} hidden={hidden} invalid={error?.field === "activeAmount"} onChange={activeBalanceTransferAmount => edit({ activeBalanceTransferAmount })} />{error?.field === "activeAmount" && <p id="g412-active-amount-error" className={styles.error} role="alert">{error.message}</p>}<div><p className={styles.helper}>Offer end date</p><DateField mode="day" label="Active offer end date" title="Active offer end date" value={draft.activeBalanceTransferEndDate} onChange={activeBalanceTransferEndDate => edit({ activeBalanceTransferEndDate })} today="2026-11-03" appearance="outlined" /></div></div>}
      </fieldset>
      <fieldset className={styles.section}><legend className={styles.sectionHeading}>Unused 0% balance transfer offer</legend><label className={styles.checkRow}><input type="checkbox" checked={draft.unusedBalanceTransfer} onChange={event => edit({ unusedBalanceTransfer: event.target.checked })} /><span><strong>An unused offer is available</strong><small>Keep this separate from a deal already covering a balance.</small></span></label>
        {draft.unusedBalanceTransfer && <div className={styles.stack}><div><p className={styles.helper}>Offer end date</p><DateField mode="day" label="Unused offer end date" title="Unused offer end date" value={draft.unusedBalanceTransferEndDate} onChange={unusedBalanceTransferEndDate => edit({ unusedBalanceTransferEndDate })} today="2026-11-03" appearance="outlined" /></div><label className={styles.input}>Transfer fee (%)<input id="g412-unused-fee" name="unusedBalanceTransferFee" autoComplete="off" inputMode="decimal" value={draft.unusedBalanceTransferFee} aria-invalid={error?.field === "unusedFee" || undefined} aria-describedby={error?.field === "unusedFee" ? "g412-unused-fee-error" : undefined} placeholder="For example, 3" onChange={event => edit({ unusedBalanceTransferFee: event.target.value })} />{error?.field === "unusedFee" && <span id="g412-unused-fee-error" className={styles.error} role="alert">{error.message}</span>}<span className={styles.helper}>Enter a percentage from 0 to 100.</span></label></div>}
      </fieldset>
    </form> : <div className={styles.stack}>
      <p className={styles.rate}><strong>{value.apr.trim() ? `${value.apr}% APR` : "APR not known"}</strong><span>Standard purchase rate</span></p>
      {value.activeBalanceTransfer && <div className={styles.offerRow}><span><strong>Active {dealKindLabel(value.activeDealKind)}</strong><small>Ends {dateLabel(value.activeBalanceTransferEndDate)}</small></span><strong className={styles.money} aria-label={hidden ? "Amount hidden" : undefined}>{hidden ? "£••••" : value.activeBalanceTransferAmount.trim() && Number.isFinite(activeAmount) ? money(activeAmount, false) : "Amount not recorded"}</strong></div>}
      {value.unusedBalanceTransfer && <div className={styles.offerRow}><span><strong>Unused 0% balance transfer offer</strong><small>Ends {dateLabel(value.unusedBalanceTransferEndDate)}</small></span><strong>{value.unusedBalanceTransferFee.trim() ? `${value.unusedBalanceTransferFee}% fee` : "Fee not recorded"}</strong></div>}
      {!value.activeBalanceTransfer && !value.unusedBalanceTransfer && <p className={styles.helper}>No promotional deals recorded.</p>}
    </div>}
  </section>;
}
