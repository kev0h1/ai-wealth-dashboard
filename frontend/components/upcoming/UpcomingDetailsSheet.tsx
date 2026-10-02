"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Pencil } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";

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
  const errorId = useId();
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

  async function dismissOccurrence(close: () => void) {
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

  return (
    <SheetFrame title={title} description={subtitle} onClose={onClose} footer={({ close, closeThen }) => (
      <>
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
                onClick={() => closeThen(onEdit)}
                disabled={isSkipping}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800 ${focus}`}
              >
                <Pencil size={16} aria-hidden="true" />
                {editLabel}
              </button>}
              {onSkipOccurrence ? (
                <button
                  type="button"
                  onClick={() => void dismissOccurrence(close)}
                  disabled={isSkipping}
                  aria-describedby={skipError ? errorId : undefined}
                  className={`min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:scale-95 disabled:cursor-wait disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800 ${focus}`}
                >
                  {isSkipping ? "Dismissing…" : skipLabel}
                </button>
              ) : null}
            </div>}
      </>
    )}>
      {children}
    </SheetFrame>
  );
}
