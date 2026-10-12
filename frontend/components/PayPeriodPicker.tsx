"use client";

/**
 * D8: the one pay period picker. Used by onboarding's payday step and by the
 * Settings pay period sheet, so there is a single set of options and a single
 * mapping to the stored config (lib/payPeriodDraft.ts). Do not fork it.
 *
 * Controlled: the parent owns a PayPeriodDraft and builds the config with
 * configFromDraft() when the user saves. Dates go through the app's own
 * DateField, never a native input (check:no-native-date-inputs).
 */
import { useId } from "react";
import CustomSelect from "@/components/CustomSelect";
import { DateField } from "@/components/DatePicker";
import { todayIso } from "@/lib/calendar";
import { ordinal, type PayMode, type PayPeriodDraft } from "@/lib/payPeriodDraft";

const WORKING_DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];
const WEEKEND = [{ value: 0, label: "Sunday" }, { value: 6, label: "Saturday" }];

const MODES: Array<{ value: PayMode; label: string; desc: string }> = [
  { value: "monthly_pay_date", label: "Monthly, on a set date", desc: "The same date every month" },
  { value: "biweekly", label: "Every two weeks", desc: "Counted from a recent payday" },
  { value: "last_day", label: "Last day of the month", desc: "28th to 31st, whichever ends the month" },
  { value: "last_weekday_of_month", label: "Last Monday to Friday of the month", desc: "You choose the weekday" },
  { value: "calendar_month", label: "Calendar month", desc: "Budget from the 1st to the last day, whenever you are paid" },
];

const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2";

export default function PayPeriodPicker({
  draft,
  onChange,
  showCalendarMonth = false,
}: {
  draft: PayPeriodDraft;
  onChange: (next: PayPeriodDraft) => void;
  /** Settings keeps the calendar month budgeting window; onboarding asks for a payday only. */
  showCalendarMonth?: boolean;
}) {
  const groupId = useId();
  const modes = MODES.filter((m) => m.value !== "calendar_month" || showCalendarMonth || draft.mode === "calendar_month");
  const set = (patch: Partial<PayPeriodDraft>) => onChange({ ...draft, ...patch });
  const weekdayOptions = WORKING_DAYS.concat(WEEKEND.filter((w) => w.value === draft.weekday));

  return (
    <div data-pay-period-picker>
      <div role="radiogroup" aria-label="How often you are paid" className="space-y-2">
        {modes.map((m) => {
          const on = draft.mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-describedby={`${groupId}-${m.value}`}
              onClick={() => set({ mode: m.value })}
              className={`w-full min-h-11 flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-colors ${
                on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40"
              }`}
            >
              <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${on ? "border-indigo-500" : "border-slate-300 dark:border-slate-500"}`}>
                {on && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
              </span>
              <span className="block">
                <span className={`block text-sm font-semibold ${on ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}`}>{m.label}</span>
                <span id={`${groupId}-${m.value}`} className="block text-sm text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {draft.mode === "monthly_pay_date" && (
        <div className="pt-4">
          <p className={LABEL}>Pay day of month</p>
          <CustomSelect
            ariaLabel="Pay day of month"
            value={draft.day}
            onChange={(v) => set({ day: Number(v) })}
            options={Array.from({ length: 30 }, (_, i) => i + 1).map((d) => ({
              value: d,
              label: `${ordinal(d)} of each month`,
            }))}
          />
          {draft.day >= 29 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">In shorter months this counts as the last day of the month.</p>
          )}
        </div>
      )}

      {draft.mode === "last_weekday_of_month" && (
        <div className="pt-4">
          <p className={LABEL}>Day of the week</p>
          <CustomSelect
            ariaLabel="Day of the week"
            value={draft.weekday}
            onChange={(v) => set({ weekday: Number(v) })}
            options={weekdayOptions}
          />
        </div>
      )}

      {draft.mode === "biweekly" && (
        <div className="pt-4">
          <p className={LABEL}>A recent payday</p>
          <DateField
            mode="day"
            label="A recent payday"
            value={draft.referenceDate}
            onChange={(v) => set({ referenceDate: v })}
            appearance="outlined"
            placeholder="Choose your last payday"
            today={todayIso()}
          />
        </div>
      )}
    </div>
  );
}
