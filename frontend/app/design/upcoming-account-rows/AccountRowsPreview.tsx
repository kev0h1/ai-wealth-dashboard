"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { AccountMoney, AccountSignal } from "@/components/upcoming/accountPresentation";
import { displayAccountName } from "@/lib/accountName";
import { useBalancesHidden, maskMoneyText } from "@/lib/balancesHidden";
import { accountActionReading, accountActionNote, accountMoveRows, accountSummaryMoney } from "@/lib/upcomingAccountPresentation";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import styles from "./preview.module.css";

type Reading = ReturnType<typeof accountActionReading>;
type PlansStatus = "ready" | "loading" | "error";

function BankMark({ bank, size }: { bank?: string; size: number }) {
  const meta = bank ? BANK_META[bankKey({ provider: bank })] : undefined;
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? ""} initialsSize={meta?.initialsSize} altText="" brandBg={meta?.bg} size={size} />;
}

/** Layout proposals only. Financial readings, notes and source rows are production outputs. */
function AccountRow({ account, reading, variant, sourceBanks, onOpen }: {
  account: UpcomingAccountSummary; reading: Reading; variant: "a" | "b";
  sourceBanks: Record<string, string>; onOpen: (account: UpcomingAccountSummary) => void;
}) {
  const hidden = useBalancesHidden();
  const { headline, signal, caption, gap, paymentGap, transferGap, earlierGap } = reading;
  const note = accountActionNote(account, reading);
  const moveRows = accountMoveRows(reading.moves);
  // The existing account-button name is retained verbatim, including its detail and money masking.
  const detail = gap > 0 ? earlierGap ? "short before payday" : paymentGap > 0 ? "short for payments" : transferGap > 0 ? "short for transfers" : "short for plans" : caption.toLowerCase();
  const moveText = moveRows.length ? ` Move in: ${moveRows.map(row => `${row.name} ${row.amount}`).join(", ")}.` : "";
  const label = `Open ${account.bank}, ${displayAccountName(account.name)}: ${headline === null ? "Not yet known" : accountSummaryMoney(headline)}, ${detail}. ${note}${moveText}${reading.result.estimated ? " Estimated paying account." : ""}`;
  return <button type="button" data-account-row={account.id} className={`${styles.accountRow} ${variant === "b" ? styles.readingLine : ""}`} aria-label={maskMoneyText(label, hidden)} onClick={() => onOpen(account)}>
    <span data-bank-badge className={styles.bankMark}><BankMark bank={account.bank} size={32} /></span>
    <span className={styles.identity}><strong>{account.bank}</strong><span>{displayAccountName(account.name)}</span></span>
    <span className={styles.rowFigure}>
      <strong data-status-amount><AccountMoney pence={headline} /></strong>
      <span data-status-caption className={styles.rowCaption}><AccountSignal signal={signal} />{caption}</span>
    </span>
    <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
    {(signal || reading.result.estimated) && <span className={styles.rowNote}><MoneyText text={maskMoneyText(note, hidden)} /></span>}
    {moveRows.length > 0 && <span data-move-rows className={styles.moveRows}>{moveRows.map((row, index) => {
      // Match metadata only. The canonical helper alone chooses names, source order and amounts.
      const candidates = reading.moves.filter(move => move.amount > 0 && `${move.counterpartName.charAt(0).toUpperCase()}${move.counterpartName.slice(1)}` === row.name && (move.savings === true) === (row.savings === true));
      const bank = candidates.length === 1 ? sourceBanks[candidates[0].counterpartId] : undefined;
      return <span key={`${index}-${row.name}`} className={styles.moveRow} data-source-bank={bank}>
        <span className={styles.sourceMark}><BankMark bank={bank} size={20} /></span>
        <span className={styles.sourceIdentity}><span data-source-name>{displayAccountName(row.name)}</span>{row.savings && <small data-savings-source className={`${styles.savingsMarker} text-amber-800 dark:text-amber-200`}>From savings, a suggestion</small>}</span>
        <strong className={styles.sourceAmount}><MoneyText text={maskMoneyText(row.amount, hidden)} /></strong>
      </span>;
    })}</span>}
  </button>;
}

export default function AccountRowsPreview({ accounts, periodLabel, plansStatus, variant, sourceBanks, onOpen, onRetry }: {
  accounts: UpcomingAccountSummary[]; periodLabel: string; plansStatus: PlansStatus; variant: "a" | "b";
  sourceBanks: Record<string, string>; onOpen: (account: UpcomingAccountSummary) => void; onRetry: () => void;
}) {
  const headingId = useId(), regionId = useId();
  const [open, setOpen] = useState(false);
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map(account => ({ account, reading: accountActionReading(account, [], plansStatus) }));
    return {
      attention: rows.filter(row => row.reading.signal !== null).sort((a, b) => Number(b.reading.signal === "risk") - Number(a.reading.signal === "risk")),
      fine: rows.filter(row => row.reading.signal === null),
    };
  }, [accounts, plansStatus]);
  const pending = plansStatus !== "ready" && <div className={styles.pending} role="status">{plansStatus === "loading" ? "Checking goals and set-asides. Figures show payments only." : "Goals and set-asides could not be checked. Figures show payments only."}{plansStatus === "error" && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}</div>;
  if (accounts.length === 0) return plansStatus === "ready" ? null : <section data-account-status-card="b" className={styles.card}>{pending}</section>;
  const row = ({ account, reading }: { account: UpcomingAccountSummary; reading: Reading }) => <AccountRow key={account.id} account={account} reading={reading} variant={variant} sourceBanks={sourceBanks} onOpen={onOpen} />;
  const allClear = attention.length === 0;
  return <section aria-labelledby={headingId} data-account-status-card="b" data-g429-variant={variant} className={styles.card}>
    <div className={styles.listHeading}><h2 id={headingId}>By account</h2><p className={styles.period}>{periodLabel}</p></div>
    {allClear && <p data-all-clear className={styles.allClear}><Check size={16} aria-hidden="true" />{plansStatus === "ready" ? "Every account covers its payments and linked plans." : "Every account covers its payments. Plans are still to be checked."}</p>}
    {attention.map(row)}
    {fine.length > 0 && <div data-fine-group className={styles.fineGroup}>
      <button type="button" data-fine-fold className={styles.fineToggle} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(value => !value)}><span>{fine.length} {fine.length === 1 ? "account is" : "accounts are"} fine{plansStatus === "ready" ? "" : " for payments"}</span><ChevronDown size={16} aria-hidden="true" className={open ? styles.rotated : ""} /></button>
      <div id={regionId} data-fine-region inert={!open} className={`grid ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(row)}</div></div></div>
    </div>}
    {pending}
    <p className={styles.listNote}>{attention.some(item => item.reading.moves.length > 0) ? "Suggested moves are for you to make. Nothing has been moved." : "Tap an account for its working."}</p>
  </section>;
}
