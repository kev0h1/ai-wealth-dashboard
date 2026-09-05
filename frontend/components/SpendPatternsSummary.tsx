"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, type MoneyShape } from "@/lib/api";
import MoneyShapeHero from "@/app/insights/MoneyShapeHero";
import WhatWorksCard from "@/app/insights/WhatWorksCard";
import { usePennySheet } from "@/components/PennySheetProvider";

// The Patterns view is lazy-loaded by SpendPage. Keep its one additional
// request deduplicated and warm for the rest of the browser session; opening
// the view again paints immediately while a fresh value is requested.
let cachedMoneyShape: MoneyShape | null = null;
let inFlightMoneyShape: Promise<MoneyShape> | null = null;

function loadMoneyShape(): Promise<MoneyShape> {
  if (!inFlightMoneyShape) {
    inFlightMoneyShape = api.getMoneyShape()
      .then((shape) => {
        cachedMoneyShape = shape;
        return shape;
      })
      .finally(() => {
        inFlightMoneyShape = null;
      });
  }
  return inFlightMoneyShape;
}

function PatternsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading spending patterns">
      <div className="glass-card h-52 animate-pulse rounded-2xl" />
      <div className="glass-card h-36 animate-pulse rounded-2xl" />
    </div>
  );
}

export default function SpendPatternsSummary({
  selectedPeriod,
}: {
  selectedPeriod: { start: string; end: string; label: string };
}) {
  const [shape, setShape] = useState<MoneyShape | null>(() => cachedMoneyShape);
  const [loading, setLoading] = useState(() => cachedMoneyShape === null);
  const [error, setError] = useState(false);
  const { open } = usePennySheet();

  const refresh = useCallback(() => {
    setLoading(cachedMoneyShape === null);
    setError(false);
    return loadMoneyShape()
      .then(setShape)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
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
  }, []);

  if (loading && !shape) return <PatternsSkeleton />;

  if (!shape) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center" role="alert">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Patterns couldn&apos;t load</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your period breakdown is still available.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mx-auto mt-3 flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-label="Spending patterns">
      <MoneyShapeHero shape={shape} selectedPeriod={selectedPeriod} />
      <WhatWorksCard
        ww={shape.what_works}
        onAskPenny={(ask) => open({ screen: "spend", summary: "Patterns across pay periods", ask })}
      />
      {error && (
        <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
          Showing the most recently loaded pattern.
        </p>
      )}
    </section>
  );
}
