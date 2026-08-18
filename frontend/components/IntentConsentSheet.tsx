"use client";

// The "New normal" consent sheet — production port of the approved
// app/design/spend-bridge/_ConsentSheet.tsx (post-audit: useSheetOpen, lg:
// breakpoint). Prices the filing BEFORE it saves: fetches
// POST /spend/intent-preview on open and renders the plain-language lines
// it returns. Mirrors the app's existing bottom-sheet pattern
// (components/AimSheet.tsx, components/TeachingSheet.tsx): solid surface
// (never backdrop-filter on the sheet itself, DESIGN.md's Glass Sheet rule),
// black/40 backdrop, rounded-t-3xl slide-up on mobile, centred rounded-3xl
// modal on ≥lg (every real sheet in the app switches at lg:, not sm:), body
// scroll locked while open.
//
// Filing is never blocked by the pricing call — a failed/pending preview
// falls back to one honest generic line, and "File it" always works. The
// actual filing write (and its own loading/error state) is owned by the
// caller (SpendPage), not this sheet: `filing`/`fileError` are controlled
// props so a failed file keeps the sheet open with an inline error rather
// than resolving the card optimistically.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { api } from "@/lib/api";

export interface IntentConsentSheetProps {
  category: string;
  onFile: () => void;
  onKeepOneOff: () => void;
  onClose: () => void;
  // filing/fileError — see the module doc above; owned by the caller.
  filing?: boolean;
  fileError?: boolean;
}

export default function IntentConsentSheet({ category, onFile, onKeepOneOff, onClose, filing, fileError }: IntentConsentSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Preview fetch — POST /spend/intent-preview {category}. Never blocks
  // filing: a rejected/never-resolved promise just leaves `lines` null,
  // which the fallback copy below covers.
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewLines, setPreviewLines] = useState<string[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewTitle(null);
    setPreviewLines(null);
    setPreviewFailed(false);
    api.intentPreview(category)
      .then((r) => {
        if (cancelled) return;
        setPreviewTitle(r.title);
        setPreviewLines(r.lines);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewFailed(true);
      });
    return () => { cancelled = true; };
  }, [category]);

  if (!mounted) return null;

  const previewLoading = previewLines == null && !previewFailed;
  const title = previewTitle ?? `File ${category} as your new normal?`;
  const lines = previewLines ?? [`This updates what counts as usual for ${category}.`];

  return createPortal(
    <>
      {/* Backdrop — solid black/40, fades in; the page behind blurs via
          #app-shell.sheet-open, not this element (Glass Sheet rule). */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — solid surface, bottom sheet on mobile, centred modal on
          ≥lg (matches AimSheet.tsx, TeachingSheet.tsx, and every other real
          sheet's breakpoint). Slide-up respects prefers-reduced-motion
          globally (app/globals.css's blanket animation-duration override),
          and motion-reduce:animate-none makes that explicit here too. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                    bottom-0 rounded-t-3xl slide-up motion-reduce:animate-none max-h-[88dvh]
                    lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-3 lg:pt-5">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug flex-1">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 -mt-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors flex-shrink-0"
          >
            <X size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <div className="px-5 pb-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Here&apos;s what that changes:
          </p>

          <div className="mt-2 space-y-2">
            {previewLoading ? (
              // Skeleton lines, not a spinner-in-content — filing itself is
              // never gated on this, so there's nothing to "wait" for here.
              <>
                <div className="h-4 w-full rounded-full bg-slate-100 dark:bg-slate-700/60 animate-pulse" />
                <div className="h-4 w-4/5 rounded-full bg-slate-100 dark:bg-slate-700/60 animate-pulse" />
              </>
            ) : (
              lines.map((line, i) => (
                <p key={i} className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {line}
                </p>
              ))
            )}
          </div>

          {fileError && (
            <p className="mt-3 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
              Couldn&apos;t save that, try again.
            </p>
          )}

          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={onKeepOneOff}
              disabled={filing}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              Keep as one-off for now
            </button>
            <button
              type="button"
              onClick={onFile}
              disabled={filing}
              className="flex-1 min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              {filing ? "Filing…" : "File it"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
