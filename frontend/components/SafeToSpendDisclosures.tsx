import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { SafeToSpend } from "@/lib/api";
import type { LeftToSpendEvidence } from "@/lib/leftToSpendEvidence";
import type { CoverMoveEvidence } from "@/lib/coverMoveEvidence";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import styles from "./SafeToSpendDisclosures.module.css";

type SafeToSpendOk = Extract<SafeToSpend, { status: "ok" }>;

const COUNTS_EXCLUSIONS = "It doesn't include other accounts, payments still pending, or bills Sorted hasn't spotted yet.";

function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function LedgerRow({ label, value, total, detail, format }: {
  label: string;
  value: number;
  total?: boolean;
  detail?: string;
  format: (value: number, exact?: boolean) => string;
}) {
  return <div className={`${styles.ledgerRow} ${total ? styles.total : ""}`}>
    <dt>{label}{detail && <span className={styles.rowDetail}>{detail}</span>}</dt>
    <dd><MoneyText text={format(value, true)} /></dd>
  </div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.fact}><dt>{label}</dt><dd>{children}</dd></div>;
}

/**
 * G408 B. Evidence belongs below the unchanged Safe to Spend hero, in one
 * quiet card. This component owns no forecast arithmetic or account rail.
 */
export default function SafeToSpendDisclosures({
  disclaimer,
  data,
  evidence,
  format,
  paydayLabel,
  syncing,
  showCardsLink,
  reservationDetails,
  freshnessLabel,
  earmarkedMoves = [],
}: {
  disclaimer: string;
  data: SafeToSpendOk;
  evidence: LeftToSpendEvidence;
  format: (value: number, exact?: boolean) => string;
  paydayLabel: string;
  syncing: boolean;
  showCardsLink: boolean;
  reservationDetails: ReactNode;
  freshnessLabel: string | null;
  earmarkedMoves?: CoverMoveEvidence[];
}) {
  const growth = data.card_growth_total ?? 0;
  const purchases = data.card_new_spend_total ?? 0;
  const purchasesKnown = typeof data.card_new_spend_total === "number" && Number.isFinite(data.card_new_spend_total);
  const reserve = data.card_growth_reserved ?? 0;
  const showCardActivity = growth > 0 || purchases > 0 || reserve > 0 || showCardsLink;
  const unconfirmed = reserve > 0 && !syncing;
  const repaymentDue = data.card_growth_wording === "cleared_monthly" ? dateLabel(data.card_growth_due_date) : null;
  const expectedPay = data.payday_income ?? 0;

  return <section data-g324-evidence data-g408-disclosures className={styles.set} aria-label="Estimate details">
    <details data-sts-caveat className={styles.item}>
      <DisclosureSummary className={styles.summary}><span>What this estimate counts</span></DisclosureSummary>
      <div className={styles.body}>
        <p>{COUNTS_EXCLUSIONS}</p>
        <p data-sts-disclaimer>{disclaimer}</p>
      </div>
    </details>

    <details data-g324-calculation className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span>{evidence.summaryLabel}</span>
        <span className={styles.amount}><MoneyText text={format(evidence.summaryAmount)} /></span>
      </DisclosureSummary>
      <div className={styles.body}>
        <dl className={styles.ledger}>
          {evidence.rows.map((row) => <LedgerRow key={row.label} {...row} format={format} />)}
        </dl>
        {evidence.ledgerNote && <p className={styles.note}><MoneyText text={evidence.ledgerNote} /></p>}
        {evidence.cardGap !== null && <p><MoneyText text={`${format(0)} remains available above while an unconfirmed card repayment leaves a ${format(evidence.cardGap, true)} gap.`} /></p>}
        {evidence.heroShowsCashGap && <p>The estimate above shows the cash shortfall. A separate card hold can increase that gap.</p>}
        {reservationDetails}
        {earmarkedMoves.length > 0 && <div data-g412-earmarks>
          {earmarkedMoves.map(move => <p key={`${move.sourceId}:${move.destinationId}`}><MoneyText text={`${format(move.amount, true)} moving from ${move.sourceName} to ${move.destinationName} to cover its payments. This does not change the total.`} /></p>)}
        </div>}
        {(data.pooled_transfers_excluded ?? 0) > 0 && <p>Transfers between your own included accounts do not change the total, so they are left out of this calculation.</p>}
        <dl className={styles.facts}>
          <Fact label="Daily amount">{evidence.dailyAmount === null ? "Not available" : <MoneyText text={`${format(evidence.dailyAmount, true)} a day`} />}</Fact>
          <Fact label="Expected pay">{expectedPay > 0 ? <><MoneyText text={`About ${format(expectedPay)}`} /> due {paydayLabel}</> : "Not known yet"}</Fact>
          {expectedPay <= 0 && <Fact label="Pay period">Ends {paydayLabel}</Fact>}
          {evidence.incomeBeforePayday !== null && <Fact label="Income before payday"><MoneyText text={format(evidence.incomeBeforePayday, true)} /></Fact>}
        </dl>
        {syncing && <p className={styles.sync}>Using your last known figures while bank data updates.</p>}
        {freshnessLabel && <p className={styles.freshness}>{freshnessLabel}</p>}
      </div>
    </details>

    {showCardActivity && <details data-g324-card-activity className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span className={styles.cardHeading}>Card spending this pay period{unconfirmed && <span className={styles.dot} role="img" aria-label="Repayment not confirmed" />}</span>
        <span className={styles.amount}><MoneyText text={purchasesKnown ? format(purchases) : "Unavailable"} /></span>
      </DisclosureSummary>
      <div className={styles.body}>
        {syncing && <p>Last known card figures while bank data updates.</p>}
        {!purchasesKnown && <p>Card spending is not available yet.</p>}
        {unconfirmed && <p className={styles.warning}><AlertCircle size={14} aria-hidden="true" />Repayment not confirmed</p>}
        <p>Purchases only. Balance transfers and repayments are not counted here.</p>
        {reserve > 0 ? <p><MoneyText text={`${format(reserve, true)} is already held back for unconfirmed increases in card balances, which can include transfers. It is not deducted again here.`} /></p> : <p>Known card repayments due before payday are included in your estimate. Card purchases aren&apos;t deducted again.{repaymentDue ? ` Due around ${repaymentDue}. Its repayment is forecast separately.` : ""}</p>}
        {showCardsLink && !syncing && <Link href="/cards" className={styles.cardsButton}>See your cards</Link>}
      </div>
    </details>}
  </section>;
}
