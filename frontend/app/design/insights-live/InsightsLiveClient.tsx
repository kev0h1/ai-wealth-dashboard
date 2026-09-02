"use client";

// STANDING DESIGN TWIN for Insights — not a one-off preview. Renders the
// REAL exported components from app/insights/InsightsPage.tsx (InsightCard,
// CompactInsightRow via isCompactPullInsight, InsightsHero) against fixture
// SavingsInsight payloads shaped field-for-field like the real GET
// /savings-insights serializer output (see fixtures.ts). Auth-exempt, no
// network calls, deep-linkable — the point is to make the compact-vs-full
// render decision checkable in actual pixels, in both themes, without
// needing a live session or a phone.
//
// Root cause this route exists to close (owner phone report 2026-09-01,
// 13:24): three prior fix rounds verified the quiet-state compact-row
// behaviour by code trace + backend census alone. /insights has no
// auth-exempt twin, so nobody ever rendered the actual pixels. This route
// is that twin, permanently.
//
// Extended 2026-09-02 for the money-shape redesign: also renders the REAL
// MoneyShapeHero/WhatWorksCard/ReferenceShapesRow from app/insights/ against
// MONEY_SHAPE_FIXTURES (GET /money-shape shaped fixtures, one per state
// WhatWorksCard's consent branching can be in — see fixtures.ts). Selected
// independently of the SavingsInsight `state` param via its own `shape`
// param, using usePennySheet for real (this route sits under the same root
// layout/PennySheetProvider as every other page, so "Ask Penny" here opens
// the actual sheet, not a stub).
//
// Extended again 2026-09-02, twice: first a separate "Over time" block
// (two chart variants, horizon chips) sat under the hero — retired the
// same day per Kevin's redirect ("select a pay period and it gives the
// breakdown, or specify an average ... on the main card, not additional
// cards"). MoneyShapeHero itself grew a period/average picker instead (see
// its own header comment) — this twin doesn't need any extra wiring for
// that, MoneyShapeHero owns its own local `scope` state; the twin's
// ok_change fixture just needs `periods`/`averages` populated for the
// picker to have anything to pick from (see fixtures.ts's
// OK_CHANGE_PERIODS/OK_CHANGE_AVERAGES).
//
// Deep-linkable: /design/insights-live?mode=light|dark&state=<FixtureKey|all>&shape=<MoneyShapeFixtureKey>
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { InsightCard, CompactInsightRow, isCompactPullInsight, InsightsHero } from "@/app/insights/InsightsPage";
import MoneyShapeHero from "@/app/insights/MoneyShapeHero";
import WhatWorksCard from "@/app/insights/WhatWorksCard";
import ReferenceShapesRow from "@/app/insights/ReferenceShapesRow";
import { usePennySheet } from "@/components/PennySheetProvider";
import {
  FIXTURE_LABELS, FIXTURE_ORDER, INSIGHT_FIXTURES, type FixtureKey,
  MONEY_SHAPE_LABELS, MONEY_SHAPE_ORDER, MONEY_SHAPE_FIXTURES, type MoneyShapeFixtureKey,
} from "./fixtures";

type Mode = "light" | "dark";

function isFixtureKey(v: string | null): v is FixtureKey {
  return !!v && (FIXTURE_ORDER as string[]).includes(v);
}

function isMoneyShapeFixtureKey(v: string | null): v is MoneyShapeFixtureKey {
  return !!v && (MONEY_SHAPE_ORDER as string[]).includes(v);
}

