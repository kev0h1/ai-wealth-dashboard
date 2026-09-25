// G162 — shared bits used identically by all three hero variants, so the
// billgap state (which must stay red "exactly as today") renders the same
// shortfall attribution and timing-risk copy production already ships in
// components/upcoming/UpcomingHeroCard.tsx, rather than three
// independently-drifting reimplementations of the same sentence.
import { ChevronRight } from "lucide-react";
import type { RunwayShortfall, RunwayTimingRisk } from "./fixtures";

export const sym = "£";

export function fmt(n: number): string {
  return Math.abs(Math.round(n)).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** The small top-right badge: red "N accounts short" for a genuine bill gap, amber "N timing risks" otherwise. Unchanged from production's own rule (never red for a same-day timing risk). */
export function ShortfallBadge({
  genuineShortfalls,
  timingShortfalls,
}: {
  genuineShortfalls: RunwayShortfall[];
  timingShortfalls: RunwayTimingRisk[];
}) {
  if (genuineShortfalls.length === 0 && timingShortfalls.length === 0) return null;
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
        genuineShortfalls.length > 0
          ? "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
          : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
      }`}
    >
      {genuineShortfalls.length > 0
        ? `${genuineShortfalls.length} ${genuineShortfalls.length === 1 ? "account" : "accounts"} short`
        : `${timingShortfalls.length} timing ${timingShortfalls.length === 1 ? "risk" : "risks"}`}
    </span>
  );
}

/** The genuine-shortfall attribution sentence + Review link, verbatim from production (including the optional culprit clause — UpcomingHeroCard.tsx names the traced move mostly responsible when one was found). Only ever shown in the billgap state. */
export function ShortfallAttribution({
  genuineShortfalls,
  onReview,
}: {
  genuineShortfalls: RunwayShortfall[];
  onReview: () => void;
}) {
  if (genuineShortfalls.length === 0) return null;
  return (
    <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-white/10">
      {genuineShortfalls.map((a) => (
        <p key={a.accountId} className="text-[13px] leading-snug text-slate-800 dark:text-slate-100">
          <span className="font-semibold">{a.bank}</span> is short by{" "}
          <span className="font-mono tabular-nums font-semibold">
            {sym}
            {a.shortfall.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>{" "}
          before payday
          {a.culprit && (
            <>
              , mostly the{" "}
              <span className="font-mono tabular-nums">
                {sym}
                {a.culprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{" "}
              move on {formatDate(a.culprit.expected_date)}
            </>
          )}
          .
        </p>
      ))}
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Payments can take a day or two to appear, so a very recent one may not be counted yet.
        </p>
        <button
          type="button"
          onClick={onReview}
          className="flex min-h-[44px] shrink-0 items-center gap-0.5 px-2 -my-2.5 text-[13px] font-semibold text-indigo-600 underline-offset-2 hover:underline active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg dark:text-indigo-400"
        >
          Review <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The quiet caption every variant carries, stating the payday-income exclusion in Kevin's own words for the case that prompted this round. Placed directly under the day-count subtitle in all three variants so the fact is visible without opening anything. */
export function PaydayExclusionNote({ paydayIncomeAmount, paydayLabel }: { paydayIncomeAmount: number; paydayLabel: string }) {
  return (
    <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
      Pay of ~{sym}
      {fmt(paydayIncomeAmount)} lands {paydayLabel} and isn&apos;t counted in this figure yet.
    </p>
  );
}
