"use client";
import { useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { DateField } from "@/components/DatePicker";
import { PlanAffordability, PlanContribution } from "@/components/plans/PlanEditorSummary";
import type { Account } from "@/lib/api";
import { CATEGORIES, type Action, type Draft, type Saved, type Scenario, type Step, type ViewFacts, COPY, money, monthLabel, parseMoney } from "./model";
export interface ScreenProps {
    step: Step;
    draft: Draft;
    saved: Saved;
    scenario: Scenario;
    facts: ViewFacts;
    sources: Account[];
    destinations: Account[];
    editing: boolean;
    error: string;
    result: "saved" | "paused" | "deleted" | "resumed";
    onDraft: (patch: Partial<Draft>) => void;
    onAction: (action: Action) => void;
}
type ButtonTone = "primary" | "quiet" | "danger";
export function Button({ children, action, onAction, tone = "primary", disabled = false, className = "" }: {
    children: ReactNode;
    action: Action;
    tone?: ButtonTone;
    disabled?: boolean;
    className?: string;
} & Pick<ScreenProps, "onAction">) {
    const skin = tone === "primary"
        ? "bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-700"
        : tone === "danger"
            ? "border border-red-700 bg-red-700 text-white hover:bg-red-800 dark:border-red-500/20 dark:bg-red-500/20 dark:text-red-200 dark:hover:bg-red-500/30"
            : "border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
    return <button type="button" data-g291-action={action} onClick={() => onAction(action)} disabled={disabled} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none ${tone === "primary" ? "w-full" : ""} ${skin} ${className}`}>{children}</button>;
}
function AccountIdentity({ account, lead }: {
    account?: Account;
    lead: string;
}) {
    if (!account)
        return <p className="text-sm text-slate-600 dark:text-slate-300">No account selected</p>;
    const brand = accountBrand(account);
    return <div className="flex min-w-0 items-center gap-3"><BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background}/><span className="min-w-0"><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{lead} {account.name}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{account.provider}</span></span></div>;
}
function MoneyInput({ id, label, value, onChange, placeholder }: {
    id: string;
    label: string;
    value: number;
    onChange: (pence: number) => void;
    placeholder?: string;
}) {
    const [raw, setRaw] = useState(Number.isFinite(value) ? String(value / 100) : "");
    return <div><label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label} (£)</label><input id={id} name={id} data-g291-field={id} autoComplete="off" inputMode="decimal" value={raw} placeholder={placeholder} onChange={(event) => { setRaw(event.target.value); onChange(parseMoney(event.target.value)); }} className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-mono tabular-nums text-slate-900 outline-none placeholder:font-sans placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400"/></div>;
}
function Affordability({ facts, onAction }: Pick<ScreenProps, "facts" | "onAction">) {
    if (facts.shortfallPence == null)
        return null;
    return <PlanAffordability caution><span><MoneyText text={`${money(facts.shortfallPence)} short`}/> in a typical month after debt payments. <button type="button" data-g291-action="lower-target" onClick={() => onAction("lower-target")} className="min-h-11 font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Lower target</button> or <button type="button" data-g291-action="later-date" onClick={() => onAction("later-date")} className="min-h-11 font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Later date</button>.</span></PlanAffordability>;
}
function cadenceLabel(cadence: Draft["cadence"]) { return cadence === "once" ? "once" : "each pay period"; }
function GoalAmount({ amount, progress, periods }: { amount: number | null; progress: { current: number; target: number }; periods: number }) {
    if (!Number.isFinite(progress.target) || progress.target <= 0)
        return <p className="text-sm text-slate-600 dark:text-slate-300">Add an amount above £0 to see your plan.</p>;
    if (amount != null)
        return <div className="space-y-1"><PlanContribution amount={amount} cadence="estimated each pay period" progress={progress}/><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Based on {periods} future monthly pay {periods === 1 ? "period" : "periods"} in this example.</p></div>;
    const percent = progress.target > 0 ? Math.min(100, Math.max(0, progress.current / progress.target * 100)) : 0;
    return <section aria-label="Goal progress" className="pb-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Progress</p><p className="mt-1 text-sm text-slate-700 dark:text-slate-200"><MoneyText text={`${money(Math.round(progress.current * 100))} set aside of ${money(Math.round(progress.target * 100))}`}/></p><div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={Math.min(progress.current, progress.target)} className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${percent}%` }}/></div></section>;
}
export function JourneyBody(props: ScreenProps) {
    const { step, draft, saved, scenario, facts, sources, destinations, error, onDraft, onAction } = props;
    const source = facts.source;
    const destination = facts.destination;
    const contribution = facts.slicePence == null ? null : facts.slicePence / 100;
    const goalProgress = { current: facts.progressPence / 100, target: draft.targetPence / 100 };
    let content: ReactNode;
    if (step === "purpose") {
        const example = draft.kind === "goal" ? "Japan trip" : "Groceries";
        const helper = draft.kind === "goal" ? "For example, save £2,000 for a trip to Japan in December 2028." : "For example, set aside £300 for groceries each pay period.";
        content = <div><label htmlFor="plan-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</label><input id="plan-name" name="plan-name" data-g291-field="name" autoComplete="off" maxLength={80} value={draft.name} onChange={(event) => onDraft({ name: event.target.value })} placeholder={example} className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400"/><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{helper}</p></div>;
    }
    else if (step === "kind") {
        content = <div className="grid gap-3"><button type="button" data-g291-action="choose-goal" onClick={() => onAction("choose-goal")} className="min-h-24 rounded-2xl border border-slate-200 px-4 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:bg-indigo-950/30"><strong className="block text-base text-slate-900 dark:text-slate-100">Goal</strong><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">Save £2,000 for a trip to Japan in December 2028.</span></button><button type="button" data-g291-action="choose-aside" onClick={() => onAction("choose-aside")} className="min-h-24 rounded-2xl border border-slate-200 px-4 py-4 text-left hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:bg-indigo-950/30"><strong className="block text-base text-slate-900 dark:text-slate-100">Set-aside</strong><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">Set aside £300 for groceries each pay period.</span></button></div>;
    }
    else if (step === "target") {
        content = <div className="space-y-4"><MoneyInput id="target" label="Target amount" value={draft.targetPence} placeholder="e.g. 2000…" onChange={(targetPence) => onDraft({ targetPence })}/><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">For example, £2,000 for a Japan trip by December 2028.</p><div><label htmlFor="target-month" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Target month</label><DateField id="target-month" mode="month" value={draft.month} onChange={(month) => onDraft({ month })} min="2026-11" today="2026-10-19" label="Target month"/></div><GoalAmount amount={contribution} progress={goalProgress} periods={facts.periodsLeft}/><Affordability facts={facts} onAction={onAction}/></div>;
    }
    else if (step === "amount") {
        content = <div className="space-y-4"><MoneyInput id="amount" label="Amount" value={draft.amountPence} placeholder="e.g. 300…" onChange={(amountPence) => onDraft({ amountPence })}/><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">For example, set aside £300 for groceries each pay period.</p><div role="group" aria-label="How often"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">How often</p><div className="flex gap-2"><button type="button" aria-pressed={draft.cadence === "every_period"} onClick={() => onDraft({ cadence: "every_period" })} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50 aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:bg-indigo-950/30 dark:aria-pressed:bg-indigo-950/40">Each pay period</button><button type="button" aria-pressed={draft.cadence === "once"} onClick={() => onDraft({ cadence: "once" })} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50 aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:bg-indigo-950/30 dark:aria-pressed:bg-indigo-950/40">Once</button></div></div></div>;
    }
    else if (step === "source") {
        content = sources.length === 0 ? <p className="text-sm text-slate-700 dark:text-slate-200">Add a current account from Accounts before you save this plan.</p> : <div className="space-y-4">{sources.length === 1 ? <AccountIdentity account={sources[0]} lead="Pay from"/> : <AccountRadioPicker accounts={sources} value={draft.sourceId} onChange={(sourceId) => onDraft({ sourceId })} label="Pay from"/>}{!draft.sourceConfirmed && draft.sourceId && <PlanAffordability>{COPY.sourceHint}</PlanAffordability>}</div>;
    }
    else if (step === "destination") {
        content = draft.kind === "goal" ? destinations.length ? <div className="space-y-4"><AccountRadioPicker accounts={destinations} value={draft.destinationId} onChange={(destinationId) => onDraft({ destinationId })} label="Save in"/><label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" data-g291-field="include-existing" checked={draft.includeExisting} disabled={facts.availablePotPence <= 0} onChange={(event) => onDraft({ includeExisting: event.target.checked })} className="mt-1 size-4 rounded border-slate-300 accent-indigo-600 focus:ring-indigo-500 disabled:opacity-50"/><span><strong className="block text-slate-900 dark:text-slate-100">Include money already in this pot</strong><span className="mt-1 block leading-5 text-slate-600 dark:text-slate-300">{facts.availablePotPence > 0 ? `${money(facts.availablePotPence)} is free to count towards this goal. Money allocated to other goals is not included.` : destination?.manual ? "Update this offline pot's balance before you can include money already there." : "This pot has no free balance to include after other goal claims."}</span></span></label></div> : <p className="text-sm text-slate-700 dark:text-slate-200">There is no savings account available for this goal yet.</p> : <div className="space-y-4"><button type="button" aria-pressed={!draft.destinationId} onClick={() => onDraft({ destinationId: "" })} className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold hover:border-indigo-300 hover:bg-indigo-50 aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:hover:bg-indigo-950/30 dark:aria-pressed:bg-indigo-950/40">{COPY.here}</button>{destinations.length > 0 ? <><p className="text-sm text-slate-600 dark:text-slate-300">You can use another account instead.</p><AccountRadioPicker accounts={destinations} value={draft.destinationId} onChange={(destinationId) => onDraft({ destinationId })} label={COPY.another}/></> : <p className="text-sm text-slate-600 dark:text-slate-300">No other account is available, so this money stays here.</p>}</div>;
    }
    else if (step === "tracking") {
        const candidateName = draft.kind === "goal" ? "Holiday" : (draft.name || "Set-aside");
        const candidateAmount = draft.kind === "goal" ? 10000 : draft.amountPence;
        const scope = draft.kind === "set-aside" && !draft.destinationId ? `your ${source?.name ?? "paying account"}` : `${source?.name ?? "your paying account"} to ${destination?.name ?? "the selected pot"}`;
        const selectedCategory = CATEGORIES.find(category => category.id === draft.categoryId) ?? CATEGORIES[0];
        const transferScope = draft.kind === "goal" || Boolean(draft.destinationId);
        const rule = transferScope
            ? "Only verified transfers into the selected pot are shown. Spending is never counted as saving."
            : `This shows ${selectedCategory.label.toLowerCase()} spending, net of refunds. It does not move or set aside money.`;
        content = <div className="space-y-4"><fieldset className="space-y-2"><legend className="sr-only">Tracking method</legend><label data-g291-tracking="payment" className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name="tracking" checked={draft.trackingMode === "payment"} onChange={() => onDraft({ trackingMode: "payment", trackingConfirmed: false, categoryId: "" })} className="mt-1 accent-indigo-600 focus:ring-indigo-500"/><span><strong className="block text-sm text-slate-900 dark:text-slate-100">A payment</strong><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">{facts.hasCandidate ? `Suggested: ${candidateName} ${money(candidateAmount)}.` : "Match a payment you recognise."}</span></span></label><label data-g291-tracking="category" className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name="tracking" checked={draft.trackingMode === "category"} onChange={() => onDraft({ trackingMode: "category", trackingConfirmed: false, customMatch: "", categoryId: draft.kind === "goal" || draft.destinationId ? "savings" : "groceries" })} className="mt-1 accent-indigo-600 focus:ring-indigo-500"/><span><strong className="block text-sm text-slate-900 dark:text-slate-100">A category</strong><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">See all matching activity in this pay period.</span></span></label><label data-g291-tracking="none" className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name="tracking" checked={draft.trackingMode === "none"} onChange={() => onDraft({ trackingMode: "none", trackingConfirmed: false, customMatch: "" })} className="mt-1 accent-indigo-600 focus:ring-indigo-500"/><span><strong className="block text-sm text-slate-900 dark:text-slate-100">Not now</strong><span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">You can add tracking later.</span></span></label></fieldset>{draft.trackingMode === "payment" && <div className="rounded-xl bg-slate-50 p-3 text-sm leading-5 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{facts.hasCandidate ? <>Suggested past payment: {candidateName} <MoneyText text={money(candidateAmount)}/> from {scope}.</> : <><p>{COPY.noHistory}</p><label htmlFor="custom-match" className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment name, optional</label><input id="custom-match" name="custom-match" data-g291-field="custom-match" autoComplete="off" value={draft.customMatch} onChange={(event) => onDraft({ customMatch: event.target.value, trackingConfirmed: false })} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"/></>}</div>}{draft.trackingMode === "category" && <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><fieldset data-g291-category-picker className="min-w-0"><legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Category</legend><div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900">{CATEGORIES.map(category => { const Icon = getCategoryIcon(category.label); const colour = getCategoryColour(category.label); return <label key={category.id} data-g291-category={category.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-t border-slate-200 px-3 py-2 first:border-t-0 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500 dark:border-slate-600 dark:hover:bg-slate-800"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ color: colour, backgroundColor: colour + "26" }}><Icon size={16}/></span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{category.label}</span><input type="radio" name="tracking-category" value={category.id} checked={draft.categoryId === category.id} onChange={() => onDraft({ categoryId: category.id, trackingConfirmed: false })} className="size-4 shrink-0 accent-indigo-600"/></label>; })}</div></fieldset><div className="text-sm text-slate-700 dark:text-slate-200">{transferScope ? <p className="flex items-baseline justify-between gap-3"><span>{facts.categoryCount} {facts.categoryCount === 1 ? "transfer" : "transfers"}</span><strong className="font-mono tabular-nums">{money(facts.categoryPence)}</strong></p> : <dl className="space-y-2"><div className="flex items-baseline justify-between gap-3"><dt>{facts.categoryPurchaseCount} {facts.categoryPurchaseCount === 1 ? "purchase" : "purchases"}</dt><dd className="font-mono tabular-nums">{money(facts.categoryGrossPence)}</dd></div><div className="flex items-baseline justify-between gap-3"><dt>Refunds</dt><dd className="font-mono tabular-nums">{money(-facts.categoryRefundPence)}</dd></div><div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-600"><dt>{facts.categoryPence < 0 ? "Net refund this pay period" : "Used this pay period"}</dt><dd className="font-mono tabular-nums">{money(facts.categoryPence)}</dd></div></dl>}<p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">1–31 October 2026 · {scope}</p></div><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{rule} Category tracking is a proposed design capability, not live account behaviour.</p></div>}</div>;
    }
    else if (step === "setup" || step === "review" || step === "edit") {
        const goal = draft.kind === "goal";
        const setAsideLocation = draft.destinationId ? `moving to ${destination?.name ?? "another account"}` : "kept here";
        const trackingLabel = draft.trackingMode === "category" ? draft.trackingConfirmed ? `${facts.categoryLabel} category · ${facts.categoryCount} transactions` : `Confirm ${facts.categoryLabel} category` : draft.trackingMode === "payment" ? (draft.trackingConfirmed ? "Payment confirmed" : "Payment to confirm") : "Not linked yet";
        const routeHelp = !goal && !draft.destinationId && sources.length > 0 && destinations.length > 0
            ? <button type="button" data-g291-action="edit-destination" onClick={() => onAction("edit-destination")} className="min-h-11 text-left text-sm font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Use another account instead</button> : null;
        content = <div className="min-w-0 space-y-5"><div className="min-w-0 space-y-1"><button type="button" data-g291-action="edit-name" onClick={() => onAction("edit-name")} className="min-h-11 max-w-full min-w-0 break-words text-left text-lg font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">{draft.name || "Name this plan"}</button><p className="text-sm text-slate-600 dark:text-slate-300">{goal ? `${money(draft.targetPence)} by ${monthLabel(draft.month)}` : `${money(draft.amountPence)} ${cadenceLabel(draft.cadence)}, ${setAsideLocation}`}</p><button type="button" data-g291-action="edit-target" onClick={() => onAction("edit-target")} className="min-h-11 text-sm font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{goal ? "Change target" : "Change amount"}</button></div>{goal ? <><GoalAmount amount={contribution} progress={goalProgress} periods={facts.periodsLeft}/>{draft.includeExisting && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Includes {money(facts.availablePotPence)} already free in {destination?.name ?? "this pot"}.</p>}</> : <div className="space-y-1"><PlanContribution amount={draft.amountPence / 100} cadence={cadenceLabel(draft.cadence)}/></div>}<div className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700"><button type="button" data-g291-action="edit-source" onClick={() => onAction("edit-source")} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="text-slate-500 dark:text-slate-400">Pay from</span><strong className="text-right text-slate-900 dark:text-slate-100">{source ? source.name : "Choose an account"}</strong></button><button type="button" data-g291-action="edit-destination" onClick={() => onAction("edit-destination")} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="text-slate-500 dark:text-slate-400">{goal ? "Save in" : "Money"}</span><strong className="text-right text-slate-900 dark:text-slate-100">{goal ? destination?.name ?? "Choose an account" : draft.destinationId ? `Move to ${destination?.name}` : "Stays here"}</strong></button><button type="button" data-g291-action="edit-tracking" onClick={() => onAction("edit-tracking")} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="text-slate-500 dark:text-slate-400">Tracking</span><strong className="text-right text-slate-900 dark:text-slate-100">{trackingLabel}</strong></button></div>{!source ? <p className="text-sm text-slate-700 dark:text-slate-200">Choose a paying account to continue.</p> : !draft.sourceConfirmed ? <Button onAction={onAction} action="confirm-source" tone="quiet">Confirm {source.provider}</Button> : null}<Affordability facts={facts} onAction={onAction}/><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{COPY.noMove} {COPY.standingOrder}</p></div>;
        if (routeHelp) content = <>{content}{routeHelp}</>;
    }
    else if (step === "view") {
        const goal = draft.kind === "goal";
        const heldAmount = facts.reservePence ?? 0;
        const percent = draft.targetPence > 0 ? Math.min(100, facts.progressPence / draft.targetPence * 100) : 0;
        const transferScope = goal || Boolean(draft.destinationId);
        content = <div data-g291-view-layout className="min-w-0 space-y-5">
            {saved.status === "paused" && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Paused</p>}
            <div data-g291-view-summary className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 max-[359px]:grid-cols-1">
                <PlanContribution amount={goal ? contribution : (source ? heldAmount : draft.amountPence) / 100} cadence={goal ? "estimated each pay period" : source ? "held back" : "planned"}/>
                <div className="max-w-36 justify-self-end text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{goal ? "Target" : "How often"}</p>
                    {goal ? <><p className="mt-2 font-mono text-[19px] font-bold tabular-nums text-slate-900 dark:text-slate-100"><MoneyText text={money(draft.targetPence)}/></p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{monthLabel(draft.month)}</p></> : <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{cadenceLabel(draft.cadence)}</p>}
                </div>
            </div>
            {goal && <div data-g291-view-progress className="space-y-2">
                <div className="flex items-baseline justify-between gap-3 text-xs text-slate-600 dark:text-slate-300"><span>Set aside</span><MoneyText text={money(facts.progressPence) + " of " + money(draft.targetPence) + " set aside"}/></div>
                <div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={draft.targetPence} aria-valuenow={Math.min(facts.progressPence,draft.targetPence)} aria-valuetext={money(facts.progressPence) + " of " + money(draft.targetPence)} className="h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-indigo-600" style={{ width: percent + "%" }}/></div>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Based on {facts.periodsLeft} future monthly pay {facts.periodsLeft === 1 ? "period" : "periods"} in this example.</p>
                {draft.includeExisting && <p className="text-xs text-slate-600 dark:text-slate-300"><MoneyText text={money(facts.availablePotPence) + " already free in this pot is included."}/></p>}
            </div>}
            <dl data-g291-view-accounts className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 py-3"><dt className="text-slate-600 dark:text-slate-300">Pay from</dt><dd className="min-w-0">{source ? <AccountIdentity account={source} lead=""/> : <span className="text-slate-700 dark:text-slate-200">Choose a paying account before this amount is held back.</span>}</dd></div>
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 py-3"><dt className="text-slate-600 dark:text-slate-300">{goal ? "Save in" : "Money"}</dt><dd className="min-w-0">{destination ? <AccountIdentity account={destination} lead=""/> : <span className="font-semibold text-slate-900 dark:text-slate-100">{goal ? "Choose a savings account" : "Stays here"}</span>}</dd></div>
            </dl>
            <section aria-label="Plan tracking" className="space-y-2">
                <div className="flex min-w-0 items-baseline justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tracking</h3><strong className="min-w-0 break-words text-right text-sm text-slate-900 dark:text-slate-100">{draft.trackingMode === "category" ? facts.categoryLabel + " category tracking" : draft.trackingMode === "payment" && draft.trackingConfirmed ? "Payment confirmed" : "Not linked yet"}</strong></div>
                {draft.trackingMode === "category" && <><p className="text-sm text-slate-700 dark:text-slate-200"><MoneyText text={transferScope ? facts.categoryCount + (facts.categoryCount === 1 ? " transfer · " : " transfers · ") + money(facts.categoryPence) + " this pay period" : money(facts.categoryGrossPence) + " spent, " + money(facts.categoryRefundPence) + " refunded, " + money(facts.categoryPence) + " net this pay period"}/></p><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Category tracking is proposed in this preview. It does not change the amount held back.</p></>}
            </section>
            {scenario === "offline" && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">That pot is offline, so its balance may need an update.</p>}
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{COPY.noMove} {COPY.standingOrder}</p>
            {goal && <p className="text-xs text-slate-600 dark:text-slate-300">Goal pause is proposed in this preview.</p>}
        </div>;
    }
    else if (step === "pause" || step === "delete") {
        const deleting = step === "delete";
        content = <div className="space-y-3"><p className="text-sm text-slate-700 dark:text-slate-200">{deleting ? COPY.deleteHelp : COPY.pauseHelp}</p><p className="text-sm text-slate-600 dark:text-slate-300">{COPY.noMove} {COPY.standingOrder}</p></div>;
    }
    else {
        const message = props.result === "deleted" ? "It no longer appears in Sorted." : props.result === "paused" ? "Your plan is paused in Sorted." : props.result === "resumed" ? "Your plan is active again." : "Your plan is ready to view.";
        content = <p className="text-sm text-slate-700 dark:text-slate-200">{message}</p>;
    }
    return <div data-g291-step={step} className="space-y-4 text-[13px] leading-5 [&_[aria-label=Contribution]_p:nth-child(2)]:!block [&_[aria-label=Contribution]_p:nth-child(2)>span:last-child]:!mt-1 [&_[aria-label=Contribution]_p:nth-child(2)>span:last-child]:!block">{error && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{error}</p>}{content}{draft.kind === "set-aside" && ["setup", "review", "edit", "view"].includes(step) && <p data-g291-planned-caveat className="text-xs leading-5 text-slate-600 dark:text-slate-300">Check Upcoming to see if it fits before payday.</p>}</div>;
}
export function JourneyFooter(props: ScreenProps) {
    const { step, draft, facts, sources, onAction } = props;
    if (step === "kind")
        return null;
    if (step === "view")
        return <div data-g291-view-actions className="w-full space-y-2"><Button onAction={onAction} action="edit"><Pencil size={16} aria-hidden="true"/> Edit plan</Button><div className="grid grid-cols-2 gap-2"><Button onAction={onAction} action={props.saved.status === "paused" ? "resume" : "pause"} tone="quiet" className="w-full">{props.saved.status === "paused" ? "Resume plan" : "Pause plan"}</Button><Button onAction={onAction} action="delete" tone="danger" className="w-full"><Trash2 size={16} aria-hidden="true"/> Delete plan</Button></div></div>;
    if (step === "setup")
        return <Button onAction={onAction} action="next-setup" disabled={!facts.canStartTracking}>Continue to tracking</Button>;
    if (step === "purpose")
        return <Button onAction={onAction} action="next-purpose" disabled={!draft.name.trim()}>Next</Button>;
    if (step === "target" || step === "amount")
        return <Button onAction={onAction} action="next-details">Next</Button>;
    if (step === "source")
        return sources.length ? <Button onAction={onAction} action="confirm-source" disabled={!draft.sourceId}>Use {facts.source?.provider ?? sources[0]?.provider ?? "account"}</Button> : null;
    if (step === "destination")
        return <Button onAction={onAction} action="confirm-destination" disabled={draft.kind === "goal" && !draft.destinationId}>Continue</Button>;
    if (step === "tracking")
        return <Button onAction={onAction} action="confirm-tracking">Continue</Button>;
    if (step === "review" || step === "edit")
        return <Button onAction={onAction} action="save" disabled={!facts.canSave}>{props.editing ? "Save changes" : "Save plan"}</Button>;
    if (step === "pause" || step === "delete")
        return <div className="flex gap-2"><Button onAction={onAction} action="back" tone="quiet">Back</Button><Button onAction={onAction} action={step === "pause" ? "confirm-pause" : "confirm-delete"} tone={step === "delete" ? "danger" : "primary"}>{step === "pause" ? "Pause plan" : "Delete plan"}</Button></div>;
    return <div className="flex gap-2"><Button onAction={onAction} action="close" tone="quiet">Close</Button>{props.result !== "deleted" && <Button onAction={onAction} action="view-result">View plan</Button>}</div>;
}