export default function InsightsLiveClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const stateParam = params.get("state");
  const selected: FixtureKey | "all" = isFixtureKey(stateParam) ? stateParam : "all";
  const shapeParam = params.get("shape");
  const selectedShape: MoneyShapeFixtureKey = isMoneyShapeFixtureKey(shapeParam) ? shapeParam : "ok_change";
  const shape = MONEY_SHAPE_FIXTURES[selectedShape];
  const { open: openPennySheet } = usePennySheet();
  const askPenny = (ask: string) => openPennySheet({ screen: "insights", ask });

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const keys = selected === "all" ? FIXTURE_ORDER : [selected];
  const rendered = keys.map(k => INSIGHT_FIXTURES[k]);

  // Mirrors SavingsInsightsSection's `anyOpenHasEstimate` — true when at
  // least one currently-rendered open insight has a costed estimate, gating
  // every other card's "No number yet" label the same way production does.
  const anyOpenHasEstimate = rendered.some(
    i => (i.state ? i.state === "fresh" || i.state === "quiet" : true)
      && i.savings_estimate_monthly != null
  );

  const hrefFor = (s: FixtureKey | "all") => `?mode=${mode}&state=${s}&shape=${selectedShape}`;
  const hrefForShape = (s: MoneyShapeFixtureKey) => `?mode=${mode}&state=${selected}&shape=${s}`;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Design twin
            </p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Insights — live components</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Real InsightCard / CompactInsightRow / InsightsHero / MoneyShapeHero / WhatWorksCard / ReferenceShapesRow against fixture payloads shaped like the live serializer output.
            </p>
          </div>

          {/* Money shape — the real GET /money-shape components, against
              MONEY_SHAPE_FIXTURES (see fixtures.ts). Selected independently
              of the SavingsInsight `state` picker below via `shape` — see
              the bottom bar's second row. */}
          <div className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {MONEY_SHAPE_LABELS[selectedShape]}
            </p>
            <MoneyShapeHero shape={shape} />
            <WhatWorksCard ww={shape.what_works} onAskPenny={askPenny} />
            <ReferenceShapesRow onAskPenny={askPenny} />
          </div>

          <div className="pt-1 border-t border-slate-200 dark:border-white/10" />

          {selected === "all" && (
            <InsightsHero
              open={rendered.filter(i => i.state === "fresh" || i.state === "quiet").length}
              openWithEstimate={rendered.filter(i => i.savings_estimate_monthly != null).length}
              openMonthlySaving={rendered.reduce((s, i) => s + (i.savings_estimate_monthly ?? 0), 0)}
              verifiedMonthlySaving={rendered.reduce((s, i) => s + (i.verified_savings ?? 0), 0)}
              insightsActedOn={rendered.filter(i => i.verified_savings && i.verified_tier === "earned").length}
              changesNoticed={rendered.filter(i => i.verified_savings && i.verified_tier !== "earned").length}
              resolvedCount={rendered.filter(i => i.state === "verified" || i.state === "substituted").length}
            />
          )}

          <div className="space-y-3">
            {rendered.map(insight => {
              const compact = isCompactPullInsight(insight);
              return (
                <div key={insight.id + insight.state} className="space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {FIXTURE_LABELS[(FIXTURE_ORDER.find(k => INSIGHT_FIXTURES[k] === insight) ?? "fresh_weekly") as FixtureKey]}
                    {" · "}
                    {compact ? "renders COMPACT" : "renders FULL"}
                  </p>
                  {compact ? (
                    <CompactInsightRow insight={insight} onExpand={() => {}} />
                  ) : (
                    <InsightCard
                      insight={insight}
                      workflow={null}
                      onPin={() => {}}
                      onContextSaved={() => {}}
                      anyOpenHasEstimate={anyOpenHasEstimate}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-800/95 border-t border-slate-200 dark:border-slate-700 backdrop-blur px-3 py-2.5 space-y-2"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto">
            <span className="flex-shrink-0 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
              shape
            </span>
            {MONEY_SHAPE_ORDER.map(k => (
              <a
                key={k}
                href={hrefForShape(k)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  k === selectedShape ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {k}
              </a>
            ))}
          </div>
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto">
            <span className="flex-shrink-0 text-[10px] font-mono uppercase tracking-wide text-slate-400 dark:text-slate-500">
              state
            </span>
            <a
              href={hrefFor("all")}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                selected === "all" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}
            >
              All
            </a>
            {FIXTURE_ORDER.map(k => (
              <a
                key={k}
                href={hrefFor(k)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  k === selected ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {k}
              </a>
            ))}
            <a
              href={`?mode=${mode === "dark" ? "light" : "dark"}&state=${selected}&shape=${selectedShape}`}
              className="flex-shrink-0 ml-auto px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
            >
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
