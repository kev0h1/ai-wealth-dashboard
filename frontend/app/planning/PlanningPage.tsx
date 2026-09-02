"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { AlertTriangle, AlertCircle, Clock, ChevronRight, ChevronDown, Trash2, X } from "lucide-react";
import { api, Account, Allocation, CashflowData, Commitment, SavingsInsight } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useRouter, useSearchParams } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import UpcomingEditSheet from "@/components/UpcomingEditSheet";
import PlanOneOffSheet from "@/components/PlanOneOffSheet";
import PlannedEditSheet from "@/components/PlannedEditSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import CommitmentSheet from "@/components/CommitmentSheet";
import AllocationSheet from "@/components/AllocationSheet";
import { useTutorialReady } from "@/components/TutorialContext";
import SetAsideSheet from "@/components/SetAsideSheet";
import MoneyText from "@/components/MoneyText";

/**
 * A traced internal transfer whose destination lands inside the same
 * spendable pool as its source is a POOLED NO-OP: the money never enters or
 * leaves the "everywhere" total tracked by the pooled walk in
 * upcomingBlock (below), it only reallocates within it. Strict `=== true`:
 * a missing or null `dest_account_spendable` means the destination was
 * never traced (untraced movement, or one bound for a savings pot), so it
 * keeps the ordinary debiting behaviour rather than guessing. This is the
 * single place allowed to interpret the dest_account_spendable pair, every
 * pooled-walk consumer below must call this rather than re-deriving the
 * rule inline, so the definition of "no-op" cannot drift between them. Per-
 * account walks (atRiskWalks, accountShortfalls) do NOT use this: a
 * destination account genuinely receives the money, so per-account risk
 * still needs both legs regardless of this flag, see the comment on
 * internal_inflows consumption further down.
 */
function isPooledNoOp(item: { kind?: string; dest_account_spendable?: boolean | null }): boolean {
  return item.kind === "movement" && item.dest_account_spendable === true;
}

function isCliffSoon(until: string): boolean {
  const y = parseInt(until.slice(0, 4), 10);
  const m = parseInt(until.slice(5, 7), 10);
  const lastDay = new Date(y, m, 0); // last day of that month
  return (lastDay.getTime() - Date.now()) / 86_400_000 <= 60;
}

function fmtCliffMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); // e.g. "Sep 2026"
}

// ── Deep-link day target (?day=YYYY-MM-DD) ─────────────────────────────────
const DAY_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

