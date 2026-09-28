"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SALARY, DESTS, delta, buildVerdict, breakdownParts, needsFigureIllustrative, FOLD_THRESHOLD_NOTE, type FixtureDest } from "./fixtures";
import { CardHeader, SalaryTile, MinimisedRow, AmberDot, MoneyText, fmt, resolveBankChip, type Surface, type Mode, type CardState } from "./shared";
import { BankBadge } from "@/components/AccountMiniCard";

// VARIANT B — "Adjustment list". Leads with the verdict figure as the
// card's own hero (the way Safe to Spend leads with its hero cash figure),
// then lists ONLY the destinations that need a change, each as one
// Numbers-Lead sentence. Everything already right folds into a single "N
// standing orders are about right" row, expandable for anyone who wants to
// see them named. HAND-AUTHORED destination content for the same reason as
// Variant A — only the header and salary tile are the production markup,
// copied verbatim (see shared.tsx).

function ChangeRow({ dest }: { dest: FixtureDest }) {
  const d = delta(dest);
  const chip = resolveBankChip(dest.provider);
  const verb = d > 0 ? "less" : "more";
  const amount = Math.abs(d);
  return (
    <div className="py-3 first:pt-0 border-t border-slate-100 first:border-t-0 dark:border-slate-700">
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 mt-0.5">
          <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug text-slate-700 dark:text-slate-200">
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{dest.name}</strong>
            {": "}
            <MoneyText text={`send £${fmt(amount)} ${verb}`} />
            {" "}
            <MoneyText text={`(£${fmt(dest.standingOrder)} sent, ~£${fmt(dest.needsTotal)} needed`} />
            {needsFigureIllustrative(dest) && <span className="italic text-slate-400 dark:text-slate-500"> · illustrative</span>}
            )
          </span>
          {dest.breakdown && breakdownParts(dest.breakdown).length > 0 && (
            <span className="mt-1 block text-[12px] leading-snug text-slate-400 dark:text-slate-500">
              <MoneyText text={breakdownParts(dest.breakdown).join(" · ")} />
              {dest.breakdown.illustrative && <span className="italic"> · split illustrative</span>}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function StartRow({ dest }: { dest: FixtureDest }) {
  const chip = resolveBankChip(dest.provider);
  return (
    <div className="py-3 first:pt-0 border-t border-slate-100 first:border-t-0 dark:border-slate-700">
      <div className="flex items-start gap-2.5">
        <span className="flex-shrink-0 mt-0.5">
          <BankBadge logoSrc={chip.logoSrc} initials={chip.initials} initialsSize={chip.initialsSize} altText={chip.label} brandBg={chip.bg} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5 text-[15px] leading-snug text-slate-700 dark:text-slate-200">
            <AmberDot />
            <span>
              <strong className="font-semibold text-slate-900 dark:text-slate-100">{dest.name}</strong>
              {" has no standing order. "}
              <MoneyText text={`Start one at ~£${fmt(dest.needsTotal)}.`} />
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                Illustrative
              </span>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

export default function VariantB({
  surface,
  state,
}: {
  surface: Surface;
  mode: Mode;
  state: CardState;
}) {
  const [minimised, setMinimised] = useState(state === "minimised");
  const [showAboutRight, setShowAboutRight] = useState(false);
  const verdict = buildVerdict(DESTS);
  const subline =
    verdict.totalLess > 0
      ? `£${fmt(verdict.totalLess)} less across ${verdict.changed.length} standing orders`
      : "Standing orders match what’s needed";

  if (surface === "penny" && minimised) {
    return <MinimisedRow subline={subline} onExpand={() => setMinimised(false)} />;
  }

  return (
    <div data-payday-plan-card="adjustment-list" className="glass-card overflow-hidden rounded-2xl">
      <div className="p-4">
        <CardHeader title="Your payday plan" surface={surface} minimised={minimised} onToggleMinimise={() => setMinimised(true)} />

        {/* Hero verdict — the card's one Display-weight figure, same
            Numbers-Lead treatment as the hero total production already
            gives this card, repurposed for the standing-order gap instead
            of the raw move total. */}
        {verdict.totalLess > 0 ? (
          <div className="mb-3">
            <p className="money text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100">{`£${fmt(verdict.totalLess)}`}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Less across {verdict.changed.length} standing orders
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              <MoneyText
                text={`That’s about £${fmt(verdict.totalLess)} that could stay with you on payday. Adjust these and you shouldn’t need to move money between accounts again before next payday.`}
              />
            </p>
          </div>
        ) : (
          <p className="mb-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Your standing orders already match what each account needs.</strong>
          </p>
        )}

        <div className="mb-3">
          <SalaryTile name={SALARY.name} provider={SALARY.provider} amount={SALARY.amount} />
        </div>

        {(verdict.changed.length > 0 || verdict.start.length > 0) && (
          <>
            <p className="mb-1 pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Standing orders to change
            </p>
            <div>
              {verdict.changed.map((dest) => (
                <ChangeRow key={dest.id} dest={dest} />
              ))}
              {verdict.start.map((dest) => (
                <StartRow key={dest.id} dest={dest} />
              ))}
            </div>
          </>
        )}

        {verdict.aboutRight.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAboutRight((v) => !v)}
              aria-expanded={showAboutRight}
              className="flex min-h-11 w-full items-center justify-between rounded-xl bg-slate-50/70 px-3 py-2.5 text-left dark:bg-slate-900/30"
            >
              <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                {`${verdict.aboutRight.length} standing ${verdict.aboutRight.length === 1 ? "order is" : "orders are"} about right`}
              </span>
              <ChevronDown size={14} aria-hidden="true" className={`flex-shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none dark:text-slate-500 ${showAboutRight ? "rotate-180" : ""}`} />
            </button>
            <p className="mt-1 px-3 text-[11px] italic leading-snug text-slate-400 dark:text-slate-500">{FOLD_THRESHOLD_NOTE}</p>
            {showAboutRight && (
              <div className="mt-1 space-y-1.5 px-3">
                {verdict.aboutRight.map((dest) => (
                  <p key={dest.id} className="text-[12px] leading-snug text-slate-400 dark:text-slate-500">
                    <MoneyText text={`${dest.name}: sends £${fmt(dest.standingOrder)}, about what it needs.`} />
                    {dest.cadenceNote && ` ${dest.cadenceNote}`}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
