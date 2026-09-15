"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Pause, Play } from "lucide-react";

type Variant = "a" | "b" | "c";
type Playback = "play" | "pause";
const chapters = ["Payday arrived", "The middle of the month", "What changed"];

export default function Client() {
  const params = useSearchParams();
  const raw = params.get("variant");
  const variant: Variant = raw === "b" || raw === "c" ? raw : "a";
  const initial: Playback = params.get("state") === "pause" ? "pause" : "play";
  const [playback, setPlayback] = useState<Playback>(initial);
  const dark = params.get("mode") !== "light";
  useEffect(() => setPlayback(initial), [initial, variant]);
  const paused = playback === "pause";
  const chapter = paused ? 0 : variant === "a" ? 1 : variant === "b" ? 2 : 0;
  const href = (v: Variant, state: Playback, mode: "light" | "dark") => `?variant=${v}&state=${state}&mode=${mode}`;
  const quiet = dark ? "text-slate-300" : "text-slate-600";
  const rule = dark ? "border-slate-700" : "border-slate-200";
  return <main className={`min-h-dvh ${dark ? "dark bg-[#0f172a] text-slate-100" : "bg-[#f0f2f7] text-slate-950"} selection:bg-indigo-200`}>
    <a href="#story" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:text-slate-950">Skip to story</a>
    <div className="mx-auto max-w-4xl px-5 pb-36 pt-6 sm:px-9">
      <Link href="/month" className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold ${quiet} hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10`}><ArrowLeft size={16}/>Back to month</Link>
      {variant === "a" && <section id="story" className="mx-auto mt-14 max-w-2xl"><h1 className="text-balance text-4xl font-bold tracking-[-.04em] sm:text-5xl">Your month, in motion</h1><p className={`mt-5 text-pretty text-base leading-7 ${quiet}`}>Payday gave the month room. The story follows that room, then the one change worth noticing.</p><div className={`mt-12 border-l border-indigo-500 pl-5 ${paused ? "opacity-70" : ""}`}><p className="text-sm font-semibold">{chapters[chapter]}</p><p className={`mt-2 text-lg leading-8 ${quiet}`}>£3,240 came in. By the middle of the month, eating out was £74 higher than usual while everything else held steady.</p></div></section>}
      {variant === "b" && <section id="story" className="mt-14 grid gap-10 lg:grid-cols-[1fr_.85fr]"><div><h1 className="text-balance text-4xl font-bold tracking-[-.04em] sm:text-5xl">The month held its shape.</h1><p className={`mt-5 text-base leading-7 ${quiet}`}>£3,240 came in and the plan had room. One category changed enough to revisit.</p></div><div className={`border-y ${rule} py-6`}><p className="text-sm font-semibold">Eating out</p><p className="mt-2 font-mono text-3xl font-bold tabular-nums">+£74</p><p className={`mt-2 text-sm ${quiet}`}>above its usual shape</p></div></section>}
      {variant === "c" && <section id="story" className="mx-auto mt-14 max-w-2xl"><p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">September</p><h1 className="mt-3 text-balance text-4xl font-bold tracking-[-.04em] sm:text-5xl">One chapter at a time.</h1><ol className={`mt-10 space-y-5 border-l ${rule} pl-5`}>{chapters.map((item, index) => <li key={item} className={index > chapter ? "opacity-40" : ""}><p className="font-semibold">{item}</p><p className={`mt-1 text-sm leading-6 ${quiet}`}>{index === 0 ? "Payday arrived and covered the planned month." : index === 1 ? "Day-to-day spending stayed close to its usual rhythm." : "Eating out rose by £74, the one change worth a closer look."}</p></li>)}</ol></section>}
      <section className={`mx-auto mt-16 max-w-2xl border-t ${rule} pt-7`}><h2 className="text-xl font-bold">What changed</h2><p className={`mt-3 text-sm leading-6 ${quiet}`}>The reading stays on the canvas. Evidence appears only when it helps you check the next part of the story.</p><button type="button" onClick={() => setPlayback(paused ? "play" : "pause")} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-500/40 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950/30"><span className="sr-only">{paused ? "Resume" : "Pause"} story progression</span>{paused ? <Play size={16} aria-hidden="true"/> : <Pause size={16} aria-hidden="true"/>}{paused ? "Resume story" : "Pause story"}</button><p className={`mt-2 text-xs ${quiet}`}>{paused ? "Story progression is paused." : "Story progression is playing."}</p></section>
    </div>
    <nav aria-label="Preview controls" className="fixed bottom-3 left-1/2 flex max-w-[96vw] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-2xl bg-slate-950/95 p-1.5 text-xs shadow-xl">{(["a", "b", "c"] as Variant[]).map(v => <Link key={v} href={href(v, playback, dark ? "dark" : "light")} className={`grid min-h-11 min-w-11 place-items-center rounded-xl font-bold hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white ${v === variant ? "bg-indigo-600 text-white" : "text-slate-200"}`}>{v.toUpperCase()}</Link>)}{(["play", "pause"] as Playback[]).map(s => <Link key={s} href={href(variant, s, dark ? "dark" : "light")} className={`inline-flex min-h-11 items-center rounded-xl px-3 font-semibold hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white ${s === playback ? "bg-white/15 text-white" : "text-slate-200"}`}>{s}</Link>)}<Link href={href(variant, playback, dark ? "light" : "dark")} className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-slate-200 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white">{dark ? "light" : "dark"}</Link></nav>
  </main>;
}
