"use client";
import { useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { DateField } from "@/components/DatePicker";
import { PlanAffordability, PlanContribution } from "@/components/plans/PlanEditorSummary";
import type { Account } from "@/lib/api";
import { type Action, type Draft, type Saved, type Scenario, type Step, type ViewFacts, COPY, money, monthLabel, parseMoney } from "./model";
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
function MoneyInput({ id, label, value, onChange }: {
    id: string;
    label: string;
    value: number;
    onChange: (pence: number) => void;
}) {
    const [raw, setRaw] = useState(Number.isFinite(value) ? String(value / 100) : "");
    return <div><label htmlFor={id} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label} (£)</label><input id={id} name={id} data-g291-field={id} autoComplete="off" inputMode="decimal" value={raw} onChange={(event) => { setRaw(event.target.value); onChange(parseMoney(event.target.value)); }} className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-mono tabular-nums text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"/></div>;
}
function Affordability({ facts, onAction }: Pick<ScreenProps, "facts" | "onAction">) {
    if (facts.shortfallPence == null)
        return null;
    return <PlanAffordability caution><span><MoneyText text={`${money(facts.shortfallPence)} short`}/> in a typical month after debt payments. <button type="button" data-g291-action="lower-target" onClick={() => onAction("lower-target")} className="min-h-11 font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Lower target</button> or <button type="button" data-g291-action="later-date" onClick={() => onAction("later-date")} className="min-h-11 font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Later date</button>.</span></PlanAffordability>;
}
function cadenceLabel(cadence: Draft["cadence"]) { return cadence === "once" ? "once" : "each pay period"; }
function GoalAmount({ amount, progress }: { amount: number | null; progress: { current: number; target: number } }) {
    if (!Number.isFinite(progress.target) || progress.target <= 0)
        return <p className="text-sm text-slate-600 dark:text-slate-300">Add an amount above £0 to see your plan.</p>;
    if (amount != null)
        return <PlanContribution amount={amount} cadence="estimated each pay period" progress={progress}/>;
    const percent = progress.target > 0 ? Math.min(100, Math.max(0, progress.current / progress.target * 100)) : 0;
    return <section aria-label="Goal progress" className="pb-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Progress</p><p className="mt-1 text-sm text-slate-700 dark:text-slate-200"><MoneyText text={`${money(Math.round(progress.current * 100))} set aside of ${money(Math.round(progress.target * 100))}`}/></p><div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={Math.min(progress.current, progress.target)} className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-indigo-600" style={{ width: `${percent}%` }}/></div><p className="mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300">This target needs a fresh forecast before it can show an estimated contribution.</p></section>;
}
export function JourneyBody(props: ScreenProps) {
    const { step, draft, saved, scenario, facts, sources, destinations, error, onDraft, onAction } = props;
    const source = facts.source;
    const destination = facts.destination;
    const contribution = facts.slicePence == null ? null : facts.slicePence / 100;
    const goalProgress = { current: facts.progressPence / 100, target: draft.targetPence / 100 };
    let content: ReactNode;
    if (step === "purpose") {
        content = <div><label htmlFor="plan-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</label><input id="plan-name" name="plan-name" data-g291-field="name" autoComplete="off" maxLength={80} value={draft.name} onChange={(event) => onDraft({ name: event.target.value })} placeholder="Holiday" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"/><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{COPY.purposeHelp}</p></div>;
    }
    else if (step === "kind") {
        content = <div className="grid gap-3"><button type="button" data-g291-action="choose-goal" onClick={() => onAction("choose-goal")} className="min-h-20 rounded-2xl border border-slate-200 px-4 py-4 text-left active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700"><strong className="block text-base text-slate-900 dark:text-slate-100">{COPY.goal}</strong><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">Choose an amount and a month.</span></button><button type="button" data-g291-action="choose-aside" onClick={() => onAction("choose-aside")} className="min-h-20 rounded-2xl border border-slate-200 px-4 py-4 text-left active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700"><strong className="block text-base text-slate-900 dark:text-slate-100">{COPY.aside}</strong><span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">Keep an amount available.</span></button></div>;
    }
    else if (step === "target") {
        content = <div className="space-y-4"><MoneyInput id="target" label="Target amount" value={draft.targetPence} onChange={(targetPence) => onDraft({ targetPence })}/><div><label htmlFor="target-month" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Target month</label><DateField id="target-month" mode="month" value={draft.month} onChange={(month) => onDraft({ month })} min="2026-11" today="2026-10-19" label="Target month"/></div><GoalAmount amount={contribution} progress={goalProgress}/><Affordability facts={facts} onAction={onAction}/></div>;
    }
    else if (step === "amount") {
        content = <div className="space-y-4"><MoneyInput id="amount" label="Amount" value={draft.amountPence} onChange={(amountPence) => onDraft({ amountPence })}/><div role="group" aria-label="How often"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">How often</p><div className="flex gap-2"><button type="button" aria-pressed={draft.cadence === "every_period"} onClick={() => onDraft({ cadence: "every_period" })} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/40">Each pay period</button><button type="button" aria-pressed={draft.cadence === "once"} onClick={() => onDraft({ cadence: "once" })} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/40">Once</button></div></div></div>;
    }
    else if (step === "source") {
        content = sources.length === 0 ? <p className="text-sm text-slate-700 dark:text-slate-200">Add a current account from Accounts before you save this plan.</p> : <div className="space-y-4">{sources.length === 1 ? <AccountIdentity account={sources[0]} lead="Pay from"/> : <AccountRadioPicker accounts={sources} value={draft.sourceId} onChange={(sourceId) => onDraft({ sourceId })} label="Pay from"/>}{!draft.sourceConfirmed && draft.sourceId && <PlanAffordability>{COPY.sourceHint}</PlanAffordability>}</div>;
    }
    else if (step === "destination") {
        content = draft.kind === "goal" ? destinations.length ? <AccountRadioPicker accounts={destinations} value={draft.destinationId} onChange={(destinationId) => onDraft({ destinationId })} label="Save in"/> : <p className="text-sm text-slate-700 dark:text-slate-200">There is no savings account available for this goal yet.</p> : <div className="space-y-4"><button type="button" aria-pressed={!draft.destinationId} onClick={() => onDraft({ destinationId: "" })} className="min-h-12 w-full rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/40">{COPY.here}</button>{destinations.length > 0 ? <><p className="text-sm text-slate-600 dark:text-slate-300">You can use another account instead.</p><AccountRadioPicker accounts={destinations} value={draft.destinationId} onChange={(destinationId) => onDraft({ destinationId })} label={COPY.another}/></> : <p className="text-sm text-slate-600 dark:text-slate-300">No other account is available, so this money stays here.</p>}</div>;
    }
    else if (step === "tracking") {
        const candidateName = draft.kind === "goal" ? "Holiday" : (draft.name || "Set-aside");
        const candidateAmount = draft.kind === "goal" ? 10000 : draft.amountPence;
        content = facts.hasCandidate ? <div className="space-y-4"><p className="text-sm text-slate-700 dark:text-slate-200">Suggested past payment: {candidateName} <MoneyText text={money(candidateAmount)}/> from {source?.name ?? "your account"} to {destination?.name ?? "your savings account"}.</p><button type="button" data-g291-action="confirm-transfer" aria-pressed={draft.transferConfirmed} onClick={() => onAction("confirm-transfer")} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/40">Confirm this payment</button><button type="button" data-g291-action="skip-transfer" onClick={() => onAction("skip-transfer")} className="min-h-11 text-sm font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Skip for now</button></div> : <div className="space-y-4"><p className="text-sm text-slate-700 dark:text-slate-200">{COPY.noHistory}</p><p className="text-sm text-slate-600 dark:text-slate-300">{COPY.held}</p><details className="border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="min-h-11 cursor-pointer pt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Match a payment name</summary><div className="mt-3"><label htmlFor="custom-match" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payment name</label><input id="custom-match" name="custom-match" data-g291-field="custom-match" autoComplete="off" value={draft.customMatch} onChange={(event) => onDraft({ customMatch: event.target.value })} className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"/><Button onAction={onAction} action="confirm-custom-match" disabled={!draft.customMatch.trim()} tone="quiet" className="mt-3">Confirm payment name</Button></div></details></div>;
    }
    else if (step === "review" || step === "edit") {
        const goal = draft.kind === "goal";
        const setAsideLocation = draft.destinationId ? `moving to ${destination?.name ?? "another account"}` : "kept here";
        const routeHelp = !goal && !draft.destinationId && sources.length > 0 && destinations.length > 0
            ? <button type="button" data-g291-action="edit-destination" onClick={() => onAction("edit-destination")} className="min-h-11 text-left text-sm font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300">Use another account instead</button> : null;
        content = <div className="space-y-4"><div className="space-y-1"><button type="button" data-g291-action="edit-name" onClick={() => onAction("edit-name")} className="min-h-11 text-left text-base font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">{draft.name || "Name this plan"}</button><p className="text-sm text-slate-600 dark:text-slate-300">{goal ? `${money(draft.targetPence)} by ${monthLabel(draft.month)}` : `${money(draft.amountPence)} ${cadenceLabel(draft.cadence)}, ${setAsideLocation}`}</p></div><button type="button" data-g291-action="edit-target" onClick={() => onAction("edit-target")} className="min-h-11 text-sm font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{goal ? "Change target" : "Change amount"}</button>{goal ? <GoalAmount amount={contribution} progress={goalProgress}/> : <PlanContribution amount={draft.amountPence / 100} cadence={cadenceLabel(draft.cadence)}/>}<div className="space-y-2 border-y border-slate-200 py-3 text-sm dark:border-slate-700"><button type="button" data-g291-action="edit-source" onClick={() => onAction("edit-source")} className="min-h-11 w-full text-left font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">Paid from: {source ? source.name : "Choose an account"}</button><button type="button" data-g291-action="edit-destination" onClick={() => onAction("edit-destination")} className="min-h-11 w-full text-left font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">{goal ? `Saved in: ${destination?.name ?? "Choose an account"}` : draft.destinationId ? `Move to: ${destination?.name ?? "Choose an account"}` : "Money stays here"}</button>{(goal || draft.destinationId) && <button type="button" data-g291-action="edit-tracking" onClick={() => onAction("edit-tracking")} className="min-h-11 w-full text-left font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">Tracking: {draft.transferConfirmed ? "Payment confirmed" : "Not linked yet"}</button>}</div>{!source ? <p className="text-sm text-slate-700 dark:text-slate-200">Choose a paying account before you can save.</p> : !draft.sourceConfirmed ? <Button onAction={onAction} action="confirm-source" tone="quiet">Confirm {source.provider}</Button> : null}<Affordability facts={facts} onAction={onAction}/><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{COPY.noMove} {COPY.standingOrder}</p></div>;
        if (routeHelp) content = <>{content}{routeHelp}</>;
    }
    else if (step === "view") {
        const goal = draft.kind === "goal";
        const heldAmount = facts.reservePence ?? 0;
        const hasTransferRoute = goal || Boolean(draft.destinationId);
        content = <div className="space-y-4">
            {saved.status === "paused" && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Paused</p>}
            {goal ? <GoalAmount amount={contribution} progress={goalProgress}/> : <PlanContribution amount={(source ? heldAmount : draft.amountPence) / 100} cadence={source ? "held back" : "planned each pay period"}/>}
            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                {!source ? <p>Choose a paying account before this amount is held back.</p> : <>
                    <p>{goal ? `Going to ${destination?.name ?? "an account you choose"}.` : draft.destinationId ? `Going to ${destination?.name}.` : "Stays in this account."}</p>
                    <p>Paid from {source.name}.</p>
                    {!goal && !draft.destinationId && <p><MoneyText text={`${money(heldAmount)} held back`}/> in this account.</p>}
                </>}
                {hasTransferRoute && <p>{draft.transferConfirmed ? "Payment tracking is confirmed." : "Payment tracking is not linked yet."}</p>}
                {scenario === "offline" && <p>That pot is offline, so its balance may need an update.</p>}
            </div>
            {goal && <p className="text-xs text-slate-500 dark:text-slate-400">Goal pause is proposed in this preview.</p>}
            <div className="flex flex-wrap gap-2">
                <Button onAction={onAction} action="edit" tone="quiet"><Pencil size={16} aria-hidden="true"/> Edit</Button>
                <Button onAction={onAction} action={saved.status === "paused" ? "resume" : "pause"} tone="quiet">{saved.status === "paused" ? "Resume" : "Pause"}</Button>
                <Button onAction={onAction} action="delete" tone="danger"><Trash2 size={16} aria-hidden="true"/> Delete</Button>
            </div>
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
    return <div data-g291-step={step} className="space-y-4 text-[13px] leading-5">{error && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{error}</p>}{content}{draft.kind === "set-aside" && ["review", "edit", "view"].includes(step) && <p data-g291-planned-caveat className="text-xs leading-5 text-slate-600 dark:text-slate-300">{step === "view" ? "This is a plan. " : ""}Check Upcoming to see if it fits before payday.</p>}</div>;
}
export function JourneyFooter(props: ScreenProps) {
    const { step, draft, facts, sources, onAction } = props;
    if (step === "kind" || step === "view")
        return null;
    if (step === "purpose")
        return <Button onAction={onAction} action="next-purpose" disabled={!draft.name.trim()}>Next</Button>;
    if (step === "target" || step === "amount")
        return <Button onAction={onAction} action="next-details">Next</Button>;
    if (step === "source")
        return sources.length ? <Button onAction={onAction} action="confirm-source" disabled={!draft.sourceId}>Use {facts.source?.provider ?? sources[0]?.provider ?? "account"}</Button> : null;
    if (step === "destination")
        return <Button onAction={onAction} action="confirm-destination" disabled={draft.kind === "goal" && !draft.destinationId}>Continue</Button>;
    if (step === "tracking")
        return <Button onAction={onAction} action={draft.transferConfirmed ? "confirm-transfer" : "skip-transfer"}>{draft.transferConfirmed ? "Keep this payment" : "Skip for now"}</Button>;
    if (step === "review" || step === "edit")
        return <Button onAction={onAction} action="save" disabled={!facts.canSave}>{props.editing ? "Save changes" : "Save plan"}</Button>;
    if (step === "pause" || step === "delete")
        return <div className="flex gap-2"><Button onAction={onAction} action="back" tone="quiet">Back</Button><Button onAction={onAction} action={step === "pause" ? "confirm-pause" : "confirm-delete"} tone={step === "delete" ? "danger" : "primary"}>{step === "pause" ? "Pause plan" : "Delete plan"}</Button></div>;
    return <div className="flex gap-2"><Button onAction={onAction} action="close" tone="quiet">Close</Button>{props.result !== "deleted" && <Button onAction={onAction} action="view-result">View plan</Button>}</div>;
}
