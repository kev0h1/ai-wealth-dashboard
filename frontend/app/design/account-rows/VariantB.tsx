"use client";

// Variant B — "Disciplined card row". Credit rows keep a treatment distinct
// from plain accounts (they still carry a terms chip, accounts never do),
// but the raggedness is gone: one right column, amount over exactly one
// chip, same 60px row height as every other row. Red is earned, not given —
// it marks the two cards genuinely accruing interest right now (no active
// 0% cover), not every card with a negative balance.

import { RowFixture, readTerms } from "./fixtures";
import { RowBadge, bankLabel, amountText } from "./shared";

export function CreditRowB({ row, onTermsClick, onAddApr }: { row: RowFixture; onTermsClick?: () => void; onAddApr?: () => void }) {
  const terms = readTerms(row);
  const negative = row.balance < 0;

  return (
    <div className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5">
      <RowBadge row={row} />
      <div className="flex-1 min-w-0">
        <span className="min-w-0 truncate block text-[15px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
        <p className="text-[12.5px] mt-0.5 text-slate-500 dark:text-slate-400 truncate">{bankLabel(row)} · Credit card</p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {/* Red is earned: only the two cards with no active 0% cover (a real
            rate biting today) render rose. Every 0%-covered balance,
            however large, stays ink — it's a parked position, not a cost. */}
        <p
          className={`text-[16px] font-semibold money ${
            terms.accruingInterest ? "text-rose-600 dark:text-rose-400" : negative ? "text-slate-900 dark:text-slate-100" : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {amountText(row.balance)}
        </p>

        {/* Exactly one chip. Never a second stacked caption underneath. */}
        {terms.label ? (
          <button
            type="button"
            onClick={onTermsClick}
            className={`min-h-[22px] flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full num active:opacity-70 transition-opacity ${
              terms.expiringSoon
                ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                : "bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400"
            }`}
          >
            {terms.label}
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddApr}
            className="min-h-[22px] flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/25 text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
          >
            Add APR ›
          </button>
        )}
      </div>
    </div>
  );
}

export const VARIANT_B_NOTE = {
  title: "B · Disciplined card row",
  redDoctrine:
    "Red marks a genuinely accruing cost, nothing else: the two Amex cards (24.9% and 29.1%, no active 0% cover) render rose because interest is actually adding up on them today. The five cards riding a 0% deal, NatWest’s £6,160 and £7,139 included, render ink, they’re a parked position until the deal ends. The chip carries its own signal separately: amber only for Chase’s promo ending 30 Sept, slate for every other confirmed rate (including the two rose balances, whose chip states the fact in plain slate rather than doubling the colour).",
  addApr:
    "“Add APR ›” replaces the terms chip one-for-one on the Halifax Clarity row, same slot, same size, so the row never grows a second line for it.",
};
