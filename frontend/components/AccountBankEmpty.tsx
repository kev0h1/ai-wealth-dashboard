// A175: empty state for a connected bank account the bank has sent no
// transactions for. Presentational; the copy and rules live in
// lib/accountSheetNotes.ts.

import { bankEmptyState } from "@/lib/accountSheetNotes";
import type { Account } from "@wealth/shared";

export default function AccountBankEmpty({ account, now }: { account: Account; now?: number }) {
  const state = bankEmptyState(account, now);
  if (!state) return <p className="text-sm text-slate-400 dark:text-slate-500">No transactions</p>;
  return (
    <div data-a175-bank-empty>
      <p className="mx-auto max-w-[28ch] text-sm text-slate-500 dark:text-slate-400 text-pretty">{state.message}</p>
      {state.updated ? <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{state.updated}</p> : null}
    </div>
  );
}
