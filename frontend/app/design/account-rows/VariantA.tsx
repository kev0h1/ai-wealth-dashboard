"use client";

// Variant A — "One grammar". Credit rows become byte-identical in shape to
// current/savings rows: single line, ink balance, no stacked right column.
// Terms move into the subline as plain fact text ("Amex · 24.9% APR"); the
// only colour signal left on a credit row is a leading amber dot on the one
// subline that names a promo ending soon (DESIGN.md's Figures Are Ink /
// Amber Lives In The Signifier rule, applied literally). The no-terms card
// keeps one small quiet "Add APR ›" chip, the sole trailing chip left in
// this variant.

import { RowFixture, readTerms } from "./fixtures";
import { RowBadge, bankLabel, amountText } from "./shared";

function AmberDot() {
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 mr-1 align-middle" aria-hidden="true" />;
}

export function CreditRowA({ row, onAddApr }: { row: RowFixture; onAddApr?: () => void }) {
  const terms = readTerms(row);
  const negative = row.balance < 0;
  const caption = negative ? "owed" : row.balance > 0 ? "in credit" : null;

  return (
    <div className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5">
      <RowBadge row={row} />
      <div className="flex-1 min-w-0">
        <span className="min-w-0 truncate block text-[15px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
        <p className="text-[12.5px] mt-0.5 text-slate-500 dark:text-slate-400 truncate">
          {bankLabel(row)}
          {terms.label ? (
            <>
              {" · "}
              {terms.expiringSoon && <AmberDot />}
              {terms.label}
            </>
          ) : (
            <> · Credit card</>
          )}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        {/* Ink always — a card balance is a position, not intrinsically a
            risk; the minus sign alone (plus the "owed" caption) carries the
            direction. No red on this row in Variant A, full stop. */}
        <p className="text-[16px] font-semibold money text-slate-900 dark:text-slate-100">{amountText(row.balance)}</p>
        {caption ? (
          <p className="text-[10px] text-slate-400 dark:text-slate-500">{caption}</p>
        ) : !row.terms ? (
          <button
            type="button"
            onClick={onAddApr}
            className="mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/25 text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
          >
            Add APR ›
          </button>
        ) : null}
      </div>
    </div>
  );
}

export const VARIANT_A_NOTE = {
  title: "A · One grammar",
  redDoctrine:
    "No red anywhere on a credit row. A card balance is a position, not a risk in itself, so it renders exactly like a current-account balance: ink, with the minus sign and an “owed” caption doing the work the colour used to do. The only warmth left is a single leading amber dot on the one card whose 0% cover ends within 60 days (Chase, 30 Sept), placed in the subline per DESIGN.md’s “Amber Lives In The Signifier” rule rather than on the figure.",
  addApr:
    "“Add APR ›” is a small pill in the row’s right column, in the same slot the “owed” caption would sit — it only appears on the Halifax Clarity row, which has no confirmed terms.",
};
