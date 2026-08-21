"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";
import MoneyText from "@/components/MoneyText";

interface BudgetLimitSheetProps {
  category: string;
  colour: string;      // hex colour for the category chip
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  spent: number;
  currentLimit: number;
  sym: string;         // currency symbol e.g. "£" or "KES "
  onClose: () => void;
  onSave: (newLimit: number) => void;
}

export default function BudgetLimitSheet({
  category,
  colour,
  icon: Icon,
  spent,
  currentLimit,
  sym,
  onClose,
  onSave,
}: BudgetLimitSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Pre-fill: whole number if no decimals, else 2dp.
  // When no limit is set (currentLimit === 0), leave the field empty so the
  // user starts fresh — no confusing "0" in the hero input.
  const initialValue =
    currentLimit > 0
      ? currentLimit % 1 === 0
        ? String(Math.round(currentLimit))
        : currentLimit.toFixed(2)
      : "";

  const [inputValue, setInputValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select all on mount so the user can immediately type a new value
  useEffect(() => {
    if (mounted) {
      const t = setTimeout(() => inputRef.current?.select(), 50);
      return () => clearTimeout(t);
    }
  }, [mounted]);

  const parsedLimit = parseFloat(inputValue);
  // Guard: must be a positive finite number
  const isValid = !isNaN(parsedLimit) && isFinite(parsedLimit) && parsedLimit > 0;
  const delta = isValid ? parsedLimit - spent : null;

  // ── Quick-set chips ──────────────────────────────────────────────────────
  // Three candidate values — deduped and zero-guarded; cap at 3 visible chips.
  // "Match spend" → ceil to nearest £10 (sensible floor budget).
  // "Next £50"    → ceil to nearest £50 (easy round target).
  // "Round limit" → current limit rounded to nearest £50 (tweak, not a reset).
  const matchSpend = spent > 0 ? Math.ceil(spent / 10) * 10 : 0;
  const roundUp50 = spent > 0 ? Math.ceil(spent / 50) * 50 : 0;
  const roundedLimit = currentLimit > 0 ? Math.round(currentLimit / 50) * 50 : 0;

  const chips: Array<{ value: number; label: string }> = [];

  // Only add chips with positive, distinct values
  const seen = new Set<number>();

  if (matchSpend > 0 && !seen.has(matchSpend)) {
    chips.push({ value: matchSpend, label: `Match spend · ${sym}${matchSpend}` });
    seen.add(matchSpend);
  }
  if (roundUp50 > 0 && !seen.has(roundUp50)) {
    chips.push({ value: roundUp50, label: `Next round · ${sym}${roundUp50}` });
    seen.add(roundUp50);
  }
  if (roundedLimit > 0 && !seen.has(roundedLimit) && currentLimit > 0) {
    chips.push({ value: roundedLimit, label: `Round · ${sym}${roundedLimit}` });
    seen.add(roundedLimit);
  }

  const visibleChips = chips.slice(0, 3);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — max-h-[85vh] so it never taller than the visible viewport.
          On mobile the numeric keyboard reduces the visual viewport; the sheet
          itself is flex-col so the inner scroll region shrinks and Save stays
          reachable without the keyboard burying it. padding-bottom uses the
          safe-area env so the Save button isn't flush with the home indicator. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Set ${category} budget limit`}
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={
          reduceMotion
            ? undefined
            : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }
        }
      >
        <div
          className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl flex flex-col"
          style={{ maxHeight: "85dvh" }}
        >
          {/* A. Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* B. Header row */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${colour}26` }}
              aria-hidden="true"
            >
              <Icon size={16} style={{ color: colour }} />
            </span>
            <span className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {category}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* C. Scrollable body — this region shrinks when the keyboard is up,
              keeping the input and Save button in the shrunken visible area.
              The field is near the top of this region so it's always visible. */}
          <div className="overflow-y-auto flex-1 px-5 space-y-4" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>
            {/* C1. Spent context — pay-period framing, not calendar month */}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-mono tabular-nums">
                {sym}
                {Math.abs(spent).toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>{" "}
              spent this period
            </p>

            {/* C2. Amount field — the hero; `text-2xl` makes the number the
                clear focal point. Label corrected to "Period limit". */}
            <div>
              <label
                htmlFor="budget-limit-input"
                className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1"
              >
                Period limit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">
                  {sym}
                </span>
                <input
                  id="budget-limit-input"
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  autoFocus
                  aria-label={`${category} period limit`}
                  className={`w-full min-h-[52px] pr-4 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 text-2xl font-semibold tabular-nums ${sym.length > 2 ? "pl-14" : "pl-8"}`}
                />
              </div>
            </div>

            {/* C3. Live verdict — neutral ink for "£X left" (matches the budget
                row's "left" display), red only for genuine over-budget states.
                This keeps green scarce and colour meaningful throughout the app.
                Text is tabular-nums so it doesn't jump as digits change. */}
            {delta !== null && (
              <div className="flex">
                {delta >= 0 ? (
                  <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold px-3 py-1 rounded-full inline-flex gap-1">
                    <span className="font-mono tabular-nums">
                      {sym}
                      {Math.round(delta).toLocaleString("en-GB")}
                    </span>
                    left
                  </span>
                ) : (
                  <span className="bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-sm font-semibold px-3 py-1 rounded-full inline-flex gap-1">
                    <span className="font-mono tabular-nums">
                      {sym}
                      {Math.round(Math.abs(delta)).toLocaleString("en-GB")}
                    </span>
                    over
                  </span>
                )}
              </div>
            )}

            {/* C4. Quick-set chips — fill the field on tap (no auto-save).
                Labels clarify intent ("Match spend", "Next £50", "Round"). */}
            {visibleChips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {visibleChips.map(chip => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => setInputValue(String(chip.value))}
                    className="bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-xs px-3 py-2 rounded-full min-h-[36px] active:scale-95 transition-transform"
                  >
                    <MoneyText text={chip.label} />
                  </button>
                ))}
              </div>
            )}

            {/* C5. Action buttons — Save (solid indigo, no Penny gradient),
                Cancel (quiet, ghost). Both are full-width for easy thumb reach.
                Save disabled until the field contains a valid positive number. */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={!isValid}
                onClick={() => onSave(parsedLimit)}
                className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] rounded-xl text-slate-500 dark:text-slate-400 text-sm font-semibold bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
