"use client";

import type { ReactNode } from "react";

// The bounded day-section grammar for /upcoming's ledger
// (`app/planning/PlanningPage.tsx`), adopted verbatim from the transactions
// hub (`app/transactions/TransactionsPage.tsx`'s own day sections): a
// rounded-2xl bordered card, a plain heading, hairline `divide-y` rows
// inside — replacing the old per-payment floating `glass-card` under a bare
// day label. Shared with the design preview (`app/design/
// g124-upcoming-refine/`) so the shell itself can't drift, even though the
// rows placed inside it are not shared (see that preview's own note on
// why).
//
// `dayKeyIso` is preserved on the section for PlanningPage's own
// scroll-to-day deep link (`?day=YYYY-MM-DD`).
//
// Settling rows (bank-side pending debits, see PlanningPage's own
// `isSettling` doctrine comment) are pulled out of the plain row list into
// their own quiet trailing block, never interleaved with live rows — a
// plain border stands in for the boundary a "SETTLING" title used to carry
// (Kevin, G124 revision, 2026-09-18: "I don't think it needs a title just
// the icon and the settling under the payment is enough").
export default function UpcomingDayCard({
  dayKeyIso,
  heading,
  activeRows,
  settlingRows,
}: {
  dayKeyIso: string;
  heading: string;
  activeRows: ReactNode[];
  settlingRows: ReactNode[];
}) {
  return (
    <section
      data-day-key={dayKeyIso}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <h2 className="px-4 pb-1 pt-4 text-sm font-bold text-slate-950 dark:text-slate-50">{heading}</h2>
      {activeRows.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">{activeRows}</div>
      )}
      {settlingRows.length > 0 && (
        <div className={activeRows.length > 0 ? "border-t border-slate-100 dark:border-slate-700" : ""}>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">{settlingRows}</div>
        </div>
      )}
    </section>
  );
}
