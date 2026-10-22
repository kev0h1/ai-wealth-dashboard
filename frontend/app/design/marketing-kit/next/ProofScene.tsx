"use client";

import { Zap } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingRow from "@/components/upcoming/UpcomingRow";
import { PROOF_ACCOUNTS, SAFE_TO_SPEND, UPCOMING_ACCOUNTS } from "../fixtures";

export type ProofKind = "safe" | "ledger" | "working" | "accounts" | "payment";

/** Capture plates render shipped components, using a frozen fictional scenario.
 * The export script opens the real calculation disclosure before capturing it.
 * No authenticated data, payment action or production presentation is changed.
 */
export default function ProofScene({ kind, theme }: { kind: ProofKind; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  return <div className={dark ? "dark" : ""} style={{ width: 422, padding: 16, background: dark ? "#0f172a" : "#f0f2f7", color: dark ? "#f1f5f9" : "#0f172a" }}>
    <div data-next-proof={kind} style={{ width: 390 }}>
      {kind === "accounts" ? <UpcomingAccountsCard accounts={[UPCOMING_ACCOUNTS[1]]} periodLabel="8–30 October" plans={[]} onOpen={() => {}} /> :
        kind === "payment" ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <UpcomingRow treatment="account-coverage" model={{ rowKey: "alex-energy", type: "bill", name: "Energy", amount: 188, expectedDate: "2026-10-18", accountLabel: "Bills account", accountBalance: 68, accountShort: true, coverage: { shortfall: 120, before: 68, after: -120 }, after: { kind: "balance", value: -120 }, categoryColour: "#64748b", CategoryIcon: Zap }} onOpen={() => {}} onDismiss={() => {}} />
        </div> : <SafeToSpendCard data={SAFE_TO_SPEND} previewBalancesVisible spendFrom={{ kind: "account", best: { accountId: PROOF_ACCOUNTS[0].id, name: "Everyday account", provider: "Monzo", headroom: 312, capped: true, account: PROOF_ACCOUNTS[0] }, alternative: null }} />}
    </div>
  </div>;
}
