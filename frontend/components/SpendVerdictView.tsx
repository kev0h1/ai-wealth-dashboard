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
import { ChevronDown, ChevronUp, ChevronRight, PiggyBank, CreditCard, TrendingUp, ReceiptText } from "lucide-react";
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
} from "@/lib/api";
import { fmtWhole as fmtAimWhole, daysLabel } from "@/lib/aimFormat";
import { formatDate } from "@/lib/payPeriod";
import MoneyText from "@/components/MoneyText";

// − U+2212, never ASCII hyphen-minus, for money (copy rule).
const MINUS = "−";
const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const MOVED_ICON: Record<SpendVerdictMoved["kind"], LucideIcon> = {
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
};

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
          className="mt-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Cancel this aim
        </button>
      </div>
    );
  }

  const eligible = multiple != null && multiple >= 1.5 && suggestedAim != null;
  if (!eligible) return null;

  // State C — the manual offer: a quiet link, never automatic.
  if (!aimOpen) {
    return (
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => setAimOpen(true)}
          className="text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Set an aim
        </button>
      </div>
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
            className="text-[12px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 active:scale-95 transition-transform disabled:opacity-60"
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
}

function NotableCardView({ notable, colours, daysElapsed, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged, resolved, onResolved, onNewNormalRequest }: NotableCardProps) {
  // Mirrors AimBlock's localCheckpoint/checkpoint pattern above: local state
  // seeded from (and re-synced to) the controlled `resolved` prop, so the
  // card reflects both its own resolve tap AND the parent clearing it back
  // to null on an "Undo".
  const [localResolved, setLocalResolved] = useState<"one_off" | "new_normal" | null>(resolved ?? null);
  useEffect(() => { setLocalResolved(resolved ?? null); }, [resolved]);
  // In-flight + failure state for the "One-off" post — the write is real
  // (goes through `post<T>()`, which throws on non-2xx), so the card must
  // actually observe the result instead of flipping to "Got it" optimistically.
  const [pending, setPending] = useState<"one_off" | null>(null);
  const [intentError, setIntentError] = useState(false);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";

  async function handleOneOff() {
    setIntentError(false);
    setPending("one_off");
    try {
      await onIntent(notable.category, "one_off");
      setLocalResolved("one_off");
      onResolved?.(notable.category, "one_off");
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
        {/* Resolve-in-place: the amber pace badge crossfades (200ms, opacity
            only) to a neutral "resolved" chip. Both spans share one grid
            cell (col-start-1 row-start-1) so the swap never reflows — the
            track sizes to the wider of the two, and only opacity animates. */}
        <div className="relative grid flex-shrink-0">
          <span
            className={`col-start-1 row-start-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 transition-opacity duration-200 ${
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
          second, independent belt. */}
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
              className="flex-1 min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
            >
              {pending === "one_off" ? "Saving…" : "One-off"}
            </button>
            <button
              type="button"
              disabled={pending !== null || !!localResolved}
              onClick={() => onNewNormalRequest?.(notable.category)}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
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
    </div>
  );
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
  largest, paymentsCount, periodOut, weight, onCorrect, onDismiss,
}: {
  largest: NonNullable<SpendVerdictUnresolved["largest"]>;
  paymentsCount: number;
  periodOut: number;
  weight: "material" | "routine";
  onCorrect: () => void;
  onDismiss: () => void;
}) {
  const routine = weight === "routine";
  const dateLabel = formatDate(largest.date);
  // Reserved truncate slot (flex-1 + truncate) so the merchant name can
  // never wrap onto a second line, regardless of length — the structural
  // fix for a bug that hit even short strings ("£4.50 to Playtomic.") when
  // the name sat at the end of running prose.
  const nameSlot = largest.display_name ? `${largest.display_name} · ${dateLabel}` : dateLabel;
  const paymentWord = paymentsCount === 1 ? "PAYMENT" : "PAYMENTS";

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
          I can&apos;t place this one yet.
        </p>
      )}

      <p className={`text-[11px] text-slate-500 dark:text-slate-400 ${routine ? "mt-1" : "mt-1.5"}`}>
        Counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.
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
}: {
  row: SpendVerdictMajorityRow;
  colours: Record<string, string>;
  quietTag: boolean;
  onOpen: () => void;
}) {
  const s = row.payments_count === 1 ? "" : "s";
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
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(row.spent)}</span>
    </button>
  );
}

function MoneyYouMoved({ moved }: { moved: SpendVerdictMoved[] }) {
  const [open, setOpen] = useState(false);
  if (moved.length === 0) return null;
  const total = moved.reduce((sum, m) => sum + m.amount, 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
            return (
              <div key={m.kind} className="flex items-center gap-2.5 px-4 py-2.5 min-h-[44px]">
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

const MAJORITY_COLLAPSE_AT = 8;

export interface SpendVerdictViewProps {
  verdict: SpendVerdict;
  colours: Record<string, string>;
  onOpenCategory: (category: string) => void;
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
}

export default function SpendVerdictView({ verdict, colours, onOpenCategory, onIntent, signals, sym = "£", onAimChanged, onAskCorrect, hideReading, aboveMajority, expandMajoritySignal, miscategorisedCount = 0, onMiscategorisedTap, resolved, onResolved, onNewNormalRequest }: SpendVerdictViewProps) {
  // Optimistic, in-session hide the instant "Not now" is tapped — the real
  // persistence is server-side (POST /spend/verdict/dismiss-unresolved sets
  // unresolved.ask_worthy=false on every future fetch for this transaction,
  // the same durable pattern the miscategorised guardrail uses). This local
  // flag only covers the gap before a remount would otherwise re-read a
  // stale cached payload — it is never the source of truth.
  const [askDismissed, setAskDismissed] = useState(false);
  const [majorityExpanded, setMajorityExpanded] = useState(false);
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
  const showUnresolvedWhisper = !showAskCard && unresolved.total > 0;

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
          here rather than between the hero and the body). */}
      {miscategorisedCount > 0 && (
        <button
          type="button"
          onClick={onMiscategorisedTap}
          className="w-full glass-tile rounded-xl px-3 py-2 flex items-center gap-2 active:scale-95 transition-transform"
        >
          <ReceiptText size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
          <span className="flex-1 text-left text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {miscategorisedCount} transfer{miscategorisedCount !== 1 ? "s" : ""} may be miscategorised
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

      {/* Notable cards */}
      {notables.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {notables.map((n) => (
            <NotableCardView
              key={n.category}
              notable={n}
              colours={colours}
              daysElapsed={daysElapsed}
              onOpenCategory={onOpenCategory}
              onIntent={onIntent}
              sym={sym}
              suggestedAim={signals?.[n.category]?.suggested_aim ?? null}
              checkpoint={signals?.[n.category]?.checkpoint ?? null}
              onAimChanged={onAimChanged ?? (() => {})}
              resolved={resolved?.[n.category] ?? null}
              onResolved={onResolved}
              onNewNormalRequest={onNewNormalRequest}
            />
          ))}
        </div>
      )}

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
              periodOut={pills.spent}
              weight={unresolved.weight}
              onCorrect={() => (onAskCorrect ? onAskCorrect() : onOpenCategory("Other"))}
              onDismiss={handleDismissAsk}
            />
          </div>
        )}
        {showUnresolvedWhisper && (
          <p className="mt-3 px-1 text-[11px] text-slate-600 dark:text-slate-400">
            Other · <span className="font-mono tabular-nums">{fmt(unresolved.total)}</span>, still working this one out
          </p>
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
        {nonZeroRows.length > 0 ? (
          <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
            {visibleRows.map((row) => (
              <MajorityRowView
                key={row.category}
                row={row}
                colours={colours}
                quietTag={quietFlagCategories.has(row.category)}
                onOpen={() => onOpenCategory(row.category)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">Nothing to show yet.</p>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setMajorityExpanded(true)}
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
        <MoneyYouMoved moved={moved} />
      </div>
    </div>
  );
}
