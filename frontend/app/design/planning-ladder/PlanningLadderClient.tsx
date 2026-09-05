"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Owner brief (2026-09-04, phone screenshot of /planning): the priority
// ladder is mostly locked rungs and pushes the live sections (a 0% offer
// ending this month, the Japan goal off pace) below the fold. Three coded
// variants against the owner's real figures (2026-09-04):
//   A — collapsed ladder + one hero attention line
//   B — "Needs you this month" card above a collapsed ladder
//   C — immediate sections first, full (unfolded) ladder last
//
// Deep-linkable: /design/planning-ladder?variant=a|b|c&state=short|calm&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA, { VARIANT_A_NOTE } from "./VariantA";
import VariantB, { VARIANT_B_NOTE } from "./VariantB";
import VariantC, { VARIANT_C_NOTE } from "./VariantC";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
type PeriodState = "short" | "calm";

const VARIANTS: Variant[] = ["a", "b", "c"];
const NOTES = { a: VARIANT_A_NOTE, b: VARIANT_B_NOTE, c: VARIANT_C_NOTE };

function AnnotationPanel({ variant }: { variant: Variant }) {
  const note = NOTES[variant];
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">{note.title}</p>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Thesis</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">What it risks</p>
        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.risk}</p>
      </div>
    </div>
  );
}

function VariantSwitch({ variant, state, mode }: { variant: Variant; state: PeriodState; mode: Mode }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&state=${state}&mode=${mode}`}
            className={`flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />
        {/* Both toggles show the DESTINATION, not the current state — tapping
            "Calm" while short takes you to calm, tapping "Dark" while light
            takes you to dark. */}
        <a
          href={`?variant=${variant}&state=${state === "short" ? "calm" : "short"}&mode=${mode}`}
          className="flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {state === "short" ? "Calm" : "Short"}
        </a>
        <a
          href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const state: PeriodState = params.get("state") === "calm" ? "calm" : "short";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-5">
          <div>
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Planning ladder</h1>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Locked-rungs-vs-live-sections round · owner brief 2026-09-04
            </p>
          </div>

          <AnnotationPanel variant={variant} />

          {variant === "a" && <VariantA state={state} />}
          {variant === "b" && <VariantB state={state} />}
          {variant === "c" && <VariantC state={state} />}
        </div>

        <VariantSwitch variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}

export default function PlanningLadderClient() {
  return <Inner />;
}
