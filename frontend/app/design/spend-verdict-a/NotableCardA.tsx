"use client";

// Variant-local copy of the Spend notable card, forked from
// components/SpendVerdictView.tsx's NotableCardView + AimBlock (production
// untouched) for the "Verdict first" art-direction pass (/design/spend-
// verdict-a). Three changes from production, per the brief:
//
//  1. Severity ranking — `rank` (0 = the highest-multiple notable) renders
//     as the full card, always expanded, no collapse control. rank > 0
//     renders as a compact row (icon, category, figure, badge, one-line
//     pace) that expands IN PLACE on tap. The full-detail block is always
//     present in the DOM (toggled with a `hidden` class, never conditionally
//     unmounted) so nothing is destroyed by collapsing it, matching the
//     resolve-in-place `inert` convention production already uses for the
//     intent question below.
//  2. The "×usual" badge is amber only at multiple >= 2.0; below that it's
//     a neutral slate chip (DESIGN.md: colour is information — a 1.4x and a
//     2.0x are not the same fact and shouldn't share a warning colour).
//  3. The One-off / New normal pair gets real separation from the
//     glass-card-flat surface (an opaque dark:bg-slate-700 fill + border,
//     not production's dark:bg-slate-700/60) while staying SYMMETRICAL —
//     identical border/fill/ink on both buttons, differing only in label.
//     This is a neutral either/or question, so nothing here puts a thumb
//     on the scale; indigo on this card is reserved for navigate/act
//     ("See the N payments", "Set an aim"), never for one side of a choice.
//     "Set an aim" also moves from an 11px corner link into a full-width
//     labelled row.
//
// Simplification vs production: "New normal" posts directly through
// `onIntent` here rather than opening the Intent Consent Sheet first — this
// route is a visual exploration of the card's OWN chrome (badge/buttons/aim
// placement), not a re-test of the consent-sheet flow, which is unchanged
// production behaviour outside this card's scope.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Target } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { api } from "@/lib/api";
import type { Checkpoint, SpendVerdictCause, SpendVerdictNotable } from "@/lib/api";
import { fmtWhole as fmtAimWhole, daysLabel } from "@/lib/aimFormat";
import MoneyText from "@/components/MoneyText";

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

function paceLine(multiple: number, excess: number, daysElapsed: number): string {
  const dayLabel = `day ${daysElapsed}`;
  const rounded = Math.round(multiple * 10) / 10;
  if (rounded >= 1.9 && rounded <= 2.1) return `about twice your usual pace for ${dayLabel}.`;
  if (rounded > 2.1) return `about ${rounded.toFixed(1)}× your usual pace for ${dayLabel}.`;
  return `running about ${fmt(excess)} ahead of usual for ${dayLabel}.`;
}

// Compact-row summary — one line, no sentence punctuation, sits under the
// category name at 11px instead of the full card's 12px pace sentence.
function shortPaceLine(multiple: number): string {
  const rounded = Math.round(multiple * 10) / 10;
  if (rounded >= 1.9 && rounded <= 2.1) return "about twice usual";
  if (rounded > 2.1) return `${rounded.toFixed(1)}× usual`;
  return "above usual";
}

function causeLine(cause: SpendVerdictCause[]): string | null {
  if (!cause.length) return null;
  return `Biggest: ${cause.map((c) => `${c.name} ${fmt(c.amount)}`).join(" · ")}.`;
}

