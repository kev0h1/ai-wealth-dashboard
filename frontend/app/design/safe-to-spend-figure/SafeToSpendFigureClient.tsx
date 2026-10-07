"use client";

// G218 (approved B, folded in 2026-10-06). Renders the PRODUCTION
// components/SafeToSpendCard through props only; `previewBalancesVisible`
// unmasks the fixture figures. No requests, no live data. There is one shipped
// look: emerald On track, red only for a cash shortfall, amber for a shortfall
// that exists only because of plans and envelopes, ink for the rest.
//
// /design/safe-to-spend-figure?state=on-track|tight|card|short-cash|short-plans|error|degraded|syncing&mode=light|dark&view=single|strip|compare

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { FIXTURES as SPEND_FROM_FIXTURES } from "../g115-spend-from-accounts/fixtures";
import { FIGURE_DATA, FIGURE_STATES, type FigureState } from "./fixtures";

type Mode = "light" | "dark";
type View = "single" | "strip" | "compare";

const noop = () => {};

function Card({ state }: { state: FigureState }) {
  return (
    <SafeToSpendCard
      data={FIGURE_DATA[state] ?? null}
      error={state === "error"}
      loading={false}
      onRetry={noop}
      spendFrom={SPEND_FROM_FIXTURES.clear.spendFrom}
      previewBalancesVisible
    />
  );
}

const pill = "inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOn = "bg-indigo-600 text-white";
const pillOff = "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300";

export default function SafeToSpendFigureClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawState = params.get("state");
  const state: FigureState = FIGURE_STATES.some((s) => s.id === rawState) ? (rawState as FigureState) : "on-track";
  const rawView = params.get("view");
  const view: View = rawView === "strip" || rawView === "compare" ? rawView : "single";

  const href = (next: Partial<{ state: FigureState; mode: Mode; view: View }>) =>
    `?state=${next.state ?? state}&mode=${next.mode ?? mode}&view=${next.view ?? view}`;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className={`min-h-screen px-4 pb-16 pt-6 ${mode === "dark" ? "bg-slate-950" : "bg-slate-100"}`}>
        <div className="mx-auto max-w-md sm:max-w-5xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">G218 · Safe to Spend figure colour · approved B, folded in</p>
          <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            {view === "compare"
              ? "A cash shortfall stays red. A shortfall that exists only because of plans and envelopes is amber in the figure, chip and caption."
              : "The shipped look: emerald On track, red for a cash shortfall, amber for a plans-only shortfall, ink for everything else."}
          </p>

          <nav aria-label="Preview controls" className="mt-3 flex flex-wrap gap-2">
            {(["single", "strip", "compare"] as View[]).map((v) => (
              <Link key={v} href={href({ view: v })} className={`${pill} ${view === v ? pillOn : pillOff}`}>{v === "single" ? "One state" : v === "strip" ? "All states" : "Cash vs plans"}</Link>
            ))}
            <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
          </nav>
          {view === "single" && (
            <nav aria-label="State" className="mt-2 flex flex-wrap gap-2">
              {FIGURE_STATES.map((s) => (
                <Link key={s.id} href={href({ state: s.id })} className={`${pill} ${state === s.id ? pillOn : pillOff}`}>{s.label}</Link>
              ))}
            </nav>
          )}

          {view === "single" && <div className="mt-5"><Card state={state} /></div>}

          {view === "strip" && (
            <div className="mt-5 flex flex-col gap-5 sm:grid sm:grid-cols-2">
              {FIGURE_STATES.map((s) => (
                <section key={s.id} aria-label={s.label}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
                  <Card state={s.id} />
                </section>
              ))}
            </div>
          )}

          {view === "compare" && (
            <div className="mt-5 flex flex-col gap-5 sm:grid sm:grid-cols-2">
              {(["short-cash", "short-plans"] as FigureState[]).map((id) => (
                <section key={id} aria-label={id === "short-cash" ? "Cash short" : "Plans-only short"}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{id === "short-cash" ? "Short, cash" : "Short, plans only"}</p>
                  <Card state={id} />
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
