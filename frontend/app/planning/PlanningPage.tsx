"use client";

import { isCountedInLeftToSpend } from "@/lib/accountCounted";
import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { EyeOff } from "lucide-react";
import { shouldRefetchStaleCashflow, scheduleStaleCashflowRefetch, canApplyStaleCashflow } from "@/lib/cashflowStaleRetry";
import { api, Account, Allocation, CashflowData, type AccountEligibility, type AccountPlanData, type CompanionItem } from "@/lib/api";
import { getAccountsCached } from "@/lib/accountsCache";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { resolveUpcomingPeriod } from "@/lib/upcomingPeriod";
import { useCategoryIcons } from "@/components/IconProvider";
import { upcomingCategoryAppearance } from "@/components/upcoming/UpcomingCategoryIcon";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/components/Spinner";
import { useTutorialReady } from "@/components/TutorialContext";
import { isPooledNoOp, doesNotTouchCash } from "@/lib/cashWalk";
import { computeClusterMarkers } from "@/lib/upcomingMarkers";
import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import UpcomingDivider from "@/components/upcoming/UpcomingDivider";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import type { PaymentDetail, UpcomingDetailView } from "@/components/upcoming/UpcomingDetailFlow";
import { canDismissUpcomingOccurrence, upcomingPaymentKey as atRiskKey } from "@/lib/upcomingAttention";
import { isOwnAccountMove } from "@/lib/cardRepayment";
import { withCoverSuggestions } from "@/lib/coverSuggestion";
import { compareUpcomingEvents, upcomingAccountAssessment, walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";
import { accountsWithPeriodActivity, paymentsThroughLabel, positionsFromToday, reconcileWithServerPosition, upcomingAccountWindow } from "@/lib/upcomingAccounts";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import { assessPlanOverlap, hasPlanSource, isPlanSourceAccount, plansFromApi } from "@/lib/upcomingPlans";
import { upcomingDisplayName } from "@/lib/upcomingDisplayName";
import UpcomingPlansCard from "@/components/upcoming/UpcomingPlansCard";
import { useFirstSync } from "@/lib/useFirstSync";
import FirstSyncCard from "@/components/FirstSyncCard";
import FirstSyncStatus from "@/components/FirstSyncStatus";

// Editing flows are not needed to understand the initial page. Keeping them
// out of the first Planning bundle makes the forecast usable sooner while the
// same components load on demand when a user opens a sheet.
const UpcomingDetailFlow = dynamic(() => import("@/components/upcoming/UpcomingDetailFlow"));
const PlanOneOffSheet = dynamic(() => import("@/components/PlanOneOffSheet"));
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

// G487: the one caveat the removed payday forecast card carried, kept as a
// quiet line under By account (which is where a very recent payment is missed).
function PaymentsLagNote() {
  return <p data-upcoming-payments-note className="px-1 text-xs leading-5 text-slate-600 dark:text-slate-300">Payments can take a day or two to appear, so a very recent one may not be counted yet.</p>;
}

export default function PlanningPage() {
  const { payPeriodConfig, setPayPeriodConfig } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const router = useRouter();
  const searchParams = useSearchParams();
  const firstSync = useFirstSync(reloadAfterFirstSync);
  const [planningNow] = useState(() => Date.now());
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [cashflowError, setCashflowError] = useState(false);
  // Tour readiness — the By account card and the upcoming list both read off
  // `cashflow`, so the tour must wait for it (or a genuine fetch error) the
  // same way upcomingBlock's own cashflowError/!cashflow gate does above.
  useTutorialReady("upcoming", !firstSync.pending && !firstSync.active && (!!cashflow || cashflowError));

  const [accounts, setAccounts] = useState<Account[]>([]);
  // G488: the account list has answered (or failed). Until then the rows and the
  // "Nothing more expected" line below would be judged against an empty list.
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Allocations — see AllocationCards' own comment for the null-vs-error
  // distinction (null = loading/genuinely none, error = GET failed).
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const [allocationsError, setAllocationsError] = useState(false);
  const [accountPlans, setAccountPlans] = useState<AccountPlanData[] | null>(null);
  const [accountPlansError, setAccountPlansError] = useState(false);
  // G238: the server's per-account position (the same figure Home's Spend from
  // is built on). Absent on an old API or a failed read: accountPlan falls back
  // to its own arithmetic.
  const [accountEligibility, setAccountEligibility] = useState<Record<string, AccountEligibility> | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "stalled" | "failed" | null>(null);
  const [todayItems, setTodayItems] = useState<CompanionItem[] | null>(null);
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

  const [flowView, setFlowView] = useState<UpcomingDetailView | null>(null);

  // Derived rather than mirrored into state: changing the pay-period setting
  // now produces one render instead of an effect-driven second render.
  // G327: the period is the server's (`cashflow.period`) once the payload
  // has arrived; the client pay-period config is only the loading seed.
  const upcomingPeriod = useMemo(
    () => resolveUpcomingPeriod(cashflow, { config: payPeriodConfig, nowMs: planningNow }),
    [cashflow, payPeriodConfig, planningNow]
  );
  const periodStart = upcomingPeriod.start;
  const periodEnd = upcomingPeriod.end;

  // The By account card is the page's primary answer, so its request starts alone.
  // Plans now follow it in the page hierarchy, but their supporting requests
  // can still wait for the browser's first idle slot instead of competing with
  // the forecast for initial render time.
  useEffect(() => {
    if (firstSync.pending || firstSync.active) return;
    let cancelled = false;
    api.cashflow().then((v) => { if (!cancelled) { setCashflow(v); setCashflowError(false); } }).catch(() => { if (!cancelled) setCashflowError(true); });
    return () => { cancelled = true; };
  }, [firstSync.pending, firstSync.active]);

  // E18: a forecast served stale while the worker recomputes is refetched once,
  // quietly, about five seconds later. The ref spends the single retry; a fresh
  // response re-arms it for the next correction.
  const staleRetried = useRef(false);
  useEffect(() => {
    if (firstSync.pending || firstSync.active) return;
    if (cashflow && cashflow.cashflow_stale !== true) staleRetried.current = false;
    if (!shouldRefetchStaleCashflow(cashflow, staleRetried.current)) return;
    return scheduleStaleCashflowRefetch(
      () => {
        api.cashflow().then((fresh) => {
          // G421: never inside an undo window, or a removed row would come back.
          if (canApplyStaleCashflow(lastPlannedDeleteRef.current, lastDismissRef.current)) setCashflow(fresh);
        }).catch(() => {});
      },
      () => { staleRetried.current = true; },
    );
  }, [cashflow, firstSync.pending, firstSync.active]);

  useEffect(() => {
    if (firstSync.pending || firstSync.active) return;
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
      getAccountsCached().catch(() => [] as Account[]).then((list) => { setAccounts(list); setAccountsLoaded(true); });
      // Allocations are additive and must never block the forecast.
      api.listAllocations().then(setAllocations).catch(() => setAllocationsError(true));
      api.listAccountPlans().then(setAccountPlans).catch(() => setAccountPlansError(true));
      api.getToday().then((today) => { setAccountEligibility(today.account_eligibility ?? null); setTodayItems(today.items ?? null); }).catch(() => {});
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
  }, [firstSync.pending, firstSync.active]);

  async function reloadAfterFirstSync() {
    setCashflowError(false);
    setCashflow(null);
    await Promise.all([
      api.cashflow().then(setCashflow),
      getAccountsCached(true).then(setAccounts).catch(() => {}),
      api.listAllocations().then((v) => { setAllocations(v); setAllocationsError(false); }).catch(() => setAllocationsError(true)),
      api.listAccountPlans().then((v) => { setAccountPlans(v); setAccountPlansError(false); }).catch(() => setAccountPlansError(true)),
      api.getToday().then((today) => { setAccountEligibility(today.account_eligibility ?? null); setTodayItems(today.items ?? null); }).catch(() => {}),
    ]);
  }

  // Refreshes both the allocations list (for the cards) and cashflow (for
  // the "remaining" figures the TO LAST subline/arithmetic reads) after a
  // save/pause/delete — a stale local list would otherwise show the old
  // filled/remaining split until the next full page load. A failed refresh
  // here is silent: the sheet has already closed, and stale-but-present
  // data is better than yanking the card away.
  // G238: a plan edit makes the server position stale. Drop it (the sheet falls
  // back to its own arithmetic meanwhile) and read the fresh one.
  function reloadAccountPositions() {
    setAccountEligibility(null);
    api.getToday().then((today) => { setAccountEligibility(today.account_eligibility ?? null); setTodayItems(today.items ?? null); }).catch(() => {});
  }

  // G486: mirror the account page's sync handling. While a sync runs (or after one fails) the account page shows
  // "checking" or "unavailable" instead of Available, so By account shows no figure either. A finished sync reloads positions.
  const reloadPositionsRef = useRef(reloadAccountPositions);
  reloadPositionsRef.current = reloadAccountPositions;
  useEffect(() => {
    let cancelled = false, timer: number | undefined, last: string | null = null;
    const poll = () => {
      api.getSyncStatus().then((next) => {
        if (cancelled) return;
        if (last && last !== "idle" && next.state === "idle") reloadPositionsRef.current();
        last = next.state;
        setSyncState(next.state);
        if (next.state === "syncing") timer = window.setTimeout(poll, 5000);
      }).catch(() => {});
    };
    poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, []);

  function refreshAllocations() {
    invalidateVerdictCache();
    reloadAccountPositions();
    api.listAllocations().then(setAllocations).catch(() => {});
    api.cashflow().then(setCashflow).catch(() => {});
    api.listAccountPlans().then((items) => { setAccountPlans(items); setAccountPlansError(false); }).catch(() => setAccountPlansError(true));
  }

  async function refreshAccountFlow() {
    // One committed refresh updates details and the underlying page together.
    // If it fails after a write, retry only this refresh, never the mutation.
    invalidateVerdictCache();
    reloadAccountPositions();
    try {
      const [forecast, envelopes, plans] = await Promise.all([api.cashflow(), api.listAllocations(), api.listAccountPlans()]);
      setCashflow(forecast); setAllocations(envelopes); setAccountPlans(plans);
      setAccountPlansError(false); setAllocationsError(false);
    } catch (error) {
      setAccountPlansError(true);
      throw error;
    }
  }

  function openAllocation(allocation: Allocation) {
    if (accountPlans?.some((plan) => plan.id === `allocation:${allocation.id}`)) setFlowView({ kind: "plan", id: `allocation:${allocation.id}` });
    else setAllocationSheet(allocation);
  }

  function retryAllocations() {
    setAllocationsError(false);
    setAllocations(null);
    api.listAllocations().then(setAllocations).catch(() => setAllocationsError(true));
  }

  function retryAccountPlans() {
    setAccountPlansError(false);
    setAccountPlans(null);
    api.listAccountPlans().then(setAccountPlans).catch(() => setAccountPlansError(true));
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

  // One window and one result feed the account card, its working and row
  // coverage. They are source-account evidence, never inputs to the pooled walk.
  const accountEndMs = upcomingAccountWindow(periodEnd.getTime(), planningNow, upcomingPeriod.fromServer ? upcomingPeriod.daysToPayday : undefined);
  const plans = cashflow ? assessPlanOverlap(plansFromApi(accountPlans ?? []), cashflow, accountEndMs, accounts) : [];
  const sourceIds = new Set(plans.filter((plan) => plan.active && hasPlanSource(plan)).map((plan) => plan.sourceId));
  const excludedAccountIds = new Set(accounts.filter((account) => !isCountedInLeftToSpend(account)).map((account) => account.id));
  // G486: the same loading and failed handling as the account page (a running or failed sync shows no figure).
  const availabilityStatus = syncState && syncState !== "idle" ? (syncState === "syncing" ? "loading" as const : "failed" as const) : "ready" as const;
  const accountPositions = positionsFromToday(accountEligibility, accounts, availabilityStatus) ?? {};
  const planSources = accounts.filter((account) => (sourceIds.has(account.id) || accountPositions[account.id]?.spendFrom != null) && isPlanSourceAccount(account) && !excludedAccountIds.has(account.id)).map((account) => ({ id: account.id, bank: account.provider, name: account.name, balance: account.balance }));
  const accountWalk = cashflow ? walkUpcomingAccounts(cashflow, accountEndMs, planSources, excludedAccountIds) : null;
  const accountPeriodLabel = paymentsThroughLabel(accountEndMs);
  const accountSummaries = withCoverSuggestions((accountWalk?.accounts ?? []).map((account) => reconcileWithServerPosition(account, accountPositions[account.id])), todayItems);
  const plansStatus = accountPlansError ? "error" : accountPlans === null ? "loading" : "ready";
  // G420: By account lists only accounts with something in the period. The detail flow keeps every summary so any row can still open its sheet.
  const listedAccountSummaries = accountsWithPeriodActivity(accountSummaries, plans);
  const paymentDetails: PaymentDetail[] = [];

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
  const planLinkHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const planId = searchParams.get("plan");
    if (!planId || plansStatus !== "ready" || allocations === null || planLinkHandledRef.current === planId) return;
    const plan = plans.find(item => item.id === planId);
    const timer = window.setTimeout(() => {
      planLinkHandledRef.current = planId;
      if (plan) setFlowView({ kind: searchParams.get("edit") === "1" ? "edit-plan" : "plan", id: planId });
      router.replace("/upcoming", { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, plansStatus, plans, allocations, router]);
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
    // Another optimistic action is starting (or the page is leaving): send the
    // delete but skip the refetch, which would overwrite that action.
    void confirmPlannedDelete(p.id, false);
  }

  // G421: the delete is awaited before anything is re-read, so the refetch can
  // never race it and bring the cancelled payment back. A failed delete puts
  // the server's truth back on screen instead of leaving it hidden.
  async function confirmPlannedDelete(id: string, refetch = true) {
    try {
      await api.deletePlanned(id);
      invalidateVerdictCache();
    } catch {}
    if (!refetch) return;
    try {
      const fresh = await api.cashflow();
      // Only apply when no other optimistic delete or dismiss is pending.
      if (lastPlannedDeleteRef.current === null && lastDismissRef.current === null) setCashflow(fresh);
    } catch {}
    reloadAccountPositions();
    api.listAccountPlans().then((items) => { setAccountPlans(items); setAccountPlansError(false); }).catch(() => {});
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
      lastPlannedDeleteRef.current = null;
      setUndoBar(null);
      void confirmPlannedDelete(id);
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
        request: api.dismissRecurring(name).then(() => { invalidateVerdictCache(); }).catch(() => {}),
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
    undoTimer.current = setTimeout(() => { setUndoBar(null); lastDismissRef.current = null; }, 6000);
  }

  function skipOccurrence(item: CashflowData["upcoming_bills"][0]) {
    const dateKey = item.original_date ?? item.expected_date;
    // The detail sheet shows progress and a retryable failure. Remove the
    // occurrence only after confirmation, so a failed request cannot alter
    // forecast ordering or roll back a different simultaneous dismissal.
    return api.skipUpcomingOccurrence(item.name, dateKey)
      .then(() => {
        invalidateVerdictCache();
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
  const upcomingBlock = (
    <>
      {firstSync.pending ? (
        <FirstSyncStatus error={firstSync.error} figuresError={firstSync.figuresError} onRetry={() => { void firstSync.refresh(); }} />
      ) : firstSync.active ? (
        <FirstSyncCard
          surface="upcoming"
          state={firstSync.status!.state as "syncing" | "stalled" | "failed"}
          connections={firstSync.status!.connections}
          retrying={firstSync.retrying}
          onRetry={() => { void firstSync.retry(); }}
        />
      ) : cashflowError ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load what&apos;s coming.</p>
          <button
            onClick={retryCashflow}
            className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 min-h-[44px] px-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Retry
          </button>
        </div>
      ) : !cashflow || !accountsLoaded ? (
        <div className="flex items-center justify-center py-16" role="status" aria-label="Loading what's coming"><Spinner size={32} /></div>
      ) : (() => {
        const { paydayLabel } = upcomingPeriod;
        const nextPaydayMidnight = upcomingPeriod.payday;

        const NEXT_PERIOD_LOOKAHEAD_MS = 5 * 86400000;

        const rawItems = [
          ...cashflow.upcoming_income.map((b, sourceIndex) => ({ ...b, source: b, sourceIndex, type: "income" as const })),
          ...cashflow.upcoming_bills.map((b, sourceIndex) => ({ ...b, source: b, sourceIndex, type: "bill" as const })),
        ].filter(b => new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime() + NEXT_PERIOD_LOOKAHEAD_MS)
         .map(b => ({
           ...b,
           // The card and row adapter use this exact boundary too. Payday
           // remains outside the pooled walk regardless of lookahead.
           next_period: new Date(b.expected_date).getTime() > accountEndMs,
         }))
         .sort(compareUpcomingEvents);

        const currentPeriodItems = rawItems.filter(i => !i.next_period);

        if (rawItems.length === 0) {
          // Nothing left to pay this period — the whole spendable pool is free.
          return (
            <div className="space-y-5">
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
              </div>
              <UpcomingAccountsCard accounts={listedAccountSummaries} periodLabel={accountPeriodLabel} plans={plans} plansStatus={plansStatus} onRetry={retryAccountPlans} onOpen={(account) => setFlowView({ kind: "account", id: account.id })} />
              {listedAccountSummaries.length > 0 && <PaymentsLagNote />}
              <UpcomingPlansCard
                allocations={allocations}
                allocationsError={allocationsError}
                plans={plans}
                plansStatus={plansStatus}
                accounts={accounts}
                onAdd={() => setSetAsideSheetOpen(true)}
                onEditAllocation={openAllocation}
                onPlan={(id) => setFlowView({ kind: "plan", id })}
                onRetryAllocations={retryAllocations}
                onRetryPlans={retryAccountPlans}
              />
              {/* PennyPromptBar removed here too (owner, 2026-08-25: "I
                  think we can remove penny from the planning page") — see
                  the removal comment further below, where the bar used to
                  sit in the main (non-empty) branch, for the full history. */}
            </div>
          );
        }

        // "Spendable everywhere" (Kevin, 2026-08): the row balances use the same
        // spendable-cash pool as the Home Safe-to-Spend hero — savings are
        // never silently folded in. Falls back to available_balance for
        // caches computed before spendable_balance existed.
        const spendableNow = cashflow.spendable_balance ?? cashflow.available_balance ?? 0;

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
        // itself out of the pooled balance before destination_spendable existed at
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
            return { ...item, balance_after: running, is_credit_card: false, isMovement: false };
          }
          // This is the existing pooled working, not account coverage.
          // Its cash-transfer/card exclusions and arithmetic stay intact.
          if (!doesNotTouchCash(item)) running -= item.amount;
          return { ...item, balance_after: running, is_credit_card: Boolean(item.is_credit_card), isMovement: isOwnAccountMove(item) };
        });

        // Bank-side settling debits are display-only: their cash has already
        // left. Neither the shared account walk nor this pooled walk deducts
        // observed_pending_bills again.
        const observedPendingItems = (cashflow.observed_pending_bills ?? [])
          .filter(b => new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime() + NEXT_PERIOD_LOOKAHEAD_MS)
          .map((b, sourceIndex) => ({
            ...b,
            source: b,
            sourceIndex,
            type: "bill" as const,
            next_period: new Date(b.expected_date).getTime() > accountEndMs,
            balance_after: spendableNow,
            is_credit_card: Boolean(b.is_credit_card),
            isMovement: isOwnAccountMove(b),
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
          const atRiskMatch = item.type === "bill"
            ? accountWalk?.riskByBill.get(item.source)
            : undefined;
          const isSettling = item.type === "bill" && !!item.observed_pending;
          const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
          const highlighted = highlightTarget === rowKey;
          const { Icon, colour } = upcomingCategoryAppearance(item.category, item.type, colours, iconOverrides);
          const model: UpcomingRowModel = {
            rowKey,
            identity: item.type === "bill" && item.planned_id ? item.planned_id : `${item.type}-${atRiskKey(item)}-${isSettling ? "settling-" : ""}${item.sourceIndex}`,
            type: item.type,
            name: upcomingDisplayName(item),
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
            pending: item.pending,
            daysPastDue: item.days_past_due,
            amountBasis: item.type === "bill" ? item.amount_basis : null,
            ...upcomingAccountAssessment(item.source, accountWalk!),
            highlighted,
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

          const detailId = isPlanned ? `planned:${item.planned_id}` : `${item.type}:${item.name}:${item.original_date ?? item.expected_date}:${item.sourceIndex}:${isSettling ? "settling" : "expected"}`;
          paymentDetails.push({
            id: detailId, model, source: item.source,
            editor: { name: item.name, amount: item.amount, expected_date: item.expected_date, original_date: item.original_date, type: item.type, edited: item.edited, rule_label: item.rule_label },
            planned: isPlanned ? { id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null } : undefined,
            cardId: item.type === "bill" && !isPlanned && item.is_card_repayment && item.card_dest_account_id && (item.amount_basis === "statement_estimate" || item.amount_basis === "user_entered" || item.amount_basis === "statement_unknown") ? item.card_dest_account_id : undefined,
            skip: canDismissUpcomingOccurrence(model) ? () => skipOccurrence(item) : undefined,
          });
          return {
            model,
            open: () => setFlowView({ kind: "payment", id: detailId }),
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
          <div className="space-y-5">
            <UpcomingAccountsCard accounts={listedAccountSummaries} periodLabel={accountPeriodLabel} plans={plans} plansStatus={plansStatus} onRetry={retryAccountPlans} onOpen={(account) => setFlowView({ kind: "account", id: account.id })} />
            {listedAccountSummaries.length > 0 && <PaymentsLagNote />}

            <UpcomingPlansCard
              allocations={allocations}
              allocationsError={allocationsError}
              plans={plans}
              plansStatus={plansStatus}
              accounts={accounts}
              onAdd={() => setSetAsideSheetOpen(true)}
              onEditAllocation={openAllocation}
              onPlan={(id) => setFlowView({ kind: "plan", id })}
              onRetryAllocations={retryAllocations}
              onRetryPlans={retryAccountPlans}
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
    <div inert={flowView !== null} aria-hidden={flowView ? true : undefined} className="mx-auto min-h-dvh max-w-xl pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2">
        {/* G127 ask #2 — header typography matches the codex reference
            exactly (app/design/upcoming-canvas-before-cards/
            UpcomingCanvasClient.tsx lines 84-113): no "UPCOMING" eyebrow,
            the h1 takes codex's text-[28px]/leading-tight/tracking-[-0.035em]
            and slate-950/white ink, and the header row aligns items-start
            (was items-center) with gap-4 (was gap-3). The descriptive
            sentence beneath the title is untouched content. */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
            <p className="mt-1 max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">What will enter or leave, and whether every payment is covered.</p>
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

      {flowView && <UpcomingDetailFlow initialView={flowView} onClose={() => setFlowView(null)} accounts={accounts} summaries={accountSummaries} plans={plans} plansStatus={plansStatus} allocations={allocations ?? []} payments={paymentDetails} periodLabel={accountPeriodLabel} periodStart={periodStart} serverPeriod={cashflow?.period} onRefresh={refreshAccountFlow} onDismiss={(payment) => dismissUpcoming(payment.editor.name)} onDeletePlanned={deletePlannedWithUndo} />}

      {/* PlanOneOffSheet */}
      {planSheetOpen && (
        <PlanOneOffSheet
          accounts={accounts}
          onClose={() => setPlanSheetOpen(false)}
          onSaved={() => { invalidateVerdictCache(); api.cashflow().then(setCashflow).catch(() => {}); }}
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
