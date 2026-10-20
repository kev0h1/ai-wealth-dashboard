"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import UpcomingFlowSheet, { type UpcomingFlowNavigation } from "@/components/UpcomingFlowSheet";
import { PlanContribution } from "@/components/plans/PlanEditorSummary";
import { JourneyBody, JourneyFooter } from "./JourneyScreens";
import { applyDraft, COPY, destinationChoices, facts, initialPlan, money, newDraft, SCENARIOS, sourceChoices, validMonth, type Action, type Draft, type Saved, type Scenario, type Step, type Variant } from "./model";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500";
const primary = `${button} bg-indigo-600 text-white`;
const quiet = `${button} border border-slate-300 text-slate-800 dark:border-slate-600 dark:text-slate-100`;
function Preview({ params }: {
    params: ReadonlyURLSearchParams;
}) {
    const variant: Variant = params.get("variant") === "b" ? "b" : "a";
    const scenario = SCENARIOS.find(s => s.id === params.get("state"))?.id ?? "matched";
    const dark = params.get("theme") !== "light";
    const [ready, setReady] = useState(false);
    const [saved, setSaved] = useState<Saved>(() => initialPlan(scenario));
    const [draft, setDraft] = useState<Draft>(() => initialPlan(scenario));
    const [entry, setEntry] = useState<Step>("view");
    const [open, setOpen] = useState(false);
    const [generation, setGeneration] = useState(0);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<"saved" | "paused" | "deleted" | "resumed">("saved");
    const [newPlanKind, setNewPlanKind] = useState<Draft["kind"] | null>(null);
    useEffect(() => {
        const root = document.documentElement;
        const wasDark = root.classList.contains("dark");
        const previousScheme = root.style.colorScheme;
        root.classList.toggle("dark", dark);
        root.style.colorScheme = dark ? "dark" : "light";
        const frame = requestAnimationFrame(() => setReady(true));
        return () => { cancelAnimationFrame(frame); root.classList.toggle("dark", wasDark); root.style.colorScheme = previousScheme; };
    }, [dark]);
    function begin(step: Step, kind?: Draft["kind"]) {
        const nextDraft = step === "purpose" ? newDraft(scenario) : { ...saved };
        if (step === "purpose" && kind) {
            nextDraft.kind = kind;
            nextDraft.destinationId = kind === "goal" ? (scenario === "offline" ? "offline-pot" : "holiday") : "";
            nextDraft.progressPence = 0;
            nextDraft.includeExisting = false;
        }
        setDraft(nextDraft);
        setNewPlanKind(step === "purpose" ? kind ?? null : null);
        setEditing(step !== "purpose");
        setError("");
        setEntry(step);
        setGeneration(n => n + 1);
        setOpen(true);
    }
    function update(patch: Partial<Draft>) { setDraft(current => applyDraft(current, patch)); setError(""); }
    function dispatch(action: Action, step: Step, nav: UpcomingFlowNavigation<Step>) {
        setError("");
        const summary = () => { if (!nav.returnTo(s => s === "review" || s === "edit"))
            nav.goTo("review"); };
        const value = facts(scenario, draft);
        switch (action) {
            case "close":
                nav.close();
                return;
            case "back":
                nav.back();
                return;
            case "next-purpose":
                if (!draft.name.trim() || draft.name.trim().length > 80) {
                    setError("Give your plan a name, up to 80 letters.");
                    return;
                }
                if (nav.canReturnTo(s => s === "review" || s === "edit"))
                    summary();
                else if (newPlanKind)
                    nav.goTo(variant === "b" ? "review" : newPlanKind === "goal" ? "target" : "amount");
                else
                    nav.goTo("kind");
                return;
            case "choose-goal":
            case "choose-aside": {
                const kind = action === "choose-goal" ? "goal" : "set-aside";
                update({ kind, destinationId: kind === "goal" ? (scenario === "offline" ? "offline-pot" : "holiday") : "", transferConfirmed: false, progressPence: 0 });
                nav.goTo(variant === "b" ? "review" : kind === "goal" ? "target" : "amount");
                return;
            }
            case "next-details":
                if (!(Number.isSafeInteger(draft.kind === "goal" ? draft.targetPence : draft.amountPence) && (draft.kind === "goal" ? draft.targetPence : draft.amountPence) > 0) || draft.kind === "goal" && !validMonth(draft.month)) {
                    setError("Add an amount above £0 and choose a future month.");
                    return;
                }
                if (nav.canReturnTo(s => s === "review" || s === "edit"))
                    summary();
                else
                    nav.goTo("source");
                return;
            case "confirm-source":
                if (!value.source) {
                    setError("Choose a paying account first.");
                    return;
                }
                update({ sourceConfirmed: true });
                if (step === "review" || step === "edit")
                    return;
                if (nav.canReturnTo(s => s === "review" || s === "edit"))
                    summary();
                else
                    nav.goTo(draft.kind === "goal" ? "destination" : "review");
                return;
            case "confirm-destination":
                if (draft.kind === "goal" && !value.destination) {
                    setError("Choose where you will save this money.");
                    return;
                }
                if (nav.canReturnTo(s => s === "review" || s === "edit"))
                    summary();
                else
                    nav.goTo(draft.destinationId ? "tracking" : "review");
                return;
            case "confirm-transfer":
                update({ transferConfirmed: true, customMatch: "" });
                summary();
                return;
            case "skip-transfer":
                update({ transferConfirmed: false, customMatch: "" });
                summary();
                return;
            case "confirm-custom-match":
                if (!draft.customMatch.trim()) {
                    setError("Add the payment name you see in your bank.");
                    return;
                }
                update({ transferConfirmed: true });
                summary();
                return;
            case "confirm-tracking":
                if (draft.trackingMode === "payment" && !draft.customMatch.trim() && !value.hasCandidate) {
                    setError("Add a payment name or choose Not now.");
                    return;
                }
                else {
                    update({ trackingConfirmed: draft.trackingMode !== "none", transferConfirmed: draft.trackingMode === "payment" });
                }
                summary();
                return;
            case "edit-name":
                nav.goTo("purpose");
                return;
            case "edit-target":
                nav.goTo(draft.kind === "goal" ? "target" : "amount");
                return;
            case "edit-source":
                nav.goTo("source");
                return;
            case "edit-destination":
                nav.goTo("destination");
                return;
            case "edit-tracking":
                nav.goTo("tracking");
                return;
            case "lower-target":
            case "later-date":
                if (step !== "target")
                    nav.goTo("target");
                requestAnimationFrame(() => document.getElementById(action === "lower-target" ? "target" : "target-month")?.focus());
                return;
            case "save":
                if (!value.canSave) {
                    setError("Check the amount and confirm the account before you save.");
                    return;
                }
                setSaved({ ...draft, name: draft.name.trim(), status: "active" });
                setResult("saved");
                nav.goTo("result");
                return;
            case "edit":
                setDraft({ ...saved });
                setEditing(true);
                nav.goTo("edit");
                return;
            case "pause":
                nav.goTo("pause");
                return;
            case "delete":
                nav.goTo("delete");
                return;
            case "confirm-pause":
                setSaved(current => ({ ...current, status: "paused" }));
                setResult("paused");
                nav.goTo("result");
                return;
            case "confirm-delete":
                setSaved(current => ({ ...current, status: "deleted" }));
                setResult("deleted");
                nav.goTo("result");
                return;
            case "resume":
                setSaved(current => ({ ...current, status: "active" }));
                setResult("resumed");
                nav.goTo("result");
                return;
            case "view-result":
                if (!nav.returnTo(s => s === "view"))
                    nav.goTo("view");
                return;
        }
    }
    const savedFacts = facts(scenario, saved, saved.status === "paused");
    const href = (nextVariant: Variant, nextScenario: Scenario, nextDark = dark) => `?variant=${nextVariant}&state=${nextScenario}&theme=${nextDark ? "dark" : "light"}`;
    const title = (step: Step) => ({ purpose: COPY.purpose, kind: COPY.kind, target: COPY.target, amount: COPY.amount, source: COPY.source, destination: COPY.destination, tracking: COPY.tracking, review: "Check your plan", edit: "Edit your plan", view: saved.name, pause: COPY.pause, delete: COPY.remove, result: result === "deleted" ? "Plan deleted" : result === "paused" ? "Plan paused" : result === "resumed" ? "Plan started again" : "Plan saved" })[step];
    return <main data-g291-ready={ready} data-g291-variant={variant} data-g291-state={scenario} className="min-h-screen bg-slate-100 px-4 py-6 font-sans text-slate-950 dark:bg-slate-950 dark:text-slate-100">
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2"><Link href="/design" className={`${button} -ml-4 text-indigo-700 dark:text-indigo-300`}>Back to designs</Link><h1 className="text-xl font-bold">Plans, made simple</h1><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">G291 design round. Synthetic examples only. Nothing is saved to an account.</p></header>
      <nav aria-label="Design direction" className="flex flex-wrap gap-2">{(["a", "b"] as const).map(v => <Link key={v} href={href(v, scenario)} aria-current={variant === v ? "page" : undefined} className={variant === v ? primary : quiet}>{v === "a" ? "A · Small steps" : "B · One clear page"}</Link>)}</nav>
      <div className="space-y-2"><label htmlFor="g291-example" className="block text-sm font-semibold">Try an example</label><select id="g291-example" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-800" value={scenario} onChange={e => window.location.assign(href(variant, e.target.value as Scenario))}>{SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select><Link className={`${button} -ml-4 text-indigo-700 dark:text-indigo-300`} href={href(variant, scenario, !dark)}>Use {dark ? "light" : "dark"} mode</Link></div>
      <section aria-label="Example plan" className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="min-w-0 break-words text-lg font-bold">{saved.name}</h2><span data-g291-saved-status={saved.status} className="text-sm text-slate-600 dark:text-slate-300">{saved.status === "paused" ? "Paused" : saved.status === "deleted" ? "Deleted in this preview" : saved.kind === "goal" ? "Goal" : "Set-aside"}</span></div>
        {saved.status !== "deleted" && <>{savedFacts.slicePence !== null && <PlanContribution amount={savedFacts.slicePence / 100} cadence={saved.kind === "goal" ? "estimated each pay period" : saved.cadence === "once" ? "this pay period" : "each pay period"} {...(saved.kind === "goal" ? { progress: { current: savedFacts.progressPence / 100, target: saved.targetPence / 100 } } : {})}/>}<p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{saved.status === "paused" ? "Nothing is held back while this plan is paused." : !savedFacts.source ? "Choose a paying account before this amount is held back." : savedFacts.slicePence === null ? "A new forecast is needed for this date." : `${money(savedFacts.reservePence ?? 0)} stays held back in ${savedFacts.source.provider}.`}</p><button type="button" data-g291-action="open-view" className={`${primary} mt-4 w-full`} onClick={() => begin("view")}>View plan</button></>}
      </section>
      <div className="grid gap-2 sm:grid-cols-3"><button type="button" data-g291-action="start-goal" className={`${primary} w-full`} onClick={() => begin("purpose", "goal")}>New goal</button><button type="button" data-g291-action="start-aside" className={`${quiet} w-full`} onClick={() => begin("purpose", "set-aside")}>New set-aside</button><button type="button" data-g291-action="start" className={`${quiet} w-full`} onClick={() => begin("purpose")}>Help me choose</button></div>
      <details className="border-t border-slate-300 pt-2 text-sm leading-6 dark:border-slate-700"><summary className="min-h-11 cursor-pointer py-3 font-semibold">What to review</summary><div className="space-y-3 pt-2 text-slate-600 dark:text-slate-300"><p>{variant === "a" ? "A asks one short question at a time." : "B starts with an editable summary."} Both preselect the relevant path when you start a goal or a set-aside.</p><p>Changing the month updates the synthetic monthly-calendar contribution. The next period starts on 1 November 2026. Including pot money is an explicit choice, and only free pot money is offered.</p><p>Category tracking is proposed design capability only. It is evidence, not a claim that everyday spending has become saving.</p><p>{COPY.noMove} {COPY.standingOrder}</p></div></details>
    </div>
    {open && ready && <UpcomingFlowSheet<Step> key={generation} initialView={entry} onClose={() => setOpen(false)} renderView={(step, nav) => {
                const visibleDraft = step === "view" || step === "pause" || step === "delete" ? saved : draft;
                const props = { step, draft: visibleDraft, saved, scenario, facts: facts(scenario, visibleDraft, step === "view" && saved.status === "paused"), sources: sourceChoices(scenario), destinations: destinationChoices(scenario, visibleDraft), editing, error, result, onDraft: update, onAction: (action: Action) => dispatch(action, step, nav) };
                return { title: title(step), subtitle: step === "view" ? saved.kind === "goal" ? "Your goal" : "Money kept aside" : undefined, body: <JourneyBody {...props}/>, footer: step === "view" || step === "kind" ? undefined : <JourneyFooter {...props}/> };
            }}/>}
  </main>;
}
function ReadyPreview() { const params = useSearchParams(); return <Preview key={params.toString()} params={params}/>; }
export default function PlansSimplePreview() { return <Suspense fallback={<p className="p-6">Loading design…</p>}><ReadyPreview /></Suspense>; }
