"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Renders the REAL MiscategorisedReviewSheet component (not a redrawn
// mockup) against a fixture list. This is the one surface in the recent
// change set that could not be visually verified any other way: it sits
// behind real server-side OAuth (SpendPage.tsx mounts it only once the user
// is logged in and taps the miscategorised-transfers chip) and previously
// had no /design/* route at all.
//
// Getting there required one small, additive change to the production
// component itself: MiscategorisedReviewSheet.tsx now accepts an optional
// `initialItems` prop (undefined everywhere in production) that, when
// present, renders that fixed list instead of calling
// api.getMiscategorised() on mount. Every other prop and code path is
// untouched — see the prop's doc comment in that file for the exact diff.
//
// Deep-linkable: /design/miscategorised?mode=light|dark&period=split|flat
//
// `period` exercises the "This period"/"Earlier periods" split added
// alongside SpendPage.tsx's own periodStart prop (see that prop's doc
// comment in MiscategorisedReviewSheet.tsx):
//   split (default) — PREVIEW_PERIOD_START sits between item E's date
//     (2026-08-19, newest of the "earlier" trio) and item B's date
//     (2026-08-20, oldest of the "this period" trio), so 3 fixture rows
//     land in each section and both headers render.
//   flat            — periodStart omitted entirely, same real prop-absent
//     path older callers still use — renders one flat list, no headers.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import MiscategorisedReviewSheet from "@/components/MiscategorisedReviewSheet";
import type { Transaction } from "@/lib/api";
import { PREVIEW_ACCOUNTS, PREVIEW_ITEMS, PREVIEW_PAIRS, PREVIEW_PERIOD_START } from "./fixtures";

type Mode = "light" | "dark";

export default function MiscategorisedClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const periodMode = params.get("period") === "flat" ? "flat" : "split";

  const [open, setOpen] = useState(true);
  // Records the last "Recategorise" tap so review can see the handoff fired
  // with the right transaction shape — this route has no TeachingSheet
  // stack of its own (that's a separate, already-shipped surface).
  const [lastRecategorise, setLastRecategorise] = useState<Transaction | null>(null);
  const [lastChanged, setLastChanged] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-16">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview &middot; Miscategorised review sheet &middot; {mode} &middot; {periodMode}
          </p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Review these transfers</h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            2 fixture transfer-pair suggestions (“Possibly the same transfer”, same-day and a-day-apart) above
            5 fixture miscategorised rows: a multi-payment range, a single exact amount, an unresolved account
            (both on the row and inside its expanded members), a series where count (24) outruns the 20-member
            cap, and a long payee name.
          </p>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
            {periodMode === "split"
              ? "period=split: periodStart passed, 3 rows land in “This period” and 2 in “Earlier periods”, both headers render."
              : "period=flat: periodStart omitted, one flat list, no headers (the real prop-absent path older callers still use)."}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <a href={`?mode=light&period=${periodMode}`} className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2">
              Light
            </a>
            <a href={`?mode=dark&period=${periodMode}`} className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2">
              Dark
            </a>
            <a href={`?mode=${mode}&period=split`} className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2">
              Split
            </a>
            <a href={`?mode=${mode}&period=flat`} className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2">
              Flat
            </a>
            {!open && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
              >
                Reopen sheet
              </button>
            )}
          </div>

          {lastRecategorise && (
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
              Last "Recategorise" tap: <span className="font-mono">{lastRecategorise.id}</span> —{" "}
              {lastRecategorise.merchant_name || lastRecategorise.description}
            </p>
          )}
          {lastChanged > 0 && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              onChanged fired {lastChanged}&times; (dismiss/recategorise handoff).
            </p>
          )}
        </div>

        {open && (
          <MiscategorisedReviewSheet
            onClose={() => setOpen(false)}
            onRecategorise={(tx) => setLastRecategorise(tx)}
            onChanged={() => setLastChanged((n) => n + 1)}
            accounts={PREVIEW_ACCOUNTS}
            initialItems={PREVIEW_ITEMS}
            initialPairs={PREVIEW_PAIRS}
            periodStart={periodMode === "split" ? PREVIEW_PERIOD_START : undefined}
          />
        )}
      </div>
    </div>
  );
}
