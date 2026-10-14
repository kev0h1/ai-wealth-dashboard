import { FileText, Receipt, TrendingUp, ShieldCheck } from "lucide-react";
import { STATEMENT_FLOW_STEPS, STATEMENT_PRIVACY_LINE } from "@/lib/investmentFlow";

const ICONS = { statement: FileText, notes: Receipt, prices: TrendingUp } as const;

export type InvestmentFlowVariant = "list" | "strip";

/** G272: the statement, contract notes, daily prices graphic plus the file privacy note. */
export default function InvestmentFlow({ variant }: { variant: InvestmentFlowVariant }) {
  return (
    <section aria-label="How your investment account stays current" className="space-y-3">
      {variant === "list" ? (
        <ol className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-700/50">
          {STATEMENT_FLOW_STEPS.map((s, i) => {
            const Icon = ICONS[s.key];
            return (
              <li key={s.key} className="relative flex items-start gap-3 py-2">
                {i < STATEMENT_FLOW_STEPS.length - 1 && (
                  <span aria-hidden="true" className="absolute left-4 top-10 -bottom-2 w-px bg-slate-200 dark:bg-slate-600" />
                )}
                <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20">
                  <Icon size={16} aria-hidden="true" className="text-indigo-600 dark:text-indigo-400" />
                </span>
                <span className="min-w-0 pt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{i + 1}. {s.label}.</span>{" "}
                  {s.line}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div>
          <ol className="flex items-stretch gap-1.5">
            {STATEMENT_FLOW_STEPS.map((s, i) => {
              const Icon = ICONS[s.key];
              return (
                <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-2 py-3 text-center dark:border-slate-700 dark:bg-slate-700/50">
                    <Icon size={16} aria-hidden="true" className="text-indigo-600 dark:text-indigo-400" />
                    <span className="text-[11px] font-semibold leading-tight text-slate-800 dark:text-slate-100">{s.label}</span>
                  </span>
                  {i < STATEMENT_FLOW_STEPS.length - 1 && (
                    <span aria-hidden="true" className="flex-shrink-0 text-xs text-slate-400 dark:text-slate-500">›</span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs leading-snug text-slate-600 dark:text-slate-300">
            A statement sets your holdings and units, contract notes add trades between statements, and prices then refresh daily.
          </p>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs leading-snug text-slate-500 dark:text-slate-400">
        <ShieldCheck size={14} aria-hidden="true" className="mt-px flex-shrink-0" />
        {STATEMENT_PRIVACY_LINE}
      </p>
    </section>
  );
}
