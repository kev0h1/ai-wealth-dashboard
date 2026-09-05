"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Variant A is the shipped design as of 2026-09-05; B and C kept for
// reference. VariantA.tsx, TransactionsMock.tsx and this route's own
// tip-suffix subline logic now import the LIVE shipped pieces
// (components/TipsLine.tsx, lib/spendTips.ts) rather than a local fork, so
// this preview stays a true mirror of production rather than a frozen
// snapshot of it.
//
// Owner brief (2026-09-04, phone screenshot of /spend): savings tips are
// wedged into the category list as "Penny noticed · …" rows beneath
// category rows. Problems: breaks the row grammar, contradicts the
// "Looking normal" header, truncates the fact, borrows Penny's name for
// weekly web research. Three variants compare how a tip's existence
// surfaces without any of that:
//   A — signifier in the subline (count + estimate folded into the row,
//       the tip itself waits behind a one-line row under the filter chips
//       on the transactions page, above the payments)
//   B — one "Ways to save" card under the list, reconciled total, a door
//       to Patterns
//   C — both A and B together
//
// Owner correction (2026-09-05): tapping a category row does NOT open a
// bottom sheet in the live app — it routes to the global transactions hub
// (/transactions?category=X&from=&to=, app/transactions/TransactionsPage.tsx)
// with the category and pay period as removable chips, a search box, and a
// paginated white list of TransactionRows. TransactionsMock.tsx rebuilds
// that page faithfully and is what actually carries the tip now: a
// collapsed one-line disclosure under the filter chips, above the
// payments, expanding in place to the same live TipsLine/TipStrip
// (components/TipsLine.tsx) the real transactions page renders.
//
// Deep-linkable with the transactions mock already open: append
// `?open=<category>` (e.g. `open=Bills`) so a headless screenshot can
// capture it without a tap. Preview-only, carried through the variant/mode
// switcher links only when the query already has one (see VariantSwitch in
// shared.tsx). A further `&tip=<insightId>` (e.g. `tip=gym-spend-tips`)
// opens that tip's strip inside the tips line on load, for a screenshot of
// an expanded InsightCard without a second tap — preview-only, not carried
// through the variant/mode switcher.
// Every fixture tip carries `app_route: null` (fixtures.ts) so InsightCard's
// own primary-action CTA never renders in this preview — those routes
// require auth, and /design/* is auth-exempt, so a real app_route would
// bounce a reviewer straight into the login gate.
//
// Deep-linkable: /design/spend-tips?variant=a|b|c&mode=light|dark

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import TransactionsMock from "./TransactionsMock";
import { VariantSwitch, AnnotationPanel, VARIANTS, type Variant, type Mode, type VariantNote } from "./shared";
import { MAJORITY_ROWS } from "./fixtures";
import type { SavingsInsight } from "@/lib/api";

const NOTES: Record<Variant, VariantNote> = {
  a: {
    title: "A, tip in the subline",
    thesis:
      "Nothing is added to the list. A category that has a tip says so in its own subline, count and figure only, and the tip itself waits behind a one-line row under the filter chips on the transactions page, above the payments, its evidence and research date one tap further in.",
    risk:
      "Discoverability rests on a few muted words in a subline. Someone skimming amounts may never notice there is £147 a month on the table.",
  },
  b: {
    title: "B, one card as the door",
    thesis:
      "Category rows stay pure. One card under the list carries every open tip with a reconciled total; tapping one opens that category on the transactions page, where the tip waits behind a one-line row under the filter chips, above the payments, and the card links on to the full index in Patterns.",
    risk:
      "Tips lose their context. Reading about your gym under a card at the bottom of the page is a step away from the Health row that prompted it.",
  },
  c: {
    title: "C, subline plus card",
    thesis:
      "The subline keeps the tip in context, the card gives it a home and a total, and either touch lands on the same transactions page where the tip waits behind a one-line row under the filter chips, above the payments. Two touches, one fact.",
    risk:
      "Two mechanisms for one thing. If both are kept they must never disagree on counts or figures.",
  },
};

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  // Preview-only `?open=<category>` deep link (e.g. `open=Bills`) so a
  // headless screenshot can capture the transactions mock open without a
  // tap. Matched case-insensitively against the real category names so
  // `open=bills` works too; unmatched values are silently ignored (the
  // mock stays closed).
  const openParam = params.get("open");
  // Preview-only `?tip=<insightId>` deep link (e.g. `tip=gym-spend-tips`) so
  // a headless screenshot can capture a tip's strip already expanded
  // inside the tips line, without a second tap. Read once on mount and
  // handed to TransactionsMock as its initial open-strip id; ignored
  // entirely if the category that ends up open doesn't carry a tip with
  // that id.
  const tipParam = params.get("tip");

  const [openCategory, setOpenCategory] = useState<string | null>(() => {
    if (!openParam) return null;
    return MAJORITY_ROWS.find((r) => r.category.toLowerCase() === openParam.toLowerCase())?.category ?? null;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const handleOpenCategory = (category: string) => setOpenCategory(category);
  const handleOpenTip = (tip: SavingsInsight) => {
    if (tip.app_category) setOpenCategory(tip.app_category);
  };

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        {openCategory ? (
          <div className="mx-auto w-full max-w-[430px]">
            <TransactionsMock
              category={openCategory}
              variant={variant}
              mode={mode}
              initialTipId={tipParam ?? undefined}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-5">
            <div>
              <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Spend tips</h1>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Category list vs tip integration · owner brief 2026-09-04
              </p>
            </div>

            <AnnotationPanel note={NOTES[variant]} />

            {variant === "a" && <VariantA onOpenCategory={handleOpenCategory} />}
            {variant === "b" && <VariantB onOpenCategory={handleOpenCategory} onOpenTip={handleOpenTip} />}
            {variant === "c" && <VariantC onOpenCategory={handleOpenCategory} onOpenTip={handleOpenTip} />}
          </div>
        )}

        <VariantSwitch variant={variant} mode={mode} open={openParam ?? undefined} />
      </div>
    </div>
  );
}

export default function SpendTipsClient() {
  return <Inner />;
}
