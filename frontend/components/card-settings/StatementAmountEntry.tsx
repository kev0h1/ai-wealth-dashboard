"use client";

import MoneyText from "@/components/MoneyText";
import type { CardStatementBill } from "@/lib/api";
import { TextField } from "./Fields";
import styles from "./CardSettings.module.css";

const money = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d: string) => { const parsed = new Date(`${d.slice(0, 10)}T12:00:00Z`); return Number.isNaN(parsed.getTime()) ? "Date not recorded" : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** G444: every in-full card bill can take the person's own statement amount, whatever the estimate says. */
export const STATEMENT_ENTRY_STATUSES: readonly CardStatementBill["status"][] = ["estimated", "amount_unknown", "incomplete_history"];
export function canEnterStatementAmount(bill: CardStatementBill | null | undefined): bill is CardStatementBill {
  return Boolean(bill && bill.payment_method === "full" && STATEMENT_ENTRY_STATUSES.includes(bill.status));
}
/** What the card alone says (or the figure already entered), to prefill the field. */
export function statementPrefill(bill: CardStatementBill): number | null {
  if (bill.user_entered && finite(bill.estimated_bill)) return bill.estimated_bill;
  const estimate = bill.working?.card_estimate ?? bill.estimated_bill;
  return finite(estimate) ? estimate : null;
}
export const prefillText = (bill: CardStatementBill) => { const v = statementPrefill(bill); return v == null ? "" : v.toFixed(2); };
/** The typed amount as a number, or null when it is not one the server will accept. */
export function parseStatementAmount(text: string): number | null {
  const value = Number(text.replace(/[£,\s]/g, ""));
  return Number.isFinite(value) && value > 0 && value <= 100000 ? Math.round(value * 100) / 100 : null;
}
export function statementEntryLabel(bill: CardStatementBill): string {
  if (bill.user_entered) return "Your statement amount (£)";
  return statementPrefill(bill) == null ? "Enter this statement's amount (£)" : "Estimated from your card (£)";
}

/** The working as one sentence of amounts, or null when the server sent none. */
export function workingLine(bill: CardStatementBill): string | null {
  const w = bill.working;
  if (!w) return null;
  const on = w.balance_as_of ? ` on ${shortDate(w.balance_as_of)}` : "";
  let line = `Card balance ${money(w.balance_owed)}${on}, less ${money(w.spent_since_close)} spent since ${shortDate(bill.statement_close)}, plus ${money(w.credits_since_close)} paid or refunded.`;
  if (w.pending_excluded > 0) line += ` ${money(w.pending_excluded)} still pending is not counted.`;
  if (w.stale_excluded > 0) line += ` ${money(w.stale_excluded)} first seen after that balance was read is not counted.`;
  return line;
}

/** How this was estimated. Hidden entirely while balances are hidden. */
export function StatementWorking({ bill, hidden }: { bill: CardStatementBill; hidden: boolean }) {
  const line = workingLine(bill);
  if (!line) return null;
  if (hidden) return <p data-estimate-working><strong>How this was estimated</strong> Hidden while balances are hidden.</p>;
  return <p data-estimate-working><strong>How this was estimated</strong> <MoneyText text={line} /></p>;
}

/** The amount field for this statement only. The parent owns the value and the save button. */
export function StatementAmountEntry({ bill, hidden, disabled, value, onChange, error }: {
  bill: CardStatementBill; hidden: boolean; disabled: boolean; value: string | null; onChange: (v: string) => void; error?: string;
}) {
  const shown = value ?? prefillText(bill);
  return <div data-statement-amount-entry>
    <TextField label={statementEntryLabel(bill)}>
      <input name="statement-amount" autoComplete="off" inputMode="decimal" className={`${styles.input} money`} value={hidden ? "" : shown} disabled={hidden || disabled} placeholder={hidden ? "Amount hidden" : "0.00"} onChange={(e) => onChange(e.target.value)} />
    </TextField>
    <p className={styles.helper}>You can enter the exact amount from your statement</p>
    <p className={styles.helper}>This replaces the estimate for this statement only. It clears when the next statement closes.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
