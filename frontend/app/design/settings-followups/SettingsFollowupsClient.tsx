"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { SheetFrame } from "@/components/SheetFrame";
import PlanPicker from "@/components/PlanPicker";
import YourPlanCard from "@/components/YourPlanCard";
import { ConsentExplanation, DecisionActions, PermissionRow, RevokeExplanation, type PermissionPhase } from "./Permission";
import { PlanPreview, ProfilePreview } from "./Sections";
import { planFixture, type Platform, type PlanState } from "./fixtures";

type Variant = "a" | "b";
type Example = "off" | "on" | "loading" | "unavailable" | "save-error" | "long";
type View = "penny-plan" | "profile";
const EXAMPLES: { id: Example; label: string }[] = [{ id: "off", label: "Permission off" }, { id: "on", label: "Permission on" }, { id: "loading", label: "Checking permission" }, { id: "unavailable", label: "Unavailable example" }, { id: "save-error", label: "Save failure" }, { id: "long", label: "Long name" }];
const PLANS: { id: PlanState; label: string }[] = [{ id: "paid", label: "Paid Plus" }, { id: "free", label: "Statements" }, { id: "trial", label: "Trial" }, { id: "cancelled", label: "Cancelled renewal" }, { id: "past-due", label: "Payment retry" }, { id: "checkout-closed", label: "Checkout paused" }, { id: "loading", label: "Plan loading" }, { id: "error", label: "Plan load failure" }];
const control = "inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl border px-3 py-2 text-[13px] font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const selected = (active: boolean) => `${control} ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"}`;
const subscribe = () => () => {};
const locally = () => new Promise<void>(resolve => setTimeout(resolve, 200));

export default function SettingsFollowupsClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state = (EXAMPLES.find(e => e.id === params.get("state"))?.id ?? "off");
  const plan = PLANS.find(p => p.id === params.get("plan"))?.id ?? "paid";
  const platform: Platform = params.get("platform") === "ios" ? "ios" : params.get("platform") === "android" ? "android" : "web";
  const view: View = params.get("view") === "profile" ? "profile" : "penny-plan";
  const dark = params.get("mode") === "dark", clean = params.get("clean") === "1";
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "only light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#f0f2f7");
  }, [dark]);
  const href = (next: Record<string, string>) => `?${new URLSearchParams({ variant, state, plan, platform, view, mode: dark ? "dark" : "light", clean: clean ? "1" : "0", ...next })}`;
  return <main data-g296-preview data-ready={ready || undefined} data-variant={variant} data-example={state} data-platform={platform} data-view={view} className="min-h-dvh bg-[#f0f2f7] pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 text-slate-900 selection:bg-indigo-200 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40" style={{ colorScheme: dark ? "dark" : "light" }}>
    <a href="#settings-proposal" className="sr-only z-[100] rounded-xl bg-white px-4 py-3 text-sm text-slate-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:ring-2 focus-visible:ring-indigo-500">Skip to proposed settings</a>
    {!clean && <header className="mx-auto mb-5 max-w-5xl px-4 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold">Settings follow-ups</h1>
      <p className="mt-2 max-w-prose text-sm leading-6 text-slate-600 dark:text-slate-300">G296 design preview. Synthetic account, local controls only. No permission, plan, profile or stored location changes.</p>
      <nav aria-label="Design variants" className="mt-3 flex flex-wrap gap-2"><a href={href({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined} className={selected(variant === "a")}>A · In place</a><a href={href({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined} className={selected(variant === "b")}>B · Focused consent</a></nav>
      <p className="mt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "Read and confirm beside the setting. No separate window." : "Read and confirm in the existing app sheet, with actions held at the bottom."}</p>
      <details className="mt-3 border-y border-slate-300 py-1 dark:border-slate-700"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Examples and display</summary>
        <nav aria-label="Permission examples" className="mb-3 flex flex-wrap gap-2">{EXAMPLES.map(e => <a key={e.id} href={href({ state: e.id })} className={selected(state === e.id)} aria-current={state === e.id ? "page" : undefined}>{e.label}</a>)}</nav>
        <nav aria-label="Plan examples" className="mb-3 flex flex-wrap gap-2">{PLANS.map(p => <a key={p.id} href={href({ plan: p.id })} className={selected(plan === p.id)} aria-current={plan === p.id ? "page" : undefined}>{p.label}</a>)}</nav>
        <nav aria-label="Platform examples" className="mb-3 flex flex-wrap gap-2">{(["web", "ios", "android"] as const).map(p => <a key={p} href={href({ platform: p })} className={selected(platform === p)} aria-current={platform === p ? "page" : undefined}>{p === "web" ? "Web" : p === "ios" ? "iOS" : "Android"}</a>)}<a href={href({ mode: dark ? "light" : "dark" })} className={selected(false)}>{dark ? "Light theme" : "Dark theme"}</a><a href={href({ clean: "1" })} className={selected(false)}>View settings only</a></nav>
      </details>
      <p className="mt-3 max-w-prose text-xs leading-5 text-slate-600 dark:text-slate-400">Shared production parts: consent explanation, usage, plan picker and sheet. Proposed Profile and permission rows are prototypes. App examples do not simulate a store purchase.</p>
    </header>}
    <div id="settings-proposal" tabIndex={-1} className="mx-auto max-w-[600px] px-4 focus-visible:outline-none sm:px-6 lg:px-8">
      <nav aria-label="Settings areas" className="mb-5 flex flex-wrap gap-2"><a href={href({ view: "penny-plan" })} className={selected(view === "penny-plan")} aria-current={view === "penny-plan" ? "page" : undefined}>Penny and your plan</a><a href={href({ view: "profile" })} className={selected(view === "profile")} aria-current={view === "profile" ? "page" : undefined}>Your account</a></nav>
      <Scenario key={`${variant}-${state}-${plan}-${platform}-${view}`} variant={variant} example={state} initialPlan={plan} platform={platform} view={view} />
      <div className="mt-5 flex flex-wrap gap-2"><button type="button" className={selected(false)} onClick={() => window.location.reload()}>Reset example</button>{clean && <a href={href({ clean: "0" })} className={selected(false)}>Show preview controls</a>}</div>
    </div>
  </main>;
}

function Scenario({ variant, example, initialPlan, platform, view }: { variant: Variant; example: Example; initialPlan: PlanState; platform: Platform; view: View }) {
  const [checked, setChecked] = useState(example === "on");
  const [phase, setPhase] = useState<PermissionPhase>(example === "loading" ? "loading" : example === "unavailable" ? "unavailable" : "ready");
  const [intent, setIntent] = useState<"on" | "off" | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [failNext, setFailNext] = useState(example === "save-error");
  const [notice, setNotice] = useState("");
  const [planState, setPlanState] = useState(initialPlan), [pickerOpen, setPickerOpen] = useState(false);
  const [name, setName] = useState(example === "long" ? "Alexandra Morgan-Worthington de Silva" : "Alex Morgan");
  const [savedName, setSavedName] = useState(name), [profilePhase, setProfilePhase] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const profileFailure = useRef(example === "save-error");
  const switchRef = useRef<HTMLButtonElement>(null), inlineRef = useRef<HTMLDivElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const info = useMemo(() => planFixture(planState, platform), [planState, platform]);
  useEffect(() => { if (intent && variant === "a") { inlineRef.current?.focus({ preventScroll: true }); inlineRef.current?.scrollIntoView({ block: "nearest" }); } }, [intent, variant]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const closeIntent = () => { if (busy) return; setIntent(null); setError(""); requestAnimationFrame(() => switchRef.current?.focus({ preventScroll: true })); };
  const confirmPermission = async () => {
    if (!intent || busy) return;
    setBusy(true);setError("");await locally();
    if (failNext) {setFailNext(false);setError(`Could not turn this ${intent}. Try again.`);setBusy(false);return;}
    setChecked(intent === "on");setNotice(intent === "on" ? "Setting things up is on in this preview. Every proposal still needs confirmation." : "Setting things up is off in this preview. Pending proposals would be cancelled; your existing plans stay.");
    setIntent(null);setBusy(false);requestAnimationFrame(() => switchRef.current?.focus({ preventScroll: true }));
  };
  const saveProfile = async () => { if (profilePhase === "saving") return;setProfilePhase("saving");await locally();if(profileFailure.current){profileFailure.current=false;setProfilePhase("error");return;}setSavedName(name);setProfilePhase("saved");setNotice("Only the synthetic name in this preview changed."); };
  const blockReference = (event: MouseEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest("button,a")) {event.preventDefault();event.stopPropagation();setNotice("Current component reference only. Use the proposed plan row to explore the picker.");} };
  const blockPickerLink = (event: MouseEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest("a")) {event.preventDefault();event.stopPropagation();setNotice("Policy links are inactive in this design preview. No page or account will change.");} };
  const errorLine = error && <p ref={errorRef} role="alert" tabIndex={-1} className="mt-3 flex items-start gap-2 rounded-lg text-sm leading-5 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />{error}</p>;
  return <>
    <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{view === "profile" ? "Your account" : "Penny and your plan"}</h1>
    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">{view === "profile" ? "Your details, access and history." : "Your allowance and what Penny can help with."}</p>
    {view === "profile" ? <ProfilePreview name={name} phase={profilePhase} dirty={name !== savedName} onNameChange={value => {setName(value);setProfilePhase("idle");}} onSave={() => void saveProfile()} /> : <>
      <div data-proposed-plan><PlanPreview info={info} phase={planState === "loading" ? "loading" : planState === "error" ? "error" : "ready"} onOpenPlans={() => {setIntent(null);setError("");setPickerOpen(true);}} onRetry={() => {setPlanState("paid");setNotice("The synthetic plan has loaded.");}} /></div>
      <PermissionRow checked={checked} phase={phase} pending={busy || intent !== null} switchRef={switchRef} onChange={() => {setError("");setIntent(checked ? "off" : "on");}} onRetry={() => {setPhase("ready");setNotice("The example permission has loaded. Nothing was enabled.");}} />
      {intent && variant === "a" && <div ref={inlineRef} tabIndex={-1} data-inline-consent aria-busy={busy} className="mt-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <fieldset disabled={busy} className="min-w-0 border-0 p-0">{intent === "on" ? <ConsentExplanation inSheet={false} onAccept={() => void confirmPermission()} onDecline={closeIntent} /> : <div className="glass-card rounded-2xl p-4"><RevokeExplanation /><div className="mt-3"><DecisionActions revoke busy={busy} onConfirm={() => void confirmPermission()} onCancel={closeIntent} /></div></div>}</fieldset>{busy && <p role="status" className="mt-2 text-xs text-slate-600 dark:text-slate-300">{intent === "on" ? "Turning on…" : "Turning off…"}</p>}{errorLine}
      </div>}
      <details className="mt-5 border-y border-slate-300 py-1 dark:border-slate-700"><summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">Current plan card for comparison</summary><div className="mb-3 mt-2" onClickCapture={blockReference} onAuxClickCapture={blockReference}><YourPlanCard info={info} error={planState === "error"} /></div></details>
    </>}
    <p aria-live="polite" aria-atomic="true" data-preview-notice className={`${notice ? "mt-3" : ""} text-xs leading-5 text-slate-600 dark:text-slate-300`}>{notice}</p>
    {intent && variant === "b" && <SheetFrame variant="compact" title="Penny permission" onClose={closeIntent} dismissDisabled={busy} footer={({ close }) => <DecisionActions revoke={intent === "off"} busy={busy} onConfirm={() => void confirmPermission()} onCancel={close} />}>
      <div data-sheet-consent aria-busy={busy}>{intent === "on" ? <ConsentExplanation inSheet onAccept={() => void confirmPermission()} onDecline={closeIntent} /> : <RevokeExplanation />}<p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-400">Only changes inside Sorted. Penny cannot move money or make bank payments.</p>{errorLine}</div>
    </SheetFrame>}
    {pickerOpen && info && <SheetFrame title="Choose what fits" description="Preview only. No plan or payment will change." onClose={() => setPickerOpen(false)}>
      <div data-plan-picker-preview onClickCapture={blockPickerLink} onAuxClickCapture={blockPickerLink}><PlanPicker info={info} context="settings" previewOnly nativeOverride={platform !== "web"} onContinue={() => setPickerOpen(false)} /><p aria-live="polite" className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">{notice}</p></div>
    </SheetFrame>}
  </>;
}
