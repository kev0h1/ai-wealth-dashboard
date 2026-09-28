"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SALARY, DESTS, delta, bucketOf, buildVerdict, breakdownParts, needsFigureIllustrative, FOLD_THRESHOLD_NOTE, type FixtureDest } from "./fixtures";
import { CardHeader, SalaryTile, MinimisedRow, AmberDot, MoneyText, fmt, resolveBankChip, type Surface, type Mode, type CardState } from "./shared";
import { BankBadge } from "@/components/AccountMiniCard";

// VARIANT A — "Two-column ledger". Each destination row states the standing
// order and the need side by side — STANDING ORDER left, NEEDS ~ right —
// with the delta as one arrow-free ink sentence ("send £298 less" / "start
// one at ~£150"), and the payments/spend/buffer working behind one
// card-level "Show the working" disclosure rather than per row (the ledger
// convention DESIGN.md documents: one disclosure per ledger, not one per
// operand). HAND-AUTHORED: the destination row itself is the thing this
// round changes, so it does not reuse PaydayPlanCard's dest-row markup
// (which only ever showed the recommended move, never a standing-order
// comparison) — only the header and salary tile above it are copied
// verbatim from the production component (see shared.tsx).

function Row({ dest, showWorking }: { dest: FixtureDest; showWorking: boolean }) {
  const bucket = bucketOf(dest);
  const d = delta(dest);
  const chip = resolveBankChip(dest.provider);

  let verdictLine: string;
  if (bucket === "start") {
    verdictLine = `Start one at ~£${fmt(dest.needsTotal)}.`;
  } else if (bucket === "about-right") {
    verdictLine = "About right, no change needed.";
  } else if (d > 0) {
    verdictLine = `Send £${fmt(d)} less.`;
  } else {
    verdictLine = `Send £${fmt(-d)} more.`;
  }

  return (
    <div className="py-3 first:pt-0 border-t border-slate-100 first:border-t-0 dark:border-slate-700">
      <div className="flex items-center gap-2.5">
        <span className="flex-shrink-0">
          <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
          {dest.name}
          {dest.illustrativeExample && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">
              Illustrative
            </span>
          )}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 pl-[46px]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Standing order</p>
          <p className="money mt-0.5 text-[15px] font-bold text-slate-900 dark:text-slate-100">
            {dest.hasStandingOrder ? `£${fmt(dest.standingOrder)}` : "None set"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Needs this period</p>
          <p className="money mt-0.5 text-[15px] font-bold text-slate-900 dark:text-slate-100">{`~£${fmt(dest.needsTotal)}`}</p>
          {needsFigureIllustrative(dest) && (
            <p className="mt-0.5 text-[11px] italic text-slate-400 dark:text-slate-500">illustrative</p>
          )}
        </div>
      </div>

      <p className="mt-2 flex items-start gap-1.5 pl-[46px] text-[13px] leading-snug text-slate-700 dark:text-slate-200">
        {bucket === "start" && <AmberDot />}
        <MoneyText text={verdictLine} />
      </p>

      {dest.cadenceNote && (
        <p className="mt-1 pl-[46px] text-[12px] leading-snug text-slate-400 dark:text-slate-500">{dest.cadenceNote}</p>
      )}

      {showWorking && dest.breakdown && breakdownParts(dest.breakdown).length > 0 && (
        <p className="mt-1 pl-[46px] text-[12px] leading-snug text-slate-400 dark:text-slate-500">
          <MoneyText text={breakdownParts(dest.breakdown).join(" · ")} />
          {dest.breakdown.illustrative && <span className="italic"> · split illustrative</span>}
        </p>
      )}
      {showWorking && dest.kind !== "bills" && dest.kind !== "spending" && (
        <p className="mt-1 pl-[46px] text-[12px] leading-snug text-slate-400 dark:text-slate-500 italic">
          matches your usual {dest.kind === "savings" ? "saving" : "investing"} transfer, not balance-filled
        </p>
      )}
    </div>
  );
}

export default function VariantA({
  surface,
  state,
}: {
  surface: Surface;
  mode: Mode;
  state: CardState;
}) {
  const [minimised, setMinimised] = useState(state === "minimised");
  const [showWorking, setShowWorking] = useState(false);
  const verdict = buildVerdict(DESTS);
  const subline =
    verdict.totalLess > 0
      ? `Send £${fmt(verdict.totalLess)} less across ${verdict.changed.length} standing orders`
      : "Your standing orders match what each account needs";

  if (surface === "penny" && minimised) {
    return <MinimisedRow subline={subline} onExpand={() => setMinimised(false)} />;
  }

  return (
    <div data-payday-plan-card="two-column-ledger" className="glass-card overflow-hidden rounded-2xl">
      <div className="p-4">
        <CardHeader title="Your payday plan" surface={surface} minimised={minimised} onToggleMinimise={() => setMinimised(true)} />

        <p className="mb-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            <MoneyText text={subline} />
          </strong>
          {verdict.totalLess > 0 && (
            <>
              {" "}
              <MoneyText
                text={`That’s about £${fmt(verdict.totalLess)} that could stay with you on payday instead. Get these right and you shouldn’t need to move money between accounts again before next payday.`}
              />
            </>
          )}
        </p>

        <div className="mb-3">
          <SalaryTile name={SALARY.name} provider={SALARY.provider} amount={SALARY.amount} />
        </div>

        <p className="mb-1 flex items-center justify-between pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <span>Standing orders vs what&rsquo;s needed</span>
          <button
            type="button"
            onClick={() => setShowWorking((v) => !v)}
            aria-expanded={showWorking}
            className="flex min-h-11 items-center gap-1 rounded-full px-2 text-[11px] font-semibold normal-case tracking-normal text-indigo-600 active:scale-95 transition-transform motion-reduce:transition-none dark:text-indigo-400"
          >
            {showWorking ? "Hide the working" : "Show the working"}
            <ChevronDown size={12} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${showWorking ? "rotate-180" : ""}`} />
          </button>
        </p>
        <p className="mb-2 pl-1 text-[11px] italic leading-snug text-slate-400 dark:text-slate-500">{FOLD_THRESHOLD_NOTE}</p>

        <div>
          {DESTS.map((dest) => (
            <Row key={dest.id} dest={dest} showWorking={showWorking} />
          ))}
        </div>
      </div>
    </div>
  );
}
