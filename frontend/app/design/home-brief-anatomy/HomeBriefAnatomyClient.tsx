"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BriefBody } from "@/components/HomeBrief";
import { PreviewCard, examplesFor, type Variant, type View } from "./PreviewCards";

const VIEWS: { key: View; label: string }[] = [
  { key: "focus", label: "Reported cards" }, { key: "family", label: "Whole family" },
  { key: "edges", label: "Long and optional" }, { key: "hidden", label: "Hidden amounts" }, { key: "empty", label: "Empty brief" },
];
const noRoute = { bfcacheId: "g295-preview", push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: async () => {} };
const control = "inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:opacity-70 dark:focus-visible:ring-offset-slate-900";

export default function HomeBriefAnatomyClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "reference" ? "reference" : "a";
  const view: View = VIEWS.some(v => v.key === params.get("state")) ? params.get("state") as View : "focus";
  const dark = params.get("mode") === "dark", clean = params.get("clean") === "1";
  const [reset, setReset] = useState(0), [feedback, setFeedback] = useState("");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#f0f2f7");
    document.querySelector("[data-g295-preview]")?.setAttribute("data-g295-ready", "true");
  }, [dark]);
  const href = (next: { variant?: Variant; view?: View; dark?: boolean; clean?: boolean }) => `?${new URLSearchParams({ variant: next.variant ?? variant, state: next.view ?? view, mode: (next.dark ?? dark) ? "dark" : "light", clean: (next.clean ?? clean) ? "1" : "0" })}`;
  const selected = (active: boolean) => `${control} ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"}`;
  const examples = examplesFor(view);
  return <main data-g295-preview data-variant={variant} data-view={view} className="min-h-dvh bg-[#f0f2f7] pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 text-slate-900 selection:bg-indigo-200 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40" style={{ colorScheme: dark ? "dark" : "light" }}>
    <a href="#brief-examples" className="sr-only z-50 rounded-xl bg-white px-4 py-3 text-sm text-slate-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:ring-2 focus-visible:ring-indigo-500">Skip to brief cards</a>
    {!clean && <header className="mx-auto mb-5 max-w-6xl px-4 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold">One reading edge</h1>
      <p className="mt-2 max-w-prose text-sm leading-6 text-slate-600 dark:text-slate-300">G295 design preview. Actual Home brief components, synthetic examples. No account or preference changes.</p>
      <nav aria-label="Card anatomy variants" className="mt-3 flex flex-wrap gap-2">
        <a href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined} className={selected(variant === "a")}>A · Quiet spine</a>
        <a href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined} className={selected(variant === "b")}>B · Inline cues</a>
        <a href={href({ variant: "reference" })} aria-current={variant === "reference" ? "page" : undefined} className={selected(variant === "reference")}>Current layout</a>
      </nav>
      <p className="mt-3 max-w-prose text-[13px] leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "The G292 A reading edge throughout: status marks stay small, with no large header tile." : variant === "b" ? "The same full text edge, with one compact icon in the eyebrow row instead of a large tile." : "Unchanged card markup and layout, shown for comparison."}</p>
      <details className="mt-3 border-y border-slate-300 py-1 dark:border-slate-700">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Examples and display</summary>
        <nav aria-label="Example states" className="mb-3 flex flex-wrap gap-2">{VIEWS.map(v => <a key={v.key} href={href({ view: v.key })} aria-current={view === v.key ? "page" : undefined} className={selected(view === v.key)}>{v.label}</a>)}<a href={href({ dark: !dark })} className={selected(false)}>{dark ? "Light theme" : "Dark theme"}</a><a href={href({ clean: true })} className={selected(false)}>View cards only</a></nav>
      </details>
      <p className="mt-3 max-w-prose text-xs leading-5 text-slate-600 dark:text-slate-300">Debt wording is intentionally unchanged. This round fixes the reading edge, not the density of the explanation.</p>
    </header>}
    <div id="brief-examples" tabIndex={-1} className={`mx-auto max-w-[430px] focus-visible:outline-none ${view === "family" || view === "edges" || view === "hidden" ? "lg:max-w-6xl lg:px-8" : ""}`}>
      {clean && <h1 className="mb-2 px-4 text-base font-bold lg:px-0">Home brief</h1>}
      <p aria-live="polite" aria-atomic="true" data-preview-feedback className={`${feedback ? "mb-3" : ""} px-4 text-[13px] leading-5 text-slate-600 dark:text-slate-300 lg:px-0`}>{feedback}</p>
      <section aria-label="Home brief examples" className={view === "focus" || view === "empty" ? "space-y-3" : "grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-2"}>
        {examples.map(example => <div className="min-w-0" key={`${variant}-${view}-${reset}-${example.key}`}>
          {view !== "focus" && <h2 className="mb-2 px-4 text-xs font-semibold text-slate-600 dark:text-slate-300 lg:px-0">{example.label}</h2>}
          <PreviewCard example={example} variant={variant} hidden={view === "hidden"} tell={setFeedback} />
        </div>)}
        {view === "empty" && <div className="px-4 lg:px-0"><BriefBody items={[]} safeToSpend={null} router={noRoute} /></div>}
      </section>
      <div className="mt-5 flex flex-wrap gap-2 px-4 lg:px-0"><button type="button" className={selected(false)} onClick={() => { setReset(v => v + 1); setFeedback(""); }}>Reset examples</button>{clean && <a href={href({ clean: false })} className={selected(false)}>Show preview controls</a>}</div>
    </div>
  </main>;
}
