"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, RotateCcw } from "lucide-react";
import { api, SavingsInsight } from "@/lib/api";
import { insightCategoryIcon } from "@/lib/insightIcons";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { useSwipeDismiss } from "@/lib/useSwipeDismiss";

// Where tapping the spotlight card body lands — the transactions hub, with
// the tip already open, rather than the retired Insights page. A bare
// `category=` alone lands on EVERY payment in that category, not just the
// evidence behind this tip, so merchant evidence is layered on top whenever
// it exists: `app_category` + merchant evidence together scope to both
// (category AND those merchants); category alone only when there's no
// merchant evidence; merchants alone when there's no `app_category` (e.g. a
// mortgage identified by merchant rather than category); plain Spend when
// neither is available (Patterns holds only charts now, 2026-09-05, so this
// fallback can no longer land there and still show anything about the
// tip). Up to 3 merchant names (matching TransactionsPage's own
// `merchants=` cap), each falling back to `merchant_key` if a `display_name`
// is somehow missing.
function spotlightHref(insight: SavingsInsight): string {
  const names = (insight.triggered_by ?? [])
    .slice(0, 3)
    .map((t) => t.display_name || t.merchant_key)
    .filter((n): n is string => Boolean(n));

  const categoryParam = insight.app_category ? `category=${encodeURIComponent(insight.app_category)}` : null;
  const merchantsParam = names.length > 0 ? `merchants=${encodeURIComponent(names.join(","))}` : null;
  const tipParam = `tip=${encodeURIComponent(insight.id)}`;

  if (categoryParam && merchantsParam) return `/transactions?${categoryParam}&${merchantsParam}&${tipParam}`;
  if (categoryParam) return `/transactions?${categoryParam}&${tipParam}`;
  if (merchantsParam) return `/transactions?${merchantsParam}&${tipParam}`;
  return "/spend";
}

interface HomeInsightSpotlightProps {
  /** Called exactly once, when this card's own first fetch settles
   *  (success or failure) — never again on the dismiss-then-load-next
   *  cycle below. Lets HomePage's full-page loading hold know this
   *  self-fetching card is done. */
  onReady?: () => void;
  /** Design previews only (/design/home-tip-gesture): render this fixture
   *  insight and make no API calls. Dismissing just hides the card. */
  previewInsight?: SavingsInsight;
}

export default function HomeInsightSpotlight({ onReady, previewInsight }: HomeInsightSpotlightProps = {}) {
  const router = useRouter();
  const [insight, setInsight] = useState<SavingsInsight | null>(previewInsight ?? null);
  const [loaded, setLoaded] = useState(Boolean(previewInsight));

  // Latest onReady in a ref, and a fired-once guard — `load()` is also
  // re-invoked after a dismiss to surface the next eligible insight, and
  // that later settle must never re-fire onReady.
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; });
  const readyFiredRef = useRef(false);

  // G207: swipe-left-to-dismiss via the shared gesture helper (axis lock,
  // cancel/lost-capture reset, reduced-motion aware). dismiss is a hoisted
  // function declaration below, so referencing it here is safe.
  const { ref: cardRef, handlers: swipe } = useSwipeDismiss<HTMLDivElement>(() => dismiss(), { axis: "x", sign: -1 });

  const load = useCallback(() => {
    if (previewInsight) return;
    api
      .getSpotlightInsight()
      .then(setInsight)
      .catch(() => setInsight(null))
      .finally(() => {
        setLoaded(true);
        if (readyFiredRef.current) return;
        readyFiredRef.current = true;
        onReadyRef.current?.();
      });
  }, [previewInsight]);

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
    if (previewInsight) return;
    try {
      await api.dismissSpotlightInsight(id);
    } catch {}
    load(); // surface the next eligible insight (or nothing)
  }

  // AI-surface card — identity via icon chip gradient (Penny Gradient Rule), no side rail
  return (
    <div className="px-4 lg:px-0 fade-in">
      <div
        ref={cardRef}
        className="relative rounded-2xl glass-card overflow-hidden touch-pan-y"
        style={{ touchAction: "pan-y" }}
        {...swipe}
      >
        {/* Dismiss × — V2 "Glass chip" (owner decision, Kevin 2026-08-27,
            /design/dismiss-x), replacing the opaque disc this used to be.
            Position/hit-area trick (absolute top-right, p-3 -m-3) is this
            card's own and stays; only the visual treatment changed to the
            translucent fill-only chip (no backdrop-filter), hairline
            border, and hover-capable-gated hover deepen. */}
        <button
          onClick={dismiss}
          aria-label="Dismiss insight"
          className="absolute top-3 right-3 z-10 p-3 -m-3 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 transition-transform duration-150"
        >
          <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
            <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
          </span>
        </button>

        <button
          onClick={() => router.push(spotlightHref(insight))}
          className="w-full text-left p-4 active:scale-[0.98] transition-transform duration-150"
        >
          {/* Topic chip + new badge — tasteful icon-chip + tint, matching
              InsightCard's CategoryChip treatment (no solid violet slabs;
              the indigo→violet gradient stays reserved for Penny). */}
          <div className="flex items-center gap-2 mb-3 pr-8">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
                {(() => {
                  const ChipIcon = insightCategoryIcon(insight.category);
                  return <ChipIcon size={15} className="text-indigo-500 dark:text-indigo-400" />;
                })()}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{insight.label}</span>
            </span>
            {insight.is_new && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex items-center gap-1">
                <PennyMark size={10} /> New
              </span>
            )}
          </div>

          {/* A resurrected insight explains itself — return without a reason reads
              as nagging. Calm/muted, not amber: this is a routine update, not a
              warning (amber is reserved for pace alerts). The backend's own
              return_reason text is already a complete, self-explanatory
              sentence (e.g. "Updated: estimated saving now ~£83/mo"), so no
              "Back because:" prefix or arrow is added here. */}
          {insight.return_reason && (
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
              <RotateCcw size={11} className="flex-shrink-0" /> <MoneyText text={insight.return_reason} />
            </p>
          )}

          {/* Title + body share a single left edge */}
          <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
            <MoneyText text={insight.title} />
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mt-1.5 line-clamp-2 text-pretty">
            <MoneyText text={insight.body} />
          </p>

          {/* No savings_estimate badge here: the canonical InsightCard
              (components/InsightCard.tsx, rendered via TipsLine.tsx on
              /transactions now) never surfaces the raw LLM-projected
              estimate as a callout, only verified_savings (genuine,
              emerald) and the user's own transaction figure (plain ink).
              Matching that, the spotlight drops the estimate badge too,
              the body copy already carries the value story. */}

          <div className="flex items-center gap-1 mt-3.5 text-sm font-semibold text-violet-600 dark:text-violet-400">
            See the payments
            <ChevronRight size={15} />
          </div>
        </button>
      </div>
    </div>
  );
}
