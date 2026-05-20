"use client";

import { TrendingUp, Wallet, Clock, LineChart, PiggyBank } from "lucide-react";
import { KPIs } from "@/lib/api";

function fmt(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(1)}k`;
  return `£${n.toFixed(0)}`;
}

interface KPICardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  loading: boolean;
}

function KPICard({ label, value, icon, color, loading }: KPICardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{label}</p>
          {loading ? (
            <div className="h-7 w-24 bg-slate-800 animate-pulse rounded" />
          ) : (
            <p className="text-2xl font-bold text-white">{value}</p>
          )}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function KPICards({ kpis, loading }: { kpis: KPIs | null; loading: boolean }) {
  const cards = [
    {
      label: "Net Worth",
      value: kpis ? fmt(kpis.net_worth) : "—",
      icon: <TrendingUp className="w-4 h-4 text-indigo-300" />,
      color: "bg-indigo-500/20",
    },
    {
      label: "Cash",
      value: kpis ? fmt(kpis.cash) : "—",
      icon: <Wallet className="w-4 h-4 text-emerald-300" />,
      color: "bg-emerald-500/20",
    },
    {
      label: "Runway",
      value: kpis ? `${kpis.runway}mo` : "—",
      icon: <Clock className="w-4 h-4 text-amber-300" />,
      color: "bg-amber-500/20",
    },
    {
      label: "Investments",
      value: kpis ? fmt(kpis.investments) : "—",
      icon: <LineChart className="w-4 h-4 text-blue-300" />,
      color: "bg-blue-500/20",
    },
    {
      label: "Pensions",
      value: kpis ? fmt(kpis.pensions) : "—",
      icon: <PiggyBank className="w-4 h-4 text-purple-300" />,
      color: "bg-purple-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <KPICard key={c.label} {...c} loading={loading} />
      ))}
    </div>
  );
}
