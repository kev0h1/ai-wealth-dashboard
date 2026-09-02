"use client";

// VARIANT-LOCAL notable-card treatment for /design/spend-verdict-b
// ("Weighted instrument"). Not a fork of components/SpendVerdictView.tsx by
// accident — see that file's NotableCardView (~L278-445) for the production
// baseline this re-weights: today every notable renders the identical
// template regardless of severity, so two stacked notables read as a form
// to fill in rather than a genuine hierarchy of "how much does this
// matter". Here the single highest-multiple notable keeps the full card;
// everything else collapses into one grouped tile of compact mini-rows.
//
// DELETE after design review, same convention as Header.tsx in this folder.

import { useEffect, useState } from "react";
import { ChevronRight, Target } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { api } from "@/lib/api";
import type { Checkpoint, SpendVerdictCause, SpendVerdictNotable } from "@/lib/api";
import { fmtWhole as fmtAimWhole, daysLabel } from "@/lib/aimFormat";
import MoneyText from "@/components/MoneyText";

const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

// Point 7 — amber is reserved for genuine pace concern (multiple >= 2.0);
// below that the badge is neutral slate. Colour is information, not
// decoration for every notable equally.
const AMBER_THRESHOLD = 2.0;

function paceLine(multiple: number, excess: number, daysElapsed: number): string {
  const dayLabel = `day ${daysElapsed}`;
  const rounded = Math.round(multiple * 10) / 10;
  if (rounded >= 1.9 && rounded <= 2.1) return `about twice your usual pace for ${dayLabel}.`;
  if (rounded > 2.1) return `about ${rounded.toFixed(1)}× your usual pace for ${dayLabel}.`;
  return `running about ${fmt(excess)} ahead of usual for ${dayLabel}.`;
}

function causeLine(cause: SpendVerdictCause[]): string | null {
  if (!cause.length) return null;
  return `Biggest: ${cause.map((c) => `${c.name} ${fmt(c.amount)}`).join(" · ")}.`;
}

function IconChip({ name, colours, size = 36 }: { name: string; colours: Record<string, string>; size?: number }) {
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

function paceBadgeClasses(multiple: number): string {
  return multiple >= AMBER_THRESHOLD
    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300";
}

// ── The aim/checkpoint mechanism — same three states as production's
// AimBlock (CategorySheet.tsx's DoorBlock, relocated), copied locally since
// this is a variant-local card, not a shared component. Point 9 — "Set an
// aim" moves from an orphaned 11px corner link to a real row in the card's
// flow: same tier/treatment as "See the N payments" directly above it
// (indigo, 12px, semibold, a leading icon instead of a trailing chevron so
// the two links read as siblings, not a hierarchy). ─────────────────────────
function AimBlock({
  category, multiple, suggestedAim, checkpoint, sym, onChanged,
}: {
  category: string;
  multiple: number | null;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  sym: string;
  onChanged: () => void;
}) {
  const [localCheckpoint, setLocalCheckpoint] = useState<Checkpoint | null>(checkpoint);
  const [aimOpen, setAimOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => { setLocalCheckpoint(checkpoint); }, [checkpoint]);

  if (localCheckpoint) {
    const { id, aim_amount, spent_so_far, days_left } = localCheckpoint;
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
        <p className="text-[12px] text-slate-600 dark:text-slate-400">
          <span className="font-mono tabular-nums">{fmtAimWhole(spent_so_far, sym)}</span> of your <span className="font-mono tabular-nums">{fmtAimWhole(aim_amount, sym)}</span> aim · {daysLabel(days_left)}
        </p>
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
          // Secondary control raised to a real 44px target — was text-only
          // with no explicit height (under the accessibility constraint).
          className="mt-1 min-h-[44px] inline-flex items-center text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Cancel this aim
        </button>
      </div>
    );
  }

  const eligible = multiple != null && multiple >= 1.5 && suggestedAim != null;
  if (!eligible) return null;

  if (!aimOpen) {
    return (
      <button
        type="button"
        onClick={() => setAimOpen(true)}
        // Secondary control raised to a real 44px target (same fix as
        // "Cancel this aim" / "Choose a different amount" below).
        className="mt-2 min-h-[44px] inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
      >
        <Target size={13} className="flex-shrink-0" aria-hidden="true" />
        Set an aim
      </button>
    );
  }

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
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
        Your usual {category} is about <span className="font-mono tabular-nums">{fmtAimWhole(suggestedAim!, sym)}</span> a period.
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 mb-2">Aim for that this period?</p>
      {!customMode ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSetAim(undefined)}
            className="text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
            style={{ backgroundColor: "#4f46e5" }}
          >
            Set this aim
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setCustomMode(true)}
            // Secondary control raised to a real 44px target.
            className="min-h-[44px] flex items-center justify-center text-[12px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
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
            className="text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
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

