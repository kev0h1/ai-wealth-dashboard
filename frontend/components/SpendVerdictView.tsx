"use client";

// The Spend hub's reading + notable cards + ask/unresolved + majority rows +
// money-you-moved — everything below the period card and summary pills.
//
// Pure presentational component: every figure comes from the /spend/verdict
// payload (backend/app/services/spend_verdict.py — Python counts, this only
// formats/narrates per-notable pace lines from numbers already computed
// server-side). No fetching, no auth. Rendered by both the real page
// (SpendPage.tsx, auth-gated) and the fixture preview route
// (/design/spend-live, auth-exempt) from the same props, so design review
// sees the exact rendered truth.
//
// ENGINE.md doctrine this view encodes:
//  - Show Your Working Rule — every notable opens onto its transactions
//    (`onOpenCategory`) and states its top causes; never a bare number.
//  - The Destination Rule — moved money renders with a destination label,
//    never a minus sign, never mixed into the spend majority.
//  - "Other" is never a category — it only ever appears as the ask card or
//    the quiet reconciliation whisper, never a majority/notable row.

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronUp, ChevronRight, PiggyBank, CreditCard, TrendingUp, ReceiptText, ArrowLeftRight, Target } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { api } from "@/lib/api";
import type {
  Checkpoint,
  SpendVerdict,
  SpendVerdictCause,
  SpendVerdictMajorityRow,
  SpendVerdictMoved,
  SpendVerdictNotable,
  SpendVerdictState,
  SpendVerdictUnresolved,
  SavingsInsight,
} from "@/lib/api";
import { fmtWhole as fmtAimWhole, daysLabel } from "@/lib/aimFormat";
import { formatDate } from "@/lib/payPeriod";
import MoneyText from "@/components/MoneyText";
import { openTipsFor, tipSubline } from "@/lib/spendTips";

// − U+2212, never ASCII hyphen-minus, for money (copy rule).
const MINUS = "−";
const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const MOVED_ICON: Record<SpendVerdictMoved["kind"], LucideIcon> = {
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
  // Plain account-to-account shuffling (backend's "own_accounts" bucket) —
  // deliberately NOT the piggy bank or any other genuine-destination icon;
  // an exchange glyph reads as "moved between", not "put somewhere".
  own_accounts: ArrowLeftRight,
};

// Point 9 (variant B) — amber is reserved for genuine pace concern
// (multiple >= 2.0); below that the badge is neutral slate. Colour is
// information (DESIGN.md's Red/Amber-Is-Risk sibling rule), not decoration
// applied to every notable equally regardless of how notable it actually
// is. Shared by the hero card's badge and every grouped mini-row's badge.
const AMBER_THRESHOLD = 2.0;
function paceBadgeClasses(multiple: number): string {
  return multiple >= AMBER_THRESHOLD
    ? "border border-amber-200/70 bg-amber-50/70 text-amber-700 dark:border-amber-300/15 dark:bg-amber-300/10 dark:text-amber-200"
    : "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300";
}

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

