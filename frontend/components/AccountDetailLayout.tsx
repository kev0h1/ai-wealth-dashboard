"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import styles from "./AccountDetailLayout.module.css";

/** G407 C: one bounded account summary and one continuous activity surface. */
export default function AccountDetailLayout({
  account,
  accountName,
  providerLabel,
  balance,
  status,
  forecast,
  activity,
  onDetails,
}: {
  account: Account;
  accountName: string;
  providerLabel: string;
  balance: ReactNode;
  status?: ReactNode;
  forecast?: ReactNode;
  activity: ReactNode;
  onDetails: () => void;
}) {
  return (
    <div className={styles.layout} data-g407-variant="c">
      <div className={styles.accountColumn}>
        <section className={styles.accountCard} data-account-facts aria-label={`${accountName} account summary`}>
          <div className={styles.identity}>
            <BankIcon identity={account} size={36} altText="" />
            <div className={styles.name}>
              <h1 data-account-detail-heading tabIndex={-1} className={styles.provider}>{providerLabel}</h1>
              <p className={styles.accountName}>{accountName}</p>
            </div>
            <button type="button" aria-label="Account details" onClick={onDetails} className={styles.details}>
              Details <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          {status}
          <dl className={styles.balance}>
            <dt>Bank balance</dt>
            <dd>{balance}</dd>
          </dl>
          {forecast ? <div className={styles.forecast}>{forecast}</div> : null}
        </section>
      </div>
      {activity}
    </div>
  );
}
