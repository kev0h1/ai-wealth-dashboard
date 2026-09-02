"use client";

// TEMPORARY PREVIEW — delete after design review.
// "Weighted instrument" art-direction variant of the Spend verdict header +
// notable cards, built for the design-variant fan-out (Kevin picks on his
// phone). Renders VARIANT-LOCAL copies of the header and notable card
// (./Header.tsx, ./NotableCards.tsx) against the SAME fixture payloads
// /design/spend-live uses, so this reads as a genuine re-weighting of the
// real data, not an invented mockup. Never imports or modifies
// components/SpendHeader.tsx, components/SpendVerdictView.tsx or
// SpendPage.tsx — see this route's own comment headers for what changed and
// why.
//
// Deep-linkable:
//   /design/spend-verdict-b?mode=light|dark&state=normal|nothing|everything|nobaseline|early

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import WeightedInstrumentHeader from "./Header";
import { HeroNotableCard, GroupedNotablesTile, splitNotables } from "./NotableCards";
import { SPEND_VERDICT_FIXTURES, PREVIEW_INCOME_TXNS, PREVIEW_SIGNALS } from "../spend-live/fixtures";
import { api } from "@/lib/api";
import type { SpendVerdictState } from "@/lib/api";

type Mode = "light" | "dark";
const STATES: SpendVerdictState[] = ["normal", "nothing", "everything", "nobaseline", "early"];
const STATE_LABEL: Record<SpendVerdictState, string> = {
  normal: "Normal",
  nothing: "Nothing",
  everything: "Everything",
  nobaseline: "No baseline",
  early: "Early",
};

function periodLabel(start: string, end: string): string {
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

export default function SpendVerdictBClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: SpendVerdictState = STATES.includes(params.get("state") as SpendVerdictState)
    ? (params.get("state") as SpendVerdictState)
    : "normal";

  const verdict = SPEND_VERDICT_FIXTURES[state];
  const { hero, rest } = splitNotables(verdict.notables);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const hrefFor = (s: SpendVerdictState) => `?mode=${mode}&state=${s}`;

  function handleOutTap() {
    document.getElementById("spend-verdict-b-notables")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleMovedTap() {
    document.getElementById("spend-verdict-b-notables")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-[430px]">
          <WeightedInstrumentHeader
            verdict={verdict}
            periodLabel={periodLabel(verdict.period.start, verdict.period.end)}
            isCurrentPeriod={true}
            incomeTxns={PREVIEW_INCOME_TXNS}
            onTransactionClick={() => {}}
            onOutTap={handleOutTap}
            onMovedTap={handleMovedTap}
          />

          <div className="px-4 pt-4" id="spend-verdict-b-notables">
            {hero ? (
              <div className="flex flex-col gap-3">
                <HeroNotableCard
                  notable={hero}
                  colours={{}}
                  daysElapsed={verdict.period.days_elapsed}
                  onOpenCategory={() => {}}
                  // Real, unauthenticated backend call, same pattern as
                  // /design/spend-live: this genuinely 401s here, showing
                  // the real failure path rather than an always-succeeds
                  // stub.
                  //
                  // Simplification, noted so nobody mistakes this preview for
                  // the real flow: in production (SpendVerdictView.tsx),
                  // "New normal" never posts directly — it always opens the
                  // Intent Consent Sheet first, which prices the change in
                  // plain language before saving (DESIGN.md's Card resolve
                  // lifecycle section). This preview's HeroNotableCard posts
                  // both "One-off" and "New normal" straight through the same
                  // onIntent call; it exists to review the two buttons'
                  // visual weight/contrast, not to reproduce the consent-sheet
                  // gating.
                  onIntent={(category, answer) => api.recordTrendIntent(category, answer).then(() => {})}
                  sym="£"
                  suggestedAim={PREVIEW_SIGNALS[hero.category]?.suggested_aim ?? null}
                  checkpoint={PREVIEW_SIGNALS[hero.category]?.checkpoint ?? null}
                  onAimChanged={() => {}}
                />
                <GroupedNotablesTile notables={rest} colours={{}} onOpenCategory={() => {}} />
              </div>
            ) : (
              <p className="px-1 text-[13px] text-slate-500 dark:text-slate-400">
                Nothing running warm enough for a notable card this period.
              </p>
            )}
          </div>
        </div>

        {/* Fixed state hopper footer — same convention as /design/spend-live */}
        <div
          className="fixed bottom-0 left-0 right-0 glass-sheet border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1.5"
          style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto scrollbar-hide overscroll-x-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            {STATES.map((s) => (
              <a
                key={s}
                href={hrefFor(s)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  s === state
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                }`}
              >
                {STATE_LABEL[s]}
              </a>
            ))}
            <a
              href={`?mode=${mode === "dark" ? "light" : "dark"}&state=${state}`}
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
