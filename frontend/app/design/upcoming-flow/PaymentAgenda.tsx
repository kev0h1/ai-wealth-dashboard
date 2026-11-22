import type { ReactNode } from "react";
import type { PreviewAccount, PreviewMove, PreviewPayment, Scenario, VariantProps } from "./types";
import {
  AccountAmount,
  AccountIdentity,
  AccountStatus,
  AccountWorking,
  dateLabel,
  focusClass,
  MoneyCopy,
  MoveRoute,
  PaymentRow,
  PlansArea,
} from "./ui";
import styles from "./payment-agenda.module.css";

function datedEntries(scenario: Scenario) {
  return [...new Set([
    ...scenario.payments.map((payment) => payment.date),
    ...scenario.moves.flatMap((move) => move.byDate ? [move.byDate] : []),
  ])].sort();
}

function isCardCharge(payment: PreviewPayment) {
  return payment.kind === "card-charge";
}

function AgendaMove({ move, scenario }: { move: PreviewMove; scenario: Scenario }) {
  return <div className={styles.moveRow}>
    <MoveRoute move={move} scenario={scenario} showProof />
  </div>;
}

function AccountMapRow({ account }: { account: PreviewAccount }) {
  return <div className={styles.accountRow} data-balanced-row={`agenda-account-${account.id}`}>
    <div data-row-content className={styles.accountInner}>
      <div className={styles.accountIdentity}><AccountIdentity account={account} compact /></div>
      <div className={styles.accountState}>
        <AccountStatus account={account} />
      </div>
      <div className={styles.accountAmount}><AccountAmount account={account} /></div>
    </div>
  </div>;
}

function AccountMap({ scenario }: { scenario: Scenario }) {
  const nonCards = scenario.accounts.filter((account) => account.purpose !== "card");
  const visible = nonCards.filter((account) => account.status !== "covered" || account.purpose === "source");
  const coveredPaying = nonCards.filter((account) => account.status === "covered" && account.purpose === "paying");
  const cards = scenario.accounts.filter((account) => account.purpose === "card");

  return <section className={styles.accountMap} aria-labelledby="agenda-accounts-title">
    <div className={styles.sectionHeading}>
      <h2 id="agenda-accounts-title">Account outcomes</h2>
      <p>Money needed and suggested sources, kept separate.</p>
    </div>
    <div className={styles.accountList}>
      {visible.map((account) => <AccountMapRow key={account.id} account={account} />)}
      {coveredPaying.length > 0 && <details className={styles.foldGroup}>
        <summary data-balanced-row="agenda-covered-accounts" className={`${styles.foldSummary} ${focusClass}`}>
          <span data-row-content>Covered paying accounts ({coveredPaying.length})</span>
        </summary>
        <div className={styles.foldRows}>{coveredPaying.map((account) => <AccountMapRow key={account.id} account={account} />)}</div>
      </details>}
      {cards.length > 0 && <details className={styles.foldGroup}>
        <summary data-balanced-row="agenda-card-accounts" className={`${styles.foldSummary} ${focusClass}`}>
          <span data-row-content>Card accounts ({cards.length})</span>
        </summary>
        <div className={styles.foldNote}>Card charges are shown in the agenda, but are not cash payments from these accounts.</div>
        <div className={styles.foldRows}>{cards.map((account) => <AccountMapRow key={account.id} account={account} />)}</div>
      </details>}
    </div>
  </section>;
}

function DateJumpRail({ dates }: { dates: string[] }) {
  if (!dates.length) return null;
  return <nav className={styles.jumpRail} aria-label="Jump to a payment date">
    <span className={styles.jumpPrompt}>Jump to date</span>
    <div className={styles.jumpLinks}>
      {dates.map((date) => <a key={date} href={`#agenda-${date}`} className={`${styles.jumpLink} ${focusClass}`}>{dateLabel(date)}</a>)}
    </div>
  </nav>;
}

