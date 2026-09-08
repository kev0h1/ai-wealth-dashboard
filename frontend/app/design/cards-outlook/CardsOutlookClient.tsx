"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// G10 (backlog): fold the retired debt page's per-card outlook into
// app/cards/CardsPage.tsx as a final section below THE TRAJECTORY. Kevin's
// decision (2026-09-09): propose two coded art-direction variants under
// /design first, pick a winner, THEN fold it into CardsPage as a separate
// step (H12 removes the dead debt stack after that).
//
// Data here is FIXTURE-derived from the real shape of
// backend/app/services/debt_plan.py's compute_debt_plan(uid) (cards[],
// totals.extra_to_clear) — see fixtures.ts's header comment for the exact
// field mapping. No network calls, no live navigation changes.
//
//   /design/cards-outlook?variant=a|b&state=carried|clear&mode=light|dark
//
// Review notes (independent pass against DESIGN.md + Web Interface
// Guidelines, before this went to Kevin):
//   - Copy: no em dashes anywhere in this route's user-facing strings
//     (checked fixtures.ts, shared.tsx, VariantA.tsx, VariantB.tsx).
//   - Copy: the lead line is a projection, not a promise — "would clear",
//     matching Net-position/no-conviction-on-predictions doctrine
//     (money memory: predictions get hedged, never stated as fact). Fixed
//     an earlier draft that read "clears" (bare present tense) before this
//     pass; both the "extra £X" and "at your pace" branches now read
//     "would clear".
//   - Colour: The Red Is Risk Rule — red is never used; a card actually
//     accruing interest gets Watch Amber only, on the rate pill (Variant A)
//     or the rail dot (Variant B), never on the money figures themselves
//     (Figures Are Ink rule). Cards on a 0% promo or not currently charged
//     interest stay neutral slate, even though they carry debt.
//   - Hit sizes: variant/mode/state switcher pills are min-h-[44px]
//     touch targets, matching the account-rows preview's own switcher.
//   - Contrast: rate-pill amber uses the same
//     bg-amber-50/text-amber-600 (light) and bg-amber-500/15/text-amber-400
//     (dark) pairing already shipped on Spend's pace badge; not a new pair.
//   - Money is mono: every £ figure routes through MoneyText or carries
//     `money`/`font-mono tabular-nums` directly, matching CardsPage.tsx's
//     own convention (fmtGBP, the WHERE IT MOVED row figures).
//   - Font sizes: the impeccable design hook flagged text-[10px]/[11px] on
//     the rate pill, rail tick labels and clear-month captions as "off the
//     documented type ramp" — these are verbatim matches to CardsPage.tsx's
//     already-shipped APR pill (text-[10px], line ~256) and balance caption
//     (text-[11px], line ~279), not new sizes introduced by this proposal,
//     so left as-is; flagging the same ramp gap CardsPage.tsx already has
//     would be a separate, pre-existing DESIGN.md documentation issue.
//   - Empty state (state=clear): a calm one-line sentence, no card, no
//     colour signal, matching the Home hero's own "insufficient data"
//     treatment tone. Caught during this pass: the first draft's clear-state
//     fixture still carried two cleared-monthly cards, so it rendered the
//     folded "X and Y clear in full each month" line alongside the empty
//     sentence, contradicting the brief's "no section otherwise". Fixed by
//     giving state=clear an empty cleared-monthly list too (fixtures.ts,
//     CLEARED_MONTHLY_CLEAR); the cleared-monthly fold-line edge case is
//     still exercised, just under state=carried instead.
//   - Layout: screenshotting at 390px caught Variant B's month-rail ticks
//     and labels at the 0 and 24 month marks bleeding past the card's
//     rounded edge (each marker is centred with -translate-x-1/2, so the
//     end markers hung half their own width outside the 0%/100% bounds).
//     Fixed by inseting the rail's percentage mapping 4% from each edge
//     (pctFor() in VariantB.tsx) so every tick, label and dot stays inside
//     the card at any width.
//   - Motion: none added; no animation to check against
//     prefers-reduced-motion.
//   - Dark mode: both variants carry dark: pairs throughout; verified via
//     the mode=dark screenshots below.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { OUTLOOK_CARRIED, OUTLOOK_CLEAR, CLEARED_MONTHLY_CARDS, CLEARED_MONTHLY_CLEAR, TRAJECTORY_FIXTURE } from "./fixtures";
import { TrajectoryPanel, Whisper } from "./shared";
import VariantA from "./VariantA";
import VariantB from "./VariantB";

type Variant = "a" | "b";
type Mode = "light" | "dark";
type StateKey = "carried" | "clear";

const VARIANTS: Variant[] = ["a", "b"];
const STATES: StateKey[] = ["carried", "clear"];

function Switcher({ variant, mode, state }: { variant: Variant; mode: Mode; state: StateKey }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&state=${state}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        {STATES.map((s) => (
          <a
            key={s}
            href={`?variant=${variant}&state=${s}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              s === state ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {s === "carried" ? "Carried" : "Clear"}
          </a>
        ))}
        <a
          href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const rawState = params.get("state");
  const state: StateKey = (STATES as string[]).includes(rawState ?? "") ? (rawState as StateKey) : "carried";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const fixture = state === "carried" ? OUTLOOK_CARRIED : OUTLOOK_CLEAR;
  const clearedMonthly = state === "carried" ? CLEARED_MONTHLY_CARDS : CLEARED_MONTHLY_CLEAR;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-8">
          {/* Replica of CardsPage.tsx's header, for context only */}
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 mb-5">
              <ChevronLeft size={15} />
              Back
            </div>
            <Whisper>CARDS · THIS CYCLE</Whisper>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">9 Sep – 22 Sep</p>
          </div>

          {/* THE TRAJECTORY — verbatim copy of CardsPage.tsx §5, so the new
              section below is seen in the exact context it will ship in. */}
          <TrajectoryPanel trajectory={TRAJECTORY_FIXTURE} />

          {/* New section: G10 proposal */}
          {variant === "a" ? (
            <VariantA fixture={fixture} clearedMonthly={clearedMonthly} />
          ) : (
            <VariantB fixture={fixture} clearedMonthly={clearedMonthly} />
          )}
        </div>

        <Switcher variant={variant} mode={mode} state={state} />
      </div>
    </div>
  );
}

export default function CardsOutlookClient() {
  return <Inner />;
}
