"use client";

// TipsLine — the one collapsed "N tips for X" row that sits under the
// transactions page's filter chips, above the payments, when a single
// category filter is active and that category carries open tips. Promoted
// from the /design/spend-tips preview (TransactionsMock.tsx's TipsLine +
// shared.tsx's TipStrip) once the owner picked variant A (2026-09-05); see
// DESIGN.md "Tips on Spend and the transactions page" for the doctrine this
// encodes.
//
// No card chrome: it's a row, not a card. Tapping it expands IN PLACE via
// the app's standard grid-template-rows 1fr/0fr + `inert` collapse
// convention (no motion-reduce variant needed — the global
// prefers-reduced-motion rule in globals.css already zeroes the duration):
// a single-tip category unfolds straight to that tip's InsightCard, no
// intermediate strip; a multi-tip category fans out into one TipStrip per
// tip, each of which expands to its own InsightCard. `onTipOpened` fires
// the first time a given tip's detail becomes visible (single-tip: when
// the line itself opens; multi-tip: when that tip's own strip opens) — the
// caller uses this to mark the tip opened server-side, never fired twice
// for the same tip in one mount.
//
// InsightCard (components/InsightCard.tsx) is rendered `inSheet`, which
// strips its own category/badges/pin header, primary-action CTA, and
// comparison links — the category name and "see the transactions" are
// already one scroll away on this same screen.

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { InsightCard } from "@/components/InsightCard";
import type { SavingsInsight } from "@/lib/api";
import { tipsLineText, sumEstimates } from "@/lib/spendTips";

// ── TipStrip — one compact row per open tip, used only when a category
// carries more than one. `anyOpenHasEstimate` is computed once by the
// caller (TipsLine) across every tip in the category, not just this one —
// it drives InsightCard's own "No number yet" fallback so an uncosted tip
// sitting next to a costed sibling explains its own absence rather than
// rendering nothing. ─────────────────────────────────────────────────────
export function TipStrip({
  tip,
  open,
  onToggle,
  anyOpenHasEstimate,
}: {
  tip: SavingsInsight;
  open: boolean;
  onToggle: () => void;
  anyOpenHasEstimate: boolean;
}) {
  const regionId = useId();
  const hasEstimate = tip.savings_estimate_monthly != null;
  const headline = hasEstimate
    ? `Tip · ${tip.label}, ~£${sumEstimates([tip])}/mo`
    : `Tip · ${tip.label}`;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="w-full min-h-[44px] flex items-center gap-2.5 py-2 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
      >
        <Lightbulb size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">
            <MoneyText text={headline} />
          </p>
          {tip.expiry_line && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{tip.expiry_line}</p>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      <div
        id={regionId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="pb-3">
            <InsightCard
              insight={tip}
              workflow={null}
              onPin={() => {}}
              onContextSaved={() => {}}
              anyOpenHasEstimate={anyOpenHasEstimate}
              inSheet
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TipsLine({
  category,
  tips,
  initialOpenTipId,
  onTipOpened,
}: {
  category: string;
  tips: SavingsInsight[];
  /** Deep-link (?tip=<insightId>) — opens the line AND that one tip's
   *  detail on mount, ignored if it doesn't match one of this category's
   *  own open tips. */
  initialOpenTipId?: string;
  onTipOpened?: (id: string) => void;
}) {
  const regionId = useId();
  const initialMatch = Boolean(initialOpenTipId) && tips.some((t) => t.id === initialOpenTipId);
  const [open, setOpen] = useState(initialMatch);
  const [openTipId, setOpenTipId] = useState<string | null>(initialMatch ? initialOpenTipId! : null);
  // Tips already reported to the caller this mount — a strip (or the
  // single-tip line itself) toggling closed and back open must never
  // re-fire onTipOpened for the same id.
  const notified = useRef<Set<string>>(new Set());

  // The deep-link case opens straight to a visible detail without any
  // click ever firing, so it gets its own one-shot notify on mount.
  useEffect(() => {
    if (initialMatch && initialOpenTipId) {
      notified.current.add(initialOpenTipId);
      onTipOpened?.(initialOpenTipId);
    }
    // Deliberately mount-only — this deep link is a one-time initial
    // condition, not something that should re-fire on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tips.length === 0) return null;

  const single = tips.length === 1 ? tips[0] : null;
  const anyOpenHasEstimate = tips.some((t) => t.savings_estimate_monthly != null);

  function notifyOpen(id: string) {
    if (!notified.current.has(id)) {
      notified.current.add(id);
      onTipOpened?.(id);
    }
  }

  function toggleLine() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next && single) notifyOpen(single.id);
      return next;
    });
  }

  function toggleStrip(id: string) {
    setOpenTipId((cur) => {
      const next = cur === id ? null : id;
      if (next) notifyOpen(id);
      return next;
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggleLine}
        aria-expanded={open}
        aria-controls={regionId}
        className="w-full min-h-[44px] flex items-center gap-2.5 text-left active:opacity-70 transition-opacity"
      >
        <Lightbulb size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-700 dark:text-slate-300 truncate">
          <MoneyText text={tipsLineText(category, tips)} />
        </span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      <div
        id={regionId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!open}
      >
        <div className="overflow-hidden">
          {single ? (
            <div className="pb-3">
              <InsightCard
                insight={single}
                workflow={null}
                onPin={() => {}}
                onContextSaved={() => {}}
                anyOpenHasEstimate={anyOpenHasEstimate}
                inSheet
              />
            </div>
          ) : (
            <div className="pb-2 divide-y divide-slate-100 dark:divide-slate-700/70">
              {tips.map((tip) => (
                <TipStrip
                  key={tip.id}
                  tip={tip}
                  open={openTipId === tip.id}
                  onToggle={() => toggleStrip(tip.id)}
                  anyOpenHasEstimate={anyOpenHasEstimate}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
