"use client";

// G136 date and month picker round: shared pieces for the three variants.
// Fixture only: "today" and "payday" are fixed so screenshots are stable.
// No fetches, no live data. Dates stay in Figtree (only currency is mono).

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";

export type Kind = "day" | "month";
/** m is 0-11. Month values always carry d = 1. */
export type Ymd = { y: number; m: number; d: number };

export const TODAY: Ymd = { y: 2026, m: 9, d: 5 };
export const PAYDAY: Ymd = { y: 2026, m: 9, d: 28 };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_HEADS = [
  { s: "M", l: "Monday" }, { s: "T", l: "Tuesday" }, { s: "W", l: "Wednesday" }, { s: "T", l: "Thursday" },
  { s: "F", l: "Friday" }, { s: "S", l: "Saturday" }, { s: "S", l: "Sunday" },
];

export const monthName = (m: number) => MONTHS[m];
export const monthShort = (m: number) => MONTHS_SHORT[m];
export const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
export const weekdayOf = (v: Ymd) => WEEKDAYS[new Date(v.y, v.m, v.d).getDay()];
export const fmtDay = (v: Ymd) => `${v.d} ${MONTHS_SHORT[v.m]} ${v.y}`;
export const fmtMonth = (v: Ymd) => `${MONTHS[v.m]} ${v.y}`;
export const fmtValue = (kind: Kind, v: Ymd) => (kind === "day" ? fmtDay(v) : fmtMonth(v));
export const key = (v: Ymd) => v.y * 10000 + v.m * 100 + v.d;
export const same = (a: Ymd | null, b: Ymd | null) => !!a && !!b && key(a) === key(b);
export const monthKey = (v: { y: number; m: number }) => v.y * 12 + v.m;
export const addDays = (v: Ymd, n: number): Ymd => {
  const d = new Date(v.y, v.m, v.d + n);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
};
export const addMonths = (v: Ymd, n: number): Ymd => {
  const t = v.y * 12 + v.m + n;
  const y = Math.floor(t / 12);
  const m = ((t % 12) + 12) % 12;
  return { y, m, d: Math.min(v.d, daysIn(y, m)) };
};
export const endOfMonth = (v: Ymd): Ymd => ({ y: v.y, m: v.m, d: daysIn(v.y, v.m) });
export const toMonth = (v: Ymd): Ymd => ({ y: v.y, m: v.m, d: 1 });
export const minFor = (kind: Kind): Ymd => (kind === "day" ? TODAY : toMonth(TODAY));
export const isBeforeMin = (kind: Kind, v: Ymd) => (kind === "day" ? key(v) < key(TODAY) : monthKey(v) < monthKey(TODAY));
export const SELECTED_SEED: Record<Kind, Ymd> = { day: { y: 2026, m: 9, d: 16 }, month: { y: 2027, m: 2, d: 1 } };

export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
export const CHIP = `inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-transform active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${FOCUS}`;
export const ICON_BTN = `grid size-11 shrink-0 place-items-center rounded-full text-slate-600 transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 dark:text-slate-300 ${FOCUS}`;
export const BTN_PRIMARY = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white transition-transform active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 disabled:active:scale-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 ${FOCUS}`;
export const BTN_SECONDARY = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition-transform active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${FOCUS}`;
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const INPUT = "min-h-12 w-full rounded-xl border border-transparent bg-slate-50 px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100";

