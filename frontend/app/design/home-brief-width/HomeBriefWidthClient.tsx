"use client";

// TEMPORARY PREVIEW — delete with the other /design/* routes.
// /design/home-brief-width: backlog G11. Renders the REAL card components
// from components/HomeBrief.tsx (CelebrationCard, CliffCard, MoveCard —
// exported for this purpose) against long-body fixtures so Kevin can see,
// without an authed Home session, that body copy now spans the full card
// width instead of stopping short of the right edge to make room for a
// DismissChip that used to sit as a 44px flex column beside the text for
// the whole card height. `dismissible` is on for every fixture so the chip
// renders (absolute top-right now, clearing only the headline row) — the
// point of this page is to show the chip AND full-width body coexisting.
// One fixture (CliffCard) carries a >£1,000 figure to show the companion
// thousands-separator fix (£1,175, not £1175) at the same time.
//
// No data fetching, no auth (/design/* is exempt — see
// components/AuthProvider.tsx). Deep-linkable at /design/home-brief-width.

import { useRouter } from "next/navigation";
import { CelebrationCard, CliffCard, MoveCard } from "@/components/HomeBrief";
import type { CompanionItem } from "@/lib/api";

const maskAmounts = (text: string) => text;

const CELEBRATION_ITEM: CompanionItem = {
  id: "fixture-celebration-1",
  type: "celebration",
  headline: "Rent is covered for September",
  body: "Moved three days early from your everyday account, no chasing needed, and nothing else in this pay period is affected, so there is nothing left to do here before next month.",
  action: null,
  estimated: false,
};

const CLIFF_ITEM: CompanionItem = {
  id: "fixture-cliff-1",
  type: "cliff",
  headline: "0% promo on your Barclaycard ends 12 October",
  body: "After that, £1,175 carried at the standard rate would cost around £24 a month in interest, so it is worth deciding whether to clear it or move it to another 0% deal before the promo runs out.",
  action: { label: "See the plan", route: "/cards" },
  estimated: false,
};

const MOVE_ITEM: CompanionItem = {
  id: "fixture-move-1",
  type: "move",
  headline: "Move £1,175 to cover next week's payments",
  body: "This clears the mortgage and the council tax direct debit due before payday, and every source account still comfortably covers its own bills and any envelopes you have set aside, with a little room left over besides.",
  action: { label: "See it in Upcoming", route: "/upcoming" },
  estimated: false,
};

function noop() {
  /* fixture cards call onHomeDismiss when the chip is pressed; this page
     has no list to remove the item from, so pressing it just no-ops. */
}

function CardStack({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
          CelebrationCard
        </p>
        <CelebrationCard item={CELEBRATION_ITEM} router={router} maskAmounts={maskAmounts} dismissible onHomeDismiss={noop} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
          CliffCard
        </p>
        <CliffCard item={CLIFF_ITEM} router={router} maskAmounts={maskAmounts} dismissible onHomeDismiss={noop} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
          MoveCard
        </p>
        <MoveCard item={MOVE_ITEM} router={router} hideNetWorth={false} maskAmounts={maskAmounts} dismissible onHomeDismiss={noop} />
      </div>
    </div>
  );
}

function ThemeBlock({ dark, router }: { dark: boolean; router: ReturnType<typeof useRouter> }) {
  return (
    <div className={dark ? "dark" : undefined}>
      <div
        className="rounded-3xl bg-[#f0f2f7] dark:bg-[#0f172a] p-4"
        style={{ colorScheme: dark ? "dark" : "light" }}
      >
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {dark ? "Dark block" : "Light block"}
        </p>
        <CardStack router={router} />
      </div>
    </div>
  );
}

export default function HomeBriefWidthClient() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Home brief card width</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Backlog G11 — body copy spans the full card width; the dismiss chip is absolute top-right, clearing only the headline row.
        </p>

        <div className="mt-6 flex flex-col gap-8">
          <ThemeBlock dark={false} router={router} />
          <ThemeBlock dark={true} router={router} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          Before this fix, DismissChip sat as a 44px flex sibling of the text
          column for the whole card height, so body text (and, on
          UnfundedMoveCard/RhythmCard, the rows and buttons below it) stopped
          short of the right edge even though the chip only ever occupied the
          top-right corner. The CliffCard and MoveCard fixtures above also
          carry a &pound;1,175 figure to show the companion thousands-separator
          fix (previously &pound;1175).
        </p>
      </div>
    </div>
  );
}
