"use client";

// Shared, variant-local primitives for /design/spend-period-round (G38).
// Deliberately NOT imported from components/SpendVerdictView.tsx — this is a
// design proposal, the live component must stay untouched by this branch
// (see the route's own page-level note). These are lightweight copies of the
// same formatting/visual language already shipped there (IconChip, the pace
// badge's amber threshold, the pace/cause sentence builders), kept local so
// every variant file can share one drawing of a category chip and one
// definition of "when does the badge turn amber" without re-deriving either.

import type { LucideIcon } from "lucide-react";
import { PiggyBank, CreditCard, TrendingUp, ArrowLeftRight } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { SpendVerdictCause, SpendVerdictMoved } from "@/lib/api";

export const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

// Point 9 (variant B, 2026-08-27, still the shipped rule) — amber marks
// genuine pace concern (multiple >= 2.0) only; every notable below that
// reads as a neutral slate chip. Copied verbatim from SpendVerdictView.tsx
// so this preview can never quietly drift to a different threshold.
export const AMBER_THRESHOLD = 2.0;

export function paceBadgeClasses(multiple: number): string {
  return multiple >= AMBER_THRESHOLD
    ? "border border-amber-200/70 bg-amber-50/70 text-amber-700 dark:border-amber-300/15 dark:bg-amber-300/10 dark:text-amber-200"
    : "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300";
}

export function paceLine(multiple: number, excess: number, daysElapsed: number): string {
  const dayLabel = `day ${daysElapsed}`;
  const rounded = Math.round(multiple * 10) / 10;
  if (rounded >= 1.9 && rounded <= 2.1) return `about twice your usual pace for ${dayLabel}.`;
  if (rounded > 2.1) return `about ${rounded.toFixed(1)}× your usual pace for ${dayLabel}.`;
  return `running about ${fmt(excess)} ahead of usual for ${dayLabel}.`;
}

export function causeLine(cause: SpendVerdictCause[]): string | null {
  if (!cause.length) return null;
  return `Biggest: ${cause.map((c) => `${c.name} ${fmt(c.amount)}`).join(" · ")}.`;
}

export function IconChip({
  name,
  colours,
  size = 36,
}: {
  name: string;
  colours: Record<string, string>;
  size?: number;
}) {
  const colour = getCategoryColour(name, colours);
  const Icon = getCategoryIcon(name);
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${colour}26`, width: size, height: size }}
    >
      <Icon size={size >= 32 ? 16 : 13} style={{ color: colour }} />
    </span>
  );
}

export const MOVED_ICON: Record<SpendVerdictMoved["kind"], LucideIcon> = {
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
  own_accounts: ArrowLeftRight,
};

// A single trailing figure+badge pair, ALWAYS side by side on one line —
// this is the one placement rule every variant in this round applies
// consistently (the ticket's named inconsistency: NotableCardView stacks
// this pair in a two-row grid, NotableMiniRow keeps it inline). No variant
// here ever stacks a figure over a badge; they differ in row density,
// ranking and section structure instead. `resolvedLabel` swaps the pace
// badge for a neutral "noted" chip once a row is marked one-off/new normal,
// mirroring ResolveBadge's crossfade without reproducing its animation
// machinery (a static swap is enough to demonstrate the state in a proposal
// that carries no real writes).
export function FigureBadge({
  amount,
  multiple,
  resolvedLabel,
  size = "compact",
}: {
  amount: number;
  multiple: number;
  resolvedLabel?: string | null;
  // Both steps come straight off DESIGN.md's documented type ramp: "lead" is
  // Amount-on-card (700, 19px, "the Spend notable card's spend amount is the
  // named example"), "compact" is Title (600, 14px, "row primaries") — no
  // third, undocumented size in between.
  size?: "lead" | "compact";
}) {
  const figureSize = size === "lead" ? "text-[19px]" : "text-sm";
  return (
    <span className="flex-shrink-0 inline-flex items-center gap-1.5">
      <span className={`font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 ${figureSize}`}>{fmt(amount)}</span>
      <span
        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
          resolvedLabel
            ? "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
            : paceBadgeClasses(multiple)
        }`}
      >
        {resolvedLabel ?? `${multiple.toFixed(1)}× usual`}
      </span>
    </span>
  );
}
