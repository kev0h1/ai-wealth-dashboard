"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, X } from "lucide-react";
import { api, Account, CashflowData, Commitment, SavingsInsight } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useRouter } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import UpcomingEditSheet from "@/components/UpcomingEditSheet";
import PlanOneOffSheet from "@/components/PlanOneOffSheet";
import PlannedEditSheet from "@/components/PlannedEditSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import CommitmentSheet from "@/components/CommitmentSheet";

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
        Next 0% ends{" "}
        <span className={soon ? "text-amber-600 dark:text-amber-400" : ""}>{dateStr}</span>
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
function computeGrowRow(view: import("@/lib/api").GrowView): DockRowContent {
  if (!view.verdict?.headline) return null;

  const headline = view.verdict.headline;
  const match = headline.match(/(£[\d,]+(?:\.\d+)?)\s*\/\s*month\s+(.+)$/i);
  return (
    <>
      <span className="font-semibold">{match ? `${match[1]}/mo ${match[2]}` : headline}</span>
      <span className="text-slate-400 dark:text-slate-500"> · </span>
      <span className="text-slate-500 dark:text-slate-400">Grow</span>
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
// behind its elapsed fraction. "+ Plan a big expense" is a right-aligned
// header link above the goal(s) once any exist, or the quiet centred
// button when none do.
function CommitmentsBlock({
  commitments,
  onAdd,
  onEdit,
}: {
  commitments: Commitment[] | null;
  onAdd: () => void;
  onEdit: (c: Commitment) => void;
}) {
  const router = useRouter();
  const fmtC = (n: number) => "£" + Math.round(n).toLocaleString("en-GB");
  const active = (commitments ?? []).filter((c) => c.status === "active");

  if (active.length === 0) {
    return (
      <button
        onClick={onAdd}
        className="w-full min-h-[44px] py-2 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        + Plan a big expense
        <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">
          a goal to save toward
        </span>
      </button>
    );
  }

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
        <p className="mt-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-100 tabular-nums num">
          {fmtC(c.progress)} <span className="font-normal text-slate-400 dark:text-slate-500">of {fmtC(c.amount)}</span>
        </p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 num">
          {c.period_label
            ? `${fmtC(c.per_period_slice)} each pay period (${c.period_label}) · ${c.periods_left} left`
            : `${fmtC(c.per_period_slice)} a period · ${c.periods_left} left`}
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
            <span className="text-[12px] leading-snug text-amber-600 dark:text-amber-400">
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
            <span
              className={`text-[11px] line-clamp-2 leading-snug ${
                isCaution
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {c.feasibility_note}
            </span>
          </p>
        )}
      </button>
    );
  };

  const addLink = (
    <div className="flex justify-end">
      <button
        onClick={onAdd}
        title="A goal to save toward"
        className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        + Plan a big expense
      </button>
    </div>
  );

  if (active.length === 1) {
    return (
      <div className="space-y-2">
        {addLink}
        {renderGoalCard(
          active[0],
          "w-full text-left glass-card rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {addLink}
      <div className="relative -mx-4">
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
    </div>
  );
}

export default function PlanningPage() {
  const { payPeriodConfig, setPayPeriodConfig, region, hideNetWorth } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const router = useRouter();
  const sym = "£";

  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [cashflowError, setCashflowError] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debtSummary, setDebtSummary] = useState<import("@/lib/api").DebtPlanSummary | null>(null);
  const [growView, setGrowView] = useState<import("@/lib/api").GrowView | null>(null);
  const [commitments, setCommitments] = useState<Commitment[] | null>(null);
  const [commitmentSheet, setCommitmentSheet] = useState<null | { editing: Commitment | null }>(null);
  const [savingsInsights, setSavingsInsights] = useState<SavingsInsight[] | null>(null);

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
    // Insight hints on bill rows — decorative: any error just means no hints.
    api.getSavingsInsights().then(setSavingsInsights).catch(() => {});
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
  const atRiskBills = (() => {
    if (!cashflow) return [];
    const nextPaydayMs = periodEnd.getTime() + 86400000;
    // last-day lookahead: from the final day of the period, assess the first 5 days of the next one
    const daysToPay = Math.round((nextPaydayMs - Date.now()) / 86400000);
    const simEndMs = nextPaydayMs + (daysToPay <= 1 ? 5 * 86400000 : 0);
    const scopedBills = cashflow.upcoming_bills.filter(
      (b) => new Date(b.expected_date).getTime() <= simEndMs &&
             b.account_balance != null && b.account_balance >= 0 &&
             !b.is_credit_card
    );
    if (scopedBills.length === 0) return [];
    const running: Record<string, number> = {};
    for (const b of scopedBills) {
      const key = b.account_id ?? "__null__";
      if (!(key in running)) running[key] = b.account_balance!;
    }
    type Event =
      | { kind: "income"; days_away: number; amount: number; account_id: string | null | undefined }
      | { kind: "bill"; days_away: number; amount: number; account_id: string | null | undefined; bill: typeof scopedBills[0] };
    const events: Event[] = [
      ...scopedBills.map((b) => ({ kind: "bill" as const, days_away: b.days_away, amount: b.amount, account_id: b.account_id, bill: b })),
      ...cashflow.upcoming_income
        .filter((inc) => new Date(inc.expected_date).getTime() <= simEndMs)
        .map((inc) => ({ kind: "income" as const, days_away: inc.days_away, amount: inc.amount, account_id: inc.account_id as string | null | undefined })),
    ];
    events.sort((a, b) => {
      if (a.days_away !== b.days_away) return a.days_away - b.days_away;
      return (a.kind === "income" ? 1 : 0) - (b.kind === "income" ? 1 : 0);
    });
    const atRisk: typeof scopedBills = [];
    for (const ev of events) {
      if (ev.kind === "income") {
        if (ev.account_id) {
          const key = ev.account_id;
          if (key in running) running[key] += ev.amount;
        } else {
          for (const key of Object.keys(running)) running[key] += ev.amount;
        }
      } else {
        const key = ev.account_id ?? "__null__";
        if (!(key in running)) continue;
        // Deficit cascades (same semantics as companion.py's shortfall walk):
        // a bounced bill still debits the running balance, so every later bill
        // on a short account flags until income recovers it — not just the
        // single bill that first tipped it over.
        const bal = running[key];
        running[key] = bal - ev.amount;
        if (bal < ev.amount) {
          atRisk.push(ev.bill);
        }
      }
    }
    return atRisk;
  })();

  const atRiskKey = (b: { account_id?: string | null; expected_date: string; amount: number; name?: string }) =>
    `${b.account_id ?? "__null__"}|${b.expected_date}|${b.amount}|${b.name ?? ""}`;
  const atRiskKeySet = new Set(atRiskBills.map(atRiskKey));

  const accountShortfalls = (() => {
    if (!cashflow || atRiskBills.length === 0) return [];
    const accountIds = [...new Set(atRiskBills.map(b => b.account_id ?? "__null__"))];
    return accountIds
      .map(accountId => {
        const firstBill = atRiskBills.find(b => (b.account_id ?? "__null__") === accountId);
        if (!firstBill) return null;
        const balance = firstBill.account_balance ?? 0;
        const bank = firstBill.account_bank || firstBill.account_name || "Account";
        const nextPaydayMs = periodEnd.getTime() + 86400000;
        // last-day lookahead: from the final day of the period, assess the first 5 days of the next one
        const daysToPay = Math.round((nextPaydayMs - Date.now()) / 86400000);
        const simEndMs = nextPaydayMs + (daysToPay <= 1 ? 5 * 86400000 : 0);
        const scopedBills = cashflow!.upcoming_bills.filter(
          b => (b.account_id ?? "__null__") === accountId &&
               new Date(b.expected_date).getTime() <= simEndMs &&
               b.account_balance != null &&
               b.account_balance >= 0 &&
               !b.is_credit_card
        );
        const billsSum = scopedBills.reduce((s, b) => s + b.amount, 0);
        const shortfall = billsSum - balance;
        if (shortfall <= 0) return null;
        return { accountId, bank, balance, shortfall };
      })
      .filter((x): x is { accountId: string; bank: string; balance: number; shortfall: number } => x !== null)
      .sort((a, b) => b.shortfall - a.shortfall);
  })();

  // ── Undo state ──────────────────────────────────────────────────────────────
  const [undoBar, setUndoBar] = useState<{ kind: "recurring"; name: string } | { kind: "planned"; id: string } | null>(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightBill, setHighlightBill] = useState<string | null>(null);
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

  // Highlight scroll effect — no view guard needed (always on planning page)
  useEffect(() => {
    if (!highlightBill) return;
    const scrollTimer = setTimeout(() => {
      try {
        document
          .querySelector(`[data-bill-key="${CSS.escape(highlightBill)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {}
    }, 120);
    const clearTimer = setTimeout(() => setHighlightBill(null), 2800);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [highlightBill]);

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
         .map(b => ({ ...b, next_period: new Date(b.expected_date).getTime() > nextPaydayMidnight.getTime() }))
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
              <button
                onClick={() => setPlanSheetOpen(true)}
                className="w-full min-h-[44px] py-2 rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                + Plan a one-off
                <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">
                  a dated bill from one account
                </span>
              </button>
              <PlansDock
                debtView={debtSummary}
                growView={growView}
                hide={hideNetWorth}
                onDebtTap={() => router.push("/debt-plan")}
                onGrowTap={() => router.push("/grow")}
              />
              <CommitmentsBlock
                commitments={commitments}
                onAdd={() => setCommitmentSheet({ editing: null })}
                onEdit={(c) => setCommitmentSheet({ editing: c })}
              />
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
        let running = spendableNow;
        const items = rawItems.map(item => {
          if (item.type === "income") {
            running += item.amount;
            return { ...item, balance_after: running, at_risk: false, account_short: false, is_credit_card: false };
          } else {
            running -= item.amount;
            const acctBalance = item.account_balance ?? null;
            // Prefer the real backend-computed flag; fall back to the old
            // balance-sign proxy only if a stale payload omits it.
            const is_credit_card = item.is_credit_card !== undefined
              ? item.is_credit_card
              : (acctBalance !== null && acctBalance < 0);
            const account_short = !is_credit_card && atRiskKeySet.has(atRiskKey(item)) && (!item.next_period || assessNextPeriod);
            return { ...item, balance_after: running, at_risk: running < 0 && (!item.next_period || assessNextPeriod), account_short, is_credit_card };
          }
        });

        const billsBeforePayday = rawItems.filter(item => {
          if (item.type !== "bill") return false;
          const d = new Date(item.expected_date);
          return d < nextPaydayMidnight;
        });
        const runwayBillsTotal = billsBeforePayday.reduce((s, b) => s + b.amount, 0);
        const runway = spendableNow - runwayBillsTotal;
        const runwayNegative = runway < 0;

        const atRiskCount = items.filter(i => i.type === "bill" && i.at_risk).length;
        void atRiskCount;

        function groupByDay(list: typeof items) {
          const groups: { label: string; items: typeof items }[] = [];
          for (const item of list) {
            const label = item.days_away === 0 ? "Today" : item.days_away === 1 ? "Tomorrow" : `${item.days_away} days`;
            const g = groups.find(g => g.label === label);
            if (g) g.items.push(item);
            else groups.push({ label, items: [item] });
          }
          return groups;
        }

        const groups = groupByDay(items);

        function formatItemDate(iso: string) {
          const d = new Date(iso);
          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        }

        function formatPendingDate(iso: string) {
          const d = new Date(iso);
          return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        }

        function renderRow(item: typeof items[0]) {
          const isPlanned = item.type === "bill" && item.planned;
          // Risk doesn't care who authored the bill — planned rows flag the
          // same as predicted ones when their account can't cover them.
          const flagged = item.type === "bill"
            ? atRiskBills.some(r => r.name === item.name && r.expected_date === item.expected_date)
            : false;
          const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
          const highlighted = highlightBill === rowKey;
          const catName = item.type === "income" ? (item.category || "Income") : (item.category || "Other");
          const colour = getCategoryColour(catName, colours);
          const Icon = getCategoryIcon(catName, iconOverrides);
          // Insight hint — calm bill rows only: never on next-period amber
          // rows, and never competing with a risk verdict (red leads there).
          const insightHint =
            item.type === "bill" && !item.next_period && !flagged && !item.at_risk && !item.account_short
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
                className={`rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform ${
                  flagged
                    ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                    : "glass-card"
                }${highlighted ? " ring-2 ring-rose-400 dark:ring-rose-500" : ""}`}
              >
                {flagged ? (
                  <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0 text-rose-500" aria-hidden="true">
                    <AlertTriangle size={14} />
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
                    <p className={`text-sm font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
                      {item.name}
                    </p>
                    {isPlanned ? (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">planned</span>
                    ) : item.edited && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">edited</span>
                    )}
                  </div>

                  {item.account_short && (item.account_bank || item.account_name) && (
                    <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400 truncate">
                      {item.account_bank || item.account_name} · only {sym}{(item.account_balance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })} available
                    </p>
                  )}
                  {item.at_risk && !item.account_short && (
                    <>
                      <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400">Overall balance will be low</p>
                      {item.type === "bill" && (item.account_bank || item.account_name) && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                          {item.account_bank || item.account_name}
                        </p>
                      )}
                    </>
                  )}
                  {item.is_credit_card && (item.account_bank || item.account_name) && !flagged && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {item.account_bank || item.account_name}
                    </p>
                  )}
                  {item.type === "bill" && !item.account_short && !item.is_credit_card && !item.at_risk && (item.account_bank || item.account_name) && (
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
                      {insightHint.est ? `could save ~£${insightHint.est}` : "could save"} ›
                    </button>
                  )}

                  <p className={`text-[11px] ${item.next_period ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}`}>{formatItemDate(item.expected_date)}</p>
                  {item.type === "bill" && item.pending && (() => {
                    const dpd = item.days_past_due ?? 0;
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
                  <p className={`text-base font-bold ${
                    item.type === "income" ? "text-emerald-500" :
                    flagged ? "text-rose-600 dark:text-rose-400" :
                    "text-slate-800 dark:text-slate-100"
                  }`}>
                    {item.type === "income" ? "+" : "−"}{sym}{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className={`text-[11px] font-medium ${item.balance_after >= 0 ? "text-slate-500 dark:text-slate-400" : "text-rose-400"}`}>
                    {item.balance_after >= 0 ? "" : "−"}{sym}{Math.abs(item.balance_after).toLocaleString("en-GB", { maximumFractionDigits: 0 })} left
                  </p>
                </div>
              </div>
            </SwipeDismissRow>
          );
        }

        function renderGroups(groups: ReturnType<typeof groupByDay>) {
          let dividerInserted = false;
          let isFirstGroup = true;
          const nodes: ReactNode[] = [];
          for (const { label, items: groupItems } of groups) {
            const isNextPeriodGroup = groupItems.every(i => i.next_period);
            if (isNextPeriodGroup && !dividerInserted) {
              nodes.push(
                <div key="payday-boundary" className="flex items-center gap-3 py-1.5" role="separator" aria-label={`New pay period ${paydayLabel}, next pay period begins`}>
                  <div className="flex-1 h-px bg-amber-300/50 dark:bg-amber-700/40" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">New pay period · {paydayLabel}</span>
                  <div className="flex-1 h-px bg-amber-300/50 dark:bg-amber-700/40" />
                </div>
              );
              dividerInserted = true;
            }
            const showPlanButton = isFirstGroup;
            isFirstGroup = false;
            nodes.push(
              <div key={label}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className={`text-xs font-semibold uppercase tracking-wide ${
                    label === "Today" || label === "Tomorrow" || isNextPeriodGroup
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-slate-500 dark:text-slate-400"
                  }`}>{label}</p>
                  {showPlanButton && (
                    <button
                      onClick={() => setPlanSheetOpen(true)}
                      title="A dated bill from one account"
                      className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 rounded-lg active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      + Plan a one-off
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {groupItems.map(renderRow)}
                </div>
              </div>
            );
          }
          return nodes;
        }

        return (
          <div className="space-y-4">
            {(cashflow.spendable_balance ?? cashflow.available_balance) != null && (
              <div className={`rounded-2xl px-4 py-4 ${
                runwayNegative
                  ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                  : "glass-hero"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
                      {isCalendarMonth ? "Before month end" : "To last this pay period"}
                    </p>
                    <p className={`text-2xl font-bold tracking-tight ${
                      runwayNegative
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-900 dark:text-slate-100"
                    }`}>
                      {runwayNegative ? "−" : ""}{sym}{Math.abs(runway).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                      {sym}{spendableNow.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} now
                      {" − "}
                      {sym}{runwayBillsTotal.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} bills
                      {isCalendarMonth
                        ? ` · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
                        : ` · ends ${paydayLabel} (${daysToPayday} ${daysToPayday === 1 ? "day" : "days"})`}
                    </p>
                    {savingsNow > 0 && (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                        + {sym}{savingsNow.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} in savings if needed
                      </p>
                    )}
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                      Based on your typical spending, last 90 days
                    </p>
                  </div>
                  {accountShortfalls.length > 0 && (
                    <span className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">
                      <AlertTriangle size={14} /> {accountShortfalls.length} {accountShortfalls.length === 1 ? "account" : "accounts"} short
                    </span>
                  )}
                </div>
              </div>
            )}

            <PlansDock
              debtView={debtSummary}
              growView={growView}
              hide={hideNetWorth}
              onDebtTap={() => router.push("/debt-plan")}
              onGrowTap={() => router.push("/grow")}
            />
            <CommitmentsBlock
              commitments={commitments}
              onAdd={() => setCommitmentSheet({ editing: null })}
              onEdit={(c) => setCommitmentSheet({ editing: c })}
            />

            {currentPeriodItems.length === 0 && groups.length > 0 && (
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
              </div>
            )}
            {groups.length > 0 && (
              <div className="space-y-3">
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
        <div className="mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">PLANNING</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s coming</h1>
        </div>
        {/* Account shortfall callout */}
        {accountShortfalls.length > 0 && (
          <>
            <div className="mt-3 w-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {(() => {
                    const fmt = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    if (accountShortfalls.length === 1) {
                      const acct = accountShortfalls[0];
                      return (
                        <>
                          <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                            Your {acct.bank} account is short before payday
                          </p>
                          <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                            {fmt(acct.shortfall)} short for bills due before payday. Move money in, or change a payment date.
                          </p>
                        </>
                      );
                    }
                    const shown = accountShortfalls.slice(0, 3);
                    const extra = accountShortfalls.length - 3;
                    return (
                      <>
                        <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                          {accountShortfalls.length} accounts are short before payday
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                          {shown.map((a, i) => (
                            <span key={a.accountId}>
                              {i > 0 && " · "}{a.bank} · {fmt(a.shortfall)} short
                            </span>
                          ))}
                          {extra > 0 && <span> · +{extra} more</span>}
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                          Move money in, or change a payment date.
                        </p>
                      </>
                    );
                  })()}
                </div>
                <button
                  onClick={() => {
                    const top = [...atRiskBills].sort(
                      (a, b) => a.days_away !== b.days_away ? a.days_away - b.days_away : b.amount - a.amount
                    )[0];
                    if (top) setHighlightBill(`bill-${top.name}-${top.expected_date}`);
                  }}
                  className="flex-shrink-0 self-center px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold min-h-[44px] flex items-center active:scale-95 transition-transform"
                >
                  Review
                </button>
              </div>
            </div>
            <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">
              Payments can take a day or two to appear, so a very recent one may not be counted yet.
            </p>
          </>
        )}
      </div>

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
