"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { SafeToSpend } from "@/lib/api";
import type { LeftToSpendEvidence } from "@/lib/leftToSpendEvidence";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import IncomeEvidenceSheet from "@/components/IncomeEvidenceSheet";
import styles from "./SafeToSpendDisclosures.module.css";

type SafeToSpendOk = Extract<SafeToSpend, { status: "ok" }>;

const COUNTS_EXCLUSIONS = "It doesn't include other accounts, payments still pending, or bills Sorted hasn't spotted yet.";

function dateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function LedgerRow({ label, value, total, detail, format, onIncomeEvidence, expanded }: {
  label: string;
  value: number;
  total?: boolean;
  detail?: string;
  format: (value: number, exact?: boolean) => string;
  onIncomeEvidence?: () => void;
  expanded?: boolean;
}) {
  return <div className={`${styles.ledgerRow} ${total ? styles.total : ""}`}>
    <dt>{onIncomeEvidence ? <button type="button" aria-haspopup="dialog" aria-expanded={expanded} className={styles.incomeLedgerTrigger} onClick={onIncomeEvidence}>{label}</button> : label}{detail && <span className={styles.rowDetail}>{detail}</span>}</dt>
    <dd><MoneyText text={format(value, true)} /></dd>
  </div>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.fact}><dt>{label}</dt><dd>{children}</dd></div>;
}

function IncomeFact({ label, amount, caption, emptyLabel, formatIncome, about, expanded, onOpen }: { label: string; amount: number; caption: string; emptyLabel: string; formatIncome: (value: number) => string; about?: boolean; expanded: boolean; onOpen: () => void }) {
  return <div className={`${styles.fact} ${styles.incomeFact}`}><dt><button type="button" aria-haspopup="dialog" aria-expanded={expanded} onClick={onOpen}>{label}<span>{caption}</span></button></dt><dd>{!Number.isFinite(amount) || amount < 0 ? "Amount unavailable" : amount > 0 ? <>{about && "About "}<MoneyText text={formatIncome(amount)} /></> : emptyLabel}</dd></div>;
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
  formatIncome,
  paydayLabel,
  syncing,
  onRetry,
  showCardsLink,
  reservationDetails,
  freshnessLabel,
}: {
  disclaimer: string;
  data: SafeToSpendOk;
  evidence: LeftToSpendEvidence;
  format: (value: number, exact?: boolean) => string;
  formatIncome: (value: number) => string;
  paydayLabel: string;
  syncing: boolean;
  onRetry?: () => void;
  showCardsLink: boolean;
  reservationDetails: ReactNode;
  freshnessLabel: string | null;
}) {
  const [sheet, setSheet] = useState<"before_payday" | "expected_pay" | null>(null);
  const growth = data.card_growth_total ?? 0;
  const purchases = data.card_new_spend_total ?? 0;
  const purchasesKnown = typeof data.card_new_spend_total === "number" && Number.isFinite(data.card_new_spend_total);
  const showCardActivity = growth > 0 || purchases > 0 || showCardsLink;
  const repaymentDue = data.card_growth_wording === "cleared_monthly" ? dateLabel(data.card_growth_due_date) : null;
  const expectedPay = data.payday_income ?? 0;
  const incomeInLedger = evidence.rows.some(row => row.label === "Income before payday");

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
          {evidence.rows.map((row) => <LedgerRow key={row.label} {...row} format={format} onIncomeEvidence={row.label === "Income before payday" ? () => setSheet("before_payday") : undefined} expanded={sheet === "before_payday"} />)}
        </dl>
        {evidence.ledgerNote && <p className={styles.note}><MoneyText text={evidence.ledgerNote} /></p>}
        {reservationDetails}
        {(data.pooled_transfers_excluded ?? 0) > 0 && <p>Transfers between your own included accounts do not change the total, so they are left out of this calculation.</p>}
        <dl className={styles.facts}>
          <Fact label="Daily amount">{evidence.dailyAmount === null ? "Not available" : <MoneyText text={`${format(evidence.dailyAmount, true)} a day`} />}</Fact>
          <IncomeFact label="Expected pay" amount={expectedPay} caption={expectedPay > 0 ? `Expected on ${paydayLabel}` : `Pay period ends ${paydayLabel}`} emptyLabel="Not known yet" formatIncome={formatIncome} about expanded={sheet === "expected_pay"} onOpen={() => setSheet("expected_pay")} />
          {!incomeInLedger && <IncomeFact label="Income before payday" amount={data.income_before_payday} caption="See what is counted" emptyLabel="None expected" formatIncome={formatIncome} expanded={sheet === "before_payday"} onOpen={() => setSheet("before_payday")} />}
        </dl>
        {syncing && <p className={styles.sync}>Using your last known figures while bank data updates.</p>}
        {freshnessLabel && <p className={styles.freshness}>{freshnessLabel}</p>}
      </div>
    </details>

    {showCardActivity && <details data-g324-card-activity className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span className={styles.cardHeading}>Card spending this pay period</span>
        <span className={styles.amount}><MoneyText text={purchasesKnown ? format(purchases) : "Unavailable"} /></span>
      </DisclosureSummary>
      <div className={styles.body}>
        {syncing && <p>Last known card figures while bank data updates.</p>}
        {!purchasesKnown && <p>Card spending is not available yet.</p>}
        {purchasesKnown && <dl className={styles.facts}><Fact label="Card purchases"><MoneyText text={format(purchases, true)} /></Fact></dl>}
        <p>Purchases only. Balance transfers and repayments are not counted here.</p>
        <p>Known card repayments due before payday are included in your estimate. Card purchases aren&apos;t deducted again.{repaymentDue ? ` Due around ${repaymentDue}. Its repayment is forecast separately.` : ""}</p>
        {showCardsLink && !syncing && <Link href="/cards" className={styles.cardsButton}>See your cards</Link>}
      </div>
    </details>}
    {sheet === "before_payday" && <IncomeEvidenceSheet open title="Income before payday" paydayLabel={paydayLabel} group={data.income_evidence?.before_payday} scalar={data.income_before_payday} kind="before_payday" formatIncome={formatIncome} syncing={syncing} freshnessLabel={freshnessLabel} onClose={() => setSheet(null)} onRetry={onRetry} />}
    {sheet === "expected_pay" && <IncomeEvidenceSheet open title="Expected pay" paydayLabel={paydayLabel} group={data.income_evidence?.expected_pay} scalar={expectedPay} kind="expected_pay" formatIncome={formatIncome} syncing={syncing} freshnessLabel={freshnessLabel} onClose={() => setSheet(null)} onRetry={onRetry} />}
  </section>;
}
