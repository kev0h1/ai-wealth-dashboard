"use client";

// G168 — month-closed ("needle") card. Kevin picked variant A, "Chip and
// chevron" (2026-09-26): Home keeps the card as-is plus the standard glass
// dismiss chip; Penny shows the same card in its permanent section with a
// chevron-up Minimise that collapses to a one-line row, never a dismiss.
// The pick is implemented — see components/MonthClosedCard.tsx (HomeBrief.tsx's
// BriefBody and app/penny/PennyPage.tsx both render it now) — so this preview
// renders the PRODUCTION component directly against fixture data, not a
// standalone reimplementation: three states (home with its dismiss chip,
// penny expanded with its chevron, penny collapsed to the one-line row),
// light and dark. Fixture data only, no API calls — the dismiss/minimise
// callbacks here are local to the preview and never reach the server.
//
// /design/month-closed-card?state=home|penny|penny-minimised&mode=light|dark

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import MonthClosedCard from "@/components/MonthClosedCard";
import { NEEDLE_ITEM } from "./shared";

type PreviewState = "home" | "penny" | "penny-minimised";
type Mode = "light" | "dark";

const STATES: { key: PreviewState; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "penny", label: "Penny" },
  { key: "penny-minimised", label: "Penny · minimised" },
];

// MonthClosedCard reads its Penny minimise preference from localStorage
// (keyed by the item's own id, see components/MonthClosedCard.tsx). This
// preview forces that stored value to match the state on every render so
// switching between "penny" and "penny-minimised" via the nav below always
// shows the state the URL asks for, never a stale leftover from a previous
// visit — the write happens synchronously before MonthClosedCard's own
// first render below reads it back, and the `key` prop forces a fresh mount
// so its internal `expanded` state is re-derived every time.
const MINIMISED_STORAGE_KEY = "wd_month_closed_minimised";

function primeMinimiseFixture(state: PreviewState) {
  if (typeof window === "undefined") return;
  try {
    if (state === "penny-minimised") {
      window.localStorage.setItem(MINIMISED_STORAGE_KEY, NEEDLE_ITEM.id);
    } else {
      window.localStorage.removeItem(MINIMISED_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable — the preview still renders, just without the
    // forced state on that reload.
  }
}

function PreviewNav({ state, mode }: { state: PreviewState; mode: Mode }) {
  const linkClass =
    "flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold touch-manipulation [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none";

  return (
    <nav
      aria-label="Design preview controls"
      className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-center gap-1">
        {STATES.map((item) => (
          <a
            key={item.key}
            href={`?state=${item.key}&mode=${mode}`}
            aria-current={item.key === state ? "page" : undefined}
            className={`${linkClass} ${item.key === state ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
          >
            {item.label}
          </a>
        ))}
        <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
        <a href={`?state=${state}&mode=${mode === "dark" ? "light" : "dark"}`} className={`${linkClass} text-slate-300 hover:text-white`}>
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function MonthClosedCardClient() {
  const params = useSearchParams();
  const router = useRouter();
  const rawState = params.get("state");
  const state: PreviewState = rawState === "penny" || rawState === "penny-minimised" ? rawState : "home";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  primeMinimiseFixture(state);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const surface = state === "home" ? "home" : "penny";

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g168-preview"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to month-closed card preview
      </a>
      <main id="g168-preview" tabIndex={-1} className="min-h-dvh scroll-pb-40 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7 sm:px-6 sm:pt-10">
          <header>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              G168 · variant A folded in 2026-09-26
            </p>
            <h1 className="mt-1 text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">
              Month-closed card
            </h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              Renders the production <code>MonthClosedCard</code> (components/MonthClosedCard.tsx) with real
              props against fixture data. Home shows it with the standard glass dismiss chip; Penny shows it
              permanently with a chevron-up Minimise instead, which collapses it to a one-line row. Fixture data
              only, no API calls. The dismiss and minimise controls below are wired to no-ops on Home and to
              MonthClosedCard&rsquo;s own localStorage-backed collapse on Penny, never a server call.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. No bank data or preferences are changed.</p>
          </header>
          <div className="mt-7 sm:mt-9">
            <MonthClosedCard
              key={state}
              item={NEEDLE_ITEM}
              router={router}
              surface={surface}
              onDismiss={surface === "home" ? () => {} : undefined}
            />
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewNav state={state} mode={mode} />
      </div>
    </div>
  );
}
