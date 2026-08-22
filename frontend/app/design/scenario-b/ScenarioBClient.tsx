"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Scenario B — Verdict-led. Quietest of the three. Answers the open design
// question differently from A: given the deeply negative baseline
// (−£1,832.95/month), the useful hero isn't a delta table, it's ONE plain-
// English verdict sentence (the server/LLM headline, verbatim) plus the
// single most decision-relevant fact.
//
// For a scenario with room to spare, that fact would be "the first month
// things break." Here the baseline is already broken every month, so the
// honest equivalent is reframed: for the new-cost scenario it's how much
// runway is left on the emergency fund at this rate (Grow, the thing that
// actually answers "when does this become a real problem"); for the lumpy
// cancellation scenario it's the one number a steady monthly average would
// hide, the size and timing of the one-off lump.
//
// The four axes (month-end cash, debt, plans, Grow) sit underneath as
// collapsed, tappable evidence rows. Collapsed does NOT mean blank: each
// row's closed summary line already states real content (including the
// honest null reasons for debt/plans), so the page is fully meaningful with
// nothing expanded — matching the "visible without interaction" contract.
// Rows default OPEN in this preview build so a single screenshot proves
// that contract; the collapse/expand control is real and independently
// operable (native disclosure via button + conditional render, no
// scroll/visibility-gated animation).
//
// Deep-linkable: /design/scenario-b?mode=light|dark&fixture=car_payment|car_insurance

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AmberSignifier } from "@/lib/comingUp";
import {
  CAR_PAYMENT_FIXTURE,
  CAR_INSURANCE_FIXTURE,
  money,
  moneyDelta,
  months,
  itemLine,
  type ScenarioFixture,
} from "../scenario-a/fixtures";

type Mode = "light" | "dark";
type FixtureId = "car_payment" | "car_insurance";
type AxisKey = "cash" | "debt" | "plans" | "grow" | "absorb";

function DecisiveFact({ fixture }: { fixture: ScenarioFixture }) {
  if (fixture.item.kind === "cancellation" && fixture.monthEndCash.lumpNote) {
    return (
      <p className="text-[14px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
        Worth knowing: {fixture.monthEndCash.lumpNote}
      </p>
    );
  }
  const { monthsCoverBefore, monthsCoverAfter } = fixture.grow;
  return (
    <p className="text-[14px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
      At this rate, your safety net covers about{" "}
      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
        {months(monthsCoverAfter)}
      </span>
      , down from {months(monthsCoverBefore)}.
    </p>
  );
}

function AxisRow({
  label,
  summary,
  detail,
  open,
  onToggle,
}: {
  label: string;
  summary: React.ReactNode;
  detail: React.ReactNode | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="glass-card-flat rounded-2xl px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full min-h-[44px] flex items-center gap-3 text-left rounded-xl active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {label}
          </p>
          <div className="mt-0.5">{summary}</div>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-300 dark:text-slate-600 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && detail && <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">{detail}</div>}
    </div>
  );
}

export default function ScenarioBClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const fixtureParam = searchParams.get("fixture");
  const [fixtureId, setFixtureId] = useState<FixtureId>(fixtureParam === "car_insurance" ? "car_insurance" : "car_payment");
  const fixture = fixtureId === "car_insurance" ? CAR_INSURANCE_FIXTURE : CAR_PAYMENT_FIXTURE;

  const [open, setOpen] = useState<Record<AxisKey, boolean>>({
    cash: true,
    debt: true,
    plans: true,
    grow: true,
    absorb: true,
  });
  function toggle(key: AxisKey) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const worseGrow = fixture.grow.monthsCoverAfter < fixture.grow.monthsCoverBefore;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-16">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview &middot; Scenario B &middot; Verdict-led &middot; {mode}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">What if</h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
            One sentence, one decisive fact. Everything else is evidence you can open, not a wall you must read.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <a href={`?mode=light&fixture=${fixtureId}`} className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
              Light
            </a>
            <a href={`?mode=dark&fixture=${fixtureId}`} className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
              Dark
            </a>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setFixtureId("car_payment")}
              className={`min-h-[44px] flex-1 rounded-xl text-[12px] font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                fixtureId === "car_payment"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              Car payment (new cost)
            </button>
            <button
              type="button"
              onClick={() => setFixtureId("car_insurance")}
              className={`min-h-[44px] flex-1 rounded-xl text-[12px] font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                fixtureId === "car_insurance"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              Cancel insurance (lumpy)
            </button>
          </div>

          <p className="mt-3 text-[12px] text-slate-400 dark:text-slate-500">{itemLine(fixture.item)}</p>

          {/* ── The verdict hero ─────────────────────────────────────────── */}
          <section className="mt-4 glass-hero rounded-3xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              &ldquo;{fixture.question}&rdquo;
            </p>
            <p className="mt-2 text-[20px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
              {fixture.monthEndCash.headline}
            </p>
            <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/60">
              <DecisiveFact fixture={fixture} />
            </div>
          </section>

          {/* ── Supporting evidence, collapsed by default ────────────────── */}
          <div className="mt-4 flex flex-col gap-2">
            <AxisRow
              label="Month-end cash"
              open={open.cash}
              onToggle={() => toggle("cash")}
              summary={
                <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                  <span className="font-mono tabular-nums">{money(fixture.monthEndCash.baselineSurplus)}</span>
                  {" → "}
                  <span className="font-mono tabular-nums">{money(fixture.monthEndCash.afterSurplus)}</span> a month
                </p>
              }
              detail={
                <p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
                  A change of <span className="font-mono tabular-nums">{moneyDelta(fixture.monthEndCash.delta)}</span>{" "}
                  a month on average.{fixture.monthEndCash.lumpNote ? ` ${fixture.monthEndCash.lumpNote}` : ""}
                </p>
              }
            />
            <AxisRow
              label="Debt"
              open={open.debt}
              onToggle={() => toggle("debt")}
              summary={<p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Can&apos;t project a debt-free date</p>}
              detail={<p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">{fixture.debt.reason}</p>}
            />
            <AxisRow
              label="Plans &amp; goals"
              open={open.plans}
              onToggle={() => toggle("plans")}
              summary={<p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">No active plans to check</p>}
              detail={<p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">{fixture.plans.reason}</p>}
            />
            <AxisRow
              label="Grow &middot; emergency fund cover"
              open={open.grow}
              onToggle={() => toggle("grow")}
              summary={
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                  <AmberSignifier show={worseGrow} />
                  <span className="tabular-nums">{months(fixture.grow.monthsCoverBefore)}</span>
                  {" → "}
                  <span className="tabular-nums">{months(fixture.grow.monthsCoverAfter)}</span>
                </p>
              }
              detail={
                <p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
                  How many months your emergency fund would cover at this rate, before and after this change.
                </p>
              }
            />
            {fixture.absorb && (
              <AxisRow
                label="Where this comes from"
                open={open.absorb}
                onToggle={() => toggle("absorb")}
                summary={
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                    <span className="font-mono tabular-nums">{money(fixture.absorb.shortfall)}</span> a month, nothing
                    covered by surplus right now
                  </p>
                }
                detail={
                  <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
                    {fixture.absorb.candidates.map((c) => (
                      <div key={c.category} className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                        <p className="text-[13px] text-slate-600 dark:text-slate-300">{c.category}</p>
                        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                          <span className="font-mono tabular-nums">{money(c.monthlyMedian)}</span>/mo median
                        </p>
                      </div>
                    ))}
                  </div>
                }
              />
            )}
          </div>

          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500 text-pretty">
            {fixture.assumptions.join(" ")}
          </p>
        </div>
      </div>
    </div>
  );
}
