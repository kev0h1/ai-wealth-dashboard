"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Transaction } from "@/lib/api";

interface MonthData {
  month: string;
  spend: number;
  income: number;
}

function buildMonthlyData(transactions: Transaction[]): MonthData[] {
  const map = new Map<string, { spend: number; income: number }>();

  for (const txn of transactions) {
    const d = new Date(txn.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    const entry = map.get(key) || { spend: 0, income: 0 };
    if (txn.transaction_type === "debit") entry.spend += txn.amount;
    else entry.income += txn.amount;
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, v]) => {
      const [year, month] = key.split("-");
      const d = new Date(Number(year), Number(month) - 1);
      return {
        month: d.toLocaleDateString("en-GB", { month: "short" }),
        spend: Math.round(v.spend),
        income: Math.round(v.income),
      };
    });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === "spend" ? "Spend" : "Income"}: £{p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export default function SpendingChart({ transactions }: { transactions: Transaction[] }) {
  const data = buildMonthlyData(transactions);
  if (data.length < 2) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-4">Monthly Cash Flow</h2>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barGap={2}>
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `£${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="spend" fill="#6366f1" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
          <span className="text-xs text-slate-400">Income</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
          <span className="text-xs text-slate-400">Spending</span>
        </div>
      </div>
    </div>
  );
}
