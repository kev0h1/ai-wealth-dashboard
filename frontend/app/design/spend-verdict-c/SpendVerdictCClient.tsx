"use client";

// /design/spend-verdict-c — ART DIRECTION VARIANT: "Quiet ledger".
//
// TEMPORARY DESIGN-REVIEW BUILD. Not wired into production, not linked from
// the design index by this agent (a sibling agent owns app/design/page.tsx).
//
// The diagnosis this variant answers: on a phone, the shipped Spend page
// shows about one and a half categories per screen because every notable is
// a padded, bordered card and the header nests a boxed instrument inside a
// boxed hero. Nothing is ranked, the scroll is enormous. This build strips
// the box chrome everywhere it isn't earning its keep and lets hairlines +
// rhythm do the grouping work instead:
//   - Header: the reading (Penny's verdict) leads at the very top, unclamped
//     (DESIGN.md "verdicts lead"). Out / In / Moved become a flat ledger of
//     three rows separated by hairlines, no bordered instrument inset, no
//     nested glass-tile. Moved loses its emerald hero colour (its fixture
//     value is mostly own-account shuffling, not verified good news — Red/
//     Emerald both mean something specific here and £8k of shuffling hasn't
//     earned Verified Emerald). A presentational net-relationship line (Out
//     minus In, arithmetic on numbers already in the payload) sits under the
//     lead, and the pace strip shrinks to an inline sparkline that actually
//     states its value (today's gap vs usual) instead of the old strip's
//     axis-less, value-less line.
//   - Notables: one glass-card-flat "ledger sheet" holding every notable as
//     a divide-y row (icon, category, figure, badge / pace + biggest-
//     merchants caption / one primary "See the N payments" link), never one
//     card per category. The one-off/new-normal question and the aim offer
//     move behind a single per-row disclosure (chevron, aria-expanded,
//     `inert` while collapsed) — present in the DOM always, never destroyed,
//     just deferred. Amber is reserved for multiple >= 2.0; below that the
//     badge is neutral slate (colour is information, not decoration).
//
// This file intentionally does NOT import SpendHeader.tsx or
// SpendVerdictView.tsx — those production components, and SpendPage.tsx,
// are untouched by this build. Everything below is a variant-local
// reimplementation reading the SAME fixture payloads spend-live already
// uses (SPEND_VERDICT_FIXTURES et al) so design review compares apples to
// apples against the other two variants and against production.
//
// Deep-linkable: /design/spend-verdict-c?mode=light|dark&state=normal|nothing|everything|nobaseline|early

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  PiggyBank, CreditCard, TrendingUp, ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { fmtWhole as fmtAimWhole, daysLabel } from "@/lib/aimFormat";
import { api } from "@/lib/api";
import type {
  Checkpoint,
  SpendVerdict,
  SpendVerdictCause,
  SpendVerdictMajorityRow,
  SpendVerdictMoved,
  SpendVerdictPaceEntry,
  SpendVerdictState,
  SpendVerdictUnresolved,
} from "@/lib/api";
import { DEFAULT_PAY_PERIOD_CONFIG, prevPeriodWithConfig } from "@/lib/payPeriod";
import MoneyText from "@/components/MoneyText";
import TransactionRow from "@/components/TransactionRow";
import IntentConsentSheet from "@/components/IntentConsentSheet";
import { SPEND_VERDICT_FIXTURES, PREVIEW_INCOME_TXNS, PREVIEW_SIGNALS, PREVIEW_ACCOUNTS } from "../spend-live/fixtures";

// ── Shared money formatting (copied locally — SpendHeader.tsx's own
// zeroSafe/fmt, not imported, since that file is production and off limits
// per this build's constraints). Proper minus (U+2212), never a raw hyphen,
// per the house currency-minus rule. ──────────────────────────────────────
const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);
const fmt = (n: number) => {
  const v = zeroSafe(n);
  const sign = v < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
};

