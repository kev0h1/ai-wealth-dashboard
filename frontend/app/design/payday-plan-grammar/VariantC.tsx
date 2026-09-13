import type { PaydayScenario } from "./fixtures";
import { AccountStack, Currency, DestinationList, Disclosure, DownArrow, PaydayCard, PreviewHeading, Remaining, SalarySource } from "./shared";

export default function VariantC({ scenario }: { scenario: PaydayScenario }) {
  const visible = scenario.destinations.slice(0, 2);
  const hidden = scenario.destinations.slice(2);
  const shownTotal = visible.reduce((sum, destination) => sum + destination.move, 0);
  return <section aria-label="Variant C, ranked handoff"><PreviewHeading title="C · Ranked handoff" copy="The two largest allocations stay visible. The remaining accounts keep their real identity in a compact, scalable handoff." /><PaydayCard scenario={scenario}><div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 dark:border-slate-700 dark:bg-slate-900/30"><SalarySource salary={scenario.salary} /><div className="flex justify-center"><DownArrow /></div><div data-destination-summary className="flex items-center gap-2.5 pb-1"><AccountStack accounts={scenario.destinations} size={28} /><div><p className="text-[13px] font-semibold text-slate-900 dark:text-white">{scenario.destinations.length} accounts</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{scenario.destinations.length - visible.length} more after the largest two</p></div></div><div data-destination-list><DestinationList destinations={visible} /></div></div><Disclosure label={`See ${hidden.length} more destination accounts`}><DestinationList destinations={hidden} /></Disclosure><p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400"><Currency value={shownTotal} /> shown first · all destinations remain part of the total.</p><Remaining scenario={scenario} /></PaydayCard></section>;
}
