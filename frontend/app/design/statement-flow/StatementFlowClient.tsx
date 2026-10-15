"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import InvestmentUpload from "@/components/InvestmentUpload";
import InvestmentFlow from "@/components/InvestmentFlow";
import type { api } from "@/lib/api";
import FlowOptions, { type NewVariant } from "./FlowOptions";

const options = [
  ["c", "Paper to portfolio", "Two documents become one holding, with a daily price check."],
  ["d", "The account view", "A worked example separates units from their changing value."],
  ["e", "One step at a time", "A compact, explorable explanation with three labelled tabs."],
] as const;

export default function StatementFlowClient() {
  const params = useSearchParams();
  const requested = params.get("variant") ?? "c";
  const variant = ["a", "b", "c", "d", "e"].includes(requested) ? requested : "c";
  const dark = params.get("mode") === "dark";
  const [open, setOpen] = useState(params.get("open") !== "0");
  const [outcome, setOutcome] = useState("success");

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.classList.toggle("dark", dark);
    apply();
    const obs = new MutationObserver(() => { if (root.classList.contains("dark") !== dark) apply(); });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [dark]);

  // Fixture-only: even a real file chosen in this preview never leaves the browser.
  const uploadStatement: typeof api.uploadInvestmentStatement = async () => {
    await new Promise(resolve => setTimeout(resolve, 900));
    if (outcome === "error") throw new Error("We could not read this example PDF. Try another statement or check its password.");
    return { provider: "Example provider", account_type: "Stocks and shares ISA", total_value: 1400, holdings_count: 1 } as Awaited<ReturnType<typeof api.uploadInvestmentStatement>>;
  };

  const url = (v: string, mode = dark ? "dark" : "light") => `/design/statement-flow?variant=${v}&mode=${mode}`;
  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/design" className="inline-flex min-h-11 items-center text-sm text-indigo-700 dark:text-indigo-300">Back to design previews</Link>
      <h1 className="text-2xl font-bold">A clearer statement journey</h1>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">G272 · Three new options, inside the real upload sheet. All files and results in this preview stay local and use fictional data.</p>
      <div className="space-y-3">{options.map(([key, title, line]) => <Link key={key} href={url(key)} onClick={() => setOpen(true)} className="block rounded-2xl border border-slate-300 p-4 hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-600">
        <strong className="text-sm">{key.toUpperCase()} · {title}</strong><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{line}</p>
      </Link>)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center underline underline-offset-4" href={url(variant, dark ? "light" : "dark")}>View {dark ? "light" : "dark"} theme</Link>
        <Link onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center underline underline-offset-4" href={url("a")}>Earlier A</Link>
        <Link onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center underline underline-offset-4" href={url("b")}>Earlier B</Link>
      </div>
      <label className="block text-sm">Fixture import result
        <select value={outcome} onChange={event => setOutcome(event.target.value)} className="ml-3 min-h-11 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-600 dark:bg-slate-800">
          <option value="success">Success</option><option value="error">Unreadable PDF</option>
        </select>
      </label>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white">Open option {variant.toUpperCase()}</button>
    </div>
    {open && <InvestmentUpload onSuccess={() => {}} onClose={() => setOpen(false)} uploadStatement={uploadStatement}
      explainer={variant === "a" || variant === "b" ? <InvestmentFlow variant={variant === "a" ? "list" : "strip"} /> : <FlowOptions variant={variant as NewVariant} />} />}
  </main>;
}
