"use client";

// Approved G419 B: two routes from Account details. Payment evidence belongs
// in Payment, while connection, pin and removal remain in the host sheet.
import { ChevronRight } from "lucide-react";
import type { CardTermsCard } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { usePreferences } from "@/components/PreferencesContext";
import styles from "@/components/card-settings/CardSettings.module.css";

const METHOD_LABEL: Record<string, string> = {
  full: "Paid in full by Direct Debit", minimum: "Minimum payment", fixed: "Fixed payment", manual: "Paid manually",
};
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th"}`;
}
export function paymentRuleLabels(terms: CardTermsCard["terms"]) {
  return {
    closes: terms?.statement_close_day != null ? `${ordinal(terms.statement_close_day)} of each month` : "Not set",
    due: terms?.payment_due_day != null ? `${ordinal(terms.payment_due_day)} of each month`
      : terms?.payment_due_days_after_close != null ? `${terms.payment_due_days_after_close} days after it closes` : "Not set",
    method: terms?.payment_method ? METHOD_LABEL[terms.payment_method] : "Not set",
  };
}
export default function CardDetailsSections({ card, onEditPayment, onEditRates, hiddenOverride }: {
  card: CardTermsCard;
  paymentAccounts?: { id: string; name: string }[];
  onEditPayment: () => void;
  onEditRates: () => void;
  hiddenOverride?: boolean;
}) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const t = card.terms;
  const method = t?.payment_method === "fixed" && typeof t.fixed_payment_amount === "number" && Number.isFinite(t.fixed_payment_amount)
    ? `Fixed £${t.fixed_payment_amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : t?.payment_method ? METHOD_LABEL[t.payment_method] : "No payment details recorded";
  const due = t?.payment_due_day != null ? `${ordinal(t.payment_due_day)} each month`
    : t?.payment_due_days_after_close != null ? `${t.payment_due_days_after_close} days after closing` : null;
  const deals = t?.status === "confirmed" ? (t.promos ?? []).filter(p => p.until >= new Date().toISOString().slice(0, 10)) : [];
  const rate = card.card_class === "charge_card" ? "Not applicable to a charge card"
    : t?.status === "confirmed" && t.apr_pct != null ? `${t.apr_pct}% APR${deals.length ? ` · ${deals.length} ${deals.length === 1 ? "deal" : "deals"}` : ""}` : "No rates or deals recorded";
  return <BalancesHiddenContext.Provider value={hiddenOverride ?? (hideNetWorth || !preferencesReady)}>
    <div className={styles.surface} data-g419-card-details>
      <button type="button" data-g412-section="payment" data-card-entry="payment" className={styles.entry} onClick={onEditPayment}>
        <span><strong>Payment</strong><small><MoneyText text={`${method}${due ? ` · Due ${due}` : ""}`} /></small></span><ChevronRight size={16} aria-hidden="true" />
      </button>
      <button type="button" data-g412-section="rates" data-card-entry="rates" className={styles.entry} onClick={onEditRates}>
        <span><strong>Rates and deals</strong><small>{rate}</small></span><ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  </BalancesHiddenContext.Provider>;
}
