"use client";

// G136 date and month picker, approved variant A, folded in (Kevin 2026-10-05,
// skill: impeccable). This preview renders the PRODUCTION DateField and
// DatePickerSheet from components/DatePicker with fixture props, so it is a
// real gate: if the shipped component drifts, this page drifts with it.
// Fixture only: "today" is fixed at 5 Oct 2026. No API requests.
//
// /design/date-picker?kind=day|month&state=closed|open|selected&variant=days|months|years&mode=light|dark
// (mode is the light/dark theme, matching the /design index links; kind is the picker' own day or month mode)
//   closed:   host form, field empty
//   open:     host form with a value set, picker open (view picks the layer)
//   selected: host form, value chosen, picker closed

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DateField, type DatePickerView } from "@/components/DatePicker";
import { SheetFrame } from "@/components/SheetFrame";
import type { PickerMode } from "@/lib/calendar";

type State = "closed" | "open" | "selected";
type Theme = "light" | "dark";

const TODAY = "2026-10-05";
const SEED: Record<PickerMode, string> = { day: "2026-10-16", month: "2027-03" };
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const INPUT = "min-h-12 w-full rounded-xl border border-transparent bg-slate-50 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100";
const CHIP = "inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-transform active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/** The host: a "Plan a big expense" style form, so the field is judged in context. */
function Host({ mode, theme, state, view, onClose }: { mode: PickerMode; theme: Theme; state: State; view: DatePickerView; onClose: () => void }) {
  const [value, setValue] = useState(state === "closed" ? "" : SEED[mode]);
  const label = mode === "month" ? "By when" : "Expected date";
  return (
    <SheetFrame
      variant="compact" title="Plan a big expense" themeClass={theme === "dark" ? "dark" : ""} onClose={onClose} manageHistory={false}
      footer={<div className="flex gap-3"><button type="button" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white">Save plan</button></div>}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="g136-name" className={LABEL}>What is it for?</label>
          <input id="g136-name" defaultValue="New sofa" className={INPUT} />
        </div>
        <div>
          <label htmlFor="g136-amount" className={LABEL}>Target amount</label>
          <input id="g136-amount" inputMode="decimal" defaultValue="£1,200" className={`${INPUT} font-mono`} />
        </div>
        <div>
          <span className={LABEL}>{label}</span>
          <DateField
            mode={mode} label={label} title={mode === "month" ? "Target month" : "Expected date"} value={value} onChange={setValue}
            today={TODAY} min={mode === "month" ? TODAY.slice(0, 7) : TODAY} themeClass={theme === "dark" ? "dark" : ""}
            defaultOpen={state === "open"} defaultView={view}
          />
        </div>
        <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
          {mode === "month" ? "We spread the saving across the pay periods before this month." : "We use this date to work out what to set aside each pay period."}
        </p>
      </div>
    </SheetFrame>
  );
}

export default function DatePickerClient() {
  const params = useSearchParams();
  const mode: PickerMode = params.get("kind") === "month" ? "month" : "day";
  const state: State = params.get("state") === "open" ? "open" : params.get("state") === "selected" ? "selected" : "closed";
  const variantParam = params.get("variant");
  const view: DatePickerView = variantParam === "years" ? "years" : variantParam === "months" || mode === "month" ? "months" : "days";
  const theme: Theme = params.get("mode") === "dark" ? "dark" : "light";
  const [hostOpen, setHostOpen] = useState(true);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const was = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    return () => { root.classList.toggle("dark", was); root.style.colorScheme = ""; };
  }, [theme]);

  const href = (patch: Partial<{ mode: PickerMode; state: State; view: DatePickerView; theme: Theme }>) => {
    const n = { mode, state, view, theme, ...patch };
    return `?kind=${n.mode}&state=${n.state}&variant=${n.view}&mode=${n.theme}`;
  };
  const on = "!border-indigo-600 !bg-indigo-600 !text-white";

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-40 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
      <div className="mx-auto max-w-[500px]">
        <a href="/design" className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">Design previews</a>
        <h1 className="mt-2 text-[21px] font-bold text-slate-950 dark:text-white">Date and month picker</h1>
        <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          G136, approved A, folded in. This page renders the production DateField and DatePickerSheet. Today is fixed at 5 Oct 2026. Tap the month name or the year in the picker header to choose a month or a year.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Mode and state">
          {(["day", "month"] as const).map((k) => <a key={k} href={href({ mode: k, view: k === "month" ? "months" : "days" })} aria-current={mode === k ? "page" : undefined} className={`${CHIP} ${mode === k ? on : ""}`}>{k === "day" ? "Day" : "Month"}</a>)}
          {(["closed", "open", "selected"] as const).map((s) => <a key={s} href={href({ state: s })} aria-current={state === s ? "page" : undefined} className={`${CHIP} ${state === s ? on : ""}`}>{s[0].toUpperCase() + s.slice(1)}</a>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Opening view and theme">
          {(mode === "day" ? (["days", "months", "years"] as const) : (["months", "years"] as const)).map((v) => (
            <a key={v} href={href({ state: "open", view: v })} aria-current={view === v && state === "open" ? "page" : undefined} className={`${CHIP} ${view === v && state === "open" ? on : ""}`}>
              {v === "days" ? "Day grid" : v === "months" ? "Month selector" : "Year selector"}
            </a>
          ))}
          <a href={href({ theme: theme === "dark" ? "light" : "dark" })} className={CHIP}>{theme === "dark" ? "Light" : "Dark"}</a>
        </div>
        <button type="button" onClick={() => { setSession((s) => s + 1); setHostOpen(true); }} className={`${CHIP} mt-4`}>Open the form again</button>
      </div>
      {hostOpen ? <Host key={`${mode}-${state}-${view}-${theme}-${session}`} mode={mode} theme={theme} state={state} view={view} onClose={() => setHostOpen(false)} /> : null}
    </main>
  );
}