// ── The hero notable card — full template, reserved for the single
// highest-multiple notable. ─────────────────────────────────────────────
export function HeroNotableCard({
  notable, colours, daysElapsed, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged,
}: {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  daysElapsed: number;
  onOpenCategory: (category: string) => void;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  sym: string;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  onAimChanged: () => void;
}) {
  const [localResolved, setLocalResolved] = useState<"one_off" | "new_normal" | null>(null);
  const [pending, setPending] = useState<"one_off" | "new_normal" | null>(null);
  const [intentError, setIntentError] = useState(false);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";

  async function handleIntent(answer: "one_off" | "new_normal") {
    setIntentError(false);
    setPending(answer);
    try {
      await onIntent(notable.category, answer);
      setLocalResolved(answer);
    } catch {
      setIntentError(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <IconChip name={notable.category} colours={colours} />
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">
          {notable.category}
        </p>
        <div className="relative grid justify-items-end flex-shrink-0">
          <span
            className={`col-start-1 row-start-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-opacity duration-200 ${paceBadgeClasses(notable.multiple)} ${
              localResolved ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            {notable.multiple.toFixed(1)}× usual
          </span>
          <span
            className={`col-start-1 row-start-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 transition-opacity duration-200 ${
              localResolved ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            aria-hidden={!localResolved}
          >
            {localResolved === "one_off" ? "noted · one-off" : "usual updating"}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[19px] font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(notable.spent)}</p>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          localResolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
        aria-hidden={!!localResolved}
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
          {cause && <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400 line-clamp-2"><MoneyText text={cause} /></p>}
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

      {/* Point 8 — real separation from the glass-card-flat surface (the
          old bg-slate-100 dark:bg-slate-700/60 pair nearly vanished in dark
          mode), fixed WITHOUT tinting either option: this is a neutral
          either/or question, not a recommended-default choice, so "One-off"
          and "New normal" get IDENTICAL treatment (same border, fill, ink,
          weight) — the only difference is the label. An earlier pass tinted
          "New normal" indigo for differentiation; reverted, because (a) it
          put a thumb on the scale for a genuinely neutral question and (b)
          it collided with the indigo already in use two elements up on this
          same card ("See the N payments") and below on "Set an aim" —
          indigo on this card means exactly one thing, navigate/act, and a
          choice-pair option is neither. Contrast now comes from bg-white
          dark:bg-slate-800 (a real step up from glass-card-flat's dark fill,
          #1a2334) plus a visible slate border, applied to both buttons
          alike. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          localResolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
        inert={!!localResolved}
      >
        <div className="overflow-hidden">
          <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-400">
            {notable.prior_intent?.question ?? "Was this a one-off, or the new normal?"}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={pending !== null || !!localResolved}
              onClick={() => handleIntent("one_off")}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              {pending === "one_off" ? "Saving…" : "One-off"}
            </button>
            <button
              type="button"
              disabled={pending !== null || !!localResolved}
              onClick={() => handleIntent("new_normal")}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
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

      {!localResolved && (
        <AimBlock
          category={notable.category}
          multiple={notable.multiple}
          suggestedAim={suggestedAim}
          checkpoint={checkpoint}
          sym={sym}
          onChanged={onAimChanged}
        />
      )}
    </div>
  );
}

// ── The grouped tile — point 6. Every remaining notable (everything but
// the hero) collapses into one tile of compact mini-rows: icon, category,
// figure, multiple. No per-row one-off/new-normal question — that would
// just rebuild the "form to fill in" problem this tile exists to fix.
// Tapping a row opens that category's transactions, same Show Your Working
// contract as the hero card's own "See the N payments" link. ─────────────
export function GroupedNotablesTile({
  notables, colours, onOpenCategory,
}: {
  notables: SpendVerdictNotable[];
  colours: Record<string, string>;
  onOpenCategory: (category: string) => void;
}) {
  if (notables.length === 0) return null;
  return (
    <div className="glass-card-flat rounded-2xl overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Also running warm
      </p>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {notables.map((n) => (
          <button
            key={n.category}
            type="button"
            onClick={() => onOpenCategory(n.category)}
            // Deliberate abbreviation, not truncation — the badge drops
            // "usual" here (unlike the hero card's "2.0× usual") because a
            // mini-row is meant to read compact; the earlier version just
            // didn't give it real room to breathe before the tile's edge.
            // Right padding bumped from px-4 (16px) to pr-5 (20px) and the
            // badge gets its own ml-1 on top of the row's gap-2.5, so it
            // reads as a distinct trailing chip rather than text jammed
            // against the corner.
            className="w-full min-h-[44px] flex items-center gap-2.5 pl-4 pr-5 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
          >
            <IconChip name={n.category} colours={colours} size={28} />
            <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {n.category}
            </span>
            <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {fmt(n.spent)}
            </span>
            <span
              className={`flex-shrink-0 ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${paceBadgeClasses(n.multiple)}`}
            >
              {n.multiple.toFixed(1)}×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Splits notables into { hero, rest } — hero is the single highest-multiple
// notable (tie-broken by spend, the larger figure leads), everything else
// collapses into the grouped tile.
export function splitNotables(notables: SpendVerdictNotable[]): { hero: SpendVerdictNotable | null; rest: SpendVerdictNotable[] } {
  if (notables.length === 0) return { hero: null, rest: [] };
  const sorted = [...notables].sort((a, b) => b.multiple - a.multiple || b.spent - a.spent);
  return { hero: sorted[0], rest: sorted.slice(1) };
}
