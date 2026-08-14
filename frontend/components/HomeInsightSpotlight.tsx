"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, RotateCcw } from "lucide-react";
import { api, SavingsInsight } from "@/lib/api";
import { insightCategoryIcon } from "@/lib/insightIcons";
import { customCategoryColour } from "@/lib/categories";

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
      <div className="px-4 lg:px-0">
        <div className="h-32 rounded-2xl glass-card animate-pulse" />
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

  // Category hue — deterministic from the label (ENGINE.md's Category Voice
  // rule), never violet: the indigo→violet gradient is reserved for Penny
  // alone, so a Ways-to-Save insight (not an AI-chat surface) must not wear it.
  const chipColour = customCategoryColour(insight.label);
  const ChipIcon = insightCategoryIcon(insight.category);
  const actionLabel = `Review ${insight.label.toLowerCase()}`;
  const goToInsight = () => router.push(`/insights?tab=save&insight=${encodeURIComponent(insight.id)}`);

  return (
    <div className="px-4 lg:px-0 fade-in">
      <div
        ref={cardRef}
        className="relative rounded-2xl glass-card overflow-hidden touch-pan-y"
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

        <div className="p-4">
          {/* Quiet category chip — hue + icon carry identity, no solid pill.
              Small dot (not a shouty "NEW" slab) marks a fresh insight. */}
          <div className="flex items-center gap-2 mb-3 pr-8">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: `${chipColour}1F`, color: chipColour }}
            >
              <ChipIcon size={12} strokeWidth={2.5} className="flex-shrink-0" />
              {insight.label}
              {insight.is_new && (
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: chipColour }}
                  aria-label="New"
                />
              )}
            </span>
          </div>

          {/* A resurrected insight explains itself — return without a reason reads as nagging */}
          {insight.return_reason && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1">
              <RotateCcw size={11} className="flex-shrink-0" /> Back because: {insight.return_reason}
            </p>
          )}

          {/* Verdict as headline, body as supporting line — unclamped, this
              isn't a promo blurb that can afford to lose its second half. */}
          <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
            {insight.title}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
            {insight.body}
          </p>

          {/* £-impact hero. Falls back to a verdict-led layout (headline +
              body + button, no figure) when the engine has no derivable
              estimate — never show an empty or zero hero. */}
          {insight.savings_estimate && (
            <div className="mt-3.5">
              <p className="text-3xl font-bold text-slate-900 dark:text-slate-100 leading-none num">
                {insight.savings_estimate}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">you could save</p>
            </div>
          )}

          <button
            onClick={goToInsight}
            className="mt-4 w-full h-11 rounded-xl bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white text-[13px] font-semibold active:scale-95 transition-transform"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
