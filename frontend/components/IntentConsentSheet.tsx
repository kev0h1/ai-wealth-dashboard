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
import { SheetFrame } from "@/components/SheetFrame";
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

  const previewLoading = previewLines == null && !previewFailed;
  const title = previewTitle ?? `File ${category} as your new normal?`;
  const lines = previewLines ?? [`This updates what counts as usual for ${category}.`];

  return (
    <SheetFrame title={title} onClose={onClose} footer={({ close }) => (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { onKeepOneOff(); close(); }} disabled={filing} className="flex-1 min-h-[44px] rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 transition-transform active:scale-95 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Keep as one-off for now</button>
        <button type="button" onClick={onFile} disabled={filing} className="flex-1 min-h-[44px] rounded-xl bg-indigo-600 text-sm font-semibold text-white transition-transform active:scale-95 disabled:opacity-50">{filing ? "Filing…" : "File it"}</button>
      </div>
    )}>
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

    </SheetFrame>
  );
}
