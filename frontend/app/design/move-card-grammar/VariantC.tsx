import { ChevronDown } from "lucide-react";
import type { MoveScenario } from "./fixtures";
import { AccountBadge, AccountRow, Assurance, Currency, MoveCardFrame, PaymentLine, PreviewHeading, RouteArrow } from "./shared";

function SummaryNode({ scenario, side }: { scenario: MoveScenario; side: "from" | "to" }) {
  if (side === "to") {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <AccountBadge account={scenario.destination} size={28} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">To</p>
            <p className="text-[12px] font-semibold leading-4 text-slate-900 dark:text-white">{scenario.destination.name}</p>
          </div>
        </div>
      </div>
    );
  }

  const first = scenario.sources[0];
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <div className="relative h-7 w-8 shrink-0">
          <span className="absolute left-0 top-0"><AccountBadge account={first} size={28} /></span>
          {scenario.sources.length > 1 ? (
            <span className="absolute -bottom-1 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-white bg-slate-700 text-[9px] font-bold text-white dark:border-slate-800 dark:bg-slate-500">
              {scenario.sources.length}
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">From</p>
          <p className="text-[12px] font-semibold leading-4 text-slate-900 dark:text-white">
            {scenario.sources.length === 1 ? first.name : `${scenario.sources.length} accounts`}
          </p>
        </div>
      </div>
    </div>
  );
}

function FoldCard({ scenario }: { scenario: MoveScenario }) {
  return (
    <MoveCardFrame scenario={scenario}>
      <div data-move-lead className="mt-3 flex items-baseline justify-between gap-3">
        <div>
          <Currency value={scenario.moving} className="text-[21px] font-bold leading-7 text-slate-950 dark:text-white" />
          <p className="text-[12px] text-slate-500 dark:text-slate-400">moving now</p>
        </div>
        <p className="max-w-[170px] text-right text-[12px] leading-5 text-slate-500 dark:text-slate-400">
          {scenario.overdue ? "Payment overdue" : "Payment due"} {scenario.payment.due}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,0.9fr)_28px_minmax(0,1.1fr)] items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 max-[350px]:grid-cols-1 dark:border-slate-700 dark:bg-slate-900/30">
        <SummaryNode scenario={scenario} side="from" />
        <span className="justify-self-center max-[350px]:rotate-90"><RouteArrow horizontal /></span>
        <SummaryNode scenario={scenario} side="to" />
      </div>

      <details className="group mt-2 rounded-xl border border-slate-100 dark:border-slate-700">
        <summary className="flex min-h-11 cursor-pointer list-none touch-manipulation items-center justify-between gap-3 rounded-xl px-3 text-[12px] font-semibold text-slate-700 [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden dark:text-slate-200">
          <span>How the {NUMBER.format(scenario.moving)} is made up</span>
          <ChevronDown size={15} className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="divide-y divide-slate-100 border-t border-slate-100 px-3 dark:divide-slate-700 dark:border-slate-700">
          {scenario.sources.map((source) => <AccountRow key={source.name} account={source} quiet />)}
        </div>
      </details>

      <div className="mt-3">
        <PaymentLine scenario={scenario} />
      </div>
      <Assurance scenario={scenario} />
    </MoveCardFrame>
  );
}

const NUMBER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export default function VariantC({ scenarios }: { scenarios: readonly MoveScenario[] }) {
  return (
    <section aria-label="Variant C, compact handoff">
      <PreviewHeading title="C · Compact handoff" copy="The transfer reads in one line, with the same source disclosure on both cards. Open it only when the account split matters." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {scenarios.map((scenario) => <FoldCard key={scenario.id} scenario={scenario} />)}
      </div>
    </section>
  );
}
