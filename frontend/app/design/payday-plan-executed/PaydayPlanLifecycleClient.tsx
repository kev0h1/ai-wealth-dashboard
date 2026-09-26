"use client";

// G164 (2026-09-26, Kevin) — payday plan LIFECYCLE preview. Supersedes the
// earlier "executed/already-split" round built on this same route (kept for
// the UAT link): Kevin's decision was that the payday plan is purely
// advisory — a forward-looking suggestion for the period that starts on
// payday, an alternative to fixed standing orders — and once the pay lands
// there is nothing left to validate, so there is NO executed/"already split"
// state on either surface. This preview instead renders the PRODUCTION
// `PaydayPlanSection` (and, for one state, `PaydayPlanCard` directly) with
// fixture data through their real props across the six states the decision
// actually describes:
//
//   home-t5        Home, five days before payday: the dismissible entry row.
//   home-live      Home, a live plan: the full dismissible plan card.
//   home-paid      Home, after the pay has landed: renders NOTHING — this
//                  state shows that honestly rather than faking a card.
//   penny-entry    Penny, mid-period: the always-visible entry row (no gate).
//   penny-expanded The expanded plan card on Penny, minimise chevron only,
//                  never an X. PaydayPlanSection's own toggle fetches
//                  `/today?payday_preview=1` live, which this unauthenticated
//                  static preview can't do — so this ONE state renders
//                  `PaydayPlanCard` directly with a fixture preview item and
//                  a no-op `onClose`, standing in for that fetch's result.
//   penny-next     Penny, the moment after a payday: the entry row's own
//                  subline already names the NEXT payday.
//
// Fixture data only, no API calls; the production components are read but
// unmodified by this round. See fixtures.ts for what each SafeToSpend/
// CompanionItem fixture stands in for.
//
// /design/payday-plan-executed?state=home-t5|home-live|home-paid|penny-entry|penny-expanded|penny-next&mode=light|dark

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PaydayPlanSection } from "@/components/HomeBrief";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import {
  LIVE_PLAN_ITEM,
  PREVIEW_PLAN_ITEM,
  STS_LIVE,
  STS_MID_PERIOD,
  STS_NEXT_PAYDAY,
  STS_PAID,
  STS_T5,
} from "./fixtures";

type PreviewState = "home-t5" | "home-live" | "home-paid" | "penny-entry" | "penny-expanded" | "penny-next";
type Mode = "light" | "dark";

const STATES: { key: PreviewState; label: string; surface: "Home" | "Penny" }[] = [
  { key: "home-t5", label: "Home · T-5 entry", surface: "Home" },
  { key: "home-live", label: "Home · live plan", surface: "Home" },
  { key: "home-paid", label: "Home · after payday", surface: "Home" },
  { key: "penny-entry", label: "Penny · entry (mid-period)", surface: "Penny" },
  { key: "penny-expanded", label: "Penny · expanded", surface: "Penny" },
  { key: "penny-next", label: "Penny · after payday", surface: "Penny" },
];

const STATE_KEYS = STATES.map((s) => s.key);

function isPreviewState(v: string | null): v is PreviewState {
  return !!v && (STATE_KEYS as string[]).includes(v);
}

function hrefFor(state: PreviewState, mode: Mode) {
  return `?state=${state}&mode=${mode}`;
}

function PreviewControls({ state, mode }: { state: PreviewState; mode: Mode }) {
  const linkClass =
    "touch-manipulation [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none";

  return (
    <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-center gap-1">
          {STATES.map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key, mode)}
              aria-current={item.key === state ? "page" : undefined}
              className={`grid min-h-11 place-items-center rounded-xl px-2.5 text-[11px] font-bold ${linkClass} ${item.key === state ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex items-center justify-center border-t border-white/10 pt-1">
          <a
            href={hrefFor(state, mode === "dark" ? "light" : "dark")}
            className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 hover:text-white ${linkClass}`}
          >
            {mode === "dark" ? "Light" : "Dark"}
          </a>
        </div>
      </div>
    </nav>
  );
}