function IconChip({
  name,
  colours,
  iconOverrides,
  size = 36,
}: {
  name: string;
  colours: Record<string, string>;
  iconOverrides?: Record<string, string>;
  size?: number;
}) {
  const colour = getCategoryColour(name, colours);
  const Icon = getCategoryIcon(name, iconOverrides);
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${colour}26`, width: size, height: size }}
    >
      <Icon size={size >= 32 ? 16 : 13} style={{ color: colour }} />
    </span>
  );
}

// ── The aim/checkpoint mechanism, relocated onto the notable card ──────────
// This IS CategorySheet.tsx's DoorBlock (BEHAVIOURS.md Layer 4 —
// Checkpoints), moved rather than duplicated: same three states, same two
// endpoints (POST /checkpoints via api.createCheckpoint, DELETE
// /checkpoints/{id} via api.cancelCheckpoint), same consent semantics — a
// checkpoint is only ever created on an explicit tap, never automatically.
//
// What's DIFFERENT from DoorBlock: DoorBlock's "ask" state also asked the
// one-off/new-normal intent question inline. That question already has its
// own always-visible home on this card (the intent pair below, existing
// before this change) — asking it twice on the same card would contradict
// itself, so this block only ever asks about the AIM (a different question:
// "what do I do about it" vs "was this expected"). Eligibility keeps
// DoorBlock's exact threshold (multiple >= 1.5 with a suggested_aim) so
// moving the surface doesn't change who gets offered an aim.
interface AimBlockProps {
  category: string;
  multiple: number | null;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  sym: string;
  onChanged: () => void;
}

function AimBlock({ category, multiple, suggestedAim, checkpoint, sym, onChanged }: AimBlockProps) {
  const [localCheckpoint, setLocalCheckpoint] = useState<Checkpoint | null>(checkpoint);
  const [aimOpen, setAimOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => { setLocalCheckpoint(checkpoint); }, [checkpoint]);

  // State A — live checkpoint: progress + cancel (api.cancelCheckpoint).
  if (localCheckpoint) {
    const { id, aim_amount, spent_so_far, days_left } = localCheckpoint;
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
        <p className="text-[12px] text-slate-600 dark:text-slate-400">
          <span className="font-mono tabular-nums">{fmtAimWhole(spent_so_far, sym)}</span> of your <span className="font-mono tabular-nums">{fmtAimWhole(aim_amount, sym)}</span> aim · {daysLabel(days_left)}
        </p>
        {/* Point 12 — secondary control raised to a real 44px target (was
            text-only with no explicit height). */}
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
          className="mt-1 min-h-[44px] inline-flex items-center text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Cancel this aim
        </button>
      </div>
    );
  }

  const eligible = multiple != null && multiple >= 1.5 && suggestedAim != null;
  if (!eligible) return null;

  // State C — the manual offer. Point 11 (variant B) — promoted out of the
  // orphaned bottom-right 11px corner link into the card's own flow, at the
  // same tier as "See the N payments" above it: indigo, 12px, semibold, a
  // leading icon rather than a trailing chevron so the two links read as
  // siblings, not a hierarchy.
  if (!aimOpen) {
    return (
      <button
        type="button"
        onClick={() => setAimOpen(true)}
        className="mt-2 min-h-[44px] inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
      >
        <Target size={13} className="flex-shrink-0" aria-hidden="true" />
        Set an aim
      </button>
    );
  }

  // State B — the ask, expanded inline (api.createCheckpoint).
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
          {/* Point 12 — AimBlock secondary controls raised to a real 44px
              minimum target. */}
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSetAim(undefined)}
            className="min-h-[44px] flex items-center justify-center text-[12px] font-semibold text-white rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
            style={{ backgroundColor: "#4f46e5" }}
          >
            Set this aim
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setCustomMode(true)}
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
              onChange={e => { setCustomValue(e.target.value); setSaveError(false); }}
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

interface NotableCardProps {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  daysElapsed: number;
  onOpenCategory: (category: string) => void;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  sym: string;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  onAimChanged: () => void;
  // ── Resolve-in-place lifecycle (approved spend-bridge spec, ported) ──────
  // resolved — controlled resolved status for THIS card's category, mirrored
  // into local state below (same sync-from-prop pattern AimBlock already
  // uses for `checkpoint`/`localCheckpoint`). null/undefined = unanswered.
  // Driven from SpendPage's resolved map, which an Undo tap clears back to
  // null — that's what re-expands this card after an undo.
  resolved?: "one_off" | "new_normal" | null;
  // onResolved — fired only when the card resolves ITSELF (a successful
  // "One-off" post). SpendPage uses this to add the category to its resolved
  // map and show the undo toast. "New normal" never fires this directly —
  // see onNewNormalRequest below, it always defers to the consent sheet,
  // which resolves the card by updating the same controlled map instead.
  onResolved?: (category: string, answer: "one_off" | "new_normal") => void;
  // onNewNormalRequest — "New normal" never posts from the card itself; it
  // always asks the parent to open the consent sheet (which prices the
  // filing before it saves). The card takes no other action on this tap.
  onNewNormalRequest?: (category: string) => void;
  /** This category's own open tips (already filtered via openTipsFor) —
   *  feeds the "N payments · day X" subline's tip suffix (tipSubline).
   *  Never renders a callout of its own; see DESIGN.md "Tips on Spend and
   *  the transactions page". */
  tips: SavingsInsight[];
}

// ── Shared resolve-in-place state/logic (variant B refactor) ───────────────
// Extracted out of the old monolithic NotableCardView so the SAME logic
// backs both the hero card (full template, unchanged behaviour) and every
// grouped mini-row's expanded content (point 8 of the brief — a category
// collapsing into "Also running warm" must never lose its one-off/new-normal
// question, since CategorySheet.tsx deliberately does NOT carry that
// question any more, see the AimBlock comment above; this hook is what
// keeps that reachable from both surfaces without duplicating the actual
// network/error handling). Each card instance (hero or a given mini-row)
// owns its own hook call, exactly as each used to own its own useState —
// nothing here is shared ACROSS cards, only the logic shape is shared.
function useNotableResolve({
  category,
  resolved,
  onIntent,
  onResolved,
}: {
  category: string;
  resolved?: "one_off" | "new_normal" | null;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  onResolved?: (category: string, answer: "one_off" | "new_normal") => void;
}) {
  // Mirrors AimBlock's localCheckpoint/checkpoint pattern: local state seeded
  // from (and re-synced to) the controlled `resolved` prop, so the card
  // reflects both its own resolve tap AND the parent clearing it back to
  // null on an "Undo".
  const [localResolved, setLocalResolved] = useState<"one_off" | "new_normal" | null>(resolved ?? null);
  useEffect(() => { setLocalResolved(resolved ?? null); }, [resolved]);
  // In-flight + failure state for the "One-off" post — the write is real
  // (goes through `post<T>()`, which throws on non-2xx), so the card must
  // actually observe the result instead of flipping to "Got it" optimistically.
  const [pending, setPending] = useState<"one_off" | null>(null);
  const [intentError, setIntentError] = useState(false);

  async function handleOneOff() {
    setIntentError(false);
    setPending("one_off");
    try {
      await onIntent(category, "one_off");
      setLocalResolved("one_off");
      onResolved?.(category, "one_off");
    } catch {
      setIntentError(true);
    } finally {
      setPending(null);
    }
  }

  return { localResolved, pending, intentError, handleOneOff };
}

// ── Shared badge — the amber "N× usual" pace pill crossfading (200ms,
// opacity only) to a neutral "noted · one-off" / "usual updating" chip on
// resolve. Both spans share one grid cell (col-start-1 row-start-1) so the
// swap never reflows. Used by the hero card's header AND every mini-row's
// collapsed header (point 9 of the brief). ─────────────────────────────────
function ResolveBadge({ multiple, localResolved }: { multiple: number; localResolved: "one_off" | "new_normal" | null }) {
  return (
    <div className="relative grid justify-items-end flex-shrink-0">
      <span
        className={`col-start-1 row-start-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-opacity duration-200 ${paceBadgeClasses(multiple)} ${
          localResolved ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        {multiple.toFixed(1)}× usual
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
  );
}

