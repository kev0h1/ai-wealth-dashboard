"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Insights ("Ways to save") hero — Variant B, "Opportunity leads", the one
// Kevin picked from the original three-variant comparison: the hero is the
// total identified across currently open insights, honestly labelled as an
// estimate, with verified savings as a smaller earned chip beside it.
//
// This preview is no longer about choosing a variant, it's about proving
// Variant B survives real data. The insight generation prompt
// (backend/app/routers/savings_insights.py hard_rules #5, ~line 715) only
// allows a savings_estimate when it's quoted from a search result or the
// arithmetic difference of two stated figures — otherwise it's null, and
// null is "expected and common, not a failure". So a real user's open
// insights are rarely all costed. The four states below are the coverage
// spectrum the hero has to read honestly across:
//
//   Full coverage    — every open insight has a number, the happy path.
//   Partial coverage — some do, some don't; the hero must make that
//                       coverage legible so its figure never implies more
//                       than it covers.
//   No coverage      — none do; there is no total to print, so the hero
//                       falls back to a count-led "what to do next" line
//                       instead of a false ~£0/mo.
//   Nothing open     — every insight has been acted on. The end state, it
//                       should read as an achievement, and the one figure
//                       left to show is the verified total, because it's
//                       the only one that's genuinely real.
//
// Deep-linkable: /design/insights-hero?mode=light|dark

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, PartyPopper } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { STATES, money, moneyEstimate, type InsightsHeroState } from "./_mock";

type Mode = "light" | "dark";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

// A hero/rate figure paired with its "/mo" unit — smaller and lighter than
// the figure itself so the number still leads (Numbers Lead Rule), while
// making it unambiguous that this is a recurring rate, not a one-off total
// banked this month. `figureClass` carries the size/weight/colour, this
// wrapper only ever adds the unit.
function RateFigure({ figure, figureClass }: { figure: string; figureClass: string }) {
  return (
    <p className="mt-1 flex items-baseline gap-1.5">
      <span className={figureClass}>{figure}</span>
      <span className="text-[14px] font-medium text-slate-400 dark:text-slate-500">/mo</span>
    </p>
  );
}