function IconChipA({
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

// ── Badge — amber reserved for multiple >= 2.0 (DESIGN.md: colour is
// information). Below that threshold the badge is a neutral slate chip;
// production always coloured it amber regardless of how far over usual the
// category actually ran. ─────────────────────────────────────────────────
function PaceBadge({ multiple, resolved }: { multiple: number; resolved: "one_off" | "new_normal" | null }) {
  if (resolved) {
    return (
      <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300">
        {resolved === "one_off" ? "noted · one-off" : "usual updating"}
      </span>
    );
  }
  const amber = multiple >= 2.0;
  return (
    <span
      className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
        amber
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
      }`}
    >
      {multiple.toFixed(1)}× usual
    </span>
  );
}

// ── The aim/checkpoint mechanism — same three states as production's
// AimBlock, but "Set an aim" is now a full-width, labelled, icon-led row
// (min 44px, top hairline) instead of an orphaned 11px right-aligned link,
// giving it a real place in the card's reading order rather than a corner
// afterthought. ─────────────────────────────────────────────────────────
interface AimBlockAProps {
  category: string;
  multiple: number | null;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  sym: string;
  onChanged: () => void;
}

function AimBlockA({ category, multiple, suggestedAim, checkpoint, sym, onChanged }: AimBlockAProps) {
  const [localCheckpoint, setLocalCheckpoint] = useState<Checkpoint | null>(checkpoint);
  const [aimOpen, setAimOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => { setLocalCheckpoint(checkpoint); }, [checkpoint]);

  // State A — live checkpoint: progress + cancel.
  if (localCheckpoint) {
    const { id, aim_amount, spent_so_far, days_left } = localCheckpoint;
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Target size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
          <p className="text-[12px] text-slate-600 dark:text-slate-400 truncate">
            <span className="font-mono tabular-nums">{fmtAimWhole(spent_so_far, sym)}</span> of your{" "}
            <span className="font-mono tabular-nums">{fmtAimWhole(aim_amount, sym)}</span> aim · {daysLabel(days_left)}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await api.cancelCheckpoint(id);
              setLocalCheckpoint(null);
              onChanged();
            } catch {
              // silent — user can try again
            }
          }}
          className="flex-shrink-0 min-h-[44px] text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Cancel
        </button>
      </div>
    );
  }

  const eligible = multiple != null && multiple >= 1.5 && suggestedAim != null;
  if (!eligible) return null;

  // State C — the manual offer: a real row, not a corner link.
  if (!aimOpen) {
    return (
      <button
        type="button"
        onClick={() => setAimOpen(true)}
        className="mt-3 pt-3 w-full min-h-[44px] flex items-center gap-2 border-t border-slate-100 dark:border-slate-700/60 text-left active:opacity-70 transition-opacity"
      >
        <Target size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Set an aim for {category}</span>
        <ChevronRight size={14} className="ml-auto text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
      </button>
    );
  }

  // State B — the ask, expanded inline.
  async function handleSetAim(amount?: number) {
    setSaving(true);
    setSaveError(false);
    try {
      const cp = await api.createCheckpoint(category, amount);
      setLocalCheckpoint(cp);
      setAimOpen(false);
      setCustomMode(false);
      setCustomValue("");
      onChanged();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const parsedCustom = parseFloat(customValue.replace(/[^0-9.]/g, ""));
  const customValid = !isNaN(parsedCustom) && parsedCustom > 0;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
      <div className="flex items-center gap-2 mb-1.5">
        <Target size={14} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
        <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
          Your usual {category} is about <span className="font-mono tabular-nums">{fmtAimWhole(suggestedAim!, sym)}</span> a period.
        </p>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">Aim for that this period?</p>
      {!customMode ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSetAim(undefined)}
            className="min-h-[44px] text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
            style={{ backgroundColor: "#4f46e5" }}
          >
            Set this aim
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setCustomMode(true)}
            className="min-h-[44px] text-[12px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
          >
            Choose a different amount
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700 focus-within:ring-2 focus-within:ring-indigo-500">
            <span className="text-[12px] text-slate-500 dark:text-slate-400">{sym}</span>
            <input
              autoFocus
              inputMode="decimal"
              placeholder={String(Math.round(suggestedAim!))}
              value={customValue}
              onChange={(e) => { setCustomValue(e.target.value); setSaveError(false); }}
              className="text-[12px] text-slate-900 dark:text-slate-100 bg-transparent outline-none w-16"
            />
          </div>
          <button
            type="button"
            disabled={saving || !customValid}
            onClick={() => handleSetAim(parsedCustom)}
            className="min-h-[44px] text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
            style={{ backgroundColor: "#4f46e5" }}
          >
            Set this aim
          </button>
        </div>
      )}
      {saveError && (
        <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">That didn&apos;t save. Try again.</p>
      )}
    </div>
  );
}

export interface NotableCardAProps {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  daysElapsed: number;
  /** 0 = the highest-multiple notable this period — renders as the full
   *  card, permanently expanded. > 0 renders as a compact row that expands
   *  in place on tap. */
  rank: number;
  onOpenCategory: (category: string) => void;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  sym: string;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  onAimChanged: () => void;
}

export default function NotableCardA({
  notable, colours, daysElapsed, rank, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged,
}: NotableCardAProps) {
  const isPrimary = rank === 0;
  const [expanded, setExpanded] = useState(isPrimary);
  const [resolved, setResolved] = useState<"one_off" | "new_normal" | null>(null);
  const [pending, setPending] = useState<"one_off" | "new_normal" | null>(null);
  const [intentError, setIntentError] = useState(false);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";

  async function handleIntent(answer: "one_off" | "new_normal") {
    setIntentError(false);
    setPending(answer);
    try {
      await onIntent(notable.category, answer);
      setResolved(answer);
    } catch {
      setIntentError(true);
    } finally {
      setPending(null);
    }
  }

  const badge = <PaceBadge multiple={notable.multiple} resolved={resolved} />;
  const collapsedVisible = !isPrimary && !expanded;

  return (
    <div className="glass-card-flat rounded-2xl">
      {/* Compact row — the tap target that opens a rank>0 card. Always in
          the DOM (never conditionally rendered), hidden via `display:none`
          rather than unmounted, so no state or content is lost by toggling
          it. Never shown for the primary (rank 0) card. */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={expanded}
        aria-label={`Show details for ${notable.category}`}
        className={`w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors rounded-2xl ${
          isPrimary || expanded ? "hidden" : ""
        }`}
      >
        <IconChipA name={notable.category} colours={colours} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{notable.category}</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{shortPaceLine(notable.multiple)}</p>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(notable.spent)}</span>
          {badge}
        </div>
        <ChevronDown size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
      </button>

      {/* Full card — always visible for the primary (rank 0) card; hidden
          (not unmounted) for a compact row until expanded. */}
      <div className={`p-4 ${collapsedVisible ? "hidden" : ""}`}>
        <div className="flex items-center gap-2.5">
          <IconChipA name={notable.category} colours={colours} />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">
            {notable.category}
          </p>
          {badge}
          {!isPrimary && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded={expanded}
              aria-label={`Collapse ${notable.category}`}
              className="flex-shrink-0 w-8 h-8 -mr-1 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700/40 transition-colors"
            >
              <ChevronUp size={14} className="text-slate-400 dark:text-slate-500" />
            </button>
          )}
        </div>

        <p className="mt-2 text-[19px] font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(notable.spent)}</p>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            resolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          }`}
          aria-hidden={!!resolved}
        >
          <div className="overflow-hidden">
            <p className="mt-1 text-[12px] text-slate-700 dark:text-slate-300">
              <MoneyText text={paceLine(notable.multiple, notable.excess, daysElapsed)} />
            </p>
            {notable.consequence_line?.text && (
              <p className="mt-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                <MoneyText text={notable.consequence_line.text} />
              </p>
            )}
            {cause && (
              <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400 line-clamp-2">
                <MoneyText text={cause} />
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenCategory(notable.category)}
          className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400"
        >
          See the {notable.payments_count} payment{s}
          <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
        </button>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            resolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
          }`}
          inert={!!resolved}
        >
          <div className="overflow-hidden">
            <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-400">
              {notable.prior_intent?.question ?? "Was this a one-off, or the new normal?"}
            </p>
            {/* Real separation from the glass-card-flat surface, WITHOUT a
                thumb on the scale: this is a neutral either/or question, so
                One-off and New normal get IDENTICAL border/fill/ink — the
                only difference is the label. (Adjudicated correction: an
                earlier pass tinted New normal with indigo, which reads as
                the recommended default and collides with indigo's one
                meaning elsewhere on this card — "See the N payments" and
                "Set an aim" are navigate/act, never a choice between two
                equally-valid answers.) The dark-mode invisibility this
                fixes (production's `bg-slate-100 dark:bg-slate-700/60` on
                `glass-card-flat` was ~1.2:1 against the card) is solved by
                giving BOTH buttons an opaque dark:bg-slate-700 fill plus a
                border, not by tinting one side. */}
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                disabled={pending !== null || !!resolved}
                onClick={() => handleIntent("one_off")}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {pending === "one_off" ? "Saving…" : "One-off"}
              </button>
              <button
                type="button"
                disabled={pending !== null || !!resolved}
                onClick={() => handleIntent("new_normal")}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {pending === "new_normal" ? "Saving…" : "New normal"}
              </button>
            </div>
            {intentError && (
              <p className="mt-2 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
                Couldn&apos;t save that, try again.
              </p>
            )}
          </div>
        </div>

        {!resolved && (
          <AimBlockA
            category={notable.category}
            multiple={notable.multiple}
            suggestedAim={suggestedAim}
            checkpoint={checkpoint}
            sym={sym}
            onChanged={onAimChanged}
          />
        )}
      </div>
    </div>
  );
}