// ── Shared body — pace/consequence/cause lines, the "See the N payments"
// link, the one-off/new-normal question and its buttons, and the aim block.
// Everything below a card's own header+figure, identical whether that header
// is the hero card's full-size version or a mini-row's compact one. This is
// what guarantees a collapsed mini-row's expanded content is the SAME
// interactive surface as the hero card, not a redrawn subset (point 8). ────
function NotableCardBody({
  notable, daysElapsed, onOpenCategory, sym, suggestedAim, checkpoint, onAimChanged, onNewNormalRequest,
  localResolved, pending, intentError, handleOneOff,
}: {
  notable: SpendVerdictNotable;
  daysElapsed: number;
  onOpenCategory: (category: string) => void;
  sym: string;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  onAimChanged: () => void;
  onNewNormalRequest?: (category: string) => void;
  localResolved: "one_off" | "new_normal" | null;
  pending: "one_off" | null;
  intentError: boolean;
  handleOneOff: () => void;
}) {
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";

  return (
    <>
      {/* Pace sentence + consequence line + Biggest line — collapse away
          together on resolve via grid-template-rows 1fr→0fr (+ opacity).
          Transition only, no keyframes; the global prefers-reduced-motion
          rule in globals.css already zeroes all durations. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
          localResolved ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
        }`}
        aria-hidden={!!localResolved}
      >
        <div className="overflow-hidden">
          <p className="mt-1 text-[12px] text-slate-700 dark:text-slate-300">
            <MoneyText text={paceLine(notable.multiple, notable.excess, daysElapsed)} />
          </p>
          {/* The priced consequence, directly below the pace line. Visually
              distinct from that muted pace line (stronger ink, font-medium)
              but deliberately NOT amber/red/bold-shouting — it is the
              "price", not a warning. */}
          {notable.consequence_line?.text && (
            <p className="mt-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
              <MoneyText text={notable.consequence_line.text} />
            </p>
          )}
          {cause && <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400 line-clamp-2"><MoneyText text={cause} /></p>}
        </div>
      </div>

      {/* Retained even compressed — Show Your Working Rule, this must stay
          tappable regardless of resolve state. */}
      <button
        type="button"
        onClick={() => onOpenCategory(notable.category)}
        className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400"
      >
        See the {notable.payments_count} payment{s}
        <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
      </button>

      {/* The question + buttons — collapses on resolve via the same
          grid-rows/opacity technique above; always rendered (never swapped
          for a "Got it" paragraph), it just clips to zero height. Undo (from
          the toast) restores `resolved` to null, which re-syncs
          localResolved and expands this back open.
          `inert` (not aria-hidden) when resolved — aria-hidden only hides
          from assistive tech, it does NOT remove descendants from the tab
          order, so a keyboard user could still Tab onto the invisible
          buttons below and re-fire the intent on a resolved card. `inert`
          removes focus, hit-testing, and AT exposure together. The buttons'
          own `disabled` conditions below also OR in `localResolved` as a
          second, independent belt.
          Point 10 (variant B) — real separation from the glass-card-flat
          surface (the old bg-slate-100 dark:bg-slate-700/60 pair nearly
          vanished in dark mode) fixed WITHOUT tinting either option: this is
          a neutral either/or question, not a recommended-default choice, so
          "One-off" and "New normal" get IDENTICAL treatment (same border,
          fill, ink, weight) — the only difference is the label. Contrast now
          comes from bg-white dark:bg-slate-800 plus a visible slate border,
          applied to both buttons alike; indigo stays reserved for
          navigate/act links elsewhere on this card ("See the N payments",
          "Set an aim"), never for a choice-pair option. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
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
              onClick={handleOneOff}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              {pending === "one_off" ? "Saving…" : "One-off"}
            </button>
            <button
              type="button"
              disabled={pending !== null || !!localResolved}
              onClick={() => onNewNormalRequest?.(notable.category)}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              New normal
            </button>
          </div>
          {intentError && (
            <p className="mt-2 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
              Couldn&apos;t save that, try again.
            </p>
          )}
        </div>
      </div>

      {/* The aim/checkpoint mechanism — a separate question from the intent
          pair above (do not merge: "was this expected" vs "what do I do
          about it"), so it renders in its own always-visible slot regardless
          of whether intent has been answered yet. Hidden once resolved — the
          compressed row has nothing left to set an aim against. */}
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
    </>
  );
}

// ── The hero notable card — full template, reserved for the single
// highest-multiple notable (point 7 of the brief). Behaviourally identical
// to the pre-variant-B card; only the badge threshold (ResolveBadge, point
// 9) and the intent-button/aim-block treatment inside NotableCardBody
// changed. ───────────────────────────────────────────────────────────────
function NotableCardView({ notable, colours, daysElapsed, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged, resolved, onResolved, onNewNormalRequest, tips }: NotableCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { localResolved, pending, intentError, handleOneOff } = useNotableResolve({
    category: notable.category,
    resolved,
    onIntent,
    onResolved,
  });
  const detailId = `notable-review-${notable.category.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  return (
    <section className="glass-card-flat rounded-2xl overflow-hidden" aria-label={`${notable.category} needs a look`}>
      <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Needs a look</p>
      <div className="flex items-center gap-2.5 px-4 pt-2">
        <IconChip name={notable.category} colours={colours} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{notable.category}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            <MoneyText
              text={`${notable.payments_count} payment${notable.payments_count === 1 ? "" : "s"} · day ${daysElapsed}${
                tipSubline(tips) ? ` · ${tipSubline(tips)}` : ""
              }`}
            />
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(notable.spent)}</p>
          <ResolveBadge multiple={notable.multiple} localResolved={localResolved} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) onAimChanged();
        }}
        aria-expanded={expanded}
        aria-controls={detailId}
        className="mt-3 flex min-h-12 w-full items-center justify-between border-t border-slate-100 px-4 text-left text-[13px] font-semibold text-indigo-700 transition-colors hover:bg-slate-50 active:bg-slate-100 dark:border-white/10 dark:text-indigo-300 dark:hover:bg-white/5 dark:active:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <span>{expanded ? "Close details" : "Review this spending"}</span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <div id={detailId} className="border-t border-slate-100 px-4 pb-4 pt-2 dark:border-white/10">
          <NotableCardBody
            notable={notable}
            daysElapsed={daysElapsed}
            onOpenCategory={onOpenCategory}
            sym={sym}
            suggestedAim={suggestedAim}
            checkpoint={checkpoint}
            onAimChanged={onAimChanged}
            onNewNormalRequest={onNewNormalRequest}
            localResolved={localResolved}
            pending={pending}
            intentError={intentError}
            handleOneOff={handleOneOff}
          />
        </div>
      )}
    </section>
  );
}

// ── A single mini-row inside the grouped "Also running warm" tile — point 8
// of the brief. Unlike an earlier throwaway preview (design/spend-verdict-b/
// NotableCards.tsx's GroupedNotablesTile), a collapsed row here is NOT a
// dead end: tapping it expands the row IN PLACE to reveal the exact same
// content the hero card shows (pace line, consequence line, biggest-causes
// line, "See the N payments", the intent pair, and the aim block), via
// NotableCardBody above. The one-off/new-normal question lives ONLY on the
// notable card in production now (deliberately moved off CategorySheet, see
// the AimBlock comment) — collapsing a category into this tile must never
// make that question unreachable. Content is always present in the DOM and
// toggled (grid-template-rows 1fr→0fr + opacity + `inert` on the collapsed
// region), never conditionally unmounted, matching the collapse convention
// already established on this file's other grid-rows blocks. ─────────────
function NotableMiniRow({ notable, colours, daysElapsed, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged, resolved, onResolved, onNewNormalRequest, tips }: NotableCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { localResolved, pending, intentError, handleOneOff } = useNotableResolve({
    category: notable.category,
    resolved,
    onIntent,
    onResolved,
  });
  const detailId = `notable-detail-${notable.category.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) onAimChanged();
        }}
        aria-expanded={expanded}
        aria-controls={detailId}
        className="w-full min-h-[44px] flex items-center gap-2.5 pl-4 pr-5 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
      >
        <IconChip name={notable.category} colours={colours} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{notable.category}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            <MoneyText
              text={`${notable.payments_count} payment${notable.payments_count === 1 ? "" : "s"} · day ${daysElapsed}${
                tipSubline(tips) ? ` · ${tipSubline(tips)}` : ""
              }`}
            />
          </p>
        </div>
        <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
          {fmt(notable.spent)}
        </span>
        <ResolveBadge multiple={notable.multiple} localResolved={localResolved} />
      </button>
      <div
        id={detailId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!expanded}
      >
        <div className="overflow-hidden px-4 pb-3">
          <NotableCardBody
            notable={notable}
            daysElapsed={daysElapsed}
            onOpenCategory={onOpenCategory}
            sym={sym}
            suggestedAim={suggestedAim}
            checkpoint={checkpoint}
            onAimChanged={onAimChanged}
            onNewNormalRequest={onNewNormalRequest}
            localResolved={localResolved}
            pending={pending}
            intentError={intentError}
            handleOneOff={handleOneOff}
          />
        </div>
      </div>
    </div>
  );
}