// The earned verified-savings chip — present in every state that has a
// verified figure (even £0, where it flips to an honest "not yet" pill).
// `hero` widens it slightly for the "done" state, where it's the only real
// number left on the card and needs to read as the payoff, not a footnote.
function VerifiedChip({
  verified,
  hero,
  trailingLabel,
}: {
  verified: number;
  hero?: boolean;
  trailingLabel?: string;
}) {
  if (verified > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 ${
          hero ? "min-h-[40px] pl-3 pr-4 py-2" : "min-h-[32px] pl-2.5 pr-3 py-1.5"
        }`}
      >
        <CheckCircle2
          size={hero ? 18 : 14}
          className="text-emerald-600 dark:text-emerald-400 flex-shrink-0"
          aria-hidden
        />
        <span
          className={`font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-300 ${
            hero ? "text-[16px]" : "text-[12px]"
          }`}
        >
          {money(verified)}
        </span>
        <span className={`font-medium text-emerald-700 dark:text-emerald-300 ${hero ? "text-[13px]" : "text-[12px]"}`}>
          {trailingLabel ?? "already banked"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 min-h-[32px] rounded-full pl-2.5 pr-3 py-1.5 bg-slate-100 dark:bg-slate-700/60">
      <Circle size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden />
      <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400">Nothing banked yet, that&apos;s next</span>
    </span>
  );
}

// One row in the open-insights list under the hero. A row with no
// derivable estimate (estimateLabel null) is a perfectly good idea that
// simply has no quotable number, so it gets a quiet neutral label in its
// figure slot rather than a blank gap that reads as broken, or a fake
// number that reads as invented.
function InsightRow({
  insight,
  showNoEstimateLabel,
}: {
  insight: InsightsHeroState["liveInsights"][number];
  /** When NO open insight has a number (the no-coverage state), the hero
   *  headline already says "none with a number attached yet" — repeating
   *  "No number yet" on every single row underneath adds a column of
   *  identical grey text next to the one thing worth reading (the title),
   *  rather than distinguishing anything. It only earns its place when it
   *  distinguishes costed rows from uncosted ones, i.e. partial coverage. */
  showNoEstimateLabel: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
        style={{ background: insight.categoryHex }}
        aria-hidden
      />
      <p className="flex-1 min-w-0 text-[13px] font-medium text-slate-700 dark:text-slate-300 leading-snug text-pretty">
        {insight.title}
      </p>
      {insight.estimateLabel ? (
        <span className="text-[12px] font-mono tabular-nums text-slate-500 dark:text-slate-400 flex-shrink-0 italic pt-0.5">
          <MoneyText text={insight.estimateLabel} />
        </span>
      ) : showNoEstimateLabel ? (
        <span className="text-[11px] text-slate-400 dark:text-slate-500 flex-shrink-0 pt-0.5 whitespace-nowrap">
          No number yet
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── The hero, Variant B ──────────────────────── */

function InsightsHero({ state }: { state: InsightsHeroState }) {
  const { openInsights, openWithEstimate, openMonthlySaving, verifiedMonthlySaving: verified } = state;
  const fullCoverage = openInsights > 0 && openWithEstimate === openInsights;
  const partialCoverage = openInsights > 0 && openWithEstimate > 0 && openWithEstimate < openInsights;
  const noCoverage = openInsights > 0 && openWithEstimate === 0;
  const nothingOpen = openInsights === 0;

  return (
    <section className="glass-hero rounded-3xl p-4">
      {nothingOpen ? (
        <>
          <SectionLabel>Ways to save, all clear</SectionLabel>
          <p className="mt-1 text-[19px] leading-snug font-bold text-slate-900 dark:text-slate-100 text-pretty">
            Every idea on your list has been sorted.
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-pretty">
            {state.insightsActedOn} idea{state.insightsActedOn === 1 ? "" : "s"} acted on over time, nothing left
            open right now.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <PartyPopper size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-hidden />
            <VerifiedChip verified={verified} hero trailingLabel="kept every month" />
          </div>
        </>
      ) : (
        <>
          <SectionLabel>
            {noCoverage ? "Open ideas, no numbers yet" : "Identified, every month · estimated"}
          </SectionLabel>

          {fullCoverage && (
            <>
              <RateFigure
                figure={moneyEstimate(openMonthlySaving)}
                figureClass="text-[30px] leading-tight font-bold tracking-tight font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
              <p className="mt-1 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">
                Across {openInsights} open idea{openInsights === 1 ? "" : "s"} below, estimated from your own
                spending, not yet acted on.
              </p>
            </>
          )}

          {partialCoverage && (
            <>
              <RateFigure
                figure={moneyEstimate(openMonthlySaving)}
                figureClass="text-[30px] leading-tight font-bold tracking-tight font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
              <p className="mt-1 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">
                Across {openWithEstimate} of {openInsights} open ideas, the ones with a number so far.
              </p>
            </>
          )}

          {noCoverage && (
            <>
              <p className="mt-1 text-[19px] leading-snug font-bold text-slate-900 dark:text-slate-100 text-pretty">
                {openInsights} idea{openInsights === 1 ? "" : "s"} worth a look, none with a number attached yet.
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 text-pretty">
                Open the top one below, it&apos;s usually the easiest place to start.
              </p>
            </>
          )}

          <div className="mt-3">
            <VerifiedChip verified={verified} />
          </div>
        </>
      )}

      {state.liveInsights.length > 0 && (
        <div className="mt-3 glass-tile rounded-2xl divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
          {/* Real insight titles come from a generation prompt capped at 10
              words — mock titles here are realistic at that length rather
              than artificially shortened, so the row wraps to two lines
              instead of truncating mid-word (`items-start` + no `truncate`,
              category dot nudged down to sit level with the first line).
              One signifier per row: the category-identity dot is the only
              one — a renewal/due timing caution is never a second dot
              beside it, it's already legible in the title's own wording
              ("renewal is due", "still renewing"), so no extra colour is
              needed to say it twice. */}
          {state.liveInsights.map((i) => (
            <InsightRow key={i.title} insight={i} showNoEstimateLabel={openWithEstimate > 0} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── Page shell ─────────────────────────────── */

export default function InsightsHeroClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const [stateKey, setStateKey] = useState<InsightsHeroState["key"]>("full");
  const activeState = STATES.find((s) => s.key === stateKey) ?? STATES[0];

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
            Preview &middot; Insights hero &middot; {mode}
          </p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
            Variant B against real coverage
          </h1>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
            The variant is chosen, opportunity leads. This checks it against the case the first mock avoided: real
            insights where only some (or none) of the open ideas have a derivable estimate.
          </p>

          <div className="mt-3 flex items-center gap-3">
            <a href={`?mode=light`} className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
              Light
            </a>
            <a href={`?mode=dark`} className="min-h-[44px] flex items-center -my-2.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
              Dark
            </a>
          </div>

          {/* Estimate-coverage selector — the four states the hero has to
              read honestly across. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STATES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStateKey(s.key)}
                className={`min-h-[44px] rounded-xl text-[12px] font-semibold active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                  stateKey === s.key
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 text-pretty">{activeState.note}</p>

          <div className="mt-5">
            <InsightsHero state={activeState} />
          </div>
        </div>
      </div>
    </div>
  );
}
