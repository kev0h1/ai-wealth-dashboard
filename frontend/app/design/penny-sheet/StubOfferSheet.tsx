"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// A stand-in for the real components/CommitmentSheet.tsx (not imported —
// scope fence keeps this route self-contained). Demonstrates sheet-over-
// sheet: the real CommitmentSheet portals at z-[70], the same tier the
// Penny sheet itself wants, so if a Penny sheet is ever built at that same
// tier and later opens CommitmentSheet from inside it, the two would sit
// on IDENTICAL z-index, and stacking would fall back to raw DOM order,
// working only by luck of mount sequence. This stub sits a full tier above
// (backdrop z-[75], panel z-[80]) so the layering is a deliberate contract,
// not an accident. Dismissing it returns focus and state to the Penny
// sheet underneath, untouched.

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function StubOfferSheet({ label, onClose }: { label: string; onClose: () => void }) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[75] fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add to plan"
        className="fixed inset-x-0 bottom-0 z-[80]"
        style={reducedMotion() ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl px-5 pt-3 pb-6" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mb-4" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Stand-in for CommitmentSheet
              </p>
              <h2 className="mt-1 text-[16px] font-bold text-slate-900 dark:text-slate-100">
                <span className="align-middle">{label}</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform"
            >
              <X size={15} className="text-slate-500 dark:text-slate-400" />
            </button>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            This is a stub standing in for the real commitment sheet, only here to prove a second sheet can open
            above the Penny sheet and close back down to it cleanly. Real amounts and pot pickers live in the
            production component.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Done
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
