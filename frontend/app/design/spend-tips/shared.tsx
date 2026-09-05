"use client";

// Shared preview pieces for /design/spend-tips — TEMPORARY, delete after
// design review. See SpendTipsClient.tsx for the owner brief.

import { ChevronRight, ChevronDown } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import MoneyText from "@/components/MoneyText";
import type { SavingsInsight } from "@/lib/api";
import { sumEstimates } from "@/lib/spendTips";
import {
  MAJORITY_ROWS,
  MAJORITY_VISIBLE_COUNT,
  MAJORITY_SUM,
  MAJORITY_COUNT,
  NOTABLE_SHOPPING,
  MONEY_MOVED_TOTAL,
  type MajorityRowFixture,
} from "./fixtures";

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

// ── IconChip — 28px re-implementation. Not exported from
// SpendVerdictView.tsx, so this rebuilds it directly off getCategoryColour/
// getCategoryIcon rather than forking the whole file. A static `{}`
// colours map is passed everywhere here (no ColourProvider in this
// preview) so every category falls back to its DESIGN.md default hue. ────
function IconChip({ name, size = 28 }: { name: string; size?: number }) {
  const colour = getCategoryColour(name, {});
  // getCategoryIcon looks up a stable entry from a fixed lucide-react
  // registry (ICON_LIBRARY) rather than creating a new component — the
  // static-components rule can't tell the two apart. Same shape as the
  // IconChip this is forked from (components/SpendVerdictView.tsx), which
  // carries the identical, pre-existing lint finding.
  const Icon = getCategoryIcon(name, {});
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${colour}26`, width: size, height: size }}
    >
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon size={size >= 32 ? 16 : 13} style={{ color: colour }} />
    </span>
  );
}

// ── CategoryRow — forked from MajorityRowView's button markup
// (components/SpendVerdictView.tsx). Promotion to production edits
// MajorityRowView itself, not this copy. `subline` is caller-supplied so
// each variant can carry its own signifier logic (A/C add the tip count +
// estimate, B stays plain). ─────────────────────────────────────────────
export function CategoryRow({
  row,
  subline,
  onOpen,
}: {
  row: MajorityRowFixture;
  subline: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
    >
      <IconChip name={row.category} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.category}</p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
          <MoneyText text={subline} />
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
        {fmt(row.spent)}
      </span>
      <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </button>
  );
}

// ── The section header + 4-of-9 rows + static "Show all 9" — identical
// markup across all three variants (components/SpendVerdictView.tsx's own
// majority-section JSX), so it lives here once. `sublineFor` is the only
// thing that varies between A/C (tip-aware) and B (plain). ────────────────
export function MajoritySection({
  sublineFor,
  onOpenCategory,
}: {
  sublineFor: (row: MajorityRowFixture) => string;
  onOpenCategory: (category: string) => void;
}) {
  const visible = MAJORITY_ROWS.slice(0, MAJORITY_VISIBLE_COUNT);
  const hiddenCount = MAJORITY_ROWS.length - visible.length;
  return (
    <div>
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        <MoneyText text={`LOOKING NORMAL · £${Math.round(MAJORITY_SUM).toLocaleString("en-GB")} ACROSS ${MAJORITY_COUNT} CATEGORIES`} />
      </p>
      <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
        {visible.map((row) => (
          <CategoryRow key={row.category} row={row} subline={sublineFor(row)} onOpen={() => onOpenCategory(row.category)} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="mt-2 min-h-[44px] w-full text-center text-[12px] font-semibold text-indigo-600 dark:text-indigo-400"
        >
          Show all {MAJORITY_COUNT}
        </button>
      )}
    </div>
  );
}

// ── The "Needs a look" notable — a simplified, fully static rendering of
// NotableCardView's header (components/SpendVerdictView.tsx): chip, name,
// count + day, amount, amber-bordered "N.N× usual" badge, then a "Review
// this spending" disclosure row. No expand behaviour — this preview is
// about the majority-list grammar below it, not the notable card itself. ──
export function NotableShoppingCard() {
  const n = NOTABLE_SHOPPING;
  return (
    <section className="glass-card-flat rounded-2xl overflow-hidden" aria-label={`${n.category} needs a look`}>
      <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Needs a look</p>
      <div className="flex items-center gap-2.5 px-4 pt-2">
        <IconChip name={n.category} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{n.category}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            {n.payments_count} payment · day {n.day}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(n.spent)}</p>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-200/70 bg-amber-50/70 text-amber-700 dark:border-amber-300/15 dark:bg-amber-300/10 dark:text-amber-200">
            {n.multiple.toFixed(1)}× usual
          </span>
        </div>
      </div>
      <div className="mt-3 flex min-h-12 w-full items-center justify-between border-t border-slate-100 px-4 text-left text-[13px] font-semibold text-indigo-700 dark:border-white/10 dark:text-indigo-300">
        <span>Review this spending</span>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
    </section>
  );
}

// ── Money you moved — collapsed, static (mirrors MoneyYouMoved's closed
// header row exactly; no accordion behaviour needed for this preview). ────
export function MoneyMovedBar() {
  return (
    <div className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
        <MoneyText text={`Money you moved · £${MONEY_MOVED_TOTAL.toLocaleString("en-GB")}, not counted in spending`} />
      </p>
      <ChevronDown size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />
    </div>
  );
}

// A tip's own category-name subline is redundant whenever `app_category`
// repeats the `label` verbatim (e.g. Groceries/Groceries) — suppressed in
// that case so `expiry_line` (the honest age stamp, never a refresh-cadence
// claim — see the OWNER RULING, originally at InsightsPage.tsx ~1062, now components/InsightCard.tsx) can
// take the subline slot instead of sitting next to a duplicate word.
function tipRowSubline(tip: SavingsInsight): string {
  const parts: string[] = [];
  if (tip.app_category && tip.app_category !== tip.label) parts.push(tip.app_category);
  if (tip.expiry_line) parts.push(tip.expiry_line);
  return parts.join(" · ");
}

// ── WaysToSaveCard — the "one card as the door" (variant B/C). ────────────
export function WaysToSaveCard({
  tips,
  onOpenTip,
}: {
  tips: SavingsInsight[];
  onOpenTip: (tip: SavingsInsight) => void;
}) {
  const withEstimate = tips.filter((t) => t.savings_estimate_monthly != null);
  // fixtures.ts's sumEstimates is the single source of truth for this sum —
  // tipSubline (below) sums the exact same way, so the card total and any
  // category's subline figure can never diverge on rounding.
  const sum = sumEstimates(tips);
  const tipsWord = tips.length === 1 ? "tip" : "tips";
  const headline =
    withEstimate.length > 0 ? (
      <>
        <span className="font-mono tabular-nums">~£{sum}/mo</span> from {withEstimate.length} of {tips.length} {tipsWord}
      </>
    ) : (
      <>{tips.length} {tipsWord}, none with a number yet</>
    );

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ways to save</p>
      <p className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">{headline}</p>

      <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700/50">
        {tips.map((tip) => {
          const subline = tipRowSubline(tip);
          return (
            <button
              key={tip.id}
              type="button"
              onClick={() => onOpenTip(tip)}
              className="w-full min-h-[44px] flex items-center gap-2.5 py-2 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
            >
              <IconChip name={tip.app_category ?? tip.label} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{tip.label}</p>
                {subline && <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subline}</p>}
              </div>
              {tip.savings_estimate_monthly != null ? (
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums flex-shrink-0">
                  ~£{sumEstimates([tip])}/mo
                </span>
              ) : (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0">No number yet</span>
              )}
              <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {/* Cadence ("refreshes weekly") is never narrated to the user (OWNER
          RULING, same source as tipRowSubline's comment above) — this
          footer now carries only the door to Patterns. */}
      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-end">
        <a
          href="#"
          title="Patterns index (not built yet)"
          className="min-h-[44px] inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400"
        >
          See all in Patterns
          <ChevronRight size={12} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

// ── VariantSwitch + AnnotationPanel — in the style of
// app/design/account-rows/AccountRowsClient.tsx's bottom floating pill and
// annotation card. ─────────────────────────────────────────────────────────
export type Variant = "a" | "b" | "c";
export type Mode = "light" | "dark";
export const VARIANTS: Variant[] = ["a", "b", "c"];

export function VariantSwitch({
  variant,
  mode,
  open,
}: {
  variant: Variant;
  mode: Mode;
  /** Preview-only `?open=<category>` deep link (see SpendTipsClient.tsx) —
   *  carried through the switcher links only when the caller is already on
   *  one, so a reviewer following a `?open=Bills` link stays on that
   *  category's transactions page while flipping between variants and
   *  light/dark. */
  open?: string;
}) {
  const openQuery = open ? `&open=${encodeURIComponent(open)}` : "";
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&mode=${mode}${openQuery}`}
            className={`flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}${openQuery}`}
          className="flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

export interface VariantNote {
  title: string;
  thesis: string;
  risk: string;
}

export function AnnotationPanel({ note }: { note: VariantNote }) {
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">{note.title}</p>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Thesis</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">What it risks</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.risk}</p>
      </div>
    </div>
  );
}

