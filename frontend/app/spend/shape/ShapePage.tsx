"use client";

// /spend/shape — the drill-in page the Spend period view's closing
// SpendShapeCard opens (owner decisions 2026-09-05). Holds the money shape
// ONLY: the hero (with its own period/average picker), what works for you,
// and the reference shapes. No tips index here any more — tips live in
// category sublines and on the transactions page (see DESIGN.md's
// 2026-09-05 note); the Insights page this used to live inside is retired.
//
// Sticky back header modelled on app/transactions/TransactionsPage.tsx's
// own (the app's other single-column drill-in). Loading skeleton and the
// "couldn't load / Try again" card are carried over from the retired
// components/SpendPatternsSummary.tsx, which owned this same GET
// /money-shape fetch before the shared loader moved to lib/moneyShape.ts.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { MoneyShape } from "@/lib/api";
import { loadMoneyShape, peekMoneyShape } from "@/lib/moneyShape";
import { goBack } from "@/lib/goBack";
import { usePennySheet } from "@/components/PennySheetProvider";
import MoneyShapeHero from "./MoneyShapeHero";
import WhatWorksCard from "./WhatWorksCard";
import ReferenceShapesRow from "./ReferenceShapesRow";

function ShapeSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4" role="status" aria-label="Loading your money's shape">
      <div className="glass-card h-52 animate-pulse rounded-2xl" />
      <div className="glass-card h-36 animate-pulse rounded-2xl" />
    </div>
  );
}

export default function ShapePage({ shape: previewShape }: { shape?: MoneyShape } = {}) {
  const router = useRouter();
  const { open: openPennySheet } = usePennySheet();
  const isPreview = previewShape !== undefined;

  const [shape, setShape] = useState<MoneyShape | null>(() => previewShape ?? peekMoneyShape());
  const [loading, setLoading] = useState(() => !isPreview && shape === null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    if (isPreview) return Promise.resolve();
    setLoading((current) => current || shape === null);
    setError(false);
    return loadMoneyShape()
      .then(setShape)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [isPreview, shape]);

  useEffect(() => {
    if (isPreview) return;
    let active = true;
    loadMoneyShape()
      .then((next) => {
        if (active) {
          setShape(next);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
    // Preview mode never re-runs this — `previewShape` is a fixed fixture
    // for the lifetime of the mount (app/design/spend-shape's own switcher
    // remounts this component per variant/view change rather than updating
    // props in place).
  }, [isPreview]);

  const askPenny = (ask: string) => openPennySheet({ screen: "spend", summary: "Your money's shape", ask });

  return (
    <div className="min-h-dvh pb-10 lg:max-w-2xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Sticky back header — same convention as TransactionsPage.tsx (the
          app's other single-column drill-in). */}
      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-4 pt-6 pb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => goBack(router, "/spend")}
            aria-label="Back"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium uppercase tracking-wide">Spend</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Your money&rsquo;s shape</h1>
          </div>
        </div>
      </div>

      {loading && !shape ? (
        <ShapeSkeleton />
      ) : !shape ? (
        <div className="px-4 pt-4">
          <div className="glass-card rounded-2xl p-6 text-center" role="alert">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Couldn&apos;t load your money&apos;s shape</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Try again in a moment.</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mx-auto mt-3 flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
            >
              <RefreshCw size={15} aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-4">
          <MoneyShapeHero shape={shape} />
          <WhatWorksCard ww={shape.what_works} onAskPenny={askPenny} />
          <ReferenceShapesRow onAskPenny={askPenny} />
          {error && (
            <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
              Showing the most recently loaded shape.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
