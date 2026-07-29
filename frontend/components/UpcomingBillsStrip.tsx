"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarClock } from "lucide-react";
import { api, CashflowData } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

type Status = "loading" | "ready" | "failed";

export default function UpcomingBillsStrip() {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const router = useRouter();
  const [data, setData] = useState<CashflowData | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const fetch = useCallback(() => {
    setStatus("loading");
    api.cashflow()
      .then(d => { setData(d); setStatus("ready"); })
      .catch(() => setStatus("failed"));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (status === "loading") {
    return (
      <div className="px-4 lg:px-0">
        <div className="h-16 rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 animate-pulse" />
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="px-4 lg:px-0">
        <div className="rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-slate-400 dark:text-slate-500 flex-1">Couldn&apos;t load upcoming bills</p>
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

  if (!data) return null;

  // The backend projects ~35 days for the Spend page; the Home strip stays
  // a 14-day glance so the count doesn't balloon
  const all = [
    ...data.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
    ...data.upcoming_income.map(b => ({ ...b, type: "income" as const })),
  ].filter(b => b.days_away <= 14);

  if (all.length === 0) return null;

  const today     = all.filter(b => b.days_away === 0);
  const tomorrow  = all.filter(b => b.days_away === 1);
  const later     = all.filter(b => b.days_away > 1);

  // Build a tight summary line e.g. "3 due tomorrow · 1 today · 2 later"
  const parts: { label: string; count: number; urgent: boolean; noDue?: boolean }[] = [];
  if (today.length)    parts.push({ label: "today",    count: today.length,    urgent: true });
  if (tomorrow.length) parts.push({ label: "tomorrow", count: tomorrow.length, urgent: true });
  if (later.length)    parts.push({ label: "bills over the next 2 weeks", count: later.length, urgent: false, noDue: true });

  const totalBillAmount = all.filter(b => b.type === "bill").reduce((s, b) => s + b.amount, 0);

  return (
    <div className="px-4 lg:px-0 fade-in">
      <button
        className="w-full rounded-2xl bg-white/60 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-3 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 text-left"
        onClick={() => router.push("/spend?view=upcoming")}
      >
        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <CalendarClock size={17} aria-hidden="true" className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Coming up · 14 days</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {parts.map(p => (
              <span
                key={p.label}
                className={`text-sm font-semibold ${p.urgent ? "text-amber-500" : "text-slate-600 dark:text-slate-300"}`}
              >
                {p.noDue ? `${p.count} ${p.label}` : `${p.count} due ${p.label}`}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-slate-400 dark:text-slate-500">total out</p>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 num">{sym}{totalBillAmount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</p>
        </div>
      </button>
    </div>
  );
}
