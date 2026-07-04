"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, TrendingDown } from "lucide-react";
import { api, SavingsInsight } from "@/lib/api";

export default function HomeInsightSpotlight() {
  const router = useRouter();
  const [insight, setInsight] = useState<SavingsInsight | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    api
      .getSpotlightInsight()
      .then(setInsight)
      .catch(() => setInsight(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded || !insight) return null;

  async function dismiss() {
    const id = insight!.id;
    setInsight(null); // hide immediately
    try {
      await api.dismissSpotlightInsight(id);
    } catch {}
    load(); // surface the next eligible insight (or nothing)
  }

  // Neutral card with a violet left rail — distinct without shouting
  return (
    <div className="mx-4 mt-3 mb-5 lg:mx-0">
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 border-l-4 border-l-violet-400 dark:border-l-violet-500 overflow-hidden">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-all"
        >
          <X size={14} className="text-slate-500 dark:text-slate-300" />
        </button>

        <button
          onClick={() => router.push(`/insights?tab=savings&insight=${encodeURIComponent(insight.id)}`)}
          className="w-full text-left p-4 active:scale-[0.99] transition-transform"
        >
          {/* Topic chip + new badge */}
          <div className="flex items-center gap-2 mb-3 pr-8">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 rounded-full pl-1.5 pr-2.5 py-1">
              <span className="text-sm leading-none">{insight.icon}</span>
              {insight.label}
            </span>
            {insight.is_new && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-violet-500 rounded-full px-2 py-0.5">
                New
              </span>
            )}
          </div>

          {/* Title + body share a single left edge */}
          <p className="text-[16px] font-bold text-slate-900 dark:text-slate-100 leading-snug">
            {insight.title}
          </p>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed mt-1.5 line-clamp-2">
            {insight.body}
          </p>

          {/* The saving — the payoff, given its own callout */}
          {insight.savings_estimate && (
            <div className="flex items-start gap-2 mt-3.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
              <TrendingDown size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300 leading-snug">
                {insight.savings_estimate}
              </p>
            </div>
          )}

          <div className="flex items-center gap-1 mt-3.5 text-[13px] font-semibold text-violet-600 dark:text-violet-400">
            See all insights
            <ChevronRight size={15} />
          </div>
        </button>
      </div>
    </div>
  );
}
