"use client";

import { ChevronDown, Upload } from "lucide-react";
import type { CardTermsCard } from "@/lib/api";
import { listCardOffers, monthlyClearingIllustration, offerLabel, offerTimeLeft } from "@/lib/cardOffers";
import { formatValue } from "@/lib/calendar";
import { displayAccountName } from "@/lib/accountName";
import { MaskedAmount } from "@/lib/balancesHidden";
import styles from "./CardOffers.module.css";

export function offerDate(value: string | null | undefined): string {
  return formatValue(value, "day") || "Not recorded";
}

export function OfferAmount({ value, currency, hidden }: { value: number | null | undefined; currency: string; hidden: boolean }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <span className={styles.unknown}>Not recorded</span>;
  let symbol = currency || "Currency unknown";
  try { symbol = new Intl.NumberFormat("en-GB", { style: "currency", currency }).formatToParts(0).find(part => part.type === "currency")?.value || currency; } catch {}
  if (hidden) return <MaskedAmount text={`${value < 0 ? "−" : ""}${symbol}••••`} className={styles.money} />;
  let text: string;
  try { text = new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value); }
  catch { text = `${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency || "(currency not recorded)"}`; }
  return <span className={styles.money}>{text.replace(/^-/, "−")}</span>;
}

/** Approved G471 A. An offer's own balance is never inferred from its card. */
export default function OfferCards({ cards, hidden, today, onUpdate }: {
  cards: CardTermsCard[];
  hidden: boolean;
  today: string;
  onUpdate?: (accountId: string) => void;
}) {
  const offers = listCardOffers(cards);
  return <ol className={`${styles.surface} ${styles.offerCards}`} data-card-offers>{offers.map(({ id, card, promo }) => {
    const ended = !!promo.until && promo.until < today;
    const knownEnd = !!formatValue(promo.until, "day");
    const supportsBalance = card.currency === "GBP";
    const illustration = card.currency === "GBP" ? monthlyClearingIllustration(promo, today) : null;
    return <li key={id}><article className={styles.offer}>
      <div className={styles.offerIdentity}><span>{displayAccountName(card.name)}</span><span className={styles.badge}>{ended ? "Offer ended" : offerTimeLeft(promo.until, today) ?? "End date unknown"}</span></div>
      <div className={styles.offerLead}>
        <div><p className={styles.label}>Balance on this offer</p><h3>{supportsBalance ? <OfferAmount value={promo.balance} currency={card.currency} hidden={hidden} /> : <span className={styles.unknown}>Not available for this currency</span>}</h3></div>
        <div className={styles.rate}><strong>{promo.apr_pct}%</strong><span>offer rate</span></div>
      </div>
      <p className={styles.offerType}>{offerLabel(promo)}</p>
      <dl className={styles.offerFacts}><div><dt>{ended ? "Ended" : "Ends"}</dt><dd>{offerDate(promo.until)}</dd></div><div><dt>Rate after the offer</dt><dd>{promo.revert_apr_pct == null ? "Not recorded" : `${promo.revert_apr_pct}% APR`}</dd></div></dl>
      <p className={styles.factualLine}>
        {ended ? "This offer has ended. Check the current rate and balance with your card provider." : !knownEnd ? "The end date is unknown. Check your card app before adding a date." : !supportsBalance ? "Per-offer balances from files are currently recorded for GBP cards only." : promo.balance == null ? "The balance on this offer is not recorded. Add a statement or screenshot to fill in the details." : <><OfferAmount value={promo.balance} currency={card.currency} hidden={hidden} /> at {promo.apr_pct}% until {offerDate(promo.until)}.{illustration ? <> About <OfferAmount value={illustration.monthlyAmount} currency={card.currency} hidden={hidden} /> a month could clear this recorded balance before then.</> : promo.apr_pct > 0 ? " Interest may be added while this offer is running." : promo.balance === 0 ? " No balance remains on this recorded offer." : " No monthly clearing figure is available for this offer."}</>}
      </p>
      <details className={styles.details}><summary>Offer details and source<ChevronDown size={16} aria-hidden="true" /></summary><div className={styles.detailBody}>
        <dl className={styles.evidenceList}><div><dt>Balance recorded on</dt><dd>{offerDate(promo.as_of)}</dd></div><div><dt>Card</dt><dd>{displayAccountName(card.name)}</dd></div><div><dt>Source</dt><dd>{card.terms?.status === "confirmed" ? "Confirmed card details" : "Recorded card details"}</dd></div></dl>
        <p>This is the balance on this offer, rather than the whole card. Minimum payments and your provider’s payment allocation rules still apply.</p>
        {illustration && !ended && <p>{illustration.paymentCount} monthly payments, from {offerDate(illustration.firstPaymentDate)} to {offerDate(illustration.lastPaymentDate)}, each before the offer ends. Rounded up to the next pound. Assumes no new spending or fees and an unchanged recorded balance. This is an illustration, not a payment plan.</p>}
        {promo.apr_pct > 0 && !ended && <p>No monthly clearing figure is shown for an interest-bearing offer. The cost depends on how your provider applies interest and payments.</p>}
        <p>{promo.as_of ? "The balance may have changed since it was recorded." : "The date this balance was recorded is unknown."} Check your card app for today’s amount.</p>
        {onUpdate && supportsBalance && card.card_class !== "charge_card" && <button type="button" className={styles.textButton} onClick={() => onUpdate(card.account_id)}>Update from a file<Upload size={15} aria-hidden="true" /></button>}
      </div></details>
    </article></li>;
  })}</ol>;
}
