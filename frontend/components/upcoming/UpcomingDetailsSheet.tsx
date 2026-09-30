"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Pencil, X } from "lucide-react";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

export interface UpcomingDetailsSheetProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  onClose: () => void;
  /** Parent replaces this detail sheet with its existing prediction editor. */
  onEdit?: () => void;
  editLabel?: string;
  /** Dismisses this one occurrence only. The sheet stays open on a failed request. */
  onSkipOccurrence?: () => Promise<void>;
  skipLabel?: string;
}

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950";
const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * The shared, presentational shell for an Upcoming detail. Financial content,
 * editing and data ownership deliberately stay with the caller. It also keeps
 * a one-off dismissal honest: a rejected request is visible and retryable.
 */
export default function UpcomingDetailsSheet({
  title,
  subtitle,
  children,
  onClose,
  onEdit,
  editLabel = "Edit prediction",
  onSkipOccurrence,
  skipLabel = "Dismiss for this month",
}: UpcomingDetailsSheetProps) {
  useSheetOpen();
  const { ref: panelRef, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true });
  const titleId = useId();
  const subtitleId = useId();
  const errorId = useId();
  // Portals need a browser document; server and initial hydration agree on
  // an empty shell without a second setState-driven effect render.
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const isLiveRef = useRef(false);
  const dismissalRequestRef = useRef(0);

  useEffect(() => {
    isLiveRef.current = true;
    return () => {
      isLiveRef.current = false;
      // Makes any in-flight promise from this sheet inert after it closes.
      dismissalRequestRef.current += 1;
    };
  }, []);

  async function dismissOccurrence() {
    if (!onSkipOccurrence || isSkipping) return;
    const requestId = ++dismissalRequestRef.current;
    setIsSkipping(true);
    setSkipError(null);
    try {
      await onSkipOccurrence();
      if (!isLiveRef.current || requestId !== dismissalRequestRef.current) return;
      // Invalidate before the parent swaps this sheet out so `finally` can
      // never update an already-closing instance.
      dismissalRequestRef.current += 1;
      close();
    } catch {
      if (!isLiveRef.current || requestId !== dismissalRequestRef.current) return;
      setSkipError("We could not dismiss this occurrence. Please try again.");
    } finally {
      if (isLiveRef.current && requestId === dismissalRequestRef.current) setIsSkipping(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Pointer-only click catcher. The dialog focus trap keeps keyboard focus in the panel. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Close upcoming details"
        onClick={close}
        className="fixed inset-0 z-[65] cursor-default bg-black/45"
      />

      <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-center lg:items-center lg:p-6">
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          className="glass-sheet pointer-events-auto flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl border-t border-slate-200 dark:border-slate-700 lg:rounded-3xl lg:border lg:shadow-xl"
        >
          <div className="flex justify-center pb-1 pt-3 lg:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-600" />
          </div>

          <header className="flex items-start gap-3 px-5 pb-4 pt-2 lg:pt-5">
            <div className="min-w-0 flex-1 pt-1">
              <h2 id={titleId} className="break-words text-lg font-bold leading-6 text-slate-950 dark:text-white">{title}</h2>
              <p id={subtitleId} className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close upcoming details"
              className={`flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800 ${focus}`}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>

          <footer className="shrink-0 border-t border-slate-200 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4 dark:border-slate-700">
            {skipError && <p id={errorId} role="alert" className="mb-3 text-sm leading-5 text-slate-700 dark:text-slate-200">{skipError}</p>}
            <button
              type="button"
              onClick={close}
              disabled={isSkipping}
              className={`mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}
            >
              <ChevronLeft size={18} aria-hidden="true" />
              Back to upcoming
            </button>
            {(onEdit || onSkipOccurrence) && <div className={`grid gap-2 ${onEdit && onSkipOccurrence ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
              {onEdit && <button
                type="button"
                onClick={onEdit}
                disabled={isSkipping}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800 ${focus}`}
              >
                <Pencil size={16} aria-hidden="true" />
                {editLabel}
              </button>}
              {onSkipOccurrence ? (
                <button
                  type="button"
                  onClick={dismissOccurrence}
                  disabled={isSkipping}
                  aria-describedby={skipError ? errorId : undefined}
                  className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:scale-95 disabled:cursor-wait disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800 ${focus}`}
                >
                  {isSkipping ? "Dismissing…" : skipLabel}
                </button>
              ) : null}
            </div>}
          </footer>
        </section>
      </div>
    </>,
    document.body,
  );
}
