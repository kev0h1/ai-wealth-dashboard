"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Filter } from "lucide-react";
import FixtureBottomNav from "../_components/FixtureBottomNav";

type Variant = "a" | "b" | "c";
// This mirrors McpActivityPage. Plan availability is resolved by
// ConnectedAssistantsCard before the user reaches this route.
type State = "enabled" | "empty" | "loading" | "error";
type Row = { day: string; assistant: string; request: string; time: string; detail: string };

const currentRows: Row[] = [
  { day: "Today", assistant: "ChatGPT", request: "Read transactions", time: "10:42", detail: "Read-only transaction summary" },
  { day: "Today", assistant: "Claude", request: "Check spending", time: "09:18", detail: "Read-only pay-period check" },
  { day: "Yesterday", assistant: "ChatGPT", request: "Read account balances", time: "18:06", detail: "Read-only balance summary" },
  { day: "Yesterday", assistant: "Claude", request: "Get upcoming bills", time: "15:27", detail: "Read-only bill schedule" },
];
const olderRows: Row[] = [
  { day: "12 September", assistant: "ChatGPT", request: "Read spending categories", time: "16:31", detail: "Read-only category summary" },
  { day: "12 September", assistant: "Claude", request: "Check savings goals", time: "12:14", detail: "Read-only goal summary" },
];
const assistants = ["All assistants", "ChatGPT", "Claude"] as const;

