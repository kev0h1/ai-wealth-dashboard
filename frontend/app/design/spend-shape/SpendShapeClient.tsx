"use client";

// TEMPORARY PREVIEW — A and C are reference forks, kept for comparison.
//
// Owner decisions (2026-09-05): Variant B, the instrument, is the shipped
// design — it sits at the end of Spend's period view and opens
// /spend/shape, a drill-in page holding the money shape ONLY (hero, what
// works, reference shapes), no tips index. The money-shape hero (Fixed /
// Moved to savings / Free spending / Beyond take-home) left Spend's
// Patterns view entirely (Patterns keeps the charts); the Insights page it
// used to live inside is retired. Card B below renders the LIVE
// components/SpendShapeCard.tsx (see cards.tsx); the destination "shape"
// view renders the LIVE app/spend/shape/ShapePage.tsx fed this route's own
// fixture, not a redrawn mock — this preview can never drift from what
// actually ships.
//
// Deep-linkable: /design/spend-shape?variant=a|b|c&mode=light|dark&view=list|shape

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MajoritySection, NotableShoppingCard, MoneyMovedBar, AnnotationPanel, VARIANTS, type Variant, type Mode, type VariantNote } from "@/app/design/spend-tips/shared";
import { tipsFor, type MajorityRowFixture } from "@/app/design/spend-tips/fixtures";
import { tipSubline } from "@/lib/spendTips";
import { ShapeCardA, ShapeCardB, ShapeCardC } from "./cards";
import ShapePage from "@/app/spend/shape/ShapePage";
import { SPEND_SHAPE } from "./fixtures";

const NOTES: Record<Variant, VariantNote> = {
  a: {
    title: "A, the sentence",
    thesis:
      "The card says the one thing the shape is for: what your pay was spoken for before you chose anything. The bar is the picture, the sentence is the verdict.",
    risk: "A full sentence at the end of a long page is easy to skim past.",
  },
  b: {
    title: "B, the instrument",
    thesis:
      "Four figures, no prose. Reads at a glance and matches the instrument grammar of the Spend header.",
    risk: "Percentages without the sentence can read as a grade, which the shape is not meant to be.",
  },
  c: {
    title: "C, the change",
    thesis: "Leads with what moved since last time, which is the only reason to look again.",
    risk: "Some periods have no trend to state, and the card then has nothing to say.",
  },
};

const SHAPE_PAGE_NOTE: VariantNote = {
  title: "Your money's shape",
  thesis:
    "Variant B is the shipped design as of 2026-09-05; the page holds the shape only, by owner decision.",
  risk: "None. This reflects the shipped decision, not an open design question.",
};

// Base subline the same way SpendVerdictView.tsx / spend-tips' VariantA do:
// payment count first, the live tipSubline suffix appended only when this
// category actually carries an open tip.
function sublineFor(row: MajorityRowFixture): string {
  const base = `${row.payments_count} payment${row.payments_count === 1 ? "" : "s"}`;
  const suffix = tipSubline(tipsFor(row.category));
  return suffix ? `${base} · ${suffix}` : base;
}

type View = "list" | "shape";

// ── Variant/mode/view switcher — copied from spend-tips/shared.tsx's
// VariantSwitch and extended with a `view` link so the destination mock is
// deep-linkable in its own right (that file's own switcher has no `view`
// concept to carry). ─────────────────────────────────────────────────────
function ShapeVariantSwitch({ variant, mode, view }: { variant: Variant; mode: Mode; view: View }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&mode=${mode}&view=${view}`}
            className={`flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}&view=${view}`}
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
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawView = params.get("view");
  const view: View = rawView === "shape" ? "shape" : "list";

  // Lazy initializer only (no ongoing sync effect, same convention as
  // SpendTipsClient.tsx's own `openCategory` state) — a `?view=` deep link
  // sets the initial render, then Back/Card taps below own the view for
  // the rest of this mount.
  const [currentView, setCurrentView] = useState<View>(() => view);

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const Card = variant === "a" ? ShapeCardA : variant === "b" ? ShapeCardB : ShapeCardC;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        {currentView === "shape" ? (
          <div className="mx-auto w-full max-w-[430px]">
            <div className="px-4 pt-4">
              <AnnotationPanel note={SHAPE_PAGE_NOTE} />
            </div>
            <ShapePage shape={SPEND_SHAPE} />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-5">
            <div>
              <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Spend shape card</h1>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Period-view tail (mock) · owner brief 2026-09-05
              </p>
            </div>

            <AnnotationPanel note={NOTES[variant]} />

            <NotableShoppingCard />
            <MajoritySection sublineFor={sublineFor} onOpenCategory={() => {}} />
            <MoneyMovedBar />
            <Card shape={SPEND_SHAPE} onOpen={() => setCurrentView("shape")} />
          </div>
        )}

        <ShapeVariantSwitch variant={variant} mode={mode} view={currentView} />
      </div>
    </div>
  );
}

export default function SpendShapeClient() {
  return <Inner />;
}
