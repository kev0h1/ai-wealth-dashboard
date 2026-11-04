"use client";
import { Info, TriangleAlert } from "lucide-react";
import { MaskedAmount, useBalancesHidden } from "@/lib/balancesHidden";
import { accountSummaryMoney } from "@/lib/upcomingAccountPresentation";
import type { AccountStatus } from "@/lib/upcomingAccountStatus";
import styles from "./UpcomingAccounts.module.css";

export function AccountMoney({ pence, exact = false, positive = false }: { pence: number | null; exact?: boolean; positive?: boolean }) {
  const hidden = useBalancesHidden();
  if (pence === null || !Number.isFinite(pence)) return <span className={styles.unavailable}>Not yet known</span>;
  const prefix = pence < 0 ? "−" : positive && pence > 0 ? "+" : "";
  if (hidden) return <MaskedAmount text={`${prefix}£••••`} />;
  const text = exact ? `${prefix}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${positive && pence > 0 ? "+" : ""}${accountSummaryMoney(pence)}`;
  return <span className="money">{text}</span>;
}

export function AccountSignal({ signal }: { signal: AccountStatus["signal"] }) {
  const Icon = signal === "risk" ? TriangleAlert : Info;
  return <span data-status-signal={signal ?? "none"} aria-hidden="true" className={signal ? `${styles.signal} ${signal === "risk" ? styles.risk : signal === "unknown" ? styles.muted : styles.watch}` : styles.emptySignal}>{signal && <Icon size={14} strokeWidth={2} />}</span>;
}