interface GroupedNotablesTileProps {
  notables: SpendVerdictNotable[];
  colours: Record<string, string>;
  daysElapsed: number;
  onOpenCategory: (category: string) => void;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  sym: string;
  signals?: Record<string, { suggested_aim: number | null; checkpoint: Checkpoint | null }>;
  onAimChanged: () => void;
  resolved?: Record<string, "one_off" | "new_normal">;
  onResolved?: (category: string, answer: "one_off" | "new_normal") => void;
  onNewNormalRequest?: (category: string) => void;
  /** Full, unfiltered insights list — each mini-row derives its own open
   *  tips via openTipsFor(n.category, categoryInsights). */
  categoryInsights?: SavingsInsight[];
}

// ── The grouped tile — every notable but the single highest-multiple hero
// collapses into one tile of compact mini-rows (point 7). "Also running
// warm" names the tile without repeating "notable"/"usual" language already
// used by the hero card directly above it. ─────────────────────────────────
function GroupedNotablesTile({ notables, colours, daysElapsed, onOpenCategory, onIntent, sym, signals, onAimChanged, resolved, onResolved, onNewNormalRequest, categoryInsights }: GroupedNotablesTileProps) {
  if (notables.length === 0) return null;
  return (
    <div className="glass-card-flat rounded-2xl overflow-hidden">
      <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Also running warm
      </p>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {notables.map((n) => (
          <NotableMiniRow
            key={n.category}
            notable={n}
            colours={colours}
            daysElapsed={daysElapsed}
            onOpenCategory={onOpenCategory}
            onIntent={onIntent}
            sym={sym}
            suggestedAim={signals?.[n.category]?.suggested_aim ?? null}
            checkpoint={signals?.[n.category]?.checkpoint ?? null}
            onAimChanged={onAimChanged}
            resolved={resolved?.[n.category] ?? null}
            onResolved={onResolved}
            onNewNormalRequest={onNewNormalRequest}
            tips={openTipsFor(n.category, categoryInsights ?? [])}
          />
        ))}
      </div>
    </div>
  );
}

// Splits notables into { hero, rest } — hero is the single highest-multiple
// notable (tie-broken by spend, the larger figure leads), everything else
// collapses into the grouped tile (point 7).
function splitNotables(notables: SpendVerdictNotable[]): { hero: SpendVerdictNotable | null; rest: SpendVerdictNotable[] } {
  if (notables.length === 0) return { hero: null, rest: [] };
  const sorted = [...notables].sort((a, b) => b.multiple - a.multiple || b.spent - a.spent);
  return { hero: sorted[0], rest: sorted.slice(1) };
}

