"use client";

// TEMPORARY PREVIEW — delete after design review.
// "Verdict first" art-direction variant of the Spend page's top region
// (/design/spend-verdict-a). Renders VARIANT-LOCAL copies of the header
// (VerdictHeaderA) and the notable card (NotableCardA), fed by the same
// fixtures /design/spend-live already uses, so the numbers stay identical
// to the approved-baseline preview and design review is comparing two
// renders of the same data, not two different stories.
//
// Scope: only the header + notable cards are re-art-directed here (per the
// brief). The rest of SpendVerdictView's body — majority list, unresolved
// ask card, money-you-moved — is out of scope for this pass and not
// rendered; production's components for those are untouched.
//
// Deep-linkable:
//   /design/spend-verdict-a?mode=light|dark&state=normal|nothing|everything|nobaseline|early

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SPEND_VERDICT_FIXTURES, PREVIEW_INCOME_TXNS, PREVIEW_SIGNALS, PREVIEW_ACCOUNTS } from "../spend-live/fixtures";
import { api } from "@/lib/api";
import type { SpendVerdictState } from "@/lib/api";
import VerdictHeaderA from "./VerdictHeaderA";
import NotableCardA from "./NotableCardA";

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

export default function SpendVerdictAClient() {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: SpendVerdictState = STATES.includes(params.get("state") as SpendVerdictState)
    ? (params.get("state") as SpendVerdictState)
    : "normal";

  const verdict = SPEND_VERDICT_FIXTURES[state];
  // Rank notables by severity (multiple, descending) — the first card
  // renders full, the rest as expandable compact rows. `.notables` from
  // the fixture is already in whatever order the backend emitted; this
  // view is the one that imposes the ranking, not the data.
  const rankedNotables = [...verdict.notables].sort((a, b) => b.multiple - a.multiple);

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
    document.getElementById("spend-verdict-a-out")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function handleMovedTap() {
    document.getElementById("spend-verdict-a-out")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-[430px]">
          <VerdictHeaderA
            verdict={verdict}
            periodLabel={periodLabel(verdict.period.start, verdict.period.end)}
            incomeTxns={PREVIEW_INCOME_TXNS}
            onTransactionClick={() => {}}
            onOutTap={handleOutTap}
            onMovedTap={handleMovedTap}
          />

          <div className="px-4 pt-4" id="spend-verdict-a-out">
            {rankedNotables.length > 0 ? (
              <div className="flex flex-col gap-3">
                {rankedNotables.map((n, i) => (
                  <NotableCardA
                    key={n.category}
                    notable={n}
                    colours={{}}
                    daysElapsed={verdict.period.days_elapsed}
                    rank={i}
                    onOpenCategory={() => {}}
                    // This route is unauthenticated (fixture preview), so
                    // this hits the real backend and genuinely 401s — same
                    // pattern as /design/spend-live: design review sees the
                    // exact rendered failure path, not an always-succeeds
                    // stub.
                    //
                    // Scope note (adjudicated): production never posts
                    // "New normal" directly like this — it always opens the
                    // Intent Consent Sheet first (see SpendVerdictView.tsx's
                    // onNewNormalRequest / components/IntentConsentSheet.tsx),
                    // pricing the change in plain language before filing.
                    // This preview deliberately skips that handoff — the
                    // brief for this card was the button pair's visual
                    // weight and contrast, not re-testing the consent-sheet
                    // flow — so both "One-off" and "New normal" here call
                    // the same bare intent endpoint. Do not treat this as
                    // the real flow; wire the consent sheet before any of
                    // this card's chrome graduates out of /design.
                    onIntent={(category, answer) => api.recordTrendIntent(category, answer).then(() => {})}
                    sym="£"
                    suggestedAim={PREVIEW_SIGNALS[n.category]?.suggested_aim ?? null}
                    checkpoint={PREVIEW_SIGNALS[n.category]?.checkpoint ?? null}
                    onAimChanged={() => {}}
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 text-[11px] text-slate-600 dark:text-slate-400">
                No notables this state ({STATE_LABEL[state]}), try Normal or Everything for the ranked-card demo.
              </p>
            )}
          </div>

          {/* Account fixture is imported to keep this route's fixture usage
              symmetric with /design/spend-live (and available to any future
              extension of this variant); referenced here so it is not an
              unused import. */}
          <p className="px-4 pt-6 text-[11px] text-slate-400 dark:text-slate-500">
            Fixture account: {PREVIEW_ACCOUNTS[0]?.name}
          </p>
        </div>

        {/* Fixed state hopper footer — same pattern as /design/spend-live */}
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
