"use client";

import { useState } from "react";
import { ActionLink, CollapsedRow, DismissChip, GlassCard, MinimiseControl, NEEDLE_ITEM, rowLabelFor } from "./shared";

export type Surface = "home" | "penny";
export type PreviewState = "default" | "minimised";

/**
 * Variant B, "Row-first on Penny" — the payday plan is the hero of the
 * permanent section, so this variant never lets the needle card outweigh
 * it: on Penny it starts as the same one-line row Variant A's Minimise
 * collapses down to, and tapping the row expands it in place; the chevron
 * then minimises it straight back. Home is unchanged from Variant A (full
 * card, standard glass × dismiss chip) — the brief only asks Penny to
 * differ between A and B.
 *
 * Query-contract note: this directory's ?state=default|minimised pair
 * means "the state you land on" vs "the toggled alternative" everywhere
 * else in this file, but Variant B's Penny surface is row-first BY DESIGN,
 * so its own default (state=default) is already the collapsed row; the
 * alternate worth screenshotting is the expanded-in-place card, so
 * state=minimised renders that instead here (the same kind of documented
 * per-variant flip the G164 payday-plan-executed preview uses for its own
 * Variant C/Home combination).
 */
export default function VariantB({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(surface === "penny" && state === "minimised");

  if (surface === "home" && dismissed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
        Dismissed for this window. (Preview only, nothing is persisted.)
      </p>
    );
  }

  if (surface === "penny" && !expanded) {
    return <CollapsedRow label={rowLabelFor(NEEDLE_ITEM)} onClick={() => setExpanded(true)} />;
  }

  return (
    <GlassCard className="pr-12">
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">
        {NEEDLE_ITEM.headline}
      </p>
      {NEEDLE_ITEM.action && <ActionLink label={NEEDLE_ITEM.action.label} route={NEEDLE_ITEM.action.route} />}
      {surface === "home" ? (
        <DismissChip onClick={() => setDismissed(true)} />
      ) : (
        <MinimiseControl onClick={() => setExpanded(false)} />
      )}
    </GlassCard>
  );
}