// ── Display-only merchant tidy — ATTEMPTED, REVERTED (art-direction brief
// item 9). A first pass (dedupe a literal doubled "WORD*WORD " processor
// prefix, then title-case any string that reads as ALL CAPS) looked
// conservative but failed a UK-bank-string audit: "HMRC SELF ASSESSMENT" ->
// "Hmrc Self Assessment", "AA BREAKDOWN COVER" -> "Aa Breakdown Cover",
// "M&S*M&S SIMPLY FOOD LONDON" -> "M&s Simply Food London" (the recaser only
// looks after whitespace, so the letter after "&" is missed), and
// "TfL*TFL TRAVEL CHARGE" defeats the shouty-detector entirely because the
// mixed-case "TfL" survives dedup and reads as "not shouting". A tighter
// version that preserves short (<=4 letter) all-caps tokens as acronyms
// doesn't fix this either — it has no way to tell a real acronym ("AA",
// "HMRC") from an ordinary short shouted word ("PLAY", "APPS" in "GOOGLE
// PLAY APPS LONDON"), so it either title-cases genuine acronyms into nonsense
// or freezes ordinary words as fake acronyms, without a curated dictionary.
// That dictionary is exactly what ENGINE.md's name-judgement layer already
// owns (deterministic core + LLM name-judgement, per-user cache) — it does
// not belong invented ad hoc in a view. So this view renders merchant
// strings RAW, same as production, rather than making recognisable names
// less recognisable with a heuristic that cannot be made safe here.

function paceLine(multiple: number, excess: number, daysElapsed: number): string {
  const dayLabel = `day ${daysElapsed}`;
  const rounded = Math.round(multiple * 10) / 10;
  if (rounded >= 1.9 && rounded <= 2.1) return `About twice your usual pace for ${dayLabel}.`;
  if (rounded > 2.1) return `About ${rounded.toFixed(1)}× your usual pace for ${dayLabel}.`;
  return `Running about ${fmt(excess)} ahead of usual for ${dayLabel}.`;
}

function causeLine(cause: SpendVerdictCause[]): string | null {
  if (!cause.length) return null;
  return `Biggest: ${cause.map((c) => `${c.name} ${fmt(c.amount)}`).join(", ")}.`;
}

function IconChip({
  name, colours, size = 28,
}: { name: string; colours: Record<string, string>; size?: number }) {
  const colour = getCategoryColour(name, colours);
  const Icon = getCategoryIcon(name, undefined);
  return (
    <span
      className="rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${colour}26`, width: size, height: size }}
    >
      <Icon size={size >= 32 ? 16 : 14} style={{ color: colour }} />
    </span>
  );
}

