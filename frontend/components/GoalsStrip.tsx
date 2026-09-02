"use client";

// The goals scoreboard: one glance-sized row per headline goal (debt-free,
// safety net, inside budget), each tapping through to its page. Detail lives
// on the pillar pages and in Penny — this is deliberately just the score.

import { useEffect, useState, useCallback } from "react";
import { Target, ChevronRight } from "lucide-react";
import { api, GoalSummary } from "@/lib/api";
import { useRouter } from "next/navigation";

// Bar colour is driven by status, not a fixed pillar hue.
// Debt on-track → calm indigo; at-risk → amber.
// Savings/safety-net → emerald.
// Budget on-track → indigo; over/at-risk → amber (matches Budget page + amber text).
function goalBarColour(g: GoalSummary): string {
  if (g.done) return "#10b981"; // emerald for completed
  if (g.at_risk) return "#f59e0b"; // amber for any at-risk
  if (g.pillar === "savings") return "#34d399"; // emerald for savings progress
  if (g.pillar === "debt") return "#6366f1"; // indigo for on-track debt (not red — on-plan debt is not risk)
  return "#6366f1"; // indigo default for budget on-track
}

function humaniseDetail(g: GoalSummary): string {
  // The "budget" pillar (and its "N over" phrasing) was retired 2026-08-30
  // — this goal strip now only ever sees "debt" and "savings" pillars.
  return g.detail;
}

type Status = "loading" | "ready" | "failed";

export default function GoalsStrip() {
  const router = useRouter();
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  const fetch = useCallback(() => {
    setStatus("loading");
    api.goalsSummary()
      .then(r => { setGoals(r.goals); setStatus("ready"); })
      .catch(() => setStatus("failed"));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (status === "loading") {
    return (
      <div className="px-4 lg:px-0">
        <div className="h-28 rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 animate-pulse" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="px-4 lg:px-0">
        <div className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-slate-400 dark:text-slate-500 flex-1">Couldn&apos;t load goals</p>
          <button
            onClick={fetch}
            className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="px-4 lg:px-0">
        <div className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
              <Target size={13} aria-hidden="true" className="text-indigo-500 dark:text-indigo-400" />
            </span>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Your goals</p>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
            No goals set yet. Start tracking debt payoff, a safety net, or your budget pace.
          </p>
          <button
            onClick={() => router.push("/cards")}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150"
          >
            Start with debt payoff
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-0">
      <div className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 px-4 py-3 fade-in">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
            <Target size={13} aria-hidden="true" className="text-indigo-500 dark:text-indigo-400" />
          </span>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Your goals</p>
        </div>
        <div className="space-y-3">
          {goals.map(g => {
            const colour = goalBarColour(g);
            return (
              <button
                key={g.pillar}
                onClick={() => router.push(g.url)}
                className="w-full hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 text-left"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate min-w-0">
                    {g.label}
                  </span>
                  <span className={`text-[11px] font-medium flex-shrink-0 ${
                    g.done ? "text-emerald-500" : g.at_risk ? "text-slate-500 dark:text-slate-400" : "text-slate-400 dark:text-slate-500"
                  }`}>
                    {humaniseDetail(g)}
                  </span>
                </div>
                {/* 6px slim track per DESIGN.md Progress Bar spec — even an
                    over-budget/at-risk amber fill reads as a sliver, not a
                    chunky block dominating the Home screen */}
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(g.pct, 100))}
                  aria-label={g.label}
                  className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bar-sweep"
                    // 2% floor so a 0% goal still shows a starting sliver, not a broken bar
                    style={{ width: `${Math.max(Math.min(g.pct, 100), 2)}%`, backgroundColor: colour }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
