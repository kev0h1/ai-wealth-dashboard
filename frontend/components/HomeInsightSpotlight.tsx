"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, TrendingDown } from "lucide-react";
import { api, SavingsInsight } from "@/lib/api";

export default function HomeInsightSpotlight() {
  const router = useRouter();
  const [insight, setInsight] = useState<SavingsInsight | null>(null);
  const [loaded, setLoaded] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const startTimeRef = useRef(0);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    startXRef.current = e.clientX;
    startTimeRef.current = Date.now();
    isDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current || !cardRef.current) return;
    const dx = e.clientX - startXRef.current;
    if (dx >= 0) return; // left-swipe only
    cardRef.current.style.transform = `translateX(${dx}px)`;
    cardRef.current.style.opacity = String(Math.max(0, 1 + dx / (cardRef.current.offsetWidth * 0.55)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current || !cardRef.current) return;
    isDraggingRef.current = false;
    const dx = e.clientX - startXRef.current;
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = elapsed > 0 ? Math.abs(dx) / elapsed : 0;
    const width = cardRef.current.offsetWidth;
    if (dx < 0 && (Math.abs(dx) > width * 0.35 || velocity > 0.5)) {
      cardRef.current.style.transition = "transform 0.2s var(--ease-out), opacity 0.15s ease";
      cardRef.current.style.transform = `translateX(-${width + 20}px)`;
      cardRef.current.style.opacity = "0";
      setTimeout(() => dismiss(), 200);
    } else {
      cardRef.current.style.transition = "transform 0.25s var(--ease-out), opacity 0.2s ease";
      cardRef.current.style.transform = "translateX(0)";
      cardRef.current.style.opacity = "1";
      setTimeout(() => {
        if (cardRef.current) {
          cardRef.current.style.transition = "";
        }
      }, 250);
    }
  }

  const load = useCallback(() => {
    api
      .getSpotlightInsight()
      .then(setInsight)
      .catch(() => setInsight(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While the very first fetch is in flight, show a skeleton so the zone
  // reserves space and doesn't cause layout shift when the card arrives.
  // Once loaded, dismissed/no-insight still returns null exactly as before.
  if (!loaded) {
    return (
      <div className="mx-4 lg:mx-0">
        <div className="h-32 bg-white dark:bg-slate-800 rounded-2xl shadow-sm animate-pulse" />
      </div>
    );
  }

  if (!insight) return null;

  async function dismiss() {
    const id = insight!.id;
    setInsight(null); // hide immediately
    try {
      await api.dismissSpotlightInsight(id);
    } catch {}
    load(); // surface the next eligible insight (or nothing)
  }

  // AI-surface card — identity via icon chip gradient (Penny Gradient Rule), no side rail
  return (
    <div className="mx-4 lg:mx-0 fade-in">
      <div
        ref={cardRef}
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <button
          onClick={dismiss}
          aria-label="Dismiss insight"
          className="absolute top-3 right-3 z-10 p-3 -m-3 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform"
        >
          <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600">
            <X size={14} className="text-slate-500 dark:text-slate-300" />
          </span>
        </button>

        <button
          onClick={() => router.push(`/insights?tab=savings&insight=${encodeURIComponent(insight.id)}`)}
          className="w-full text-left p-4 active:scale-[0.99] transition-transform"
        >
          {/* Topic chip + new badge — chip uses Penny gradient as it IS an AI surface */}
          <div className="flex items-center gap-2 mb-3 pr-8">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white rounded-full pl-1.5 pr-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              <span className="text-sm leading-none">{insight.icon}</span>
              {insight.label}
            </span>
            {insight.is_new && (
              <span className="text-[11px] font-bold uppercase tracking-wide text-white bg-violet-500 rounded-full px-2 py-0.5">
                New
              </span>
            )}
          </div>

          {/* A resurrected insight explains itself — return without a reason reads as nagging */}
          {insight.return_reason && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mb-1.5">
              ↺ Back because: {insight.return_reason}
            </p>
          )}

          {/* Title + body share a single left edge */}
          <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
            {insight.title}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mt-1.5 line-clamp-2">
            {insight.body}
          </p>

          {/* The saving — the payoff, given its own callout */}
          {insight.savings_estimate && (
            <div className="flex items-start gap-2 mt-3.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
              <TrendingDown size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 leading-snug">
                {insight.savings_estimate}
              </p>
            </div>
          )}

          <div className="flex items-center gap-1 mt-3.5 text-sm font-semibold text-violet-600 dark:text-violet-400">
            See all insights
            <ChevronRight size={15} />
          </div>
        </button>
      </div>
    </div>
  );
}
