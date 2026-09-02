"use client";

// Variant C — "Off the row". Pushes the brief's declutter instinct
// further: credit rows are not just row-height-matched to accounts, they
// are the exact same component, zero exceptions. Every rate, promo and
// warmth signal moves off individual rows entirely — up to one quiet
// caption under the Credit cards group header, and (in the live app) into
// the CardTermsSheet a tap already opens. The single carve-out the brief
// asks for by name — a per-row "Add APR ›" entry point on the one
// unconfirmed card — survives as plain text in that row's subline, because
// it's an action, not a status.

import { RowFixture, readTerms } from "./fixtures";
import { RowBadge, bankLabel, amountText } from "./shared";

export function CreditRowC({ row, onAddApr }: { row: RowFixture; onAddApr?: () => void }) {
  const hasTerms = !!row.terms;
  return (
    <div
      role={!hasTerms ? "button" : undefined}
      onClick={!hasTerms ? onAddApr : undefined}
      className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2.5"
    >
      <RowBadge row={row} />
      <div className="flex-1 min-w-0">
        <span className="min-w-0 truncate block text-[15px] font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
        <p className="text-[12.5px] mt-0.5 truncate">
          <span className="text-slate-500 dark:text-slate-400">{bankLabel(row)} · </span>
          {hasTerms ? (
            <span className="text-slate-500 dark:text-slate-400">Credit card</span>
          ) : (
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">Add APR ›</span>
          )}
        </p>
      </div>
      <div className="shrink-0">
        {/* Ink, always. No card row in this variant carries a colour
            opinion — that judgement lives one level up, at the group. */}
        <p className="text-[16px] font-semibold money text-slate-900 dark:text-slate-100">{amountText(row.balance)}</p>
      </div>
    </div>
  );
}

/** Group-level rollup caption — the one place Variant C is willing to say
 *  "something here needs you", stated once for the whole group rather than
 *  repeated per row. */
export function creditGroupCaption(rows: RowFixture[]): { amber: boolean; text: string } | null {
  const reads = rows.map(readTerms);
  const expiring = reads.filter((r) => r.expiringSoon).length;
  const accruing = reads.filter((r) => r.accruingInterest).length;
  const parts: string[] = [];
  if (expiring > 0) parts.push(`${expiring} promo${expiring > 1 ? "s" : ""} ending within 2 months`);
  if (accruing > 0) parts.push(`${accruing} on an ongoing rate`);
  if (parts.length === 0) return null;
  return { amber: expiring > 0, text: parts.join(" · ") };
}

export const VARIANT_C_NOTE = {
  title: "C · Off the row",
  redDoctrine:
    "No credit row carries any colour, not even amber, full stop, they render exactly like a current or savings row (ink figure, plain subline). The genuine-risk read (a promo ending soon, a rate genuinely accruing) is stated once, as a plain caption under the Credit cards group header, an amber dot only when a promo is within two months of ending, otherwise a neutral count. In the live app, tapping any confirmed card opens CardTermsSheet for the full picture, individual rows stay pure ledger.",
  addApr:
    "“Add APR ›” is the one thing that DOES stay on a row: unconfirmed terms are an action waiting to happen, not a status to report, so Halifax Clarity's subline reads “HALIFAX · Add APR ›” in indigo and the whole row is tappable, opening CardTermsSheet straight into that card.",
};
