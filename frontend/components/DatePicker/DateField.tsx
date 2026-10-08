"use client";

// G136: the trigger field for the in-design date and month picker. It looks
// like the app's other inputs (slate-50 / dark slate-700, rounded-xl, indigo
// focus ring, 44 px minimum) and opens DatePickerSheet, a nested SheetFrame
// (see the mechanism note in DatePickerSheet.tsx). The value is the same ISO
// string the native inputs produced, "YYYY-MM-DD" (day) or "YYYY-MM" (month),
// so every call site's state and backend payload is unchanged.
//
// There is deliberately no hidden native input: `required` is not enforced by
// the browser here. Hosts keep their own validation in their existing submit
// path. `required` is accepted so call sites keep their prop shape; it is
// announced in the accessible name while the field is still empty.

import { useId, useRef, useState, type Ref } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { formatValue, type PickerMode } from "@/lib/calendar";
import { DatePickerSheet, type DatePickerView } from "./DatePickerSheet";

export interface DateFieldProps {
  mode: PickerMode;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** Names the field for assistive tech and titles the picker sheet. */
  label: string;
  /** Sheet title when it should differ from `label`. */
  title?: string;
  /** Lets a host <label htmlFor> point at the trigger. */
  id?: string;
  required?: boolean;
  disabled?: boolean;
  /** "filled" matches the form fields in sheets; "outlined" the white bordered ones. */
  appearance?: "filled" | "outlined";
  /** "compact" is a 44 px field for dense rows such as filters. */
  size?: "default" | "compact";
  className?: string;
  placeholder?: string;
  /** ISO day treated as today. Defaults to the local day; previews fix it. */
  today?: string;
  themeClass?: string;
  /** Shows a Clear action in the picker footer that commits "" (optional dates and filters). */
  allowClear?: boolean;
  /** Accessible wording for the empty state, for example "not set, defaults to today". */
  emptyDescription?: string;
  /** Receives the trigger button, for hosts that move focus to it on a validation error. */
  buttonRef?: Ref<HTMLButtonElement>;
  /** Start with the picker open (previews and tests). */
  defaultOpen?: boolean;
  /** View the picker opens on (previews and tests). */
  defaultView?: DatePickerView;
}

export function DateField({
  mode, value, onChange, min, max, label, title, id, required, disabled, appearance = "filled", size = "default",
  className = "", placeholder, today, themeClass, buttonRef, allowClear, emptyDescription, defaultOpen = false, defaultView,
}: DateFieldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLButtonElement>(null);
  const autoId = useId().replace(/:/g, "");
  const valueId = `${id ?? `datefield-${autoId}`}-value`;
  const text = formatValue(value, mode);
  const empty = placeholder ?? (mode === "day" ? "Choose a date" : "Choose a month");
  const skin = appearance === "outlined"
    ? "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
    : "border-transparent bg-slate-50 dark:bg-slate-700";
  const height = size === "compact" ? "min-h-11" : "min-h-12";
  return (
    <>
      <button
        ref={(node) => {
          ref.current = node;
          if (typeof buttonRef === "function") buttonRef(node);
          else if (buttonRef) (buttonRef as { current: HTMLButtonElement | null }).current = node;
        }} id={id} type="button" disabled={disabled} onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label}, ${text || emptyDescription || (required ? `${empty}, required` : empty)}`}
        className={`flex ${height} w-full items-center gap-2.5 rounded-xl border px-3 text-left text-sm transition-transform active:scale-[0.99] motion-reduce:transition-none disabled:opacity-60 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${skin} ${className}`}
      >
        <CalendarDays size={18} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span id={valueId} className={`min-w-0 flex-1 truncate ${text ? "font-medium text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}`}>{text || empty}</span>
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <DatePickerSheet
          mode={mode} value={value} min={min} max={max} title={title ?? label} today={today} themeClass={themeClass} initialView={defaultView} allowClear={allowClear}
          onCommit={onChange}
          onClose={() => { setOpen(false); requestAnimationFrame(() => ref.current?.focus({ preventScroll: true })); }}
        />
      )}
    </>
  );
}
