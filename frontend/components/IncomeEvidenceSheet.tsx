"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { INCOME_EVIDENCE_HELP, isReconciledIncomeEvidence, isSafeIncomeTransactionsHref, type IncomeEvidenceGroup, type IncomeEvidenceItem } from "@/lib/incomeEvidence";
import styles from "./SafeToSpendDisclosures.module.css";

type IncomeEvidenceKind = "before_payday" | "expected_pay";
function shortDate(value: string | null): string | null { if (!value) return null; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function historyLine(item: IncomeEvidenceItem): string { const last = shortDate(item.last_received); if (item.confirmed && item.occurrences === 0) return `Schedule: ${item.cadence ?? "regular"}. No matching historical credits yet.`; const parts: string[] = []; if (item.cadence) parts.push(item.cadence); if (item.occurrences != null) parts.push(`${item.occurrences} ${item.occurrences === 1 ? "credit" : "credits"}`); if (last) parts.push(`last received ${last}`); return parts.length ? `History: ${parts.join(" · ")}.` : "History details are not available."; }

export function IncomeEvidenceSheetBody({ group, scalar, kind, formatIncome, syncing = false, freshnessLabel, onRetry, onOpenTransactions }: { group?: IncomeEvidenceGroup; scalar: number; kind: IncomeEvidenceKind; formatIncome: (value: number) => string; syncing?: boolean; freshnessLabel?: string | null; onRetry?: () => void; onOpenTransactions?: (href: string) => void; }) {
  const reconciled = isReconciledIncomeEvidence(group, scalar); const payday = kind === "expected_pay";
  const openTransactions = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!onOpenTransactions || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenTransactions(href);
  };
  const qualifier = <>{syncing && <p className={styles.evidenceContext}>Using last known income while your bank data updates.</p>}{freshnessLabel && <p className={styles.evidenceContext}>{freshnessLabel}</p>}</>;
  if (!reconciled) return <div className={styles.incomeEvidence}><p className={styles.evidenceHelp}>Source history is unavailable for this estimate. Refresh the estimate to see what is counted.</p>{qualifier}{onRetry && <button type="button" className={styles.evidenceLink} onClick={onRetry}>Refresh estimate</button>}</div>;
  if (group.items.length === 0) return <div className={styles.incomeEvidence}><p className={styles.evidenceHelp}>{payday ? "No expected pay has been identified. Your pay period still ends on payday." : "No predicted income is counted before payday in this estimate."}</p>{qualifier}</div>;
  return <div className={styles.incomeEvidence}>
    <p className={styles.evidenceHelp}>{INCOME_EVIDENCE_HELP}</p><p className={styles.evidenceContext}>{payday ? "These payments are expected on payday and are separate from income before payday." : `${group.items.length} expected ${group.items.length === 1 ? "payment" : "payments"} before payday.`}</p>{qualifier}
    <ul className={styles.incomeList}>{[...group.items].sort((a, b) => a.expected_date.localeCompare(b.expected_date)).map(item => { const date = shortDate(item.expected_date); const account = item.account_bank && item.account_name ? `${item.account_bank} · ${item.account_name}` : item.account_name || item.account_bank || "Connected account"; const href = isSafeIncomeTransactionsHref(item.transactions_href, item.transactions_scope) ? item.transactions_href : null; const period = item.transactions_scope === "income_period"; return <li key={`${item.key}:${item.expected_date}`} className={styles.incomeItem}><div className={styles.incomeHeading}><p>{item.payer}</p><p><MoneyText text={formatIncome(item.amount)} /></p></div><p className={styles.incomeMeta}>{date ? `Expected ${date}` : "Expected date unavailable"}{item.confirmed ? " · confirmed income" : " · estimated"}</p><p className={styles.incomeMeta}>{account}</p><p className={styles.incomeMeta}>{historyLine(item)}</p><p className={styles.incomeBasis}>{item.basis}</p>{period && <p className={styles.evidenceContext}>This opens all Income-category credits for this period.</p>}{href && <a href={href} className={styles.evidenceLink} aria-label={`See these in transactions for ${item.payer}`} onClick={event => openTransactions(event, href)}>See these in transactions</a>}</li>; })}</ul>
    {group.transactions_scope === "sources" && isSafeIncomeTransactionsHref(group.transactions_href, group.transactions_scope) && <a href={group.transactions_href} className={styles.evidenceButton} onClick={event => openTransactions(event, group.transactions_href!)}>See these in transactions</a>}
    {group.transactions_scope === "income_period" && isSafeIncomeTransactionsHref(group.transactions_href, group.transactions_scope) && <><p className={styles.evidenceContext}>This opens all Income-category credits for this period.</p><a href={group.transactions_href} className={styles.evidenceButton} onClick={event => openTransactions(event, group.transactions_href!)}>See these in transactions</a></>}
  </div>;
}

export default function IncomeEvidenceSheet({ open, title, paydayLabel, group, scalar, kind, formatIncome, syncing, freshnessLabel, onClose, onRetry }: { open: boolean; title: string; paydayLabel: string; group?: IncomeEvidenceGroup; scalar: number; kind: IncomeEvidenceKind; formatIncome: (value: number) => string; syncing: boolean; freshnessLabel: string | null; onClose: () => void; onRetry?: () => void; }) {
  const router = useRouter(); if (!open) return null;
  return <SheetFrame title={title} description={kind === "expected_pay" ? `Expected on ${paydayLabel}` : `Expected before ${paydayLabel}`} themeClass={styles.sheetTheme} onClose={onClose} footer={({ close }) => <button type="button" className={styles.sheetDone} onClick={close}>Back to the working</button>}>{({ closeThen }) => <><p className={styles.sheetIncomeTotal}><MoneyText text={Number.isFinite(scalar) && scalar >= 0 ? formatIncome(scalar) : "Amount unavailable"} /></p><IncomeEvidenceSheetBody group={group} scalar={scalar} kind={kind} formatIncome={formatIncome} syncing={syncing} freshnessLabel={freshnessLabel} onRetry={onRetry} onOpenTransactions={href => closeThen(() => router.push(href))} /></>}</SheetFrame>;
}
