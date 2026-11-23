"use client";

import { useState, type FormEvent } from "react";
import { SheetFrame } from "@/components/SheetFrame";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import type { PlanPreviewItem } from "./PlanPreview.types";
import type { PreviewAccount } from "./types";
import { Money, MoneyCopy, bankLabel, accountLabel, dateLabel, focusClass, quietClass } from "./ui";

export type PreviewDetail = { kind: "plan"; item: PlanPreviewItem } | { kind: "payment"; item: UpcomingRowModel } | { kind: "add" };

const fieldClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function AddPlan({ onAdd }: { onAdd: (item: PlanPreviewItem) => void }) {
  const [kind, setKind] = useState<PlanPreviewItem["kind"]>("set-aside");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const pence = Math.round(Number(amount) * 100);
    if (!name.trim() || !Number.isFinite(pence) || pence <= 0) return;
    onAdd({ id: `draft-${crypto.randomUUID()}`, name: name.trim(), kind, sourceId: null, sourceBasis: "unknown", periodPence: pence, filledPence: 0, remainingPence: pence, state: "active" });
  };
  return <form id="add-preview-plan" onSubmit={submit} className="space-y-4">
    <p className={`text-sm leading-6 ${quietClass}`}>Try a name and an amount for this pay period. This creates a local example.</p>
    <label className="block text-sm font-semibold">Type<select name="plan-kind" value={kind} onChange={event => setKind(event.target.value as PlanPreviewItem["kind"])} className={`mt-2 ${fieldClass}`}><option value="set-aside">Set-aside</option><option value="goal">Goal contribution</option></select></label>
    <label className="block text-sm font-semibold">Name<input name="plan-name" autoComplete="off" required value={name} onChange={event => setName(event.target.value)} className={`mt-2 ${fieldClass}`} /></label>
    <label className="block text-sm font-semibold">Amount this period (£)<input name="plan-amount" inputMode="decimal" type="number" min="0.01" step="0.01" autoComplete="off" required value={amount} onChange={event => setAmount(event.target.value)} className={`mt-2 ${fieldClass}`} /></label>
    <p className={`text-xs leading-5 ${quietClass}`}>A new example has no paying account. It is not included in an account’s available figure.</p>
  </form>;
}

function PlanDetails({ item, accounts, selected, onSelect }: { item: PlanPreviewItem; accounts: PreviewAccount[]; selected: string; onSelect: (id: string) => void }) {
  const source = accounts.find(account => account.id === item.sourceId);
  return <div className="space-y-5">
    <dl className="space-y-3 text-sm">
      <div className="flex justify-between gap-4"><dt>{item.state === "pending" ? "Amount when it starts" : "Amount for this period"}</dt><dd><Money value={item.periodPence} /></dd></div>
      <div className="flex justify-between gap-4"><dt>Already set aside</dt><dd><Money value={item.filledPence} /></dd></div>
      <div className="flex justify-between gap-4"><dt>Still to reserve</dt><dd><Money value={item.remainingPence} /></dd></div>
    </dl>
    {item.state === "pending" && <p className={`text-sm leading-6 ${quietClass}`}>Starts {item.startsLabel ?? "next period"}. Nothing is reserved yet.</p>}
    {source ? <p className={`text-sm leading-6 ${quietClass}`}>Paid from {bankLabel(source)} · {accountLabel(source)}{item.sourceBasis === "recent-transfers" ? " · estimated from recent transfers" : ""}.</p> : <fieldset><legend className="mb-3 text-sm font-semibold">Choose paying account</legend><div className="space-y-2">{accounts.filter(account => account.canPayPlan && account.status !== "checking").map(account => <label key={account.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 ${focusClass}`}><input type="radio" name="preview-plan-source" value={account.id} checked={selected === account.id} onChange={() => onSelect(account.id)} className="size-4 accent-indigo-600" /><span className="min-w-0 break-words">{bankLabel(account)} · {accountLabel(account)}</span></label>)}</div><p role="status" className={`mt-3 text-xs leading-5 ${quietClass}`}>{selected ? "Selected for this preview. Account figures stay unchanged." : "The choice stays in this example and is not saved to an account."}</p></fieldset>}
    {item.feedLabel && <p className={`text-xs leading-5 ${quietClass}`}>Matched payments: {item.feedLabel}.</p>}
  </div>;
}

export default function PreviewDetails({ view, accounts, dark, choices, onChoice, onAdd, onClose }: { view: PreviewDetail; accounts: PreviewAccount[]; dark: boolean; choices: Record<string, string>; onChoice: (planId: string, accountId: string) => void; onAdd: (item: PlanPreviewItem) => void; onClose: () => void }) {
  const title = view.kind === "add" ? "Add to this pay period" : view.item.name;
  return <SheetFrame title={title} description={view.kind === "plan" ? view.item.state === "pending" ? `Starts ${view.item.startsLabel ?? "later"}` : "This pay period" : view.kind === "add" ? "Fictional preview" : view.item.accountLabel} themeClass={dark ? "dark" : ""} onClose={onClose} footer={controls => view.kind === "add" ? <button type="submit" form="add-preview-plan" className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 ${focusClass}`}>Add to preview</button> : <button type="button" onClick={() => controls.close()} className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 ${focusClass}`}>Done</button>}>
    {controls => view.kind === "add" ? <AddPlan onAdd={item => { onAdd(item); controls.close(); }} /> : view.kind === "plan" ? <PlanDetails item={view.item} accounts={accounts} selected={choices[view.item.id] ?? ""} onSelect={id => onChoice(view.item.id, id)} /> : <div className="space-y-4 text-sm leading-6"><p className="text-[19px] font-bold"><Money value={Math.round(view.item.amount * 100) * (view.item.type === "income" ? 1 : -1)} /></p><p className={quietClass}>{dateLabel(view.item.expectedDate)} · {view.item.accountLabel}</p><p className={quietClass}><MoneyCopy text="Sample payment details. Your payments are not changed from this preview." /></p></div>}
  </SheetFrame>;
}
