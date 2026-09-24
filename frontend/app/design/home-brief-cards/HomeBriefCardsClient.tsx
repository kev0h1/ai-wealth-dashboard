"use client";

// TEMPORARY PREVIEW. G48 is a presentation-only design round for the eight
// Home brief cards. This route carries fixtures and local interactions only:
// it does not fetch, navigate, dismiss server items or write preferences.
//
// /design/home-brief-cards?variant=a|b|c&state=stack|family&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import TrajectoryStates from "./TrajectoryStates";

export type PreviewVariant = "a" | "b" | "c";
// G103 added "trajectory": the four debt-trajectory states (plus the card as
// it read before the change), rendered through the production CliffCard. It
// is a state rather than a fourth variant because it is not a competing art
// direction, it is one card's content in every direction it can now take.
export type PreviewState = "stack" | "family" | "trajectory";
export type PreviewMode = "light" | "dark";

const VARIANTS: { key: PreviewVariant; short: string; label: string }[] = [
  { key: "a", short: "A", label: "Calm spine" },
  { key: "b", short: "B", label: "Action dock" },
  { key: "c", short: "C", label: "Folded brief" },
];

function hrefFor({
  variant,
  state,
  mode,
}: {
  variant: PreviewVariant;
  state: PreviewState;
  mode: PreviewMode;
}) {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function ReviewControls({
  variant,
  state,
  mode,
}: {
  variant: PreviewVariant;
  state: PreviewState;
  mode: PreviewMode;
}) {
  const inactive = "text-slate-300 [@media(hover:hover)]:hover:text-white";
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";

  return (
    <nav
      aria-label="Design preview controls"
      className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/92 p-1.5 shadow-xl"
    >
      <div className="flex items-center justify-center gap-1">
        {VARIANTS.map((item) => {
          // The Debt state has no variants, so a variant link leaving it
          // returns to that variant's Home stack rather than silently doing
          // nothing, and none of them claim to be the current page while it
          // is showing.
          const active = item.key === variant && state !== "trajectory";
          return (
            <a
              key={item.key}
              href={hrefFor({ variant: item.key, state: state === "trajectory" ? "stack" : state, mode })}
              aria-current={active ? "page" : undefined}
              aria-label={`Variant ${item.short}: ${item.label}`}
              className={`flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-bold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 motion-reduce:transition-none active:scale-95 ${focus} ${
                active ? "bg-indigo-600 text-white" : inactive
              }`}
            >
              {item.short}
            </a>
          );
        })}
        <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
        <a
          href={hrefFor({ variant, state: state === "stack" ? "family" : "stack", mode })}
          aria-current={state === "family" ? "page" : undefined}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 motion-reduce:transition-none active:scale-95 ${focus} ${
            state === "family" ? "bg-indigo-600 text-white" : inactive
          }`}
        >
          {state === "family" ? "Home stack" : "All 8"}
        </a>
        <a
          href={hrefFor({ variant, state: state === "trajectory" ? "stack" : "trajectory", mode })}
          aria-current={state === "trajectory" ? "page" : undefined}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 motion-reduce:transition-none active:scale-95 ${focus} ${
            state === "trajectory" ? "bg-indigo-600 text-white" : inactive
          }`}
        >
          Debt
        </a>
        <a
          href={hrefFor({ variant, state, mode: mode === "dark" ? "light" : "dark" })}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 motion-reduce:transition-none active:scale-95 ${focus} ${inactive}`}
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function HomeBriefCardsClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: PreviewVariant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: PreviewState =
    rawState === "family" ? "family" : rawState === "trajectory" ? "trajectory" : "stack";
  const mode: PreviewMode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const selected = VARIANTS.find((item) => item.key === variant)!;

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g48-preview-content"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        Skip to card previews
      </a>
      <main id="g48-preview-content" tabIndex={-1} data-g48-preview className="min-h-dvh scroll-pb-36 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-6xl px-4 pb-36 pt-7 sm:px-6 sm:pt-10">
          <header className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white sm:text-2xl">
              Home brief card family
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              {state === "trajectory"
                ? "G103. The debt-trajectory card leads on movement over a stated window instead of the carried total, rendered here through the production card."
                : `${selected.label}. The same 8 behaviours, real scenario values and settled actions, with one shared reading grammar.`}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Preview only. No bank data or preferences are changed.
            </p>
          </header>

          <div className="mt-7 sm:mt-9">
            {state === "trajectory" ? (
              <TrajectoryStates />
            ) : (
              <>
                {variant === "a" && <VariantA state={state} />}
                {variant === "b" && <VariantB state={state} />}
                {variant === "c" && <VariantC state={state} />}
              </>
            )}
          </div>
        </div>
      </main>

      <div
        className="fixed inset-x-0 z-[70] flex justify-center px-3 pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <ReviewControls variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}
