"use client";

import { Smartphone, Zap } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { MoveCard } from "@/components/HomeBrief";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import UpcomingRow, { type UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import { MOVE_SUGGESTION, UPCOMING_HERO } from "./fixtures";
import data from "./campaign-data.json";
import styles from "./worlds.module.css";

export const campaignMoney = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);
const noOp = () => {};
const paymentsTotal = data.payments.reduce((sum, payment) => sum + payment.amount, 0);

function BankIdentity({ bank }: { bank: string }) {
  const meta = BANK_META[bankKey({ provider: bank })];
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? bank.slice(0, 2)} altText="" brandBg={meta?.bg} size={28} />;
}

export function UpcomingCampaignProof() {
  return <section data-marketing-proof="upcoming"><p className={styles.proofCaption}>{data.person} · {data.period}</p><UpcomingHeroCard {...UPCOMING_HERO} spendableNow={data.everyday.balance + data.bills.balance} runwayBillsTotal={paymentsTotal} runway={data.everyday.balance + data.bills.balance - paymentsTotal} /></section>;
}

export function ForecastContext() {
  const opening = data.everyday.balance + data.bills.balance;
  return <div className={styles.forecastContext}>
    <p><span>{campaignMoney(opening)}</span> across these accounts · <span>−{campaignMoney(paymentsTotal)}</span> expected payments</p>
    <p><span>{campaignMoney(opening - paymentsTotal)}</span> projected at payday, before your <span>{campaignMoney(data.buffer)}</span> buffer</p>
  </div>;
}

export function PaymentGraphics() {
  return <div data-payment-graphics className="dark" inert>{data.payments.map((payment, index) => {
    const available = index === 0 ? data.everyday.balance : data.bills.balance;
    const shortfall = Math.max(0, payment.amount - available);
    const model: UpcomingRowModel = {
      rowKey: payment.id, type: "bill", name: payment.name, amount: payment.amount,
      expectedDate: payment.date, accountLabel: payment.account,
      accountBalance: available, accountShort: shortfall > 0,
      coverage: { shortfall }, after: { kind: "balance", value: available - payment.amount },
      categoryColour: index === 0 ? "#22d3ee" : "#60a5fa", CategoryIcon: index === 0 ? Smartphone : Zap,
    };
    return <section data-payment-graphic={payment.id} key={payment.id} className={`${styles.paymentGraphic} ${index === 0 ? styles.paymentLeft : styles.paymentRight}`}>
      <div className={styles.paymentInner}>
        <div className={styles.bankHeading}><BankIdentity bank={payment.bank} /><strong>{payment.bank}</strong><span>Expected</span></div>
        <p className={styles.paymentDate}>{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${payment.date}T12:00:00Z`))}</p>
        <UpcomingRow model={model} treatment="account-coverage" onOpen={noOp} onDismiss={noOp} />
      </div>
    </section>;
  })}</div>;
}

export function MovementCampaignProof() {
  const item = {
    ...MOVE_SUGGESTION,
    body: `Your bills account needs ${campaignMoney(data.move)} for payments before 30 October.`,
    move_map: {
      from: { account_id: "alex-everyday", name: data.everyday.name, provider: data.everyday.bank, balance: data.everyday.balance, safe_note: "Keeps money for your own payments" },
      to: { account_id: "alex-bills", name: data.bills.name, provider: data.bills.bank, balance: data.bills.balance, incoming: `${campaignMoney(data.move)} suggested` },
    },
    plan_dest: { account_id: "alex-bills", name: data.bills.name, provider: data.bills.bank, balance: data.bills.balance, needs_total: data.payments[1].amount, needs_by: "18 Oct", needs_by_date: data.payments[1].date, bills: [{ label: data.payments[1].name, amount: data.payments[1].amount, expected_date: data.payments[1].date }] },
  };
  return <section data-marketing-proof="movement"><p className={styles.proofCaption}>Suggested move · not transferred</p><MoveCard item={item} hideNetWorth={false} maskAmounts={(text) => text} previewMode /></section>;
}

export function MovementGraphics() {
  return <div data-movement-graphics>
    {[data.everyday, data.bills].map((account, index) => <section key={account.bank} className={`${styles.movementAccount} ${index === 0 ? styles.moveFrom : styles.moveTo}`}>
      <p>{index === 0 ? "From" : "To"}</p><div><BankIdentity bank={account.bank} /><strong>{account.bank}</strong></div><span>{account.name}</span>
      {index === 1 && <p className={styles.existingBalance}><span>{campaignMoney(account.balance)}</span> already in this account</p>}
    </section>)}
    <div className={styles.moveAmount}><strong>{campaignMoney(data.move)}</strong><span>Suggested move</span></div>
  </div>;
}