// ── Inline mini sparkline — sits WITH the Out figure rather than inside a
// boxed panel. Decorative (aria-hidden): the adjacent caption states the
// actual value in words, which is the whole fix — the retired strip had no
// axis, no legend and no value, so it said nothing on its own. ────────────
function MiniPace({ series }: { series: SpendVerdictPaceEntry[] }) {
  if (series.length === 0) return null;
  const width = 60;
  const height = 22;
  const pad = 2;
  const maxDay = Math.max(1, ...series.map((p) => p.day));
  const usualSeries = series.filter((p): p is SpendVerdictPaceEntry & { usual: number } => p.usual != null);
  const maxVal = Math.max(1, ...series.map((p) => p.actual), ...usualSeries.map((p) => p.usual));
  const x = (d: number) => pad + (d / maxDay) * (width - 2 * pad);
  const y = (v: number) => height - pad - (v / maxVal) * (height - 2 * pad);
  const actualPts = series.map((p) => `${x(p.day)},${y(p.actual)}`).join(" ");
  const usualPts = usualSeries.map((p) => `${x(p.day)},${y(p.usual)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="flex-shrink-0" aria-hidden="true">
      {usualPts && (
        <polyline points={usualPts} fill="none" stroke="currentColor" className="text-slate-400 dark:text-slate-500" strokeWidth={1} strokeDasharray="2 2.5" vectorEffect="non-scaling-stroke" />
      )}
      <polyline points={actualPts} fill="none" stroke="#4f46e5" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.day)} cy={y(last.actual)} r={2.5} fill="#4f46e5" />
    </svg>
  );
}

function paceGapText(series: SpendVerdictPaceEntry[] | undefined): string | null {
  if (!series || series.length === 0) return null;
  const last = series[series.length - 1];
  if (last.usual == null) return "Still learning your usual pace.";
  const diff = last.actual - last.usual;
  if (Math.abs(diff) < 1) return "Right on your usual pace.";
  return diff > 0 ? `${fmt(diff)} ahead of usual pace.` : `${fmt(-diff)} behind usual pace.`;
}

// ── The lead + ledger header ────────────────────────────────────────────
function LedgerHeader({
  verdict, periodLabel, isCurrentPeriod, canGoPrev, onPrev, onNext, onSelectCurrent,
  onOutTap, onMovedTap, onUnresolvedTap, incomeExpanded, onToggleIncome,
}: {
  verdict: SpendVerdict;
  periodLabel: string;
  isCurrentPeriod: boolean;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSelectCurrent: () => void;
  onOutTap: () => void;
  onMovedTap: () => void;
  onUnresolvedTap: () => void;
  incomeExpanded: boolean;
  onToggleIncome: () => void;
}) {
  const { reading, pills, period, pace_series, moved_total, unresolved_total, unresolved_material } = verdict;
  const hasStrip = !!pace_series && pace_series.length > 0;
  const hasMoved = moved_total !== undefined;
  const showUnresolvedFootnote = !!unresolved_material && unresolved_total !== undefined;

  const netOut = pills.spent - pills.income;
  const netLine =
    Math.abs(netOut) < 1
      ? "Out and In are about even this period."
      : netOut > 0
      ? `${fmt(netOut)} more went out than came in this period.`
      : `${fmt(-netOut)} more came in than went out this period.`;

  const gapText = paceGapText(pace_series);

  return (
    <div className="px-4 pt-6">
      {!isCurrentPeriod && (
        <button
          type="button"
          onClick={onSelectCurrent}
          className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 px-3 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[12px] font-semibold active:scale-95 transition-transform"
        >
          <ChevronLeft size={13} />
          Back to this period
        </button>
      )}

      <div className="glass-hero rounded-3xl p-4">
        {/* Eyebrow — at most one middle dot, no redundant "PAY PERIOD" prefix
            (art-direction item 10: the shipped header had two dots and a
            label that repeats the section it's already inside). */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {canGoPrev && (
              <button type="button" onClick={onPrev} aria-label="Previous period" className="h-9 w-6 -ml-1 flex items-center justify-center flex-shrink-0 active:opacity-60 transition-opacity">
                <ChevronLeft size={13} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 truncate">
              {periodLabel.toUpperCase()} · DAY {period.days_elapsed}
            </p>
            {!isCurrentPeriod && (
              <button type="button" onClick={onNext} aria-label="Next period" className="h-9 w-6 flex items-center justify-center flex-shrink-0 active:opacity-60 transition-opacity">
                <ChevronRight size={13} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
          </div>
        </div>

        {/* The lead — Penny's verdict promoted to the top of the card,
            never clamped (DESIGN.md: verdicts lead). Card/section-title
            weight (16px/700) per the typography hierarchy's own carve-out
            for "verdict lines within content cards". */}
        <p lang="en-GB" className="text-pretty mt-3 text-base font-bold leading-snug text-slate-900 dark:text-slate-100">
          <MoneyText text={reading} />
        </p>

        {/* Net relationship between Out and In — presentational arithmetic
            on pills.spent/pills.income already in the payload, read as an
            observation, never alarm: no red regardless of sign. */}
        <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
          <MoneyText text={netLine} />
        </p>

        {/* Out / In / Moved — a flat ledger, hairlines only, no bordered
            inset, no nested glass-tile. */}
        <div className="mt-3">
          <button
            type="button"
            onClick={onOutTap}
            className="w-full min-h-[44px] py-2.5 flex items-center justify-between gap-3 border-b border-slate-200/70 dark:border-slate-700/70 active:opacity-70 transition-opacity text-left"
          >
            {/* Out carries the page's Headline weight (DESIGN.md's 20px/700
                step) — the one figure this screen leads with. In and Moved
                below are deliberately one documented step down (Card/
                section-title, 16px/700): real hierarchy that holds
                regardless of which number happens to be numerically
                largest. This matters because Moved can genuinely outsize
                Out on real data (e.g. Out ~£4,976 vs Moved ~£8,087) — equal
                type would let Moved read as the dominant figure on the
                screen, exactly the "everything is a peer" problem this
                variant exists to fix. Size/weight does the ranking now,
                not colour (Moved already lost its emerald above). */}
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Out</span>
            <span className="text-[20px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">{fmt(pills.spent)}</span>
          </button>

          {hasStrip && (
            <div className="flex items-center gap-2 py-1.5 border-b border-slate-200/70 dark:border-slate-700/70">
              <MiniPace series={pace_series!} />
              {gapText && (
                <p className="flex-1 min-w-0 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  <MoneyText text={gapText} />
                </p>
              )}
            </div>
          )}

          {showUnresolvedFootnote && (
            <button
              type="button"
              onClick={onUnresolvedTap}
              className="relative w-full min-h-[28px] py-1 flex items-center justify-end before:absolute before:-inset-y-1 before:inset-x-0 before:content-[''] text-[11px] text-slate-500 dark:text-slate-400 active:opacity-60 transition-opacity border-b border-slate-200/70 dark:border-slate-700/70"
            >
              Includes {fmt(unresolved_total!)} not yet placed ›
            </button>
          )}

          <button
            type="button"
            onClick={onToggleIncome}
            aria-expanded={incomeExpanded}
            className={`w-full min-h-[44px] py-2.5 flex items-center justify-between gap-3 active:opacity-70 transition-opacity text-left ${hasMoved ? "border-b border-slate-200/70 dark:border-slate-700/70" : ""}`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">In</span>
            <span className="text-[16px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">{fmt(pills.income)}</span>
          </button>

          {hasMoved && (
            <button
              type="button"
              onClick={onMovedTap}
              aria-label="Money you moved"
              className="w-full min-h-[44px] py-2.5 flex items-center justify-between gap-3 active:opacity-70 transition-opacity text-left"
            >
              {/* Two separate fixes, not one: (1) no emerald hero treatment
                  — Moved is mostly own-account shuffling in this fixture,
                  not verified good news, so it reads in the same ink as
                  Out/In; (2) one documented size step down from Out (16px
                  vs Out's 20px, see the comment on the Out row above) so
                  Moved can never out-rank Out visually just because its
                  pound value happens to be bigger — on the owner's real
                  numbers Moved (~£8,087) genuinely exceeds Out (~£4,976),
                  and colour alone wasn't enough to stop it reading as the
                  screen's dominant figure. */}
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Moved</span>
              <span className="text-[16px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">{fmt(moved_total!)}</span>
            </button>
          )}
        </div>
      </div>

      {incomeExpanded && PREVIEW_INCOME_TXNS.length > 0 && (
        <div className="mt-2 glass-card-flat rounded-xl overflow-hidden">
          <div className="px-4 pt-2.5 pb-1">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Income this period</p>
          </div>
          {PREVIEW_INCOME_TXNS.map((tx) => (
            <TransactionRow key={tx.id} transaction={tx} onClick={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── The aim/checkpoint mechanism — variant-local copy of SpendVerdictView's
// AimBlock, restyled to sit inside a row disclosure instead of a card. Same
// three states, same two endpoints (api.createCheckpoint/cancelCheckpoint),
// same consent semantics: only ever created on an explicit tap. ──────────
function AimBlock({
  category, multiple, suggestedAim, checkpoint, sym, onChanged,
}: {
  category: string; multiple: number | null; suggestedAim: number | null;
  checkpoint: Checkpoint | null; sym: string; onChanged: () => void;
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
      <div className="mt-2">
        <p className="text-[12px] text-slate-600 dark:text-slate-400">
          <span className="font-mono tabular-nums">{fmtAimWhole(spent_so_far, sym)}</span> of your <span className="font-mono tabular-nums">{fmtAimWhole(aim_amount, sym)}</span> aim, {daysLabel(days_left)}
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
          className="mt-1 min-h-[44px] flex items-center text-[11px] font-medium text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity"
        >
          Cancel this aim
        </button>
      </div>
    );
  }

  const eligible = multiple != null && multiple >= 1.5 && suggestedAim != null;
  if (!eligible) return null;

  if (!aimOpen) {
    // A real row in the disclosure's own hierarchy, not an orphaned corner
    // link floating off to the right — same full-width, min-h-[44px],
    // neutral-slate-chip treatment as the row's other affordances (see the
    // intent buttons above), so it reads as a peer offer rather than
    // decoration. States the number it's offering (this period's usual)
    // rather than making the reader open it to find out.
    return (
      <button
        type="button"
        onClick={() => setAimOpen(true)}
        className="mt-2 w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 active:scale-95 transition-transform text-left"
      >
        <span className="text-[12px] font-medium">
          Set an aim, usual is about <span className="font-mono tabular-nums font-semibold">{fmtAimWhole(suggestedAim!, sym)}</span>
        </span>
        <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
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
    <div className="mt-2">
      <p className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
        Your usual {category} is about <span className="font-mono tabular-nums">{fmtAimWhole(suggestedAim!, sym)}</span> a period.
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 mb-2">Aim for that this period?</p>
      {!customMode ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => handleSetAim(undefined)} className="min-h-[44px] text-[12px] font-semibold text-white rounded-lg px-3 active:scale-95 transition-transform disabled:opacity-60" style={{ backgroundColor: "#4f46e5" }}>
            Set this aim
          </button>
          <button type="button" disabled={saving} onClick={() => setCustomMode(true)} className="min-h-[44px] text-[12px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg px-3 active:scale-95 transition-transform disabled:opacity-60">
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
          <button type="button" disabled={saving || !customValid} onClick={() => handleSetAim(parsedCustom)} className="min-h-[44px] text-[12px] font-semibold text-white rounded-lg px-3 active:scale-95 transition-transform disabled:opacity-60" style={{ backgroundColor: "#4f46e5" }}>
            Set this aim
          </button>
        </div>
      )}
      {saveError && <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">That did not save. Try again.</p>}
    </div>
  );
}

// ── The ledger row (replaces the per-category card) ─────────────────────
function LedgerRow({
  notable, colours, daysElapsed, onOpenCategory, onIntent, sym, suggestedAim, checkpoint, onAimChanged, resolved, onResolved, onNewNormalRequest,
}: {
  notable: SpendVerdict["notables"][number];
  colours: Record<string, string>;
  daysElapsed: number;
  onOpenCategory: (category: string) => void;
  onIntent: (category: string, answer: "one_off" | "new_normal") => Promise<void>;
  sym: string;
  suggestedAim: number | null;
  checkpoint: Checkpoint | null;
  onAimChanged: () => void;
  resolved?: "one_off" | "new_normal" | null;
  onResolved?: (category: string, answer: "one_off" | "new_normal") => void;
  onNewNormalRequest?: (category: string) => void;
}) {
  const [localResolved, setLocalResolved] = useState<"one_off" | "new_normal" | null>(resolved ?? null);
  useEffect(() => { setLocalResolved(resolved ?? null); }, [resolved]);
  const [pending, setPending] = useState<"one_off" | null>(null);
  const [intentError, setIntentError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const cause = causeLine(notable.cause);
  const pace = paceLine(notable.multiple, notable.excess, daysElapsed);
  const s = notable.payments_count === 1 ? "" : "s";
  // Amber reserved for genuinely fast running categories (>= 2.0x); below
  // that, the badge is neutral slate — colour is information, not a
  // decoration every notable wears (art-direction item 7).
  const amber = notable.multiple >= 2.0;
  const disclosureId = `ledger-disclosure-${notable.category.replace(/\s+/g, "-")}`;

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
    <div className="px-4 py-3">
      {/* Line one — icon, category, figure, multiple badge. */}
      <div className="flex items-center gap-2.5">
        <IconChip name={notable.category} colours={colours} />
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1 min-w-0 truncate">{notable.category}</p>
        <span className="text-[15px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100 flex-shrink-0">{fmt(notable.spent)}</span>
        <div className="relative grid justify-items-end flex-shrink-0">
          <span
            className={`col-start-1 row-start-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-opacity duration-200 ${
              amber ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
            } ${localResolved ? "opacity-0 pointer-events-none" : "opacity-100"}`}
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

      {/* Line two — pace + biggest-merchants, one caption. */}
      <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400 leading-snug">
        <MoneyText text={pace} />
        {cause ? <> <MoneyText text={cause} /></> : null}
      </p>
      {notable.consequence_line?.text && !localResolved && (
        <p className="mt-0.5 text-[12px] font-medium text-slate-700 dark:text-slate-200"><MoneyText text={notable.consequence_line.text} /></p>
      )}

      {/* One primary action, plus the single disclosure affordance. */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <button type="button" onClick={() => onOpenCategory(notable.category)} className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
          See the {notable.payments_count} payment{s}
          <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={disclosureId}
          disabled={!!localResolved}
          onClick={() => setExpanded((v) => !v)}
          className="relative min-w-[44px] min-h-[44px] -my-2.5 flex items-center justify-center text-slate-500 dark:text-slate-400 active:opacity-60 transition-opacity disabled:opacity-30"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span className="sr-only">{expanded ? "Hide" : "More"} about {notable.category}</span>
        </button>
      </div>

      {/* Deferred: was this expected, and the aim offer. Content stays in
          the DOM at all times — collapses to zero height via grid-rows,
          `inert` while collapsed (removes focus/hit-testing/AT exposure,
          not just visual hiding) — never destroyed, just closed. */}
      <div
        id={disclosureId}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          expanded && !localResolved ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!expanded || !!localResolved}
      >
        <div className="overflow-hidden">
          <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
            <p className="text-[12px] text-slate-600 dark:text-slate-400">
              {notable.prior_intent?.question ?? "Was this a one-off, or the new normal?"}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              {/* Real separation from the surface (fixes the near-invisible
                  bg-slate-100 dark:bg-slate-700/60 pairing) — but the two
                  buttons are otherwise IDENTICAL apart from their label.
                  This is a neutral either/or question, not a recommendation:
                  giving one option a tinted-primary treatment (indigo, the
                  colour this row already uses to mean navigate/act) would
                  put a thumb on the scale. "New normal" not reading as
                  destructive is satisfied simply by staying off red/rose —
                  it does not require its own accent. */}
              <button
                type="button"
                disabled={pending !== null || !!localResolved}
                onClick={handleOneOff}
                className="flex-1 min-h-[44px] rounded-xl bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                {pending === "one_off" ? "Saving…" : "One-off"}
              </button>
              <button
                type="button"
                disabled={pending !== null || !!localResolved}
                onClick={() => onNewNormalRequest?.(notable.category)}
                className="flex-1 min-h-[44px] rounded-xl bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50"
              >
                New normal
              </button>
            </div>
            {intentError && (
              <p className="mt-2 text-[12px] font-semibold text-red-600 dark:text-red-400" role="alert">
                Could not save that, try again.
              </p>
            )}
            <AimBlock
              category={notable.category}
              multiple={notable.multiple}
              suggestedAim={suggestedAim}
              checkpoint={checkpoint}
              sym={sym}
              onChanged={onAimChanged}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Unresolved-merchant ask card — variant-local copy, unchanged in
// substance from SpendVerdictView's UnresolvedAskCard. Renders
// display_name RAW (no view-layer tidying — see the removed
// tidyMerchantDisplay note above), same as production. ────────────────────
function UnresolvedAskCard({
  largest, paymentsCount, unresolvedTotal, periodOut, weight, accountName, onCorrect, onDismiss,
}: {
  largest: NonNullable<SpendVerdictUnresolved["largest"]>;
  paymentsCount: number;
  unresolvedTotal: number;
  periodOut: number;
  weight: "material" | "routine";
  accountName?: string;
  onCorrect: () => void;
  onDismiss: () => void;
}) {
  const routine = weight === "routine";
  const dateLabel = new Date(largest.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const displayName = accountName ?? largest.display_name ?? null;
  const nameSlot = displayName ? `${displayName} · ${dateLabel}` : dateLabel;
  const paymentWord = paymentsCount === 1 ? "PAYMENT" : "PAYMENTS";
  const isGroup = paymentsCount > 1;

  return (
    <div className={`glass-card-flat rounded-2xl ${routine ? "p-3" : "p-4"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">
        UNPLACED · {paymentsCount} {paymentWord}
      </p>
      <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
        <span className={`flex-shrink-0 font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums ${routine ? "text-[16px]" : "text-[18px]"}`}>{fmt(largest.amount)}</span>
        <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 text-[13px]">·</span>
        <span className="truncate flex-1 min-w-0 text-[13px] font-normal text-slate-600 dark:text-slate-400">{nameSlot}</span>
      </div>
      {!routine && (
        <p className="mt-1.5 text-[13px] font-normal text-slate-700 dark:text-slate-300">
          {isGroup ? <>The biggest of the {paymentsCount}. I cannot place it yet.</> : "I cannot place this one yet."}
        </p>
      )}
      <p className={`text-[11px] text-slate-500 dark:text-slate-400 ${routine ? "mt-1" : "mt-1.5"}`}>
        {isGroup ? (
          <>All {paymentsCount} together are <span className="font-mono tabular-nums">{fmt(unresolvedTotal)}</span>, counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.</>
        ) : (
          <>Counted in your <span className="font-mono tabular-nums">{fmt(periodOut)}</span> out.</>
        )}
      </p>
      <div className={`flex items-center gap-4 ${routine ? "mt-2" : "mt-3"}`}>
        <button type="button" onClick={onCorrect} className="min-h-[44px] text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity">
          Tell me what this was
        </button>
        <button type="button" onClick={onDismiss} className="ml-auto min-h-[44px] text-[11px] font-medium text-slate-500 dark:text-slate-500 active:opacity-70 transition-opacity">
          Not now
        </button>
      </div>
    </div>
  );
}

function MajorityRowView({ row, colours, quietTag, onOpen }: { row: SpendVerdictMajorityRow; colours: Record<string, string>; quietTag: boolean; onOpen: () => void }) {
  const s = row.payments_count === 1 ? "" : "s";
  return (
    <button type="button" onClick={onOpen} className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors">
      <IconChip name={row.category} colours={colours} />
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

function OtherRowView({ total, paymentsCount, colours, onOpen }: { total: number; paymentsCount: number; colours: Record<string, string>; onOpen: () => void }) {
  const s = paymentsCount === 1 ? "" : "s";
  return (
    <div className="mt-2 glass-card-flat rounded-2xl overflow-hidden">
      <button type="button" onClick={onOpen} className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors">
        <IconChip name="Other" colours={colours} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Other</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{paymentsCount} payment{s} · still placing</p>
        </div>
        <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{fmt(total)}</span>
      </button>
    </div>
  );
}

const MOVED_ICON: Record<SpendVerdictMoved["kind"], LucideIcon> = {
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
  own_accounts: ArrowLeftRight,
};

function MoneyYouMoved({ moved }: { moved: SpendVerdictMoved[] }) {
  const [open, setOpen] = useState(false);
  if (moved.length === 0) return null;
  const total = moved.reduce((sum, m) => sum + m.amount, 0);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
          Money you moved · <span className="font-mono tabular-nums">{fmt(total)}</span>, not counted in spending
        </p>
        {open ? <ChevronUp size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" /> : <ChevronDown size={16} className="text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2" />}
      </button>
      {open && (
        <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
          {moved.map((m) => {
            const Icon = MOVED_ICON[m.kind];
            const s = m.payments_count === 1 ? "" : "s";
            const sub = m.goal_names?.length ? `${m.goal_names.join(" · ")} · ${m.payments_count} payment${s}` : `${m.payments_count} payment${s}`;
            return (
              <div key={m.kind} className="flex items-center gap-2.5 px-4 py-2.5 min-h-[44px]">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700/60">
                  <Icon size={13} className="text-slate-400 dark:text-slate-500" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{m.label}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{sub}</p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0 font-mono tabular-nums">{fmt(m.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

function periodLabel(start: string, end: string): string {
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

type Mode = "light" | "dark";
const STATES: SpendVerdictState[] = ["normal", "nothing", "everything", "nobaseline", "early"];
const STATE_LABEL: Record<SpendVerdictState, string> = {
  normal: "Normal", nothing: "Nothing", everything: "Everything", nobaseline: "No baseline", early: "Early",
};

export default function SpendVerdictCClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: SpendVerdictState = STATES.includes(params.get("state") as SpendVerdictState) ? (params.get("state") as SpendVerdictState) : "normal";
  const verdict = SPEND_VERDICT_FIXTURES[state];

  const [periodOffset, setPeriodOffset] = useState(0);
  const isCurrentPeriod = periodOffset === 0;
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [majorityExpanded, setMajorityExpanded] = useState(false);
  const [askDismissed, setAskDismissed] = useState(false);
  const [resolved, setResolved] = useState<Record<string, "one_off" | "new_normal">>({});
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const recentPeriods = useMemo(() => {
    const list: { offset: number; label: string }[] = [];
    let s = new Date(verdict.period.start);
    let e = new Date(verdict.period.end);
    for (let i = 0; i < 6; i++) {
      list.push({ offset: -i, label: periodLabel(s.toISOString(), e.toISOString()) });
      const [ps, pe] = prevPeriodWithConfig(s, DEFAULT_PAY_PERIOD_CONFIG);
      s = ps; e = pe;
    }
    return list;
  }, [verdict.period.start, verdict.period.end]);

  function handleOutTap() {
    setMajorityExpanded(true);
    document.getElementById("spend-c-majority")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleMovedTap() {
    document.getElementById("spend-c-moved")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleUnresolvedTap() {
    document.getElementById("spend-c-unresolved")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleFile() {
    if (!consentFor) return;
    setFiling(true);
    setFileError(false);
    try {
      await api.recordTrendIntent(consentFor, "new_normal");
      setResolved((r) => ({ ...r, [consentFor]: "new_normal" }));
      setConsentFor(null);
    } catch {
      setFileError(true);
    } finally {
      setFiling(false);
    }
  }

  const { notables, quiet_flags, majority, unresolved, moved, pills } = verdict;
  const daysElapsed = verdict.period.days_elapsed;
  const quietFlagCategories = new Set(quiet_flags.map((q) => q.category));
  const nonZeroRows = majority.filter((r) => r.spent > 0);
  const zeroRows = majority.filter((r) => r.spent <= 0);
  const visibleRows = majorityExpanded ? nonZeroRows : nonZeroRows.slice(0, MAJORITY_COLLAPSE_AT);
  const hiddenCount = nonZeroRows.length - visibleRows.length;
  const headerSum = nonZeroRows.reduce((s, r) => s + r.spent, 0);
  const showAskCard = unresolved.ask_worthy && !askDismissed && unresolved.largest != null;
  const showUnresolvedWhisper = !showAskCard && unresolved.total > 0;
  const unresolvedAccountName = PREVIEW_ACCOUNTS.find((a) => a.id === unresolved.largest?.account_id)?.name;

  const hrefFor = (s: SpendVerdictState) => `?mode=${mode}&state=${s}`;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-[430px]">
          <LedgerHeader
            verdict={verdict}
            periodLabel={periodLabel(verdict.period.start, verdict.period.end)}
            isCurrentPeriod={isCurrentPeriod}
            canGoPrev={true}
            onPrev={() => setPeriodOffset((o) => o - 1)}
            onNext={() => setPeriodOffset((o) => Math.min(0, o + 1))}
            onSelectCurrent={() => setPeriodOffset(0)}
            onOutTap={handleOutTap}
            onMovedTap={handleMovedTap}
            onUnresolvedTap={handleUnresolvedTap}
            incomeExpanded={incomeExpanded}
            onToggleIncome={() => setIncomeExpanded((v) => !v)}
          />

          <div className="px-4 pt-4">
            {/* Notables — ONE ledger sheet, divide-y rows, never one card
                per category (art-direction item 6). */}
            {notables.length > 0 && (
              <div className="glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
                {notables.map((n) => (
                  <LedgerRow
                    key={n.category}
                    notable={n}
                    colours={{}}
                    daysElapsed={daysElapsed}
                    onOpenCategory={() => {}}
                    onIntent={(category, answer) => api.recordTrendIntent(category, answer).then(() => {})}
                    sym="£"
                    suggestedAim={PREVIEW_SIGNALS[n.category]?.suggested_aim ?? null}
                    checkpoint={PREVIEW_SIGNALS[n.category]?.checkpoint ?? null}
                    onAimChanged={() => {}}
                    resolved={resolved[n.category] ?? null}
                    onResolved={(category, answer) => setResolved((r) => ({ ...r, [category]: answer }))}
                    onNewNormalRequest={(category) => { setFileError(false); setConsentFor(category); }}
                  />
                ))}
              </div>
            )}

            <div id="spend-c-unresolved" className={notables.length > 0 ? "mt-5" : ""}>
              {showAskCard && unresolved.largest && (
                <UnresolvedAskCard
                  largest={unresolved.largest}
                  paymentsCount={unresolved.payments_count}
                  unresolvedTotal={unresolved.total}
                  periodOut={pills.spent}
                  weight={unresolved.weight}
                  accountName={unresolvedAccountName}
                  onCorrect={() => {}}
                  onDismiss={() => setAskDismissed(true)}
                />
              )}
              {showUnresolvedWhisper && (
                <p className="mt-3 px-1 text-[11px] text-slate-600 dark:text-slate-400">
                  Other · <span className="font-mono tabular-nums">{fmt(unresolved.total)}</span>, still working this one out
                </p>
              )}
            </div>

            <div className="mt-5" id="spend-c-majority">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <MoneyText text={majorityHeader(verdict.state, headerSum, nonZeroRows.length)} />
              </p>
              {nonZeroRows.length > 0 ? (
                <div className="mt-2 glass-card-flat rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
                  {visibleRows.map((row) => (
                    <MajorityRowView key={row.category} row={row} colours={{}} quietTag={quietFlagCategories.has(row.category)} onOpen={() => {}} />
                  ))}
                </div>
              ) : (
                <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">Nothing to show yet.</p>
              )}
              {hiddenCount > 0 && (
                <button type="button" onClick={() => setMajorityExpanded(true)} className="mt-2 w-full text-center text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 py-1">
                  Show all {nonZeroRows.length}
                </button>
              )}
              {zeroRows.length > 0 && (
                <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">Nothing in {zeroRows.map((r) => r.category).join(" or ")} yet</p>
              )}
              {unresolved.total > 0 && (
                <OtherRowView total={unresolved.total} paymentsCount={unresolved.payments_count} colours={{}} onOpen={() => {}} />
              )}
            </div>

            <div className="mt-3" id="spend-c-moved">
              <MoneyYouMoved moved={moved} />
            </div>
          </div>
        </div>

        {consentFor && (
          <IntentConsentSheet
            category={consentFor}
            onFile={handleFile}
            onKeepOneOff={() => setConsentFor(null)}
            onClose={() => setConsentFor(null)}
            filing={filing}
            fileError={fileError}
          />
        )}

        {/* Fixed state hopper footer — same pattern as spend-live, so this
            variant is exercised across all five backend states and both
            themes without re-typing the URL. */}
        <div className="fixed bottom-0 left-0 right-0 glass-sheet border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1.5" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto scrollbar-hide overscroll-x-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            {STATES.map((s) => (
              <a key={s} href={hrefFor(s)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${s === state ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>
                {STATE_LABEL[s]}
              </a>
            ))}
            <a href={`?mode=${mode === "dark" ? "light" : "dark"}&state=${state}`} className="flex-shrink-0 ml-auto px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
