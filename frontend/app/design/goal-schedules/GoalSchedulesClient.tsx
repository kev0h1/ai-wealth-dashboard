"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Landmark, Moon, Sun, Eye, EyeOff, Sparkles } from "lucide-react";
import ScheduleEditor from "./ScheduleEditor";
import { buildPreview, DEFAULT_DRAFT, EXAMPLES, money, dateLabel, type Draft } from "./fixtures";

type Variant = "a" | "b" | "c";
type Screen = "confirm" | "plan" | "edit";
const variants = [
  { id: "a" as const, title: "This period first", note: "The amount to plan for now leads. Later contributions stay visible." },
  { id: "b" as const, title: "Compact overview", note: "The whole goal at a glance. Open the schedule when you need the detail." },
  { id: "c" as const, title: "Step by step", note: "Check the schedule, choose the account, then confirm." },
];
const action = "touch-manipulation inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 active:scale-[0.98] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${action} bg-indigo-600 text-white hover:bg-indigo-700`;
const quiet = `${action} text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-400/10`;
const muted = "text-slate-600 dark:text-slate-300";
const label = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400";
const accounts = ["Monzo current account", "Barclays Premier Current Account", "Starling Personal"];

export default function GoalSchedulesClient() {
  const params = useSearchParams();
  const [variant, setVariant] = useState<Variant>(params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a");
  const [screen, setScreen] = useState<Screen>(params.get("state") === "plan" ? "plan" : params.get("state") === "edit" ? "edit" : "confirm");
  const [dark, setDark] = useState(params.get("mode") === "dark");
  const [masked, setMasked] = useState(false);
  const [convert, setConvert] = useState(params.get("convert") === "1");
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [sampleSaved, setSampleSaved] = useState(buildPreview(DEFAULT_DRAFT).due);
  const [source, setSource] = useState(accounts[0]);
  const [choosing, setChoosing] = useState(false);
  const [step, setStep] = useState(1);
  const [showSchedule, setShowSchedule] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [notice, setNotice] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [returnTo, setReturnTo] = useState<Screen>("plan");
  const heading = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preview = buildPreview(draft);
  const selected = variants.find(v => v.id === variant)!;

  useEffect(() => { setHydrated(true); return () => { if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f172a" : "#f0f2f7");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "only light");
  }, [dark]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant); url.searchParams.set("state", screen);
    url.searchParams.set("mode", dark ? "dark" : "light");
    if (convert) url.searchParams.set("convert", "1"); else url.searchParams.delete("convert");
    window.history.replaceState(null, "", url);
  }, [variant, screen, dark, convert]);

  function navigate(next: Screen) {
    setScreen(next); setNotice(""); setSaveError(false); setCancelled(false);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }
  function edit() { setReturnTo(screen); navigate("edit"); }
  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setSaving(false); setCreated(false); setNotice(""); setCancelled(false); setSaveError(false); setStep(1); setChoosing(false);
  }
  function createPreviewGoal() {
    if (!source || saving) return;
    setSaving(true); setSaveError(false);
    timer.current = setTimeout(() => {
      setSaving(false);
      if (simulateFailure) { setSaveError(true); setSimulateFailure(false); return; }
      setCreated(true); setScreen("plan");
      setNotice(convert ? "Preview only: goal created and set-aside paused. Nothing was saved." : "Preview only: goal created. Nothing was saved.");
      requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    }, 650);
  }
  const fig = (n: number, className = "") => <span className={`money tabular-nums ${className}`} aria-label={masked ? "Amount hidden" : undefined}>{masked ? "£••••" : money(n)}</span>;
  const summary = masked ? "Amounts hidden. Show figures to read the contribution rule." : preview.summary;
  const textMoney = (text: string) => text.split(/(£[\d,.]+|\b\d+p\b)/g).map((s, i) => /^(£|\d+p$)/.test(s) ? <span className="money tabular-nums" key={i}>{s}</span> : s);

  function schedule({ all = false }: { all?: boolean } = {}) {
    const months = all ? preview.months : preview.months.filter(m => m.key >= "2026-10").slice(0, 3);
    return <div>{preview.estimated && <p className={`text-xs ${muted}`}>Estimated contributions</p>}<dl className="divide-y divide-slate-200 dark:divide-slate-700">
      {months.map(m => <div key={m.key} className="flex items-baseline justify-between gap-3 py-3 text-sm">
        <dt className={m.key === "2026-10" ? "font-semibold" : muted}>{m.label}{m.key === "2026-10" && <span className={`mt-0.5 block text-xs font-normal ${muted}`}>This pay period</span>}</dt>
        <dd className="shrink-0 font-semibold">{fig(m.amount)}</dd>
      </div>)}
      {months.length === 0 && <div className={`py-3 text-sm ${muted}`}>This schedule has no contributions left after September.</div>}
    </dl></div>;
  }
  function sourceBlock({ required = false }: { required?: boolean } = {}) {
    return <section aria-label="Source account" className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <Landmark size={18} aria-hidden="true" className="mt-1 shrink-0 text-slate-500 dark:text-slate-400" />
          <div className="min-w-0"><p className={`text-xs ${muted}`}>Money comes from</p><p className="mt-0.5 text-sm font-semibold">{source || "Choose an account"}</p><p className={`mt-0.5 text-xs ${muted}`}>Into Saving Challenge pot</p></div>
        </div>
        <button type="button" disabled={saving} onClick={() => setChoosing(v => !v)} id="source-toggle" aria-expanded={choosing || required && !source} className={`${quiet} -mr-2 -mt-1`}>{source ? "Change" : "Choose"}</button>
      </div>
      {(choosing || required && !source) && <fieldset disabled={saving} className="mt-3">
        <legend className="mb-1 text-sm font-semibold">Which account funds this goal?</legend>
        {accounts.map(a => <label key={a} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-slate-200 py-3 text-sm last:border-0 dark:border-slate-700">
          <input type="radio" name="source" checked={source === a} onChange={() => { setSource(a); setChoosing(true); }} className="h-4 w-4 shrink-0 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500" />{a}
        </label>)}
        <button type="button" disabled={!source} onClick={() => { setChoosing(false); document.getElementById("source-toggle")?.focus(); }} className={`${quiet} mt-1`}>Use this account<Check size={15} aria-hidden="true" /></button>
      </fieldset>}
    </section>;
  }
  function conversion() {
    return convert ? <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <p className="text-sm font-semibold">Replace Saving Challenge (2026)</p>
      <p className={`mt-1 text-xs leading-5 ${muted}`}>Confirming creates this goal and pauses the set-aside. Past payments stay with the set-aside; this goal starts tracking from today.</p>
    </div> : null;
  }
  function fullSchedule() {
    return <div className="border-t border-slate-200 dark:border-slate-700">
      <button type="button" onClick={() => setShowSchedule(v => !v)} className={`${action} w-full justify-between px-0 text-left`} aria-expanded={showSchedule} aria-controls="full-schedule">{showSchedule ? "Hide full schedule" : "See full schedule"}<ChevronDown size={16} aria-hidden="true" className={showSchedule ? "rotate-180" : ""} /></button>
      {showSchedule && <div id="full-schedule">{schedule({ all: true })}<p className={`pb-3 text-xs leading-5 ${muted}`}>Planned contributions, not a record of payments.</p></div>}
    </div>;
  }
  function total({ hero = false }: { hero?: boolean } = {}) {
    return <div><p className={hero ? label : `text-xs ${muted}`}>{preview.estimated ? "Estimated goal total" : "Goal total"}</p><p className={hero ? "mt-2 text-[30px] font-bold leading-tight tracking-tight" : "mt-1 text-base font-semibold"}>{fig(preview.total)}</p><p className={`mt-1 text-xs ${muted}`}>By {dateLabel(preview.end)}</p></div>;
  }
  function rule() {
    return <div><p className={`text-sm leading-6 ${muted}`}>{textMoney(summary)}</p><p className={`mt-1 text-xs ${muted}`}>Starts {dateLabel(draft.start)}</p>{preview.estimated && <p className={`mt-2 text-xs leading-5 ${muted}`}>Based on {fig(Number(draft.pay))} expected pay per period. This is an estimate.</p>}</div>;
  }

  const newProgress = created || convert;
  const saved = newProgress ? 0 : sampleSaved;
  const onTrack = saved >= preview.due;
  return <main data-g351-preview data-hydrated={hydrated} className="min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 dark:bg-slate-900 dark:text-slate-100 dark:selection:bg-indigo-800" style={{ colorScheme: dark ? "dark" : "light" }}>
    <a href="#goal-preview" className="sr-only focus:not-sr-only focus:inline-block focus:p-4">Skip to goal preview</a>
    <div className="mx-auto max-w-5xl px-4 py-6 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-16 lg:py-12">
      <section aria-label="Preview options" className="lg:sticky lg:top-8 lg:self-start">
        <a href="/design" className={`${quiet} -ml-3`}><ArrowLeft size={16} aria-hidden="true" />All designs</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">A goal that grows with you</h1>
        <p className={`mt-2 text-sm leading-6 ${muted}`}>G351 · New design round. Try the setup and edit the amounts. Examples only; nothing is saved.</p>
        <nav aria-label="Design options" className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1">
          {variants.map(v => <button type="button" key={v.id} aria-pressed={variant === v.id} onClick={() => { reset(); setVariant(v.id); }} className={`${action} flex-col items-start border px-3 py-2 text-left lg:flex-row lg:items-center ${variant === v.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}><span>{v.id.toUpperCase()}</span><span className="text-xs lg:text-sm">{v.title}</span></button>)}
        </nav>
        <p className={`mt-3 text-xs leading-5 ${muted}`}>{selected.note}</p>
        <nav aria-label="Preview screens" className="mt-4 flex gap-1 border-b border-slate-300 dark:border-slate-700">
          {(["confirm", "plan", "edit"] as const).map(s => <button type="button" key={s} onClick={() => { reset(); navigate(s); if (s === "edit") setReturnTo("plan"); }} aria-pressed={screen === s} className={`${action} flex-1 rounded-b-none border-b-2 px-2 ${screen === s ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-slate-600 dark:text-slate-300"}`}>{s === "confirm" ? "Penny setup" : s === "plan" ? "View plan" : "Edit"}</button>)}
        </nav>
        <details className="mt-2">
          <summary className={`${action} cursor-pointer justify-between px-0`}>Examples & display<ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="space-y-4 pb-3">
            <fieldset><legend className="mb-2 text-xs font-semibold">Try another schedule</legend><div className="flex flex-wrap gap-2">{EXAMPLES.map(e => <button type="button" key={e.id} onClick={() => { reset(); setDraft(e.draft); setSampleSaved(buildPreview(e.draft).due); }} className={`${action} border border-slate-300 text-xs dark:border-slate-600`}>{e.label}</button>)}</div></fieldset>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDark(v => !v)} className={quiet}>{dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}{dark ? "Light theme" : "Dark theme"}</button><button type="button" onClick={() => setMasked(v => !v)} className={quiet}>{masked ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{masked ? "Show figures" : "Hide figures"}</button></div>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={convert} onChange={e => { reset(); setConvert(e.target.checked); }} />Replace an existing set-aside</label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={!source} onChange={e => { setSource(e.target.checked ? "" : accounts[0]); setChoosing(false); }} />Source not chosen yet</label>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={simulateFailure} onChange={e => setSimulateFailure(e.target.checked)} />Next confirmation fails</label>
            <p className={`text-xs leading-5 ${muted}`}>Example date: 28 October 2026. Pay periods run from the first to the last day of each month. View plan shows sample savings progress; a newly created goal starts at zero.</p>
          </div>
        </details>
      </section>

      <div id="goal-preview" className="mx-auto mt-7 w-full max-w-[430px] pb-12 lg:mt-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">{screen === "confirm" && <Sparkles size={18} className="text-indigo-600 dark:text-indigo-300" aria-hidden="true" />}<h2 ref={heading} tabIndex={-1} className="outline-none">{screen === "confirm" ? "Penny · review your goal" : screen === "edit" ? "Edit schedule" : "Your goal"}</h2></div>
        <p role="status" aria-live="polite" className={`mb-3 text-xs leading-5 ${muted} empty:hidden`}>{notice}</p>
        <article aria-label="Goal preview" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          {screen === "edit" ? <ScheduleEditor key={JSON.stringify(draft)} initial={draft} masked={masked} onCancel={() => navigate(returnTo)} onSave={d => { setDraft(d); navigate(returnTo); setNotice("Preview updated. No changes were saved to your account."); }} /> : cancelled ? <div className="space-y-4"><h3 className="text-base font-bold">Goal not created</h3><p className={`text-sm ${muted}`}>You can review it again when you are ready.</p><button type="button" onClick={() => { setCancelled(false); setStep(1); }} className={primary}>Review goal</button></div> : <>
            <div className="flex items-start justify-between gap-3"><h3 className="text-base font-bold">{masked ? "Savings goal" : preview.name}</h3>{screen === "plan" && <span className={`inline-flex items-center gap-1 text-xs ${newProgress ? muted : onTrack ? "text-emerald-700 dark:text-emerald-300" : muted}`}>{!newProgress && onTrack && <Check size={14} aria-hidden="true" />}{!newProgress && !onTrack && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}{newProgress ? "New goal" : onTrack ? "On schedule" : "Below schedule"}</span>}</div>
            {screen === "confirm" && variant === "c" && <ol aria-label="Setup steps" className="mb-5 mt-4 flex items-center gap-2 text-xs">{["Schedule", "Account", "Confirm"].map((s, i) => <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={`flex flex-1 items-center gap-1.5 ${step === i + 1 ? "font-semibold text-indigo-700 dark:text-indigo-300" : muted}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${step === i + 1 ? "bg-indigo-100 dark:bg-indigo-400/20" : "bg-slate-100 dark:bg-slate-700"}`}>{i + 1}</span>{s}</li>)}</ol>}
            <div className="mt-5 space-y-4">
              {screen === "plan" ? <>
                <div><p className={label}>Saved so far</p><p className="mt-2 text-[30px] font-bold leading-tight">{fig(saved)}</p><p className={`mt-1 text-xs ${muted}`}>of {fig(preview.total)}{preview.estimated ? " estimated" : ""} · by {dateLabel(preview.end)}</p></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="progressbar" aria-label="Goal progress" aria-valuenow={masked ? undefined : Math.round(preview.total > 0 ? saved / preview.total * 100 : 0)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={masked ? "Progress hidden" : undefined}><div className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400" style={{ width: masked ? "0%" : `${Math.min(100, preview.total > 0 ? saved / preview.total * 100 : 0)}%` }} /></div>
                <p className={`text-xs leading-5 ${muted}`}>{newProgress ? "Tracking starts today. Earlier payments are not included." : <>Your schedule planned {fig(preview.due)} by today{preview.estimated ? " · estimated" : ""}.</>}</p>
                <div className="border-t border-slate-200 pt-4 dark:border-slate-700"><div className="flex items-start justify-between gap-3"><div><p className={label}>This pay period · October</p><p className="mt-2 text-xl font-bold">{fig(preview.period)}</p><p className={`mt-1 text-xs ${muted}`}>Planned for 1 to 31 October{preview.estimated ? " · estimated" : ""}</p></div><button type="button" onClick={edit} className={`${quiet} -mr-2 -mt-1`}>Edit</button></div></div>
                {rule()}
                {variant !== "b" && <div><h4 className={label}>{preview.estimated ? "Coming next · estimated" : "Coming next"}</h4><dl>{preview.next.map(n => <div key={n.label} className="flex justify-between gap-3 py-2 text-sm"><dt className={muted}>{n.label}</dt><dd className="font-semibold">{fig(n.amount)}</dd></div>)}</dl></div>}
                {fullSchedule()}{sourceBlock()}
                <p className={`text-xs leading-5 ${muted}`}>Nothing moves until you move it. Sorted tracks the plan; existing bank transfers carry on as usual.</p>
              </> : <>
                {(variant !== "c" || step !== 2) && <>
                  {variant === "a" ? <>
                    <div><p className={label}>This pay period · October</p><p className="mt-2 text-[30px] font-bold leading-tight">{fig(preview.period)}</p><p className={`mt-1 text-xs ${muted}`}>Planned for 1 to 31 October{preview.estimated ? " · estimated" : ""}</p></div>
                    {rule()}<div className="border-t border-slate-200 pt-4 dark:border-slate-700">{total()}</div>
                    <dl>{preview.next.map(n => <div key={n.label} className="flex justify-between gap-3 py-2 text-sm"><dt className={muted}>{n.label}</dt><dd className="font-semibold">{fig(n.amount)}</dd></div>)}</dl>
                  </> : <>
                    {total({ hero: true })}{rule()}
                    {(variant === "b" || step === 3) && <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-700"><p className={muted}>October<span className="mt-0.5 block text-xs">This pay period{preview.estimated ? " · estimated" : ""}</span></p><p className="font-semibold">{fig(preview.period)}</p></div>}
                    {variant === "c" && step === 1 && schedule()}
                  </>}
                  {(variant !== "c" || step === 1) && fullSchedule()}
                </>}
                {(variant !== "c" || step >= 2) && sourceBlock({ required: true })}
                {variant === "c" && step === 2 && <p className={`text-xs leading-5 ${muted}`}>This is where the goal&apos;s contributions come from. Check the account before continuing.</p>}
                {(variant !== "c" || step === 3) && <>
                  {conversion()}
                  <p className={`text-xs leading-5 ${muted}`}>Nothing moves until you move it. Sorted tracks the plan; existing bank transfers carry on as usual.</p>
                  {!source && <p className={`text-sm ${muted}`}>Choose the account above to create this goal.</p>}
                  {saveError && <p role="alert" className={`text-sm ${muted}`}>The goal could not be created. Nothing changed. Try again.</p>}
                </>}
                <div className="flex gap-2 pt-1">
                  {variant === "c" && step < 3 ? <button type="button" className={`${primary} flex-1`} disabled={step === 2 && !source} onClick={() => { setStep(step + 1); setChoosing(false); }}>Continue<ArrowRight size={16} aria-hidden="true" /></button> : <button type="button" className={`${primary} flex-1`} disabled={!source || saving} onClick={createPreviewGoal}>{saving ? "Creating goal…" : saveError ? "Try again" : convert ? "Create goal & pause set-aside" : "Create goal"}</button>}
                  <button type="button" disabled={saving} className={`${action} ${muted}`} onClick={() => { if (variant === "c" && step > 1) setStep(step - 1); else setCancelled(true); }}>{variant === "c" && step > 1 ? "Back" : "Cancel"}</button>
                </div>
                {(variant !== "c" || step === 1) && <button type="button" disabled={saving} onClick={edit} className={`${quiet} w-full`}>Edit schedule</button>}
              </>}
            </div>
          </>}
        </article>
      </div>
    </div>
  </main>;
}
