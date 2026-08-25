"use client";

// The real "what if" scenario verdict screen — promotes /design/scenario-a
// (variant A, the delta-led comparison Kevin picked) from a static fixture
// preview into a live route wired to POST /scenario/run.
//
// Reached as a pushed destination from the Penny thread once a "what if"
// question has been parsed and confirmed (see backend/app/routers/scenario.py's
// /scenario/parse -> /scenario/run two-step flow). This page owns step two
// only: it accepts the confirmed items via the `items` query param (a
// JSON-encoded array of ScenarioItem, matching lib/api.ts's ScenarioItem
// type exactly) and renders the result. It does not itself do slot
// extraction or editing — that belongs to whatever composes the confirmed
// item list before pushing here.
//
// Every one of cash/debt/plans/grow/absorb in the response can legitimately
// be null, each paired with a plain-English reason in the response's own
// `reasons` object (one slot per axis — see lib/api.ts's ScenarioReasons).
// This replaces an earlier approach that folded every block's reason into a
// flat `assumptions` array and recovered it client-side by matching fixed
// backend string prefixes; `assumptions` now carries only GLOBAL notes with
// no single block to attach to (e.g. the payday/rhythm line), so the footer
// below can render it as-is. `UNMAPPED_REASON_FALLBACK` covers the one case
// that's a genuine backend bug rather than a designed empty state: a block
// is null but `reasons` has nothing for it. The absorb block's "frees up
// money" case is derived directly from `recurring_delta >= 0` (the same
// condition the backend itself uses to decide whether to return an absorb
// block at all), not from a reason string. `lumpy` (whether some of this
// scenario lands in specific months rather than spreading evenly) is now a
// plain boolean too — see LUMPY_NOTE below.

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { api, ScenarioItem, ScenarioRunResponse } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { usePennySheet } from "@/components/PennySheetProvider";
import { goBack } from "@/lib/goBack";
import BottomNav from "@/components/BottomNav";
import MoneyText from "@/components/MoneyText";

// ── Formatting helpers ──────────────────────────────────────────────────────
// Whole pounds throughout (app-wide convention for summary/monthly
// figures — see backend/app/routers/can_i.py's `_fmt_gbp`), Unicode minus
// for negatives, masked to "£••••" when the hide-balances preference is on
// (matches lib components/MoneyText's mask-token contract so a masked
// figure still renders in mono, not Figtree).
function money(n: number, hide: boolean): string {
  if (hide) return "£••••";
  const abs = Math.round(Math.abs(n)).toLocaleString("en-GB");
  return n < 0 ? `−£${abs}` : `£${abs}`;
}

function moneyDelta(n: number, hide: boolean): string {
  if (hide) return "£••••";
  const abs = Math.round(Math.abs(n)).toLocaleString("en-GB");
  if (n > 0) return `+£${abs}`;
  if (n < 0) return `−£${abs}`;
  return `£${abs}`;
}

function months(n: number): string {
  return `${n.toFixed(1)} month${Math.abs(n - 1) < 0.05 ? "" : "s"}`;
}