function Switcher({ variant, state, dark }: { variant: Variant; state: State; dark: boolean }) {
  const query = (nextVariant: Variant, nextState: State, nextDark: boolean) =>
    `?variant=${nextVariant}&state=${nextState}&mode=${nextDark ? "dark" : "light"}`;
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 bottom-3 z-50 overflow-x-auto px-2 lg:left-[272px]">
      <div className="mx-auto flex w-max min-w-full gap-1 rounded-2xl bg-slate-900/95 p-1.5 text-[11px] shadow-xl">
        {(["a", "b", "c"] as Variant[]).map((value) => <Link key={value} href={query(value, state, dark)} className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${variant === value ? "bg-indigo-600 text-white" : "text-slate-200"}`}>{value.toUpperCase()}</Link>)}
        {(["enabled", "empty", "loading", "error"] as State[]).map((value) => <Link key={value} href={query(variant, value, dark)} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-2 text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{value}</Link>)}
        <Link href={query(variant, state, !dark)} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-2 text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{dark ? "light" : "dark"}</Link>
      </div>
    </nav>
  );
}

function ActivityRows({ rows, variant }: { rows: Row[]; variant: Variant }) {
  const [open, setOpen] = useState<string | null>(null);
  if (variant === "c") return <ol className="relative ml-2 border-l border-indigo-200 pl-5 dark:border-indigo-500/60">{rows.map((row, index) => <li key={`${row.day}-${row.time}`} className="relative pb-6 last:pb-0"><span aria-hidden="true" className="absolute -left-[29px] top-1.5 grid size-4 place-items-center rounded-full bg-indigo-600 ring-4 ring-[#f0f2f7] dark:ring-slate-900"><Check size={10} className="text-white" /></span><p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{row.day} · {row.time}</p><h3 className="mt-1 text-base font-bold">{row.request}</h3><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm"><div><dt className="text-xs text-slate-600 dark:text-slate-400">Assistant</dt><dd className="font-semibold">{row.assistant}</dd></div><div><dt className="text-xs text-slate-600 dark:text-slate-400">Access</dt><dd className="font-semibold">Read only</dd></div></dl><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{row.detail}</p>{index < rows.length - 1 && <div aria-hidden="true" className="mt-4 border-b border-slate-200 dark:border-slate-700" />}</li>)}</ol>;
  return <div className={variant === "b" ? "grid gap-4 lg:grid-cols-2" : "space-y-5"}>{[...new Set(rows.map((row) => row.day))].map((day) => <section key={day}><h3 className="mb-2 text-sm font-bold">{day}</h3><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">{rows.filter((row) => row.day === day).map((row, index) => <div key={row.time} className={index ? "border-t border-slate-100 dark:border-slate-700" : ""}><button type="button" onClick={() => setOpen(open === row.time ? null : row.time)} aria-expanded={open === row.time} className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700"><Check size={16} className="text-emerald-500" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{row.request}</span><span className="block text-xs text-slate-600 dark:text-slate-400">{row.assistant} · {row.time} · completed</span></span><span className="text-xs text-indigo-700 dark:text-indigo-300">Details</span></button>{open === row.time && <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"><p><strong className="text-slate-900 dark:text-slate-100">Identity:</strong> {row.assistant}</p><p className="mt-1"><strong className="text-slate-900 dark:text-slate-100">Scope:</strong> {row.detail}. No write action was requested.</p></div>}</div>)}</div></section>)}</div>;
}

export default function McpActivityCanvasClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" || params.get("variant") === "c" ? params.get("variant") as Variant : "a";
  const state: State = (["enabled", "empty", "loading", "error"] as string[]).includes(params.get("state") ?? "") ? params.get("state") as State : "enabled";
  const dark = params.get("mode") === "dark";
  const [filter, setFilter] = useState<(typeof assistants)[number]>("All assistants");
  const [showOlder, setShowOlder] = useState(false);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const visibleState: State = state === "error" && retried ? "enabled" : state;
  const records = showOlder ? [...currentRows, ...olderRows] : currentRows;
  const shown = records.filter((row) => filter === "All assistants" || row.assistant === filter);
  const endReached = showOlder && filter === "All assistants";

  return <div className={`${dark ? "dark" : ""} min-h-screen bg-[#f0f2f7] pb-56 text-slate-900 dark:bg-slate-900 dark:text-slate-100 lg:pb-24`} style={{ "--design-controls-clearance": "108px" } as React.CSSProperties}>
    <a href="#activity" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">Skip to activity</a>
    <main id="activity" className="mx-auto max-w-4xl px-5 py-8 sm:px-9">
      <a href="/settings" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300"><ChevronLeft size={16} aria-hidden="true" />Back to Settings</a>
      <h1 className="mt-3 text-2xl font-bold">Activity log</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">Check which connected assistant made each request, when it happened and the read-only scope recorded for it.</p>
      <p className="mt-5 border-l-2 border-emerald-500 pl-3 text-sm leading-6 text-slate-600 dark:text-slate-300"><strong className="text-slate-900 dark:text-slate-100">2 connected assistants.</strong> Every request is read-only. Latest record: today at 10:42.</p>
      <fieldset className="mt-6 flex flex-wrap gap-2">
        <legend className="mb-2 text-sm font-semibold">Filter activity</legend>
        {assistants.map((value) => <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-11 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${filter === value ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{value}</button>)}
        <span className="inline-flex min-h-11 items-center gap-1 px-2 text-sm text-slate-600 dark:text-slate-400"><Filter size={15} aria-hidden="true" />All time</span>
      </fieldset>
      {visibleState === "loading" ? <div className="mt-8 space-y-3" aria-label="Loading activity"><div className="h-32 rounded-2xl bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" /><div className="h-32 rounded-2xl bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" /></div> : visibleState === "empty" ? <section className="mt-10 border-y border-slate-200 py-8 dark:border-slate-700"><h2 className="text-lg font-bold">No activity yet</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">When an assistant uses Sorted, its request will appear here.</p></section> : visibleState === "error" ? <section className="mt-10 border-y border-slate-200 py-8 dark:border-slate-700"><h2 className="text-lg font-bold">Activity could not load</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Check your connection, then try again. No assistant data has changed.</p><button type="button" onClick={() => setRetried(true)} className="mt-4 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Try again</button></section> : <section className="mt-8 space-y-5" aria-labelledby="chronology-heading"><h2 id="chronology-heading" className="text-lg font-bold">Chronology</h2>{retried && <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Activity history restored.</p>}<ActivityRows rows={shown} variant={variant} />{shown.length === 0 && <div className="border-y border-slate-200 py-6 dark:border-slate-700"><h3 className="text-lg font-bold">No matching activity</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">There are no records for this filter. Choose another assistant to see the activity history.</p></div>}{shown.length > 0 && !showOlder && <button type="button" onClick={() => setShowOlder(true)} className="mx-auto flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800">Show older activity</button>}{endReached && <p className="border-y border-slate-200 py-4 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">End of activity history</p>}</section>}
    </main>
    <FixtureBottomNav />
    <Switcher variant={variant} state={state} dark={dark} />
  </div>;
}
