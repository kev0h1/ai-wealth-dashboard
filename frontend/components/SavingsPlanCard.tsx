"use client";

// Savings plan milestone tracker, extracted verbatim from the old Insights
// "Savings" tab (frontend/app/insights/InsightsPage.tsx) so it can be shown
// on the Grow page below the priority ladder. Faithful extraction — logic
// and copy unchanged. ProgressRing moved alongside it since this was its
// only remaining consumer once SafetyNetCard's read-view was retired.

import { CheckCircle2, Circle, Trash2, X } from "lucide-react";
import { fmt } from "@/lib/format";
import type { SavingsPlan } from "@/lib/api";

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
      <svg width="52" height="52" className="-rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" className="stroke-slate-100 dark:stroke-slate-700" />
        <circle
          cx="26" cy="26" r={r} fill="none" strokeWidth="5" stroke={accent} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-700 dark:text-slate-200">
        {pct}%
      </span>
    </div>
  );
}

export default function SavingsPlanCard({
  plan, sym, accent, hideValues, onToggleStep, onDeleteStep, onDelete,
}: {
  plan: SavingsPlan | null;
  sym: string;
  accent: string;
  hideValues: boolean;
  onToggleStep: (id: string, done: boolean) => void;
  onDeleteStep: (id: string) => void;
  onDelete: () => void;
}) {
  if (!plan) return null;

  const pct = plan.total_count > 0 ? Math.round((plan.done_count / plan.total_count) * 100) : 0;
  const allDone = plan.total_count > 0 && plan.done_count === plan.total_count;
  const nextIdx = plan.milestones.findIndex(m => !m.done);

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <ProgressRing pct={pct} accent={accent} />
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {allDone ? "Plan complete! 🎉" : "Your savings plan"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {allDone ? "Every milestone done, incredible work." : `${plan.done_count} of ${plan.total_count} done${nextIdx >= 0 ? ", keep going!" : ""}`}
          </p>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        {plan.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          const auto = m.type === "savings";
          return (
            <div key={m.id} className={`group flex items-start gap-1 px-1 rounded-xl transition-colors ${isNext ? "bg-slate-50 dark:bg-slate-700/50" : ""}`}>
              <button disabled={auto} onClick={() => !auto && onToggleStep(m.id, !m.done)}
                className={`flex flex-1 min-w-0 items-start gap-2.5 text-left px-1.5 py-2 ${auto ? "cursor-default" : "active:scale-[0.99]"}`}>
                {m.done
                  ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                  : <Circle className="w-5 h-5 flex-shrink-0 mt-0.5 text-slate-300 dark:text-slate-600" />}
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm leading-snug ${m.done ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                    {m.text}
                  </span>
                  {auto && m.target_balance != null && (
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Auto-tracked · target {hideValues ? "••••" : fmt(m.target_balance, sym)}
                    </span>
                  )}
                  {!auto && m.live_target != null && m.live_spend != null && (
                    <span className={`block text-[11px] mt-0.5 font-medium ${
                      m.live_spend > m.live_target
                        ? "text-red-500 dark:text-red-400"
                        : m.live_spend > m.live_target * 0.8
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {hideValues ? "••••" : fmt(m.live_spend, sym)} on {m.live_category} this month · target {hideValues ? "••••" : fmt(m.live_target, sym)}
                    </span>
                  )}
                </span>
              </button>
              <button onClick={() => onDeleteStep(m.id)} aria-label="Remove goal"
                className="flex-shrink-0 mt-1.5 p-2.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-3 pt-1 flex items-center justify-end border-t border-slate-50 dark:border-slate-700/60">
        <button onClick={onDelete} className="text-xs text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 pt-2">
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}
