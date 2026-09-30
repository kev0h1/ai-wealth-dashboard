"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { EyeOff, X } from "lucide-react";
import { api, Account, Allocation, CashflowData } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/components/Spinner";
import { useTutorialReady } from "@/components/TutorialContext";
import { setPennyScreenView } from "@/components/PennySheetProvider";
import { buildUpcomingRunwayView, type UpcomingRunwayInput } from "@/lib/pennyScreenViews";
import { isPooledNoOp, doesNotTouchCash } from "@/lib/cashWalk";
import { computeClusterMarkers } from "@/lib/upcomingMarkers";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import UpcomingDivider from "@/components/upcoming/UpcomingDivider";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import UpcomingDetailsSheet from "@/components/upcoming/UpcomingDetailsSheet";
import UpcomingRowDetails, { upcomingDate } from "@/components/upcoming/UpcomingRowDetails";
import { canDismissUpcomingOccurrence, upcomingPaymentKey as atRiskKey } from "@/lib/upcomingAttention";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";
import SetAsideList, { type SetAsideItem } from "@/components/upcoming/SetAsideList";

// Editing flows are not needed to understand the initial runway. Keeping them
// out of the first Planning bundle makes the forecast usable sooner while the
// same components load on demand when a user opens a sheet.
const UpcomingEditSheet = dynamic(() => import("@/components/UpcomingEditSheet"));
const PlanOneOffSheet = dynamic(() => import("@/components/PlanOneOffSheet"));
const PlannedEditSheet = dynamic(() => import("@/components/PlannedEditSheet"));
const PayPeriodSettingsSheet = dynamic(() => import("@/components/PayPeriodSettingsSheet"));
const AllocationSheet = dynamic(() => import("@/components/AllocationSheet"));
const SetAsideSheet = dynamic(() => import("@/components/SetAsideSheet"));

// isPooledNoOp and doesNotTouchCash (the single pooled-cash-walk predicates
// used throughout this component, including in JSX further down) now live
// in lib/cashWalk.ts so a framework-free node test can import the exact
// production functions — see scripts/cash-walk.test.mjs.

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

