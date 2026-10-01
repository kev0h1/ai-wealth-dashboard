"use client";

// G140 copy round. G186 owns the placement of the single standalone pace
// verdict. Approved A imports the production evidence beneath it, while B
// remains an unselected, preview-only explanation treatment.

import { useEffect } from "react";
import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import SpendPaceEvidence from "@/components/SpendPaceEvidence";
import type { SpendVerdictNotable } from "@/lib/api";
import { derivePaceCopy, formatMoney } from "./copyModel";
import { PACE_COPY_FIXTURES, PACE_COPY_STATES, type PaceCopyState } from "./fixtures";

type Variant = "a" | "b";
type Mode = "light" | "dark";

const variantLabel: Record<Variant, string> = {
  a: "A · Named ledger",
  b: "B · Short explanation",
};

function SignedAmount({ value, positive }: { value: number; positive?: boolean }) {
  return <span className="font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">{formatMoney(value, { plus: positive })}</span>;
}

function PaceVerdict({ headline, baselineLine, verdict }: { headline: string; baselineLine: string; verdict: ReturnType<typeof derivePaceCopy>["verdict"] }) {
  const above = verdict === "above";
  return (
    <div className="border-b border-slate-200 pb-5 dark:border-slate-700">
      <div className="flex items-start gap-2.5">
        <span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full ${above ? "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300" : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"}`} aria-hidden="true">
          {above ? <TriangleAlert size={13} /> : <Info size={13} />}
        </span>
        <div>
          <p className="text-lg font-bold tracking-[-0.02em] text-slate-950 dark:text-white"><MoneyText text={headline} /></p>
          <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={baselineLine} /></p>
        </div>
      </div>
    </div>
  );
}

function LedgerTreatment({ state }: { state: PaceCopyState }) {
  const fixture = PACE_COPY_FIXTURES[state];
  // Variant A is deliberately the production component, supplied with the
  // same fixture values as the preview copy model. This route therefore
  // catches any drift from the approved ledger rather than redrawing it.
  const notables: SpendVerdictNotable[] = fixture.namedCategories.map((category, index) => ({
    category,
    spent: 0,
    multiple: 0,
    excess: index === 0 ? fixture.namedExcess : 0,
    payments_count: 0,
    cause: [],
    pace: { spent: 0, usual_by_now: 0 },
  }));

  return (
    <>
      <p className="text-[13px] leading-5 text-slate-600 dark:text-slate-300">In the journey, G186&apos;s hero gives the one overall pace verdict. This is its evidence below.</p>
      {fixture.usualByNow === null && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No pace comparison is shown without a reliable baseline.</p>}
      <SpendPaceEvidence
        daysElapsed={fixture.daysElapsed}
        spent={fixture.actualOut}
        paceSeries={fixture.usualByNow === null ? [] : [{ day: fixture.daysElapsed, actual: fixture.actualOut, usual: fixture.usualByNow }]}
        notables={notables}
        unresolvedTotal={fixture.unresolvedTotal}
      />
    </>
  );
}

function ExplanationTreatment({ state }: { state: PaceCopyState }) {
  const fixture = PACE_COPY_FIXTURES[state];
  const copy = derivePaceCopy(fixture);
  const unavailable = copy.verdict === "unavailable";
  const narrative = copy.residual === null
    ? "There are no named category differences to explain. The overall difference stands on its own."
    : "The named category differences and balancing amount add up to the overall difference.";

  return (
    <section aria-labelledby="explanation-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <PaceVerdict headline={copy.headline} baselineLine={copy.baselineLine} verdict={copy.verdict} />
      <h2 id="explanation-heading" className="mt-5 text-base font-bold text-slate-950 dark:text-white">How the difference adds up</h2>
      {!unavailable && (
        <>
          <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{narrative}</p>
          <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700 dark:border-slate-700">
            {copy.namedLabel && copy.namedExcess !== null && (
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">Named categories above usual</dt>
                <dd><SignedAmount value={copy.namedExcess} positive /></dd>
              </div>
            )}
            {copy.residual !== null && (
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">Other differences</dt>
                <dd><SignedAmount value={copy.residual} positive /></dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-[12px] font-bold text-slate-950 dark:text-white">Difference from usual pace</dt>
              <dd><SignedAmount value={copy.total ?? 0} positive /></dd>
            </div>
          </dl>
          {copy.namedLabel && <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><MoneyText text={`${copy.namedLabel} ${formatMoney(copy.namedExcess ?? 0, { plus: true })}.`} /></p>}
          {copy.residualCaption && <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><MoneyText text={copy.residualCaption} /></p>}
        </>
      )}
    </section>
  );
}

export default function SpendPaceCopyClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state = PACE_COPY_STATES.includes(params.get("state") as PaceCopyState) ? params.get("state") as PaceCopyState : "over";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    return () => document.documentElement.classList.remove("dark");
  }, [mode]);

  const href = (nextVariant = variant, nextState = state, nextMode = mode) => `?variant=${nextVariant}&state=${nextState}&mode=${nextMode}`;
  const fixture = PACE_COPY_FIXTURES[state];

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-4 py-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
      <div className="mx-auto max-w-[430px]">
        <header>
          <h1 className="text-2xl font-bold tracking-[-0.025em]">Spend pace copy</h1>
          <p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">Approved A renders the production evidence below G186&apos;s single pace verdict. B remains an unselected proposal.</p>
        </header>

        <nav aria-label="Copy treatment" className="mt-5 grid grid-cols-2 gap-2">
          {(["a", "b"] as Variant[]).map((item) => <Link key={item} href={href(item)} aria-current={variant === item ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl border px-3 text-center text-[12px] font-semibold transition-colors hover:border-indigo-300 hover:bg-indigo-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-400/10 ${variant === item ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600" : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{variantLabel[item]}</Link>)}
        </nav>

        <nav aria-label="Fixture state" className="mt-3 flex flex-wrap gap-2">
          {PACE_COPY_STATES.map((item) => <Link key={item} href={href(variant, item)} aria-current={state === item ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-3 text-[11px] font-semibold transition-colors hover:bg-slate-300 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-700 ${state === item ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{PACE_COPY_FIXTURES[item].label}</Link>)}
        </nav>

        <p className="mt-5 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{fixture.description}</p>
        <div className="mt-3">{variant === "a" ? <LedgerTreatment state={state} /> : <ExplanationTreatment state={state} />}</div>

        <Link href={href(variant, state, mode === "dark" ? "light" : "dark")} className="mt-5 inline-flex min-h-11 items-center text-[12px] font-semibold text-indigo-600 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">View in {mode === "dark" ? "light" : "dark"} mode</Link>
      </div>
    </main>
  );
}