function humanStart(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

const CADENCE_TEXT: Record<ScenarioItem["cadence"], string> = {
  monthly: "a month",
  weekly: "a week",
  annual: "a year",
  one_off: "one-off",
};

function itemLine(item: ScenarioItem, hide: boolean): string {
  const verb = item.kind === "removal" ? "Cancel" : item.kind === "income_change" ? "Change" : "Add";
  const cadence = CADENCE_TEXT[item.cadence] ?? "";
  return `${verb} ${item.label}, ${money(item.amount, hide)} ${cadence}, from ${humanStart(item.starts)}`.trim();
}

// ── Axis reasons ─────────────────────────────────────────────────────────
// A block being null is always paired with a reason on `resp.reasons` (see
// lib/api.ts's ScenarioReasons) — a structured per-axis field, not a flat
// `assumptions` array recovered by string-matching. `UNMAPPED_REASON_FALLBACK`
// is deliberately worded to read as "something's wrong" rather than a normal
// designed empty state: it should only ever appear if a block is null but
// the backend genuinely sent no reason for it, which is a backend bug worth
// surfacing rather than hiding behind a smooth, plausible-looking sentence.
const UNMAPPED_REASON_FALLBACK =
  "We can't show the specific reason for this right now. If this keeps happening, it's worth reporting, something on our end likely changed.";

/** Static copy for `resp.lumpy` — whether some of this scenario lands in
 * specific months (an annual/one-off item) rather than spreading evenly.
 * `lumpy` is the structured flag to read directly (per
 * backend/app/services/scenario.py's own comment on the field) rather than
 * string-matching an `assumptions` entry to detect it — this constant only
 * decides whether MonthEndCashCard shows the note inline, gated purely on
 * the boolean. The backend still also appends this exact sentence to the
 * global `assumptions` list (it's a genuinely global note, not one
 * attached to a single block) — `leftoverAssumptions` below excludes this
 * one known, verbatim-copied string so it doesn't also repeat in the
 * footer. Unlike the retired AXIS_NOTE_PREFIXES machinery, a future drift
 * between this copy and the backend's is self-limiting: worst case the
 * line shows twice, not that it silently vanishes. */
const LUMPY_NOTE =
  "Some of this lands in specific months rather than being spread evenly, see the month-by-month figures for where it actually bites.";

// ── Small presentational atoms (mirrors /design/scenario-a) ─────────────────

function AxisLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

function ColHeader({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

function PolarFigure({ n, hide, size = "text-[19px]" }: { n: number; hide: boolean; size?: string }) {
  const tone = n < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  return <span className={`font-mono tabular-nums font-bold ${size} ${tone}`}>{money(n, hide)}</span>;
}

function UnclearFigure({ size = "text-[14px]" }: { size?: string }) {
  return <p className={`mt-1 ${size} font-semibold text-slate-400 dark:text-slate-500`}>Unclear</p>;
}

function DeltaPill({ n, hide }: { n: number; hide: boolean }) {
  const worse = n < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
        worse
          ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      }`}
    >
      <span className="font-mono tabular-nums">{moneyDelta(n, hide)}</span> a month
    </span>
  );
}

// ── Skeleton (loading) ───────────────────────────────────────────────────────

function SkeletonCard({ heroSized = false }: { heroSized?: boolean }) {
  return (
    <div className={`animate-pulse ${heroSized ? "glass-hero rounded-3xl p-4" : "glass-card rounded-2xl p-4"}`}>
      <div className="h-2.5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
      <div className="mt-3 h-4 w-full rounded bg-slate-100 dark:bg-slate-700/60" />
      <div className="mt-2 h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-700/60" />
    </div>
  );
}

// ── Category colour (mirrors /design/scenario-a's small known-set map;
//    no shared category-colour helper exists elsewhere in the app today,
//    so an unrecognised category falls back to the same muted grey chip
//    the design variant uses rather than fabricating a hue). ────────────────
const CATEGORY_HEX: Record<string, string> = {
  Groceries: "#34d399",
  "Eating Out": "#fb923c",
  Shopping: "#f472b6",
  Subscriptions: "#22d3ee",
};

// ── Cards ────────────────────────────────────────────────────────────────────

function WhatIfCard({ resp, hide }: { resp: ScenarioRunResponse; hide: boolean }) {
  return (
    <section className="glass-card-flat rounded-2xl p-4">
      <AxisLabel>What if</AxisLabel>
      <div className="mt-1.5 flex flex-col gap-1">
        {resp.items.map((it, i) => (
          <p key={i} className="text-[13px] text-slate-600 dark:text-slate-300 text-pretty">
            <MoneyText text={itemLine(it, hide)} />
          </p>
        ))}
      </div>
      {resp.rejected.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 text-pretty">
          {resp.rejected.join(" ")}
        </p>
      )}
    </section>
  );
}

function MonthEndCashCard({ resp, hide }: { resp: ScenarioRunResponse; hide: boolean }) {
  const { baseline, cash, recurring_delta, headline, reasons, lumpy } = resp;
  const now = baseline.monthly_surplus;
  const after = cash ? cash.surplus_after : null;
  const lumpNote = lumpy ? LUMPY_NOTE : null;
  const cashReason = cash ? null : reasons.cash ?? UNMAPPED_REASON_FALLBACK;
  return (
    <section className="glass-hero rounded-3xl p-4">
      <AxisLabel>Month-end cash</AxisLabel>
      <p className="mt-2 text-base font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
        <MoneyText text={headline} />
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          <div className="mt-1">
            <PolarFigure n={now} hide={hide} size="text-[20px]" />
          </div>
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          <div className="mt-1">
            {after != null ? <PolarFigure n={after} hide={hide} size="text-[20px]" /> : <UnclearFigure size="text-[20px]" />}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <DeltaPill n={recurring_delta} hide={hide} />
      </div>
      {lumpNote && (
        <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          <MoneyText text={lumpNote} />
        </p>
      )}
      {cashReason && (
        <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{cashReason}</p>
      )}
    </section>
  );
}

function DebtCard({ resp }: { resp: ScenarioRunResponse }) {
  const { debt, reasons } = resp;
  const reason = reasons.debt ?? (debt ? null : UNMAPPED_REASON_FALLBACK);
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Debt</AxisLabel>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          {debt?.debt_free_month_now ? (
            <p className="mt-1 text-[14px] font-semibold text-slate-900 dark:text-slate-100">{debt.debt_free_month_now}</p>
          ) : (
            <UnclearFigure />
          )}
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          {debt?.debt_free_month_after ? (
            <p className="mt-1 text-[14px] font-semibold text-slate-900 dark:text-slate-100">{debt.debt_free_month_after}</p>
          ) : (
            <UnclearFigure />
          )}
        </div>
      </div>
      {reason && (
        <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{reason}</p>
      )}
    </section>
  );
}

function PlansCard({ resp }: { resp: ScenarioRunResponse }) {
  const { plans, reasons } = resp;
  if (!plans) {
    const reason = reasons.plans ?? UNMAPPED_REASON_FALLBACK;
    return (
      <section className="glass-card rounded-2xl p-4">
        <AxisLabel>Plans &amp; goals</AxisLabel>
        <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{reason}</p>
      </section>
    );
  }
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Plans &amp; goals</AxisLabel>
      <div className="mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
        {plans.items.map((p) => (
          <div key={p.name} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
            {p.slipped && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />}
            <p className="flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-300">{p.name}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {p.feasibility_now ?? "unclear"} <ArrowRight size={11} className="inline -mt-0.5" aria-hidden /> {p.feasibility_after ?? "unclear"}
            </p>
          </div>
        ))}
      </div>
      {plans.any_worse && (
        <p className="mt-2 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          At least one plan would become harder to reach under this scenario.
        </p>
      )}
    </section>
  );
}

function GrowCard({ resp }: { resp: ScenarioRunResponse }) {
  const { grow, reasons } = resp;
  if (!grow) {
    const reason = reasons.grow ?? UNMAPPED_REASON_FALLBACK;
    return (
      <section className="glass-card rounded-2xl p-4">
        <AxisLabel>Grow &middot; emergency fund cover</AxisLabel>
        <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{reason}</p>
      </section>
    );
  }
  const worse = grow.months_cover_after != null && grow.months_cover_after < grow.months_cover_now;
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Grow &middot; emergency fund cover</AxisLabel>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{months(grow.months_cover_now)}</p>
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          {grow.months_cover_after != null ? (
            <p className="mt-1 flex items-center justify-end gap-1.5 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {worse && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />}
              {months(grow.months_cover_after)}
            </p>
          ) : (
            <UnclearFigure size="text-base" />
          )}
        </div>
      </div>
    </section>
  );
}

function AbsorbCard({ resp, hide }: { resp: ScenarioRunResponse; hide: boolean }) {
  const { absorb, recurring_delta, reasons } = resp;
  if (!absorb) {
    const freesUpMoney = recurring_delta >= 0;
    const reason = freesUpMoney
      ? "This change frees up money. There is no shortfall to place anywhere."
      : reasons.absorb ?? UNMAPPED_REASON_FALLBACK;
    return (
      <section className="glass-card-flat rounded-2xl p-4">
        <AxisLabel>Where this comes from</AxisLabel>
        <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{reason}</p>
      </section>
    );
  }
  const { shortfall, covered_by_surplus, candidates } = absorb;
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Where this comes from</AxisLabel>
      <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{money(shortfall, hide)}</span>{" "}
        a month to place. Your surplus covers{" "}
        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{money(covered_by_surplus, hide)}</span>{" "}
        of it{covered_by_surplus <= 0 ? ", none right now" : ""}.
      </p>
      {candidates.length > 0 && (
        <div className="mt-3 flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
          {candidates.map((c) => {
            const hex = CATEGORY_HEX[c.category] ?? "#94a3b8";
            return (
              <div key={c.category} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-8 h-8 rounded-lg flex-shrink-0" style={{ background: `${hex}26` }} aria-hidden />
                <p className="flex-1 text-[14px] font-medium text-slate-700 dark:text-slate-300">{c.category}</p>
                <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                  <span className="font-mono tabular-nums">{money(c.monthly, hide)}</span>/mo median
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ScenarioPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hideNetWorth } = usePreferences();
  // Only the empty-state "Ask Penny" affordance below uses this — the Back
  // button stays real navigation (goBack(router, "/penny")), this page-to-
  // page hop is unrelated to opening the sheet.
  const { open } = usePennySheet();

  const itemsParam = searchParams.get("items");

  const parsedItems = useMemo<ScenarioItem[] | null>(() => {
    if (!itemsParam) return null;
    try {
      const parsed = JSON.parse(itemsParam);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [itemsParam]);

  const [resp, setResp] = useState<ScenarioRunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!parsedItems || parsedItems.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    api.scenarioRun(parsedItems)
      .then((data) => { if (!cancelled) setResp(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsParam, reloadTick]);

  // Global assumptions the footer should show — everything except the
  // lumpy note, which MonthEndCashCard already renders inline when
  // `resp.lumpy` is set (see LUMPY_NOTE's doc comment for why this is a
  // safe exact-match exclusion rather than the retired prefix-matching
  // approach).
  const leftoverAssumptions = useMemo(() => {
    if (!resp) return [];
    return resp.lumpy ? resp.assumptions.filter((a) => a !== LUMPY_NOTE) : resp.assumptions;
  }, [resp]);

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="mx-auto w-full max-w-[430px] lg:max-w-2xl px-4 pt-6 pb-2">
        <button
          onClick={() => goBack(router, "/penny")}
          className="min-h-[44px] -ml-2 flex items-center gap-1.5 px-2 text-sm font-medium text-slate-600 dark:text-slate-300 rounded-lg active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <ChevronLeft size={15} aria-hidden />
          Back
        </button>

        <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-100">What if</h1>

        {loading ? (
          <div className="mt-4 flex flex-col gap-4">
            <SkeletonCard heroSized />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : fetchError ? (
          <div className="mt-4 glass-card rounded-2xl p-5">
            <p className="text-sm text-slate-700 dark:text-slate-200 text-pretty">
              This scenario couldn&apos;t be run right now. Nothing has changed, try again.
            </p>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="mt-3 min-h-[44px] px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Try again
            </button>
          </div>
        ) : !resp ? (
          <div className="mt-4 glass-card rounded-2xl p-5">
            <p className="text-sm text-slate-700 dark:text-slate-200 text-pretty">
              No scenario to show yet. Ask Penny a &ldquo;what if&rdquo; question to see it here.
            </p>
            <button
              type="button"
              onClick={() => open({ screen: "other" })}
              className="mt-3 min-h-[44px] flex items-center justify-center px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Ask Penny
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <WhatIfCard resp={resp} hide={hideNetWorth} />
            <MonthEndCashCard resp={resp} hide={hideNetWorth} />
            <DebtCard resp={resp} />
            <PlansCard resp={resp} />
            <GrowCard resp={resp} />
            <AbsorbCard resp={resp} hide={hideNetWorth} />
            {/* Footer carries only GLOBAL assumptions with no single block to
                attach to — e.g. the payday/rhythm line. Trivial now that
                per-block reasons live on `reasons` instead of being folded
                into this same array (see the top-of-file doc comment); the
                one exception is the lumpy note, which MonthEndCashCard
                already shows inline when `resp.lumpy` is set — excluded
                here by exact string so it isn't repeated (see LUMPY_NOTE's
                doc comment). Renders nothing at all, not an empty
                container, when empty. */}
            {leftoverAssumptions.length > 0 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-pretty">{leftoverAssumptions.join(" ")}</p>
            )}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
