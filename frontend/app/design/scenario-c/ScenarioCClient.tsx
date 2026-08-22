"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Scenario C — Baseline-led. The open design question this variant answers:
// when the baseline (−£1,832.95/month) is already the real story, does a
// verdict screen have any business leading with a scenario's DELTA at all?
// C says no. It leads with the user's existing, standing position at
// Display weight (the one hero figure the type ramp reserves for exactly
// this: "the one hero figure per screen"), then presents the new commitment
// as something layered on top of a situation that already needs attention.
// The scenario itself, and its own four axes, are deliberately smaller and
// quieter than the standing-position hero throughout this page.
//
// Deep-linkable: /design/scenario-c?mode=light|dark&fixture=car_payment|car_insurance

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown } from "lucide-react";
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

const CATEGORY_HEX: Record<string, string> = {
  Groceries: "#34d399",
  "Eating Out": "#fb923c",
  Shopping: "#f472b6",
  Subscriptions: "#22d3ee",
};

function QuietAxisCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="glass-card-flat rounded-2xl p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export default function ScenarioCClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const fixtureParam = searchParams.get("fixture");
  const [fixtureId, setFixtureId] = useState<FixtureId>(fixtureParam === "car_insurance" ? "car_insurance" : "car_payment");
  const fixture: ScenarioFixture = fixtureId === "car_insurance" ? CAR_INSURANCE_FIXTURE : CAR_PAYMENT_FIXTURE;

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const worseGrow = fixture.grow.monthsCoverAfter < fixture.grow.monthsCoverBefore;
  const improves = fixture.monthEndCash.delta > 0;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: mode }}>
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-16">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Preview &middot; Scenario C &middot; Baseline-led &middot; {mode}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">What if</h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
            Your standing position leads. The scenario is layered on top of a situation that already needs attention.
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

          {/* ── The standing position, the real hero of this page ────────── */}
          <section className="mt-4 glass-hero rounded-3xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Your standing position
            </p>
            <p className="mt-2 text-[30px] font-bold tracking-[-0.025em] leading-none font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {money(fixture.monthEndCash.baselineSurplus)}
            </p>
            <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
              That&apos;s already short every month, before this scenario is even asked about.
            </p>
          </section>

          {/* ── The scenario, layered on top, deliberately quieter ───────── */}
          <div className="mt-3 flex justify-center">
            <ArrowDown size={16} className="text-slate-300 dark:text-slate-600" aria-hidden />
          </div>
          <section className="mt-1 glass-card rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Layer this on top &middot; &ldquo;{fixture.question}&rdquo;
            </p>
            <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500">{itemLine(fixture.item)}</p>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`font-mono tabular-nums font-bold text-[19px] ${
                  improves ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {money(fixture.monthEndCash.afterSurplus)}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                  improves
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                }`}
              >
                <span className="font-mono tabular-nums">{moneyDelta(fixture.monthEndCash.delta)}</span>&nbsp;a month
              </span>
            </div>
            <p className="mt-2.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
              {fixture.monthEndCash.headline}
            </p>
            {fixture.monthEndCash.lumpNote && (
              <p className="mt-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
                {fixture.monthEndCash.lumpNote}
              </p>
            )}
          </section>

          {/* ── Everything else that's also true, subordinate to the hero ─ */}
          <div className="mt-3 flex flex-col gap-2">
            <QuietAxisCard label="Debt">
              <p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">{fixture.debt.reason}</p>
            </QuietAxisCard>
            <QuietAxisCard label="Plans &amp; goals">
              <p className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">{fixture.plans.reason}</p>
            </QuietAxisCard>
            <QuietAxisCard label="Grow &middot; emergency fund cover">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
                <AmberSignifier show={worseGrow} />
                <span className="tabular-nums">{months(fixture.grow.monthsCoverBefore)}</span>
                {" → "}
                <span className="tabular-nums">{months(fixture.grow.monthsCoverAfter)}</span>
              </p>
            </QuietAxisCard>
          </div>

          {fixture.absorb ? (
            <section className="mt-3 glass-card rounded-2xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Where this comes from
              </p>
              <p className="mt-1.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
                Given you&apos;re already this stretched,{" "}
                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {money(fixture.absorb.shortfall)}
                </span>{" "}
                a month would have to come from somewhere. Your surplus doesn&apos;t cover any of it right now.
              </p>
              <div className="mt-2.5 flex flex-col divide-y divide-slate-100 dark:divide-slate-700/60">
                {fixture.absorb.candidates.map((c) => {
                  const hex = CATEGORY_HEX[c.category] ?? "#94a3b8";
                  return (
                    <div key={c.category} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                      <span className="w-7 h-7 rounded-lg flex-shrink-0" style={{ background: `${hex}26` }} aria-hidden />
                      <p className="flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-300">{c.category}</p>
                      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                        <span className="font-mono tabular-nums">{money(c.monthlyMedian)}</span>/mo median
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="mt-3 glass-card-flat rounded-2xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Where this comes from
              </p>
              <p className="mt-1.5 text-[13px] leading-snug text-slate-500 dark:text-slate-400">
                This one frees up money rather than needing to come from somewhere. It doesn&apos;t close the gap above on
                its own.
              </p>
            </section>
          )}

          <p className="mt-4 text-[11px] text-slate-400 dark:text-slate-500 text-pretty">
            {fixture.assumptions.join(" ")}
          </p>
        </div>
      </div>
    </div>
  );
}
