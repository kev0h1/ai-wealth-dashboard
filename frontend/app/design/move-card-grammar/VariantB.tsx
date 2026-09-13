import type { MoveScenario } from "./fixtures";
import { AccountRow, Assurance, MoveCardFrame, MoveLead, PaymentLine, PreviewHeading } from "./shared";

function LedgerCard({ scenario }: { scenario: MoveScenario }) {
  return (
    <MoveCardFrame scenario={scenario}>
      <MoveLead scenario={scenario} companion={<>to the payment account</>} />
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">
            From {scenario.sources.length} {scenario.sources.length === 1 ? "account" : "accounts"}
          </p>
          <div className="mt-0.5 divide-y divide-slate-200/70 dark:divide-slate-700">
            {scenario.sources.map((source) => <AccountRow key={source.name} account={source} />)}
          </div>
        </div>

        <div className="border-t border-slate-200/80 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">To</p>
          <AccountRow
            account={{ ...scenario.destination, amount: scenario.moving }}
            label={`${NUMBER.format(scenario.destination.held)} held · £10 buffer included`}
          />
        </div>
      </div>

      <div className="mt-3 border-y border-slate-100 dark:border-slate-700">
        <p className="pt-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">Covers</p>
        <PaymentLine scenario={scenario} compact />
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

export default function VariantB({ scenarios }: { scenarios: readonly MoveScenario[] }) {
  return (
    <section aria-label="Variant B, transfer ledger">
      <PreviewHeading title="B · Transfer ledger" copy="A single From, To, Covers sequence keeps every account and amount in one scan. The source section simply gains rows." />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {scenarios.map((scenario) => <LedgerCard key={scenario.id} scenario={scenario} />)}
      </div>
    </section>
  );
}
