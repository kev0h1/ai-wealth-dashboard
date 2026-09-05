"use client";

// "What works for you" — the Insights tab's evidence card, production.
// Ported from the approved wireframe (app/design/insights-full/sections.tsx's
// WhatWorksFull) onto the real GET /money-shape contract instead of static
// fixtures/query-param consent state. Describes the user's own history,
// never grades it (BEHAVIOURS.md's "The Mirror Is Not A Score" named rule).
//
// State machine mirrors `MoneyShape["what_works"].state` exactly:
//   "ok"         — full render: optional Mirror trait citation, headline,
//                  evidence rows, footer + "Ask Penny why", and whichever
//                  one of the three mutually-exclusive consent blocks
//                  applies (proposal / kept / choose-in-Mirror).
//   "thin"       — headline + the honest "needs N periods, has M" line.
//                  Nothing else — no footer, no rows, no blocks; there's
//                  no history yet for any of them to describe.
//   "no_pattern" — headline + "Penny keeps watching each pay period."
//                  Same reasoning: no established pattern yet, so nothing
//                  beyond the headline has anything true to say.

import Link from "next/link";
import { Fingerprint, Sparkles } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import type { MoneyShape } from "@/lib/api";

type WhatWorks = MoneyShape["what_works"];

const MINUS = "−"; // matches MoneyText / AccountRow's unicode minus

function formatSignedCash(n: number): string {
  const abs = `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
  return n < 0 ? `${MINUS}${abs}` : `+${abs}`;
}

/** "Why does {headline, lower-cased, trailing punctuation trimmed} for
 *  me?" — handed to Penny verbatim via onAskPenny. */
function buildWhyAsk(headline: string): string {
  const trimmed = headline.trim().replace(/[.!?]+$/, "");
  return `Why does ${trimmed.toLowerCase()} for me?`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

export default function WhatWorksCard({
  ww,
  onAskPenny,
}: {
  ww: WhatWorks;
  onAskPenny: (ask: string) => void;
}) {
  const full = ww.state === "ok";
  // Hoisted so the evidence-row .map() below can narrow it — TS narrows a
  // plain local const's truthiness across a closure, but not a property
  // access like `ww.flag_labels` re-read inside the callback.
  const flagLabels = ww.flag_labels;

  return (
    <div className="glass-card rounded-2xl p-4">
      <SectionLabel>{`WHAT WORKS FOR YOU · FROM YOUR LAST ${ww.periods_available} PAY PERIODS`}</SectionLabel>

      {full && ww.trait && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
          <Fingerprint size={14} className="flex-shrink-0" aria-hidden="true" />
          <span>From your Mirror: {ww.trait.title}.</span>
        </div>
      )}

      <p className="mt-1.5 text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
        {ww.headline}
      </p>

      {ww.state === "thin" && (
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 text-pretty">
          This needs {ww.periods_needed} pay periods of data. You have {ww.periods_available}.
        </p>
      )}

      {ww.state === "no_pattern" && (
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 text-pretty">
          Penny keeps watching each pay period.
        </p>
      )}

      {full && ww.evidence.length > 0 && flagLabels && (
        <div className="mt-3 rounded-xl divide-y divide-slate-100 dark:divide-white/5 border border-slate-100 dark:border-white/5 overflow-hidden">
          {ww.evidence.map((row) => (
            <div key={row.period} className="flex items-center gap-2.5 px-3 py-2">
              <span className="w-8 flex-shrink-0 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                {row.period}
              </span>
              <span
                className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  row.flag === "hit"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300"
                }`}
              >
                {row.flag === "hit" ? flagLabels.hit : flagLabels.miss}
              </span>
              <span className="flex-1" />
              <MoneyText
                text={formatSignedCash(row.left_over)}
                className="text-[13px] font-semibold text-slate-900 dark:text-slate-100"
              />
            </div>
          ))}
        </div>
      )}

      {full && (
        <>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Describes your own history. Not advice.</p>
            <button
              onClick={() => onAskPenny(buildWhyAsk(ww.headline))}
              className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
            >
              <Sparkles size={14} aria-hidden="true" />
              Ask Penny why
            </button>
          </div>

          {ww.proposal ? (
            <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 text-pretty">
                {ww.proposal.headline}
              </p>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">{ww.proposal.body}</p>
              <button
                onClick={() => onAskPenny(ww.proposal!.penny_ask)}
                className="mt-3 w-full min-h-[44px] rounded-xl border border-indigo-200 dark:border-indigo-500/40 flex items-center justify-center gap-2 text-[14px] font-semibold text-indigo-600 dark:text-indigo-400 active:scale-95 transition-transform"
              >
                Propose in Planning
              </button>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 text-center">
                Proposals never move money without you.
              </p>
            </div>
          ) : ww.trait?.choice === "keep" ? (
            <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">You chose to keep this.</p>
                <span className="flex-shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Kept
                </span>
              </div>
              <p className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
                {ww.trait.title} is working for you. Nothing to change here.
              </p>
            </div>
          ) : ww.trait && !ww.trait.choice ? (
            <p className="mt-3 text-[12px] text-slate-500 dark:text-slate-400 text-pretty">
              Choose keep or change for this trait in your{" "}
              <Link href="/penny" className="text-indigo-600 dark:text-indigo-400 underline underline-offset-4 active:opacity-70 transition-opacity">
                Mirror
              </Link>{" "}
              to unlock a proposal.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
