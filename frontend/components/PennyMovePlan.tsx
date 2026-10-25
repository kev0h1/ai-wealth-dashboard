"use client";

import MoneyText from "@/components/MoneyText";
import { MoveAccountIcon, MoveRouteSummary } from "@/components/MoveRoute";
import { useBalancesHidden } from "@/lib/balancesHidden";
import { formatMovePlanMoney, leftOutLine, nothingSpareLine, normalisePennyMovePlan, type PennyMovePlan as MovePlanBlock } from "@/lib/pennyMovePlan";

/**
 * G334: the route Penny just described, drawn under her reply with the same
 * From, arrow, To diagram Home's move cards use. A recommendation, never a
 * control: no button, no action, the app never moves money. Figures are the
 * server's own (the legs are already capped at what each account can spare
 * and at Left to spend); every string is drawn as React text. Under Hide
 * balances every figure masks through MoneyText, the same as the reply above.
 * Colour is information only: neutral ink, no red, and the Penny gradient
 * stays on the bubble, not on this card.
 */
export default function PennyMovePlan({ plan }: { plan: MovePlanBlock | null | undefined }) {
  const hidden = useBalancesHidden();
  const block = normalisePennyMovePlan(plan);
  if (!block) return null;
  const sources = block.legs.map((l) => ({ provider: l.provider, name: l.name, amount: l.amount }));
  const spare = nothingSpareLine(block.skipped);
  const leftOut = leftOutLine(block.skipped);
  const totalText = block.requested !== null && block.shortfall <= 0
    ? `${formatMovePlanMoney(block.total)} in total`
    : `Up to ${formatMovePlanMoney(block.total)} in total`;
  return (
    <section data-penny-move-plan data-balances-hidden={hidden ? "true" : "false"} aria-label="Move route" className="min-w-0">
      <MoveRouteSummary sources={sources} destination={{ provider: block.target.provider, name: block.target.name }} />
      <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100 px-3 dark:divide-slate-700 dark:border-slate-700">
        {block.legs.map((leg, i) => (
          <li key={`${leg.name}-${i}`} className="flex min-h-11 items-center gap-2.5 py-1.5">
            <MoveAccountIcon account={{ provider: leg.provider, name: leg.name }} size={28} />
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-slate-700 dark:text-slate-200">
              <MoneyText text={formatMovePlanMoney(leg.amount)} className="font-semibold text-slate-900 dark:text-slate-100" />
              {" from "}
              <span className="font-medium">{leg.name}</span>
              {leg.keeps > 0.004 && (
                <span className="text-slate-500 dark:text-slate-400">
                  {" · keeps "}
                  <MoneyText text={formatMovePlanMoney(leg.keeps)} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
        <MoneyText text={totalText} />
      </p>
      {block.shortfall > 0 && block.requested !== null && (
        <p className="mt-0.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">
          <MoneyText text={`You asked about ${formatMovePlanMoney(block.requested)}`} />
        </p>
      )}
      {leftOut && <p className="mt-0.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">{leftOut}</p>}
      {spare && <p className="mt-0.5 text-[12px] leading-4 text-slate-500 dark:text-slate-400">{spare}</p>}
    </section>
  );
}
