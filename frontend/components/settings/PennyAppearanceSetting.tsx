"use client";

import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import type { PennyAppearance } from "@/lib/pennyAppearance";

const OPTIONS: ReadonlyArray<{ value: PennyAppearance; label: string }> = [
  { value: "original", label: "Original" },
  { value: "outline", label: "Outline" },
  { value: "ink", label: "Ink" },
];

export default function PennyAppearanceSetting({ value, onChange }: {
  value: PennyAppearance;
  onChange: (next: PennyAppearance) => void;
}) {
  return (
    <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-700/70">
      <fieldset>
        <legend className="text-sm font-medium text-slate-800 dark:text-slate-100">Penny icon</legend>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Choose the mark used to open Penny.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {OPTIONS.map((option) => {
            const selected = value === option.value;
            return (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500 has-[:focus-visible]:ring-offset-2 dark:has-[:focus-visible]:ring-offset-slate-900 ${selected ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-200" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600"}`}
              >
                <input className="sr-only" type="radio" name="penny-appearance" value={option.value} checked={selected} onChange={() => onChange(option.value)} />
                <PennyAppearanceIcon appearance={option.value} size={32} />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
