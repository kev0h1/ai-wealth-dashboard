"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ChevronRight, CircleAlert, LoaderCircle, Send } from "lucide-react";
import PennyMark from "@/components/PennyMark";

type Variant = "a" | "b" | "c";
type State = "ready" | "loading" | "error" | "allowance";
const states: State[] = ["ready", "loading", "error", "allowance"];
const quickQuestions = ["What is safe this weekend?", "What bills are next?"];
const copy: Record<State, [string, string]> = {
  ready: ["Your weekend plan looks fine", "You can spend £45 this weekend and still have £116 available for the rest of your pay period."],
  loading: ["Checking your plan", "Penny is bringing together your latest balance, bills and planned moves."],
  error: ["Penny could not check that yet", "Your bank connection needs a refresh before Penny can give a reliable answer."],
  allowance: ["You have used all your Penny messages for this month", "Quick questions from the chips still work, and your allowance resets on 1 October."],
};

function PennyAvatar() { return <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white"><PennyMark size={20} /></div>; }

export default function G93PennyCanvasClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const candidate = params.get("state") as State;
  const state: State = states.includes(candidate) ? candidate : "ready";
  const dark = params.get("mode") === "dark";
  const [question, setQuestion] = useState("");
  const [fixtureReply, setFixtureReply] = useState("");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalReviewed, setProposalReviewed] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const href = (next: Partial<{ variant: Variant; state: State; mode: string }>) => `?variant=${next.variant ?? variant}&state=${next.state ?? state}&mode=${next.mode ?? (dark ? "dark" : "light")}`;
  const [title, body] = copy[state];
  const composerDisabled = state === "loading" || state === "allowance";
  const action = state === "error" ? "Try again" : state === "ready" ? "Show your working" : null;
  const actionHref = state === "error" ? href({ state: "ready" }) : "#penny-evidence";
  const submitFixtureQuestion = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (question.trim()) setFixtureReply(`Preview reply to “${question.trim()}”. No question was sent to Penny.`); };
  const runQuickQuestion = (prompt: string) => setFixtureReply(`Preview quick answer to “${prompt}”. Quick questions remain available at the message cap; no request was sent.`);

  return <main className={`${dark ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100`}>
    <a href="#thread" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-slate-950 focus:px-4 focus:py-3 focus:text-white">Skip to conversation</a>
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6">
      <header className="mb-8"><a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"><ArrowLeft size={16} aria-hidden="true" />Design rounds</a><h1 className="mt-4 text-balance text-[30px] font-bold tracking-[-.04em] text-slate-950 dark:text-white">Penny, on the canvas</h1><p className="mt-2 max-w-[65ch] text-sm leading-6 text-slate-600 dark:text-slate-400">Conversation leads. A boundary appears only when Penny offers an action, confirmation or evidence.</p></header>
      <section id="thread" aria-label="Penny conversation" aria-busy={state === "loading"} className={variant === "b" ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]" : "mx-auto max-w-2xl"}>
        <div className="space-y-6">
          <div className="flex items-start gap-3"><PennyAvatar /><div className="min-w-0"><p className="text-sm font-bold">Penny</p><p className="mt-1 max-w-[58ch] text-sm leading-6 text-slate-600 dark:text-slate-400">I have your pay-period view open. What would you like to check?</p></div></div>
          <div className="pl-[52px]"><p className="inline-block rounded-2xl bg-slate-200 px-4 py-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">Can I spend £45 this weekend?</p></div>
          <div className="flex items-start gap-3"><PennyAvatar /><div className="min-w-0"><p className="text-sm font-bold">Penny</p><h2 className="mt-1 text-base font-bold">{title}</h2><p className="mt-1 max-w-[58ch] text-sm leading-6 text-slate-600 dark:text-slate-400">{body}</p>{state === "loading" && <p role="status" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"><LoaderCircle className="animate-spin text-indigo-600 motion-reduce:animate-none" aria-hidden="true" />Checking your plan</p>}{action && <a href={actionHref} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 dark:border-slate-700">{state === "error" ? <CircleAlert size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}{action}</a>}</div></div>
          {state === "ready" && <div id="penny-evidence" className="ml-[52px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><p className="text-sm font-bold">A clear next step</p><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">Keep £116 for the rest of the period after this weekend.</p>{proposalOpen ? <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="text-sm font-semibold">Preview confirmation</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">This fixture does not change your plan. Review the proposed reminder locally.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setProposalReviewed(true); setProposalOpen(false); }} className="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Mark reviewed in preview</button><button type="button" onClick={() => setProposalOpen(false)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700">Cancel</button></div></div> : <button type="button" onClick={() => setProposalOpen(true)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95"><Check size={16} aria-hidden="true" />{proposalReviewed ? "Reviewed in this preview" : "Review a plan reminder"}</button>}</div>}
          {state === "allowance" && <div className="ml-[52px]" aria-label="Quick questions"><p className="text-sm font-semibold">Quick questions</p><div className="mt-2 flex flex-wrap gap-2">{quickQuestions.map((prompt) => <button type="button" key={prompt} onClick={() => runQuickQuestion(prompt)} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{prompt}</button>)}</div><a href="/penny" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-indigo-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Open Penny to see message options</a></div>}
          {fixtureReply && <p role="status" className="ml-[52px] border-y border-slate-200 py-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-400">{fixtureReply}</p>}
        </div>
        {variant !== "a" && <aside className="border-t border-slate-200 pt-5 dark:border-slate-700 lg:border-l lg:border-t-0 lg:pl-7"><h2 className="text-base font-bold">What Penny used</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Latest balance, scheduled bills and your existing plan. Nothing is changed until you confirm it.</p></aside>}
      </section>
      <form onSubmit={submitFixtureQuestion} className="mx-auto mt-10 flex max-w-2xl gap-2 border-t border-slate-200 pt-5 dark:border-slate-700"><label className="sr-only" htmlFor="ask">Ask Penny in this preview</label><input id="ask" name="ask" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={composerDisabled} placeholder={state === "allowance" ? "Your allowance resets on 1 October…" : "Try a local preview question…"} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"/><button type="submit" aria-label="Show local preview reply" disabled={composerDisabled || !question.trim()} className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 active:scale-95"><Send size={17} aria-hidden="true" /></button></form>
      <p className="mx-auto mt-2 max-w-2xl text-xs text-slate-600 dark:text-slate-400">Preview only. Questions here are never sent to Penny.</p>
    </div>
    <nav aria-label="Preview controls" className="fixed bottom-3 left-1/2 z-20 flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1 overflow-x-auto rounded-2xl bg-slate-950 p-1.5 shadow-xl">{(["a", "b", "c"] as Variant[]).map((value) => <a key={value} href={href({ variant: value })} className={`grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${value === variant ? "bg-indigo-600 text-white" : "text-slate-300"}`}>{value.toUpperCase()}</a>)}{states.map((value) => <a key={value} href={href({ state: value })} className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${value === state ? "bg-white/15 text-white" : "text-slate-300"}`}>{value}</a>)}<a href={href({ mode: dark ? "light" : "dark" })} className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-2 text-xs font-semibold text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{dark ? "Light" : "Dark"}</a></nav>
  </main>;
}
