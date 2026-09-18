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
// FIXTURE-ONLY, disclosed prominently (see fixtures.ts's own header and the
// G124 report): PlanningPage.tsx's hero figure, risk flags and day-group
// walk are all computed inline inside one large authenticated page
// component with no importable boundary at the right granularity, so this
// preview hand-authors markup against representative fixtures rather than
// rendering PlanningPage.tsx. It does not prove PlanningPage.tsx's live
// behaviour; it proposes what the three requested pieces should look like.
import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EyeOff } from "lucide-react";
import HeroCard from "./HeroCard";
import DayGroups from "./DayGroups";
import { SetAsideA, SetAsideB, SetAsideC } from "./setAsideVariants";
import {
  ALLOCATIONS, HERO_POSITIVE, HERO_NEGATIVE,
  RUNWAY_POSITIVE, RUNWAY_NEGATIVE,
  BILLS_POSITIVE, BILLS_NEGATIVE,
} from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type HeroState = "positive" | "negative";
// G127 ask #3 — the three switchable answers to "when does a relative
// marker appear on the canvas". See DayGroups.tsx's own doctrine comment
// for what each one does and why.
type IntervalRule = "gap" | "rhythm" | "cluster";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "a", label: "A · Tightened" },
  { value: "b", label: "B · Chip" },
  { value: "c", label: "C · Disclosure" },
];

const INTERVAL_RULES: { value: IntervalRule; label: string }[] = [
  { value: "gap", label: "At a gap" },
  { value: "rhythm", label: "At a rhythm" },
  { value: "cluster", label: "At a cluster" },
];

// The index page (app/design/page.tsx, PreviewCard) always links here as
// `?mode=dark&state=<value>&variant=<value>` — `state` is a fixed param
// name the index hard-codes for every preview, so this reads/writes
// `state` (not a bespoke `hero` key) to stay wired to that index. `interval`
// is this round's own addition, appended the same way as `variant`/`mode`.
function Switcher({ variant, state, mode, interval }: { variant: Variant; state: HeroState; mode: Mode; interval: IntervalRule }) {
  const href = (v: Variant, s: HeroState, m: Mode, i: IntervalRule) => `?variant=${v}&state=${s}&mode=${m}&interval=${i}`;
  const base = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition-colors active:scale-95";
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 bottom-3 z-50 mx-auto flex max-w-[calc(100vw-16px)] flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-slate-900/95 p-1.5 shadow-xl">
      {VARIANTS.map((v) => (
        <Link key={v.value} href={href(v.value, state, mode, interval)} className={`${base} ${v.value === variant ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}>
          {v.label}
        </Link>
      ))}
      <span className="mx-0.5 my-1 w-px shrink-0 bg-white/15" aria-hidden="true" />
      {INTERVAL_RULES.map((r) => (
        <Link key={r.value} href={href(variant, state, mode, r.value)} aria-current={r.value === interval ? "true" : undefined} className={`${base} ${r.value === interval ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"}`}>
          {r.label}
        </Link>
      ))}
      <span className="mx-0.5 my-1 w-px shrink-0 bg-white/15" aria-hidden="true" />
      <Link href={href(variant, state === "positive" ? "negative" : "positive", mode, interval)} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {state === "positive" ? "Show short" : "Show left"}
      </Link>
      <Link href={href(variant, state, mode === "dark" ? "light" : "dark", interval)} className={`${base} text-slate-200 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function G124Client() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as string[]).includes(params.get("variant") ?? "") ? (params.get("variant") as Variant) : "a";
  const state: HeroState = params.get("state") === "negative" ? "negative" : "positive";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  // Default "cluster" — closest to Kevin's own framing ("ideally when you
  // have a clutter of payments"); all three stay one tap apart to compare.
  const interval: IntervalRule = (["gap", "rhythm", "cluster"] as string[]).includes(params.get("interval") ?? "") ? (params.get("interval") as IntervalRule) : "cluster";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
  }, [mode]);

  const scenario = state === "negative" ? HERO_NEGATIVE : HERO_POSITIVE;
  const runway = state === "negative" ? RUNWAY_NEGATIVE : RUNWAY_POSITIVE;
  const bills = state === "positive" ? BILLS_POSITIVE : BILLS_NEGATIVE;
  const SetAsideComponent = variant === "a" ? SetAsideA : variant === "b" ? SetAsideB : SetAsideC;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-56 dark:bg-[#0f172a]">
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
            <HeroCard scenario={scenario} runway={runway} />

            <section aria-labelledby="set-aside-heading">
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3 px-1">
                <h2 id="set-aside-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Set aside this period</h2>
                <span className="min-h-11 rounded-lg px-2 py-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">+ Add</span>
              </div>
              <SetAsideComponent allocations={ALLOCATIONS} />
              <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">Only the amount still to reserve reduces the forecast above.</p>
            </section>

            <section aria-labelledby="upcoming-ledger-heading" className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <h2 id="upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">&ldquo;After&rdquo; is your projected cash</p>
              </div>
              <DayGroups items={bills} paydayLabel={scenario.paydayLabel} intervalRule={interval} />
            </section>
          </div>
        </main>
        <Switcher variant={variant} state={state} mode={mode} interval={interval} />
      </div>
    </div>
  );
}
