"use client";

// TEMPORARY PREVIEW. G217 allocation (set-aside) shortfall card, shown under the
// production payment MoveCard as they would stack on Home. No API calls.
//
// /design/allocation-shortfall?variant=a|b|c&state=estimated|known|no-source&mode=light|dark[&sheet=open]

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { MoveCard } from "@/components/HomeBrief";
import { allocationShortfall, paymentItem, type ShortfallState } from "./fixtures";
import { VariantA, VariantB, VariantC } from "./Variants";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string }[] = [
  { key: "a", label: "Same anatomy, lighter" },
  { key: "b", label: "Plan note" },
  { key: "c", label: "Inline ledger line" },
];
const STATES: { key: ShortfallState; label: string }[] = [
  { key: "estimated", label: "Estimated" },
  { key: "known", label: "Known" },
  { key: "no-source", label: "No source" },
];

const href = (variant: Variant, state: ShortfallState, mode: Mode) => `?variant=${variant}&state=${state}&mode=${mode}`;
const chip = (active: boolean) => `flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-xs font-semibold [-webkit-tap-highlight-color:transparent] transition-[transform,background-color,color] duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none ${active ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"}`;

export default function AllocationShortfallClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: ShortfallState = rawState === "known" || rawState === "no-source" ? rawState : "estimated";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const sheetOpen = params.get("sheet") === "open";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  const s = allocationShortfall(state);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <main className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
        <div className="mx-auto w-full max-w-[430px] px-4 pb-40 pt-7">
          <header>
            <h1 className="text-balance text-xl font-bold tracking-[-0.02em] text-slate-950 dark:text-white">A set-aside that is short</h1>
            <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">
              The payment card is the production MoveCard. The set-aside card sits below it, as it would on Home, and carries less weight.
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Preview only. Fixtures, nothing is saved.</p>
          </header>
          <div className="mt-6 space-y-3">
            <MoveCard item={paymentItem()} hideNetWorth={false} maskAmounts={(t) => t} previewMode />
            {variant === "a" && <VariantA s={s} />}
            {variant === "b" && <VariantB s={s} />}
            {variant === "c" && <VariantC s={s} sheetOpen={sheetOpen} />}
          </div>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
        <nav aria-label="Design preview controls" className="pointer-events-auto max-w-[calc(100vw-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-xl">
          <div className="flex items-center justify-center gap-1">
            {VARIANTS.map((v) => (
              <a key={v.key} href={href(v.key, state, mode)} aria-current={v.key === variant ? "page" : undefined} aria-label={`Variant ${v.key.toUpperCase()}: ${v.label}`} className={`${chip(v.key === variant)} min-w-11`}>{v.key.toUpperCase()}</a>
            ))}
            <span className="mx-0.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <a href={href(variant, state, mode === "dark" ? "light" : "dark")} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
          </div>
          <div className="mt-1 flex items-center justify-center gap-0.5 border-t border-white/10 pt-1">
            {STATES.map((st) => (
              <a key={st.key} href={href(variant, st.key, mode)} aria-current={st.key === state ? "page" : undefined} className={chip(st.key === state)}>{st.label}</a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
