"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { AccountMoney, AccountSignal } from "@/components/upcoming/accountPresentation";
import { displayAccountName } from "@/lib/accountName";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { accountActionReading, accountSummaryMoney } from "@/lib/upcomingAccountPresentation";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { accountMoveSummary } from "./summary";
import styles from "./preview.module.css";

type Reading = ReturnType<typeof accountActionReading>;
type Status = "ready" | "loading" | "error";
function AccountRow({ account, reading, variant, onOpen }: { account: UpcomingAccountSummary; reading: Reading; variant: "a" | "b"; onOpen: (account: UpcomingAccountSummary) => void }) {
  const hidden = useBalancesHidden();
  const { headline, signal, caption, gap, paymentGap, transferGap, earlierGap } = reading;
  const meta = BANK_META[bankKey({ provider: account.bank })];
  const summary = signal || reading.result.estimated ? accountMoveSummary(account, reading) : null;
  const detail = gap > 0 ? earlierGap ? "short before payday" : paymentGap > 0 ? "short for payments" : transferGap > 0 ? "short for transfers" : "short for plans" : caption.toLowerCase();
  const label = `Open ${account.bank}, ${displayAccountName(account.name)}: ${headline === null ? "Not yet known" : accountSummaryMoney(headline)}, ${detail}.${summary ? ` ${summary}` : ""}`;
  return <button type="button" data-account-row={account.id} className={styles.accountRow} aria-label={maskMoneyText(label, hidden)} onClick={() => onOpen(account)}>
    <span data-bank-badge className={styles.bankMark}><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
    <span className={styles.identity}><strong>{account.bank}</strong><span>{displayAccountName(account.name)}</span></span>
    <span className={styles.rowFigure}><strong data-status-amount><AccountMoney pence={headline} /></strong><span data-status-caption className={styles.rowCaption}><AccountSignal signal={signal} />{caption}</span></span>
    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
    {summary && <span data-account-summary className={`${styles.rowSummary} ${variant === "b" ? styles.fullSummary : ""}`}><MoneyText text={maskMoneyText(summary, hidden)} /></span>}
  </button>;
}

/** Design proposals only; retain the production card's persistence/animation when folded in. */
export default function AccountSummaryPreview({ accounts, plans, plansStatus, periodLabel, variant, onOpen, onRetry }: {
  accounts: UpcomingAccountSummary[]; plans: Plan[]; plansStatus: Status; periodLabel: string; variant: "a" | "b";
  onOpen: (account: UpcomingAccountSummary) => void; onRetry: () => void;
}) {
  const headingId = useId(), regionId = useId();
  const [open, setOpen] = useState(false);
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map(account => ({ account, reading: accountActionReading(account, plans, plansStatus) }));
    return { attention: rows.filter(row => row.reading.signal !== null).sort((a, b) => Number(b.reading.signal === "risk") - Number(a.reading.signal === "risk")), fine: rows.filter(row => row.reading.signal === null) };
  }, [accounts, plans, plansStatus]);
  const pending = plansStatus !== "ready" && <div className={styles.pending} role="status">{plansStatus === "loading" ? "Checking goals and set-asides. Figures show payments only." : "Goals and set-asides could not be checked. Figures show payments only."}{plansStatus === "error" && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}</div>;
  if (!accounts.length) return plansStatus === "ready" ? null : <section className={styles.card}>{pending}</section>;
  const row = ({ account, reading }: { account: UpcomingAccountSummary; reading: Reading }) => <AccountRow key={account.id} account={account} reading={reading} variant={variant} onOpen={onOpen} />;
  return <section aria-labelledby={headingId} data-account-status-card="b" data-g430-variant={variant} className={styles.card}>
    <div className={styles.listHeading}><h2 id={headingId}>By account</h2><p className={styles.period}>{periodLabel}</p></div>
    {attention.length === 0 && <p data-all-clear className={styles.allClear}><Check size={16} aria-hidden="true" />{plansStatus === "ready" ? "Every account covers its payments and linked plans." : "Every account covers its payments. Plans are still to be checked."}</p>}
    {attention.map(row)}
    {fine.length > 0 && <div data-fine-group>
      <button type="button" data-fine-fold aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(value => !value)} className={styles.fineToggle}><span>{fine.length} {fine.length === 1 ? "account is" : "accounts are"} fine{plansStatus === "ready" ? "" : " for payments"}</span><ChevronDown size={16} aria-hidden="true" className={open ? styles.rotated : ""} /></button>
      <div id={regionId} data-fine-region inert={!open} className={`grid ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(row)}</div></div></div>
    </div>}
    {pending}
    <p className={styles.listNote}>{attention.some(item => item.reading.moves.length > 0) ? "Suggested moves are for you to make. Nothing has been moved." : "Tap an account for its working."}</p>
  </section>;
}
