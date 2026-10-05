"use client";

// G136 date and month picker round: the three variants. Each is a working
// component with real state (open, navigate, select, confirm, cancel). The
// host is a production SheetFrame (compact) holding a "Plan a big expense"
// style form, so the picker is judged in its real context.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Minus, Plus } from "lucide-react";
import {
  BTN_PRIMARY, BTN_SECONDARY, CHIP, CalendarGrid, CheckDot, FOCUS, FieldRow, HostForm, HostFrame, ICON_BTN, MonthGrid, PAYDAY, SaveFooter,
  TODAY, addDays, addMonths, daysIn, endOfMonth, fmtDay, fmtMonth, fmtValue, isBeforeMin, key, minFor, monthName, monthShort, monthKey,
  same, toMonth, weekdayOf, type Kind, type Ymd,
} from "./shared";

export type VariantProps = {
  kind: Kind;
  themeClass: string;
  initialValue: Ymd | null;
  initialOpen: boolean;
  onClose: () => void;
  onCommit?: (v: Ymd) => void;
};

// ---------------------------------------------------------------- A: calendar grid

export function CalendarGridVariant({ kind, themeClass, initialValue, initialOpen, onClose, onCommit }: VariantProps) {
  const [value, setValue] = useState<Ymd | null>(initialValue);
  const [open, setOpen] = useState(initialOpen);
  const [draft, setDraft] = useState<Ymd | null>(initialValue);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const id = useId().replace(/:/g, "");

  const openPicker = () => { setDraft(value); setOpen(true); };
  const closePicker = () => { setOpen(false); requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true })); };
  const done = () => { if (draft) { setValue(draft); onCommit?.(draft); } closePicker(); };
  const pickToday = () => setDraft(kind === "day" ? TODAY : toMonth(TODAY));
  const todayLabel = kind === "day" ? "Today" : "This month";

  if (!open) {
    return (
      <HostFrame kind={kind} themeClass={themeClass} onClose={onClose} footer={<SaveFooter />}>
        <HostForm kind={kind} field={<FieldRow kind={kind} value={value} onOpen={openPicker} buttonRef={fieldRef} />} />
      </HostFrame>
    );
  }
  return (
    <HostFrame
      kind={kind} themeClass={themeClass} title={kind === "day" ? "Expected date" : "Target month"} onClose={onClose}
      onBack={closePicker} onEscape={closePicker}
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={closePicker} className={BTN_SECONDARY}>Cancel</button>
          <button type="button" onClick={done} disabled={!draft} className={BTN_PRIMARY}>
            {draft ? `Done, ${fmtValue(kind, draft)}` : "Done"}
          </button>
        </div>
      }
    >
      <div className="mb-3 flex items-center justify-end">
        <button type="button" onClick={pickToday} className={CHIP}>{todayLabel}</button>
      </div>
      {/* key forces the grid to re-seed its view when Today is tapped */}
      {kind === "day"
        ? <CalendarGrid key={draft ? key(draft) : "none"} idPrefix={`a-${id}`} selected={draft} onPick={setDraft} autoFocus />
        : <MonthGrid key={draft ? key(draft) : "none"} idPrefix={`a-${id}`} selected={draft} onPick={setDraft} autoFocus />}
    </HostFrame>
  );
}

// ---------------------------------------------------------------- B: in-sheet rows

type RowItem = { v: Ymd; left: string; right: string; yearLabel?: string };

function buildRows(kind: Kind): RowItem[] {
  if (kind === "day") {
    return Array.from({ length: 14 }, (_, i) => {
      const v = addDays(TODAY, i);
      const prev = i > 0 ? addDays(TODAY, i - 1) : null;
      return { v, left: `${v.d} ${monthShort(v.m)}`, right: i === 0 ? "Today" : i === 1 ? "Tomorrow" : weekdayOf(v), yearLabel: !prev || prev.y !== v.y ? String(v.y) : undefined };
    });
  }
  const start = toMonth(TODAY);
  return Array.from({ length: 12 }, (_, i) => {
    const v = addMonths(start, i);
    const prev = i > 0 ? addMonths(start, i - 1) : null;
    return { v, left: monthName(v.m), right: i === 0 ? "This month" : i === 1 ? "Next month" : "", yearLabel: !prev || prev.y !== v.y ? String(v.y) : undefined };
  });
}