// Compact set-aside ledger — the approved Upcoming design treats envelopes
// and one-offs as inputs to this pay period's forecast, not as large planning
// cards. The right-hand amount is the unfilled remainder that the runway
// actually subtracts; the supporting line keeps filled/target figures and
// recurrence visible without making the user reconstruct that relationship.
// Pending entries show no money figure because nothing is reserved yet.
//
// G131 fold-in (g124-upcoming-refine, variant A, the "raw-string clutter"
// hygiene fix): the row rendering itself now lives in the shared
// components/upcoming/SetAsideList.tsx, imported by both this page and
// that surface's design preview. This function only resolves PlanningPage's
// own Allocation + Account data down to the SetAsideItem shape that shared
// component actually takes — the same "props, not raw fetches" boundary
// UpcomingHeroCard/UpcomingDayCard already use.
function toSetAsideItem(a: Allocation, accounts: Account[]): SetAsideItem {
  const feedAccount = accounts.find((acc) => acc.id === a.fill_account_id);
  const feedLabel = a.fill_display_name || feedAccount?.name || null;
  const startsLabel = new Date(a.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return {
    id: a.id,
    name: a.name,
    feedLabel,
    feedSuffix: a.match_type === "description_contains" ? " · similar payments" : undefined,
    amountPerPeriod: a.amount_per_period,
    filledThisPeriod: a.filled_this_period,
    remaining: a.remaining,
    recurrence: a.recurrence,
    pending: a.pending,
    completed: a.completed,
    pendingStartsLabel: a.pending ? startsLabel : undefined,
    createdViaPenny: a.created_via === "penny",
  };
}

// One section and one creation door for the two current-period plan types:
// an envelope or a one-off payment. Long-term goals are deliberately absent
// here and live on Planning.
function PlansSection({
  allocations,
  allocationsError,
  accounts,
  onAdd,
  onEditAllocation,
}: {
  allocations: Allocation[] | null;
  allocationsError: boolean;
  accounts: Account[];
  onAdd: () => void;
  onEditAllocation: (a: Allocation) => void;
}) {
  const loading = allocations === null && !allocationsError;
  const activeAllocations = (allocations ?? []).filter((a) => a.active);
  const empty = activeAllocations.length === 0;

  return (
    <section id="pay-period-plans" className="scroll-mt-20" data-tutorial-id="tutorial-planning-plans" aria-labelledby="pay-period-plans-heading">
      <div className="flex min-h-11 items-center justify-between gap-3 px-1">
        <h2 id="pay-period-plans-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Set aside this period</h2>
        <button
          type="button"
          onClick={onAdd}
          data-tutorial-id="tutorial-planning-add"
          className="min-h-11 rounded-lg px-2 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
        >
          + Add
        </button>
      </div>
      {loading ? (
        <div className="glass-card h-[62px] animate-pulse rounded-2xl" aria-label="Loading pay-period plans" />
      ) : allocationsError ? (
        <div className="glass-card rounded-2xl px-4 py-4" role="status">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Couldn’t load what you’ve set aside.</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">The forecast above is still available.</p>
        </div>
      ) : empty ? (
        <div className="glass-card rounded-2xl px-4 py-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nothing set aside yet.</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Add an envelope or one-off payment for this pay period.</p>
        </div>
      ) : (
        <SetAsideList
          items={activeAllocations.map((a) => toSetAsideItem(a, accounts))}
          onEdit={(id) => {
            const a = activeAllocations.find((x) => x.id === id);
            if (a) onEditAllocation(a);
          }}
        />
      )}
      {!loading && !allocationsError && !empty && <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">Only the amount still to reserve reduces the forecast above.</p>}
    </section>
  );
}

export default function PlanningPage() {
  const { payPeriodConfig, setPayPeriodConfig } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sym = "£";
  const [planningNow] = useState(() => Date.now());
  // Penny screen context (B39) — the runway hero's own three headline
  // values (`runway`/`runwayStatus`/`isCalendarMonth`) are computed deep
  // inside `upcomingBlock`'s render-time IIFE below (a large row-by-row
  // simulation that depends on a lot of page-only state — see that block's
  // own extensive comments), not inside a hook, so they can't be read
  // directly from a `useEffect` here. This ref is written to, in plain JS
  // (no hook-order concern — it's not a hook call), the moment those three
  // values are known inside the IIFE; the effect below reads it back AFTER
  // every commit (no dependency array) and publishes whatever it currently
  // holds via `buildUpcomingRunwayView` — the SAME function a node test
  // pins against fixture inputs — so the figure Penny can quote back can
  // never disagree with the one just rendered. `undefined` (the initial
  // value, and while `upcomingBlock`'s own early "nothing left to pay"/
  // loading/error branches are showing instead) means "nothing to
  // publish", not "not decided yet" — those branches have no runway
  // number, so there is nothing to quote either.
  const pennyRunwayRef = useRef<UpcomingRunwayInput | undefined>(undefined);
  useEffect(() => {
    setPennyScreenView("upcoming", pennyRunwayRef.current ? buildUpcomingRunwayView(pennyRunwayRef.current) : null);
  });

  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [cashflowError, setCashflowError] = useState(false);

  // Tour readiness — the runway hero and the upcoming list both read off
  // `cashflow`, so the tour must wait for it (or a genuine fetch error) the
  // same way upcomingBlock's own cashflowError/!cashflow gate does above.
  useTutorialReady("upcoming", !!cashflow || cashflowError);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Allocations — see AllocationCards' own comment for the null-vs-error
  // distinction (null = loading/genuinely none, error = GET failed).
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [allocationsError, setAllocationsError] = useState(false);
  // Edit-only now — creation moved into SetAsideSheet's envelope step
  // (owner consolidation, 2026-08-29).
  const [allocationSheet, setAllocationSheet] = useState<Allocation | null>(null);
  // The single door's own sheet (step 1 kind cards, step 2 for "An
  // envelope" only — "One payment" hands off to PlanOneOffSheet below.
  // "By a date" used to hand off to CommitmentSheet on this page; that kind
  // is hidden here (SetAsideSheet's `scope="upcoming"` prop) now that
  // long-term goals live on their own section in LongTermPlanningPage.tsx.
  const [setAsideSheetOpen, setSetAsideSheetOpen] = useState(false);
  // Count backing the header "Set aside" bin's tone (quiet at 0, regular
  // above). Starts at 0 so the control renders quiet by default; see the
  // fetch effect below for why this must never gate the page's main data.
  const [dismissedCount, setDismissedCount] = useState(0);

  const [detailItem, setDetailItem] = useState<{
    model: UpcomingRowModel;
    edit: () => void;
    skip?: () => Promise<void>;
  } | null>(null);

  // Derived rather than mirrored into state: changing the pay-period setting
  // now produces one render instead of an effect-driven second render.
  const [periodStart, periodEnd] = useMemo(
    () => getPayPeriodWithConfig(new Date(planningNow), payPeriodConfig),
    [payPeriodConfig, planningNow]
  );

  // The runway is the page's primary answer, so its request starts alone.
  // Plans now follow it in the page hierarchy, but their supporting requests
  // can still wait for the browser's first idle slot instead of competing with
  // the forecast for initial render time.
  useEffect(() => {
    api.cashflow().then(setCashflow).catch(() => setCashflowError(true));
  }, []);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const loadSecondary = () => {
      // G135 (2026-09-21), audited and deliberately not changed here: this
      // page has no notion of a fresh user. It fetches accounts but never
      // tests `.length`, and its empty states are about a pay period having
      // no data, not about having nothing connected at all, so a brand-new
      // user sees empty figures rather than a "connect something" route.
      // G135 fixed the two surfaces that DID claim to lead somewhere (Home's
      // fresh-user card, app/planning/GrowPanel.tsx's empty ladder). Giving
      // this page one is a new empty state needing a design round, not a
      // route fix. Do not re-investigate; propose it to Kevin instead.
      getAccountsCached().catch(() => [] as Account[]).then(setAccounts);
      // Allocations are additive and must never block the forecast.
      api.listAllocations().then(setAllocations).catch(() => setAllocationsError(true));
      api.dismissedSeries()
        .then((d) => setDismissedCount(d.user.length + d.engine.length))
        .catch(() => {});
    };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(loadSecondary, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(loadSecondary, 150);
    return () => window.clearTimeout(timer);
  }, []);

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
      const timer = window.setTimeout(() => setSettingsOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // ── At-risk bills ──────────────────────────────────────────────────────────
  // G163 (2026-09-25, Kevin: "the AI should know money is coming in so
  // perhaps I shouldn't flag this, it only becomes a problem the day
  // after"): ONE walk now, a direct port of backend/app/services/
  // companion.py's `walk_sort_key` — same-day, credits (income/inflows)
  // before debits (bills). A confirmed income stream expected into an
  // account on day D covers what leaves that account on day D; it only
  // lapses, and the deficit becomes real, the day after it was expected
  // with no matching credit. This replaces the old TWO-walk design (a
  // conservative bills-before-income walk driving every RED treatment,
  // plus a second optimistic walk consulted only to tell a genuine
  // shortfall from a same-day timing artefact): the same-day-income
  // suppression that used to need a second walk for is now inherent in the
  // ordering itself, so both walks below use it and necessarily agree.
  // `atRiskWalks.conservative`/`.optimistic` both still exist and both
  // point at this SAME result — kept as two keys (rather than refactoring
  // every reader below) purely so the rest of this file, which reads both,
  // compiles unchanged; `genuineAccountIds` (built from `.optimistic`) is
  // therefore now just every account `.conservative` itself flags, and the
  // `severity: "timing"` branch derived from their difference can no
  // longer occur (see its own comment further down).
  const atRiskWalks = (() => {
    if (!cashflow) return null;
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    const daysToPay = Math.round((nextPaydayMs - planningNow) / 86400000);
    const simEndMs = nextPaydayMs + (daysToPay <= 1 ? 5 * 86400000 : 0);
    const walk = walkUpcomingAccounts(cashflow, simEndMs);
    // Both legacy readers still share the same credits-first result.
    // G176 exposes that walk's account working, without changing the hero.
    return { conservative: walk.atRisk, optimistic: walk.atRisk, coverage: walk.coverage };
  })();

  // `.conservative` is the one true source for every RED treatment on this
  // page (bill rows, the callout, the chip) — still true since G163, just
  // now built from the single credits-before-debits walk rather than a
  // bills-first one.
  const atRiskBills = atRiskWalks?.conservative ?? [];

  const atRiskKeySet = new Set(atRiskBills.map(atRiskKey));

  // G163: `.conservative` and `.optimistic` now point at the SAME walk (see
  // the comment above `atRiskWalks`), so this is simply every account
  // `.conservative` already flagged — kept as its own Set because so much
  // below still reads it, not because it can diverge from atRiskBills any
  // more. Pre-G163 this distinguished a genuine shortfall (still short even
  // with same-day money credited first) from a timing risk (only short
  // because bills were walked before that same-day credit); that
  // distinction no longer arises, since the walk itself now credits first.
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
        const daysToPay = Math.round((nextPaydayMs - planningNow) / 86400000);
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
        // G163: since the walk itself now credits same-day money before
        // debiting bills, `genuineAccountIds` is every account atRiskBills
        // already flagged, so this is always "genuine" in practice — a
        // "timing" account can no longer occur (the walk that used to
        // produce one no longer disagrees with itself). Left as a real
        // branch, not collapsed, only because it is cheap insurance against
        // a payload built from an older cache (see the atRiskWalks comment
        // above) still carrying whatever shape produced a "timing" read.
        const severity: "genuine" | "timing" = genuineAccountIds.has(accountId) ? "genuine" : "timing";
        return { accountId, bank, balance, shortfall, culprit: earliest?.movementCulprit, dueDate: earliestCredit?.expected_date ?? null, severity };
      })
      .filter((x): x is AccountShortfall => x !== null)
      .sort((a, b) => b.shortfall - a.shortfall);
  })();

  // The split this page's whole at-risk UI hangs off: RED banner/chip use
  // genuineShortfalls only (current copy, current colour); AMBER uses
  // timingShortfalls (new, calmer treatment). See severity's computation
  // above for what separates the two. G163: timingShortfalls should now
  // always be empty (the walk that used to produce a "timing" account no
  // longer disagrees with itself) — the amber rendering code downstream is
  // left in place only as insurance against a payload from an older cache.
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
    // Wait for the cashflow-backed rows to commit before resolving their DOM
    // targets. This also avoids an effect-driven synchronous render cascade.
    const timer = window.setTimeout(() => {
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

      router.replace("/upcoming", { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
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
    // The detail sheet shows progress and a retryable failure. Remove the
    // occurrence only after confirmation, so a failed request cannot alter
    // forecast ordering or roll back a different simultaneous dismissal.
    return api.skipUpcomingOccurrence(item.name, dateKey)
      .then(() => {
        setCashflow(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            upcoming_bills: prev.upcoming_bills.filter(
              b => !(b.name === item.name && b.expected_date === item.expected_date)
            ),
          };
        });
        api.cashflow().then(setCashflow).catch(() => {});
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
  /* renderRow only captures ref-backed mutation handlers for later user
     events; it never reads those refs while this JSX is being produced. */
  /* eslint-disable react-hooks/refs */
  // Reset before every render's ternary below runs: only the success IIFE
  // branch (rawItems.length > 0) ever sets this back to a real value, so an
  // error/loading/nothing-left-to-pay render correctly clears whatever a
  // PRIOR render may have published, rather than leaving Penny quoting a
  // runway figure that is no longer on screen.
  pennyRunwayRef.current = undefined;
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
              <PlansSection
                allocations={allocations}
                allocationsError={allocationsError}
                accounts={accounts}
                onAdd={() => setSetAsideSheetOpen(true)}
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
            // no-op transfer (see the block comment above) or a charge on a
            // credit card (G109, see doesNotTouchCash's own doc comment): a
            // genuine commitment/discretionary/movement is real money
            // leaving the pool and can still genuinely bounce a later bill,
            // so it stays in the simulation, but a traced transfer between
            // two of the user's own spendable accounts never left the pool
            // in the first place, and a card charge hasn't touched cash yet
            // either, so skipping its debit here (rather than debiting it
            // and crediting the destination leg elsewhere) is the only way
            // the running total stays honest row by row.
            if (!doesNotTouchCash(item)) {
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
        // Excludes pooled no-op bills and credit-card charges before
        // summing, same doesNotTouchCash rule as the running walk above and
        // the same reason: a bill that's actually a traced standing order
        // into another of the user's own SPENDABLE accounts hasn't left the
        // pool this runway figure is drawn from, so it was never a real
        // reduction to begin with, there is no separate credit to net back
        // in (that was the old, more roundabout approach: sum every bill,
        // then subtract the traced inflows back out; this is the same
        // arithmetic result but honest about what it means, the no-op bill
        // just isn't "a bill" for this total). A standing order into
        // SAVINGS, or an untraced movement, is the opposite case: that
        // money genuinely leaves this pool, so it must keep reducing the
        // runway and stays in the sum. G109: a charge sitting ON a credit
        // card is excluded the same way — no cash has left any bank account
        // yet, only a limit moved; the repayment TO the card is a plain
        // debit on the paying account and is unaffected, it keeps reducing
        // this total as before.
        const runwayBillsTotal = billsBeforePayday
          .filter(b => !doesNotTouchCash(b))
          .reduce((s, b) => s + b.amount, 0);
        // Income landing before payday belongs in the same equation as the
        // row-by-row ledger below. Previously rows credited it while the hero
        // ignored it, so the final row and headline could disagree.
        const runwayIncomeTotal = rawItems
          .filter(item => item.type === "income" && new Date(item.expected_date) < nextPaydayMidnight)
          .reduce((s, item) => s + item.amount, 0);
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
        const runway = spendableNow + runwayIncomeTotal - runwayBillsTotal - allocationsRemainingTotal;
        const runwayNegative = runway < 0;
        const runwayStatus = runwayNegative ? "short" : runway > 0 ? "left" : "even";
        // Penny screen context (B39) — plain JS assignment, not a hook
        // call (see `pennyRunwayRef`'s own declaration above for why this
        // lives inside a render-time IIFE rather than a `useEffect`). The
        // publish effect up top reads this back after the commit and calls
        // the SAME `buildUpcomingRunwayView` a node test pins against
        // fixture inputs, so the figure Penny can quote back can never
        // disagree with the hero below, which renders these same three
        // values.
        pennyRunwayRef.current = { runway, runwayStatus, isCalendarMonth };

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

        // G131 (g124-upcoming-refine fold-in, G127 ask #3, Kevin
        // 2026-09-18): day headings now carry the absolute date instead of
        // a relative count ("3 days" -> "Mon 21 Sep"); "Today"/"Tomorrow"
        // keep their word too, prefixed onto the date ("Today · Fri 18
        // Sep") since a bare date for today reads worse than the word and
        // the word is genuinely more useful at that distance. The group key
        // is the exact ISO date (`dayKeyIso`) rather than the old
        // days-away label — every item sharing a `days_away` already shares
        // the same calendar date (both are offsets from "today" computed
        // once per render), so this changes no grouping outcome, only what
        // a group is keyed and sorted by. The explicit sort (absent before)
        // is needed for computeClusterMarkers below, which assumes
        // ascending dayOffset; `observedPendingItems` is appended after
        // `items` and isn't guaranteed to already be in date order.
        interface DayGroup {
          word?: "Today" | "Tomorrow";
          dateLabel: string;
          dayOffset: number;
          dayKeyIso: string;
          items: typeof displayItems;
        }

        function groupByDay(list: typeof displayItems): DayGroup[] {
          const groups: DayGroup[] = [];
          for (const item of list) {
            const dayKeyIso = item.expected_date;
            let g = groups.find(g => g.dayKeyIso === dayKeyIso);
            if (!g) {
              g = {
                word: item.days_away === 0 ? "Today" : item.days_away === 1 ? "Tomorrow" : undefined,
                dateLabel: formatItemDate(item.expected_date),
                dayOffset: item.days_away,
                dayKeyIso,
                items: [],
              };
              groups.push(g);
            }
            g.items.push(item);
          }
          return groups.sort((a, b) => a.dayOffset - b.dayOffset);
        }

        const groups = groupByDay(displayItems);

        function formatItemDate(iso: string) {
          const d = new Date(iso);
          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        }

        function prepareRow(item: typeof displayItems[0]) {
          const isPlanned = item.type === "bill" && item.planned;
          // Risk doesn't care who authored the bill — planned rows flag the
          // same as predicted ones when their account can't cover them.
          // atRiskBills only ever contains commitment/discretionary items
          // (movement is filtered out at the source), so this can't flag a
          // movement row red.
          const atRiskMatch = item.type === "bill"
            ? atRiskBills.find(r => atRiskKey(r) === atRiskKey(item))
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
          const future = item.next_period && !assessNextPeriod;
          const coverage = !isSettling && !item.is_credit_card && !future
            ? atRiskWalks?.coverage.get(atRiskKey(item)) : undefined;
          const openItem = () => {
            if (isPlanned) {
              setEditPlanned({ id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null });
            } else {
              setEditItem({ name: item.name, amount: item.amount, expected_date: item.expected_date, original_date: item.original_date, type: item.type, category: item.category, edited: item.edited, rule_label: item.rule_label });
            }
          };
          const model: UpcomingRowModel = {
            rowKey,
            identity: item.type === "bill" && item.planned_id ? item.planned_id : `${item.type}-${atRiskKey(item)}`,
            type: item.type,
            name: item.name,
            amount: item.amount,
            expectedDate: item.expected_date,
            originalDate: item.original_date,
            category: item.category,
            accountLabel: item.account_bank || item.account_name,
            accountBalance: item.account_balance,
            edited: item.edited,
            isPlanned,
            createdViaPenny: item.type === "bill" && item.created_via === "penny",
            isMovement: item.isMovement,
            isCreditCard: item.is_credit_card,
            isSettling,
            pending: item.pending,
            daysPastDue: item.days_past_due,
            amountBasis: item.type === "bill" ? item.amount_basis : null,
            flagged,
            timingRisk,
            accountShort: item.account_short,
            accountTiming: item.account_timing,
            atRisk: item.at_risk,
            movementCalm,
            unfundedMovement: !!(item.at_risk_raw || item.account_short_raw),
            highlighted,
            assessment: future ? "future" : coverage ? undefined : "unverified",
            coverage: coverage ? { ...coverage, optionalMove: item.isMovement } : undefined,
            why: atRiskMatch?.movementCulprit ? {
              open: false,
              culprit: {
                amount: atRiskMatch.movementCulprit.amount,
                expectedDate: atRiskMatch.movementCulprit.expected_date,
              },
            } : undefined,
            after: isSettling
              ? { kind: "settling" }
              : isPooledNoOp(item)
                ? { kind: "pooled-transfer" }
                : item.is_credit_card
                  ? { kind: "credit-card" }
                  : { kind: "balance", value: item.balance_after },
            categoryColour: colour,
            CategoryIcon: Icon,
          };

          return {
            model,
            open: () => setDetailItem({
              model, edit: openItem,
              skip: canDismissUpcomingOccurrence(model) ? () => skipOccurrence(item) : undefined,
            }),
            dismiss: () => isPlanned ? deletePlannedWithUndo(item.planned_id!) : dismissUpcoming(item.name),
          };
        }

        // G131 (g124-upcoming-refine fold-in, ask #3 + #6): same-day
        // payments now render as one bounded UpcomingDayCard (hairline
        // divide-y rows, the transactions-hub grammar) instead of a bare
        // day label over floating cards, and the relative sense of time
        // that used to sit in the day label ("10 days") now lives on the
        // canvas as an occasional cluster marker between day cards — see
        // lib/upcomingMarkers.ts's own doctrine comment for why "cluster"
        // is the only rule shipped (Kevin picked it over "gap" and
        // "rhythm", both of which stay design-preview-only). When a
        // marker lands on the exact same seam as the payday boundary, the
        // two are merged into that one divider (the boundary keeps the
        // hairline row, the marker becomes a caption underneath) rather
        // than stacked — see UpcomingDivider's own doctrine comment for
        // why (a two-line hairline row broke at 390px in the rejected
        // round this fixes).
        function renderGroups(groups: ReturnType<typeof groupByDay>) {
          const markers = computeClusterMarkers(
            groups.map(g => ({ dayOffset: g.dayOffset, dayKeyIso: g.dayKeyIso, itemCount: g.items.length }))
          );
          let dividerInserted = false;
          const nodes: ReactNode[] = [];
          for (const g of groups) {
            const isNextPeriodGroup = g.items.every(i => i.next_period);
            const isPaydaySeam = isNextPeriodGroup && !dividerInserted;
            const marker = markers.find(m => m.beforeDayKeyIso === g.dayKeyIso);

            if (isPaydaySeam) {
              nodes.push(
                // Divider only, whisper dates (Kevin, 2026-08-26, supersedes
                // the 2026-08-09 amber call): a payday boundary is a
                // temporal fact, not a caution, so Watch Amber has no place
                // here per Figures Are Ink. Copy (2026-08-28 decision) is
                // "from <date>" — the boundary this sits in front of
                // includes the first item ON payday itself (next_period's
                // definition above), not just items strictly after it, so
                // "from" reads correctly for both. The aria copy keeps its
                // own slightly different phrasing (comma, not the visible
                // "·") from before this fold-in.
                <UpcomingDivider
                  key="payday-boundary"
                  label={`Next pay period · from ${paydayLabel}`}
                  ariaLabel={`Next pay period, from ${paydayLabel}`}
                  sublabel={marker?.label}
                />
              );
              dividerInserted = true;
            } else if (marker) {
              nodes.push(<UpcomingDivider key={`marker-${marker.beforeDayKeyIso}`} label={marker.label} />);
            }

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
            const prepared = g.items.map(prepareRow);
            const heading = g.word ? `${g.word} · ${g.dateLabel}` : g.dateLabel;
            nodes.push(
              <UpcomingAttentionDay
                key={g.dayKeyIso}
                dayKeyIso={g.dayKeyIso}
                heading={heading}
                rows={prepared.map((entry) => entry.model)}
                onOpen={(model) => prepared.find((entry) => entry.model === model)?.open()}
                onDismiss={(model) => prepared.find((entry) => entry.model === model)?.dismiss()}
              />
            );
          }
          return nodes;
        }

        return (
          <div className="space-y-4">
            {/* G131 fold-in of the g124-upcoming-refine design round
                (variant A, cluster interval rule, Kevin 2026-09-18): the
                hero is now the shared UpcomingHeroCard component
                (components/upcoming/UpcomingHeroCard.tsx), imported here AND
                by that surface's design preview so the two can't drift. See
                that component's own doctrine comment for the full G124/G127
                history (bounded panel, the red tint removed, red narrowed to
                the figure and the "N accounts short" badge only). Content
                (every string and figure) is unchanged from before this
                fold-in; only the container, typography and colour rules
                moved. */}
            {(cashflow.spendable_balance ?? cashflow.available_balance) != null && (
              <UpcomingHeroCard
                isCalendarMonth={isCalendarMonth}
                daysToPayday={daysToPayday}
                paydayLabel={paydayLabel}
                spendableNow={spendableNow}
                runwayIncomeTotal={runwayIncomeTotal}
                runwayBillsTotal={runwayBillsTotal}
                allocationsRemainingTotal={allocationsRemainingTotal}
                savingsNow={savingsNow}
                runway={runway}
                runwayStatus={runwayStatus}
                genuineShortfalls={genuineShortfalls}
                timingShortfalls={timingShortfalls}
                formatDate={formatItemDate}
                onReview={() => {
                  // Restricted to bills on a genuinely short account.
                  // atRiskBills on its own can still include a timing-risk
                  // account's row, and Review here must only ever jump to
                  // something the (red) attribution is actually about.
                  const top = [...atRiskBills]
                    .filter(b => genuineAccountIds.has(b.account_id ?? "__null__"))
                    .sort((a, b) => a.days_away !== b.days_away ? a.days_away - b.days_away : b.amount - a.amount)[0];
                  if (top) setHighlightTarget(`bill-${top.name}-${top.expected_date}`);
                }}
              />
            )}

            <PlansSection
              allocations={allocations}
              allocationsError={allocationsError}
              accounts={accounts}
              onAdd={() => setSetAsideSheetOpen(true)}
              onEditAllocation={(a) => setAllocationSheet(a)}
            />

            {currentPeriodItems.length === 0 && groups.length > 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
              </div>
            )}
            {groups.length > 0 && (
              <section className="space-y-3" data-tutorial-id="tutorial-planning-upcoming" aria-labelledby="upcoming-ledger-heading">
                <div className="flex items-end justify-between gap-3 px-1">
                  <h2 id="upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Covered payments stay folded</p>
                </div>
                {renderGroups(groups)}
              </section>
            )}
          </div>
        );
      })()}
    </>
  );
  /* eslint-enable react-hooks/refs */

  return (
    <div inert={detailItem !== null} aria-hidden={detailItem ? true : undefined} className="mx-auto min-h-dvh max-w-xl pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2">
        {/* G127 ask #2 — header typography matches the codex reference
            exactly (app/design/upcoming-canvas-before-cards/
            UpcomingCanvasClient.tsx lines 84-113): no "UPCOMING" eyebrow,
            the h1 takes codex's text-[28px]/leading-tight/tracking-[-0.035em]
            and slate-950/white ink, and the header row aligns items-start
            (was items-center) with gap-4 (was gap-3). The descriptive
            sentence beneath the title is untouched content. */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
            <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">What will enter or leave, and whether every payment is covered.</p>
          </div>
          {/* Hidden predictions are recoverable, not deleted. Eye-off keeps
              that meaning distinct from a destructive bin action. */}
          <button
            type="button"
            onClick={() => router.push("/upcoming/dismissed")}
            aria-label={dismissedCount > 0 ? `Review ${dismissedCount} hidden predictions` : "Review hidden predictions"}
            title="Hidden predictions"
            className="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <EyeOff
              size={20}
              strokeWidth={1.75}
              className={dismissedCount > 0 ? "text-slate-500 dark:text-slate-400" : "text-slate-300 dark:text-slate-600"}
            />
            {dismissedCount > 0 && (
              <span className="absolute right-1 top-1 min-w-4 h-4 px-1 rounded-full bg-indigo-600 text-[10px] leading-4 font-semibold text-white text-center font-mono tabular-nums" aria-hidden="true">
                {Math.min(dismissedCount, 99)}
              </span>
            )}
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

      {detailItem && <UpcomingDetailsSheet
        title={detailItem.model.name}
        subtitle={`${detailItem.model.accountLabel ? `${detailItem.model.accountLabel} · ` : ""}${upcomingDate(detailItem.model.expectedDate)}`}
        onClose={() => setDetailItem(null)}
        onEdit={() => { detailItem.edit(); setDetailItem(null); }}
        editLabel={detailItem.model.isPlanned ? "Edit planned payment" : "Edit prediction"}
        onSkipOccurrence={detailItem.skip}
      ><UpcomingRowDetails model={detailItem.model} /></UpcomingDetailsSheet>}

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
          scope="upcoming"
          accounts={accounts}
          periodStart={periodStart}
          onClose={() => setSetAsideSheetOpen(false)}
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
    </div>
  );
}

// G176: UpcomingRow now owns the row presentation and composes
// SwipeDismissRow for the shipped treatment. PlanningPage keeps the financial
// derivation, grouping and API state, while design previews exercise the same
// production row boundary with fixture-safe props.
