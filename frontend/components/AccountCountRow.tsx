"use client";

// A175: the account sheet's Left to spend row. Savings never count towards
// Left to spend (the engine ignores the flag for them), so a savings account
// gets a plain line instead of a switch that would only change plan source
// detection. Everything else keeps the G231 switch, as does a savings account
// whose flag is already false (counted === false), so it can be switched back on.

import CountTowardsSafeToSpendRow, { type CountTowardsSafeToSpendRowProps } from "@/components/CountTowardsSafeToSpendRow";
import { SAVINGS_NOT_COUNTED, isSavingsAccount } from "@/lib/accountSheetNotes";

export interface AccountCountRowProps extends CountTowardsSafeToSpendRowProps {
  account: { type: string; subtype?: string | null };
}

export default function AccountCountRow({ account, ...row }: AccountCountRowProps) {
  // A savings account already switched off keeps the switch so it can be turned back on.
  if (row.counted && isSavingsAccount({ type: account.type, subtype: account.subtype ?? undefined })) {
    return (
      <p data-a175-savings-line className="px-1 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        {SAVINGS_NOT_COUNTED}
      </p>
    );
  }
  return <CountTowardsSafeToSpendRow {...row} />;
}
