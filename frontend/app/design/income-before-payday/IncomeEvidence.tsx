"use client";

import { useId } from "react";
import MoneyText from "@/components/MoneyText";
import { INCOME_HELP, incomingMoney, shortDate, type IncomeSeries, type PreviewState } from "./fixtures";
import styles from "./preview.module.css";

export default function IncomeEvidence({ series, total, hidden, state, payday = false, onTransactions, onRetry }: {
  series: IncomeSeries[];
  total: number;
  hidden: boolean;
  state: PreviewState;
  payday?: boolean;
  onTransactions: (series: IncomeSeries[]) => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const reconciles = series.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) === Math.round(total * 100);
  const unavailable = state === "partial" || !reconciles;

  return <div className={styles.evidence} aria-labelledby={titleId}>
    <p id={titleId} className={styles.explanation}>{payday
      ? "This is the income series Sorted is using for Expected pay. Check its history if it does not look like your pay."
      : INCOME_HELP}</p>
    {state === "syncing" && <p className={styles.context}>Last known income while your bank data updates.</p>}
    {state === "loading" ? <div role="status" className={styles.unavailable}>
      <p>Loading source history…</p>
      <div className={styles.skeleton} aria-hidden="true" /><div className={styles.skeleton} aria-hidden="true" />
    </div> : state === "error" ? <div className={styles.unavailable}>
      <p role="status">We could not load the income history. Your last estimate is still shown.</p>
      <button type="button" className={styles.link} onClick={onRetry}>Try again</button>
    </div> : unavailable ? <div className={styles.unavailable}>
      <p>The total is in this snapshot, but its source history is not available. Refresh the estimate to see what is counted.</p>
      <button type="button" className={styles.link} onClick={onRetry}>Refresh estimate</button>
    </div> : series.length === 0 ? <p className={styles.context}>{payday
      ? "No expected pay has been identified. Your pay period still ends on 1 Dec."
      : "No predicted income is counted before payday in this estimate."}</p> : <>
      <p className={styles.context}>{payday ? "Due on payday, 1 Dec. This is separate from income before payday." : `${series.length} expected ${series.length === 1 ? "payment" : "payments"} before 1 Dec. Already included in the estimate above.`}</p>
      <ul className={styles.incomeList}>
        {[...series].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).map(item => <li key={item.id} className={styles.incomeItem}>
          <div className={styles.incomeHeading}><p>{item.payer}</p><p className={styles.amount}><MoneyText text={incomingMoney(item.amount, hidden)} /></p></div>
          <p className={styles.due}>Expected {shortDate(item.expectedDate)} <span>· estimated</span></p>
          <p className={styles.account}>{item.accountName}</p>
          <p className={styles.basis}>Seen {item.cadence} · {item.history.length} credits · last on {shortDate(item.lastSeen)}</p>
          {item.payBasis && <p className={styles.payBasis}>{item.payBasis}</p>}
          <button type="button" className={styles.link} aria-label={`See these in transactions for ${item.payer}`} onClick={() => onTransactions([item])}>See these in transactions</button>
        </li>)}
      </ul>
      {series.length > 1 && <button type="button" className={styles.allTransactions} onClick={() => onTransactions(series)}>See these in transactions<span className={styles.buttonCaption}>All {series.reduce((n, item) => n + item.history.length, 0)} historical credits</span></button>}
    </>}
  </div>;
}
