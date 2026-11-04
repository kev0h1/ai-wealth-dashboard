"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { displayAccountName } from "@/lib/accountName";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { FINE_FOLD_KEY, money as moneyRaw } from "@/lib/upcomingAccountStatus";
import { accountReading, accountSummaryMoney } from "@/lib/upcomingAccountPresentation";
import { AccountMoney, AccountSignal } from "./accountPresentation";
import styles from "./UpcomingAccounts.module.css";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onRetry?: () => void;
}

type Reading = ReturnType<typeof accountReading>;
function AccountRow({ account, reading, onOpen }: { account: UpcomingAccountSummary; reading: Reading; onOpen: (account: UpcomingAccountSummary) => void }) {
  const hidden = useBalancesHidden();
  const { status, available } = reading;
  const meta = BANK_META[bankKey({ provider: account.bank })];
  const detail = status.signal ? `${status.amount === null ? "" : `${moneyRaw(status.amount)}, `}${status.label.toLowerCase()}` : "Payments and plans fit";
  const label = `Open ${account.bank}, ${displayAccountName(account.name)}: ${accountSummaryMoney(available)}, available, ${detail}${account.position?.spendFromRequiresMove ? ", available only after the suggested move" : ""}${reading.moves.some(move => move.amount < 0) ? ", includes a suggested move out" : ""}${status.estimated ? ", estimated" : ""}`;
  return <button type="button" data-account-row={account.id} onClick={() => onOpen(account)} aria-label={maskMoneyText(label, hidden)} className={styles.accountRow}>
    <span data-bank-badge><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
    <span className={styles.identity}><strong>{account.bank}</strong><span>{displayAccountName(account.name)}</span></span>
    <span className={styles.rowFigure}><span className={styles.rowReading}><AccountSignal signal={status.signal} /><strong data-status-amount><AccountMoney pence={available} /></strong></span><span data-status-caption className={styles.availableLabel}>Available</span></span>
    <ChevronRight size={14} className={styles.muted} aria-hidden="true" />
  </button>;
}

/** Approved G416 A. Account evidence never changes the pooled forecast. */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId(), regionId = useId();
  const [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  useEffect(() => { try { if (sessionStorage.getItem(FINE_FOLD_KEY) === "1") setOpen(true); } catch {} }, []);
  const toggle = () => {
    const next = !open; setAnimate(true); setOpen(next);
    try { if (next) sessionStorage.setItem(FINE_FOLD_KEY, "1"); else sessionStorage.removeItem(FINE_FOLD_KEY); } catch {}
  };
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map(account => ({ account, reading: accountReading(account, plans, plansStatus) }));
    return {
      // Genuine payment risk leads. The other caution rows retain account order,
      // matching A's compact common Available presentation.
      attention: rows.filter(row => row.reading.status.signal !== null).sort((a, b) => Number(b.reading.status.signal === "risk") - Number(a.reading.status.signal === "risk")),
      fine: rows.filter(row => row.reading.status.signal === null),
    };
  }, [accounts, plans, plansStatus]);
  const allClear = accounts.length > 0 && attention.length === 0;
  const foldLabel = `${fine.length} ${fine.length === 1 ? "account is" : "accounts are"} fine${plansStatus === "ready" ? "" : " for payments"}`;
  return <section aria-labelledby={headingId} data-account-status-card="b" data-g416-variant="a" className={styles.card}>
    <div className={styles.listHeading}><h2 id={headingId}>By account</h2><p className={styles.period}>{periodLabel}</p></div>
    {accounts.length === 0 ? <p className={styles.allClear}>No account payments are expected in this period.</p> : <>
      {allClear && <p data-all-clear className={styles.allClear}>{plansStatus === "ready" ? "Every account covers its payments and linked plans." : "Every paying account covers its payments this period."}</p>}
      {attention.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}
      {fine.length > 0 && <div data-fine-group className={styles.fineGroup}>
        <button type="button" data-fine-fold aria-expanded={open} aria-controls={regionId} onClick={toggle} className={styles.fineToggle}><span>{foldLabel}</span><ChevronDown size={16} aria-hidden="true" className={`${open ? styles.rotated : ""} ${animate ? "transition-transform motion-reduce:transition-none" : ""}`} /></button>
        <div id={regionId} data-fine-region inert={!open} className={`grid ${animate ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}</div></div></div>
      </div>}
    </>}
    {plansStatus !== "ready" && <div className={styles.pending} role="status">{plansStatus === "loading" ? "Loading goals and allocations. Figures show payments only." : "Goals and allocations could not be checked. Figures show payments only."}{plansStatus === "error" && onRetry && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}</div>}
    {accounts.length > 0 && <p className={styles.listNote}>Tap an account for its working.</p>}
  </section>;
}
