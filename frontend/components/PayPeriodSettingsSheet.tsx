"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import CustomSelect from "@/components/CustomSelect";
import { PayPeriodConfig } from "@/lib/payPeriod";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatPeriodLocal(start: Date, end: Date): string {
  const sd = start.getUTCDate();
  const sm = MONTH_SHORT[start.getUTCMonth()];
  const ed = end.getUTCDate();
  const em = MONTH_SHORT[end.getUTCMonth()];
  return `${sd} ${sm} → ${ed} ${em}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PayPeriodSettingsSheet({
  current,
  onClose,
  onSave,
}: {
  current: PayPeriodConfig;
  onClose: () => void;
  onSave: (c: PayPeriodConfig) => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const [mode, setMode] = useState<PayPeriodConfig["type"]>(current.type === "custom" || current.type === "weekly" ? "calendar_month" : current.type);
  const [payDay, setPayDay] = useState(
    current.type === "monthly_pay_date" ? current.day : 25
  );
  const [weekday, setWeekday] = useState(
    (current.type === "weekly" || current.type === "biweekly" || current.type === "last_weekday_of_month") ? current.weekday : 5
  );
  const [biweeklyRef, setBiweeklyRef] = useState(
    current.type === "biweekly" ? current.referenceDate : new Date().toISOString().slice(0, 10)
  );

  function buildConfig(): PayPeriodConfig {
    switch (mode) {
      case "last_friday": return { type: "last_friday" };
      case "last_weekday_of_month": return { type: "last_weekday_of_month", weekday };
      case "calendar_month": return { type: "calendar_month" };
      case "monthly_pay_date": return { type: "monthly_pay_date", day: payDay };
      case "biweekly": return { type: "biweekly", weekday, referenceDate: biweeklyRef };
      default: return { type: "calendar_month" };
    }
  }

  const MODES: Array<{ value: PayPeriodConfig["type"]; label: string; desc: string }> = [
    { value: "calendar_month", label: "Calendar month", desc: "1st to last day of each month" },
    { value: "monthly_pay_date", label: "Monthly pay date", desc: "Period starts on a fixed day each month" },
    { value: "biweekly", label: "Every two weeks", desc: "14-day periods from a reference payday" },
    { value: "last_weekday_of_month", label: "Last weekday of month", desc: "Payday = last chosen weekday each month" },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pay period settings"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-slate-800 rounded-t-3xl z-[70] overflow-y-auto max-h-[88vh]"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Pay Period</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div className="px-5 pb-4 space-y-2">
          {MODES.map(m => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                mode === m.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40"
              }`}
            >
              <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                mode === m.value ? "border-indigo-500" : "border-slate-300 dark:border-slate-500"
              }`}>
                {mode === m.value && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
              </span>
              <div>
                <p className={`text-sm font-semibold ${mode === m.value ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}`}>{m.label}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Sub-options */}
        {mode === "monthly_pay_date" && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pay day of month</p>
            <CustomSelect
              value={payDay}
              onChange={v => setPayDay(Number(v))}
              options={Array.from({ length: 28 }, (_, i) => i + 1).map(d => ({
                value: d,
                label: `${d}${d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"} of each month`,
              }))}
            />
          </div>
        )}

        {mode === "last_weekday_of_month" && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Day of week</p>
            <CustomSelect
              value={weekday}
              onChange={v => setWeekday(Number(v))}
              options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))}
            />
          </div>
        )}

        {mode === "biweekly" && (
          <div className="px-5 pb-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pay day</p>
              <CustomSelect
                value={weekday}
                onChange={v => setWeekday(Number(v))}
                options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">A known payday date</p>
              <input
                type="date"
                value={biweeklyRef}
                onChange={e => setBiweeklyRef(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

        <div className="px-5 pb-8">
          <button
            onClick={() => onSave(buildConfig())}
            className="w-full py-4 rounded-2xl font-semibold text-white text-base bg-indigo-600 hover:bg-indigo-700 transition-colors active:scale-[0.98]"
          >
            Save Pay Period
          </button>
        </div>
      </div>
    </>
  );
}
