"use client";

// G88 real-data render (companion round to g88-home-canvas, which stays
// untouched as the record of what was already reviewed). Same three
// layout shells (A Reading line / B Today board / C Rhythm), but every
// figure and card here is Kevin's own, not invented fixture copy — see
// realFixtures.ts for the single module holding every real value and why.
//
// The hero is the REAL production SafeToSpendCard (components/SafeToSpendCard.tsx),
// fed Kevin's real payload through its actual `data` prop — it takes data
// as a prop rather than fetching it internally, so no fetch/fixture-fork was
// needed to close the "hand-authored hero markup" gap the earlier round left
// open. hideNetWorth/preferencesReady come from the real PreferencesContext
// (already the pattern used by app/design/v1, v2 and v3), toggled from this
// page's own `state` axis so the "balances hidden" variation is genuine,
// not a second hand-rolled masking path.
//
// The supporting cards are the real exported MoveCard / CelebrationCard /
// CliffCard from components/HomeBrief.tsx (CliffCard is also what renders
// `type: "trajectory"`, see its own doc comment), fed Kevin's three real
// CompanionItem objects.
//
// The "This pay period: IN/OUT/MOVED" strip from g88-home-canvas is REMOVED
// here rather than carried over: those three figures come from the Spend
// verdict endpoint, which was not part of the Home dump this preview is
// scoped to (/tmp/g88_real.json has safe_to_spend + today_items only), so
// there is no real number to put in their place. Showing the old fixture
// numbers next to Kevin's real ones would read as his real data even though
// it is not, which is exactly what this round exists to avoid.
//
// KNOWN CROSS-CUTTING BUG found by this round, worked around HERE only:
// globals.css has `html.nav-exempt aside { display: none; }`, written to
// hide Sidebar.tsx's own <aside> rail on nav-exempt routes (every /design
// page, including this one — see lib/navExemptRoutes.ts). Because the
// selector is a bare tag match rather than scoped to Sidebar's own aside,
// it ALSO hides SafeToSpendCard's unrelated `<aside aria-label="Card
// balance activity">` (his +£1,007 card-spend callout) the moment that
// real component is embedded in a nav-exempt preview — which is exactly
// what this round does for the first time. Kevin's real card_growth_total
// (£1,089.67, £1,006.64 of it new spend) would otherwise silently vanish
// from this preview even though the production page renders it. Fixing
// the shared rule is out of scope for a /design-only round (it is a
// production CSS file), so this is un-hidden narrowly, for this preview
// only, by re-asserting display on that one aria-label. Flagging for a
// real fix: narrow globals.css's selector to Sidebar's own aside (e.g.
// `#app-shell > aside` or a dedicated class) so no future production
// component that happens to use a semantic <aside> loses content the
// same way on any nav-exempt route.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { MoveCard, CelebrationCard, CliffCard } from "@/components/HomeBrief";
import { usePreferences } from "@/components/PreferencesContext";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { REAL_SAFE_TO_SPEND, REAL_MOVE_ITEM, REAL_CELEBRATION_ITEM, REAL_TRAJECTORY_ITEM, REAL_DATA_DATE_LABEL } from "./realFixtures";

type Variant = "a" | "b" | "c";
type State = "tight" | "hidden";
type Mode = "light" | "dark";

const variants: Record<Variant, { name: string; summary: string }> = {
  a: { name: "Reading line", summary: "One chronological reading, where a card appears only when it needs a response." },
  b: { name: "Today board", summary: "A practical board that gives each live decision a clear, reachable place." },
  c: { name: "Rhythm", summary: "A pay-period rhythm that separates what is now from what is watched." },
};

const states: { key: State; label: string }[] = [
  { key: "tight", label: "Kevin's real state (Tight)" },
  { key: "hidden", label: "Balances hidden" },
];

const noopDismiss = () => {};
const identityMask = (text: string) => text;
const hideAmounts = (text: string) => text.replace(/(?:−|-)?£[\d,.]+/g, "£••••");

