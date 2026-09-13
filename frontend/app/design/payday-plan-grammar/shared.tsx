import type { ReactNode } from "react";
import { ArrowDown, ChevronDown, WalletCards } from "lucide-react";
import type { PaydayPlanDest, PaydayPlanSalary } from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import { AccountBadge, AccountStack, Currency } from "../move-card-grammar/shared";
import type { PaydayScenario } from "./fixtures";
import { totalMoving } from "./fixtures";

type AccountIdentity = Pick<PaydayPlanSalary, "name" | "provider">;

export { AccountBadge, AccountStack, Currency };

export function PaydayCard({ scenario, children }: { scenario: PaydayScenario; children: ReactNode }) {
  const moving = totalMoving(scenario);
  return (
    <article data-payday-plan-card={scenario.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><WalletCards size={17} aria-hidden="true" /></span>
          <div className="min-w-0">
            <span className="inline-flex h-6 items-center gap-1 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 px-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-white"><PennyMark size={11} />Penny</span>
            <h2 className="mt-1 text-[15px] font-bold leading-5 text-slate-950 dark:text-white">Your payday plan</h2>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">After your expected pay on {scenario.payday}, this is where the money will go.</p>
        <div data-payday-totals className="mt-3 flex items-end justify-between gap-3">
          <div data-total-moving={moving}><Currency value={moving} className="text-[24px] font-bold tracking-tight text-slate-950 dark:text-white" /><p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">total moving</p></div>
          <p className="pb-1 text-right text-[12px] leading-4 text-slate-500 dark:text-slate-400"><Currency value={scenario.salary.amount} prefix="~" /> expected pay</p>
        </div>
        {children}
      </div>
      <footer className="border-t border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/25"><button type="button" className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white [-webkit-tap-highlight-color:transparent] transition-[transform,background-color] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 hover:bg-indigo-700 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800">See the full plan</button></footer>
    </article>
  );
}

export function SalarySource({ salary }: { salary: PaydayPlanSalary }) {
  return <div data-salary-source data-salary-amount={salary.amount} className="flex min-h-12 items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900/35"><AccountBadge account={salary as AccountIdentity} size={32} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{salary.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">expected pay</p></div><Currency value={salary.amount} prefix="~" className="shrink-0 text-[13px] font-semibold text-slate-950 dark:text-white" /></div>;
}

export function DestinationRow({ destination }: { destination: PaydayPlanDest }) {
  const parts: { key: string; amount?: number; label: string }[] = [];
  if (destination.bills_total) parts.push({ key: "payments", amount: destination.bills_total, label: "payments" });
  if (destination.spend_typical) parts.push({ key: "spending", amount: destination.spend_typical, label: "spending" });
  if (destination.buffer) parts.push({ key: "buffer", amount: destination.buffer, label: "buffer" });
  if (destination.commitment_names?.[0]) parts.push({ key: "commitment", label: `${destination.commitment_names[0]} commitment` });
  return <div data-destination-row data-destination-move={destination.move} className="flex min-h-12 items-center gap-2.5 py-2"><AccountBadge account={destination as AccountIdentity} size={32} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{destination.name}</p><p className="truncate text-[11px] leading-4 text-slate-500 dark:text-slate-400">{parts.map((part, index) => <span key={part.key}>{index > 0 ? " · " : null}{part.amount !== undefined ? <><Currency value={part.amount} /> {part.label}</> : part.label}</span>)}</p></div><Currency value={destination.move} className="shrink-0 text-[13px] font-semibold text-slate-950 dark:text-white" /></div>;
}

export function DestinationList({ destinations }: { destinations: readonly PaydayPlanDest[] }) {
  return <div data-destination-list className="divide-y divide-slate-100 dark:divide-slate-700">{destinations.map((destination) => <DestinationRow key={destination.account_id} destination={destination} />)}</div>;
}

export function DownArrow() { return <span className="my-1 grid size-7 place-items-center self-center rounded-full border border-slate-200 bg-white text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300"><ArrowDown size={14} aria-hidden="true" /></span>; }

export function Remaining({ scenario }: { scenario: PaydayScenario }) { return <p data-stays={scenario.salary.stays} className="mt-3 text-[12px] leading-5 text-slate-500 dark:text-slate-400"><Currency value={scenario.salary.stays} /> stays in {scenario.salary.name}.</p>; }

export function Disclosure({ label, children }: { label: string; children: ReactNode }) { return <details data-destination-disclosure className="group mt-2 rounded-xl border border-slate-100 dark:border-slate-700"><summary className="flex min-h-11 cursor-pointer list-none touch-manipulation items-center justify-between gap-3 rounded-xl px-3 text-[12px] font-semibold text-slate-700 [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none [&::-webkit-details-marker]:hidden dark:text-slate-200 dark:hover:bg-white/[0.04]"><span>{label}</span><ChevronDown size={15} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary><div className="border-t border-slate-100 px-3 dark:border-slate-700">{children}</div></details>; }

export function PreviewHeading({ title, copy }: { title: string; copy: string }) { return <div className="mb-3 px-1"><h2 className="text-pretty text-base font-bold text-slate-950 dark:text-white">{title}</h2><p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{copy}</p></div>; }
