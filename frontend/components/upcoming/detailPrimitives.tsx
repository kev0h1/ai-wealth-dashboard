"use client";

import { Target, Wallet, type LucideIcon } from "lucide-react";
import type { Plan } from "@/lib/upcomingPlans";
import { money, dateLabel } from "@/lib/upcomingPlans";
export { money, dateLabel };

export const detailFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
export const detailInk = "font-mono tabular-nums text-slate-950 dark:text-slate-50";
export const detailMuted = "text-slate-600 dark:text-slate-400";

export function PlanIcon({ kind }: { kind: Plan["kind"] }) {
  const Icon = kind === "goal" ? Target : Wallet;
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon size={18} aria-hidden="true" /></span>;
}

export function CategoryIcon({ Icon, colour }: { Icon: LucideIcon; colour: string }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${colour}26` }}><Icon size={18} style={{ color: colour }} aria-hidden="true" /></span>;
}

export function DetailLedgerLine({ label, pence, total = false, positive = false }: { label: string; pence: number | null; total?: boolean; positive?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 py-2 ${total ? "border-t border-slate-200 font-semibold dark:border-slate-700" : ""}`}>
    <dt className={total ? "text-slate-900 dark:text-slate-100" : detailMuted}>{label}</dt>
    <dd className={`shrink-0 text-right ${detailInk}`}>{pence === null ? "Unavailable" : money(pence, positive)}</dd>
  </div>;
}
