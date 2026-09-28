import type { CompanionItem } from "@/lib/api";
import {
  CardShell,
  Currency,
  DestinationRow,
  PaydaySplitLine,
  PaydaySplitRiskLine,
  PreviewHeading,
  RoundingNote,
  SectionHeading,
  SettledGroup,
} from "./shared";

/**
 * Variant B, restructure into labelled blocks with subtotals. Every figure
 * belongs to a named question: money moving between accounts, payments
 * leaving the salary account on payday, or accounts already set. Row
 * composition (payments / spending / buffer) stays visible here, which
 * Variant A drops for brevity.
 */
export default function VariantB({ item }: { item: CompanionItem }) {
  const dests = item.dests ?? [];
  const isSet = dests.length === 0;
  const destsWithMove = dests.filter((d) => d.move > 0).sort((a, b) => b.move - a.move);
  const destsSettled = dests.filter((d) => d.move === 0 && d.usual != null);
  const nonTopUpMoving = destsWithMove.filter((d) => d.target > 0);

  if (isSet) {
    return (
      <section aria-label="Variant B, labelled blocks">
        <PreviewHeading title="B · Labelled blocks" copy="Same block structure as the funded state, shown here with nothing to move." />
        <CardShell title="Your payday plan">
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Every account is already set.</strong>{" "}
            Nothing needs to move this period.
          </p>
          {item.salary && (
            <p className="mt-2 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
              <Currency value={item.salary.stays} /> stays in {item.salary.name}.
            </p>
          )}
        </CardShell>
      </section>
    );
  }

  return (
    <section aria-label="Variant B, labelled blocks">
      <PreviewHeading
        title="B · Labelled blocks"
        copy="Three named blocks, each with its own subtotal, so no figure on the card can be read as adding to a figure in a different block."
      />
      <CardShell title="Your payday plan">
        <div className="space-y-4">
          {(item.total ?? 0) > 0 && (
            <div>
              <SectionHeading title="Money moving between your accounts" subtotal={item.total} />
              <p className="mb-1.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                {destsWithMove.length} {destsWithMove.length === 1 ? "account needs" : "accounts need"} money moved this period.
                {item.salary && ` Funded by your ~£${Math.round(item.salary.amount).toLocaleString("en-GB")} expected pay.`}
              </p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 px-3 dark:divide-slate-700 dark:border-slate-700">
                {destsWithMove.map((dest) => (
                  <DestinationRow key={dest.account_id} dest={dest} showBreakdown />
                ))}
              </div>
              {item.salary && (
                <p className="mt-1.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                  {item.salary.name} keeps <Currency value={item.salary.stays} className="text-slate-400 dark:text-slate-500" /> after these
                  moves.
                </p>
              )}
              {nonTopUpMoving.length > 0 && (
                <div className="mt-1.5">
                  <RoundingNote />
                </div>
              )}
            </div>
          )}

          {item.payday_split && (
            <div>
              <SectionHeading title="Payments leaving on payday" subtotal={item.payday_split.total} />
              <div className="space-y-1.5 rounded-xl bg-slate-50/70 px-3 py-2.5 dark:bg-slate-900/30">
                <PaydaySplitLine split={item.payday_split} movingTotal={item.total ?? 0} />
                {item.payday_split_risk && <PaydaySplitRiskLine risk={item.payday_split_risk} />}
              </div>
            </div>
          )}

          {destsSettled.length > 0 && (
            <div>
              <SectionHeading
                title="Accounts already set"
                subtotal={destsSettled.reduce((sum, d) => sum + (d.usual ?? 0), 0)}
                subtotalLabel="usually, £0 needed"
              />
              <p className="mb-1.5 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                {destsSettled.length} {destsSettled.length === 1 ? "account needs" : "accounts need"} nothing moved this period. They already
                hold what&rsquo;s required.
              </p>
              <SettledGroup dests={destsSettled} />
            </div>
          )}

          {item.trimmed && (
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
              <span className="mt-[3px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <span>This period was tight: to cover every payment above, both buffers and typical spending allowances were trimmed.</span>
            </p>
          )}
        </div>
      </CardShell>
    </section>
  );
}
