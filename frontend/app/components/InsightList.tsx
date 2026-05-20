"use client";

import { Lightbulb, TrendingUp } from "lucide-react";
import { Insight } from "@/lib/api";

const CATEGORY_STYLE: Record<string, string> = {
  savings: "border-l-emerald-500",
  spending: "border-l-amber-500",
  investment: "border-l-blue-500",
};

export default function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-slate-200">AI Insights</h2>
        <span className="ml-auto text-xs text-slate-500">{insights.length} suggestions</span>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map((ins) => (
          <div
            key={ins.id}
            className={`bg-slate-800/50 border border-slate-700 border-l-2 ${
              CATEGORY_STYLE[ins.category] || "border-l-indigo-500"
            } rounded-lg p-4`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-slate-200 leading-snug">{ins.title}</p>
              <div className="flex items-center gap-1 text-emerald-400 shrink-0">
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">£{ins.impact}/yr</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">{ins.rationale}</p>
            <div className="flex items-center justify-between">
              <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                {ins.action}
              </span>
              <span className="text-xs text-slate-500">{ins.confidence}% confidence</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
