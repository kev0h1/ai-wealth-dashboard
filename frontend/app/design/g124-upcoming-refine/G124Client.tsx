"use client";

// G124 — Upcoming refine. Kevin reviewed the G90 preview
// (app/design/upcoming-canvas-before-cards) against the LIVE /upcoming page
// on his phone: "the design is good and clean but it changes too much of
// the existing infrastructure in place." This round is NOT a rebuild —
// PlanningPage.tsx stays exactly as it is — it takes exactly three things
// from G90 and Kevin's own follow-up notes:
//   1. The hero adopts G90's bounded-panel styling; content unchanged.
//   2. Same-day payments group into one bounded day card (the G122
//      transactions-hub grammar), not a separate floating card per row.
//   3. Set-aside content density/polish — three different answers.
//
// G124 REVISION (Kevin, 2026-09-18, on the live UAT previews) applied
// cross-cuttingly to all three variants, no variant picked yet:
//   1. Rows inside a day group no longer repeat the day's own absolute
//      date — the day heading above already carries it (see DayGroups.tsx).
//   2. A settling row now announces itself in two places, not three: the
//      "SETTLING" sub-cluster title is gone, and so is the right-hand
//      "settling" caption. The clock icon chip and the "Left earlier
//      today, still settling" line under the payment name stay.
//   3. The hero's red panel tint is gone entirely, in every state. Red now
//      lives only in the figure, the "N accounts short" badge and the
//      shortfall attribution line — see HeroCard.tsx's own doctrine
//      comment. This settles the unified-vs-live red-rule question this
//      file used to expose via `?redRule=unified|live`; that toggle, the
//      RedRuleNote it was explained by, and the HERO_DIVERGENT fixture
//      that existed only to demonstrate the two rules disagreeing are all
//      removed as a consequence.
//
// G127 (round three, same three variants, still no pick):
//   1. Red narrows again — see HeroCard.tsx's own doctrine comment. Only
//      the figure and the "N accounts short" badge stay red now.
//   2. The page header adopts the codex reference's typography exactly
//      (app/design/upcoming-canvas-before-cards/UpcomingCanvasClient.tsx
//      lines 84-113): the "UPCOMING" eyebrow is gone, the <h1> takes
//      codex's `text-[28px] font-bold leading-tight tracking-[-0.035em]`
//      and its slate-950/white ink, and the header row's alignment matches
//      codex's `items-start` (was `items-center`) — styling only, the
//      descriptive sentence beneath the title is untouched CONTENT. The
//      hero's own "Projected at payday" micro-label becomes a real heading
//      to match codex's `<h2 ... text-base font-bold>` — see HeroCard.tsx.
//   3. Day headings now carry the absolute date instead of a relative
//      count ("3 days" -> "Mon 21 Sep"); the relative sense of time moves
//      onto the canvas as a switchable occasional marker between day
//      groups — see DayGroups.tsx's own doctrine comment for the three
//      interval rules and why Today/Tomorrow keep their word.
//
// G131 fold-in, part one (Kevin approved variant A + the cluster interval
// rule, 2026-09-18): the hero and the day-card/divider/marker grammar are
// no longer reimplemented here — they render the SAME shared components
// and pure functions PlanningPage.tsx now imports (components/upcoming/
// UpcomingHeroCard.tsx, components/upcoming/UpcomingDayCard.tsx,
// components/upcoming/UpcomingDivider.tsx, lib/upcomingMarkers.ts), so this
// preview can't drift from what shipped on those three pieces. The "gap"
// and "rhythm" interval rules and the switcher that compared them against
// "cluster" are gone — Kevin picked cluster, nothing else ships.
//
// G131 fold-in, part two: "design A looks good" was Kevin's pick of the
// Set-aside treatment too (setAsideVariants.tsx's own header named A, B, C
// as three answers to Kevin's "Set aside... makes it cluttered" note) — a
// gap the first fold-in pass missed, since its own brief never named the
// Set-aside block. Variant A ("today's shape, kept, with the typography/
// truncation fixes applied in place") is folded into PlanningPage.tsx's
// PlansSection; B (compact chip) and C (progressive disclosure) do not
// ship and are removed here the same way "gap"/"rhythm" were — the A/B/C
// switcher and setAsideVariants.tsx/setAsideHelpers.ts are gone.
// components/upcoming/SetAsideList.tsx is the one shared component both
// this preview and PlanningPage.tsx render; lib/setAsideDisplay.ts holds
// the humanising logic (title case, word-safe truncation, the card-string
// collapse) both consume.
//
// FIXTURE-ONLY, disclosed prominently (see fixtures.ts's own header and the
// G124 report): PlanningPage.tsx's hero figure, risk flags and day-group
// walk are all computed inline inside one large authenticated page
// component with no importable boundary at the right granularity for the
// ROW itself (see DayGroups.tsx's own note on why `Row` stays hand-authored
// against representative fixtures). The hero, the day-card/divider/marker
// shell AND the Set-aside list are the real production components as of
// this fold-in.
import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EyeOff } from "lucide-react";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import SetAsideList from "@/components/upcoming/SetAsideList";
import DayGroups from "./DayGroups";
import {
  ALLOCATIONS, HERO_POSITIVE, HERO_NEGATIVE,
  RUNWAY_POSITIVE, RUNWAY_NEGATIVE,
  BILLS_POSITIVE, BILLS_NEGATIVE,
} from "./fixtures";

