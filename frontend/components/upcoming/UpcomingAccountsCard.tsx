"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "@/lib/phosphorIcons";
import { displayAccountName } from "@/lib/accountName";
import { tidyAccountText } from "@/lib/accountDisplay";
import { BANK_META, BankIcon, bankKey } from "@/components/AccountMiniCard";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { FINE_FOLD_KEY } from "@/lib/upcomingAccountStatus";
import { accountActionReading, rowNeedsAttention } from "@/lib/upcomingAccountPresentation";
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
  const { signal, available, availableLabel, pending } = reading;
  const headline = pending ? null : available ?? reading.headline;
  const caption = available !== null && availableLabel ? availableLabel : !reading.projection.ready ? "Payments only" : reading.caption;
  const meta = BANK_META[bankKey({ provider: account.bank })];
  const bank = meta?.label ?? tidyAccountText(account.bank);
  const status = pending ? pending === "checking" ? "Checking" : "Needs checking"
    : signal === "risk" ? "Short"
    : signal === "plan" ? "Plans need a look"
    : signal === "unknown" ? reading.result.uncertain && account.status !== "unknown" ? "Plans need checking" : "Needs checking"
    : signal === "move" && (reading.incoming > 0 || account.position?.availability?.requiresMove) ? "Move suggested" : null;
  return <button type="button" data-account-row={account.id} data-flow-focus={`account-${account.id}`} data-balanced-row={`account-${account.id}`} aria-haspopup="dialog" onClick={() => onOpen(account)} className={styles.accountRow}>
    <span data-row-content className={styles.accountRowContent}>
      <span className={styles.accountReadings}>
        <span className={styles.accountIdentityBlock}>
          <span className={styles.bankIdentity}>
            <span data-bank-badge className={styles.bankMark} aria-hidden="true"><BankIcon identity={{ provider: account.bank }} size={28} altText="" /></span>
            <span className={styles.identity}><strong><MoneyText text={bank} /></strong><span><MoneyText text={displayAccountName(account.name)} /></span></span>
          </span>
          {status && <span className={styles.rowStatusOffset}><span data-status-cue data-tone={signal} className={styles.rowStatus}><AccountSignal signal={signal} /><span>{status}</span></span></span>}
        </span>
        <span className={styles.rowFigure}>
          {pending ? <span aria-busy={pending === "checking"} data-status-amount className={styles.pendingAmount}>{pending === "checking" ? <span aria-hidden="true" className={styles.figurePlaceholder} /> : "Unavailable"}</span> : <strong data-status-amount data-available={available !== null ? "true" : undefined}><AccountMoney pence={headline} exact={headline !== null && headline % 100 !== 0} /></strong>}
          <span data-status-caption className={styles.rowCaption}><span data-status-text>{pending ? pending === "checking" ? "Figure pending" : "Availability unavailable" : caption}{!pending && reading.result.estimated ? " · estimated" : ""}</span></span>
        </span>
      </span>
      <ChevronRight size={16} className={styles.chevron} aria-hidden="true" />
    </span>
  </button>;
}

/** G489 approved E. Existing financial readings and account-sheet navigation stay authoritative. */
export default function UpcomingAccountsCard({ accounts, periodLabel, onOpen, plans = [], plansStatus = "ready", onRetry }: UpcomingAccountsCardProps) {
  const headingId = useId(), regionId = useId();
  const [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  // Restore browser-only storage after the matching server and first client render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { if (sessionStorage.getItem(FINE_FOLD_KEY) === "1") setOpen(true); } catch {} }, []);
  const toggle = () => {
    const next = !open; setAnimate(true); setOpen(next);
    try { if (next) sessionStorage.setItem(FINE_FOLD_KEY, "1"); else sessionStorage.removeItem(FINE_FOLD_KEY); } catch {}
  };
  const { attention, fine } = useMemo(() => {
    const rows = accounts.map(account => ({ account, reading: accountActionReading(account, plans, plansStatus) }));
    // E keeps a conditional incoming move visible without calling it Short.
    // Funding another account remains a cue inside the fine-account fold.
    const needsAction = (reading: Reading) => rowNeedsAttention(reading) || reading.availability?.requiresMove === true;
    return {
      attention: rows.filter(row => needsAction(row.reading)).sort((a, b) => Number(b.reading.signal === "risk") - Number(a.reading.signal === "risk")),
      fine: rows.filter(row => !needsAction(row.reading)),
    };
  }, [accounts, plans, plansStatus]);
  // G486: goals and set-asides are already inside every Available figure, so the "payments only" wording applies to fallback rows alone.
  const fallbackRows = accounts.length === 0 || accounts.some(account => !account.position?.availability);
  const finePaymentsOnly = plansStatus !== "ready" && fine.some(row => row.reading.available === null);
  const foldLabel = `${fine.length} ${fine.length === 1 ? "account is" : "accounts are"} fine${finePaymentsOnly ? " for payments" : ""}`;
  const partlyAvailable = accounts.some(account => account.position?.availability);
  const pendingNote = plansStatus !== "ready" && fallbackRows && <div className={styles.pending} role="status">{plansStatus === "loading" ? `Checking goals and set-asides. ${partlyAvailable ? "Accounts without an available amount show" : "Figures show"} payments only.` : `Goals and set-asides could not be checked. ${partlyAvailable ? "Accounts without an available amount show" : "Figures show"} payments only.`}{plansStatus === "error" && onRetry && <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>}</div>;
  // G420: nothing to list means no heading and no empty card, unless a loading or error state applies.
  if (accounts.length === 0) return plansStatus === "ready" ? null : <section data-account-status-card="b" className={styles.card}>{pendingNote}</section>;
  return <section aria-labelledby={headingId} data-tutorial-id="tutorial-planning-accounts" data-account-status-card="b" data-g417-variant="a" data-g489-variant="e" className={styles.card}>
    <div className={styles.listHeading}><h2 id={headingId}>By account</h2><p className={styles.period}>{periodLabel}</p></div>
    {<>
      {attention.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}
      {fine.length > 0 && <div data-fine-group className={styles.fineGroup}>
        <button type="button" data-fine-fold data-balanced-row="other-account-fold" aria-expanded={open} aria-controls={regionId} onClick={toggle} className={styles.fineToggle}><span data-row-content className={styles.fineToggleContent}><span>{foldLabel}</span><ChevronDown size={16} aria-hidden="true" className={`${open ? styles.rotated : ""} ${animate ? "transition-transform motion-reduce:transition-none" : ""}`} /></span></button>
        <div id={regionId} data-fine-region inert={!open} className={`grid ${animate ? "transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" : ""} ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden"><div className={styles.fineRows}>{fine.map(({ account, reading }) => <AccountRow key={account.id} account={account} reading={reading} onOpen={onOpen} />)}</div></div></div>
      </div>}
    </>}
    {pendingNote}
  </section>;
}
