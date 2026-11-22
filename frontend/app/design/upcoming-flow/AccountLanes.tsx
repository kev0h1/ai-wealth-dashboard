"use client";

import { useState } from "react";
import type { PreviewAccount, VariantProps } from "./types";
import {
  AccountAmount,
  AccountIdentity,
  AccountStatus,
  AccountWorking,
  Money,
  MoneyCopy,
  MoveRoute,
  PaymentRow,
  PlansArea,
  accountLabel,
  bankLabel,
  dateLabel,
  focusClass,
} from "./ui";
import styles from "./account-lanes.module.css";

function accountPriority(account: PreviewAccount) {
  const priorities = {
    short: 0,
    move: 1,
    funding: 2,
    plans: 3,
    checking: 4,
    covered: 5,
  } as const;
  return priorities[account.status];
}

function AccountMapRow({
  account,
  selected,
  onSelect,
}: {
  account: PreviewAccount;
  selected: boolean;
  onSelect: () => void;
}) {
  const accountName = accountLabel(account);
  const bankName = bankLabel(account);

  return (
    <button
      type="button"
      className={`${styles.accountRow} ${selected ? styles.accountRowSelected : ""} ${focusClass}`}
      aria-pressed={selected}
      aria-label={`${accountName}, ${bankName}, ${account.statusLabel}${selected ? ", selected" : ""}`}
      onClick={onSelect}
      data-balanced-row="account-map-row"
    >
      <span data-row-content className={styles.accountRowContent}>
        <span className={styles.identityWrap}>
          <AccountIdentity account={account} compact />
        </span>
        <span className={styles.accountReading}>
          <AccountAmount account={account} />
          <AccountStatus account={account} />
        </span>
      </span>
    </button>
  );
}

function SelectedAccountJourney({ account, scenario }: { account: PreviewAccount; scenario: VariantProps["scenario"] }) {
  const incomingMoves = scenario.moves.filter((move) => move.toId === account.id);
  const outgoingMoves = scenario.moves.filter((move) => move.fromId === account.id);
  const payments = scenario.payments
    .filter((payment) => payment.accountId === account.id)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const fundingSource = account.purpose === "source" || outgoingMoves.length > 0;
  const paymentHeading = account.kind === "Credit card" ? "Card charges and settling" : "Payments from this account";
  const needsReading = account.status === "checking" || account.status === "plans";

  return (
    <article className={styles.journey} aria-labelledby={`journey-${account.id}`}>
      <header className={styles.journeyHeader}>
        <div className={styles.journeyTitleBlock}>
          <h2 id={`journey-${account.id}`}>{bankLabel(account)}</h2>
          <p>{accountLabel(account)} · {fundingSource ? "Funding account" : account.kind}</p>
        </div>
        <AccountStatus account={account} />
      </header>

      {(incomingMoves.length > 0 || outgoingMoves.length > 0) && (
        <section className={styles.routes} aria-labelledby={`routes-${account.id}`}>
          <h3 id={`routes-${account.id}`}>Suggested moves</h3>
          <div className={styles.routeList}>
            {incomingMoves.map((move) => <MoveRoute key={move.id} move={move} scenario={scenario} showProof />)}
            {outgoingMoves.map((move) => <MoveRoute key={move.id} move={move} scenario={scenario} showProof />)}
          </div>
          <p className={styles.manualNote}>Suggested moves are for you to make. Nothing has moved automatically.</p>
        </section>
      )}

      {(account.earmarkedPence !== undefined || account.sourceProof) && (
        <section className={styles.earmark} aria-label="Funding evidence">
          {account.earmarkedPence !== undefined && (
            <p>
              <Money value={account.earmarkedPence} /> is already earmarked for this account&apos;s role.
            </p>
          )}
          {account.sourceProof && <p><MoneyCopy text={account.sourceProof} /></p>}
        </section>
      )}

      {needsReading && <p className={styles.accountNote}><MoneyCopy text={account.note} /></p>}

      <section className={styles.paymentSection} aria-labelledby={`payments-${account.id}`}>
        <div className={styles.sectionHeading}>
          <h3 id={`payments-${account.id}`}>{paymentHeading}</h3>
          {account.firstNeedDate && <p>{dateLabel(account.firstNeedDate)} onwards</p>}
        </div>
        {payments.length > 0 ? (
          <div className={styles.paymentList}>
            {payments.map((payment) => <PaymentRow key={payment.id} payment={payment} scenario={scenario} showAccount={false} />)}
          </div>
        ) : fundingSource ? (
          <p className={styles.quietReading}>This account has no payment due in this period. Its outgoing suggestion remains visible above.</p>
        ) : (
          <p className={styles.quietReading}>No dated payment is available for this account in this period.</p>
        )}
      </section>

      <div className={styles.workingWrap}>
        <AccountWorking account={account} scenario={scenario} />
      </div>
    </article>
  );
}

