"use client";

import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { COUNTS_EXCLUSIONS, DISCLAIMER, dateLabel, money, type Example } from "./model";
import styles from "./disclosures.module.css";

function LabelValue({ label, value, total = false }: { label: string; value: number; total?: boolean }) {
  return <div className={`${styles.ledgerRow} ${total ? styles.total : ""}`}>
    <dt>{label}</dt><dd><MoneyText text={money(value, true)} /></dd>
  </div>;
}

function QuietFact({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.quietFact}><dt>{label}</dt><dd>{children}</dd></div>;
}

export default function DisclosureSet({ example, embedded, onCards }: { example: Example; embedded: boolean; onCards: () => void }) {
  const canCalculate = example.headline !== null && example.rows.length > 0;
  const cardKnown = example.card.purchases !== null;
  const unconfirmed = example.card.repayment === "unconfirmed" && !example.syncing;
  const cardTitle = "Card spending this pay period";
  const cardValue = cardKnown ? money(example.card.purchases) : "Unavailable";

  return <section data-g408-disclosures className={`${styles.set} ${embedded ? styles.embedded : styles.standalone}`} aria-label="Estimate details">
    <details className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span>What this estimate counts</span>
      </DisclosureSummary>
      <div className={styles.body}>
        <p>{COUNTS_EXCLUSIONS}</p>
        <p>{DISCLAIMER}</p>
      </div>
    </details>

    <details className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span>How we got{example.headline === null ? " this estimate" : ""}</span>
        {example.headline !== null && <span className={styles.amount}><MoneyText text={money(example.headline)} /></span>}
      </DisclosureSummary>
      <div className={styles.body}>
        {canCalculate ? <>
          <dl className={styles.ledger}>{example.rows.map(row => <LabelValue key={row.label} {...row} />)}</dl>
          {example.ledgerNote && <p className={styles.ledgerNote}><MoneyText text={example.ledgerNote} /></p>}
          <dl className={styles.facts}>
            <QuietFact label="Daily amount">{example.daily === null ? "Unavailable" : <MoneyText text={`${money(example.daily, true)} a day`} />}</QuietFact>
            <QuietFact label="Expected pay">{example.expectedPay === null ? "Not known yet" : <><MoneyText text={`About ${money(example.expectedPay)}`} /> due {dateLabel(example.payday, true)}</>}</QuietFact>
            {example.incomeBeforePayday !== undefined && <QuietFact label="Income expected before payday"><MoneyText text={money(example.incomeBeforePayday)} /></QuietFact>}
          </dl>
          {example.syncing && <p className={styles.sync}>Using your last known figures while bank data updates.</p>}
        </> : <p>We do not have enough bank information to show the working yet.</p>}
      </div>
    </details>

    <details className={styles.item}>
      <DisclosureSummary className={styles.summary}>
        <span className={styles.cardHeading}><span>{cardTitle}</span>{unconfirmed && <span className={styles.dot} role="img" aria-label="Repayment not confirmed" />}</span>
        <span className={styles.amount}><MoneyText text={cardValue} /></span>
      </DisclosureSummary>
      <div className={styles.body}>
        {cardKnown ? <>
          {example.syncing && <p>Last known card figures while bank data updates.</p>}
          {unconfirmed && <p className={styles.warning}><AlertCircle size={14} aria-hidden="true" />Repayment not confirmed</p>}
          <p>Purchases only. Balance transfers and repayments are not counted here.</p>
          {example.card.hold !== null && example.card.hold > 0 && <p><MoneyText text={`${money(example.card.hold, true)} is already held back for unconfirmed increases in card balances, which can include transfers. It is not deducted again here.`} /></p>}
          {example.card.repayment === "confirmed" && <p>Confirmed repayments are included separately in the estimate.</p>}
          {example.card.repayment === "unknown" && <p>We have not confirmed a repayment forecast yet.</p>}
        </> : <p>Card spending is not available yet.</p>}
        {example.showCardsLink && !example.syncing && <button type="button" onClick={onCards} className={styles.cardsButton}>See your cards</button>}
      </div>
    </details>
  </section>;
}
