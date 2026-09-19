import type { CompanionItem } from "@/lib/api";
import {
  CardShell,
  Currency,
  DestinationRow,
  PaydaySplitLine,
  PaydaySplitRiskLine,
  PreviewHeading,
  RoundingNote,
  SettledGroup,
  TrimmedNotice,
} from "./shared";

/**
 * Variant A, keep the shape, fix the grammar. The hero stays one figure:
 * total moving between the user's own accounts. Every row underneath
 * answers three questions (needs, has, moving) instead of leaving the
 * reader to subtract. The payday-bills line is relabelled with different
 * nouns and states plainly it's not part of the hero total. Settled
 * accounts get an amount, not bare names.
 */
export default function VariantA({ item }: { item: CompanionItem }) {
  const dests = item.dests ?? [];
  const isSet = dests.length === 0;
  const destsWithMove = dests.filter((d) => d.move > 0).sort((a, b) => b.move - a.move);
  const destsSettled = dests.filter((d) => d.move === 0 && d.usual != null);
  const nonTopUpMoving = destsWithMove.filter((d) => d.target > 0);

  return (
    <section aria-label="Variant A, grammar fix">
      <PreviewHeading
        title="A · Grammar fix"
        copy="Same card shape Kevin already knows. Every figure now states what question it answers, and the payday-bills line is named differently from the moving total so the two datasets can no longer be read as one sum."
      />
      <CardShell title="Your payday plan">
        {item.salary && !isSet && (
          <p className="mb-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">Here&rsquo;s one way to split your next pay.</p>
        )}

        {(item.total ?? 0) > 0 && (
          <div className="mb-1 flex items-end justify-between gap-3">
            <div>
              <Currency value={item.total ?? 0} className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100" />
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Moving to {destsWithMove.length} of your own {destsWithMove.length === 1 ? "account" : "accounts"}
              </p>
            </div>
            {item.salary && (
              <p className="pb-1 text-right text-[12px] leading-4 text-slate-500 dark:text-slate-400">
                <Currency value={item.salary.amount} prefix="~" />
                <br />
                expected pay
              </p>
            )}
          </div>
        )}

        {(item.total ?? 0) > 0 && item.payday_split && (
          <p className="mb-3 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            This figure does not include the payday-day bills further down the card.
          </p>
        )}

        {isSet && item.salary && (
          <p className="mb-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Every account is already set.</strong>{" "}
            Nothing needs to move this period. <Currency value={item.salary.stays} /> stays in {item.salary.name}.
          </p>
        )}

        {item.trimmed && (
          <div className="mb-3">
            <TrimmedNotice />
          </div>
        )}

        {item.payday_split && (item.total ?? 0) > 0 && (
          <div className="mb-3 space-y-1.5 rounded-xl bg-slate-50/70 px-3 py-2.5 dark:bg-slate-900/30">
            <PaydaySplitLine split={item.payday_split} movingTotal={item.total ?? 0} />
            {item.payday_split_risk && <PaydaySplitRiskLine risk={item.payday_split_risk} />}
          </div>
        )}

        {!isSet && destsWithMove.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {destsWithMove.map((dest) => (
              <DestinationRow key={dest.account_id} dest={dest} showBreakdown={false} />
            ))}
          </div>
        )}

        <SettledGroup dests={destsSettled} />

        {item.salary && item.salary.stays > 0 && !isSet && (
          <p className="mt-3 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            <Currency value={item.salary.stays} /> stays with you in {item.salary.name}.
          </p>
        )}

        {nonTopUpMoving.length > 0 && (
          <div className="mt-3">
            <RoundingNote />
          </div>
        )}
      </CardShell>
    </section>
  );
}