type Mode = "light" | "dark";
type HeroState = "positive" | "negative";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// The index page (app/design/page.tsx, PreviewCard) always links here as
// `?mode=dark&state=<value>` — `state` is a fixed param name the index
// hard-codes for every preview, so this reads/writes `state` (not a
// bespoke `hero` key) to stay wired to that index.
function Switcher({ state, mode }: { state: HeroState; mode: Mode }) {
  const href = (s: HeroState, m: Mode) => `?state=${s}&mode=${m}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition-colors active:scale-95";
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl">
      <Link href={href(state === "positive" ? "negative" : "positive", mode)} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {state === "positive" ? "Show short" : "Show left"}
      </Link>
      <Link href={href(state, mode === "dark" ? "light" : "dark")} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function G124Client() {
  const params = useSearchParams();
  const state: HeroState = params.get("state") === "negative" ? "negative" : "positive";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const scenario = state === "negative" ? HERO_NEGATIVE : HERO_POSITIVE;
  const runway = state === "negative" ? RUNWAY_NEGATIVE : RUNWAY_POSITIVE;
  const runwayStatus = runway < 0 ? "short" : runway > 0 ? "left" : "even";
  const bills = state === "positive" ? BILLS_POSITIVE : BILLS_NEGATIVE;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-32 dark:bg-[#0f172a]">
        <main className="mx-auto max-w-xl px-4 py-6">
          {/* G127 ask #2 — matches codex's PageHeader (UpcomingCanvasClient.tsx
              lines 84-98) exactly: no eyebrow, items-start (not
              items-center) alignment, gap-4 (not gap-3), and the h1's own
              size/weight/leading/tracking/ink below. The descriptive
              sentence stays: it is this preview's own live CONTENT, codex's
              header carries a different, data-driven line there instead. */}
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">What will enter or leave, and whether every payment is covered.</p>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
              <EyeOff size={20} strokeWidth={1.75} className="text-slate-300 dark:text-slate-600" />
            </span>
          </div>

          <div className="space-y-4">
            <UpcomingHeroCard
              isCalendarMonth={scenario.isCalendarMonth}
              daysToPayday={scenario.daysToPayday}
              paydayLabel={scenario.paydayLabel}
              spendableNow={scenario.spendableNow}
              runwayIncomeTotal={scenario.runwayIncomeTotal}
              runwayBillsTotal={scenario.runwayBillsTotal}
              allocationsRemainingTotal={scenario.allocationsRemainingTotal}
              savingsNow={scenario.savingsNow}
              runway={runway}
              runwayStatus={runwayStatus}
              genuineShortfalls={scenario.genuineShortfalls}
              timingShortfalls={scenario.timingShortfalls}
              formatDate={formatDate}
              // No live row to jump to in a static preview — production
              // wires this to PlanningPage.tsx's own highlight-and-scroll
              // behaviour (see UpcomingHeroCard's own prop doc).
              onReview={() => {}}
            />

            <section aria-labelledby="set-aside-heading">
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3 px-1">
                <h2 id="set-aside-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Set aside this period</h2>
                <span className="min-h-11 rounded-lg px-2 py-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">+ Add</span>
              </div>
              {/* No live edit sheet in a static preview — production wires
                  this to PlanningPage.tsx's own AllocationSheet. */}
              <SetAsideList items={ALLOCATIONS} onEdit={() => {}} />
              <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">Only the amount still to reserve reduces the forecast above.</p>
            </section>

            <section aria-labelledby="upcoming-ledger-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <h2 id="upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">&ldquo;After&rdquo; is your projected cash</p>
              </div>
              <DayGroups items={bills} paydayLabel={scenario.paydayLabel} />
            </section>
          </div>
        </main>
        <Switcher state={state} mode={mode} />
      </div>
    </div>
  );
}
