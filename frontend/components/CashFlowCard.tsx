"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CalendarClock, TrendingUp, TrendingDown } from "lucide-react";
import { api, CashflowData } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function DaysChip({ days }: { days: number }) {
  if (days === 0) return <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Today</span>;
  if (days === 1) return <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">Tomorrow</span>;
  return <span className="text-[10px] text-slate-400 dark:text-slate-500">in {days}d</span>;
}

const CustomTooltip = ({ active, payload, label, sym }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string; sym: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className={`font-medium ${p.name === "projected_income" ? "text-emerald-500" : "text-rose-500"}`}>
          {p.name === "projected_income" ? "In " : "Out "}<span className="font-mono tabular-nums">{fmt(p.value, sym)}</span>
        </p>
      ))}
    </div>
  );
};

export default function CashFlowCard() {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cashflow()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-4 mb-5 bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm animate-pulse lg:mx-0">
        <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-36 mb-3" />
        <div className="h-28 bg-slate-100 dark:bg-slate-700 rounded-xl" />
      </div>
    );
  }

  if (!data || data.weekly_projection.length === 0) return null;

  const hasUpcoming = data.upcoming_bills.length > 0 || data.upcoming_income.length > 0;

  // Determine overall cash position across next 4 weeks
  const totalIn  = data.weekly_projection.reduce((s, w) => s + w.projected_income, 0);
  const totalOut = data.weekly_projection.reduce((s, w) => s + w.projected_spend, 0);
  const surplus  = totalIn - totalOut;

  return (
    <div className="mx-4 mb-5 lg:mx-0">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">30-day cash flow</p>
        {totalIn > 0 && (
          <span className={`text-xs font-semibold flex items-center gap-1 ${surplus >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
            {surplus >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {surplus >= 0 ? "+" : ""}<span className="font-mono tabular-nums">{fmt(surplus, sym)}</span> net
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
        {/* Chart */}
        <div className="px-4 pt-4 pb-2">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data.weekly_projection} barGap={4} barCategoryGap="30%">
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip sym={sym} />} cursor={{ fill: "rgba(99,102,241,0.05)", radius: 8 }} />
              <Bar dataKey="projected_income" name="projected_income" radius={[4, 4, 0, 0]} maxBarSize={28}>
                {data.weekly_projection.map((_, i) => (
                  <Cell key={i} fill="#10b981" />
                ))}
              </Bar>
              <Bar dataKey="projected_spend" name="projected_spend" radius={[4, 4, 0, 0]} maxBarSize={28}>
                {data.weekly_projection.map((_, i) => (
                  <Cell key={i} fill="#f43f5e" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex items-center gap-4 pb-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">Income</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">Spend</span>
            </div>
          </div>
        </div>

        {/* Upcoming bills */}
        {hasUpcoming && (
          <>
            <div className="border-t border-slate-100 dark:border-slate-700 mx-4" />
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <CalendarClock size={12} className="text-slate-400" />
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Next 14 days</p>
              </div>
              <div className="space-y-2">
                {[...data.upcoming_income.map(b => ({ ...b, type: "income" as const })),
                  ...data.upcoming_bills.map(b => ({ ...b, type: "bill" as const }))]
                  .sort((a, b) => a.days_away - b.days_away)
                  .slice(0, 6)
                  .map((item) => (
                    <div key={`${item.type}-${item.name}`} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.type === "income" ? "bg-emerald-400" : "bg-rose-400"}`} />
                      <p className="flex-1 text-xs text-slate-700 dark:text-slate-200 truncate">{item.name}</p>
                      <DaysChip days={item.days_away} />
                      <p className={`text-xs font-semibold flex-shrink-0 font-mono tabular-nums ${item.type === "income" ? "text-emerald-500" : "text-slate-600 dark:text-slate-300"}`}>
                        {item.type === "income" ? "+" : ""}{fmt(item.amount, sym)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
