"use client";
import { useId, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ChevronDown, ChevronRight, Info, ReceiptText, TriangleAlert, Wallet } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { MaskedAmount, useBalancesHidden } from "@/lib/balancesHidden";
import { afterPayments, afterPlans, afterSuggestedMoves, dateText, formatPence, type PreviewAccount } from "./G416Fixtures";
import styles from "./preview.module.css";

export function Money({ pence, exact = false, plus = false }: { pence: number | null; exact?: boolean; plus?: boolean }) {
  const hidden = useBalancesHidden();
  if (pence === null) return <span className={styles.unavailable}>Unavailable</span>;
  return hidden ? <MaskedAmount text={`${pence < 0 ? "−" : plus && pence > 0 ? "+" : ""}£••••`} /> : <span className="money">{formatPence(pence, exact, plus)}</span>;
}
export function BankMark({ account }: { account: PreviewAccount }) {
  const meta = BANK_META[bankKey({ provider: account.bank })];
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2)} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} />;
}
export function Signal({ account }: { account: PreviewAccount }) {
  const Icon = account.signal === "risk" ? TriangleAlert : Info;
  return account.signal ? <Icon data-signal={account.signal} size={14} aria-hidden="true" className={account.signal === "risk" ? styles.risk : account.signal === "unknown" ? styles.muted : styles.watch} /> : null;
}
export function AccountRow({ account, onOpen }: { account: PreviewAccount; onOpen: (account: PreviewAccount) => void }) {
  return <button type="button" data-preview-account={account.id} onClick={() => onOpen(account)} className={styles.accountRow}>
    <span className={styles.bankMark}><BankMark account={account} /></span>
    <span className={styles.identity}><strong>{account.bank}</strong><span>{account.name}</span></span>
    <span className={styles.rowFigure}><span className={styles.rowReading}><Signal account={account} /><strong><Money pence={account.available} /></strong></span><span className={styles.availableLabel}>Available</span></span>
    <ChevronRight size={14} className={styles.muted} aria-hidden="true" />
    <span className="sr-only">{account.reading === "covered" ? "A suggested move would cover payments. " : account.reading === "source" ? "Includes a suggested move out. " : account.reading === "plans" ? "Short for plans. " : account.reading === "risk" ? "Short for payments. " : account.reading === "unknown" ? "Balance needs checking. " : "Payments and plans fit. "}Open account working.</span>
  </button>;
}
export function FineAccounts({ accounts, onOpen }: { accounts: PreviewAccount[]; onOpen: (account: PreviewAccount) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!accounts.length) return null;
  return <div className={styles.fineGroup}><button type="button" data-fine-fold aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={styles.fineToggle}><span>{accounts.length === 1 ? "1 account is fine" : `${accounts.length} accounts are fine`}</span><ChevronDown size={16} aria-hidden="true" className={open ? styles.rotated : undefined} /></button><div id={id} hidden={!open}>{accounts.map(account => <AccountRow key={account.id} account={account} onOpen={onOpen} />)}</div></div>;
}
export function Verdict({ account }: { account: PreviewAccount }) {
  const gap = afterPlans(account);
  return <div data-verdict className={styles.verdict}>{account.signal && <span className={styles.verdictSignal}><Signal account={account} /></span>}<div>
    <p className={styles.verdictTitle}>{account.reading === "source" ? "A move to NatWest is suggested" : account.reading === "covered" ? "A suggested move would cover payments" : account.reading === "plans" ? "Payments fit. Plans need more." : account.reading === "risk" ? "Payments need more money" : account.reading === "unknown" ? "Balance needs checking" : "Payments and plans fit"}</p>
    <p className={styles.note}>{account.reading === "source" ? <>Spend from allows for <Money pence={27500} /> to NatWest and your set-aside. Nothing has been moved.</> : account.reading === "covered" ? <>Without the <Money pence={27500} /> suggestion from Barclays, payments would be <Money pence={27500} /> short. Nothing has been moved.</> : account.reading === "plans" ? <>You still need <Money pence={Math.abs(gap ?? 0)} exact /> for the plans below. You can add money or adjust a plan.</> : account.reading === "risk" ? <><Money pence={Math.abs(afterPayments(account) ?? 0)} exact /> is needed for payments. The first shortfall is on 6 Nov.</> : account.reading === "unknown" ? "Payments are listed, but availability cannot be confirmed without a balance." : "Available is this account’s share of your Left to spend, rather than its bank balance."}</p>
  </div></div>;
}
export function Figures({ account, paired = false }: { account: PreviewAccount; paired?: boolean }) {
  return <div className={paired ? styles.pairedFigures : styles.resultFigures}><div className={styles.spendFigure}><p className={styles.metricLabel}>Spend from</p><p data-spend-figure className={styles.primaryAmount}><Money pence={account.available} /></p></div><div data-after-payments className={styles.afterPayments}><p className={styles.metricLabel}>After payments</p><p className={styles.secondaryAmount}><Money pence={afterPayments(account)} /></p><p className={styles.note}>Before plans and suggested moves</p></div></div>;
}
function LedgerLine({ label, pence, total = false, suggestion = false, plus = false }: { label: string; pence: number | null; total?: boolean; suggestion?: boolean; plus?: boolean }) {
  return <div className={`${styles.ledgerLine} ${total ? styles.ledgerTotal : ""} ${suggestion ? styles.ledgerSuggestion : ""}`}><dt>{label}{suggestion && <span className={styles.suggestionLabel}>Suggested</span>}</dt><dd><Money pence={pence} exact plus={plus} /></dd></div>;
}
export function Working({ account }: { account: PreviewAccount }) {
  const incoming = account.events.filter(e => !e.suggested && e.pence > 0).reduce((sum, e) => sum + e.pence, 0);
  const outgoing = account.events.filter(e => !e.suggested && e.pence < 0).reduce((sum, e) => sum + e.pence, 0);
  const moves = account.events.filter(e => e.suggested);
  return <details data-working className={styles.working}><summary>How this adds up<ChevronDown size={16} aria-hidden="true" /></summary><dl className={styles.ledger}>
    <LedgerLine label="Cash now" pence={account.opening} />{incoming > 0 && <LedgerLine label="Expected income" pence={incoming} plus />}<LedgerLine label="Payments to come" pence={outgoing} /><LedgerLine label="After payments" pence={afterPayments(account)} total />
    {account.plans.length > 0 && <><LedgerLine label="Still to set aside" pence={-account.plans.reduce((sum, p) => sum + p.pence, 0)} /><LedgerLine label="After payments and plans" pence={afterPlans(account)} total /></>}
    {moves.map(move => <LedgerLine key={move.id} label={move.name} pence={move.pence} plus suggestion />)}{moves.length > 0 && <LedgerLine label="If you make the suggested move" pence={afterSuggestedMoves(account)} total />}
  </dl>{moves.length > 0 && <p className={styles.note}>The suggested move is shown separately from expected payments. It has not happened.</p>}<div className={styles.shareLine}><span>Available share of Left to spend</span><strong><Money pence={account.available} exact /></strong></div><p className={styles.note}>Your accounts share one Left to spend total. Available also allows for linked plans, timing and suggested moves.</p></details>;
}
export function PlanList({ account }: { account: PreviewAccount }) {
  const id = useId();
  if (!account.plans.length) return null;
  return <section aria-labelledby={id} className={styles.detailSection}><h3 id={id}>Still to set aside</h3><ul className={styles.planList}>{account.plans.map(plan => <li key={plan.name}><Wallet size={18} aria-hidden="true" className={styles.muted} /><span>{plan.name}<small>This period · from {account.bank}</small></span><strong><Money pence={plan.pence} exact /></strong></li>)}</ul></section>;
}
export function Events({ account, timeline = false }: { account: PreviewAccount; timeline?: boolean }) {
  const id = useId();
  const hasSuggestions = account.events.some(e => e.suggested);
  return <section aria-labelledby={id} className={styles.detailSection}><h3 id={id}>Payments &amp; income</h3>{hasSuggestions && <p className={styles.note}>Suggested moves are for you to make. They are not scheduled payments.</p>}<ul className={`${styles.events} ${timeline ? styles.timeline : ""}`}>{account.events.map(event => {
    const Icon = event.suggested ? ArrowLeftRight : event.pence > 0 ? ArrowDownLeft : ReceiptText;
    return <li key={event.id} data-event={event.id} data-suggested={event.suggested || undefined} className={event.suggested ? styles.suggestedEvent : undefined}>{timeline && <time dateTime={event.date}>{dateText(event.date)}</time>}<span className={styles.eventIcon}><Icon size={17} aria-hidden="true" /></span><span className={styles.eventIdentity}><strong>{event.name}</strong><small>{!timeline && <time dateTime={event.date}>{dateText(event.date)}{event.suggested ? " · " : ""}</time>}{event.suggested && <span className={styles.suggestionLabel}>Suggested</span>}</small></span><span className={styles.eventAmount}><Money pence={event.pence} exact={!event.suggested} plus /></span></li>;
  })}</ul></section>;
}
