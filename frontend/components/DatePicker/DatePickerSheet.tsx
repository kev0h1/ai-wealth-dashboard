"use client";

// G136 (approved variant A, 2026-10-05): the in-design date and month picker
// layer. It replaces the browser's native date and month controls, so a
// date is never drawn by the operating system in its own colours.
//
// LAYER MECHANISM (decided once, here): a NESTED SheetFrame, portalled to
// document.body above whatever opened it (option a). SheetFrame already
// stacks cleanly: every frame portals at z-[70] and a later portal paints
// over an earlier one, useSheetA11y keeps a module-level focusStack so only
// the topmost frame owns Escape and the Tab trap, and its history stack
// closes only the innermost frame on a back press (G192). That means the
// host never needs to know a picker exists, which is what lets non-sheet
// hosts (the Accounts manual transaction form, PayPeriodSettingsSheet) adopt
// the field with no change to their frames. The picker keeps its own history
// entry (manageHistory), so Android back closes the picker only and never
// the host form with unsaved input. Focus returns to the DateField opener.
// On lg SheetFrame already renders a centred dialog, so there is no popover.
//
// Views: the day grid (day mode) or month grid (month mode) is the body. The
// month name and the year in the header are 44 px selectors: month name opens
// a 3x4 month grid for the current year, the year opens a 12-year page grid
// with previous/next page chevrons. Previous/next chevrons stay too.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { SheetFrame, type SheetFrameControls } from "@/components/SheetFrame";
import {
  MONTH_NAMES, MONTH_SHORT, WEEKDAY_HEADS, YEAR_PAGE, addDays, addMonths, chunk, clampYmd, dayKey, daysIn, formatDay, formatIso,
  commitValue, formatMonth, formatValue, monthGridCells, monthKey, outOfRange, parseIso, sameDay, todayIso, toMonth, weekdayName, yearPage, yearPageStart,
  type PickerMode, type Ymd,
} from "@/lib/calendar";