function PreviewControls({
  variant,
  state,
  mode,
  query,
}: {
  variant: Variant;
  state: State;
  mode: Mode;
  query: (next: Partial<{ variant: Variant; state: State; mode: Mode }>) => string;
}) {
  return (
    <nav aria-label="G88 real-data preview controls" className="border-b border-white/10 bg-slate-950 px-3 py-2 text-white lg:ml-64">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-1.5">
        <div className="flex shrink-0 gap-1">
          {(["a", "b", "c"] as Variant[]).map((key) => (
            <a
              key={key}
              href={query({ variant: key })}
              aria-label={`Variant ${key.toUpperCase()}: ${variants[key].name}`}
              aria-current={key === variant ? "page" : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${key === variant ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
            >
              {key.toUpperCase()}
            </a>
          ))}
        </div>
        <label className="flex min-h-11 min-w-0 items-center rounded-xl bg-white/10 px-2 text-xs text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400">
          <span className="sr-only">Preview Home state</span>
          <select
            value={state}
            onChange={(event) => window.location.assign(query({ state: event.target.value as State }))}
            className="max-w-[168px] cursor-pointer bg-slate-800 pr-1 font-semibold text-white outline-none"
          >
            {states.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <a
          href={query({ mode: mode === "dark" ? "light" : "dark" })}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 hover:bg-white/10"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function G88HomeRealClient() {
  const params = useSearchParams();
  const router = useRouter();
  const { setHideNetWorth, preferencesReady } = usePreferences();

  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: State = rawState === "hidden" ? "hidden" : "tight";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const hidden = state === "hidden";
  const maskAmounts = hidden ? hideAmounts : identityMask;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  // Drives the REAL PreferencesContext hideNetWorth flag so SafeToSpendCard's
  // own masking logic runs for real, rather than a second hand-rolled mask
  // living only in this preview. Same pattern app/design/v1, v2 and v3 use
  // for their own hide-balances toggle.
  useEffect(() => {
    if (preferencesReady) setHideNetWorth(hidden);
  }, [hidden, preferencesReady, setHideNetWorth]);

  const query = (next: Partial<{ variant: Variant; state: State; mode: Mode }>) =>
    `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? mode}`;

  const hero = <SafeToSpendCard data={REAL_SAFE_TO_SPEND} loading={false} error={false} />;

  const cardCommon = { maskAmounts, dismissible: true, onHomeDismiss: noopDismiss };
  const cards = (
    <section aria-labelledby="brief-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-slate-500 dark:text-slate-400">Today&apos;s brief</p>
          <h2 id="brief-heading" className="mt-1 text-base font-bold text-slate-950 dark:text-white">
            What Penny is watching
          </h2>
        </div>
        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">3 cards</span>
      </div>
      <div className={variant === "b" ? "grid gap-3 lg:grid-cols-2" : "space-y-3"}>
        <MoveCard item={REAL_MOVE_ITEM} hideNetWorth={hidden} previewMode {...cardCommon} />
        <CelebrationCard item={REAL_CELEBRATION_ITEM} router={router} {...cardCommon} />
        <CliffCard item={REAL_TRAJECTORY_ITEM} {...cardCommon} />
      </div>
    </section>
  );

  const layout =
    variant === "b" ? (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
        <div className="space-y-8">{hero}</div>
        <div className="space-y-8 lg:border-l lg:border-slate-200 lg:pl-8 dark:lg:border-slate-700">{cards}</div>
      </div>
    ) : variant === "c" ? (
      <div className="mx-auto max-w-2xl space-y-8">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          {REAL_DATA_DATE_LABEL} · {REAL_SAFE_TO_SPEND.days_until_payday} days until payday
        </p>
        {hero}
        <div className="border-l-2 border-slate-200 pl-5 dark:border-slate-700">{cards}</div>
      </div>
    ) : (
      <div className="mx-auto max-w-2xl space-y-8">
        {hero}
        {cards}
      </div>
    );

  return (
    <div
      className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 dark:bg-[#0f172a] dark:text-slate-100`}
      style={{ colorScheme: mode }}
    >
      {/* See this file's header comment: globals.css's `html.nav-exempt
          aside { display: none }` (meant only for Sidebar.tsx's own rail)
          also catches SafeToSpendCard's unrelated card-balance <aside>.
          Narrow, preview-local override rather than touching the shared
          production stylesheet. */}
      <style>{`html.nav-exempt aside[aria-label="Card balance activity"] { display: block !important; }`}</style>
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-slate-950 focus:px-4 focus:py-3 focus:text-white">
        Skip to preview
      </a>
      <PreviewControls variant={variant} state={state} mode={mode} query={query} />
      <main id="content" className="mx-auto max-w-6xl px-4 pb-40 pt-6 sm:px-6 sm:pt-10 lg:pb-16">
        <header className="mb-8">
          <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
            <ArrowLeft size={16} aria-hidden="true" />
            Design rounds
          </a>
          <h1 className="mt-4 text-balance text-[30px] font-bold tracking-[-.04em] text-slate-950 dark:text-white">Home, on the canvas: Kevin&apos;s real numbers</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-slate-600 dark:text-slate-400">
            {variants[variant].summary} The hero and every card below are the real production components, rendered with Kevin&apos;s real Safe to Spend payload and today&apos;s brief items from {REAL_DATA_DATE_LABEL}, not invented figures.
          </p>
        </header>
        {layout}
      </main>
      <FixtureBottomNav active="Home" />
    </div>
  );
}