export default function AccountLanes({ scenario, hidden }: VariantProps) {
  const orderedAccounts = scenario.accounts.slice().sort((left, right) => accountPriority(left) - accountPriority(right));
  const attentionAccounts = orderedAccounts.filter((account) => account.status !== "covered");
  const coveredAccounts = orderedAccounts.filter((account) => account.status === "covered" && account.purpose === "paying");
  const cardAccounts = orderedAccounts.filter((account) => account.purpose === "card");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [coveredOpen, setCoveredOpen] = useState(() => attentionAccounts.length === 0 && coveredAccounts.length > 0);
  const [cardsOpen, setCardsOpen] = useState(false);
  const selectedAccount = orderedAccounts.find((account) => account.id === selectedId)
    ?? attentionAccounts[0]
    ?? coveredAccounts[0]
    ?? cardAccounts[0]
    ?? null;
  const unassignedPlans = scenario.plans.filter((plan) => plan.sourceId === null);
  const selectAccount = (account: PreviewAccount) => {
    setSelectedId(account.id);
    if (account.purpose === "card") setCardsOpen(true);
    if (account.status === "covered" && account.purpose === "paying") setCoveredOpen(true);
  };

  return (
    <div className={styles.workbench} data-balances-hidden={hidden ? "true" : undefined}>
      <header className={styles.reading}>
        <h1><MoneyCopy text={scenario.headline} /></h1>
        <p><MoneyCopy text={scenario.reading} /></p>
        {unassignedPlans.length > 0 && (
          <a href="#upcoming-plans" className={`${styles.planNotice} ${focusClass}`}>
            {unassignedPlans.length === 1 ? "One goal needs a paying account." : `${unassignedPlans.length} goals need paying accounts.`}
          </a>
        )}
      </header>

      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Account responsibility map">
          <section className={styles.accountMap} aria-labelledby="account-map-heading">
            <div className={styles.mapHeader}>
              <div>
                <h2 id="account-map-heading">Choose an account</h2>
              </div>
              <span>{scenario.periodLabel}</span>
            </div>

            <div className={`${styles.accountRows} ${(coveredAccounts.length > 0 || cardAccounts.length > 0) ? styles.accountRowsWithFold : ""}`}>
              {attentionAccounts.map((account) => (
                <AccountMapRow
                  key={account.id}
                  account={account}
                  selected={account.id === selectedAccount?.id}
                  onSelect={() => selectAccount(account)}
                />
              ))}
            </div>

            {coveredAccounts.length > 0 && (
              <details className={styles.coveredFold} open={coveredOpen || (selectedAccount?.purpose === "paying" && selectedAccount.status === "covered")} onToggle={(event) => setCoveredOpen(event.currentTarget.open)}>
                <summary className={focusClass} data-balanced-row="covered-account-fold">
                  <span data-row-content>
                    {coveredAccounts.length} {coveredAccounts.length === 1 ? "account covers its payment" : "accounts cover their payments"}
                  </span>
                </summary>
                <div className={styles.coveredRows}>
                  {coveredAccounts.map((account) => (
                    <AccountMapRow
                      key={account.id}
                      account={account}
                      selected={account.id === selectedAccount?.id}
                      onSelect={() => selectAccount(account)}
                    />
                  ))}
                </div>
              </details>
            )}

            {cardAccounts.length > 0 && (
              <details className={styles.coveredFold} open={cardsOpen || selectedAccount?.purpose === "card"} onToggle={(event) => setCardsOpen(event.currentTarget.open)}>
                <summary className={focusClass} data-balanced-row="card-account-fold">
                  <span data-row-content>
                    Card charges · {cardAccounts.length} {cardAccounts.length === 1 ? "account" : "accounts"}
                  </span>
                </summary>
                <div className={styles.coveredRows}>
                  {cardAccounts.map((account) => (
                    <AccountMapRow
                      key={account.id}
                      account={account}
                      selected={account.id === selectedAccount?.id}
                      onSelect={() => selectAccount(account)}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        </aside>

        <div className={styles.detailColumn}>
          {selectedAccount ? <SelectedAccountJourney account={selectedAccount} scenario={scenario} /> : (
            <p className={styles.quietReading}>No account reading is available for this period.</p>
          )}
          <section className={styles.plans} aria-label="Plans and set-asides">
            <PlansArea scenario={scenario} />
          </section>
        </div>
      </div>
    </div>
  );
}
