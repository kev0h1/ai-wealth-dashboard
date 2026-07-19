"use client";

import React from "react";
import { useSheetA11y } from "@/lib/useSheetA11y";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog.
 *
 * - Renders null when `open` is false.
 * - Backdrop: fixed full-screen overlay; clicking it calls onCancel.
 * - Panel: light/dark aware, rounded-2xl, single shadow-xl (One Shadow Rule).
 * - Accessibility: role="alertdialog", aria-modal, Escape closes, Tab traps,
 *   focus restores on close (via useSheetA11y).
 * - For destructive actions only the Confirm button carries Risk Red — the
 *   panel itself stays calm ("calm under bad news" design rule).
 * - Entrance: reuses the existing `fade-in` keyframe from globals.css;
 *   prefers-reduced-motion is handled globally by the CSS rule in globals.css.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // useSheetA11y: Escape closes, Tab traps focus inside, focus returns on close.
  // Cancel is first in DOM so it receives initial focus — safer default for
  // destructive dialogs (user must actively choose the red button).
  const panelRef = useSheetA11y<HTMLDivElement>(onCancel);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/60 px-6 fade-in"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title ?? "Confirm"}
        className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 w-full max-w-xs rounded-2xl p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
            {title}
          </p>
        )}
        <div className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5">
          {message}
        </div>
        <div className="flex gap-3">
          {/* Cancel first in DOM → receives focus on open (safest default) */}
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors active:scale-95 disabled:opacity-40 ${
              destructive
                ? "bg-red-500 hover:bg-red-600"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
