"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Scenario A — Delta-led comparison. The open design question this variant
// answers: given a deeply negative baseline (−£1,832.95/month), is a verdict
// framed as a DELTA still useful, or does the screen have to lead with the
// baseline? A answers "yes, the change is the useful headline" by putting a
// NOW / WITH THIS comparison front and centre across all four axes
// (month-end cash, debt, plans, Grow), closest to a comparison table without
// being a literal <table> (illegible at 430px). The change is the hero.
//
// Deep-linkable: /design/scenario-a?mode=light|dark&fixture=car_payment|car_insurance

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AmberSignifier } from "@/lib/comingUp";
import {
  CAR_PAYMENT_FIXTURE,
  CAR_INSURANCE_FIXTURE,
  money,
  moneyDelta,
  months,
  itemLine,
  type ScenarioFixture,
} from "./fixtures";

type Mode = "light" | "dark";
type FixtureId = "car_payment" | "car_insurance";

const CATEGORY_HEX: Record<string, string> = {
  Groceries: "#34d399",
  "Eating Out": "#fb923c",
  Shopping: "#f472b6",
  Subscriptions: "#22d3ee",
};

/** A money figure at Amount-on-card weight, coloured by financial polarity
 * (rose for a genuine shortfall, emerald when the position is in surplus) —
 * matching the established CashFlowCard convention for surplus/deficit
 * figures. This is distinct from the Amber rule: red/rose colouring a money
 * figure directly is the existing pattern for genuine risk elsewhere in the
 * app, not a violation of "Figures Are Ink; Amber Lives In The Signifier"
 * (that rule is scoped to amber caution, not red risk). */
function PolarFigure({ n, size = "text-[19px]" }: { n: number; size?: string }) {
  const tone = n < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  return <span className={`font-mono tabular-nums font-bold ${size} ${tone}`}>{money(n)}</span>;
}

function DeltaPill({ n, suffix = "a month" }: { n: number; suffix?: string }) {
  const worse = n < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
        worse
          ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      }`}
    >
      <span className="font-mono tabular-nums">{moneyDelta(n)}</span> {suffix}
    </span>
  );
}

function AxisLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>
  );
}

function ColHeader({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>;
}

function MonthEndCashCard({ fixture }: { fixture: ScenarioFixture }) {
  const { baselineSurplus, afterSurplus, delta, headline, lumpNote } = fixture.monthEndCash;
  return (
    <section className="glass-hero rounded-3xl p-4">
      <AxisLabel>Month-end cash</AxisLabel>
      <p className="mt-2 text-base font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
        {headline}
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          <div className="mt-1">
            <PolarFigure n={baselineSurplus} size="text-[20px]" />
          </div>
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          <div className="mt-1">
            <PolarFigure n={afterSurplus} size="text-[20px]" />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <DeltaPill n={delta} />
      </div>
      {lumpNote && (
        <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{lumpNote}</p>
      )}
    </section>
  );
}

function DebtCard({ fixture }: { fixture: ScenarioFixture }) {
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Debt</AxisLabel>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          <p className="mt-1 text-[14px] font-semibold text-slate-400 dark:text-slate-500">Unclear</p>
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          <p className="mt-1 text-[14px] font-semibold text-slate-400 dark:text-slate-500">Unclear</p>
        </div>
      </div>
      <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        {fixture.debt.reason}
      </p>
    </section>
  );
}

function PlansCard({ fixture }: { fixture: ScenarioFixture }) {
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Plans &amp; goals</AxisLabel>
      <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">{fixture.plans.reason}</p>
    </section>
  );
}

function GrowCard({ fixture }: { fixture: ScenarioFixture }) {
  const { monthsCoverBefore, monthsCoverAfter } = fixture.grow;
  const worse = monthsCoverAfter < monthsCoverBefore;
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Grow &middot; emergency fund cover</AxisLabel>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="min-w-0">
          <ColHeader>Now</ColHeader>
          <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {months(monthsCoverBefore)}
          </p>
        </div>
        <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
        <div className="min-w-0 text-right">
          <ColHeader>With this</ColHeader>
          <p className="mt-1 flex items-center justify-end gap-1.5 text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
            <AmberSignifier show={worse} />
            {months(monthsCoverAfter)}
          </p>
        </div>
      </div>
    </section>
  );
}

function AbsorbCard({ fixture }: { fixture: ScenarioFixture }) {
  if (!fixture.absorb) {
    return (
      <section className="glass-card-flat rounded-2xl p-4">
        <AxisLabel>Where this comes from</AxisLabel>
        <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
          This change frees up money. There is no shortfall to place anywhere.
        </p>
      </section>
    );
  }
  const { shortfall, coveredBySurplus, candidates } = fixture.absorb;
  return (
    <section className="glass-card rounded-2xl p-4">
      <AxisLabel>Where this comes from</AxisLabel>
      <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{money(shortfall)}</span>{" "}
        a month to place. Your surplus covers{" "}
        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{money(coveredBySurplus)}</span>{" "}
        of it, none right now.
      </p>
      <div className="mt-3 flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
        {candidates.map((c) => {
          const hex = CATEGORY_HEX[c.category] ?? "#94a3b8";
          return (
            <div key={c.category} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                className="w-8 h-8 rounded-lg flex-shrink-0"
                style={{ background: `${hex}26` }}
                aria-hidden
              />
              <p className="flex-1 text-[14px] font-medium text-slate-700 dark:text-slate-300">{c.category}</p>
              <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono tabular-nums">{money(c.monthlyMedian)}</span>/mo median
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ScenarioAClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const fixtureParam = searchParams.get("fixture");
  const [fixtureId, setFixtureId] = useState<FixtureId>(fixtureParam === "car_insurance" ? "car_insurance" : "car_payment");
  const fixture = fixtureId === "car_insurance" ? CAR_INSURANCE_FIXTURE : CAR_PAYMENT_FIXTURE;

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-16">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview &middot; Scenario A &middot; Delta-led comparison &middot; {mode}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">What if</h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
            Now vs with this, across all four axes. The change is the headline; the standing position is context.
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

          <section className="mt-4 glass-card-flat rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              What if
            </p>
            <p className="mt-1 text-[14px] italic text-slate-600 dark:text-slate-300 text-pretty">&ldquo;{fixture.question}&rdquo;</p>
            <p className="mt-1.5 text-[12px] text-slate-400 dark:text-slate-500">{itemLine(fixture.item)}</p>
          </section>

          <div className="mt-4 flex flex-col gap-4">
            <MonthEndCashCard fixture={fixture} />
            <DebtCard fixture={fixture} />
            <PlansCard fixture={fixture} />
            <GrowCard fixture={fixture} />
            <AbsorbCard fixture={fixture} />
          </div>

          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500 text-pretty">
            {fixture.assumptions.join(" ")}
          </p>
        </div>
      </div>
    </div>
  );
}
