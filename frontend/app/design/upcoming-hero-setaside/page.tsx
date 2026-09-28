// G162 — Upcoming hero, set-aside-only colour/wording round.
//
// Kevin's payday-eve screenshot: the /upcoming runway hero went red with
// the status word "short" when every bill was covered and the only
// deduction was an unfunded set-aside (Available £256, bills £0, still to
// set aside £266, projected −£10, with £4,798 landing on payday). The
// engine is unchanged and correct — window_income deliberately excludes
// income arriving on the payday itself, so the hero is the balance the
// instant before pay lands (backend/app/routers/analytics.py). The
// complaint is the colour, the status word, and that the hero never says
// why the incoming pay isn't in the number.
//
// PRODUCTION-BOUNDARY CORRECTION: the brief for this round assumed the
// hero was inline in PlanningPage.tsx and self-fetching. It is not.
// components/upcoming/UpcomingHeroCard.tsx is a real, already-extracted,
// fully prop-driven production component (no fetch of its own) — both
// PlanningPage.tsx and the sibling preview app/design/g124-upcoming-refine
// already import and render it unmodified against fixtures. This round
// proposes new colour/wording logic (the set-aside-vs-bill-gap
// distinction, the amber status treatment, the payday-exclusion sentence)
// that does not exist in that component yet, so each variant below is a
// deliberate fork of it rather than a re-import: CLAUDE.md's "a preview
// may hand-author markup while exploring variants" allowance, extended to
// forking an existing component when the change under review is the
// component's own logic, not its surrounding page. Once Kevin picks, the
// winning variant's status/colour logic folds directly into
// UpcomingHeroCard.tsx itself — the one shared component — not into a
// parallel one. Everything unchanged by this proposal (the ledger row
// shape, the shortfall attribution sentence, the timing-risk block, the
// ledger's One-Separator-Per-Boundary rule) is copied verbatim from that
// production component, not reinvented.
//
// classify() in fixtures.ts is the distinguishing logic asked for: it
// names the same runwayBeforeAllocations sub-total PlanningPage.tsx
// already computes (spendableNow + runwayIncomeTotal - runwayBillsTotal,
// before allocations are subtracted) but throws away. If that alone is
// negative, it's a genuine bill gap (billGap, stays red). If bills are
// covered and only the unfilled set-aside remainder pushes the total
// negative, it's setAsideOnly, the case this round proposes amber
// wording for.
//
// Three variants (impeccable skill):
//   A "Set aside, not short" — the status word becomes a real signifier
//     chip (amber only for setAsideOnly, red only for billGap); the
//     figure itself stays ink even when negative.
//   B "Two-line verdict" — the headline becomes the pre-allocation
//     "covered" figure, with the set-aside remainder as its own smaller
//     line (amber dot, ink figure); the payday exclusion moves into the
//     ledger disclosure's own summary label.
//   C "Ledger-led" — the headline keeps today's post-allocation figure
//     and status word "Bills covered"/"Bills at risk"; the set-aside gap
//     is folded into the Full calculation disclosure with an amber dot,
//     visible on the closed summary and on the ledger row.
// Every variant renders all three states (setaside, billgap, healthy) and
// both themes; the billgap state's red is unchanged from production in
// every variant, so the contrast against the amber cases is visible.
//
// Fixture data only, no API calls, no mutations. See fixtures.ts for
// Kevin's own screenshot figures (the setaside scenario) and the two
// invented-but-self-consistent scenarios exercising the other branches.
// ?variant=a|b|c&state=setaside|billgap|healthy&mode=light|dark
import { Suspense } from "react";
import UpcomingHeroSetAsideClient from "./UpcomingHeroSetAsideClient";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <UpcomingHeroSetAsideClient />
    </Suspense>
  );
}
