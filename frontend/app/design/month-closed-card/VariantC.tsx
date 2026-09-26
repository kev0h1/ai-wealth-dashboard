"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import {
  ActionLink,
  CollapsedRow,
  DismissChip,
  GlassCard,
  MinimiseControl,
  NEEDLE_ITEM,
  NEEDLE_VERDICT,
  VerdictFigure,
  rowLabelFor,
} from "./shared";

export type Surface = "home" | "penny";
export type PreviewState = "default" | "minimised";

/**
 * Variant C, "Verdict row" — leads with the month's own figure (Numbers
 * Lead Rule) rather than an unadorned invitation, with the story behind a
 * disclosure. This is the one variant that changes what the card SAYS, not
 * just its controls, so it needs a real number: companion.py's needle item
 * carries none today (see shared.tsx's NEEDLE_VERDICT comment), so the
 * figure and story below are illustrative, a caution ("over usual") example
 * chosen on purpose to show the figure staying ink while a small amber dot
 * on the label carries the only caution mark (Red Is Risk, Amber Lives In
 * The Signifier). Home keeps the standard dismiss chip; Penny keeps
 * Minimise, which collapses the whole thing to the same one-line row the
 * other two variants use.
 */
export default function VariantC({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [dismissed, setDismissed] = useState(false);
  const [minimised, setMinimised] = useState(surface === "penny" && state === "minimised");
  const [storyOpen, setStoryOpen] = useState(false);

  if (surface === "home" && dismissed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
        Dismissed for this window. (Preview only, nothing is persisted.)
      </p>
    );
  }

  if (surface === "penny" && minimised) {
    return <CollapsedRow label={rowLabelFor(NEEDLE_ITEM)} onClick={() => setMinimised(false)} />;
  }

  return (
    <GlassCard className="pr-12">
      <div className="flex items-start justify-between gap-3">
        <VerdictFigure label={NEEDLE_VERDICT.label} figureText={NEEDLE_VERDICT.figureText} caution={NEEDLE_VERDICT.caution} />
      </div>

      <button
        type="button"
        onClick={() => setStoryOpen((v) => !v)}
        aria-expanded={storyOpen}
        className="mt-3 flex min-h-11 w-full touch-manipulation items-center gap-1.5 rounded-lg text-left text-[13px] font-semibold text-slate-500 [-webkit-tap-highlight-color:transparent] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
      >
        The story behind it
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`flex-shrink-0 transition-transform duration-150 motion-reduce:transition-none ${storyOpen ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: storyOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <p className="pt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
            <MoneyText text={NEEDLE_VERDICT.story} />
          </p>
          {NEEDLE_ITEM.action && (
            <div className="mt-2">
              <ActionLink label={NEEDLE_ITEM.action.label} route={NEEDLE_ITEM.action.route} />
            </div>
          )}
        </div>
      </div>

      {surface === "home" ? (
        <DismissChip onClick={() => setDismissed(true)} />
      ) : (
        <MinimiseControl onClick={() => setMinimised(true)} />
      )}
    </GlassCard>
  );
}
