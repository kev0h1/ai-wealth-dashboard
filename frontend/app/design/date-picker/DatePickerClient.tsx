"use client";

// TEMPORARY PREVIEW, G136 date and month picker round (skill: impeccable).
// Fixture only: "today" is fixed at 5 Oct 2026 and payday at 28 Oct 2026. No
// API requests. Three working variants of one in-design picker, replacing the
// native type=date / type=month inputs.
//
// /design/date-picker?variant=a|b|c&mode=day|month&state=closed|open|selected&theme=light|dark
//   closed:   host form, field empty
//   open:     host form with a value already set, picker open (editing)
//   selected: host form, value chosen, picker closed

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarGridVariant, InSheetRowsVariant, StepperVariant } from "./variants";
import { CHIP, SELECTED_SEED, type Kind } from "./shared";

type Variant = "a" | "b" | "c";
type State = "closed" | "open" | "selected";
type Theme = "light" | "dark";

export default function DatePickerClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a";
  const kind: Kind = params.get("mode") === "month" ? "month" : "day";
  const state: State = params.get("state") === "open" ? "open" : params.get("state") === "selected" ? "selected" : "closed";
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const [sheetOpen, setSheetOpen] = useState(true);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const was = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
    return () => { root.classList.toggle("dark", was); root.style.colorScheme = ""; };
  }, [theme]);

  const href = (patch: Partial<{ variant: Variant; kind: Kind; state: State; theme: Theme }>) => {
    const n = { variant, kind, state, theme, ...patch };
    return `?variant=${n.variant}&mode=${n.kind}&state=${n.state}&theme=${n.theme}`;
  };
  const on = "!border-indigo-600 !bg-indigo-600 !text-white";
  const themeClass = theme === "dark" ? "dark" : "";
  const seed = state === "closed" ? null : SELECTED_SEED[kind];
  const props = {
    kind, themeClass, initialValue: seed, initialOpen: state === "open",
    onClose: () => setSheetOpen(false),
  };
  const Variant = variant === "a" ? CalendarGridVariant : variant === "b" ? InSheetRowsVariant : StepperVariant;

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-40 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
      <div className="mx-auto max-w-[500px]">
        <a href="/design" className="text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">Design previews</a>
        <h1 className="mt-2 text-[21px] font-bold text-slate-950 dark:text-white">Date and month picker</h1>
        <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
          G136, three working variants. Today is fixed at 5 Oct 2026 for this preview. Past dates are muted and cannot be chosen.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Variant">
          {([["a", "A Calendar grid"], ["b", "B In-sheet rows"], ["c", "C Stepper field"]] as const).map(([v, l]) => (
            <a key={v} href={href({ variant: v })} aria-current={variant === v ? "page" : undefined} className={`${CHIP} ${variant === v ? on : ""}`}>{l}</a>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Mode and state">
          {(["day", "month"] as const).map((k) => <a key={k} href={href({ kind: k })} aria-current={kind === k ? "page" : undefined} className={`${CHIP} ${kind === k ? on : ""}`}>{k === "day" ? "Day" : "Month"}</a>)}
          {(["closed", "open", "selected"] as const).map((s) => <a key={s} href={href({ state: s })} aria-current={state === s ? "page" : undefined} className={`${CHIP} ${state === s ? on : ""}`}>{s[0].toUpperCase() + s.slice(1)}</a>)}
          <a href={href({ theme: theme === "dark" ? "light" : "dark" })} className={CHIP}>{theme === "dark" ? "Light" : "Dark"}</a>
        </div>
        <button type="button" onClick={() => { setSession((s) => s + 1); setSheetOpen(true); }} className={`${CHIP} mt-4`}>Open the form again</button>
      </div>
      {sheetOpen ? <Variant key={`${variant}-${kind}-${state}-${session}`} {...props} /> : null}
    </main>
  );
}
