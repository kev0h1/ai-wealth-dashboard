"use client";

import { ChevronRight, ShieldCheck } from "@/lib/phosphorIcons";
import type { Account, Connection } from "@/lib/api";
import AccountRefreshRow from "@/components/AccountRefreshRow";
import { canRefreshAccount, type AccountRefreshResult } from "@/lib/accountRefresh";
import { connectionEnded } from "@/lib/accountCounted";
import { formatHistoryRequested } from "@/lib/reconfirm";
import styles from "./AccountConnectionDetails.module.css";

function dateLabel(value: string | null | undefined, includeTime = false): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Europe/London" });
}

/** Only actual source timestamps count as update evidence. Missing time is unknown. */
export function AccountConnectionEvidence({ account, connection }: { account: Account; connection?: Connection }) {
  const bankTime = dateLabel(account.bank_synced_to, true);
  const syncTime = dateLabel(account.transactions_synced_at, true);
  const reconfirm = dateLabel(connection?.next_reconfirm_by);
  const expiry = dateLabel(connection?.expires_at);
  const history = formatHistoryRequested(connection?.history_requested_from);
  return <div className={styles.evidence}>
    <dl>
      <div><dt>{bankTime ? "Bank data from" : syncTime ? "Last successful sync" : "Bank data"}</dt><dd>{bankTime ?? syncTime ?? "Update time not supplied"}</dd></div>
      {connectionEnded(account) ? <div><dt>Connection</dt><dd>Ended. Reconnect to resume updates.</dd></div> : <>
        <div><dt>Next reconfirmation</dt><dd>{reconfirm ?? "Date not supplied"}</dd></div>
        {expiry && connection?.expires_at !== connection?.next_reconfirm_by ? <div><dt>Connection ends</dt><dd>{expiry}</dd></div> : null}
      </>}
    </dl>
    {history ? <p>{history}. Your bank decides how much history it can share.</p> : null}
    <p>Reconfirming lets your bank keep sharing this account’s data with Sorted. It does not make a payment.</p>
  </div>;
}

export function AccountConnectionSummary({ account, providerLabel, pending, onReconnect, onRefresh }: {
  account: Account;
  providerLabel: string;
  pending: boolean;
  onReconnect: () => void;
  onRefresh: (id: string) => Promise<AccountRefreshResult>;
}) {
  if (connectionEnded(account)) return <div className={styles.summary}>
    <h4><span className={styles.caution} aria-hidden="true" />Reconnect to update this account</h4>
    <p>Bank updates have stopped. Your last recorded details are still here.</p>
    <button type="button" className={styles.reconnect} onClick={onReconnect}>Reconnect {providerLabel}<ChevronRight size={16} aria-hidden="true" /></button>
  </div>;
  if (canRefreshAccount(account)) return <AccountRefreshRow key={account.id} account={account} onRefresh={onRefresh} compact connectionSummary pending={pending} />;
  return <div className={styles.summary}>
    <h4><ShieldCheck size={18} aria-hidden="true" />{account.paused ? "Bank updates are paused" : "Connection information unavailable"}</h4>
    <p>{account.paused ? "Your current plan is not updating this bank connection. Your recorded details are still here." : "No active bank connection is recorded for this account."}</p>
  </div>;
}
