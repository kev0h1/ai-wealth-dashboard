"use client";

// G218 design round (skill: impeccable; first drafts by openai/gpt-6-astra,
// rewritten to DESIGN.md). Renders the PRODUCTION components/SafeToSpendCard
// through props only: `figureTone` picks the treatment, `previewBalancesVisible`
// unmasks the fixture figures. No requests, no live data.
//
// Variant A  ink figure in every state, chip and its icon carry the verdict
// Variant B  tinted figure (today's emerald and red), dark red fixed
// Variant C  ink figure with a short coloured rule under it
// Variant today  the shipped look, for reference only
//
// /design/safe-to-spend-figure?variant=a|b|c|today&state=on-track|tight|card|short-cash|short-plans|error|degraded|syncing&mode=light|dark&view=single|strip|compare

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SafeToSpendCard, { type FigureTone } from "@/components/SafeToSpendCard";
import { FIXTURES as SPEND_FROM_FIXTURES } from "../g115-spend-from-accounts/fixtures";
import { FIGURE_DATA, FIGURE_STATES, type FigureState } from "./fixtures";

type Variant = "a" | "b" | "c" | "today";
type Mode = "light" | "dark";
type View = "single" | "strip" | "compare";

const TONE: Record<Variant, FigureTone> = { a: "ink", b: "tinted-vivid", c: "ink-accent", today: "tinted" };
const VARIANT_NOTE: Record<Variant, string> = {
  a: "A. Ink everywhere. The chip and its icon carry the verdict. A shortfall caused only by plans and envelopes is amber, not red.",
  b: "B. Tinted figure. Emerald On track, red when short, red 500 in dark mode instead of salmon 400. Plans-only shortfall stays red.",
  c: "C. Ink figure with a short rule beneath it: emerald On track, red for a cash shortfall. Plans-only shortfall has no rule and an amber chip.",
  today: "Today's shipped look, for reference.",
};

const noop = () => {};

function Card({ variant, state }: { variant: Variant; state: FigureState }) {
  return (
    <SafeToSpendCard
      data={FIGURE_DATA[state] ?? null}
      error={state === "error"}
      loading={false}
      onRetry={noop}
      spendFrom={SPEND_FROM_FIXTURES.clear.spendFrom}
      figureTone={TONE[variant]}
      previewBalancesVisible
    />
  );
}

const pill = "inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const pillOn = "bg-indigo-600 text-white";
const pillOff = "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300";

export default function SafeToSpendFigureClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" || rawVariant === "today" ? rawVariant : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawState = params.get("state");
  const state: FigureState = FIGURE_STATES.some((s) => s.id === rawState) ? (rawState as FigureState) : "on-track";
  const rawView = params.get("view");
  const view: View = rawView === "strip" || rawView === "compare" ? rawView : "single";

  const href = (next: Partial<{ variant: Variant; state: FigureState; mode: Mode; view: View }>) =>
    `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? mode}&view=${next.view ?? view}`;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className={`min-h-screen px-4 pb-16 pt-6 ${mode === "dark" ? "bg-slate-950" : "bg-slate-100"}`}>
        <div className="mx-auto max-w-md sm:max-w-5xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">G218 · Safe to Spend figure colour</p>
          <p className="mt-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            {view === "compare" ? "The three variants for one state, side by side." : VARIANT_NOTE[variant]}
          </p>

          <nav aria-label="Preview controls" className="mt-3 flex flex-wrap gap-2">
            {(["single", "strip", "compare"] as View[]).map((v) => (
              <Link key={v} href={href({ view: v })} className={`${pill} ${view === v ? pillOn : pillOff}`}>{v === "single" ? "One state" : v === "strip" ? "All states" : "A, B, C"}</Link>
            ))}
            <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${pillOff}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
          </nav>
          {view !== "compare" && (
            <nav aria-label="Variant" className="mt-2 flex flex-wrap gap-2">
              {(["a", "b", "c", "today"] as Variant[]).map((v) => (
                <Link key={v} href={href({ variant: v })} className={`${pill} ${variant === v ? pillOn : pillOff}`}>{v === "today" ? "Today" : v.toUpperCase()}</Link>
              ))}
            </nav>
          )}
          {view !== "strip" && (
            <nav aria-label="State" className="mt-2 flex flex-wrap gap-2">
              {FIGURE_STATES.map((s) => (
                <Link key={s.id} href={href({ state: s.id })} className={`${pill} ${state === s.id ? pillOn : pillOff}`}>{s.label}</Link>
              ))}
            </nav>
          )}

          {view === "single" && <div className="mt-5"><Card variant={variant} state={state} /></div>}

          {view === "strip" && (
            <div className="mt-5 flex flex-col gap-5 sm:grid sm:grid-cols-2">
              {FIGURE_STATES.map((s) => (
                <section key={s.id} aria-label={s.label}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{s.label}</p>
                  <Card variant={variant} state={s.id} />
                </section>
              ))}
            </div>
          )}

          {view === "compare" && (
            <div className="mt-5 flex flex-col gap-5 sm:grid sm:grid-cols-3">
              {(["a", "b", "c"] as Variant[]).map((v) => (
                <section key={v} aria-label={`Variant ${v.toUpperCase()}`}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Variant {v.toUpperCase()}</p>
                  <Card variant={v} state={state} />
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
