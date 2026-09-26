"use client";

// TEMPORARY PREVIEW. G168 — Kevin 2026-09-26 06:12: the month-closed
// ("needle") card has no dismiss on Home and is absent from the Penny hub.
// Three coded variants, skill: impeccable. Fixture data only, no API calls;
// no production component is changed by this round (the needle card is
// inline markup in components/HomeBrief.tsx's BriefBody, ~2102-2117, not an
// exported component — every variant below hand-authors that markup rather
// than forking a component that doesn't exist to import).
//
// /design/month-closed-card?variant=a|b|c&surface=home|penny&state=default|minimised&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

type Variant = "a" | "b" | "c";
type Surface = "home" | "penny";
type PreviewState = "default" | "minimised";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string }[] = [
  { key: "a", label: "A · Chip & chevron" },
  { key: "b", label: "B · Row-first" },
  { key: "c", label: "C · Verdict row" },
];

const SURFACES: { key: Surface; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "penny", label: "Penny" },
];

const STATES: { key: PreviewState; label: string; disabled?: (v: Variant, s: Surface) => boolean }[] = [
  { key: "default", label: "Default" },
  {
    key: "minimised",
    label: "Minimised",
    // Home never minimises (dismiss-only, per the brief); the toggle is
    // inert there rather than pretending it does something.
    disabled: (_v, s) => s === "home",
  },
];

function hrefFor(variant: Variant, surface: Surface, state: PreviewState, mode: Mode) {
  const effectiveState = surface === "home" ? "default" : state;
  return `?variant=${variant}&surface=${surface}&state=${effectiveState}&mode=${mode}`;
}

function PreviewControls({ variant, surface, state, mode }: { variant: Variant; surface: Surface; state: PreviewState; mode: Mode }) {
  const linkClass =
    "touch-manipulation [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none";

  return (
    <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          {VARIANTS.map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key, surface, state, mode)}
              aria-current={item.key === variant ? "page" : undefined}
              className={`grid min-h-11 place-items-center rounded-xl px-3 text-xs font-bold ${linkClass} ${item.key === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.label}
            </a>
          ))}
          <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
          <a
            href={hrefFor(variant, surface, state, mode === "dark" ? "light" : "dark")}
            className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 hover:text-white ${linkClass}`}
          >
            {mode === "dark" ? "Light" : "Dark"}
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 pt-1">
          {SURFACES.map((item) => (
            <a
              key={item.key}
              href={hrefFor(variant, item.key, state, mode)}
              aria-current={item.key === surface ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-xl px-2.5 text-[11px] font-semibold ${linkClass} ${item.key === surface ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.label}
            </a>
          ))}
          <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />
          {STATES.map((item) => {
            const isDisabled = item.disabled?.(variant, surface) ?? false;
            return (
              <a
                key={item.key}
                href={isDisabled ? undefined : hrefFor(variant, surface, item.key, mode)}
                aria-current={item.key === state && !isDisabled ? "page" : undefined}
                aria-disabled={isDisabled}
                className={`flex min-h-11 items-center rounded-xl px-2.5 text-[11px] font-semibold ${linkClass} ${
                  isDisabled
                    ? "pointer-events-none text-slate-600"
                    : item.key === state
                      ? "bg-white/15 text-white"
                      : "text-slate-300 hover:text-white"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export default function MonthClosedCardClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawSurface = params.get("surface");
  const surface: Surface = rawSurface === "penny" ? "penny" : "home";
  const rawState = params.get("state");
  const state: PreviewState = surface === "home" ? "default" : rawState === "minimised" ? "minimised" : "default";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div data-g168-preview-root data-variant={variant} data-surface={surface} data-state={state} className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g168-preview"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to month-closed card previews
      </a>
      <main id="g168-preview" tabIndex={-1} className="min-h-dvh scroll-pb-40 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7 sm:px-6 sm:pt-10">
          <header>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {surface === "home" ? "Home" : "Penny"} · {state === "default" ? "default" : "minimised"}
            </p>
            <h1 className="mt-1 text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">
              G168: a real dismiss, and a real home on Penny
            </h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              Today the month-closed card has no dismiss on Home, and it competes for a slot on Penny like any other
              narration card rather than living somewhere permanent. Every variant below gives Home the standard glass
              × (dismiss, keyed <code>needle:&lt;period_end&gt;</code>) and gives Penny a chevron-up Minimise instead,
              mirroring the payday plan&rsquo;s own owner rule: minimise-only, never dismiss, for as long as the card
              exists (two days after a period closes).
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. No bank data or preferences are changed.</p>
            {variant === "c" && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                The figure here is illustrative; the month-closed item carries no figures today, so picking C also
                commits a backend change.
              </p>
            )}
          </header>
          <div className="mt-7 sm:mt-9">
            {variant === "a" && <VariantA surface={surface} state={state} />}
            {variant === "b" && <VariantB surface={surface} state={state} />}
            {variant === "c" && <VariantC surface={surface} state={state} />}
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewControls variant={variant} surface={surface} state={state} mode={mode} />
      </div>
    </div>
  );
}
