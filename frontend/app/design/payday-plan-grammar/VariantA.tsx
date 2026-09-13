import type { PaydayScenario } from "./fixtures";
import { AccountStack, Currency, DestinationList, Disclosure, DownArrow, PaydayCard, PreviewHeading, Remaining, SalarySource } from "./shared";

function FanOut({ scenario }: { scenario: PaydayScenario }) {
  return <PaydayCard scenario={scenario}><div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/30"><SalarySource salary={scenario.salary} /><div className="flex flex-col items-center"><DownArrow /><div data-destination-summary className="flex w-full items-center gap-2.5"><AccountStack accounts={scenario.destinations} size={28} /><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-slate-900 dark:text-white">{scenario.destinations.length} destination accounts</p><p className="text-[11px] text-slate-500 dark:text-slate-400"><Currency value={scenario.destinations.reduce((sum, dest) => sum + dest.move, 0)} /> allocated</p></div></div></div></div><Disclosure label={`See ${scenario.destinations.length} destination breakdowns`}><DestinationList destinations={scenario.destinations} /></Disclosure><Remaining scenario={scenario} /></PaydayCard>;
}

export default function VariantA({ scenario }: { scenario: PaydayScenario }) { return <section aria-label="Variant A, fan-out summary"><PreviewHeading title="A · Fan-out summary" copy="One spatial handoff from expected pay to every destination, with the account-level audit trail one tap away." /><FanOut scenario={scenario} /></section>; }
