"use client";

// TEMPORARY PREVIEW — delete after design review (G38).
//
// Spend period-view design round. Kevin 2026-09-11: the "Also running warm"
// mini-row places the pace chip inline with the amount while the hero
// "Needs a look" card stacks the chip under the amount in a two-row grid
// (components/SpendVerdictView.tsx, NotableCard ~line 364 vs. the warm
// mini-row ~line 596) — fix the WHOLE period view, not just the chip.
//
//   /design/spend-period-round?variant=a|b|c&mode=light|dark
//
// Variant B (Tiered dashboard, unified row) shipped — see G38. The
// "current" baseline tab that compared these three against the live page as
// it stood pre-round (Baseline.tsx, rendering the pre-redesign default-
// exported components/SpendHeader.tsx) was retired with it (backlog G73):
// that old instrument-header component is gone from SpendHeader.tsx,
// superseded in production by SpendJourneySummary, so it could no longer
// serve as an honest "as shipped" comparison. A, B and C stay as the
// record of what was compared before the pick.
//
// Variant summary:
//   A — "One ledger, ranked": the hero/grouped-tile split is gone, every
//     notable (needs-a-look and running-warm alike) is one row in one
//     ranked list, one row template throughout the whole page.
//   B — "Tiered dashboard, unified row": keeps today's three-tier IA (hero
//     card / grouped tile / calm list) but the hero's header row and a
//     mini-row's header row are now the SAME component at two sizes, so
//     figure+badge can never diverge into stacked-vs-inline again.
//   C — "The sentence leads": the reading gets its own headline line with
//     no card chrome, notables become a horizontally-scrolling strip of
//     equal-family attention cards (master) with one shared detail panel
//     below (detail), and the calm list compresses into a 2-column tile
//     grid.
//
// Every variant resolves the inconsistency the same way at its core: there
// is exactly ONE place in each variant's code where a spend figure meets its
// pace badge (primitives.tsx's FigureBadge), so the pair can never disagree
// on placement between the hero row and a mini-row again. G53 (Kevin, on
// Variant A: "why do we have the £2000 so big" / "the pills still don't
// look right why can't they be underneath?") moved that one placement back
// to stacked and right-aligned, matching the shipped hero card's own
// layout, and brought the lead figure down from Amount-on-card (19px) to
// Card/section title (16px) so a per-category row reads as a row, not a
// page headline. Every variant here picked the change up for free.
//
// Fixture data only (fixtures.ts) — no API calls, no auth, no production
// navigation. components/SpendVerdictView.tsx and the rest of the live Spend
// page are untouched by every file in this directory except Baseline.tsx's
// read-only import of the real header/verdict-view/shape-card components.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string }[] = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
];

function Switcher({ variant, mode }: { variant: Variant; mode: Mode }) {
  return (
    <div
      id="g38-switcher"
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl max-w-[92vw]">
        {VARIANTS.map((v) => (
          <a
            key={v.key}
            href={`?variant=${v.key}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v.key === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.label}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
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
  const variant: Variant = (["a", "b", "c"] as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <p className="pt-4 px-4 text-[11px] text-slate-400 dark:text-slate-500 text-center">
          Illustrative figures, not real balances. G38 design round, variant {variant.toUpperCase()}. Variant B shipped
          (backlog G38); the &quot;Current&quot; baseline tab that compared against the live page was retired with it
          (backlog G73) since components/SpendHeader.tsx&apos;s old instrument-header default export it rendered is
          gone, superseded by SpendJourneySummary.
        </p>

        <div className="mx-auto max-w-xl px-4 pt-4">
          {variant === "a" && <VariantA />}
          {variant === "b" && <VariantB />}
          {variant === "c" && <VariantC />}
        </div>

        <Switcher variant={variant} mode={mode} />
      </div>
    </div>
  );
}

export default function SpendPeriodRoundClient() {
  return <Inner />;
}
