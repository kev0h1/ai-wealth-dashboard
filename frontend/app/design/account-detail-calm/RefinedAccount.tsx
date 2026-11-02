import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { formatMoney, type Scenario } from "./fixtures";
import styles from "./refined.module.css";

/** G407 C/D: one account summary and one continuous activity surface. */
export default function RefinedAccount({ scenario, hidden, variant, onDetails, forecast, activity }: {
  scenario: Scenario; hidden: boolean; variant: "c" | "d"; onDetails: () => void;
  forecast: ReactNode; activity: ReactNode;
}) {
  return <div className={`${styles.refined} ${styles.layout}`} data-g407-refined={variant}>
    <div className={styles.accountColumn}>
      <div className={variant === "c" ? styles.accountCard : styles.openAccount}>
        <div className={styles.identity}>
          <BankIcon identity={scenario.account} size={36} altText="" />
          <div className={styles.name}><h2>Monzo</h2><p>{scenario.account.name}</p></div>
          <button type="button" aria-label="Account details" onClick={onDetails} className={styles.details}>Details<ChevronRight size={14} aria-hidden="true" /></button>
        </div>
        <dl className={variant === "c" ? styles.balance : styles.balanceRow}>
          <dt>Bank balance</dt><dd><MoneyText text={formatMoney(scenario.account.balance, hidden)} /></dd>
        </dl>
        <div className={styles.forecast}>{forecast}</div>
      </div>
    </div>
    {activity}
  </div>;
}
