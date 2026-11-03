"use client";
// G412 variant A, in production: the card-specific sections of Account
// details. Payment first (estimated bill, statement dates, how it is paid),
// then rates and deals. Connection, Pin to Home and Remove stay with the
// shared Account details sheet so every account type uses one row style.
// Read-only: the editor is CardTermsSheet. Every figure is server-derived.
import type { ReactNode } from "react";
import type { CardTermsCard } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { usePreferences } from "@/components/PreferencesContext";

const METHOD_LABEL: Record<string, string> = {
  full: "Paid in full by Direct Debit",
  minimum: "Minimum payment",
  fixed: "Fixed payment",
  manual: "Paid manually",
};

export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th"}`;
}

function longDate(iso: string | null | undefined): string {
  if (!iso) return "date not recorded";
  const parsed = new Date(`${iso}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "date not recorded" : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function gbp(amount: number): string {
  return `£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-[13px] text-slate-600 dark:text-slate-300">{label}</dt>
    <dd className="min-w-0 text-right text-[13px] font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{children}</dd>
  </div>;
}

function Heading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="flex min-h-11 items-center justify-between gap-3">
    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
    {action}
  </div>;
}

export function paymentRuleLabels(terms: CardTermsCard["terms"]) {
  const closes = terms?.statement_close_day != null ? `${ordinal(terms.statement_close_day)} of each month` : "Not set";
  const due = terms?.payment_due_day != null ? `${ordinal(terms.payment_due_day)} of each month`
    : terms?.payment_due_days_after_close != null ? `${terms.payment_due_days_after_close} days after it closes` : "Not set";
  const method = terms?.payment_method ? METHOD_LABEL[terms.payment_method] : "Not set";
  return { closes, due, method };
}

export default function CardDetailsSections({ card, paymentAccounts = [], onEditPayment, onEditRates, hiddenOverride }: {
  /** Test seam: render with figures shown or hidden regardless of the saved preference. */
  hiddenOverride?: boolean;
  card: CardTermsCard;
  paymentAccounts?: { id: string; name: string }[];
  onEditPayment: () => void;
  onEditRates: () => void;
}) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const hidden = hiddenOverride ?? (hideNetWorth || !preferencesReady);
  const terms = card.terms;
  const bill = card.statement_bill;
  const labels = paymentRuleLabels(terms);
  const payer = terms?.payment_account_id ? paymentAccounts.find(a => a.id === terms.payment_account_id)?.name ?? "Account no longer available" : "Not set";
  const confirmed = terms?.status === "confirmed" ? terms : null;
  const hasDates = terms?.statement_close_day != null && (terms.payment_due_day != null || terms.payment_due_days_after_close != null);
  const chargeCard = card.card_class === "charge_card"; // the stored A181 class, never the name
  const activeDeals = (confirmed?.promos ?? []).filter(p => p.until >= new Date().toISOString().slice(0, 10));
  const offers = confirmed?.bt_offers ?? [];
  const edit = (label: string, run: () => void) => <button type="button" onClick={run} aria-label={label} data-g412-edit={label} className="min-h-11 min-w-11 rounded-lg px-2 text-[13px] font-semibold text-indigo-700 active:opacity-70 dark:text-indigo-300">Edit</button>;

  return <BalancesHiddenContext.Provider value={hidden}>
    <section data-g412-section="payment" aria-label="How this card is paid">
      {hasDates && bill && (bill.payment_remaining != null || bill.estimated_bill != null) && <div data-g412-estimate="available" className="mb-2">
        <Heading title={bill.payment_amount != null ? `Payment due ${longDate(bill.payment_due)}` : "Estimated statement bill"} />
        <p className="text-[20px] font-bold leading-7 text-slate-900 dark:text-slate-100"><MoneyText text={gbp(bill.payment_amount ?? bill.estimated_bill ?? 0)} /></p>
        <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          {bill.estimated ? "Estimated. " : ""}Statement period {longDate(bill.statement_start)} to {longDate(bill.statement_close)}.
          {bill.spending_since_close > 0 && <> <MoneyText text={`${gbp(bill.spending_since_close)} spent since it closed belongs to the next bill.`} /></>}
        </p>
        {bill.reason && <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{bill.reason}</p>}
      </div>}
      <Heading title="How this card is paid" action={edit("Edit how this card is paid", onEditPayment)} />
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        <Row label="Statement closes">{labels.closes}</Row>
        <Row label="Payment due">{labels.due}</Row>
        <Row label="How you pay">{terms?.payment_method === "fixed" && terms.fixed_payment_amount != null
          ? <MoneyText text={`Fixed ${gbp(terms.fixed_payment_amount)}`} /> : labels.method}</Row>
        <Row label="Paying account">{payer}</Row>
      </dl>
    </section>
    <section data-g412-section="rates" aria-label="Rates and deals">
      <Heading title="Rates and deals" action={chargeCard ? undefined : edit("Edit rates and deals", onEditRates)} />
      {chargeCard ? <p className="pb-2 text-[13px] text-slate-600 dark:text-slate-300">A charge card has no APR or promotional offers to record.</p> : <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        <Row label="Standard purchase rate">{confirmed?.apr_pct != null ? `${confirmed.apr_pct}% APR` : "Not recorded"}</Row>
        {activeDeals.map((deal, index) => <Row key={`deal-${index}`} label={`0% ${deal.kind === "both" ? "purchases and balance transfers" : deal.kind === "purchases" ? "purchases" : "balance transfers"}`}>{`${deal.apr_pct}% until ${longDate(deal.until)}`}</Row>)}
        {offers.map((offer, index) => <Row key={`offer-${index}`} label="Unused 0% offer">{[offer.ends ? `ends ${longDate(offer.ends)}` : null, offer.fee_pct != null ? `${offer.fee_pct}% fee` : null].filter(Boolean).join(", ") || "Details not recorded"}</Row>)}
        {activeDeals.length === 0 && offers.length === 0 && <Row label="0% deals">None recorded</Row>}
      </dl>}
    </section>
  </BalancesHiddenContext.Provider>;
}
