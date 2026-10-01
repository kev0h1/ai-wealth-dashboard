"use client";

import { ReactNode, useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

export type SheetFrameVariant = "compact" | "focused";

/**
 * An opt-in sheet shell for design rounds. It owns the overlay, dialog
 * contract and scroll boundary: header and footer remain fixed while only
 * the task body scrolls. Existing production sheets do not use it yet.
 */
export function SheetFrame({
  variant,
  title,
  description,
  children,
  footer,
  onClose,
  labelledBy,
  themeClass,
}: {
  variant: SheetFrameVariant;
  title: string;
  description?: string;
  children: ReactNode | ((controls: { close: () => void }) => ReactNode);
  footer?: ReactNode | ((controls: { close: () => void }) => ReactNode);
  onClose: () => void;
  labelledBy?: string;
  themeClass?: string;
}) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reactId = useId();
  useSheetOpen();
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
  const titleId = labelledBy ?? `sheet-frame-title-${reactId.replace(/:/g, "")}`;
  const mobileHeight = variant === "focused"
    ? "h-[calc(100dvh-1rem)]"
    : "max-h-[88dvh]";

  if (!mounted) return null;
  return createPortal(
    <div className={`${themeClass ?? ""} fixed inset-0 z-[70] flex items-end justify-center p-0 lg:items-center lg:p-6`}>
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={close} className="absolute inset-0 cursor-default bg-black/40 fade-in" />
      <section
        data-sheet-frame
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${titleId}-description` : undefined}
        className={`glass-sheet relative z-10 flex w-full max-w-[500px] flex-col overflow-hidden rounded-t-3xl border-t border-slate-200 shadow-xl dark:border-slate-700 lg:max-h-[85dvh] lg:rounded-3xl lg:border [&_button]:min-h-11 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-indigo-500 [&_input:focus-visible]:outline-2 [&_input:focus-visible]:outline-indigo-500 ${mobileHeight}`}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0 pr-3">
            <h2 id={titleId} className="text-lg font-bold text-slate-950 dark:text-slate-50">{title}</h2>
            {description ? <p id={`${titleId}-description`} className="mt-1 text-[13px] leading-5 text-slate-500 dark:text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={close} aria-label={`Close ${title}`} className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{typeof children === "function" ? children({ close }) : children}</div>
        {footer ? <footer className="shrink-0 border-t border-slate-100 px-5 pt-3 dark:border-slate-700" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>{typeof footer === "function" ? footer({ close }) : footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}