export type DatePickerView = "days" | "months" | "years";
type View = DatePickerView;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900";
const CHIP = `inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${FOCUS}`;
const ICON_BTN = `grid size-11 shrink-0 place-items-center rounded-full text-slate-600 transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none dark:text-slate-300 ${FOCUS}`;
const SELECTOR_BTN = `inline-flex min-h-11 items-center justify-center gap-1 rounded-xl px-2.5 text-[16px] font-bold text-slate-950 transition-transform hover:bg-slate-100 active:scale-95 motion-reduce:transition-none dark:text-slate-50 dark:hover:bg-slate-700 ${FOCUS}`;
const BTN_PRIMARY = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white transition-transform active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 disabled:active:scale-100 motion-reduce:transition-none dark:disabled:bg-slate-700 dark:disabled:text-slate-400 ${FOCUS}`;
const BTN_SECONDARY = `inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition-transform active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${FOCUS}`;

/** Registers the frame's close() so the Back chevron uses the same path as X. */
function CloseBinder({ controls, target }: { controls: SheetFrameControls; target: MutableRefObject<(() => void) | null> }) {
  const { close } = controls;
  useEffect(() => { target.current = close; return () => { target.current = null; }; }, [close, target]);
  return null;
}

export interface DatePickerSheetProps {
  mode: PickerMode;
  /** "YYYY-MM-DD" (day) or "YYYY-MM" (month); "" when nothing is chosen yet. */
  value: string;
  /** Called once, on Done, with the same format as `value`. */
  onCommit: (value: string) => void;
  /** Called when the layer has closed (Done, Cancel, Back, X, Escape, back press). */
  onClose: () => void;
  min?: string;
  max?: string;
  /** Sheet title, for example "Expected date". */
  title?: string;
  /** ISO day treated as today. Defaults to the local day; previews fix it. */
  today?: string;
  themeClass?: string;
  /** Which view to open on (previews and tests). Defaults to the day grid, or the month grid in month mode. */
  initialView?: DatePickerView;
  /** Adds a Clear action that commits "" and closes. */
  allowClear?: boolean;
}

export function DatePickerSheet({ mode, value, onCommit, onClose, min, max, title, today, themeClass, initialView, allowClear }: DatePickerSheetProps) {
  const uid = useId().replace(/:/g, "");
  const closeRef = useRef<(() => void) | null>(null);
  // Portals append to <body> in commit order, children first. When the field
  // mounts together with its host (a restored or default-open state) the
  // picker would land BELOW the host at the same z-index. Mounting the frame
  // one commit later always appends it after the host's own portal.
  // `nested` is decided in the same step: when a sheet overlay is already open
  // it dims the page, so this frame must not dim it a second time.
  const [layered, setLayered] = useState(false);
  const [nested, setNested] = useState(false);
  useEffect(() => { setNested(!!document.querySelector("[data-sheet-overlay]")); setLayered(true); }, []);
  const todayYmd = useMemo(() => parseIso(today ?? todayIso(), "day") ?? parseIso(todayIso(), "day")!, [today]);
  const minYmd = useMemo(() => parseIso(min, mode), [min, mode]);
  const maxYmd = useMemo(() => parseIso(max, mode), [max, mode]);
  const initial = parseIso(value, mode);
  const seed = useMemo(
    () => clampYmd(initial ?? todayYmd, mode, minYmd, maxYmd),
    [initial, todayYmd, mode, minYmd, maxYmd],
  );

  const [draft, setDraft] = useState<Ymd | null>(initial);
  const [view, setView] = useState<View>(initialView ?? (mode === "day" ? "days" : "months"));
  const [cursor, setCursor] = useState({ y: seed.y, m: seed.m });
  const [focus, setFocus] = useState<Ymd>(seed);
  const [yearStart, setYearStart] = useState(() => yearPageStart(seed.y, minYmd?.y ?? null, maxYmd?.y ?? null));
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const wantFocus = useRef(true);
  const headingId = `${uid}-heading`;
  const dayMode = mode === "day";
  const minYear = minYmd?.y ?? null;
  const maxYear = maxYmd?.y ?? null;

  // Focus the selected (or seeded) cell after open and after every view change.
  // The frame's own first-focus runs on mount, so take it back a beat later.
  useEffect(() => {
    if (!wantFocus.current) return;
    const t = setTimeout(() => { cells.current.get(cellKey(view, focus))?.focus({ preventScroll: true }); wantFocus.current = false; }, 60);
    return () => clearTimeout(t);
  }, [view, focus, cursor, yearStart]);

  const goView = (next: View) => { wantFocus.current = true; setView(next); };
  const refocus = (next: Ymd) => { wantFocus.current = true; setFocus(next); setCursor({ y: next.y, m: next.m }); };
  const yearBounds = { hasPrev: minYear == null || cursor.y > minYear, hasNext: maxYear == null || cursor.y < maxYear };

  const stepMonth = (delta: number) => {
    wantFocus.current = false;
    const t = cursor.y * 12 + cursor.m + delta;
    const next = { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    if (outOfRange({ ...next, d: 1 }, "month", minYmd && toMonth(minYmd), maxYmd && toMonth(maxYmd))) return;
    setCursor(next);
    const moved = addMonths({ ...focus, d: 1 }, delta);
    setFocus(clampYmd({ y: moved.y, m: moved.m, d: Math.min(focus.d, daysIn(moved.y, moved.m)) }, "day", minYmd, maxYmd));
  };
  const stepYear = (delta: number) => {
    wantFocus.current = false;
    const y = cursor.y + delta;
    setCursor({ y, m: cursor.m });
    setFocus(clampYmd({ y, m: cursor.m, d: Math.min(focus.d, daysIn(y, cursor.m)) }, dayMode ? "day" : "month", minYmd, maxYmd));
  };
  const stepYearPage = (delta: number) => {
    // Move the roving focus into the new page (first enabled year) so one cell stays tabbable.
    wantFocus.current = false;
    const start = yearStart + delta * YEAR_PAGE;
    const y = Math.min(Math.max(start, minYear ?? -Infinity), maxYear ?? Infinity);
    setYearStart(start);
    setFocus((f) => ({ ...f, y, d: Math.min(f.d, daysIn(y, f.m)) }));
  };

  const pickToday = () => {
    const t = clampYmd(dayMode ? todayYmd : toMonth(todayYmd), mode, minYmd, maxYmd);
    setDraft(t);
    refocus(t);
    setView(dayMode ? "days" : "months");
  };
  const todayDisabled = outOfRange(dayMode ? todayYmd : toMonth(todayYmd), mode, minYmd, maxYmd);

  // ---- day grid
  const onDayKey = (e: KeyboardEvent) => {
    const dow = (new Date(focus.y, focus.m, focus.d).getDay() + 6) % 7;
    const map: Record<string, Ymd> = {
      ArrowLeft: addDays(focus, -1), ArrowRight: addDays(focus, 1), ArrowUp: addDays(focus, -7), ArrowDown: addDays(focus, 7),
      Home: addDays(focus, -dow), End: addDays(focus, 6 - dow), PageUp: addMonths(focus, -1), PageDown: addMonths(focus, 1),
    };
    const next = map[e.key];
    if (next) { e.preventDefault(); refocus(clampYmd(next, "day", minYmd, maxYmd)); }
  };
  // ---- 3 x 4 grids (months, years)
  const onGridKey = (e: KeyboardEvent, step: (delta: number) => void, span: number, current: number) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -span, PageDown: span };
    if (e.key === "Home") { e.preventDefault(); step(-(current % 3)); return; }
    if (e.key === "End") { e.preventDefault(); step(2 - (current % 3)); return; }
    if (e.key in deltas) { e.preventDefault(); step(deltas[e.key]); }
  };
  const moveMonthFocus = (delta: number) => {
    const t = cursor.y * 12 + focus.m + delta;
    const next: Ymd = { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12, d: 1 };
    const clamped = clampYmd(next, "month", minYmd && toMonth(minYmd), maxYmd && toMonth(maxYmd));
    wantFocus.current = true;
    setCursor({ y: clamped.y, m: clamped.m });
    setFocus({ ...clamped, d: Math.min(focus.d, daysIn(clamped.y, clamped.m)) });
  };
  const moveYearFocus = (delta: number) => {
    const target = Math.min(Math.max(focus.y + delta, minYear ?? -Infinity), maxYear ?? Infinity);
    wantFocus.current = true;
    setFocus({ ...focus, y: target, d: Math.min(focus.d, daysIn(target, focus.m)) });
    setCursor({ y: target, m: cursor.m });
    if (target < yearStart) setYearStart(yearStart - YEAR_PAGE);
    else if (target >= yearStart + YEAR_PAGE) setYearStart(yearStart + YEAR_PAGE);
  };

  const pickMonthFromGrid = (m: number) => {
    const v: Ymd = { y: cursor.y, m, d: 1 };
    if (dayMode) {
      // Navigation only: back to the day grid on that month.
      const f = clampYmd({ y: cursor.y, m, d: Math.min(focus.d, daysIn(cursor.y, m)) }, "day", minYmd, maxYmd);
      setCursor({ y: f.y, m: f.m });
      wantFocus.current = true;
      setFocus(f);
      setView("days");
    } else {
      setDraft(v);
      setFocus(v);
    }
  };
  const pickYearFromGrid = (y: number) => {
    wantFocus.current = true;
    if (dayMode) {
      const f = clampYmd({ y, m: cursor.m, d: Math.min(focus.d, daysIn(y, cursor.m)) }, "day", minYmd, maxYmd);
      setCursor({ y: f.y, m: f.m });
      setFocus(f);
      setView("days");
    } else {
      const f = clampYmd({ y, m: cursor.m, d: 1 }, "month", minYmd, maxYmd);
      setCursor({ y: f.y, m: f.m });
      setFocus(f);
      setView("months");
    }
  };

  const liveHeading = view === "years" ? `${yearStart} to ${yearStart + YEAR_PAGE - 1}` : view === "months" ? String(cursor.y) : `${MONTH_NAMES[cursor.m]} ${cursor.y}`;
  const days = view === "days" ? chunk(monthGridCells(cursor.y, cursor.m), 7) : [];
  const atMinMonth = !!minYmd && monthKey(cursor) <= monthKey(minYmd);
  const atMaxMonth = !!maxYmd && monthKey(cursor) >= monthKey(maxYmd);
  const page = yearPage(yearStart, minYear, maxYear);
  const setCell = (k: string) => (n: HTMLButtonElement | null) => { if (n) cells.current.set(k, n); else cells.current.delete(k); };

  const monthBtn = (m: number) => {
    const v: Ymd = { y: cursor.y, m, d: 1 };
    const disabled = outOfRange(v, "month", minYmd && toMonth(minYmd), maxYmd && toMonth(maxYmd));
    const sel = !dayMode && !!draft && monthKey(draft) === monthKey(v);
    const now = monthKey(todayYmd) === monthKey(v);
    const isFocus = monthKey(focus) === monthKey(v) && focus.y === cursor.y;
    return (
      <div key={m} role="gridcell" aria-selected={sel}>
        <button
          ref={setCell(`m${m}`)} type="button" disabled={disabled} tabIndex={isFocus ? 0 : -1}
          aria-label={formatMonth(v)} aria-current={now ? "date" : undefined}
          onClick={() => pickMonthFromGrid(m)}
          className={`flex h-12 w-full items-center justify-center rounded-xl text-[15px] transition-transform active:scale-95 disabled:active:scale-100 motion-reduce:transition-none ${FOCUS} ${
            sel ? "bg-indigo-600 font-bold text-white" :
            disabled ? "bg-transparent font-normal text-slate-400 dark:text-slate-500" :
            now ? "bg-slate-50 font-semibold text-slate-950 ring-2 ring-inset ring-indigo-500 dark:bg-slate-800 dark:text-white" :
            "bg-slate-50 font-medium text-slate-800 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          }`}
        >{MONTH_SHORT[m]}</button>
      </div>
    );
  };

  if (!layered) return null;
  return (
    <SheetFrame
      variant="compact" title={title ?? (dayMode ? "Choose a date" : "Choose a month")} themeClass={themeClass} onClose={onClose}
      onBack={() => {
        // Back steps up one view; only the base view hands Back to the frame.
        if (view === "years") goView(dayMode && initialView === "years" ? "days" : "months");
        else if (view === "months" && dayMode) goView("days");
        else closeRef.current?.();
      }}
      backLabel={view === "years" ? (dayMode && initialView === "years" ? "Back to day grid" : "Back to months") : view === "months" && dayMode ? "Back to day grid" : "Back to form"}
      nested={nested}
      description={undefined}
      footer={(controls) => (
        <div className="flex gap-3">
          <button type="button" onClick={controls.close} className={BTN_SECONDARY}>Cancel</button>
          {allowClear && <button type="button" onClick={() => { onCommit(""); controls.close(); }} className={`${BTN_SECONDARY} !flex-none`}>Clear</button>}
          <button
            type="button" disabled={!draft}
            onClick={() => { if (draft) { onCommit(commitValue(mode, draft.y, draft.m, draft.d)); controls.close(); } }}
            className={BTN_PRIMARY}
          >{draft ? `Done, ${formatValue(formatIso(draft, mode), mode)}` : "Done"}</button>
        </div>
      )}
    >
      {(controls) => (
        <div>
          <CloseBinder controls={controls} target={closeRef} />
          <div className="mb-2 flex items-center justify-end">
            <button type="button" onClick={pickToday} disabled={todayDisabled} className={CHIP}>{dayMode ? "Today" : "This month"}</button>
          </div>
          <span id={headingId} aria-live="polite" className="sr-only">{liveHeading}</span>

          <div className="mb-1 flex items-center justify-between">
            {view === "days" && (
              <>
                <button type="button" aria-label="Previous month" disabled={atMinMonth} onClick={() => stepMonth(-1)} className={ICON_BTN}><ChevronLeft size={20} aria-hidden="true" /></button>
                <div className="flex items-center">
                  <button type="button" onClick={() => goView("months")} aria-label={`${MONTH_NAMES[cursor.m]}, choose a month`} className={SELECTOR_BTN}>{MONTH_NAMES[cursor.m]}<ChevronDown size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-400" /></button>
                  <button type="button" onClick={() => { setYearStart(yearPageStart(cursor.y, minYear, maxYear)); goView("years"); }} aria-label={`${cursor.y}, choose a year`} className={`${SELECTOR_BTN} tabular-nums`}>{cursor.y}<ChevronDown size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-400" /></button>
                </div>
                <button type="button" aria-label="Next month" disabled={atMaxMonth} onClick={() => stepMonth(1)} className={ICON_BTN}><ChevronRight size={20} aria-hidden="true" /></button>
              </>
            )}
            {view === "months" && (
              <>
                <button type="button" aria-label="Previous year" disabled={!yearBounds.hasPrev} onClick={() => stepYear(-1)} className={ICON_BTN}><ChevronLeft size={20} aria-hidden="true" /></button>
                <button type="button" onClick={() => { setYearStart(yearPageStart(cursor.y, minYear, maxYear)); goView("years"); }} aria-label={`${cursor.y}, choose a year`} className={`${SELECTOR_BTN} tabular-nums`}>{cursor.y}<ChevronDown size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-400" /></button>
                <button type="button" aria-label="Next year" disabled={!yearBounds.hasNext} onClick={() => stepYear(1)} className={ICON_BTN}><ChevronRight size={20} aria-hidden="true" /></button>
              </>
            )}
            {view === "years" && (
              <>
                <button type="button" aria-label="Previous 12 years" disabled={!page.hasPrev} onClick={() => stepYearPage(-1)} className={ICON_BTN}><ChevronLeft size={20} aria-hidden="true" /></button>
                <p className="text-[16px] font-bold tabular-nums text-slate-950 dark:text-slate-50">{yearStart} to {yearStart + YEAR_PAGE - 1}</p>
                <button type="button" aria-label="Next 12 years" disabled={!page.hasNext} onClick={() => stepYearPage(1)} className={ICON_BTN}><ChevronRight size={20} aria-hidden="true" /></button>
              </>
            )}
          </div>

          <div className="min-h-[19rem]">
            {view === "days" && (
              <div role="grid" aria-labelledby={headingId} onKeyDown={onDayKey}>
                <div role="row" className="grid grid-cols-7">
                  {WEEKDAY_HEADS.map((w) => (
                    <div key={w.l} role="columnheader" aria-label={w.l} className="grid h-8 place-items-center text-[12px] font-semibold text-slate-500 dark:text-slate-400">{w.s}</div>
                  ))}
                </div>
                {days.map((week, wi) => (
                  <div key={wi} role="row" className="grid grid-cols-7">
                    {week.map((d, ci) => {
                      if (d === null) return <div key={ci} role="gridcell" aria-hidden="true" className="h-11" />;
                      const v: Ymd = { y: cursor.y, m: cursor.m, d };
                      const disabled = outOfRange(v, "day", minYmd, maxYmd);
                      const sel = sameDay(v, draft);
                      const isToday = sameDay(v, todayYmd);
                      return (
                        <div key={ci} role="gridcell" aria-selected={sel} className="grid h-11 place-items-center">
                          <button
                            ref={setCell(`d${dayKey(v)}`)} type="button" disabled={disabled} tabIndex={sameDay(v, focus) ? 0 : -1}
                            aria-label={`${weekdayName(v)} ${formatDay(v)}${isToday ? ", today" : ""}`}
                            aria-current={isToday ? "date" : undefined}
                            onClick={() => { setFocus(v); setDraft(v); }}
                            className={`grid size-11 place-items-center rounded-full text-[15px] tabular-nums transition-transform active:scale-95 disabled:active:scale-100 motion-reduce:transition-none ${FOCUS} ${
                              sel ? "bg-indigo-600 font-bold text-white" :
                              disabled ? "font-normal text-slate-400 dark:text-slate-500" :
                              isToday ? "font-semibold text-slate-950 ring-2 ring-inset ring-indigo-500 dark:text-white" :
                              "font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"
                            }`}
                          >{d}</button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {view === "months" && (
              <div role="grid" aria-labelledby={headingId} onKeyDown={(e) => onGridKey(e, moveMonthFocus, 12, focus.m)}>
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} role="row" className="grid grid-cols-3 gap-2 pb-2">{[0, 1, 2].map((col) => monthBtn(row * 3 + col))}</div>
                ))}
              </div>
            )}
            {view === "years" && (
              <div role="grid" aria-labelledby={headingId} onKeyDown={(e) => onGridKey(e, moveYearFocus, YEAR_PAGE, ((focus.y - yearStart) % 3 + 3) % 3)}>
                {chunk(page.years, 3).map((row, ri) => (
                  <div key={ri} role="row" className="grid grid-cols-3 gap-2 pb-2">
                    {row.map((y) => {
                      const disabled = (minYear != null && y < minYear) || (maxYear != null && y > maxYear);
                      const sel = !!draft && draft.y === y;
                      const now = todayYmd.y === y;
                      return (
                        <div key={y} role="gridcell" aria-selected={sel}>
                          <button
                            ref={setCell(`y${y}`)} type="button" disabled={disabled} tabIndex={focus.y === y ? 0 : -1}
                            aria-label={String(y)} aria-current={now ? "date" : undefined}
                            onClick={() => pickYearFromGrid(y)}
                            className={`flex h-12 w-full items-center justify-center rounded-xl text-[15px] tabular-nums transition-transform active:scale-95 disabled:active:scale-100 motion-reduce:transition-none ${FOCUS} ${
                              sel ? "bg-indigo-600 font-bold text-white" :
                              disabled ? "bg-transparent font-normal text-slate-400 dark:text-slate-500" :
                              now ? "bg-slate-50 font-semibold text-slate-950 ring-2 ring-inset ring-indigo-500 dark:bg-slate-800 dark:text-white" :
                              "bg-slate-50 font-medium text-slate-800 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                            }`}
                          >{y}</button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </SheetFrame>
  );
}

function cellKey(view: View, f: Ymd): string {
  return view === "days" ? `d${dayKey(f)}` : view === "months" ? `m${f.m}` : `y${f.y}`;
}
