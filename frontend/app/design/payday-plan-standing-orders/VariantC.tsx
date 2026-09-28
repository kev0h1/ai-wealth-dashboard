"use client";

import { useState } from "react";
import { SALARY, DESTS, delta, bucketOf, buildVerdict, needsFigureIllustrative, type FixtureDest } from "./fixtures";
import { CardHeader, SalaryTile, MinimisedRow, AmberDot, MoneyText, fmt, resolveBankChip, type Surface, type Mode, type CardState } from "./shared";
import { BankBadge } from "@/components/AccountMiniCard";

// VARIANT C — "Before and after". A compact table of every destination,
// Standing order / Suggested columns and a highlighted delta cell — the
// widest-coverage variant, every account visible at once rather than only
// the ones that changed (Variant B) or one full row each (Variant A).
// HAND-AUTHORED table body for the same reason as A/B; header and salary
// tile above the table, and the "stays with you" line below it, are the
// production markup copied verbatim (see shared.tsx).

function TableRow({ dest }: { dest: FixtureDest }) {
  const bucket = bucketOf(dest);
  const d = delta(dest);
  const chip = resolveBankChip(dest.provider);
  const highlighted = bucket !== "about-right";
  const deltaLabel = bucket === "start" ? `+£${fmt(dest.needsTotal)}` : d === 0 ? "£0" : d > 0 ? `−£${fmt(d)}` : `+£${fmt(-d)}`;

  return (
    <div className="grid grid-cols-[1fr_58px_58px_60px] items-start gap-2 py-2 border-t border-slate-100 first:border-t-0 dark:border-slate-700">
      <span className="flex min-w-0 items-start gap-2">
        <span className="flex-shrink-0">
          <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} size={24} />
        </span>
        <span className="min-w-0 text-pretty text-[12px] font-medium leading-tight text-slate-700 dark:text-slate-200">
          {dest.name}
          {dest.illustrativeExample && <span className="ml-1 text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">(eg)</span>}
        </span>
      </span>
      <span className="money text-right text-[12px] font-semibold text-slate-900 dark:text-slate-100">
        {dest.hasStandingOrder ? `£${fmt(dest.standingOrder)}` : "None"}
      </span>
      <span className="money text-right text-[12px] font-semibold text-slate-900 dark:text-slate-100">
        {`~£${fmt(dest.needsTotal)}`}
        {needsFigureIllustrative(dest) && <sup className="ml-px font-sans">*</sup>}
      </span>
      <span className="flex justify-end">
        <span
          className={`money inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-bold ${
            highlighted ? "bg-slate-100 text-slate-900 dark:bg-slate-700/60 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"
          }`}
        >
          {bucket === "start" && <AmberDot />}
          {deltaLabel}
        </span>
      </span>
    </div>
  );
}

export default function VariantC({
  surface,
  state,
}: {
  surface: Surface;
  mode: Mode;
  state: CardState;
}) {
  const [minimised, setMinimised] = useState(state === "minimised");
  const verdict = buildVerdict(DESTS);
  const subline =
    verdict.totalLess > 0
      ? `£${fmt(verdict.totalLess)} less across ${verdict.changed.length} standing orders`
      : "Standing orders match what’s needed";
  const suggestedTotalOnPayday = DESTS.filter((d) => !d.illustrativeExample && !d.cadenceNote).reduce((sum, d) => sum + d.needsTotal, 0);
  const currentTotalOnPayday = DESTS.filter((d) => !d.illustrativeExample && !d.cadenceNote && d.hasStandingOrder).reduce((sum, d) => sum + d.standingOrder, 0);
  const suggestedStays = SALARY.amount - suggestedTotalOnPayday - (DESTS.find((d) => d.id === "vanguard")?.needsTotal ?? 0);
  const currentStays = SALARY.amount - currentTotalOnPayday - (DESTS.find((d) => d.id === "vanguard")?.standingOrder ?? 0);

  if (surface === "penny" && minimised) {
    return <MinimisedRow subline={subline} onExpand={() => setMinimised(false)} />;
  }

  return (
    <div data-payday-plan-card="before-and-after" className="glass-card overflow-hidden rounded-2xl">
      <div className="p-4">
        <CardHeader title="Your payday plan" surface={surface} minimised={minimised} onToggleMinimise={() => setMinimised(true)} />

        <p className="mb-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            <MoneyText text={subline} />
          </strong>
          {verdict.totalLess > 0 && (
            <>
              {" "}
              <MoneyText text="Adjust these and you shouldn’t need to move money between accounts again before next payday." />
            </>
          )}
        </p>

        <div className="mb-3">
          <SalaryTile name={SALARY.name} provider={SALARY.provider} amount={SALARY.amount} />
        </div>

        <div className="grid grid-cols-[1fr_58px_58px_60px] gap-2 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Account</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Standing order</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Needs</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Adjust</span>
        </div>

        <div>
          {DESTS.map((dest) => (
            <TableRow key={dest.id} dest={dest} />
          ))}
        </div>

        {DESTS.some((d) => needsFigureIllustrative(d)) && (
          <p className="mt-1.5 text-[11px] italic leading-snug text-slate-400 dark:text-slate-500">* illustrative need figure</p>
        )}

        <p className="mt-3 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
          <MoneyText
            text={
              suggestedStays > currentStays
                ? `£${fmt(currentStays)} stays with you in ${SALARY.name} today. Follow the suggested column and about £${fmt(suggestedStays)} could stay instead.`
                : `£${fmt(currentStays)} stays with you in ${SALARY.name}.`
            }
          />
        </p>
      </div>
    </div>
  );
}
