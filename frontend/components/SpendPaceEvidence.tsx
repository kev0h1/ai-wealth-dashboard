import type { SpendVerdictNotable, SpendVerdictPaceEntry, SpendVerdictState } from "@/lib/api";
import { derivePaceCopy, formatSignedMoney } from "@/lib/spendPaceCopy";
import MoneyText from "@/components/MoneyText";

type SpendPaceEvidenceProps = {
  daysElapsed: number;
  spent: number;
  paceSeries?: SpendVerdictPaceEntry[];
  notables: SpendVerdictNotable[];
  unresolvedTotal: number;
  state?: SpendVerdictState;
};

/** Evidence below the single G186 pace headline. It deliberately adds no
 * verdict of its own: it reconciles the supplied server figures only. */
export default function SpendPaceEvidence({ daysElapsed, spent, paceSeries, notables, unresolvedTotal, state }: SpendPaceEvidenceProps) {
  const latestPace = [...(paceSeries ?? [])].reverse().find((point) => point.usual != null);
  const copy = derivePaceCopy({
    daysElapsed,
    actualOut: spent,
    usualByNow: latestPace?.usual ?? null,
    namedCategories: notables.map((notable) => notable.category),
    namedExcess: notables.reduce((sum, notable) => sum + Math.max(0, notable.excess), 0),
    unresolvedTotal,
  });

  // A missing or still-learning baseline must never imply a comparison.
  if (state === "early" || state === "nobaseline" || copy.total === null || copy.baselineLine === null) return null;

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-labelledby="spend-pace-evidence-heading">
      <h2 id="spend-pace-evidence-heading" className="text-base font-bold text-slate-950 dark:text-white">How this compares with usual</h2>
      <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={copy.baselineLine} /></p>
      <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700 dark:border-slate-700">
        {copy.namedLabel && copy.namedExcess !== null && (
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="min-w-0 text-[13px] leading-5 text-slate-700 dark:text-slate-300">{copy.namedLabel}</dt>
            <dd className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">{formatSignedMoney(copy.namedExcess, { plus: true })}</dd>
          </div>
        )}
        {copy.residual !== null && (
          <div className="flex items-start justify-between gap-4 py-3">
            <dt className="text-[13px] leading-5 text-slate-700 dark:text-slate-300">Other differences</dt>
            <dd className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">{formatSignedMoney(copy.residual, { plus: true })}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-[13px] font-bold text-slate-950 dark:text-white">Difference from usual pace</dt>
          <dd className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">{formatSignedMoney(copy.total, { plus: true })}</dd>
        </div>
      </dl>
      {copy.residualCaption && <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><MoneyText text={copy.residualCaption} /></p>}
    </section>
  );
}
