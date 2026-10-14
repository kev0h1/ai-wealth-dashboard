"use client";

// TEMPORARY PREVIEW. G269 design round (skills: impeccable for the round,
// design-taste-frontend for the geometry, web-design-guidelines as the gate;
// three directions drafted with openai/gpt-6-astra and rewritten against
// DESIGN.md). Renders the PRODUCTION SpendShapeCard and ShapePage through
// props with invented fixtures: nothing is fetched. "Current" is the shipped
// render with no new props, kept as the comparison.
//
// /design/pay-split?variant=current|a|b|c&fixture=under|at|beyond&surface=card|page
//   &source=cards|savings|both|unknown&consent=on|off&mode=light|dark

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import SpendShapeCard from "@/components/SpendShapeCard";
import ShapePage from "@/app/spend/shape/ShapePage";
import type { BeyondView } from "@/components/PaySplitBeyond";
import { makeShape, type Fixture, type Source } from "./fixtures";

const VIEW: Record<string, BeyondView | undefined> = { current: undefined, a: "tail", b: "lanes", c: "detached" };
const VARIANTS = [
  { key: "current", label: "Current" }, { key: "a", label: "A Tail" }, { key: "b", label: "B Lanes" }, { key: "c", label: "C Detached" },
];
const FIXTURES: Fixture[] = ["under", "at", "beyond"];
const SOURCES: Source[] = ["cards", "savings", "both", "unknown"];
const chip = (active: boolean) => `flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "bg-white text-slate-950" : "text-white/80 hover:bg-white/10"}`;

export default function PaySplitClient() {
  const params = useSearchParams();
  const variant = VARIANTS.some((v) => v.key === params.get("variant")) ? (params.get("variant") as string) : "a";
  const fixture = (FIXTURES.find((f) => f === params.get("fixture")) ?? "beyond") as Fixture;
  const source = (SOURCES.find((s) => s === params.get("source")) ?? "cards") as Source;
  const consent = params.get("consent") !== "off";
  const surface = params.get("surface") === "page" ? "page" : "card";
  const dark = params.get("mode") === "dark";
  const chrome = params.get("chrome") !== "0";
  const beyondView = VIEW[variant];

  useEffect(() => {
    // PreferencesProvider strips the dark class when signed out, so re-apply.
    const root = document.documentElement;
    const apply = () => { if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark); };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
    return () => obs.disconnect();
  }, [dark]);

  const shape = useMemo(() => makeShape(fixture, source, consent), [fixture, source, consent]);
  const href = (over: Record<string, string>) =>
    `?${new URLSearchParams({ variant, fixture, source, consent: consent ? "on" : "off", surface, mode: dark ? "dark" : "light", ...over }).toString()}`;

  return (
    <div style={{ colorScheme: dark ? "dark" : "light" }}>
      <main className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        {surface === "card" ? (
          <div className="mx-auto w-full max-w-[430px] px-4 pb-48 pt-7">
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">How your pay was split</h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              The shipped Spend card through props, fixture figures, nothing saved. Fixture: {fixture}. Source: {source}.
            </p>
            <div className="mt-5">
              <SpendShapeCard shape={shape} hideValues={false} onOpen={() => undefined} beyondView={beyondView} />
            </div>
          </div>
        ) : (
          <ShapePage shape={shape} beyondView={beyondView} />
        )}
      </main>
      {chrome && (
        <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
          <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
            <div className="flex flex-wrap items-center justify-center gap-0.5">
              {VARIANTS.map((v) => <a key={v.key} href={href({ variant: v.key })} aria-current={v.key === variant ? "page" : undefined} className={chip(v.key === variant)}>{v.label}</a>)}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5">
              {FIXTURES.map((f) => <a key={f} href={href({ fixture: f })} aria-current={f === fixture ? "page" : undefined} className={chip(f === fixture)}>{f}</a>)}
              <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
              <a href={href({ surface: surface === "card" ? "page" : "card" })} className={chip(false)}>{surface === "card" ? "Drill-in" : "Card"}</a>
              <a href={href({ mode: dark ? "light" : "dark" })} className={chip(false)}>{dark ? "Light" : "Dark"}</a>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5">
              {SOURCES.map((s) => <a key={s} href={href({ source: s })} aria-current={s === source ? "page" : undefined} className={chip(s === source)}>{s}</a>)}
              <a href={href({ consent: consent ? "off" : "on" })} className={chip(false)}>Consent {consent ? "on" : "off"}</a>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
