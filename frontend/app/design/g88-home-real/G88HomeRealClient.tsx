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
// open.
//
// G88 rejection fix (defect 1, 2026-09-19): SafeToSpendCard computes its own
// mask as `hideNetWorth || !preferencesReady`, both read from the real
// PreferencesContext (components/PreferencesContext.tsx). The preferred fix
// checked first was rendering this subtree inside that Context's own
// Provider, supplying hideNetWorth/preferencesReady derived straight from
// the `state` param — but PreferencesContext.tsx exports only the
// PreferencesProvider component (which manages its own state internally and
// takes no override props) and the usePreferences() hook, never the
// underlying Context object, so there is nothing to feed a value through
// from outside that module without editing it, which is out of scope here.
//
// The actual defect: this preview calls the real setHideNetWorth() to drive
// the real context (below), which optimistically applies the value, then
// PATCHes /preferences to persist it. For a signed-out visitor that PATCH
// 401s; PreferencesContext's own failure handling then refetches
// /preferences to reconcile, which also 401s for a signed-out visitor, and
// with no server truth to fall back to, reverts to `previous` — which for a
// fresh visitor is `true` (hidden). That is why `state=tight` and
// `state=hidden` used to render identically: both settled back to hidden
// once that round trip finished.
//
// PreferencesProvider wraps the ENTIRE app (app/Providers.tsx), so its own
// mount effect fires its first real GET /preferences long before this route's
// own JS chunk has even loaded — this page's content sits behind
// `<Suspense>` (useSearchParams requires it), so it hydrates in a separate,
// later commit than the app shell. A read-side fix that only answers that
// very first GET is consequently too late; there is no way to win that race
// from inside this component. What CAN be won from in here is the WRITE this
// component itself is about to make: a fetch stand-in, installed in a
// layout effect (so it is active before this component's own later passive
// effects, including the setHideNetWorth one below, can fire — React always
// commits a subtree's layout effects before its passive effects) and scoped
// to exactly this component's mounted lifetime, intercepts only requests to
// /preferences and answers every one — read or write — with
// `hide_net_worth` equal to whatever `state` currently asks for. That makes
// the setHideNetWorth() write below always succeed, so its optimistic apply
// never gets reverted, regardless of whether a real session exists. Restored
// on unmount so no other page ever sees a patched fetch; every unrelated
// request passes straight through to the real network unmodified.
// PreferencesContext.tsx and SafeToSpendCard.tsx run their own real,
// unforked code throughout — this is a network-layer stand-in for the
// missing session, not a DOM nudge and not a stored preference.
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
import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { MoveCard, CelebrationCard, CliffCard } from "@/components/HomeBrief";
import { usePreferences } from "@/components/PreferencesContext";
import FixtureBottomNav from "../_components/FixtureBottomNav";

// SSR renders this client component on the server too, where
// useLayoutEffect is a no-op and React warns about it; useEffect there
// instead is silent and irrelevant, since the fetch stand-in below only
// ever needs to exist in the browser.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
import { REAL_SAFE_TO_SPEND, REAL_MOVE_ITEM, REAL_CELEBRATION_ITEM, REAL_TRAJECTORY_ITEM, REAL_DATA_DATE_LABEL } from "./realFixtures";

type Variant = "a" | "b" | "c";
type State = "tight" | "hidden";
type Mode = "light" | "dark";

const variants: Record<Variant, { name: string; summary: string }> = {
  a: { name: "Reading line", summary: "One chronological reading, where a card appears only when it needs a response." },
  b: { name: "Today board", summary: "A practical board that gives each live decision a clear, reachable place." },
  c: { name: "Rhythm", summary: "A pay-period rhythm that separates what is now from what is watched." },
};

