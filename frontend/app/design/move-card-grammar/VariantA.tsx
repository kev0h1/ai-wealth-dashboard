import type { MoveScenario } from "./fixtures";
import { AccountRow, Assurance, MoveCardFrame, MoveLead, PaymentsList, PreviewHeading, RouteArrow } from "./shared";

function RouteCard({ scenario }: { scenario: MoveScenario }) {
  return (
    <MoveCardFrame scenario={scenario}>
      <MoveLead scenario={scenario} companion={<>from {scenario.sources.length} {scenario.sources.length === 1 ? "account" : "accounts"}</>} />
      <p className="mt-2 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
        Move the money into the bills account to cover what is due below.
      </p>

      <div data-money-route className="mt-3 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/30">
        <div data-money-leaves className="px-3 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">Money leaves</p>
          <div className="mt-0.5 divide-y divide-slate-200/70 dark:divide-slate-700">
            {scenario.sources.map((source) => <AccountRow key={source.name} account={source} />)}
          </div>
        </div>
        <div className="flex justify-center border-y border-slate-100 py-1.5 dark:border-slate-700"><RouteArrow /></div>
        <div data-money-arrives className="bg-indigo-50/80 px-3 pt-2 dark:bg-indigo-500/10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-indigo-500 dark:text-indigo-300">Money arrives</p>
          <AccountRow
            account={{ ...scenario.destination, amount: scenario.moving }}
            label={`${NUMBER.format(scenario.destination.held)} held · ${NUMBER.format(scenario.destination.buffer)} buffer included`}
          />
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">
          Protects {scenario.payments.length === 1 ? "this payment" : `${scenario.payments.length} payments`}
        </p>
        <PaymentsList scenario={scenario} />
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
      <PreviewHeading title="A · Money route" copy="Sources and destination now share one aligned route. The payment section simply gains rows when several bills need covering." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {scenarios.map((scenario) => <RouteCard key={scenario.id} scenario={scenario} />)}
      </div>
    </section>
  );
}
