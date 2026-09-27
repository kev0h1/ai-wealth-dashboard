"use client";

// TEMPORARY PREVIEW — G173, skill: impeccable.
//
// Kevin, 2026-09-27: "The payday plan was conceived to prevent too much
// movement of money... can I be better at improving the standing orders,
// because I would always move money around to cover bills." This round
// answers that by adding, to the existing payday plan, a comparison per
// destination: what the standing order sends on payday versus what the
// account needs this period (payments + usual spend + buffer, exactly the
// backend's own `target`), and the adjustment that follows — so the card
// stops only describing this payday's move and starts saying what to change
// about the standing orders themselves.
//
// Fixture data only, no API calls. See fixtures.ts for exactly which
// figures are Kevin's real 2026-08-10 observed ritual (salary, all eight
// standing-order amounts, Monzo's spend median, NatWest's stated total
// need) versus invented for this preview (every other need figure/split,
// and the ninth "no standing order" row) — every invented figure is
// commented at its definition and marked illustrative in the UI.
//
// /design/payday-plan-standing-orders?variant=a|b|c&surface=home|penny&state=default|minimised&mode=light|dark

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import { VARIANTS, type Variant, type Surface, type Mode, type CardState } from "./shared";

function PreviewControls({ variant, surface, state, mode }: { variant: Variant; surface: Surface; state: CardState; mode: Mode }) {
  const linkClass =
    "touch-manipulation [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none";
  function href(next: Partial<{ variant: Variant; surface: Surface; state: CardState; mode: Mode }>) {
    const v = next.variant ?? variant;
    const s = next.surface ?? surface;
    const st = next.state ?? state;
    const m = next.mode ?? mode;
    return `?variant=${v}&surface=${s}&state=${st}&mode=${m}`;
  }

  return (
    <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-center gap-1">
          {VARIANTS.map((item) => (
            <a
              key={item.key}
              href={href({ variant: item.key })}
              aria-current={item.key === variant ? "page" : undefined}
              className={`grid min-h-11 place-items-center rounded-xl px-2.5 text-[11px] font-bold ${linkClass} ${item.key === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`}
            >
              {item.label}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1 border-t border-white/10 pt-1">
          <a href={href({ surface: "home" })} aria-current={surface === "home" ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold ${linkClass} ${surface === "home" ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}>
            Home
          </a>
          <a href={href({ surface: "penny" })} aria-current={surface === "penny" ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold ${linkClass} ${surface === "penny" ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}>
            Penny
          </a>
          <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
          {surface === "penny" && (
            <>
              <a href={href({ state: "default" })} aria-current={state === "default" ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold ${linkClass} ${state === "default" ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}>
                Default
              </a>
              <a href={href({ state: "minimised" })} aria-current={state === "minimised" ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold ${linkClass} ${state === "minimised" ? "bg-white/15 text-white" : "text-slate-300 hover:text-white"}`}>
                Minimised
              </a>
              <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            </>
          )}
          <a href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 hover:text-white ${linkClass}`}>
            {mode === "dark" ? "Light" : "Dark"}
          </a>
        </div>
      </div>
    </nav>
  );
}

export default function PaydayPlanStandingOrdersClient() {
  const params = useSearchParams();
  const router = useRouter();

  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawSurface = params.get("surface");
  const surface: Surface = rawSurface === "penny" ? "penny" : "home";
  const rawState = params.get("state");
  const state: CardState = rawState === "minimised" ? "minimised" : "default";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div data-g173-preview-root data-variant={variant} data-surface={surface} data-state={state} className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <a
        href="#g173-preview"
        className="sr-only z-[80] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to payday plan previews
      </a>
      <main id="g173-preview" tabIndex={-1} className="min-h-dvh scroll-pb-56 bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <div className="mx-auto w-full max-w-[600px] px-4 pb-56 pt-7 sm:px-6 sm:pt-10">
          <header className="text-center">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white sm:text-2xl">
              Payday plan vs your standing orders
            </h1>
            <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              G173, skill: impeccable. Each destination now says what its standing order sends versus what the account needs this period, and the
              adjustment that follows, so the standing orders get fixed once instead of topped up mid-month.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Fixture data only, no API calls. Salary and all eight standing-order amounts are Kevin&rsquo;s real 2026-08-10 ritual; every
              &ldquo;needs&rdquo; figure is the backend&rsquo;s own bills + spend + buffer target, invented here except NatWest&rsquo;s stated
              £596 and Monzo&rsquo;s £1,016 spend median. The ninth row (Council Tax Reserve) is an invented example with no standing order at all.
            </p>
          </header>
          <div className="mt-7 sm:mt-9">
            {variant === "a" && <VariantA surface={surface} mode={mode} state={state} router={router} />}
            {variant === "b" && <VariantB surface={surface} mode={mode} state={state} router={router} />}
            {variant === "c" && <VariantC surface={surface} mode={mode} state={state} router={router} />}
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <PreviewControls variant={variant} surface={surface} state={state} mode={mode} />
      </div>
    </div>
  );
}