// Short enough that the control bar's three groups (variant / state / mode)
// fit on one row at 390px without wrapping (see PreviewControls below) —
// the full "Kevin's real state (Tight)" phrasing lives on the /design
// index card instead, where there is room for it.
const states: { key: State; label: string }[] = [
  { key: "tight", label: "Real: Tight" },
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
    // Deliberately tight: three groups (variant / state / mode) must sit on
    // one row at 390px, the width Kevin actually reviews at (a wrapped
    // "Light"/"Dark" onto its own line here read as broken, not deliberate
    // — flagged and fixed). Touch targets stay at the 44px min-h/min-w
    // DESIGN.md requires; only horizontal padding and gaps were trimmed,
    // and the state label was shortened (full wording lives on the
    // /design index card, which has room for it).
    <nav aria-label="G88 real-data preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-2 text-white lg:ml-64">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-1">
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
        <label className="flex min-h-11 min-w-0 items-center rounded-xl bg-white/10 px-1.5 text-xs text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400">
          <span className="sr-only">Preview Home state</span>
          <select
            value={state}
            onChange={(event) => window.location.assign(query({ state: event.target.value as State }))}
            className="max-w-[122px] cursor-pointer bg-slate-800 pr-1 text-[11px] font-semibold text-white outline-none"
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
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-2.5 text-xs font-semibold text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 hover:bg-white/10"
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

  // See this file's header comment (G88 rejection fix, defect 1). Installed
  // BEFORE the setHideNetWorth effect below via useIsomorphicLayoutEffect,
  // so that write's PATCH always lands on this stand-in, not the real
  // network, and always succeeds — no real session, no stored preference,
  // and no dependence on a write actually reaching a server.
  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const nativeFetch = window.fetch.bind(window);
    const isPreferencesRequest = (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return /\/preferences(?:[/?]|$)/.test(url);
    };
    let version = 0;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (!isPreferencesRequest(input)) return nativeFetch(input, init);
      version += 1;
      return new Response(JSON.stringify({ hide_net_worth: hidden, version }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof window.fetch;
    return () => {
      window.fetch = nativeFetch;
    };
  }, [hidden]);

  // Drives the REAL PreferencesContext hideNetWorth flag so SafeToSpendCard's
  // own masking logic runs for real, rather than a second hand-rolled mask
  // living only in this preview. The fetch stand-in installed just above
  // (same component, same commit, layout effect before passive effect) is
  // what makes this write land correctly for a signed-out visitor instead
  // of reverting — see this file's header comment.
  useEffect(() => {
    if (preferencesReady) setHideNetWorth(hidden);
  }, [hidden, preferencesReady, setHideNetWorth]);

  const query = (next: Partial<{ variant: Variant; state: State; mode: Mode }>) =>
    `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? mode}`;

  // Coordinator correction: at 1440px, variant B's left (hero) column ended
  // about a third of the way down once the This-pay-period strip was
  // removed, because the hero was the column's only content. Rather than
  // inventing anything to pad it, this opens SafeToSpendCard's own real
  // "How we got £X" disclosure by default IN THIS VARIANT ONLY — the exact
  // same cash-calculation ledger the card already renders on click,
  // already built entirely from Kevin's real payload, just not collapsed.
  // SafeToSpendCard has no defaultOpen prop, so this is a narrow,
  // preview-local DOM nudge (native <details>.open, the same end state a
  // click produces) rather than a fork of the component's own markup.
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant !== "b") return;
    heroRef.current?.querySelectorAll("details").forEach((node) => {
      node.open = true;
    });
  }, [variant, state, mode]);

  const hero = (
    <div ref={heroRef}>
      <SafeToSpendCard data={REAL_SAFE_TO_SPEND} loading={false} error={false} />
    </div>
  );

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
      {/* Coordinator correction: variant B previously forced these real,
          content-rich cards into an inner two-column grid, which at 1440px
          squeezed each card to roughly 220px wide — well below the width
          the same cards already handle cleanly at 390px mobile — and
          mangled their text (bank-icon collisions, three-line wraps, a
          six-line trajectory headline). These are the real production
          cards, not simple fixture tiles the original canvas round used
          two-up; they stay single-column at every width, and the outer
          column ratio below gives this rail more of the row instead. */}
      <div className="space-y-3">
        <MoveCard item={REAL_MOVE_ITEM} hideNetWorth={hidden} previewMode {...cardCommon} />
        <CelebrationCard item={REAL_CELEBRATION_ITEM} router={router} {...cardCommon} />
        <CliffCard item={REAL_TRAJECTORY_ITEM} {...cardCommon} />
      </div>
    </section>
  );

  const layout =
    variant === "b" ? (
      // Ratio flipped from the canvas round's 1fr/.8fr (hero-heavy) to
      // .9fr/1.1fr (cards-heavy): the cards column now carries the wider,
      // content-heavier real cards, and the hero column carries its own
      // expanded calculation (above) instead of the removed period strip.
      <div className="grid gap-8 lg:grid-cols-[minmax(320px,.9fr)_minmax(420px,1.1fr)]">
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