// Absolute-ISO only, and rejects roll-over garbage (e.g. "2026-02-30").
function isValidIsoDate(s: string): boolean {
  if (!DAY_PARAM_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = s.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

// Planning's own visible window never runs past roughly two pay periods out.
// A `day` further than this from today is stale enough (a link surviving
// long after the event it pointed at) that snapping to "nearest" would be
// misleading rather than helpful — degrade to the normal page instead.
const DAY_PARAM_MAX_DRIFT_DAYS = 60;

function isWithinDeepLinkWindow(iso: string): boolean {
  const target = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.abs(target - todayMidnight) / 86_400_000 <= DAY_PARAM_MAX_DRIFT_DAYS;
}

function formatFallbackDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// A row's key is built as `bill-${name}-${expected_date}` (see renderRow's
// rowKey below), where expected_date is always a fixed-width YYYY-MM-DD (10
// chars). Matching against `name` used to be a plain `startsWith` prefix
// scan, which a bill name that is itself a prefix of another bill's name
// could satisfy for the wrong row (e.g. "Netflix" matching a
// "Netflix-Plus" row, since the hyphen after "Netflix" in the combined key
// happens to line up). Stripping the fixed date suffix first recovers the
// exact name segment, so the comparison is exact rather than positional.
function billKeyMatchesName(key: string | null, name: string): boolean {
  if (!key || !key.startsWith("bill-")) return false;
  const datePart = key.slice(-10);
  if (!DAY_PARAM_RE.test(datePart)) return false;
  const namePart = key.slice("bill-".length, key.length - 11); // drop "bill-" and "-YYYY-MM-DD"
  return namePart === name;
}

// A row's content is a single line: verdict fragment (semibold) + slate "·"
// separator + muted title. `null` = row intentionally hidden.
type DockRowContent = ReactNode | null;

function computeDebtRow(view: import("@/lib/api").DebtPlanSummary): DockRowContent {
  const buckets = view.totals.buckets;
  const carried = buckets?.carried_total ?? 0;
  const float = buckets?.float_total ?? 0;

  if (carried < 1 && float < 1) {
    // No cards worth showing
    return null;
  }

  // Find the next cliff across all cards (earliest promo end within a year)
  const now = Date.now();
  const ONE_YEAR_MS = 365 * 86_400_000;
  type Cliff = { until: string; name: string };
  let nextCliff: Cliff | null = null;
  for (const card of view.cards) {
    const seg = card.rate_schedule[0];
    if (!seg || seg.source !== "promo" || !seg.until) continue;
    const y = parseInt(seg.until.slice(0, 4), 10);
    const m = parseInt(seg.until.slice(5, 7), 10);
    const lastDay = new Date(y, m, 0).getTime();
    if (lastDay - now > ONE_YEAR_MS) continue; // beyond a year, skip
    if (!nextCliff) {
      nextCliff = { until: seg.until, name: card.name };
    } else {
      const existY = parseInt(nextCliff.until.slice(0, 4), 10);
      const existM = parseInt(nextCliff.until.slice(5, 7), 10);
      const existLastDay = new Date(existY, existM, 0).getTime();
      if (lastDay < existLastDay) nextCliff = { until: seg.until, name: card.name };
    }
  }

  if (!nextCliff) {
    // No cliff to lead with — title only, still bold (Numbers-Lead has
    // nothing to number here).
    return <span className="font-semibold">Card plan</span>;
  }

  const soon = isCliffSoon(nextCliff.until);
  const dateStr = fmtCliffMonth(nextCliff.until);
  return (
    <>
      <span className="font-semibold">
        {/* Figures Are Ink (DESIGN.md, Kevin 2026-08-26): the caution
            lives in a small leading dot, never in the colour of the
            date itself. The date stays ink so the dot alone carries
            the "soon" signal, matching the inline dot already used on
            debt-plan's cliff copy. */}
        {soon && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 mr-1 align-middle" />}
        Next 0% ends {dateStr}
      </span>
      <span className="text-slate-400 dark:text-slate-500"> · </span>
      <span className="text-slate-500 dark:text-slate-400">Card plan</span>
    </>
  );
}

// Pulls the "£X,XXX/month <qualifier>" figure out of the grow verdict
// headline (e.g. "After debt repayments, you're about £1,256/month short")
// and renders it abbreviated as "£1,256/mo short". Falls back to the full
// headline (truncated by the row's own truncate class) if no figure is
// present — e.g. the "about even" verdict has none.
//
// Owner decision, 2026-08-30: when the CURRENT pay period is short
// (period_gate.short, from the same getGrow() payload GrowVariant1.tsx's
// hero reads), this row must not echo the typical-month "spare" figure —
// the same reason Grow's own hero demotes it that period. Quiet copy
// instead, still linking through to /grow via the row's own onTap.
function computeGrowRow(view: import("@/lib/api").GrowView): DockRowContent {
  if (view.period_gate?.short) {
    return <span className="font-semibold">Covered first, then Grow</span>;
  }

  if (!view.verdict?.headline) return null;

  const headline = view.verdict.headline;
  const match = headline.match(/(£[\d,]+(?:\.\d+)?)\s*\/\s*month\s+(.+)$/i);
  return (
    <>
      <span className="font-semibold">
        {match ? (
          <>
            <span className="font-mono tabular-nums">{match[1]}</span>/mo {match[2]}
          </>
        ) : (
          <MoneyText text={headline} />
        )}
      </span>
      <span className="text-slate-400 dark:text-slate-500"> · </span>
      <span className="text-slate-500 dark:text-slate-400">typical month</span>
    </>
  );
}

// Shape-matched skeleton row — keeps the dock's height stable while either
// summary is still loading, instead of popping in late (was a bug for Grow).
function DockSkeletonRow() {
  return (
    <div
      className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 animate-pulse first:rounded-t-2xl last:rounded-b-2xl"
      aria-hidden="true"
    >
      <div className="h-[15px] w-40 rounded bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

function DockRow({
  content,
  onTap,
  ariaLabel,
}: {
  content: ReactNode;
  onTap: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onTap}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}
      className="w-full min-h-[44px] px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-transform first:rounded-t-2xl last:rounded-b-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      aria-label={ariaLabel}
    >
      <p className="flex-1 min-w-0 truncate text-[15px] leading-snug text-slate-900 dark:text-slate-100">
        {content}
      </p>
      <ChevronRight size={18} className="text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}

// Plans dock — Card plan + Grow merged into one glass surface with a hairline
// divider between rows (Option B: "Plans dock"). Renders nothing if both
// rows are hidden (no empty shell); shows shape-matched skeletons while
// either summary is still loading so the dock never reflows.
function PlansDock({
  debtView,
  growView,
  hide,
  onDebtTap,
  onGrowTap,
}: {
  debtView: import("@/lib/api").DebtPlanSummary | null;
  growView: import("@/lib/api").GrowView | null;
  hide: boolean;
  onDebtTap: () => void;
  onGrowTap: () => void;
}) {
  // `hide` (hideNetWorth) is threaded through for parity with the prior
  // DebtEntryCard prop — it had no visible effect there either; preserved
  // as-is rather than inventing new masking behaviour.
  void hide;

  // undefined = still loading, null = row intentionally hidden, object = show
  const debtContent: DockRowContent | undefined = debtView ? computeDebtRow(debtView) : undefined;
  const growContent: DockRowContent | undefined = growView ? computeGrowRow(growView) : undefined;

  const rows: ReactNode[] = [];
  if (debtContent === undefined) {
    rows.push(<DockSkeletonRow key="debt-skeleton" />);
  } else if (debtContent !== null) {
    rows.push(<DockRow key="debt" content={debtContent} onTap={onDebtTap} ariaLabel="View your debt plan" />);
  }
  if (growContent === undefined) {
    rows.push(<DockSkeletonRow key="grow-skeleton" />);
  } else if (growContent !== null) {
    rows.push(<DockRow key="grow" content={growContent} onTap={onGrowTap} ariaLabel="View your grow plan" />);
  }

  if (rows.length === 0) return null;

  return (
    <div className="glass-card rounded-2xl divide-y divide-slate-200/60 dark:divide-white/10">
      {rows}
    </div>
  );
}

// Commitments — named future big expenses with a per-period slice reserved.
// A single goal renders full-width — no ghost add-card splitting the row
// with it. Two or more goals ride a horizontal snap-scroll row of
// fixed-width glass cards (many goals are realistic — no hard cap); the
// thin progress fill goes amber (attention, never red) when a plan is
// behind its elapsed fraction. Cards only — the "+ Set money aside" door
// that used to live here (as "+ Plan a big expense") is now the single
// merged door in PlansSection below (owner consolidation, 2026-08-29:
// Variant A from /design/planning-create replaces the three separate
// creation affordances with one).
function CommitmentCards({
  commitments,
  onEdit,
}: {
  commitments: Commitment[] | null;
  onEdit: (c: Commitment) => void;
}) {
  const router = useRouter();
  const fmtC = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");
  const active = (commitments ?? []).filter((c) => c.status === "active");

  if (active.length === 0) return null;

  const renderGoalCard = (c: Commitment, className: string) => {
    const pct = c.amount > 0 ? Math.min(100, Math.max(0, (c.progress / c.amount) * 100)) : 0;
    const month = new Date(c.target_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    const isCaution = c.feasibility_tone ? c.feasibility_tone === "caution" : c.feasibility === "stretch";
    return (
      <button
        key={c.id}
        onClick={() => onEdit(c)}
        aria-label={`Edit plan: ${c.name}`}
        className={className}
      >
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">{month}</p>
        <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
          <div
            className={`h-full rounded-full ${c.on_track ? "bg-indigo-500" : "bg-amber-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100 money">
          <span className="font-mono tabular-nums">{fmtC(c.progress)}</span> <span className="font-normal text-slate-400 dark:text-slate-500">of <span className="font-mono tabular-nums">{fmtC(c.amount)}</span></span>
        </p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 num">
          <span className="font-mono tabular-nums">{fmtC(c.per_period_slice)}</span>
          {c.period_label
            ? ` each pay period (${c.period_label}) · ${c.periods_left} left`
            : ` a period · ${c.periods_left} left`}
        </p>
        {/* Shared pot — quiet, structural information, never a colour
            signal (a pound is claimed by only the oldest goal). */}
        {c.shared_pot_goals && c.shared_pot_goals.length > 0 && (
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 truncate">
            Shares a pot with {c.shared_pot_goals.join(", ")}
          </p>
        )}
        {/* Pace note (Spend -> Plan bridge) — a live, this-period signal:
            spend is running ahead of usual by enough to squeeze what this
            plan needs. Leads when present; the "stretch" feasibility line
            below is suppressed alongside it (both are a full-amber "this is
            at risk" read — one loud thing, not two stacked). */}
        {c.pace_note && (
          <p className="mt-1 flex items-start gap-1.5 min-w-0">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] bg-amber-500"
              aria-hidden="true"
            />
            <span className="text-[12px] leading-snug text-slate-500 dark:text-slate-400">
              {c.pace_note.text}{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push("/spend");
                }}
                className="font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
              >
                See where ›
              </button>
            </span>
          </p>
        )}
        {/* Feasibility — surplus/funded: slate dot; savings: amber dot,
            slate text; stretch: amber dot + amber text (attention, never red).
            Suppressed when pace_note already carries the loud amber line for
            "stretch" — the two would otherwise restate the same risk twice. */}
        {c.feasibility && c.feasibility_note && !(c.pace_note && isCaution) && (
          <p className="mt-1 flex items-start gap-1.5 min-w-0">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[3px] ${
                c.feasibility === "surplus" || c.feasibility === "funded"
                  ? "bg-slate-300 dark:bg-slate-600"
                  : "bg-amber-500"
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] line-clamp-2 leading-snug text-slate-500 dark:text-slate-400">
              {c.feasibility_note}
            </span>
          </p>
        )}
        {/* Origin badge — whisper-tier only (owner decisions locked, agent
            mode v1): no icon, no gradient, no chip, just a quiet trailing
            caption when Penny (not the user, by hand) created this goal. */}
        {c.created_via === "penny" && (
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">set up with Penny</p>
        )}
      </button>
    );
  };

  if (active.length === 1) {
    return (
      <div className="space-y-2" data-tutorial-id="tutorial-planning-goals">
        {renderGoalCard(
          active[0],
          "w-full text-left glass-card rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        )}
      </div>
    );
  }

  return (
    <div className="relative -mx-4" data-tutorial-id="tutorial-planning-goals">
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 scroll-px-4 pb-1">
        {active.map((c) =>
          renderGoalCard(
            c,
            "min-w-[240px] max-w-[260px] flex-shrink-0 snap-start glass-card rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          )
        )}
      </div>
      {/* Right-edge fade — a quiet hint the row continues */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--background)] to-transparent"
      />
    </div>
  );
}

// Allocations — per-pay-period envelopes, the goal card's sibling: same
// glass-card family, progress-bar treatment and snap-scroll-when-many
// layout as CommitmentCards above, deliberately simpler content (no target
// date, no pot ledger, no feasibility verdict — owner spec: "just create an
// allocation, it deducts from what's available"). `error` is a DIFFERENT
// signal from `allocations === null`: null covers both "still loading" and
// "genuinely none yet"; `error` means the GET itself failed, which renders
// nothing at all so Planning degrades to exactly its pre-allocations shape
// (allocations additive, never blocking). Cards only — the door lives in
// PlansSection below.
//
// Card content updated for the new rule contract (owner amendment,
// 2026-08-29): the "fed by" line now reads off `fill_display_name` and
// carries a quiet suffix for contains-rules (an exact-match rule needs no
// qualifier — "fed by X" alone is already precise); a PENDING allocation
// (future effective_from) renders a quiet "Starts <date>" line instead of
// any reserve/progress — nothing has been asked of an account yet, so
// showing £0-of-£N would read as a a shortfall that isn't real. The rhythm
// tag (top-right, "Every pay period" / "This period only") mirrors Variant
// A's card mock — now that an envelope isn't always recurring, the two
// rhythms need to read as distinct at rest, not just inside the sheet.
function AllocationCards({
  allocations,
  error,
  accounts,
  onEdit,
}: {
  allocations: Allocation[] | null;
  error: boolean;
  accounts: Account[];
  onEdit: (a: Allocation) => void;
}) {
  const fmtC = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");
  if (error) return null;
  const active = (allocations ?? []).filter((a) => a.active);

  if (active.length === 0) return null;

  const renderAllocationCard = (a: Allocation, className: string) => {
    const pct = a.amount_per_period > 0
      ? Math.min(100, Math.max(0, (a.filled_this_period / a.amount_per_period) * 100))
      : 0;
    // "Complete" is quiet, not a celebration — full bar, muted tone, no
    // colour change (allocations are never red, and this isn't a risk
    // signal in either direction so it never earns amber either). Trusts
    // the server's `completed` flag first (authoritative for a "once"
    // envelope whose period has closed) and falls back to the local fill
    // comparison for the ordinary still-open case.
    const complete = a.completed || (a.filled_this_period >= a.amount_per_period && a.amount_per_period > 0);
    const feedAccount = accounts.find((acc) => acc.id === a.fill_account_id);
    const feedLabel = a.fill_display_name || feedAccount?.name;
    const rhythmLabel = a.recurrence === "once" ? "This period only" : "Every pay period";
    const startsLabel = a.pending
      ? new Date(a.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : null;
    return (
      <button
        key={a.id}
        onClick={() => onEdit(a)}
        aria-label={`Edit allocation: ${a.name}`}
        className={className}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</p>
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mt-0.5">
            {rhythmLabel}
          </span>
        </div>
        {feedLabel && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
            fed by {feedLabel}
            {a.match_type === "description_contains" && " · matches similar payments"}
          </p>
        )}
        {a.pending ? (
          // Pending — nothing reserved yet, so no bar and no £ figures.
          <p className="mt-1.5 text-[13px] text-slate-400 dark:text-slate-500">Starts {startsLabel}</p>
        ) : (
          <>
            <div className="mt-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100 money">
              <span className="font-mono tabular-nums">{fmtC(a.filled_this_period)}</span>{" "}
              <span className="font-normal text-slate-400 dark:text-slate-500">
                of <span className="font-mono tabular-nums">{fmtC(a.amount_per_period)}</span> this period
              </span>
            </p>
            {complete && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Done this period</p>
            )}
          </>
        )}
        {/* Origin badge — same whisper-tier treatment as the goal card's
            own badge above (CommitmentCards' renderGoalCard): no icon, no
            gradient, just a quiet caption when Penny created this envelope. */}
        {a.created_via === "penny" && (
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">set up with Penny</p>
        )}
      </button>
    );
  };

  if (active.length === 1) {
    return (
      <div className="space-y-2" data-tutorial-id="tutorial-planning-allocations">
        {renderAllocationCard(
          active[0],
          "w-full text-left glass-card rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        )}
      </div>
    );
  }

  return (
    <div className="relative -mx-4" data-tutorial-id="tutorial-planning-allocations">
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 scroll-px-4 pb-1">
        {active.map((a) =>
          renderAllocationCard(
            a,
            "min-w-[240px] max-w-[260px] flex-shrink-0 snap-start glass-card rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          )
        )}
      </div>
      {/* Right-edge fade — a quiet hint the row continues */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--background)] to-transparent"
      />
    </div>
  );
}

// The single door — Variant A from /design/planning-create (owner pick,
// 2026-08-29), replacing "+ Plan a big expense", "+ Allocation" and
// "+ Plan a one-off" with one "+ Set money aside" affordance. Centred with
// a subline when nothing exists yet (matches the empty-state idiom every
// other quiet add-button on this page already uses); a compact right-
// aligned link above the cards once anything exists (goal or envelope —
// the door doesn't care which, that choice happens inside the sheet).
function PlansSection({
  commitments,
  allocations,
  allocationsError,
  accounts,
  onAdd,
  onEditCommitment,
  onEditAllocation,
}: {
  commitments: Commitment[] | null;
  allocations: Allocation[] | null;
  allocationsError: boolean;
  accounts: Account[];
  onAdd: () => void;
  onEditCommitment: (c: Commitment) => void;
  onEditAllocation: (a: Allocation) => void;
}) {
  const activeCommitments = (commitments ?? []).filter((c) => c.status === "active");
  const activeAllocations = (allocations ?? []).filter((a) => a.active);
  const empty = activeCommitments.length === 0 && activeAllocations.length === 0;

  if (empty) {
    return (
      <div id="commitments" className="scroll-mt-20" data-tutorial-id="tutorial-planning-plans">
        <button
          onClick={onAdd}
          data-tutorial-id="tutorial-planning-add"
          className="w-full min-h-[44px] py-2 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          + Set money aside
          <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">
            a goal, an envelope, or a one-off payment
          </span>
        </button>
      </div>
    );
  }

  return (
    <div id="commitments" className="space-y-2 scroll-mt-20" data-tutorial-id="tutorial-planning-plans">
      <div className="flex justify-end">
        <button
          onClick={onAdd}
          title="A goal, an envelope, or a one-off payment"
          data-tutorial-id="tutorial-planning-add"
          className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          + Set money aside
        </button>
      </div>
      <CommitmentCards commitments={commitments} onEdit={onEditCommitment} />
      <AllocationCards allocations={allocations} error={allocationsError} accounts={accounts} onEdit={onEditAllocation} />
    </div>
  );
}

export default function PlanningPage() {
  const { payPeriodConfig, setPayPeriodConfig, region, hideNetWorth } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sym = "£";

  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [cashflowError, setCashflowError] = useState(false);

  // Tour readiness — the runway hero and the upcoming list both read off
  // `cashflow`, so the tour must wait for it (or a genuine fetch error) the
  // same way upcomingBlock's own cashflowError/!cashflow gate does above.
  useTutorialReady("planning", !!cashflow || cashflowError);

  // #commitments deep link (Insights' "Fixed" hero/tip-group row, see
  // MoneyShapeHero/InsightsPage.tsx) — a plain browser anchor-jump can't be
  // trusted here: PlansSection (id="commitments", see below) only renders
  // once `cashflow` has resolved (or errored) the same way the rest of
  // `upcomingBlock` does, same async-content-below-the-fold problem the
  // Insights tab's own `?insight=` deep link already solves the same way
  // (see SavingsInsightsSection's scroll effect).
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#commitments") return;
    if (!cashflow && !cashflowError) return;
    const t = setTimeout(() => {
      document.getElementById("commitments")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(t);
  }, [cashflow, cashflowError]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debtSummary, setDebtSummary] = useState<import("@/lib/api").DebtPlanSummary | null>(null);
  const [growView, setGrowView] = useState<import("@/lib/api").GrowView | null>(null);
  const [commitments, setCommitments] = useState<Commitment[] | null>(null);
  const [commitmentSheet, setCommitmentSheet] = useState<null | { editing: Commitment | null }>(null);
  // Allocations — see AllocationCards' own comment for the null-vs-error
  // distinction (null = loading/genuinely none, error = GET failed).
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [allocationsError, setAllocationsError] = useState(false);
  // Edit-only now — creation moved into SetAsideSheet's envelope step
  // (owner consolidation, 2026-08-29).
  const [allocationSheet, setAllocationSheet] = useState<Allocation | null>(null);
  // The single door's own sheet (step 1 kind cards, step 2 for "An
  // envelope" only — "By a date" and "One payment" hand off to
  // CommitmentSheet/PlanOneOffSheet below, unchanged).
  const [setAsideSheetOpen, setSetAsideSheetOpen] = useState(false);
  const [savingsInsights, setSavingsInsights] = useState<SavingsInsight[] | null>(null);
  // Count backing the header "Set aside" bin's tone (quiet at 0, regular
  // above). Starts at 0 so the control renders quiet by default; see the
  // fetch effect below for why this must never gate the page's main data.
  const [dismissedCount, setDismissedCount] = useState(0);

  // Per-row "Why? ›" disclosure (Variant A, "The Ledger", owner pick
  // 2026-08-28): the culprit sentence used to be stated outright on every
  // at-risk row; it now collapses behind a user-invoked toggle, keyed by
  // the same rowKey renderRow already builds (`${type}-${name}-
  // ${expected_date}`). Collapsed by default (empty set) — this is
  // disclosure, not a visibility-gating animation, nothing here fires on
  // page load.
  const [whyOpen, setWhyOpen] = useState<Set<string>>(new Set());
  function toggleWhy(key: string) {
    setWhyOpen(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Derive current period (always current — no prev/next navigation)
  const configKey = JSON.stringify(payPeriodConfig);
  const [periodStart, setPeriodStart] = useState<Date>(() => {
    const [s] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    return s;
  });
  const [periodEnd, setPeriodEnd] = useState<Date>(() => {
    const [, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    return e;
  });

  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Load data
  useEffect(() => {
    api.accounts().catch(() => [] as Account[]).then(accs => setAccounts(accs));
    api.cashflow().then(setCashflow).catch(() => setCashflowError(true));
    api.getDebtPlanSummary().then(setDebtSummary).catch(() => {});
    api.getGrow().then(setGrowView).catch(() => {});
    api.listCommitments().then((d) => setCommitments(d.items)).catch(() => setCommitments([]));
    // Allocations are additive and must never block the rest of the page —
    // a failed GET sets allocationsError instead of throwing anywhere else
    // visible, which AllocationCards reads to render nothing at all.
    api.listAllocations().then(setAllocations).catch(() => setAllocationsError(true));
    // Insight hints on bill rows — decorative: any error just means no hints.
    api.getSavingsInsights().then(setSavingsInsights).catch(() => {});
  }, []);

  // Header bin's count, fetched separately from the effect above so it can
  // never delay the page's real data: this is decoration on a control, not
  // something the page depends on. A failed fetch just leaves dismissedCount
  // at its 0 default, which is exactly the quiet tone the control should
  // show when it can't tell whether anything is set aside — an invisible
  // failure mode, not an error state.
  useEffect(() => {
    api.dismissedSeries()
      .then((d) => setDismissedCount(d.user.length + d.engine.length))
      .catch(() => {});
  }, []);

  // Merchant-name → insight lookup for the bill-row hints. Keys are the
  // normalised lowercase merchant names each insight was triggered by; `est`
  // is the first figure pulled out of the insight's savings estimate (null →
  // the hint says "save" instead of a number).
  const insightHintEntries = useMemo(() => {
    const entries: { key: string; id: string; est: string | null }[] = [];
    for (const ins of savingsInsights ?? []) {
      const est = ins.savings_estimate?.match(/([\d][\d,]*)/)?.[1] ?? null;
      for (const t of ins.triggered_by ?? []) {
        for (const raw of [t.display_name, t.merchant_key]) {
          const key = (raw || "").trim().toLowerCase();
          // Short keys substring-match too much junk — exact-ish only.
          if (key.length >= 4 && !entries.some((e) => e.key === key)) {
            entries.push({ key, id: ins.id, est });
          }
        }
      }
    }
    return entries;
  }, [savingsInsights]);

  function findInsightHint(billName: string): { id: string; est: string | null } | null {
    const n = billName.trim().toLowerCase();
    if (n.length < 4) return null;
    const hit = insightHintEntries.find(
      (e) => e.key === n || e.key.includes(n) || n.includes(e.key)
    );
    return hit ? { id: hit.id, est: hit.est } : null;
  }

  function refreshCommitments() {
    api.listCommitments().then((d) => setCommitments(d.items)).catch(() => {});
  }

  // Refreshes both the allocations list (for the cards) and cashflow (for
  // the "remaining" figures the TO LAST subline/arithmetic reads) after a
  // save/pause/delete — a stale local list would otherwise show the old
  // filled/remaining split until the next full page load. A failed refresh
  // here is silent: the sheet has already closed, and stale-but-present
  // data is better than yanking the card away.
  function refreshAllocations() {
    api.listAllocations().then(setAllocations).catch(() => {});
    api.cashflow().then(setCashflow).catch(() => {});
  }

  function retryCashflow() {
    setCashflowError(false);
    api.cashflow().then(setCashflow).catch(() => setCashflowError(true));
  }

  // Pay period deep link
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("wealth_open_pay_period") === "1") {
      sessionStorage.removeItem("wealth_open_pay_period");
      setSettingsOpen(true);
    }
  }, []);

  // ── At-risk bills ──────────────────────────────────────────────────────────
  // Two walks over the same events, differing only in the same-day
  // credit/debit tie-break, a direct port of backend/app/services/
  // companion.py's `_optimistic_events` / `optimistic_min_running` (see its
  // long comment there for the full reasoning; summarised here):
  //   - conservative: bills before income/inflows on a shared day. An
  //     on-payday debit must be covered by the balance already there, not
  //     that day's credit. This is the walk that has always driven every
  //     RED at-risk treatment on this page, and its ordering is unchanged.
  //   - optimistic: income/inflows before bills on a shared day. Consulted
  //     ONLY to tell a genuine shortfall (still short even when the money
  //     that's due in is credited first) from a same-day timing risk (only
  //     short because the conservative ordering happens to put the payment
  //     before the credit), never to change what the conservative walk
  //     itself flags, same as companion.py never lets it touch
  //     min_running/shortfall_bill.
  const atRiskWalks = (() => {
    if (!cashflow) return null;
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    // last-day lookahead: from the final day of the period, assess the first 5 days of the next one
    const daysToPay = Math.round((nextPaydayMs - Date.now()) / 86400000);
    const simEndMs = nextPaydayMs + (daysToPay <= 1 ? 5 * 86400000 : 0);
    const scopedBills = cashflow.upcoming_bills.filter(
      (b) => new Date(b.expected_date).getTime() <= simEndMs &&
             b.account_balance != null && b.account_balance >= 0 &&
             !b.is_credit_card
    );
    if (scopedBills.length === 0) return null;
    const seedRunning: Record<string, number> = {};
    for (const b of scopedBills) {
      const key = b.account_id ?? "__null__";
      if (!(key in seedRunning)) seedRunning[key] = b.account_balance!;
    }
    type Event =
      | { kind: "income"; days_away: number; amount: number; account_id: string | null | undefined }
      | { kind: "inflow"; days_away: number; amount: number; account_id: string }
      | { kind: "bill"; days_away: number; amount: number; account_id: string | null | undefined; bill: typeof scopedBills[0] };
    const events: Event[] = [
      ...scopedBills.map((b) => ({ kind: "bill" as const, days_away: b.days_away, amount: b.amount, account_id: b.account_id, bill: b })),
      ...cashflow.upcoming_income
        .filter((inc) => new Date(inc.expected_date).getTime() <= simEndMs)
        .map((inc) => ({ kind: "income" as const, days_away: inc.days_away, amount: inc.amount, account_id: inc.account_id as string | null | undefined })),
      // Internal inflows, the DESTINATION side of a standing order whose
      // SOURCE side already appears above as an outbound "movement" bill.
      // Treated exactly like income (credits the account, resets
      // movementsSince there): the only reason a destination account ever
      // looked short was that this projection debited the source and never
      // credited where the money actually goes. Unlike the POOLED walk
      // further down, this per-account walk uses EVERY inflow regardless
      // of destination_spendable, a savings pot genuinely receives that
      // money, so for a per-account risk check the credit is correct even
      // though the same money would be wrong to credit into the pooled
      // "everywhere" total (which never counted a savings account in the
      // first place, see the pooled walk's own comment).
      ...(cashflow.internal_inflows ?? [])
        .filter((inf) => new Date(inf.expected_date).getTime() <= simEndMs)
        .map((inf) => ({ kind: "inflow" as const, days_away: inf.days_away, amount: inf.amount, account_id: inf.account_id })),
    ];

    // The walk itself, extracted so it can run twice over the identical
    // event list with only the same-day tie-break flipped (see the
    // conservative/optimistic explanation above).
    function walk(tieBreak: "conservative" | "optimistic") {
      const running: Record<string, number> = { ...seedRunning };
      const sorted = [...events].sort((a, b) => {
        if (a.days_away !== b.days_away) return a.days_away - b.days_away;
        const aCredit = a.kind === "bill" ? 0 : 1;
        const bCredit = b.kind === "bill" ? 0 : 1;
        // conservative: bills (0) before credits (1) on a tie; optimistic
        // flips it so credits land first.
        return tieBreak === "conservative" ? aCredit - bCredit : bCredit - aCredit;
      });
      // Movements (transfers, savings, investment STOs) processed on each
      // account since its last income/inflow landing, the causal window
      // for shortfall attribution below. Reset on income/inflow because
      // that credit is what would otherwise have covered them; a movement
      // from before the last top-up no longer explains a later deficit.
      // This is a best-effort "most-recent, same-account" heuristic, not a
      // formal causal solver, good enough to name a likely culprit, not a
      // guarantee of sole cause.
      const movementsSince: Record<string, { name: string; amount: number; expected_date: string }[]> = {};
      const atRisk: (typeof scopedBills[0] & {
        movementCulprit?: { name: string; amount: number; expected_date: string };
      })[] = [];
      for (const ev of sorted) {
        if (ev.kind === "income" || ev.kind === "inflow") {
          if (ev.account_id) {
            const key = ev.account_id;
            // Only credits accounts already seeded above (i.e. accounts
            // that actually have a scoped bill). An income/inflow must
            // never seed a brand-new account into the walk.
            if (key in running) { running[key] += ev.amount; movementsSince[key] = []; }
          } else {
            // Income with no named destination (legacy behaviour that
            // predates internal_inflows, which are always account-scoped).
            // Credit every account currently tracked, since there's no
            // way to say which one it actually lands in.
            for (const key of Object.keys(running)) { running[key] += ev.amount; movementsSince[key] = []; }
          }
        } else {
          const key = ev.account_id ?? "__null__";
          if (!(key in running)) continue;
          // Deficit cascades (same semantics as companion.py's shortfall walk):
          // a bounced bill still debits the running balance, so every later bill
          // on a short account flags until income/an inflow recovers it, not
          // just the single bill that first tipped it over. This debit happens
          // for EVERY kind, movement included: a movement still empties the
          // account and can still bounce a later bill.
          const bal = running[key];
          running[key] = bal - ev.amount;
          const isMovement = ev.bill.kind === "movement";
          if (isMovement) {
            (movementsSince[key] ??= []).push({ name: ev.bill.name, amount: ev.bill.amount, expected_date: ev.bill.expected_date });
          }
          if (bal < ev.amount && !isMovement) {
            // Only genuine spend (commitment/discretionary) is ever flagged
            // at-risk. A movement that can't be funded isn't a risk, it's a
            // plan that won't happen, so it's never added here (never painted
            // red). If a movement on this account is what actually drained
            // the balance, name it: "the £X move on <date> puts this at
            // risk" is the useful sentence; "your savings transfer is at
            // risk" is not.
            const priorMovements = movementsSince[key] ?? [];
            const movementCulprit = priorMovements.length > 0
              ? [...priorMovements].sort((a, b) => b.amount - a.amount)[0]
              : undefined;
            atRisk.push(movementCulprit ? { ...ev.bill, movementCulprit } : ev.bill);
          }
        }
      }
      return atRisk;
    }

    return { conservative: walk("conservative"), optimistic: walk("optimistic") };
  })();

  // The conservative walk remains the one true source for every RED
  // treatment on this page (bill rows, the callout, the chip), unchanged
  // behaviour from before internal_inflows existed, just now correctly
  // credited. The optimistic walk (see genuineAccountIds below) exists only
  // to classify severity; it never adds or removes a flagged bill here.
  const atRiskBills = atRiskWalks?.conservative ?? [];

  const atRiskKey = (b: { account_id?: string | null; expected_date: string; amount: number; name?: string }) =>
    `${b.account_id ?? "__null__"}|${b.expected_date}|${b.amount}|${b.name ?? ""}`;
  const atRiskKeySet = new Set(atRiskBills.map(atRiskKey));

  // An account still short under the OPTIMISTIC ordering (income/inflows
  // credited before bills on a shared day) is a genuine shortfall: the
  // money due in wouldn't have saved it either way. An account short ONLY
  // in the conservative walk is a timing risk, not a shortfall: the money
  // is arriving that same day, it just might land after a payment leaves.
  // Per the Red Is Risk Rule, only genuine shortfalls ever earn RED; timing
  // risks render amber (see the callout below).
  const genuineAccountIds = new Set(
    (atRiskWalks?.optimistic ?? []).map(b => b.account_id ?? "__null__")
  );

  type AccountShortfall = {
    accountId: string;
    bank: string;
    balance: number;
    shortfall: number;
    culprit: { name: string; amount: number; expected_date: string } | undefined;
    dueDate: string | null;
    severity: "genuine" | "timing";
  };

  const accountShortfalls = (() => {
    if (!cashflow || atRiskBills.length === 0) return [];
    const accountIds = [...new Set(atRiskBills.map(b => b.account_id ?? "__null__"))];
    return accountIds
      .map((accountId): AccountShortfall | null => {
        const firstBill = atRiskBills.find(b => (b.account_id ?? "__null__") === accountId);
        if (!firstBill) return null;
        const balance = firstBill.account_balance ?? 0;
        const bank = firstBill.account_bank || firstBill.account_name || "Account";
        const nextPaydayMs = periodEnd.getTime() + 86400000;
        // last-day lookahead: from the final day of the period, assess the first 5 days of the next one
        const daysToPay = Math.round((nextPaydayMs - Date.now()) / 86400000);
        // EXCLUSIVE of payday day itself, except during the last-day
        // lookahead (daysToPay <= 1), where the window still extends
        // through payday + 5 days INCLUSIVE. Mirrors backend/app/services/
        // pay_period.py's `in_current_window` helper exactly (2026-08-28
        // decision, owner verbatim: "we still want to have some visibility
        // over the next pay period but I don't think it should count in
        // the existing one"). A bill/inflow scheduled ON payday
        // (days_away === daysToPay) now belongs to the NEXT pay period's
        // arithmetic, not this one — it stays visible elsewhere (Home's
        // payday_split) but must never inflate this shortfall total. See
        // pay_period.py for the canonical helper this mirrors.
        const inWindow = (daysAway: number) =>
          daysToPay <= 1 ? daysAway >= 0 && daysAway <= daysToPay + 5 : daysAway >= 0 && daysAway < daysToPay;
        // Note: this total intentionally still includes "movement" entries
        // (transfers, savings, investment STOs) for this account. It's the
        // real cash that would need to be there to cover everything
        // scheduled, movements included. Only the RED banner/CTA above it
        // is gated to genuine at-risk spend (accountIds is built from the
        // already-movement-filtered atRiskBills), so a shortfall driven
        // purely by a movement no longer shows this banner at all. The
        // figure now also nets off internal_inflows landing on this
        // account inside the same window, the destination side of the
        // user's own standing orders (e.g. a payday transfer in), so this
        // arithmetic never contradicts the walk above it, which already
        // credits that same money before deciding whether the account is
        // short at all.
        const scopedBills = cashflow!.upcoming_bills.filter(
          b => (b.account_id ?? "__null__") === accountId &&
               inWindow(b.days_away) &&
               b.account_balance != null &&
               b.account_balance >= 0 &&
               !b.is_credit_card
        );
        const billsSum = scopedBills.reduce((s, b) => s + b.amount, 0);
        const inflowsSum = (cashflow!.internal_inflows ?? [])
          .filter(inf => inf.account_id === accountId && inWindow(inf.days_away))
          .reduce((s, inf) => s + inf.amount, 0);
        const shortfall = billsSum - balance - inflowsSum;
        if (shortfall <= 0) return null;
        // Earliest genuinely at-risk bill on this account, so the
        // attribution names whichever movement actually preceded it.
        const earliest = atRiskBills
          .filter(b => (b.account_id ?? "__null__") === accountId)
          .sort((a, b) => a.days_away - b.days_away)[0];
        // Earliest credit (income or internal inflow) due into this account
        // inside the window, backs the amber timing-risk copy below
        // ("Money's due into HSBC on Fri 28 Aug"). Not used for any
        // arithmetic, display only.
        const earliestCredit = [
          ...cashflow!.upcoming_income.filter(inc => inc.account_id === accountId),
          ...(cashflow!.internal_inflows ?? []).filter(inf => inf.account_id === accountId),
        ]
          .filter(c => inWindow(c.days_away))
          .sort((a, b) => a.days_away - b.days_away)[0];
        // "genuine" = still short even under the optimistic ordering
        // (income/inflows credited first), a real shortfall. "timing" =
        // only short in the conservative walk, i.e. covered by money due
        // the same day. See genuineAccountIds above.
        const severity: "genuine" | "timing" = genuineAccountIds.has(accountId) ? "genuine" : "timing";
        return { accountId, bank, balance, shortfall, culprit: earliest?.movementCulprit, dueDate: earliestCredit?.expected_date ?? null, severity };
      })
      .filter((x): x is AccountShortfall => x !== null)
      .sort((a, b) => b.shortfall - a.shortfall);
  })();

  // The split this page's whole at-risk UI hangs off: RED banner/chip use
  // genuineShortfalls only (current copy, current colour); AMBER uses
  // timingShortfalls (new, calmer treatment). See severity's computation
  // above for what separates the two.
  const genuineShortfalls = accountShortfalls.filter(a => a.severity === "genuine");
  const timingShortfalls = accountShortfalls.filter(a => a.severity === "timing");

  // ── Undo state ──────────────────────────────────────────────────────────────
  const [undoBar, setUndoBar] = useState<{ kind: "recurring"; name: string } | { kind: "planned"; id: string } | null>(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single transient spotlight target, auto-fading 2800ms after it fires —
  // either a bare ISO date (scrolls the matching day group into view; set by
  // resolveDayTarget, driven by the ?day= deep link — the day group is
  // already self-evident at scroll-centre with its own label, so it isn't
  // additionally rung) or a bill-row key (`bill-${name}-${date}` /
  // `income-${name}-${date}`, matched against `data-bill-key`; set by the
  // shortfall callout's Review button and the ?bill= deep link, and flashed
  // with a ring since nothing else disambiguates one row among many). Only
  // one of those can be true at a time, so one state variable is enough to
  // answer "what is spotlighted".
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  // Quiet, non-error line shown when a ?day= deep link named a day with
  // nothing due on it (skipped/re-dated bill) and Planning landed on the
  // nearest day with content instead. Cleared wherever it stops being true
  // — see resolveDayTarget's exact-match branch and the auto-clear timer
  // below — so it can never stay pinned above a day group that plainly
  // does have content, or outlive the scroll landing it was explaining.
  const [dayFallbackNote, setDayFallbackNote] = useState<string | null>(null);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<null | {
    name: string;
    amount: number;
    expected_date: string;
    original_date?: string | null;
    type: "bill" | "income";
    category?: string | null;
    edited?: boolean;
    rule_label?: string | null;
  }>(null);
  const [editPlanned, setEditPlanned] = useState<null | { id: string; name: string; amount: number; date: string; account_id: string | null }>(null);

  // Highlight scroll effect — no view guard needed (always on planning
  // page). Scrolls to the day group for a bare ISO date, or the bill row
  // for a bill-key (the latter also gets a ring via `highlighted` below),
  // then auto-fades both the target and any fallback note together 2800ms
  // after it fires, so a landing and its explanation appear and fade in
  // lockstep rather than the note outliving the landing.
  useEffect(() => {
    if (!highlightTarget) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const selector = DAY_PARAM_RE.test(highlightTarget)
      ? `[data-day-key="${CSS.escape(highlightTarget)}"]`
      : `[data-bill-key="${CSS.escape(highlightTarget)}"]`;
    const scrollTimer = setTimeout(() => {
      try {
        document
          .querySelector(selector)
          ?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      } catch {}
    }, 120);
    const clearTimer = setTimeout(() => {
      setHighlightTarget(null);
      setDayFallbackNote(null);
    }, 2800);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [highlightTarget]);

  // Resolves a bare ISO date against the rendered day groups: exact match if
  // one exists, otherwise the closest day (preferring the next one forward)
  // that does have content, with a quiet note explaining the snap. No-ops if
  // nothing is rendered at all (the page's own "nothing more expected" empty
  // state already covers that). Every call — exact match or fallback —
  // leaves dayFallbackNote in the correct state for the day it lands on, so
  // scrubbing from a fallback day to one with real content on it clears the
  // stale note rather than leaving it pinned above an unrelated day group.
  function resolveDayTarget(day: string) {
    const dayEls = Array.from(document.querySelectorAll<HTMLElement>("[data-day-key]"));
    const keys = [...new Set(dayEls.map((el) => el.getAttribute("data-day-key") || "").filter(Boolean))]
      .map((key) => ({ key, ms: new Date(`${key}T00:00:00`).getTime() }))
      .filter((d) => !Number.isNaN(d.ms));
    if (keys.length === 0) return;

    if (keys.some((d) => d.key === day)) {
      setHighlightTarget(day);
      setDayFallbackNote(null);
      return;
    }

    const targetMs = new Date(`${day}T00:00:00`).getTime();
    const onOrAfter = keys.filter((d) => d.ms >= targetMs).sort((a, b) => a.ms - b.ms)[0];
    const chosen = onOrAfter ?? [...keys].sort((a, b) => b.ms - a.ms)[0];

    setHighlightTarget(chosen.key);
    setDayFallbackNote(`Nothing's due ${formatFallbackDate(day)} now, showing the closest day with payments.`);
  }

  // Deep-link entry — /planning?day=YYYY-MM-DD&bill=<name> (Home points here
  // when it's warned about a specific day or bill). Runs once, only after
  // cashflow has loaded (targets don't exist in the DOM before then), then
  // strips the params so a back-navigation or refresh doesn't replay it.
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (!cashflow) return;
    if (deepLinkHandledRef.current) return;
    const dayParam = searchParams.get("day");
    const billParam = searchParams.get("bill");
    if (!dayParam && !billParam) return;
    deepLinkHandledRef.current = true;

    // Malformed or far-outside-the-window days degrade silently — treated
    // as though no day were given at all, never thrown.
    const validDay = dayParam && isValidIsoDate(dayParam) && isWithinDeepLinkWindow(dayParam) ? dayParam : null;

    if (billParam) {
      const prefix = `bill-${billParam}-`;
      const billEls = Array.from(document.querySelectorAll<HTMLElement>("[data-bill-key]"));
      const exactKey = validDay ? `${prefix}${validDay}` : null;
      const match =
        (exactKey && billEls.find((el) => el.getAttribute("data-bill-key") === exactKey)) ||
        billEls.find((el) => billKeyMatchesName(el.getAttribute("data-bill-key"), billParam));
      if (match) {
        setHighlightTarget(match.getAttribute("data-bill-key"));
      } else if (validDay) {
        resolveDayTarget(validDay);
      }
    } else if (validDay) {
      resolveDayTarget(validDay);
    }

    router.replace("/planning", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashflow]);

  const lastDismissRef = useRef<{
    name: string;
    bills: CashflowData["upcoming_bills"];
    income: CashflowData["upcoming_income"];
    request: Promise<unknown>;
  } | null>(null);

  const lastPlannedDeleteRef = useRef<{
    id: string;
    bills: CashflowData["upcoming_bills"];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const lastSkipRef = useRef<{
    name: string;
    date: string;
    item: CashflowData["upcoming_bills"][0];
  } | null>(null);

  function flushPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    api.deletePlanned(p.id).catch(() => {});
  }

  function deletePlannedWithUndo(id: string) {
    flushPlannedDelete();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    let stashedBills: CashflowData["upcoming_bills"] = [];
    setCashflow(prev => {
      if (!prev) return prev;
      stashedBills = prev.upcoming_bills.filter(b => b.planned_id === id);
      return { ...prev, upcoming_bills: prev.upcoming_bills.filter(b => b.planned_id !== id) };
    });
    const timer = setTimeout(() => {
      api.deletePlanned(id).catch(() => {});
      lastPlannedDeleteRef.current = null;
      setUndoBar(null);
      api.cashflow().then(setCashflow).catch(() => {});
    }, 6000);
    lastPlannedDeleteRef.current = { id, bills: stashedBills, timer };
    setUndoBar({ kind: "planned", id });
    setUndoNonce(n => n + 1);
  }

  function undoPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    setUndoBar(null);
    setCashflow(prev => prev ? {
      ...prev,
      upcoming_bills: [...prev.upcoming_bills, ...p.bills].sort((a, b) => a.days_away - b.days_away),
    } : prev);
  }

  useEffect(() => {
    return () => { flushPlannedDelete(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissUpcoming(name: string) {
    flushPlannedDelete();
    setCashflow(prev => {
      if (!prev) return prev;
      lastDismissRef.current = {
        name,
        bills: prev.upcoming_bills.filter(b => b.name === name),
        income: prev.upcoming_income.filter(b => b.name === name),
        request: api.dismissRecurring(name).catch(() => {}),
      };
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter(b => b.name !== name),
        upcoming_income: prev.upcoming_income.filter(b => b.name !== name),
      };
    });
    setUndoBar({ kind: "recurring", name });
    setUndoNonce(n => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoBar(null), 6000);
  }

  function skipOccurrence(item: CashflowData["upcoming_bills"][0]) {
    const dateKey = item.original_date ?? item.expected_date;
    lastSkipRef.current = { name: item.name, date: dateKey, item };
    setCashflow(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter(
          b => !(b.name === item.name && b.expected_date === item.expected_date)
        ),
      };
    });
    api.skipUpcomingOccurrence(item.name, dateKey)
      .then(() => {
        api.cashflow().then(setCashflow).catch(() => {});
      })
      .catch(() => {
        // Revert: restore the item
        const saved = lastSkipRef.current;
        if (!saved) return;
        setCashflow(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            upcoming_bills: [...prev.upcoming_bills, saved.item].sort((a, b) => a.days_away - b.days_away),
          };
        });
        lastSkipRef.current = null;
      });
  }

  async function undoLastDismiss() {
    const last = lastDismissRef.current;
    if (!last) return;
    setUndoBar(null);
    lastDismissRef.current = null;
    setCashflow(prev => prev ? {
      ...prev,
      upcoming_bills: [...prev.upcoming_bills, ...last.bills].sort((a, b) => a.days_away - b.days_away),
      upcoming_income: [...prev.upcoming_income, ...last.income].sort((a, b) => a.days_away - b.days_away),
    } : prev);
    try {
      await last.request;
      await api.restoreRecurring(last.name);
      const fresh = await api.cashflow();
      setCashflow(fresh);
    } catch {}
  }

  // ── upcomingBlock ──────────────────────────────────────────────────────────
  const upcomingBlock = (
    <>
      {cashflowError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load what&apos;s coming.</p>
          <button
            onClick={retryCashflow}
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 min-h-[44px] px-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Retry
          </button>
        </div>
      ) : !cashflow ? (
        <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
      ) : (() => {
        const today = new Date();
        const nextPayday = new Date(periodEnd.getTime() + 86400000);
        const isCalendarMonth = payPeriodConfig.type === "calendar_month";
        const todayMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
        const nextPaydayMidnight = new Date(Date.UTC(nextPayday.getUTCFullYear(), nextPayday.getUTCMonth(), nextPayday.getUTCDate()));
        const daysToPayday = Math.round((nextPaydayMidnight.getTime() - todayMidnight.getTime()) / 86400000);
        const paydayLabel = nextPayday.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

        const NEXT_PERIOD_LOOKAHEAD_MS = 5 * 86400000;

        const rawItems = [
          ...cashflow.upcoming_income.map(b => ({ ...b, type: "income" as const })),
          ...cashflow.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
        ].filter(b => new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime() + NEXT_PERIOD_LOOKAHEAD_MS)
         .map(b => ({
           ...b,
           // EXCLUSIVE of payday day itself, except during the last-day
           // lookahead (daysToPayday <= 1), where the window still extends
           // through payday + 5 days INCLUSIVE. Mirrors backend/app/
           // services/pay_period.py's in_current_window/is_payday_day pair
           // exactly (2026-08-28 decision, owner verbatim: "we still want
           // to have some visibility over the next pay period but I don't
           // think it should count in the existing one"): an item on or
           // after payday belongs to the NEXT pay period, visible in the
           // list below the divider but excluded from this period's
           // arithmetic — at_risk_raw/inAtRiskKeySet further down both gate
           // off this same flag, so this one line is the single source of
           // truth for the boundary across the whole upcoming list.
           next_period: daysToPayday <= 1 ? b.days_away > daysToPayday + 5 : b.days_away >= daysToPayday,
         }))
         .sort((a, b) => {
          if (a.days_away !== b.days_away) return a.days_away - b.days_away;
          if (a.type !== b.type) return a.type === "income" ? -1 : 1;
          return b.amount - a.amount;
        });

        const currentPeriodItems = rawItems.filter(i => !i.next_period);

        if (rawItems.length === 0) {
          // Nothing left to pay this period — the whole spendable pool is free.
          return (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
              </div>
              <PlansDock
                debtView={debtSummary}
                growView={growView}
                hide={hideNetWorth}
                onDebtTap={() => router.push("/cards")}
                onGrowTap={() => router.push("/grow")}
              />
              <PlansSection
                commitments={commitments}
                allocations={allocations}
                allocationsError={allocationsError}
                accounts={accounts}
                onAdd={() => setSetAsideSheetOpen(true)}
                onEditCommitment={(c) => setCommitmentSheet({ editing: c })}
                onEditAllocation={(a) => setAllocationSheet(a)}
              />
              {/* PennyPromptBar removed here too (owner, 2026-08-25: "I
                  think we can remove penny from the planning page") — see
                  the removal comment further below, where the bar used to
                  sit in the main (non-empty) branch, for the full history. */}
            </div>
          );
        }

        // "Spendable everywhere" (Kevin, 2026-08): runway uses the same
        // spendable-cash pool as the Home Safe-to-Spend hero — savings are
        // never silently folded in. Falls back to available_balance for
        // caches computed before spendable_balance existed.
        const spendableNow = cashflow.spendable_balance ?? cashflow.available_balance ?? 0;
        const savingsNow = cashflow.savings_balance ?? 0;
        // Last day of the period (or payday itself): from here, next-period
        // preview rows join the risk assessment instead of staying calm.
        const assessNextPeriod = daysToPayday <= 1;

        // POOLED transfer rule (Kevin, 2026-08-26, live-data bug: the
        // pooled "left" figure read £8,753 on payday, £3,794 of which was
        // his own money moving between his own spendable accounts, and
        // then each of those four standing orders debited it straight back
        // out again, making his own transfers look like losses). spendableNow
        // already sums EVERY one of the user's SPENDABLE accounts at once,
        // so a traced internal transfer whose destination is also inside
        // that pool is definitionally a no-op for this total: nothing
        // enters the pool, nothing leaves it, the source leg's debit and
        // the destination leg's credit cancel exactly. The old approach
        // credited the destination leg from internal_inflows and then
        // still debited the source leg's bill row, which is arithmetically
        // self-cancelling by end of day but wrong for every row in
        // between, the "left" figure right after a traced STO looked like
        // his money had shrunk when none of it had gone anywhere. The fix:
        // isPooledNoOp bills skip BOTH legs, no credit is invented from
        // internal_inflows and no debit is taken either, `running` simply
        // doesn't move for that row. A standing order into a SAVINGS pot
        // is different: spendableNow (built from `_split_balances` on the
        // backend, see the CashflowData/InternalInflow docs in lib/api.ts)
        // never counted that destination in the first place, so that money
        // genuinely leaves this pool and must keep debiting (proven on
        // live data: a RAINY DAY SAVER standing order was silently netting
        // itself out of the runway before destination_spendable existed at
        // all). An untraced movement (no learned destination pair) also
        // keeps debiting, same fail-safe direction as before: undercount
        // the credit rather than overstate available cash on a payload
        // this walk can't classify. isPooledNoOp (top of file) is the only
        // place allowed to interpret dest_account_spendable, every pooled
        // consumer below must call it rather than re-deriving the rule.

        let running = spendableNow;
        const items = rawItems.map(item => {
          if (item.type === "income") {
            running += item.amount;
            return { ...item, balance_after: running, at_risk: false, account_short: false, account_timing: false, is_credit_card: false, at_risk_raw: false, account_short_raw: false, isMovement: false };
          } else {
            // "movement" (transfer/savings/investment STO) is not spend,
            // per DESIGN.md, red means genuine financial risk only, and a
            // missed top-up has no fee, no cut-off, no credit damage
            // (worst case the money just stays in the account). So a
            // movement never gets the red account_short/at_risk treatment,
            // even when the raw simulation says it can't be funded, the
            // *_raw flags below carry that fact through for the calm,
            // non-red copy shown elsewhere in this row.
            const isMovement = item.kind === "movement";
            // Every kind still debits `running` here EXCEPT a pooled
            // no-op transfer (see the block comment above): a genuine
            // commitment/discretionary/movement is real money leaving the
            // pool and can still genuinely bounce a later bill, so it
            // stays in the simulation, but a traced transfer between two
            // of the user's own spendable accounts never left the pool in
            // the first place, so skipping its debit here (rather than
            // debiting it and crediting the destination leg elsewhere) is
            // the only way the running total stays honest row by row.
            if (!isPooledNoOp(item)) {
              running -= item.amount;
            }
            const acctBalance = item.account_balance ?? null;
            // Prefer the real backend-computed flag; fall back to the old
            // balance-sign proxy only if a stale payload omits it.
            const is_credit_card = item.is_credit_card !== undefined
              ? item.is_credit_card
              : (acctBalance !== null && acctBalance < 0);
            // Genuine vs timing split, same story as the callout/chip above
            // and derived from the same genuineAccountIds set (no third
            // walk): atRiskKeySet only ever contains bills the CONSERVATIVE
            // walk flagged, so a row can be in it while its account still
            // clears under the optimistic (credit-first) ordering. Only a
            // row whose account is a genuine shortfall (still short even
            // credited first) earns account_short/RED; a row whose account
            // only trips the conservative tie-break earns account_timing/
            // AMBER instead, per the Red Is Risk Rule.
            const inAtRiskKeySet = atRiskKeySet.has(atRiskKey(item)) && (!item.next_period || assessNextPeriod);
            const isGenuineAccount = genuineAccountIds.has(item.account_id ?? "__null__");
            const account_short_raw = !is_credit_card && inAtRiskKeySet && isGenuineAccount;
            const account_timing_raw = !is_credit_card && inAtRiskKeySet && !isGenuineAccount;
            const at_risk_raw = running < 0 && (!item.next_period || assessNextPeriod);
            return {
              ...item,
              balance_after: running,
              at_risk: at_risk_raw && !isMovement,
              account_short: account_short_raw && !isMovement,
              account_timing: account_timing_raw && !isMovement,
              is_credit_card,
              at_risk_raw,
              account_short_raw,
              isMovement,
            };
          }
        });

        const billsBeforePayday = rawItems.filter(item => {
          if (item.type !== "bill") return false;
          const d = new Date(item.expected_date);
          return d < nextPaydayMidnight;
        });
        // Excludes pooled no-op bills before summing, same isPooledNoOp
        // rule as the running walk above and the same reason: a bill that's
        // actually a traced standing order into another of the user's own
        // SPENDABLE accounts hasn't left the pool this runway figure is
        // drawn from, so it was never a real reduction to begin with, there
        // is no separate credit to net back in (that was the old, more
        // roundabout approach: sum every bill, then subtract the traced
        // inflows back out; this is the same arithmetic result but honest
        // about what it means, the no-op bill just isn't "a bill" for this
        // total). A standing order into SAVINGS, or an untraced movement,
        // is the opposite case: that money genuinely leaves this pool, so
        // it must keep reducing the runway and stays in the sum.
        const runwayBillsTotal = billsBeforePayday
          .filter(b => !isPooledNoOp(b))
          .reduce((s, b) => s + b.amount, 0);
        // Allocations reduce what's left to last the period by their UNFILLED
        // remainder only, never the full amount_per_period: filled money has
        // already left the balances baked into spendableNow, so subtracting
        // the full amount here would double-count it. `remaining` is exactly
        // that unfilled portion, server-computed (GET /cashflow's own
        // `allocations` array, same enriched shape as GET /allocations) — no
        // client-side fill maths, per the backend contract this mirrors.
        // Absent on older cached payloads, so this degrades to 0/no line.
        const allocationsRemainingTotal = (cashflow.allocations ?? [])
          .filter(a => a.active)
          .reduce((s, a) => s + a.remaining, 0);
        const runway = spendableNow - runwayBillsTotal - allocationsRemainingTotal;
        const runwayNegative = runway < 0;

        const atRiskCount = items.filter(i => i.type === "bill" && i.at_risk).length;
        void atRiskCount;

        // Bank-side PENDING debits (see backend/app/services/
        // pending_transactions.py) — DISPLAY ONLY. Deliberately built from
        // `cashflow.observed_pending_bills`, never `cashflow.upcoming_bills`
        // (the backend already excludes a matched occurrence from that
        // list), and appended AFTER the running-balance walk above rather
        // than folded into `rawItems`/`items`: `running`, `at_risk`,
        // `account_short`/`account_timing` (and the `atRiskKeySet`/
        // `genuineAccountIds` sets built earlier from `upcoming_bills`)
        // must never see these rows, or the whole point — the walk
        // stopping at what the bank balance already reflects — would be
        // undone client-side. Hardcoded calm/never-at-risk flags below are
        // therefore not a shortcut, they're the correct answer: this money
        // has already left, so there is nothing left to risk.
        const observedPendingItems = (cashflow.observed_pending_bills ?? [])
          .filter(b => new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime() + NEXT_PERIOD_LOOKAHEAD_MS)
          .map(b => ({
            ...b,
            type: "bill" as const,
            next_period: daysToPayday <= 1 ? b.days_away > daysToPayday + 5 : b.days_away >= daysToPayday,
            balance_after: spendableNow,
            at_risk: false,
            account_short: false,
            account_timing: false,
            is_credit_card: b.is_credit_card ?? false,
            at_risk_raw: false,
            account_short_raw: false,
            isMovement: b.kind === "movement",
          }));
        const displayItems = [...items, ...observedPendingItems];

        function groupByDay(list: typeof displayItems) {
          const groups: { label: string; items: typeof displayItems }[] = [];
          for (const item of list) {
            const label = item.days_away === 0 ? "Today" : item.days_away === 1 ? "Tomorrow" : `${item.days_away} days`;
            const g = groups.find(g => g.label === label);
            if (g) g.items.push(item);
            else groups.push({ label, items: [item] });
          }
          return groups;
        }

        const groups = groupByDay(displayItems);

        function formatItemDate(iso: string) {
          const d = new Date(iso);
          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        }

        function formatPendingDate(iso: string) {
          const d = new Date(iso);
          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        }

        function renderRow(item: typeof displayItems[0]) {
          const isPlanned = item.type === "bill" && item.planned;
          // Risk doesn't care who authored the bill — planned rows flag the
          // same as predicted ones when their account can't cover them.
          // atRiskBills only ever contains commitment/discretionary items
          // (movement is filtered out at the source), so this can't flag a
          // movement row red.
          const atRiskMatch = item.type === "bill"
            ? atRiskBills.find(r => r.name === item.name && r.expected_date === item.expected_date)
            : undefined;
          // RED only for a genuinely short account, still short even when
          // the money due in is credited first (genuineAccountIds, from the
          // optimistic walk built above). A same-day timing risk, the
          // account only looks short because the conservative walk puts
          // this bill before the credit that's arriving the same day, gets
          // the amber treatment instead of red, matching the callout/chip
          // above and per the Red Is Risk Rule. Derived from the two walks
          // already run above, never a third pass, and never recomputed:
          // the same genuineAccountIds Set backs the callout, the chip, the
          // pooled-walk account_short/account_timing split below, and this
          // row.
          const flagged = !!atRiskMatch && genuineAccountIds.has(item.account_id ?? "__null__");
          const timingRisk = !!atRiskMatch && !flagged;
          // A movement whose raw simulation says it can't be funded gets a
          // calm, non-red note instead of the usual red treatment or the
          // plain bank-name line.
          const movementCalm = item.type === "bill" && !!item.isMovement && (item.at_risk_raw || item.account_short_raw);
          // Bank-side PENDING debit already observed (see the
          // `item.observed_pending` doctrine comment further down, and
          // UpcomingBill.observed_pending in lib/api.ts): the money has
          // already left per the bank, this row is resolved history-in-
          // transit, never a live risk. Design taste + impeccable pass,
          // 2026-09-01 (owner: "these pending payments should have an
          // indicator to say that they are pending"): a settling row must
          // read as calm and resolved, the OPPOSITE valence to red/amber,
          // so it gets its own quiet treatment on the icon chip, the
          // amount, and the right-hand rail below, checked ahead of the
          // ordinary category-colour chip so a red-hued category (e.g.
          // Debt, #f87171) can never leak a red-looking chip onto a row
          // that already resolved.
          const isSettling = item.type === "bill" && !!item.observed_pending;
          const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
          const highlighted = highlightTarget === rowKey;
          const catName = item.type === "income" ? (item.category || "Income") : (item.category || "Other");
          const colour = getCategoryColour(catName, colours);
          const Icon = getCategoryIcon(catName, iconOverrides);
          // Insight hint — calm bill rows only: never on next-period amber
          // rows, and never competing with a risk verdict, red OR amber,
          // leads there instead.
          // Settling rows are never the moment for a savings nudge either
          // (2026-09-01 fix) — a "could save ~£X ›" link on money that has
          // already left reads as an odd non-sequitur, per the owner's own
          // screenshot.
          const insightHint =
            item.type === "bill" && !item.next_period && !flagged && !timingRisk && !item.at_risk && !item.account_short && !movementCalm && !isSettling
              ? findInsightHint(item.name)
              : null;

          return (
            <SwipeDismissRow
              key={rowKey}
              onDismiss={() => isPlanned ? deletePlannedWithUndo(item.planned_id!) : dismissUpcoming(item.name)}
              label={isPlanned ? "Delete" : "Not recurring"}
            >
              <div
                data-bill-key={rowKey}
                onClick={() => {
                  if (isPlanned) {
                    setEditPlanned({ id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null });
                  } else {
                    setEditItem({ name: item.name, amount: item.amount, expected_date: item.expected_date, original_date: item.original_date, type: item.type, category: item.category, edited: item.edited, rule_label: item.rule_label });
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (isPlanned) {
                      setEditPlanned({ id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null });
                    } else {
                      setEditItem({ name: item.name, amount: item.amount, expected_date: item.expected_date, original_date: item.original_date, type: item.type, category: item.category, edited: item.edited, rule_label: item.rule_label });
                    }
                  }
                }}
                aria-label={isPlanned ? `Edit planned payment: ${item.name}` : `Edit ${item.name}`}
                // Variant A, "The Ledger" (owner pick, 2026-08-28): at-risk
                // rows keep the ordinary glass-card surface, no tinted
                // background or coloured border — red/amber is spent only
                // on the icon chip and the amount figure below, never on a
                // filled card (source: VariantA.tsx's own header comment).
                className={`rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform glass-card${highlighted ? " ring-2 ring-rose-400 dark:ring-rose-500" : ""}`}
              >
                {flagged ? (
                  <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0 text-rose-500" aria-hidden="true">
                    <AlertTriangle size={14} />
                  </span>
                ) : timingRisk ? (
                  <span className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true">
                    <AlertCircle size={14} />
                  </span>
                ) : isSettling ? (
                  // Neutral slate, never the category colour: a Debt-kind
                  // settling row (category brand colour #f87171, a red hue)
                  // would otherwise leak a red-looking chip onto a row that
                  // is fully resolved, the exact bug the owner flagged.
                  // Same "status icon overrides identity icon" convention
                  // the flagged/timingRisk chips already use above.
                  <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true">
                    <Clock size={14} />
                  </span>
                ) : (
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${colour}26` }}
                    aria-hidden="true"
                  >
                    <Icon size={15} style={{ color: colour }} />
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {/* Bill name stays ink regardless of risk severity
                        (Variant A: red is confined to the icon chip and
                        the amount figure only, never the row's text). */}
                    <p className="text-sm font-medium truncate text-slate-800 dark:text-slate-100">
                      {item.name}
                    </p>
                    {isPlanned ? (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">planned</span>
                    ) : item.edited && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">edited</span>
                    )}
                  </div>

                  {/* Origin badge — same whisper-tier treatment as the goal/
                      allocation cards' own badge (CommitmentCards/
                      AllocationCards above): no icon, no gradient, quiet
                      caption only, only ever meaningful on a planned row. */}
                  {item.type === "bill" && item.created_via === "penny" && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">set up with Penny</p>
                  )}

                  {/* Variant A, "The Ledger": the repeated "Includes a
                      £X move" sentence is told once already, on the merged
                      verdict card above. Each row instead carries a
                      collapsed "Why? ›" toggle (user-invoked disclosure,
                      not an animation gate) that reveals the same fact
                      locally, keyed by rowKey in the page-level `whyOpen`
                      set (renderRow is a plain helper, not a component, so
                      per-row toggle state can't live in a local hook).
                      Figures Are Ink / Variant A: the subline and the "Why"
                      link both stay neutral ink, red is confined to the
                      icon chip and the amount figure only. */}
                  {item.account_short && (item.account_bank || item.account_name) && (
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
                      <span className="truncate min-w-0">
                        {item.account_bank || item.account_name} · only <span className="font-mono tabular-nums">{sym}{(item.account_balance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> available
                      </span>
                      {atRiskMatch?.movementCulprit && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleWhy(rowKey); }}
                          className="flex-shrink-0 font-medium text-slate-400 dark:text-slate-500 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                        >
                          Why? {whyOpen.has(rowKey) ? <ChevronDown size={10} className="inline" aria-hidden="true" /> : "›"}
                        </button>
                      )}
                    </p>
                  )}
                  {item.account_short && whyOpen.has(rowKey) && atRiskMatch?.movementCulprit && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Includes a <span className="font-mono tabular-nums">{sym}{atRiskMatch.movementCulprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> move {formatItemDate(atRiskMatch.movementCulprit.expected_date)}
                    </p>
                  )}
                  {/* Timing-risk twin of the line above: same account, same
                      atRiskKeySet membership, but genuineAccountIds says the
                      money due in would have covered it if credited first.
                      Hedged like the callout's copy, never claims the
                      transfer has landed, only that it's due. */}
                  {item.account_timing && (item.account_bank || item.account_name) && (
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
                      <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                      <span className="truncate min-w-0">{item.account_bank || item.account_name} · money&apos;s due in around now</span>
                      {atRiskMatch?.movementCulprit && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleWhy(rowKey); }}
                          className="flex-shrink-0 font-medium text-slate-400 dark:text-slate-500 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                        >
                          Why? {whyOpen.has(rowKey) ? <ChevronDown size={10} className="inline" aria-hidden="true" /> : "›"}
                        </button>
                      )}
                    </p>
                  )}
                  {item.account_timing && whyOpen.has(rowKey) && atRiskMatch?.movementCulprit && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
                      <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                      <span className="truncate">Includes a <span className="font-mono tabular-nums">{sym}{atRiskMatch.movementCulprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> move {formatItemDate(atRiskMatch.movementCulprit.expected_date)}</span>
                    </p>
                  )}
                  {item.at_risk && !item.account_short && !item.account_timing && (
                    <>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Overall balance will be low</p>
                      {item.type === "bill" && (item.account_bank || item.account_name) && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                          {item.account_bank || item.account_name}
                        </p>
                      )}
                    </>
                  )}
                  {/* A movement that the simulation says may not be covered
                      is not a risk (no fee, no cut-off, no credit damage,
                      worst case it just doesn't happen) — calm, uncoloured
                      copy with a small amber signifier dot rather than the
                      red treatment above. */}
                  {movementCalm && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                      May not go through if the balance is tight. No fee either way.
                    </p>
                  )}
                  {item.is_credit_card && (item.account_bank || item.account_name) && !flagged && !timingRisk && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {item.account_bank || item.account_name}
                    </p>
                  )}
                  {item.type === "bill" && !item.account_short && !item.account_timing && !item.is_credit_card && !item.at_risk && !movementCalm && (item.account_bank || item.account_name) && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                      {item.account_bank || item.account_name}
                    </p>
                  )}

                  {insightHint && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/insights?tab=save&insight=${encodeURIComponent(insightHint.id)}`);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2 focus:outline-none focus-visible:underline"
                    >
                      {/* Wrapped in one span (owner fix, 2026-08-29): the
                          button is a flex container, and "could save "/" ›"
                          were previously bare text nodes sitting directly
                          alongside the amount span as separate flex items —
                          flex trims leading/trailing whitespace at each
                          item's own edge, so the rendered affordance lost
                          its spaces ("could save~£32›"). One span keeps the
                          whole phrase in normal inline flow, where internal
                          spaces are never trimmed. */}
                      <span>{insightHint.est ? <>could save <span className="font-mono tabular-nums">~£{insightHint.est}</span></> : "could save"}{" "}›</span>
                    </button>
                  )}

                  {/* Next-period distance is a temporal fact, not a caution,
                      so it does not wear Watch Amber (Figures Are Ink,
                      Kevin 2026-08-26, supersedes the 2026-08-09 amber
                      call). It reads one step quieter than a current-period
                      date instead, muteness standing in for distance. */}
                  <p className={`text-[11px] ${item.next_period ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>{formatItemDate(item.expected_date)}</p>
                  {/* Bank-side PENDING debit already matched (see
                      UpcomingBill.observed_pending) — the money has already
                      left the account per the bank, our settled feed just
                      hasn't caught up yet. Calm, never red: there is
                      nothing left here to be at risk. Mutually exclusive
                      with the `item.pending` block below (backend never
                      sets both on the same row). */}
                  {item.type === "bill" && item.observed_pending && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Left earlier today, still settling
                    </p>
                  )}
                  {item.type === "bill" && item.pending && (() => {
                    const dpd = item.days_past_due ?? 0;
                    // Owner decision (Kevin, 2026-08-27): a pending OWN
                    // transfer is not a merchant payment, so it never gets
                    // the "worth checking with them" copy below, there's no
                    // "them". Instead: quiet, non-red copy, and when the
                    // conservative walk says the source account can't fund
                    // it (at_risk_raw / account_short_raw, already computed
                    // above for exactly this purpose, no new arithmetic
                    // here), a small leading amber dot plus the skip
                    // affordance from day one of pending rather than
                    // waiting for the 5-day threshold below. Movements
                    // still never take the red flagged container or the
                    // account-level amber timing-risk container, this is a
                    // row-level amber signifier only (Figures Are Ink).
                    if (item.isMovement) {
                      const pendingDateStr = formatPendingDate(item.original_date ?? item.expected_date);
                      const unfunded = !!(item.at_risk_raw || item.account_short_raw);
                      const showDismiss = unfunded || dpd >= 5;
                      return (
                        <div>
                          {unfunded ? (
                            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
                              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                              <span className="truncate">Planned for {pendingDateStr}, hasn&apos;t left. {item.account_bank || item.account_name || "The account"} may not have the funds for it.</span>
                            </p>
                          ) : (
                            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                              Planned for {pendingDateStr}, hasn&apos;t left yet.
                            </p>
                          )}
                          {showDismiss && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); skipOccurrence(item); }}
                              className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:underline underline-offset-2 mt-0.5 focus:outline-none focus-visible:underline"
                            >
                              Dismiss for this month
                            </button>
                          )}
                        </div>
                      );
                    }
                    if (dpd >= 5) {
                      const pendingDateStr = formatPendingDate(item.original_date ?? item.expected_date);
                      const isDebt = item.category === "Debt";
                      return (
                        <div>
                          <p className={`text-[11px] leading-snug ${isDebt ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                            {isDebt
                              ? `Expected ${pendingDateStr}, hasn't left. A missed card payment can mean fees, so worth checking today.`
                              : `Expected ${pendingDateStr}, we haven't seen it leave. Worth checking with them.`}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); skipOccurrence(item); }}
                            className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:underline underline-offset-2 mt-0.5 focus:outline-none focus-visible:underline"
                          >
                            Dismiss for this month
                          </button>
                        </div>
                      );
                    }
                    return (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        expected {new Date(item.original_date ?? item.expected_date).toLocaleDateString("en-GB", { weekday: "short" })}, hasn&apos;t left yet
                      </p>
                    );
                  })()}
                </div>

                <div className="text-right flex-shrink-0">
                  {/* Settling figure: one weight down (semibold, not bold)
                      and one muted step off full ink (matches the row's
                      own secondary-text slate, same ramp as its "pool left"
                      caption) — never red/amber (Figures Are Ink / Red Is
                      Risk), and never hedged with "~" (the amount is exact,
                      sourced from the bank's own pending feed, not a
                      prediction). This is the one deliberate de-emphasis:
                      a settling row's amount should read as quieter than a
                      still-live figure at a glance, without needing the
                      caption line below to explain why. */}
                  <p className={`text-base font-mono tabular-nums ${
                    item.type === "income" ? "font-bold text-emerald-500" :
                    flagged ? "font-bold text-rose-600 dark:text-rose-400" :
                    isSettling ? "font-semibold text-slate-500 dark:text-slate-400" :
                    "font-bold text-slate-800 dark:text-slate-100"
                  }`}>
                    {item.type === "income" ? "+" : "−"}
                    {/* Forward contract: a credit-card repayment bill can
                        optionally carry amount_basis: "balance_estimate"
                        (derived from the card's live balance rather than
                        history) — render it with a leading "~", the minus
                        sign stays exactly where it already was. Absent
                        field renders exactly as today. */}
                    {item.type === "bill" && item.amount_basis === "balance_estimate" ? "~" : ""}
                    {sym}{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {/* Variant A, "The Ledger": this column is relabelled
                      "pool left" (it's the pooled spendable total, not a
                      per-account figure) and stays neutral ink always, even
                      when it goes negative — red is confined to the icon
                      chip and the amount figure above, never this rail. A
                      pooled no-op transfer (Kevin, 2026-08-26) never
                      touched `running` above, so showing "£X pool left" on
                      that row would just repeat the figure from the row
                      before it while implying this transfer shrank it,
                      which is exactly the reading he flagged as wrong.
                      Same size, weight and muted colour as the "pool left"
                      line so the column still reads as one continuous
                      rail, just a different final phrase. */}
                  {isSettling ? (
                    // Checked before isPooledNoOp so it always wins for a
                    // settling row regardless of pooled-transfer status:
                    // these rows sit outside the balance walk by
                    // construction (backend/app/routers/analytics.py's
                    // raw_observed_pending_bills never enters raw_bills),
                    // so `balance_after` is just spendableNow repeated
                    // identically on every settling row, a frozen figure
                    // that implies a walk that isn't happening (the exact
                    // "£1,765 pool left" repetition the owner flagged). One
                    // quiet word, same caption ramp as "pool left" itself,
                    // is the honest answer rather than a real-looking but
                    // meaningless number.
                    <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      settling
                    </p>
                  ) : isPooledNoOp(item) ? (
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      stays in your accounts
                    </p>
                  ) : (
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className="font-mono tabular-nums">{item.balance_after >= 0 ? "" : "−"}{sym}{Math.abs(item.balance_after).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> pool left
                    </p>
                  )}
                </div>
              </div>
            </SwipeDismissRow>
          );
        }

        function renderGroups(groups: ReturnType<typeof groupByDay>) {
          let dividerInserted = false;
          const nodes: ReactNode[] = [];
          for (const { label, items: groupItems } of groups) {
            const isNextPeriodGroup = groupItems.every(i => i.next_period);
            if (isNextPeriodGroup && !dividerInserted) {
              nodes.push(
                // Divider only, whisper dates (Kevin, 2026-08-26, supersedes
                // the 2026-08-09 amber call): a payday boundary is a
                // temporal fact, not a caution, so Watch Amber has no place
                // here per Figures Are Ink. Hairlines match the app's
                // standard divider colour (DESIGN.md --card-border:
                // #f1f5f9 / #334155, i.e. slate-100/slate-700). The label
                // span sits in the same whisper/eyebrow ramp as the TODAY/
                // N DAYS group headers above it, the divider stays the one
                // boundary marker. Copy updated (2026-08-28 decision) to
                // "from <date>" — the boundary this now sits in front of
                // includes the first item ON payday itself (next_period's
                // definition above), not just items strictly after it, so
                // "from" reads correctly for both.
                <div key="payday-boundary" className="flex items-center gap-3 py-1.5" role="separator" aria-label={`Next pay period, from ${paydayLabel}`}>
                  <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Next pay period · from {paydayLabel}</span>
                  <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
                </div>
              );
              dividerInserted = true;
            }
            // All items in a group share the same days_away, and days_away is
            // deterministic from "today", so they share the same absolute date.
            const dayKey = groupItems[0]?.expected_date;
            // Settling rows (bank-side PENDING debit already observed, see
            // isSettling in renderRow above) are pulled out of the plain
            // day list into their own quiet sub-cluster at the end of the
            // group, rather than interleaved row-by-row with the day's
            // still-live items — the owner's literal complaint was these
            // sitting undifferentiated among live Today rows. Deliberately
            // NOT a page-level "SETTLING · TODAY" section: nesting inside
            // whichever day group a settling row's own date actually lands
            // in (the day header above already states that date) means
            // this never has to assume "today" is correct for every
            // settling row, a rare backend edge case (a pending debit
            // observed against an occurrence several days overdue) can put
            // one in a different day group, and it still reads honestly.
            const settlingItems = groupItems.filter(i => i.type === "bill" && i.observed_pending);
            const activeItems = groupItems.filter(i => !(i.type === "bill" && i.observed_pending));
            nodes.push(
              <div key={label} data-day-key={dayKey}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">{label}</p>
                {activeItems.length > 0 && (
                  <div className="space-y-2">
                    {activeItems.map(renderRow)}
                  </div>
                )}
                {settlingItems.length > 0 && (
                  <div className={activeItems.length > 0 ? "mt-3" : ""}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
                      Settling
                    </p>
                    <div className="space-y-2">
                      {settlingItems.map(renderRow)}
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return nodes;
        }

        return (
          <div className="space-y-4">
            {/* Variant A, "The Ledger" (owner pick, 2026-08-28, one
                amendment: chevron not arrow on Review). The red shortfall
                banner that used to sit in the header above dissolves into
                this hero card: one merged verdict surface that states the
                shortfall once instead of twice (the header banner and both
                at-risk rows below it used to repeat the same "£400.00
                move" sentence verbatim). Card tint is driven by genuine
                shortfalls specifically (impeccable's own rule: genuine
                risk only), not by the runway figure alone — the big
                number still turns rose when it's actually negative
                (`runwayNegative`), but the two conditions are allowed to
                disagree (e.g. a genuinely short account with an otherwise
                positive runway still tints the card). */}
            {(cashflow.spendable_balance ?? cashflow.available_balance) != null && (
              <div
                data-tutorial-id="tutorial-planning-left"
                className={`rounded-3xl px-4 py-4 ${
                genuineShortfalls.length > 0
                  ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                  : "glass-hero"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
                      {isCalendarMonth ? "Before month end" : "To last this pay period"}
                    </p>
                    <p className={`text-2xl font-bold tracking-tight font-mono tabular-nums ${
                      runwayNegative
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-900 dark:text-slate-100"
                    }`}>
                      {runwayNegative ? "−" : ""}{sym}{Math.abs(runway).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      <span className="font-mono tabular-nums">{sym}{spendableNow.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> now
                      {" − "}
                      <span className="font-mono tabular-nums">{sym}{runwayBillsTotal.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> bills
                      {isCalendarMonth
                        ? ` · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
                        : ` · ends ${paydayLabel} (${daysToPayday} ${daysToPayday === 1 ? "day" : "days"})`}
                    </p>
                    {savingsNow > 0 && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        <span className="font-mono tabular-nums">+ {sym}{savingsNow.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> in savings if needed
                      </p>
                    )}
                    {/* Allocations subline — only the unfilled remainder,
                        same figure already folded into the headline above
                        (allocationsRemainingTotal), never a second/different
                        number. Quiet ramp, matches the savings line's tone. */}
                    {allocationsRemainingTotal > 0 && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        <span className="font-mono tabular-nums">− {sym}{allocationsRemainingTotal.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span> set aside for allocations
                      </p>
                    )}
                    {/* Variant A only shows this line when there's nothing
                        else to say — once the shortfall/timing attribution
                        below fills the card, restating "based on typical
                        spending" is noise on top of the real news. */}
                    {genuineShortfalls.length === 0 && timingShortfalls.length === 0 && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        Based on your typical spending, last 90 days
                      </p>
                    )}
                  </div>
                  {/* Same genuine/timing split as the attribution below:
                      counts genuine shortfalls only when there are any, and
                      falls back to the amber timing-risk count (and colour)
                      when that's all that's left. Never shows red for a
                      same-day timing risk. */}
                  {(genuineShortfalls.length > 0 || timingShortfalls.length > 0) && (
                    <span className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ${
                      genuineShortfalls.length > 0
                        ? "bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400"
                        : "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                    }`}>
                      {genuineShortfalls.length > 0
                        ? <AlertTriangle size={14} />
                        : <AlertCircle size={14} />}
                      {" "}
                      {genuineShortfalls.length > 0
                        ? `${genuineShortfalls.length} ${genuineShortfalls.length === 1 ? "account" : "accounts"} short`
                        : `${timingShortfalls.length} ${timingShortfalls.length === 1 ? "account" : "accounts"} short`}
                    </span>
                  )}
                </div>

                {/* The shortfall attribution — stated exactly once on the
                    whole page now. One sentence per genuinely short
                    account (Variant A's own pattern already generalises to
                    N accounts, it's a .map), each naming its own culprit
                    move where one was traced. Rows below no longer repeat
                    this, they carry a collapsed "Why? ›" toggle instead. */}
                {genuineShortfalls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-rose-200/70 dark:border-rose-800/60">
                    {genuineShortfalls.map((a) => (
                      <p key={a.accountId} className="text-[13px] leading-snug text-rose-900 dark:text-rose-100">
                        <span className="font-semibold">{a.bank}</span> is short by{" "}
                        <span className="font-mono tabular-nums font-semibold">{sym}{a.shortfall.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> before payday
                        {a.culprit && (
                          <>, mostly the <span className="font-mono tabular-nums">{sym}{a.culprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> move on {formatItemDate(a.culprit.expected_date)}</>
                        )}
                        .
                      </p>
                    ))}
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Payments can take a day or two to appear, so a very recent one may not be counted yet.
                      </p>
                      {/* Review — same behaviour the old banner's Review
                          button had (jump/highlight the top genuinely
                          at-risk bill row), restyled to Variant A's ghost
                          link. Amendment (owner, verbatim: "the review
                          should be an chevron instead of an arrow"):
                          Variant A's own mock reads "Review →"; every other
                          row affordance in this app (DockRow, PlansDock,
                          "could save … ›") uses a trailing chevron, not an
                          arrow, so this uses the same ChevronRight icon
                          rather than A's arrow glyph. */}
                      <button
                        type="button"
                        onClick={() => {
                          // Restricted to bills on a genuinely short
                          // account. atRiskBills on its own can still
                          // include a timing-risk account's row, and
                          // Review here must only ever jump to something
                          // this (red) attribution is actually about.
                          const top = [...atRiskBills]
                            .filter(b => genuineAccountIds.has(b.account_id ?? "__null__"))
                            .sort((a, b) => a.days_away !== b.days_away ? a.days_away - b.days_away : b.amount - a.amount)[0];
                          if (top) setHighlightTarget(`bill-${top.name}-${top.expected_date}`);
                        }}
                        className="flex-shrink-0 min-h-[44px] flex items-center gap-0.5 px-2 -my-2.5 text-[13px] font-semibold text-rose-600 dark:text-rose-400 underline-offset-2 hover:underline active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg"
                      >
                        Review <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Timing-risk twin, never red (Red Is Risk Rule): the
                    exact HSBC/NatWest/Monzo payday-STO case, an account
                    only looks short because the conservative walk puts a
                    payment before the same-day credit that's due in. */}
                {timingShortfalls.length > 0 && (
                  <div className={`mt-3 ${genuineShortfalls.length === 0 ? "pt-3 border-t border-slate-200/70 dark:border-white/10" : ""}`}>
                    {timingShortfalls.map((t) => (
                      <p key={t.accountId} className="text-[12px] leading-snug text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                        <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 flex-shrink-0 mt-[5px]" />
                        Money&apos;s due into {t.bank}{t.dueDate ? ` on ${formatItemDate(t.dueDate)}` : ""}. If a payment leaves first, it could bounce.
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <PlansDock
              debtView={debtSummary}
              growView={growView}
              hide={hideNetWorth}
              onDebtTap={() => router.push("/cards")}
              onGrowTap={() => router.push("/grow")}
            />
            <PlansSection
              commitments={commitments}
              allocations={allocations}
              allocationsError={allocationsError}
              accounts={accounts}
              onAdd={() => setSetAsideSheetOpen(true)}
              onEditCommitment={(c) => setCommitmentSheet({ editing: c })}
              onEditAllocation={(a) => setAllocationSheet(a)}
            />
            {/* PennyPromptBar removed here (owner, 2026-08-25: "I think we
                can remove penny from the planning page"). HISTORY: this bar
                was removed once before, on 2026-08-17, on the owner's
                challenge that a one-tap-away control duplicated the bottom
                nav and outranked the genuine-risk shortfall alert above it
                on this page — then re-added when Penny became its own
                /penny page and Planning needed an explicit door back in.
                That reasoning no longer applies: Penny now opens as a
                popover from the nav (usePennySheet,
                components/PennySheetProvider.tsx) on every screen,
                including this one, so the nav affordance the 2026-08-17
                removal was protecting is already present in-place here —
                this bar would just be a second, redundant one. Same logic,
                same retirement; it should not come back a third time.
                `planningSummary` (the runway/at-risk grounding string this
                bar used to hand off via `open({ summary })`) was removed
                alongside it: BottomNav.tsx's screenForPathname/
                openPennySheet is the only other caller that opens the sheet
                with `screen: "planning"`, and it passes only `{ screen,
                paydayActive }`, no `summary` — so there was no other
                reachable path left for that string to reach Penny through,
                and it's gone rather than left as an orphaned computation. */}

            {currentPeriodItems.length === 0 && groups.length > 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
              </div>
            )}
            {groups.length > 0 && (
              <div className="space-y-3" data-tutorial-id="tutorial-planning-upcoming">
                {renderGroups(groups)}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-3xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">PLANNING</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s coming</h1>
          </div>
          {/* Entry point to /planning/dismissed. Owner pick, 2026-08-29,
              from the /design/dismissed entry-point round: Variant A, a
              bare bin glyph, icon only, header right, transplanted class-
              for-class from EntryPointVariants.tsx's HeaderA. Always
              visible rather than appearing only once something is set
              aside, so it sits exactly where a user reaching for it after
              an accidental dismissal already expects to find it, just
              quieter (lighter slate, no badge) while dismissedCount is 0.
              The foot link this replaced (both branches of the upcoming
              list, below) is removed per A/B's shared rule: one
              destination, one door. */}
          <button
            type="button"
            onClick={() => router.push("/planning/dismissed")}
            aria-label="Set aside"
            className="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Trash2
              size={20}
              strokeWidth={1.75}
              className={dismissedCount > 0 ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}
            />
          </button>
        </div>
        {/* The genuine/timing shortfall callouts that used to live here
            (RED banner, then AMBER timing-risk banner) are gone — Variant
            A, "The Ledger" (owner pick, 2026-08-28) dissolves that content
            into the merged TO LAST verdict card inside upcomingBlock
            below, one surface stating the shortfall once instead of a
            banner plus repeated per-row sentences. See the verdict card's
            own comment there for the full account. */}
      </div>

      {dayFallbackNote && (
        <p className="px-5 pt-2 text-xs text-slate-500 dark:text-slate-400">{dayFallbackNote}</p>
      )}

      <div className="px-4 pt-4 pb-2">{upcomingBlock}</div>

      {/* Undo snackbar */}
      {undoBar && (
        <div
          key={undoNonce}
          className="fixed left-4 right-4 z-[70] pointer-events-none"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="pointer-events-auto bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 pl-4 pr-2 min-h-[48px]">
              <p className="text-sm font-medium text-white dark:text-slate-900">
                {undoBar.kind === "planned" ? "Planned payment deleted" : "Prediction removed"}
              </p>
              <button
                onClick={undoBar.kind === "planned" ? undoPlannedDelete : undoLastDismiss}
                className="text-sm font-bold text-indigo-300 dark:text-indigo-600 rounded-lg px-4 min-h-[44px] active:bg-white/10 dark:active:bg-slate-900/10"
              >
                Undo
              </button>
            </div>
            <div className="h-[3px] bg-indigo-400/90" style={{ animation: "wdCountdown 6s linear forwards" }} />
          </div>
        </div>
      )}

      {/* UpcomingEditSheet */}
      {editItem && (
        <UpcomingEditSheet
          item={editItem}
          onClose={() => setEditItem(null)}
          onDismiss={() => dismissUpcoming(editItem.name)}
          onSaved={async () => {
            try {
              const fresh = await api.cashflow();
              setCashflow(fresh);
            } catch {}
          }}
        />
      )}

      {/* PlannedEditSheet */}
      {editPlanned && (
        <PlannedEditSheet
          item={editPlanned}
          accounts={accounts}
          onClose={() => setEditPlanned(null)}
          onDelete={() => deletePlannedWithUndo(editPlanned.id)}
          onSaved={() => { api.cashflow().then(setCashflow).catch(() => {}); }}
        />
      )}

      {/* PlanOneOffSheet */}
      {planSheetOpen && (
        <PlanOneOffSheet
          accounts={accounts}
          onClose={() => setPlanSheetOpen(false)}
          onSaved={() => { api.cashflow().then(setCashflow).catch(() => {}); }}
        />
      )}

      {/* CommitmentSheet */}
      {commitmentSheet && (
        <CommitmentSheet
          accounts={accounts}
          commitment={commitmentSheet.editing}
          onClose={() => setCommitmentSheet(null)}
          onSaved={() => refreshCommitments()}
          onCancelled={() => refreshCommitments()}
        />
      )}

      {/* AllocationSheet — edit only, creation is SetAsideSheet's envelope step */}
      {allocationSheet && (
        <AllocationSheet
          accounts={accounts}
          allocation={allocationSheet}
          periodStart={periodStart}
          onClose={() => setAllocationSheet(null)}
          onSaved={() => refreshAllocations()}
          onDeleted={() => refreshAllocations()}
        />
      )}

      {/* SetAsideSheet — the single "+ Set money aside" door */}
      {setAsideSheetOpen && (
        <SetAsideSheet
          accounts={accounts}
          periodStart={periodStart}
          onClose={() => setSetAsideSheetOpen(false)}
          onSelectByDate={() => setCommitmentSheet({ editing: null })}
          onSelectSingle={() => setPlanSheetOpen(true)}
          onSavedAllocation={() => refreshAllocations()}
        />
      )}

      {/* Pay period settings */}
      {settingsOpen && (
        <PayPeriodSettingsSheet
          current={payPeriodConfig}
          onClose={() => setSettingsOpen(false)}
          onSave={(c) => { setPayPeriodConfig(c); setSettingsOpen(false); }}
        />
      )}

      <BottomNav />
    </div>
  );
}

function SwipeDismissRow({ onDismiss, children, label = "Not recurring" }: { onDismiss: () => void; children: React.ReactNode; label?: string }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const shellRef = useRef<HTMLDivElement>(null);

  function onTouchStart(e: React.TouchEvent) {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    axis.current = "none";
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis.current = Math.abs(mx) > Math.abs(my) * 1.5 ? "h" : "v";
      if (axis.current === "h") setDragging(true);
    }
    if (axis.current !== "h") return;
    setDx(Math.min(0, mx));
  }

  function onTouchEnd() {
    if (!start.current) { setDragging(false); return; }
    const width = shellRef.current?.offsetWidth ?? 320;
    const elapsed = Date.now() - start.current.t;
    const flick = elapsed < 250 && dx < -60;
    start.current = null;
    setDragging(false);
    if (dx < -width * 0.4 || flick) {
      setDx(-width - 24);
      setTimeout(onDismiss, 180);
    } else {
      setDx(0);
    }
    axis.current = "none";
  }

  return (
    <div ref={shellRef} className="relative overflow-hidden rounded-2xl">
      <div
        className="absolute inset-0 rounded-2xl bg-rose-500 flex items-center justify-end gap-1.5 pr-4"
        style={{ opacity: Math.min(1, Math.abs(dx) / 80) }}
      >
        <X size={14} className="text-white" />
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
