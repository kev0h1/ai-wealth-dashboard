"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { api, CashflowData } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useRouter } from "next/navigation";

const SYM: Record<string, string> = { UK: "£", Kenya: "KSh " };

export default function UpcomingBillsStrip() {
  const { region } = usePreferences();
  const sym = SYM[region] ?? "£";
  const router = useRouter();
  const [data, setData] = useState<CashflowData | null>(null);

  useEffect(() => {
    api.cashflow().then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  const all = [
    ...data.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
    ...data.upcoming_income.map(b => ({ ...b, type: "income" as const })),
  ];

  if (all.length === 0) return null;

  const today     = all.filter(b => b.days_away === 0);
  const tomorrow  = all.filter(b => b.days_away === 1);
  const later     = all.filter(b => b.days_away > 1);

  // Build a tight summary line e.g. "3 due tomorrow · 1 today · 2 later"
  const parts: { label: string; count: number; urgent: boolean }[] = [];
  if (today.length)    parts.push({ label: "today",    count: today.length,    urgent: true });
  if (tomorrow.length) parts.push({ label: "tomorrow", count: tomorrow.length, urgent: true });
  if (later.length)    parts.push({ label: `in ${later[0].days_away}–${later[later.length-1].days_away}d`, count: later.length, urgent: false });

  const totalBillAmount = data.upcoming_bills.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="px-4 mb-5 lg:px-0">
      <button
        className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform text-left"
        onClick={() => router.push("/spend?view=upcoming")}
      >
        <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
          <CalendarClock size={17} className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Coming up · 14 days</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {parts.map(p => (
              <span
                key={p.label}
                className={`text-sm font-semibold ${p.urgent ? "text-amber-500" : "text-slate-600 dark:text-slate-300"}`}
              >
                {p.count} due {p.label}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-slate-400 dark:text-slate-500">total out</p>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{sym}{totalBillAmount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</p>
        </div>
      </button>
    </div>
  );
}