// ── The unresolved-merchant ask card (impeccable's Option B) ────────────────
// Deliberately quieter than a NotableCardView, on purpose: a notable is a
// genuine overspend the engine is CONFIDENT about; this is the engine
// admitting it doesn't know something yet. Giving the two the same visual
// rank would teach the page's own grammar a lie. Same surface tier as a
// notable (glass-card-flat, not glass-tile — used top-level, glass-tile has
// no shadow in light mode and reads as ADVANCING rather than receding in
// dark), but a smaller figure (18px vs the notable's 20px), a whisper label
// instead of a coloured chip+badge header, and unfilled (not filled-primary)
// actions. `weight` governs a second, quieter density on top of that for the
// "routine" case (ENGINE.md Ask Budget Rule — this ask is worth asking, but
// nothing here says it's urgent): smaller padding/figure, no explanatory
// sentence line — one component, two densities, never a forked component.
function UnresolvedAskCard({
  largest, paymentsCount, unresolvedTotal, periodOut, weight, accountName, onCorrect, onDismiss,
}: {
  largest: NonNullable<SpendVerdictUnresolved["largest"]>;
  paymentsCount: number;
  // unresolved.total — the sum of every unplaced payment, not just `largest`.
  // Threaded through so the card can say how `largest` relates to the group
  // ("all 5 together are £X") instead of leaving the reader to guess how a
  // single £1,020 figure connects to a "5 PAYMENTS" header (owner device-
  // testing finding: the two read as contradictory without this line).
  unresolvedTotal: number;
  periodOut: number;
  weight: "material" | "routine";
  // The account this payment left from, resolved by the caller (SpendPage's
  // `accounts` state) off `largest.account_id`. Preferred over
  // `largest.display_name`, which is often just a derived, useless read on
  // the raw provider string ("Finexer") for exactly the unplaced payments
  // this card exists to ask about. Undefined when the account can't be
  // resolved (older cached payload without account_id, or no match) — falls
  // back to today's display_name/date-only rendering, never a blank
  // separator.
  accountName?: string;
  onCorrect: () => void;
  onDismiss: () => void;
}) {
  const routine = weight === "routine";
  const dateLabel = formatDate(largest.date);
  // Reserved truncate slot (flex-1 + truncate) so the name can never wrap
  // onto a second line, regardless of length — the structural fix for a bug
  // that hit even short strings ("£4.50 to Playtomic.") when the name sat at
  // the end of running prose.
  const nameSlot = accountName
    ? `${accountName} · ${dateLabel}`
    : largest.display_name
    ? `${largest.display_name} · ${dateLabel}`
    : dateLabel;
  const paymentWord = paymentsCount === 1 ? "PAYMENT" : "PAYMENTS";
  // Group relationship — only says anything when there's a group. At
  // paymentsCount === 1, `largest` IS the whole unplaced total, so today's
  // simpler singular copy stays untouched (no "biggest of 1", no redundant
  // "all 1 together" line).
  const isGroup = paymentsCount > 1;

  return (
    <div className={`glass-card-flat rounded-2xl ${routine ? "p-3" : "p-4"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
        UNPLACED · {paymentsCount} {paymentWord}
      </p>

      <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
        <span className={`flex-shrink-0 font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums ${routine ? "text-[16px]" : "text-[18px]"}`}>
          {fmt(largest.amount)}
        </span>
        <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 text-[13px]">·</span>
        <span className="truncate flex-1 min-w-0 text-[13px] font-normal text-slate-600 dark:text-slate-400">
          {nameSlot}
        </span>
      </div>

      {!routine && (
        <p className="mt-1.5 text-[13px] font-normal text-slate-700 dark:text-slate-300">
          {isGroup ? (
            <>The biggest of the {paymentsCount}. I can&apos;t place it yet.</>
          ) : (
            "I can't place this one yet."
          )}
        </p>
      )}

      <p className={`text-[11px] text-slate-500 dark:text-slate-400 ${routine ? "mt-1" : "mt-1.5"}`}>
        {isGroup ? (
          <>
            All {paymentsCount} together are <span className="font-mono tabular-nums">{fmt(unresolvedTotal)}</span>,
            counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.
          </>
        ) : (
          <>Counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.</>
        )}
      </p>

      <div className={`flex items-center gap-4 ${routine ? "mt-2" : "mt-3"}`}>
        <button
          type="button"
          onClick={onCorrect}
          className="min-h-[44px] text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
        >
          Tell me what this was
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto min-h-[44px] text-[11px] font-medium text-slate-500 dark:text-slate-500 active:opacity-70 transition-opacity"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

function MajorityRowView({
  row,
  colours,
  quietTag,
  onOpen,
  tips,
}: {
  row: SpendVerdictMajorityRow;
  colours: Record<string, string>;
  quietTag: boolean;
  onOpen: () => void;
  tips: SavingsInsight[];
}) {
  const s = row.payments_count === 1 ? "" : "s";
  const suffix = tipSubline(tips);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
    >
      <IconChip name={row.category} colours={colours} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.category}</p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
          {row.payments_count} payment{s}
          {quietTag && <span className="text-amber-700 dark:text-amber-300 font-semibold"> · above usual</span>}
          {suffix && <MoneyText text={` · ${suffix}`} />}
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(row.spent)}</span>
      <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </button>
  );
}

// ── The "Other" row — deliberately outside the counted majority list ───────
// ENGINE.md keeps "Other" out of the majority baseline/multiple/peer-tile
// machinery on purpose; this is the agreed compromise: one visually
// subordinate row at the END of the section (never hidden behind "Show
// all", never folded into the header's sum/count). Mirrors
// MajorityRowView's row geometry (min-h-[44px], same padding, same amount
// styling) but reuses IconChip's grey "Other" colour and drops every
// judged-category signal (no pace tag, no amber, no multiple).
function OtherRowView({ total, paymentsCount, colours, onOpen }: {
  total: number;
  paymentsCount: number;
  colours: Record<string, string>;
  onOpen: () => void;
}) {
  const s = paymentsCount === 1 ? "" : "s";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
    >
      <IconChip name="Other" colours={colours} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Other</p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
          {paymentsCount} payment{s} · still placing
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(total)}</span>
    </button>
  );
}

function MoneyYouMoved({
  moved,
  onOpenRow,
  initialOpen,
  onOpenChange,
}: {
  moved: SpendVerdictMoved[];
  onOpenRow?: (m: SpendVerdictMoved) => void;
  // Restores whatever the user last left this accordion at (see
  // lib/spendUiState.ts) — seeded once at mount so a restored-open
  // accordion renders open on the very first paint, never animating open
  // after the fact.
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen ?? false);
  if (moved.length === 0) return null;
  const total = moved.reduce((sum, m) => sum + m.amount, 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Write the new value BEFORE anything else can happen — the
          // header tap and a later row tap (which navigates to
          // /transactions) are two separate user actions, but this keeps
          // the persisted flag synchronous with the toggle itself rather
          // than folded into setOpen's updater (a state updater should stay
          // pure; the sessionStorage write is a side effect and belongs
          // outside it).
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl"
      >
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
          Money you moved · <span className="font-mono tabular-nums">{fmt(total)}</span>, not counted in spending
        </p>
        {open ? (
          <ChevronUp size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />
        ) : (
          <ChevronDown size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />
        )}
      </button>
      {open && (
        <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
          {moved.map((m) => {
            const Icon = MOVED_ICON[m.kind];
            const s = m.payments_count === 1 ? "" : "s";
            const sub = m.goal_names?.length
              ? `${m.goal_names.join(" · ")} · ${m.payments_count} payment${s}`
              : `${m.payments_count} payment${s}`;
            const rowContent = (
              <>
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700/60">
                  <Icon size={13} className="text-slate-400 dark:text-slate-500" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{m.label}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{sub}</p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0 font-mono tabular-nums">
                  {fmt(m.amount)}
                </span>
              </>
            );
            // Every category row above (notables/majority) already routes
            // into /transactions on tap (Show Your Working Rule) — these
            // rows were plain non-interactive divs. `m.categories` is
            // optional/additive: an older payload without it means the
            // backend can't tell this row's underlying categories yet, so
            // the row stays exactly as non-interactive as it was before
            // this field existed, rather than routing to an empty filter.
            const clickable = !!m.categories && m.categories.length > 0;
            return clickable ? (
              <button
                key={m.kind}
                type="button"
                onClick={() => onOpenRow?.(m)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 min-h-[44px] text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
              >
                {rowContent}
              </button>
            ) : (
              <div key={m.kind} className="flex items-center gap-2.5 px-4 py-2.5 min-h-[44px]">
                {rowContent}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Section header — never claims "normal" for states where nothing can
// honestly be claimed normal yet (approved-spec review fix).
function majorityHeader(state: SpendVerdictState, sum: number, count: number): string {
  const tail = `£${Math.round(sum).toLocaleString("en-GB")} ACROSS ${count} CATEGOR${count === 1 ? "Y" : "IES"}`;
  switch (state) {
    case "normal":
    case "nothing":
      return `LOOKING NORMAL · ${tail}`;
    case "everything":
      return `WHERE THE REST WENT · ${tail}`;
    case "nobaseline":
      return `WHERE YOUR MONEY WENT · ${tail}`;
    case "early":
    default:
      return `SO FAR THIS PERIOD · ${tail}`;
  }
}

const MAJORITY_COLLAPSE_AT = 3;

export interface SpendVerdictViewProps {
  verdict: SpendVerdict;
  colours: Record<string, string>;
  onOpenCategory: (category: string) => void;
  /** Every current insight, unfiltered — each row/card derives its own
   *  category's OPEN tips via openTipsFor(category, categoryInsights),
   *  which is what actually excludes quiet/verified/substituted entries.
   *  Feeds only the subline signifier now (count + estimate); tips never
   *  render as a callout on Spend, see DESIGN.md "Tips on Spend and the
   *  transactions page". */
  categoryInsights?: SavingsInsight[];
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  // The aim/checkpoint mechanism, relocated onto the notable card from
  // CategorySheet's DoorBlock (see AimBlock above). `signals` mirrors
  // SpendPage.tsx's category-signals map (suggested_aim + checkpoint only —
  // `multiple` comes from the notable itself, already the same underlying
  // figure per-category-signals feeds both). Optional so this preview route
  // and any caller that hasn't wired signals yet degrades to "no aim shown"
  // rather than crashing.
  signals?: Record<string, { suggested_aim: number | null; checkpoint: Checkpoint | null }>;
  sym?: string;
  onAimChanged?: () => void;
  // "Tell me what this was" opens the teaching sheet directly on the
  // unresolved transaction (ENGINE.md — Ask tier). Optional so this preview
  // route and any caller that hasn't wired the sheet yet still falls back to
  // opening the (synthetic) "Other" category sheet via onOpenCategory.
  onAskCorrect?: () => void;
  // ── Minimal, additive, opt-in extension points for the top-region redesign
  // (spend-header project, 2026-08). Every one of these defaults to the
  // existing behaviour when omitted, so no current caller's rendered output
  // changes. They exist because the reading and the majority breakdown are
  // the two pieces of this frozen body that the Verdict Header needs to
  // reach into — one to relocate, one to link to as "evidence" — without
  // forking this component.
  //
  // hideReading — the Verdict Header (SpendHeader.tsx) renders the reading
  // itself (20px hero treatment); this suppresses this component's own 16px
  // rendering of the same string so it never appears twice. Always true for
  // every current caller.
  hideReading?: boolean;
  // aboveMajority — the "THIS PERIOD | OVER TIME" segmented control renders
  // here, immediately above the majority section header, styled as
  // that section's own header row. Undefined renders nothing (today's
  // layout, byte-identical).
  aboveMajority?: React.ReactNode;
  // expandMajoritySignal — bumped (any new value) by the header's "Out"
  // tap to force the majority list open before scrolling to
  // #spend-majority-section — the exact reconciled transactions behind the
  // Out figure (Show Your Working Rule). Never shrinks it back down.
  expandMajoritySignal?: number;
  // ── The miscategorised-transfers guardrail card (ENGINE.md — "the
  // doctrine in miniature": the engine states a belief, the user confirms
  // or corrects, the engine learns). Lived inside the old header's summary
  // pills block; rehomed here as the body's own quiet first card now that
  // the header is the Verdict Header (glass-hero + Out/In only) — this is
  // "the body", not orphaned chrome between the hero and it. Conditional,
  // quiet, absent at zero, never an inbox.
  miscategorisedCount?: number;
  onMiscategorisedTap?: () => void;
  // pairCount — additive count of suggested cross-account transfer pairs
  // (own section of the same "Review these transfers" sheet, see
  // MiscategorisedReviewSheet.tsx). Folds into the banner's total alongside
  // miscategorisedCount; the banner's copy switches to naming both kinds of
  // row once pairCount > 0, and stays exactly as shipped when it's 0.
  pairCount?: number;
  // reviewTotal — additive, all-time total mirroring exactly what the
  // review sheet shows (series + pairs: uncapped series count + the
  // pairs-suggestion endpoint's own cap of 10, see analytics.py). When
  // present it is authoritative for both the banner's visibility and its
  // copy — this is what fixes the banner-vs-sheet mismatch (period-scoped
  // count opening an all-time sheet). When absent (an older cached payload
  // fetched before this field existed), the component falls back to the
  // previous miscategorisedCount + pairCount period-scoped logic unchanged.
  reviewTotal?: number;
  // ── Resolve-in-place lifecycle (approved spend-bridge spec, ported) ──────
  // resolved — category → answer map, the controlled source of truth for
  // every card's resolve state (see NotableCardProps.resolved above). A
  // category with no entry is unanswered. Threaded straight through to
  // every notable card.
  resolved?: Record<string, "one_off" | "new_normal">;
  // onResolved — see NotableCardProps.onResolved above; threaded straight
  // through to every notable card.
  onResolved?: (category: string, answer: "one_off" | "new_normal") => void;
  // onNewNormalRequest — see NotableCardProps.onNewNormalRequest above;
  // threaded straight through to every notable card.
  onNewNormalRequest?: (category: string) => void;
  // unresolvedAccountName — the account `unresolved.largest` left from,
  // resolved by the caller (SpendPage.tsx's `accounts` state, matched off
  // `unresolved.largest.account_id`) since this component has no accounts
  // list of its own. See UnresolvedAskCard's `accountName` prop doc above.
  unresolvedAccountName?: string;
  // onOpenMoved — a "money you moved" row's tap target (Change 6, Show Your
  // Working Rule parity with the notable/majority rows above it). Only
  // called for rows SpendVerdictView itself has already gated on
  // `m.categories` being present/non-empty — see MoneyYouMoved above.
  onOpenMoved?: (m: SpendVerdictMoved) => void;
  // ── BACK-navigation restore (lib/spendUiState.ts) — SpendPage seeds these
  // from sessionStorage once at its own mount and re-persists on change, so
  // a round trip to /transactions and back restores the majority list's
  // "Show all" expansion and the "Money you moved" accordion exactly as the
  // user left them, instead of re-collapsing/re-truncating on every visit.
  // Both default to false/collapsed (today's byte-identical behaviour) when
  // omitted — every other caller (the /design/spend-* fixture routes) never
  // passes these and is unaffected.
  initialMajorityExpanded?: boolean;
  onMajorityExpandedChange?: (expanded: boolean) => void;
  initialMovedOpen?: boolean;
  onMovedOpenChange?: (open: boolean) => void;
}

export default function SpendVerdictView({ verdict, colours, onOpenCategory, categoryInsights, onIntent, signals, sym = "£", onAimChanged, onAskCorrect, hideReading, aboveMajority, expandMajoritySignal, miscategorisedCount = 0, onMiscategorisedTap, pairCount = 0, reviewTotal, resolved, onResolved, onNewNormalRequest, unresolvedAccountName, onOpenMoved, initialMajorityExpanded, onMajorityExpandedChange, initialMovedOpen, onMovedOpenChange }: SpendVerdictViewProps) {
  // Optimistic, in-session hide the instant "Not now" is tapped — the real
  // persistence is server-side (POST /spend/verdict/dismiss-unresolved sets
  // unresolved.ask_worthy=false on every future fetch for this transaction,
  // the same durable pattern the miscategorised guardrail uses). This local
  // flag only covers the gap before a remount would otherwise re-read a
  // stale cached payload — it is never the source of truth.
  const [askDismissed, setAskDismissed] = useState(false);
  // Seeded from initialMajorityExpanded (restored state) so a returning
  // visit renders already-expanded on the very first paint — never a
  // collapsed flash that then re-opens.
  const [majorityExpanded, setMajorityExpanded] = useState(initialMajorityExpanded ?? false);
  useEffect(() => {
    if (expandMajoritySignal != null) setMajorityExpanded(true);
    // Only ever forces OPEN — never re-collapses on a later signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandMajoritySignal]);

  const { state, reading, notables, quiet_flags, majority, unresolved, moved, pills, period } = verdict;
  const daysElapsed = period.days_elapsed;

  const quietFlagCategories = new Set(quiet_flags.map((q) => q.category));
  const nonZeroRows = majority.filter((r) => r.spent > 0);
  const zeroRows = majority.filter((r) => r.spent <= 0);
  const visibleRows = majorityExpanded ? nonZeroRows : nonZeroRows.slice(0, MAJORITY_COLLAPSE_AT);
  const hiddenCount = nonZeroRows.length - visibleRows.length;
  const headerSum = nonZeroRows.reduce((s, r) => s + r.spent, 0);

  const showAskCard = unresolved.ask_worthy && !askDismissed && unresolved.largest != null;

  async function handleDismissAsk() {
    const txnId = unresolved.largest?.id;
    setAskDismissed(true); // instant — never block the tap on the network
    if (!txnId) return;
    try {
      await api.dismissUnresolvedAsk(txnId);
    } catch {
      // Best-effort persistence — worst case this exact ask can resurface
      // on a later visit; it must never re-show it on THIS one, so the
      // optimistic local flag above already stands regardless.
    }
  }

  return (
    <div>
      {/* Miscategorised-transfers guardrail — quiet, absent at zero, the
          body's own first card (see the prop doc above for why it lives
          here rather than between the hero and the body). Tapping it opens
          a review sheet that has always listed the all-time backlog, so the
          banner now counts by reviewTotal (also all-time) when the server
          has sent it — the banner's number and the sheet's contents match
          exactly, which is the whole point of this field. Older cached
          payloads without reviewTotal fall back to the previous
          period-scoped miscategorisedCount + pairCount total below; that
          fallback is a live compatibility path, not dead code. */}
      {(reviewTotal ?? (miscategorisedCount + pairCount)) > 0 && (
        <button
          type="button"
          onClick={onMiscategorisedTap}
          className="w-full glass-tile rounded-xl px-3 py-2 flex items-center gap-2 active:scale-95 transition-transform"
        >
          <ReceiptText size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <span className="flex-1 text-left text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {/* reviewTotal, when present, is the all-time count the sheet
                will actually show — plain "N to review", no scope caveat
                needed since there's no mismatch left to explain. Without it
                (old cached payload predating this field), fall back to the
                original period-scoped wording: naming "this period"
                explicitly, since that count vs. the sheet's all-time list
                would otherwise read as contradictory. */}
            {reviewTotal != null
              ? `${reviewTotal} transfer${reviewTotal !== 1 ? "s" : ""} to review`
              : pairCount > 0
                ? `${miscategorisedCount + pairCount} transfer${miscategorisedCount + pairCount !== 1 ? "s" : ""} to review this period`
                : `${miscategorisedCount} transfer${miscategorisedCount !== 1 ? "s" : ""} this period may be miscategorised`}
          </span>
          <ChevronRight size={12} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
        </button>
      )}

      {/* The reading — no card chrome, ink, 16px/700. Suppressed when the
          top region has already rendered it (hideReading — the Verdict
          Header renders its own 20px hero reading instead). */}
      {!hideReading && (
        <p className="px-1 text-base font-bold leading-snug text-slate-900 dark:text-slate-100"><MoneyText text={reading} /></p>
      )}

      {/* Notable cards — point 7 (variant B): ranked by multiple descending,
          the single highest renders as the full hero card, everything else
          collapses into one grouped "Also running warm" tile of expandable
          mini-rows (GroupedNotablesTile/NotableMiniRow above) rather than
          every notable rendering the identical full template regardless of
          severity. */}
      {notables.length > 0 && (() => {
        const { hero, rest } = splitNotables(notables);
        return (
          <div className="mt-3 flex flex-col gap-3">
            {hero && (
              <NotableCardView
                key={hero.category}
                notable={hero}
                colours={colours}
                daysElapsed={daysElapsed}
                onOpenCategory={onOpenCategory}
                onIntent={onIntent}
                sym={sym}
                suggestedAim={signals?.[hero.category]?.suggested_aim ?? null}
                checkpoint={signals?.[hero.category]?.checkpoint ?? null}
                onAimChanged={onAimChanged ?? (() => {})}
                resolved={resolved?.[hero.category] ?? null}
                onResolved={onResolved}
                onNewNormalRequest={onNewNormalRequest}
                tips={openTipsFor(hero.category, categoryInsights ?? [])}
              />
            )}
            <GroupedNotablesTile
              notables={rest}
              colours={colours}
              daysElapsed={daysElapsed}
              onOpenCategory={onOpenCategory}
              onIntent={onIntent}
              sym={sym}
              signals={signals}
              onAimChanged={onAimChanged ?? (() => {})}
              resolved={resolved}
              onResolved={onResolved}
              onNewNormalRequest={onNewNormalRequest}
              categoryInsights={categoryInsights}
            />
          </div>
        );
      })()}

      {/* Ask / unresolved — deliberately quieter than a notable card (see
          UnresolvedAskCard above); mt-5 (not mt-3) so it detaches from the
          notable stack's own 12px rhythm instead of filing as "notable
          #4". id="spend-unresolved" is the OUT-pill footnote's Show Your
          Working scroll target (SpendHeader's onUnresolvedTap). */}
      <div id="spend-unresolved">
        {showAskCard && unresolved.largest && (
          <div className="mt-5">
            <UnresolvedAskCard
              largest={unresolved.largest}
              paymentsCount={unresolved.payments_count}
              unresolvedTotal={unresolved.total}
              periodOut={pills.spent}
              weight={unresolved.weight}
              accountName={unresolvedAccountName}
              onCorrect={() => (onAskCorrect ? onAskCorrect() : onOpenCategory("Other"))}
              onDismiss={handleDismissAsk}
            />
          </div>
        )}
      </div>

      {/* Majority — aboveMajority (the This period/Over time tablist) gets
          the same mt-5 rhythm the majority section itself uses everywhere
          else on this page, so it never sits tight against the ask/
          unresolved line above it; the majority section then follows the
          tablist's own mb-2 with no added margin (avoids stacking two mt-5
          gaps back to back). */}
      {aboveMajority && <div className="mt-5">{aboveMajority}</div>}
      <div className={aboveMajority ? "" : "mt-5"} id="spend-majority-section">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          <MoneyText text={majorityHeader(state, headerSum, nonZeroRows.length)} />
        </p>
        {nonZeroRows.length > 0 || unresolved.total > 0 ? (
          <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
            {visibleRows.map((row) => (
              <MajorityRowView
                key={row.category}
                row={row}
                colours={colours}
                quietTag={quietFlagCategories.has(row.category)}
                onOpen={() => onOpenCategory(row.category)}
                tips={openTipsFor(row.category, categoryInsights ?? [])}
              />
            ))}
            {unresolved.total > 0 && (
              <OtherRowView
                total={unresolved.total}
                paymentsCount={unresolved.payments_count}
                colours={colours}
                onOpen={() => onOpenCategory("Other")}
              />
            )}
          </div>
        ) : (
          <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">Nothing to show yet.</p>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => { setMajorityExpanded(true); onMajorityExpandedChange?.(true); }}
            className="mt-2 w-full text-center text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 py-1"
          >
            Show all {nonZeroRows.length}
          </button>
        )}
        {zeroRows.length > 0 && (
          <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">
            Nothing in {zeroRows.map((r) => r.category).join(" or ")} yet
          </p>
        )}
      </div>

      {/* Money you moved — id is the "Moved" tap's Show Your Working
          scroll target (SpendHeader's onMovedTap, once that prop lands). */}
      <div className="mt-3" id="spend-money-moved">
        <MoneyYouMoved
          moved={moved}
          onOpenRow={onOpenMoved}
          initialOpen={initialMovedOpen}
          onOpenChange={onMovedOpenChange}
        />
      </div>
    </div>
  );
}
