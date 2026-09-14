"use client";

// TEMPORARY PREVIEW. G69 compares the same move grammar across one source,
// three or five sources, and three protected payments. Fixtures and interactions are
// local; this route performs no API requests and does not mutate production data.
//
// /design/move-card-grammar?variant=a|b|c&state=pair|single|multiple|many|payments|fallback&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { MOVE_SCENARIOS } from "./fixtures";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

type Variant = "a" | "b" | "c";
type State = "pair" | "single" | "multiple" | "many" | "payments" | "fallback";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string }[] = [
  { key: "a", label: "Money route" },
  { key: "b", label: "Transfer ledger" },
  { key: "c", label: "Compact handoff" },
];

const STATES: { key: State; label: string }[] = [
  { key: "pair", label: "Both" },
  { key: "single", label: "1 src" },
  { key: "multiple", label: "3 src" },
  { key: "many", label: "5 src" },
  { key: "payments", label: "3 bills" },
  { key: "fallback", label: "No src" },
];

function hrefFor(variant: Variant, state: State, mode: Mode) {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function PreviewControls({ variant, state, mode }: { variant: Variant; state: State; mode: Mode }) {
  return (
    <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          {VARIANTS.map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key, state, mode)}
              aria-current={item.key === variant ? "page" : undefined}
              aria-label={`Variant ${item.key.toUpperCase()}: ${item.label}`}
              className={`grid min-h-11 min-w-11 touch-manipulation place-items-center rounded-xl px-3 text-xs font-bold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none ${item.key === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.key.toUpperCase()}
            </a>
          ))}
          <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
          <a
            href={hrefFor(variant, state, mode === "dark" ? "light" : "dark")}
            className="flex min-h-11 touch-manipulation items-center rounded-xl px-3 text-xs font-semibold text-slate-300 [-webkit-tap-highlight-color:transparent] transition-[transform,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 hover:text-white motion-reduce:transition-none"
          >
            {mode === "dark" ? "Light" : "Dark"}
          </a>
        </div>
        <div className="flex items-center justify-center gap-0.5 border-t border-white/10 pt-1">
          {STATES.map((item) => (
          <a
            key={item.key}
            href={hrefFor(variant, item.key, mode)}
            aria-current={item.key === state ? "page" : undefined}
            className={`flex min-h-11 touch-manipulation items-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none ${item.key === state ? "bg-white/12 text-white" : "text-slate-300 hover:text-white"}`}
          >
            {item.label}
          </a>
          ))}
        </div>
      </div>
    </nav>
  );
}

export default function MoveCardGrammarClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: State = rawState === "single" || rawState === "multiple" || rawState === "many" || rawState === "payments" || rawState === "fallback" ? rawState : "pair";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const scenarioId = state === "single"
    ? "one-source"
    : state === "multiple"
      ? "three-sources"
      : state === "many"
        ? "five-sources"
        : state === "fallback"
          ? "no-source-mixed"
          : "three-payments";
  const scenarios = state === "pair"
    ? MOVE_SCENARIOS.filter((scenario) => scenario.id === "one-source" || scenario.id === "three-sources")
    : MOVE_SCENARIOS.filter((scenario) => scenario.id === scenarioId);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a href="#g69-preview" className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        Skip to move-card previews
      </a>
      <main id="g69-preview" tabIndex={-1} className="min-h-dvh scroll-pb-36 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[920px] px-4 pb-36 pt-7 sm:px-6 sm:pt-10">
          <header className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white sm:text-2xl">One move, one grammar</h1>
            <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              Compare one source, several sources, and several payments without changing how the transfer reads.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. No bank data or preferences are changed.</p>
          </header>

          <div className="mt-7 sm:mt-9">
            {variant === "a" ? <VariantA scenarios={scenarios} /> : null}
            {variant === "b" ? <VariantB scenarios={scenarios} /> : null}
            {variant === "c" ? <VariantC scenarios={scenarios} /> : null}
          </div>
        </div>
      </main>

      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewControls variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}