export function CheckDot({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden="true" className={`grid size-6 shrink-0 place-items-center rounded-full ${selected ? "bg-indigo-600 text-white" : "border border-slate-300 dark:border-slate-600"}`}>
      {selected ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
    </span>
  );
}

/** The host form field: looks like the production input, opens the picker. */
export function FieldRow({ kind, value, onOpen, expanded, controlsId, buttonRef, popup = true }: {
  kind: Kind; value: Ymd | null; onOpen: () => void; expanded?: boolean; controlsId?: string;
  buttonRef?: React.Ref<HTMLButtonElement>; popup?: boolean;
}) {
  const label = kind === "month" ? "Target month" : "Expected date";
  const placeholder = kind === "month" ? "Choose a month" : "Choose a date";
  return (
    <div>
      <span id={`field-label-${kind}`} className={LABEL}>{label}</span>
      <button
        ref={buttonRef} type="button" onClick={onOpen}
        aria-labelledby={`field-label-${kind} field-value-${kind}`}
        aria-haspopup={popup ? "dialog" : undefined} aria-expanded={expanded} aria-controls={controlsId}
        className={`flex min-h-12 w-full items-center gap-3 rounded-xl border border-transparent bg-slate-50 px-3 text-left text-sm transition-transform active:scale-[0.99] dark:bg-slate-700 ${FOCUS}`}
      >
        <CalendarDays size={18} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span id={`field-value-${kind}`} className={`min-w-0 flex-1 truncate ${value ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>
          {value ? fmtValue(kind, value) : placeholder}
        </span>
        <ChevronRight size={16} aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} />
      </button>
    </div>
  );
}

/** Realistic neighbours so the picker is seen in the context it will live in. */
export function HostForm({ kind, field, hint }: { kind: Kind; field: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="g136-name" className={LABEL}>What is it for?</label>
        <input id="g136-name" defaultValue="New sofa" className={INPUT} />
      </div>
      <div>
        <label htmlFor="g136-amount" className={LABEL}>Target amount</label>
        <input id="g136-amount" inputMode="decimal" defaultValue="£1,200" className={`${INPUT} font-mono`} />
      </div>
      {field}
      {hint}
      <p className="text-[12px] leading-5 text-slate-500 dark:text-slate-400">
        {kind === "month" ? "We spread the saving across the pay periods before this month." : "We use this date to work out what to set aside each pay period."}
      </p>
    </div>
  );
}

export function HostFrame({ kind, themeClass, title = "Plan a big expense", onClose, onBack, onEscape, footer, children }: {
  kind: Kind; themeClass: string; title?: string; onClose: () => void; onBack?: () => void; onEscape?: () => void;
  footer?: ReactNode; children: ReactNode;
}) {
  return (
    <SheetFrame
      variant="compact" title={title} themeClass={themeClass} onClose={onClose} onBack={onBack} backLabel="Back to form"
      onEscape={onEscape} manageHistory={false} footer={footer}
      description={onBack ? (kind === "month" ? "Pick the month you need it by." : "Pick the day you need it by.") : undefined}
    >
      {children}
    </SheetFrame>
  );
}

export function SaveFooter() {
  return <div className="flex gap-3"><button type="button" className={BTN_PRIMARY}>Save plan</button></div>;
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Day grid. Roving tabindex, arrows move, PageUp/PageDown change month. */
export function CalendarGrid({ selected, onPick, autoFocus, idPrefix }: {
  selected: Ymd | null; onPick: (v: Ymd) => void; autoFocus?: boolean; idPrefix: string;
}) {
  const min = minFor("day");
  const start = selected && !isBeforeMin("day", selected) ? selected : TODAY;
  const [focus, setFocus] = useState<Ymd>(start);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const wantFocus = useRef(!!autoFocus);
  const headingId = `${idPrefix}-heading`;

  useEffect(() => {
    if (wantFocus.current) { cells.current.get(key(focus))?.focus({ preventScroll: true }); wantFocus.current = false; }
  }, [focus, view]);
  // The sheet's own first-focus runs after mount; take focus back for the grid.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => cells.current.get(key(focus))?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goMonth = (delta: number) => {
    const t = view.y * 12 + view.m + delta;
    const next = { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    if (monthKey(next) < monthKey(min)) return;
    setView(next);
    const f = addMonths({ ...focus, d: 1 }, delta);
    const moved = { y: f.y, m: f.m, d: Math.min(focus.d, daysIn(f.y, f.m)) };
    setFocus(key(moved) < key(min) ? min : moved);
  };
  const move = (next: Ymd) => {
    const clamped = key(next) < key(min) ? min : next;
    wantFocus.current = true;
    setFocus(clamped);
    setView({ y: clamped.y, m: clamped.m });
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => move(addDays(focus, -1)), ArrowRight: () => move(addDays(focus, 1)),
      ArrowUp: () => move(addDays(focus, -7)), ArrowDown: () => move(addDays(focus, 7)),
      Home: () => move(addDays(focus, -((new Date(focus.y, focus.m, focus.d).getDay() + 6) % 7))),
      End: () => move(addDays(focus, 6 - ((new Date(focus.y, focus.m, focus.d).getDay() + 6) % 7))),
      PageUp: () => move(addMonths(focus, -1)), PageDown: () => move(addMonths(focus, 1)),
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const slots: (Ymd | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn(view.y, view.m) }, (_, i) => ({ y: view.y, m: view.m, d: i + 1 })),
  ];
  while (slots.length % 7) slots.push(null);
  const atMin = monthKey(view) <= monthKey(min);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" aria-label="Previous month" disabled={atMin} onClick={() => { wantFocus.current = false; goMonth(-1); }} className={ICON_BTN}><ChevronLeft size={20} aria-hidden="true" /></button>
        <h3 id={headingId} aria-live="polite" className="text-[16px] font-bold text-slate-950 dark:text-slate-50">{monthName(view.m)} {view.y}</h3>
        <button type="button" aria-label="Next month" onClick={() => { wantFocus.current = false; goMonth(1); }} className={ICON_BTN}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <div role="grid" aria-labelledby={headingId} onKeyDown={onKey}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_HEADS.map((w) => (
            <div key={w.l} role="columnheader" aria-label={w.l} className="grid h-8 place-items-center text-[12px] font-semibold text-slate-500 dark:text-slate-400">{w.s}</div>
          ))}
        </div>
        {chunk(slots, 7).map((week, wi) => (
          <div key={wi} role="row" className="grid grid-cols-7">
            {week.map((v, ci) => {
              if (!v) return <div key={ci} role="gridcell" aria-hidden="true" className="h-11" />;
              const disabled = key(v) < key(min);
              const isSel = same(v, selected);
              const isToday = same(v, TODAY);
              const isFocus = same(v, focus);
              return (
                <div key={ci} role="gridcell" aria-selected={isSel} className="grid h-11 place-items-center">
                  <button
                    ref={(n) => { if (n) cells.current.set(key(v), n); else cells.current.delete(key(v)); }}
                    type="button" tabIndex={isFocus ? 0 : -1} disabled={disabled}
                    aria-label={`${weekdayOf(v)} ${fmtDay(v)}${isToday ? ", today" : ""}`}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => { setFocus(v); onPick(v); }}
                    className={`grid size-11 place-items-center rounded-full text-[15px] tabular-nums transition-transform active:scale-95 disabled:active:scale-100 ${FOCUS} ${
                      isSel ? "bg-indigo-600 font-bold text-white" :
                      disabled ? "font-normal text-slate-400 dark:text-slate-500" :
                      isToday ? "font-semibold text-slate-950 ring-2 ring-inset ring-indigo-500 dark:text-white" :
                      "font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >{v.d}</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Month-only grid: year heading with prev/next and 3 x 4 month cells. */
export function MonthGrid({ selected, onPick, autoFocus, idPrefix }: {
  selected: Ymd | null; onPick: (v: Ymd) => void; autoFocus?: boolean; idPrefix: string;
}) {
  const min = minFor("month");
  const start = selected && !isBeforeMin("month", selected) ? selected : min;
  const [focus, setFocus] = useState<Ymd>(toMonth(start));
  const cells = useRef(new Map<number, HTMLButtonElement>());
  const wantFocus = useRef(!!autoFocus);
  const headingId = `${idPrefix}-heading`;
  useEffect(() => {
    if (wantFocus.current) { cells.current.get(monthKey(focus))?.focus({ preventScroll: true }); wantFocus.current = false; }
  }, [focus]);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => cells.current.get(monthKey(focus))?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (delta: number) => {
    const next = toMonth(addMonths(focus, delta));
    wantFocus.current = true;
    setFocus(isBeforeMin("month", next) ? min : next);
  };
  const year = focus.y;
  const goYear = (delta: number) => {
    const next = toMonth({ y: year + delta, m: focus.m, d: 1 });
    wantFocus.current = false;
    setFocus(isBeforeMin("month", next) ? min : next);
  };
  const onKey = (e: KeyboardEvent) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12, Home: -focus.m, End: 11 - focus.m };
    if (e.key in deltas) { e.preventDefault(); move(deltas[e.key]); }
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" aria-label="Previous year" disabled={year <= min.y} onClick={() => goYear(-1)} className={ICON_BTN}><ChevronLeft size={20} aria-hidden="true" /></button>
        <h3 id={headingId} aria-live="polite" className="text-[16px] font-bold tabular-nums text-slate-950 dark:text-slate-50">{year}</h3>
        <button type="button" aria-label="Next year" onClick={() => goYear(1)} className={ICON_BTN}><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <div role="grid" aria-labelledby={headingId} onKeyDown={onKey}>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} role="row" className="grid grid-cols-3 gap-2 pb-2">
            {[0, 1, 2].map((col) => {
              const m = row * 3 + col;
              const v: Ymd = { y: year, m, d: 1 };
              const disabled = isBeforeMin("month", v);
              const isSel = same(v, selected && toMonth(selected));
              const isNow = monthKey(v) === monthKey(TODAY);
              const isFocus = monthKey(v) === monthKey(focus);
              return (
                <div key={col} role="gridcell" aria-selected={isSel}>
                  <button
                    ref={(n) => { if (n) cells.current.set(monthKey(v), n); else cells.current.delete(monthKey(v)); }}
                    type="button" disabled={disabled} tabIndex={isFocus ? 0 : -1}
                    aria-label={fmtMonth(v)} aria-current={isNow ? "date" : undefined}
                    onClick={() => { setFocus(v); onPick(v); }}
                    className={`flex h-12 w-full items-center justify-center rounded-xl text-[15px] transition-transform active:scale-95 disabled:active:scale-100 ${FOCUS} ${
                      isSel ? "bg-indigo-600 font-bold text-white" :
                      disabled ? "bg-transparent font-normal text-slate-400 dark:text-slate-500" :
                      isNow ? "bg-slate-50 font-semibold text-slate-950 ring-2 ring-inset ring-indigo-500 dark:bg-slate-800 dark:text-white" :
                      "bg-slate-50 font-medium text-slate-800 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >{monthShort(m)}</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

