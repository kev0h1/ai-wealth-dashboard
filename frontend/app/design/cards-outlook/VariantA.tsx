// TEMPORARY PREVIEW — delete after design review.
//
// Variant A "Ledger rows" — WHERE EACH CARD IS HEADED sits in the same
// account-row grammar as CardsPage.tsx's WHERE IT MOVED section: one row
// per carried card, a compact rate pill, a right column carrying the pace
// and the projected clear month, and a whisper subline only when interest
// is actually being charged.

import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import type { OutlookFixture } from "./fixtures";
import { Whisper, fmtGBP, monthLabel, leadLine, clearedMonthlyLine } from "./shared";

export default function VariantA({
  fixture,
  clearedMonthly,
}: {
  fixture: OutlookFixture;
  clearedMonthly: { accountId: string; name: string }[];
}) {
  const lead = leadLine(fixture);
  const closingLine = clearedMonthlyLine(clearedMonthly);
  const isEmpty = fixture.cards.length === 0;

  return (
    <div>
      <Whisper>WHERE EACH CARD IS HEADED</Whisper>

      {isEmpty && closingLine === null ? (
        <div className="glass-card rounded-2xl mt-3 p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No card is carrying a balance into next period.
          </p>
        </div>
      ) : (
        <>
          {lead && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-snug">
              <MoneyText text={lead} />
            </p>
          )}

          {fixture.cards.length > 0 && (
            <div className="glass-card rounded-2xl mt-3 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
              {fixture.cards.map((c) => {
                const fakeAccount = { provider: c.provider, name: c.name, type: "credit_card" } as unknown as Account;
                const brand = accountBrand(fakeAccount);
                return (
                  <div key={c.accountId} className="px-4 py-3 flex items-center gap-3">
                    <BankBadge
                      logoSrc={brand.logoSrc}
                      initials={brand.initials}
                      altText={brand.label}
                      brandBg={brand.background}
                    />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{c.name}</p>
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
          )}

          {closingLine && (
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 leading-snug">{closingLine}</p>
          )}
        </>
      )}
    </div>
  );
}
