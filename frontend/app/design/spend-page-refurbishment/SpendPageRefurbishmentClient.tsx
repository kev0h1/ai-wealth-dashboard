"use client";

// TEMPORARY PREVIEW. G57 is a fixture-only design round for the whole Spend
// page. It does not fetch, navigate to production routes or write user data.
//
// /design/spend-page-refurbishment?variant=a|b|c&view=period|compare&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

export type PreviewVariant = "a" | "b" | "c";
export type PreviewView = "period" | "compare";
export type PreviewMode = "light" | "dark";

const VARIANTS: { key: PreviewVariant; short: string; label: string; description: string }[] = [
  {
    key: "a",
    short: "A",
    label: "Brief first",
    description: "One verdict and one review workspace, with the long category tail folded behind its reconciled total.",
  },
  {
    key: "b",
    short: "B",
    label: "Reconciled register",
    description: "A compact instrument followed by one switchable category ledger instead of a stack of competing tiers.",
  },
  {
    key: "c",
    short: "C",
    label: "Split cockpit",
    description: "A wider desktop cockpit that keeps the verdict dominant while review work and quieter evidence sit side by side.",
  },
];

function hrefFor({ variant, view, mode }: { variant: PreviewVariant; view: PreviewView; mode: PreviewMode }) {
  return `?variant=${variant}&view=${view}&mode=${mode}`;
}

function PreviewControls({ variant, view, mode }: { variant: PreviewVariant; view: PreviewView; mode: PreviewMode }) {
  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
  const inactive = "text-slate-300 [@media(hover:hover)]:hover:text-white";
  return (
    <nav
      aria-label="Design preview controls"
      className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/92 p-1.5 shadow-xl"
    >
      <div className="flex items-center justify-center gap-1">
        {VARIANTS.map((item) => (
          <a
            key={item.key}
            href={hrefFor({ variant: item.key, view, mode })}
            aria-current={item.key === variant ? "page" : undefined}
            aria-label={`Variant ${item.short}: ${item.label}`}
            className={`flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-bold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 motion-reduce:transition-none motion-reduce:active:scale-100 active:scale-95 ${focus} ${
              item.key === variant ? "bg-indigo-600 text-white" : inactive
            }`}
          >
            {item.short}
          </a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-white/15" />
        <a
          href={hrefFor({ variant, view: view === "period" ? "compare" : "period", mode })}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-colors duration-150 motion-reduce:transition-none ${focus} ${inactive}`}
        >
          {view === "period" ? "Compare" : "Period"}
        </a>
        <a
          href={hrefFor({ variant, view, mode: mode === "dark" ? "light" : "dark" })}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-colors duration-150 motion-reduce:transition-none ${focus} ${inactive}`}
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function SpendPageRefurbishmentClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: PreviewVariant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const view: PreviewView = params.get("view") === "compare" ? "compare" : "period";
  const mode: PreviewMode = params.get("mode") === "dark" ? "dark" : "light";
  const selected = VARIANTS.find((item) => item.key === variant)!;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g57-preview-content"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        Skip to Spend preview
      </a>

      <main
        id="g57-preview-content"
        tabIndex={-1}
        data-g57-preview
        className="min-h-dvh scroll-pb-36 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white"
      >
        <div className="mx-auto w-full max-w-6xl px-4 pb-36 pt-7 sm:px-6 sm:pt-10">
          <header className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white sm:text-2xl">
              Spend page refurbishment
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              {selected.label}. {selected.description}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Illustrative owner-shaped figures. No balances or preferences are changed.
            </p>
          </header>

          <div className="mt-7 sm:mt-9">
            {variant === "a" && <VariantA view={view} mode={mode} />}
            {variant === "b" && <VariantB view={view} mode={mode} />}
            {variant === "c" && <VariantC view={view} mode={mode} />}
          </div>
        </div>
      </main>

      <div
        className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <PreviewControls variant={variant} view={view} mode={mode} />
      </div>
    </div>
  );
}
