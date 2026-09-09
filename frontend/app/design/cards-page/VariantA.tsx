// TEMPORARY PREVIEW — delete after design review.
//
// Variant A "Ledger rows" — appends a sixth section, WHERE EACH CARD IS
// HEADED, below THE TRAJECTORY. Same account-row grammar as WHERE IT
// MOVED: badge, name, a compact rate pill, and a right column carrying the
// pace and the projected clear month. Cards that clear in full each cycle
// fold into one quiet closing sentence instead of a row.

import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { OUTLOOK_CARDS, CLEARED_MONTHLY, EXTRA_PER_MONTH, DEBT_FREE_MONTH, metaFor, nameFor } from "./fixtures";
import { Whisper, fmtGBP, monthLabel, leadLine, clearedMonthlyLine } from "./shared";

export default function VariantA({ namesMode }: { namesMode: "raw" | "clean" }) {
  const lead = leadLine(EXTRA_PER_MONTH, DEBT_FREE_MONTH);
  const closingLine = clearedMonthlyLine(CLEARED_MONTHLY.map((c) => nameFor(c.accountId, namesMode)));

  return (
    <div>
      <Whisper>WHERE EACH CARD IS HEADED</Whisper>

      {lead && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-snug">
          <MoneyText text={lead} />
        </p>
      )}

      <div className="glass-card rounded-2xl mt-3 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
        {OUTLOOK_CARDS.map((c) => {
          const meta = metaFor(c.accountId);
          const fakeAccount = { provider: meta.provider, name: meta.rawName, type: "credit_card" } as unknown as Account;
          const brand = accountBrand(fakeAccount);
          return (
            <div key={c.accountId} className="px-4 py-3 flex items-center gap-3">
              <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                  {nameFor(c.accountId, namesMode)}
                </p>
                <span
                  className={`inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full num ${
                    c.ratePill.amber
                      ? "bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {c.ratePill.label}
                </span>
                {c.payingInterest && c.monthlyInterestNow > 0 && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    <MoneyText text={`${fmtGBP(c.monthlyInterestNow)} interest last month`} />
                  </p>
                )}
              </div>

              <div className="text-right flex-shrink-0">
                {c.paceMonthly != null && (
                  <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                    +{fmtGBP(c.paceMonthly)}/mo
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {c.payoffMonth ? `clears ${monthLabel(c.payoffMonth)}` : "no clear date yet"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {closingLine && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">{closingLine}</p>
      )}
    </div>
  );
}
