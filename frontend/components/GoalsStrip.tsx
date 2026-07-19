"use client";

// The goals scoreboard: one glance-sized row per headline goal (debt-free,
// safety net, inside budget), each tapping through to its page. Detail lives
// on the pillar pages and in Penny — this is deliberately just the score.

import { useEffect, useState, useCallback } from "react";
import { Target } from "lucide-react";
import { api, GoalSummary } from "@/lib/api";
import { useRouter } from "next/navigation";

const PILLAR_COLOURS: Record<string, string> = {
  debt:    "#f87171",
  savings: "#34d399",
  budget:  "#60a5fa",
};

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
        <div className="h-28 bg-white dark:bg-slate-800 rounded-2xl shadow-sm animate-pulse" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="px-4 lg:px-0">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-slate-400 dark:text-slate-500 flex-1">Couldn&apos;t load goals</p>
          <button
            onClick={fetch}
            className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 active:opacity-70 transition-opacity"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (goals.length === 0) return null;

  return (
    <div className="px-4 lg:px-0">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
            <Target size={13} className="text-indigo-500 dark:text-indigo-400" />
          </span>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Your goals</p>
        </div>
        <div className="space-y-3">
          {goals.map(g => {
            const colour = PILLAR_COLOURS[g.pillar] ?? "#6366f1";
            return (
              <button
                key={g.pillar}
                onClick={() => router.push(g.url)}
                className="w-full active:opacity-70 transition-opacity text-left"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {g.label}
                  </span>
                  <span className={`text-[11px] font-medium flex-shrink-0 ${
                    g.done ? "text-emerald-500" : g.at_risk ? "text-amber-500" : "text-slate-400 dark:text-slate-500"
                  }`}>
                    {g.detail}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(g.pct, 100))}
                  aria-label={g.label}
                  className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full"
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