const STATE_COPY: Record<PreviewState, { title: string; body: string }> = {
  "home-t5": {
    title: "Home, five days before payday",
    body:
      "The entry row opens at T-5 (lib/paydayWindow.ts) and can be dismissed for this window via the glass-chip control on the row itself. No live plan exists yet, so PaydayPlanSection renders only this teaser.",
  },
  "home-live": {
    title: "Home, a live plan",
    body:
      "Once the engine has a live payday_plan item, Home shows the full card, still dismissible (the × in the top right, aria-label \"Dismiss\"). This is the whole-component dismiss, distinct from Penny's minimise.",
  },
  "home-paid": {
    title: "Home, after the pay has landed",
    body:
      "The payday plan is purely advisory, so once the period's salary is observed there is nothing left to validate or report. PaydayPlanSection mounts and renders null: the dashed box below is empty on purpose, not a loading or error state.",
  },
  "penny-entry": {
    title: "Penny, any day mid-period",
    body:
      "Penny is the plan's permanent home: PaydayPlanSection renders here with no `gate`, so the entry row shows every day of the month, not just in the run-up to payday.",
  },
  "penny-expanded": {
    title: "Penny, the plan expanded",
    body:
      "Tapping the entry row on Penny fetches the live preview and expands PaydayPlanCard in place with a chevron-up \"Minimise\" control, never an X. Penny's plan can be minimised, never dismissed. That fetch can't run in this static, unauthenticated preview, so this state renders PaydayPlanCard directly with a fixture preview item standing in for the fetch's result.",
  },
  "penny-next": {
    title: "Penny, right after a payday",
    body:
      "The moment the period's salary is observed, the entry row's subline already names the NEXT payday (it reads straight off safeToSpend.next_payday). The plan has rolled forward with nothing further to do.",
  },
};

export default function PaydayPlanLifecycleClient() {
  const params = useSearchParams();
  const router = useRouter();
  const rawState = params.get("state");
  const state: PreviewState = isPreviewState(rawState) ? rawState : "home-t5";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const copy = STATE_COPY[state];
  const surface = STATES.find((s) => s.key === state)?.surface ?? "Home";

  function renderState() {
    switch (state) {
      case "home-t5":
        return <PaydayPlanSection items={[]} safeToSpend={STS_T5} gate hasAccounts={true} />;
      case "home-live":
        return <PaydayPlanSection items={[LIVE_PLAN_ITEM]} safeToSpend={STS_LIVE} gate hasAccounts={true} />;
      case "home-paid":
        return (
          <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
            <PaydayPlanSection items={[]} safeToSpend={STS_PAID} gate hasAccounts={true} />
            Nothing renders here. That is the correct, deliberate result.
          </div>
        );
      case "penny-entry":
        return <PaydayPlanSection items={[]} safeToSpend={STS_MID_PERIOD} />;
      case "penny-expanded":
        return (
          <PaydayPlanCard
            item={PREVIEW_PLAN_ITEM}
            router={router}
            hideNetWorth={false}
            maskAmounts={(t) => t}
            onClose={() => {}}
          />
        );
      case "penny-next":
        return <PaydayPlanSection items={[]} safeToSpend={STS_NEXT_PAYDAY} />;
      default:
        return null;
    }
  }

  return (
    <div data-g164-preview-root data-state={state} className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g164-preview"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to payday plan lifecycle preview
      </a>
      <main id="g164-preview" tabIndex={-1} className="min-h-dvh scroll-pb-40 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7 sm:px-6 sm:pt-10">
          <header>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {surface} · {state}
            </p>
            <h1 className="mt-1 text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">
              {copy.title}
            </h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.body}</p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. No bank data or preferences are changed.</p>
          </header>
          <div className="mt-7 sm:mt-9">{renderState()}</div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewControls state={state} mode={mode} />
      </div>
    </div>
  );
}