function RowList({ kind, selected, onPick, autoFocus }: { kind: Kind; selected: Ymd | null; onPick: (v: Ymd) => void; autoFocus?: boolean }) {
  const rows = buildRows(kind);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selIdx = rows.findIndex((r) => (kind === "day" ? same(r.v, selected) : selected && monthKey(r.v) === monthKey(selected)));
  const [active, setActive] = useState(selIdx >= 0 ? selIdx : 0);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => refs.current[active]?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (i: number) => { const n = Math.max(0, Math.min(rows.length - 1, i)); setActive(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); go(active + 1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); go(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(rows.length - 1); }
  };
  return (
    <div role="radiogroup" aria-label={kind === "day" ? "Upcoming days" : "Upcoming months"} onKeyDown={onKey}>
      {rows.map((r, i) => {
        const isSel = i === selIdx;
        return (
          <div key={key(r.v)}>
            {r.yearLabel ? <p aria-hidden="true" className="px-1 pb-1 pt-3 text-[12px] font-semibold tabular-nums text-slate-500 first:pt-0 dark:text-slate-400">{r.yearLabel}</p> : null}
            <button
              ref={(n) => { refs.current[i] = n; }}
              type="button" role="radio" aria-checked={isSel} tabIndex={i === active ? 0 : -1}
              aria-label={kind === "day" ? `${weekdayOf(r.v)} ${fmtDay(r.v)}` : `${r.left} ${r.v.y}`}
              onClick={() => onPick(r.v)}
              className={`flex min-h-11 w-full items-center gap-3 border-t border-slate-100 px-1 text-left transition-transform active:scale-[0.99] first:border-t-0 dark:border-slate-700/70 ${FOCUS} ${isSel ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}
            >
              <span className={`min-w-0 flex-1 text-[15px] ${isSel ? "font-bold text-slate-950 dark:text-white" : "font-medium text-slate-900 dark:text-slate-100"}`}>{r.left}</span>
              {r.right ? <span className="shrink-0 text-[13px] text-slate-500 dark:text-slate-400">{r.right}</span> : null}
              <CheckDot selected={isSel} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function InSheetRowsVariant({ kind, themeClass, initialValue, initialOpen, onClose, onCommit }: VariantProps) {
  const [value, setValue] = useState<Ymd | null>(initialValue);
  const [open, setOpen] = useState(initialOpen);
  const [grid, setGrid] = useState(false);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const id = useId().replace(/:/g, "");

  const closePicker = () => { setOpen(false); setGrid(false); requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true })); };
  const pick = (v: Ymd) => { setValue(v); onCommit?.(v); closePicker(); };
  const back = () => { if (grid) setGrid(false); else closePicker(); };

  if (!open) {
    return (
      <HostFrame kind={kind} themeClass={themeClass} onClose={onClose} footer={<SaveFooter />}>
        <HostForm kind={kind} field={<FieldRow kind={kind} value={value} onOpen={() => setOpen(true)} buttonRef={fieldRef} />} />
      </HostFrame>
    );
  }
  const title = grid ? (kind === "day" ? "Pick another date" : "Pick another month") : kind === "day" ? "Expected date" : "Target month";
  return (
    <HostFrame
      kind={kind} themeClass={themeClass} title={title} onClose={onClose} onBack={back} onEscape={back}
      footer={grid ? undefined : (
        <button
          type="button" onClick={() => setGrid(true)}
          className={`flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 text-[14px] font-semibold text-indigo-700 transition-transform active:scale-95 dark:border-slate-600 dark:text-indigo-300 ${FOCUS}`}
        >{kind === "day" ? "Pick another date" : "Pick a later month"}</button>
      )}
    >
      {grid ? (
        kind === "day"
          ? <CalendarGrid idPrefix={`b-${id}`} selected={value} onPick={pick} autoFocus />
          : <MonthGrid idPrefix={`b-${id}`} selected={value} onPick={pick} autoFocus />
      ) : (
        <RowList kind={kind} selected={value} onPick={pick} autoFocus />
      )}
    </HostFrame>
  );
}

// ---------------------------------------------------------------- C: stepper field

function Stepper({ label, text, valueNow, valueMin, valueMax, onMinus, onPlus, minusDisabled, plusDisabled, wide }: {
  label: string; text: string; valueNow: number; valueMin: number; valueMax: number; onMinus: () => void; onPlus: () => void;
  minusDisabled?: boolean; plusDisabled?: boolean; wide?: boolean;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp" && !plusDisabled) { e.preventDefault(); onPlus(); }
    if (e.key === "ArrowDown" && !minusDisabled) { e.preventDefault(); onMinus(); }
  };
  return (
    <div className={`flex min-w-0 flex-col items-center ${wide ? "flex-[1.2]" : "flex-1"}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <button type="button" aria-label={`${label} forward`} disabled={plusDisabled} onClick={onPlus} tabIndex={-1} className={`${ICON_BTN} bg-slate-100 dark:bg-slate-700`}><Plus size={18} aria-hidden="true" /></button>
      <span
        role="spinbutton" tabIndex={0} aria-label={label} aria-valuemin={valueMin} aria-valuemax={valueMax} aria-valuenow={valueNow} aria-valuetext={text} onKeyDown={onKey}
        className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-center text-[20px] font-bold tabular-nums text-slate-950 dark:text-white ${FOCUS}`}
      >{text}</span>
      <button type="button" aria-label={`${label} back`} disabled={minusDisabled} onClick={onMinus} tabIndex={-1} className={`${ICON_BTN} bg-slate-100 dark:bg-slate-700`}><Minus size={18} aria-hidden="true" /></button>
    </div>
  );
}

export function StepperVariant({ kind, themeClass, initialValue, initialOpen, onClose, onCommit }: VariantProps) {
  const min = minFor(kind);
  const [value, setValue] = useState<Ymd | null>(initialValue);
  const [expanded, setExpanded] = useState(initialOpen);
  const [draft, setDraft] = useState<Ymd>(initialValue ?? min);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const panelId = useId().replace(/:/g, "");

  const [lastChip, setLastChip] = useState<string | null>(null);
  const stepTo = (v: Ymd) => { setLastChip(null); setDraft(v); };
  const commit = () => { setValue(draft); onCommit?.(draft); setExpanded(false); requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true })); };
  const cancel = () => { setExpanded(false); requestAnimationFrame(() => fieldRef.current?.focus({ preventScroll: true })); };
  const toggle = () => { if (expanded) commit(); else { setDraft(value ?? min); setExpanded(true); } };

  const set = (y: number, m: number, d: number): Ymd => {
    const next: Ymd = { y, m, d: kind === "month" ? 1 : Math.min(d, daysIn(y, m)) };
    return isBeforeMin(kind, next) ? min : next;
  };
  const dayOk = (delta: number) => { const n = draft.d + delta; return n >= 1 && n <= daysIn(draft.y, draft.m) && !(kind === "day" && key({ ...draft, d: n }) < key(min)); };
  const monthOk = (delta: number) => !isBeforeMin(kind, { ...addMonths({ ...draft, d: 1 }, delta), d: 1 });
  const yearOk = (delta: number) => !isBeforeMin(kind, { y: draft.y + delta, m: draft.m, d: 1 }) || (delta > 0);
  const payday: Ymd = kind === "day" ? PAYDAY : toMonth(PAYDAY);

  const summary = kind === "day" ? `${weekdayOf(draft)} ${fmtDay(draft)}` : fmtMonth(draft);
  const MAX_YEAR = TODAY.y + 10;
  const chips = kind === "day"
    ? [{ l: "Today", v: TODAY }, { l: "End of month", v: endOfMonth(TODAY) }, { l: `Payday, ${fmtDay(PAYDAY).replace(/ 2026$/, "")}`, v: payday }]
    : [{ l: "This month", v: toMonth(TODAY) }, { l: "Next month", v: toMonth(addMonths(TODAY, 1)) }, { l: "Payday", v: payday }];

  const panel = expanded ? (
    <div id={panelId} role="group" aria-label={kind === "day" ? "Choose a date" : "Choose a month"} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-800/60">
      <div className="flex items-start gap-2">
        {kind === "day" && (
          <Stepper label="Day" text={String(draft.d)} valueNow={draft.d} valueMin={kind === "day" && monthKey(draft) === monthKey(min) ? min.d : 1} valueMax={daysIn(draft.y, draft.m)} minusDisabled={!dayOk(-1)} plusDisabled={!dayOk(1)}
            onMinus={() => stepTo(set(draft.y, draft.m, draft.d - 1))} onPlus={() => stepTo(set(draft.y, draft.m, draft.d + 1))} />
        )}
        <Stepper label="Month" text={monthShort(draft.m)} valueNow={draft.m + 1} valueMin={draft.y === min.y ? min.m + 1 : 1} valueMax={12} wide minusDisabled={!monthOk(-1)}
          onMinus={() => { const n = addMonths(draft, -1); stepTo(set(n.y, n.m, draft.d)); }}
          onPlus={() => { const n = addMonths(draft, 1); stepTo(set(n.y, n.m, draft.d)); }} />
        <Stepper label="Year" text={String(draft.y)} valueNow={draft.y} valueMin={min.y} valueMax={MAX_YEAR} wide minusDisabled={!yearOk(-1)} plusDisabled={draft.y >= MAX_YEAR}
          onMinus={() => stepTo(set(draft.y - 1, draft.m, draft.d))} onPlus={() => stepTo(set(draft.y + 1, draft.m, draft.d))} />
      </div>
      {summary !== (value ? fmtValue(kind, value) : null) ? (
        <p aria-live="polite" className="mt-2 text-center text-[13px] font-medium text-slate-700 dark:text-slate-200">{summary}</p>
      ) : <span aria-live="polite" className="sr-only">{summary}</span>}
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c.l} type="button" onClick={() => { setDraft(c.v); setLastChip(c.l); }} aria-pressed={lastChip === c.l && same(c.v, draft)}
            className={`${CHIP} !px-3 ${lastChip === c.l && same(c.v, draft) ? "!border-indigo-600 !bg-indigo-50 !text-indigo-800 dark:!bg-indigo-500/15 dark:!text-indigo-200" : ""}`}>{c.l}</button>
        ))}
      </div>
      <button type="button" onClick={commit} className={`${BTN_SECONDARY} mt-3 w-full`}>Done</button>
    </div>
  ) : null;

  return (
    <HostFrame kind={kind} themeClass={themeClass} onClose={onClose} onEscape={expanded ? cancel : undefined} footer={<SaveFooter />}>
      <HostForm
        kind={kind}
        field={<FieldRow kind={kind} value={value} onOpen={toggle} expanded={expanded} controlsId={panelId} buttonRef={fieldRef} popup={false} />}
        hint={panel}
      />
    </HostFrame>
  );
}
