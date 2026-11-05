import type { CardPaymentMatch, CardPaymentSaveBody, CardTerms } from "@/lib/api";
export type PaymentDraft = {
  statementCloseDay: number | null; dueMode: "day" | "after"; dueDay: number | null; dueAfter: string;
  method: "full" | "minimum" | "fixed" | "manual" | ""; fixed: string; payerId: string;
  ruleOn: boolean; rule: CardPaymentMatch | null; ruleText: string; mode: "exact" | "contains" | "";
};
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
export const dueLabel = (d: PaymentDraft) => d.dueMode === "day" ? d.dueDay ? `${ordinal(d.dueDay)} each month` : "Not set" : d.dueAfter ? `${d.dueAfter} days after closing` : "Not set";
export function draftFromTerms(terms: CardTerms | null): PaymentDraft {
  const rule = terms?.payment_match ?? null;
  return { statementCloseDay: terms?.statement_close_day ?? null, dueMode: terms?.payment_due_days_after_close != null ? "after" : "day", dueDay: terms?.payment_due_day ?? null, dueAfter: terms?.payment_due_days_after_close?.toString() ?? "", method: terms?.payment_method ?? "", fixed: terms?.fixed_payment_amount?.toString() ?? "", payerId: terms?.payment_account_id ?? "", ruleOn: Boolean(rule), rule, ruleText: rule?.kind === "payment" ? rule.label ?? "" : rule?.text ?? "", mode: rule?.kind === "payment" ? "" : rule?.kind === "exact" ? "exact" : "contains" };
}
export function ruleFor(d: PaymentDraft): CardPaymentMatch | null {
  if (!d.ruleOn) return null;
  if (d.rule?.kind === "payment" && !d.mode) return d.rule;
  if (d.rule?.kind === "exact" && d.mode === "exact" && d.ruleText === d.rule.text && d.rule.fingerprint && d.rule.salt) return d.rule;
  if (!d.ruleText.trim() || !d.mode) return null;
  return { kind: d.mode, text: d.ruleText.trim() };
}
export function validateSchedule(d: PaymentDraft): string | null {
  if (d.dueMode === "after" && d.dueAfter && (!/^\d+$/.test(d.dueAfter) || +d.dueAfter < 1 || +d.dueAfter > 366)) return "Enter 1 to 366 days after the statement closes.";
  if (d.method === "fixed" && (!/^\d+(\.\d{1,2})?$/.test(d.fixed) || +d.fixed <= 0)) return "Enter a fixed payment greater than zero, with up to 2 decimal places.";
  return null;
}
export function saveBody(d: PaymentDraft): CardPaymentSaveBody {
  return { statement_close_day: d.statementCloseDay, payment_due_day: d.dueMode === "day" ? d.dueDay : null, payment_due_days_after_close: d.dueMode === "after" && d.dueAfter ? Number(d.dueAfter) : null, payment_method: d.method || null, fixed_payment_amount: d.method === "fixed" ? Number(d.fixed) : null, payment_account_id: d.payerId || null, payment_match: ruleFor(d) };
}
