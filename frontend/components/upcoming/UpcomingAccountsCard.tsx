"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { displayAccountName } from "@/lib/accountName";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { FINE_FOLD_KEY } from "@/lib/upcomingAccountStatus";
import { accountActionNote, accountActionReading, accountSummaryMoney } from "@/lib/upcomingAccountPresentation";
import { AccountMoney, AccountSignal } from "./accountPresentation";
import MoneyText from "@/components/MoneyText";
import styles from "./UpcomingAccounts.module.css";

export interface UpcomingAccountsCardProps {
  accounts: UpcomingAccountSummary[];
  periodLabel: string;
  onOpen: (account: UpcomingAccountSummary) => void;
  plans?: Plan[];
  plansStatus?: "loading" | "error" | "ready";
  onRetry?: () => void;
}

type Reading = ReturnType<typeof accountActionReading>;
function AccountRow({ account, reading, onOpen }: { account: UpcomingAccountSummary; reading: Reading; onOpen: (account: UpcomingAccountSummary) => void }) {
  const hidden = useBalancesHidden();
  const { headline, signal, caption, gap, paymentGap, transferGap, earlierGap } = reading;
  const meta = BANK_META[bankKey({ provider: account.bank })];
  const note = accountActionNote(account, reading);
  const detail = gap > 0 ? earlierGap ? "short before payday" : paymentGap > 0 ? "short for payments" : transferGap > 0 ? "short for transfers" : "short for plans" : caption.toLowerCase();
  const label = `Open ${account.bank}, ${displayAccountName(account.name)}: ${headline === null ? "Not yet known" : accountSummaryMoney(headline)}, ${detail}. ${note}${reading.result.estimated ? " Estimated paying account." : ""}`;
  return <button type="button" data-account-row={account.id} onClick={() => onOpen(account)} aria-label={maskMoneyText(label, hidden)} className={styles.accountRow}>
    <span data-bank-badge><BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2).toUpperCase()} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={32} /></span>
    <span className={styles.identity}><strong>{account.bank}</strong><span>{displayAccountName(account.name)}</span></span>
    <span className={styles.rowFigure}><strong data-status-amount><AccountMoney pence={headline} /></strong><span data-status-caption className={styles.rowCaption}><AccountSignal signal={signal} />{caption}</span></span>
    <ChevronRight size={14} className={styles.muted} aria-hidden="true" />
    {(signal || reading.result.estimated) && <span className={styles.rowNote}><MoneyText text={maskMoneyText(note, hidden)} /></span>}
  </button>;
}

/** Approved G417 A. Show the gap before any suggested move. */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId(), regionId = useId();
  const [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  useEffect(() => { try { if (sessionStorage.getItem(FINE_FOLD_KEY) === "1") setOpen(true); } catch {} }, []);
  const toggle = () => {
    const next = !open; setAnimate(true); setOpen(next);
    try { if (next) sessionStorage.setItem(FINE_FOLD_KEY, "1"); else sessionStorage.removeItem(FINE_FOLD_KEY); } catch {}
  };
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map(account => ({ account, reading: accountActionReading(account, plans, plansStatus) }));
    return {
      attention: rows.filter(row => row.reading.signal !== null).sort((a, b) => Number(b.reading.signal === "risk") - Number(a.reading.signal === "risk")),
      fine: rows.filter(row => row.reading.signal === null),
    };
  }, [accounts, plans, plansStatus]);
  const allClear = accounts.length > 0 && attention.length === 0;
  const foldLabel = `${fine.length} ${fine.length === 1 ? "account is" : "accounts are"} fine${plansStatus === "ready" ? "" : " for payments"}`;
  const pending = plansStatus !== "ready" && <div className={styles.pending} role="status">{plansStatus === "loading" ? "Checking goals and set-asides. Figures show payments only." : "Goals and set-asides could not be checked. Figures show payments only."}{plansStatus === "error" && onRetry && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}</div>;
  // G420: nothing to list means no heading and no empty card, unless a loading or error state applies.
  if (accounts.length === 0) return plansStatus === "ready" ? null : <section data-account-status-card="b" className={styles.card}>{pending}</section>;
  return <section aria-labelledby={headingId} data-account-status-card="b" data-g417-variant="a" className={styles.card}>
    <div className={styles.listHeading}><h2 id={headingId}>By account</h2><p className={styles.period}>{periodLabel}</p></div>
    {<>
      {allClear && <p data-all-clear className={styles.allClear}><Check size={16} aria-hidden="true" />{plansStatus === "ready" ? "Every account covers its payments and linked plans." : "Every account covers its payments. Plans are still to be checked."}</p>}
      {attention.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}
      {fine.length > 0 && <div data-fine-group className={styles.fineGroup}>
        <button type="button" data-fine-fold aria-expanded={open} aria-controls={regionId} onClick={toggle} className={styles.fineToggle}><span>{foldLabel}</span><ChevronDown size={16} aria-hidden="true" className={`${open ? styles.rotated : ""} ${animate ? "transition-transform motion-reduce:transition-none" : ""}`} /></button>
        <div id={regionId} data-fine-region inert={!open} className={`grid ${animate ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}</div></div></div>
      </div>}
    </>}
    {pending}
    {<p className={styles.listNote}>{attention.some(row => row.reading.moves.length > 0) ? "Suggested moves are for you to make. Nothing has been moved." : "Tap an account for its working."}</p>}
  </section>;
}