function DaySection({ date, scenario }: { date: string; scenario: Scenario }) {
  const moves = scenario.moves.filter((move) => move.byDate === date);
  const payments = scenario.payments.filter((payment) => payment.date === date);
  const leaving = payments.filter((payment) => !isCardCharge(payment));
  const cardCharges = payments.filter(isCardCharge);

  return <section id={`agenda-${date}`} className={styles.daySection} aria-labelledby={`agenda-day-${date}`}>
    <header className={styles.dayMarker}>
      <h3 id={`agenda-day-${date}`}>{dateLabel(date)}</h3>
    </header>
    <div className={styles.dayContent}>
      {moves.map((move) => <AgendaMove key={move.id} move={move} scenario={scenario} />)}
      {leaving.length > 0 && <div className={styles.paymentGroup}>
        {leaving.map((payment) => <PaymentRow key={payment.id} payment={payment} scenario={scenario} showAccount />)}
      </div>}
      {cardCharges.length > 0 && <div className={styles.cardChargeGroup}>
        <p className={styles.cardChargeHeading}>Card charges, cash not left yet</p>
        {cardCharges.map((payment) => <PaymentRow key={payment.id} payment={payment} scenario={scenario} showAccount />)}
      </div>}
    </div>
  </section>;
}

function ActiveAccountWorking({ account, scenario }: { account: PreviewAccount; scenario: Scenario }) {
  return <AccountWorking account={account} scenario={scenario} label={<AccountIdentity account={account} compact />} />;
}

function WorkingRail({ scenario }: { scenario: Scenario }) {
  return <aside className={styles.workingRail} aria-labelledby="agenda-working-title">
    <div className={styles.workingHeading}>
      <h2 id="agenda-working-title">Account working</h2>
      <p>How each account’s figures were worked out.</p>
    </div>
    <div className={styles.workingList}>
      {scenario.accounts.map((account) => <ActiveAccountWorking key={account.id} account={account} scenario={scenario} />)}
    </div>
  </aside>;
}

function PlansNotice({ scenario }: { scenario: Scenario }) {
  const unresolved = scenario.plans.filter((plan) => plan.uncertain || !plan.sourceId);
  if (!unresolved.length) return null;

  return <a className={`${styles.plansNotice} ${focusClass}`} href="#upcoming-plans">
    <span className={styles.noticeDot} aria-hidden="true" />
    <span>{unresolved.length === 1 ? "One goal needs a paying account." : `${unresolved.length} plans need paying accounts.`}</span>
  </a>;
}

function EmptyAgenda() {
  return <p className={styles.emptyAgenda}>There are no dated payments in this run yet. Account readings are still shown above.</p>;
}

export default function PaymentAgenda({ scenario, hidden }: VariantProps) {
  const dates = datedEntries(scenario);
  const content: ReactNode = dates.length
    ? dates.map((date) => <DaySection key={date} date={date} scenario={scenario} />)
    : <EmptyAgenda />;

  return <div className={styles.agenda} aria-labelledby="payment-agenda-title" data-balances-hidden={hidden ? "true" : undefined}>
    <header className={styles.hero}>
      <div>
        <h1 id="payment-agenda-title"><MoneyCopy text={scenario.headline} /></h1>
        <p className={styles.reading}><MoneyCopy text={scenario.reading} /></p>
      </div>
      <p className={styles.period}>{scenario.periodLabel}</p>
    </header>

    <PlansNotice scenario={scenario} />

    <div className={styles.agendaGrid}>
      <AccountMap scenario={scenario} />
      <section className={styles.itinerary} aria-labelledby="payment-itinerary-title">
        <div className={styles.itineraryHeading}>
          <h2 id="payment-itinerary-title">Payment itinerary</h2>
          <p>Suggested moves are for you to make. Nothing has moved.</p>
        </div>
        <DateJumpRail dates={dates} />
        <div className={styles.dayList}>{content}</div>
      </section>
      <WorkingRail scenario={scenario} />
    </div>

    {scenario.plans.length > 0 && <div className={styles.plansTail}><PlansArea scenario={scenario} /></div>}
  </div>;
}
