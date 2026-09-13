import type { MoveScenario } from "./fixtures";
import { AccountRow, Assurance, MoveCardFrame, MoveLead, PaymentLine, PreviewHeading, RouteArrow } from "./shared";

function RouteCard({ scenario }: { scenario: MoveScenario }) {
  return (
    <MoveCardFrame scenario={scenario}>
      <MoveLead scenario={scenario} companion={<>from {scenario.sources.length} {scenario.sources.length === 1 ? "account" : "accounts"}</>} />
      <p className="mt-2 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
        Move the money into the payment account to cover what is due below.
      </p>

      <div className="mt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">Money leaves</p>
        <div className="mt-1 divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {scenario.sources.map((source) => <AccountRow key={source.name} account={source} />)}
        </div>
        <div className="flex justify-center py-1.5"><RouteArrow /></div>
        <div className="border-y border-indigo-100 bg-indigo-50/80 px-3 dark:border-indigo-400/15 dark:bg-indigo-500/10">
          <p className="pt-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-indigo-500 dark:text-indigo-300">Money arrives</p>
          <AccountRow
            account={{ ...scenario.destination, amount: scenario.moving }}
            label={`${NUMBER.format(scenario.destination.held)} held · £10 buffer included`}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">Protects this payment</p>
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

export default function VariantA({ scenarios }: { scenarios: readonly MoveScenario[] }) {
  return (
    <section aria-label="Variant A, money route">
      <PreviewHeading title="A · Money route" copy="Sources feed one destination, then the protected payment. One source and three sources use the same path." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {scenarios.map((scenario) => <RouteCard key={scenario.id} scenario={scenario} />)}
      </div>
    </section>
  );
}
