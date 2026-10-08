"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import BankPickerSheet, { type Bank } from "@/components/BankPickerSheet";
import { FullScreenPicker, IndexSheet, PopularSheet } from "./proposals";
import { STATES, VARIANTS, fixtureBanks } from "./fixtures";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function BankPickerClient() {
  const search = useSearchParams();
  const variant = VARIANTS.find(v => v.value === search.get("variant")) ?? VARIANTS.find(v => v.value === "d")!;
  const state = STATES.find(s => s.value === search.get("state"))?.value ?? "empty";
  const mode = search.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const scheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = scheme; };
  }, [mode]);
  // "Scrolled": move the sheet's own scrolling body once the list has rendered.
  useEffect(() => {
    if (state !== "scrolled" || !open || !origin) return;
    const t = setTimeout(() => { document.querySelector<HTMLElement>("[data-sheet-body]")?.scrollTo({ top: 520 }); }, 400);
    return () => clearTimeout(t);
  }, [state, open, origin, variant.value]);
  const href = (v = variant.value, s = state, m = mode) => `?variant=${v}&state=${s}&mode=${m}`;
  const query = state === "typing" ? "bank" : state === "noresults" ? "zzq" : "";
  const step = state === "empty" ? 1 : 2;
  const banks = origin !== null ? fixtureBanks(origin) : [];
  const onPick = (b: Bank) => setPicked(b.name);
  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-16 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Add a bank</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Round 2: a fresh look that treats the picker as a selector and sets the agency sentence into the layout. D, E and F are hand-authored proposals (the production sheet cannot render a tile grid, an index rail or a two-step page through props), so they are layouts to react to, not the shipped component. D puts the sentence in a bordered strip above search and six popular banks. E opens the list with it, beside an index rail of six 44px jumps. F is a full-screen page: step one explains the connection and carries the sentence, step two is the selector. The sentence is visible by default in all three and the search is a fixed 44px field pinned while the list scrolls. Today and A to C are the round 1 sheet variants. F is a page rather than a sheet, so Onboarding, Home and Accounts would navigate to it instead of opening a sheet, and the back button would return them to where they were.</p>
      <nav aria-label="Variants" className="mt-4 flex flex-wrap gap-2">
        {VARIANTS.map(v => <a key={v.value} href={href(v.value)} aria-current={variant.value === v.value ? "page" : undefined}
          className={`${button} ${variant.value === v.value ? "bg-indigo-600 text-white" : "border border-slate-300 dark:border-slate-600"}`}>{v.label}</a>)}
      </nav>
      <nav aria-label="States" className="mt-3 flex flex-wrap gap-2">
        {STATES.map(s => <a key={s.value} href={href(variant.value, s.value)} aria-current={state === s.value ? "page" : undefined}
          className={`${button} ${state === s.value ? "bg-white dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>{s.label}</a>)}
        <a href={href(variant.value, state, mode === "dark" ? "light" : "dark")} className={button}>{mode === "dark" ? "Light" : "Dark"} theme</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-5 bg-indigo-600 text-white`}>Open the picker</button>
    </div>
    {picked && <p role="status" className="mx-auto mt-3 max-w-xl text-sm text-slate-600 dark:text-slate-300">Preview only: you chose {picked}. No connection starts.</p>}
    {open && origin !== null && variant.value === "d" && <PopularSheet key={`${variant.value}-${state}`} banks={banks} initialQuery={query} onClose={() => setOpen(false)} onPick={onPick} />}
    {open && origin !== null && variant.value === "e" && <IndexSheet key={`${variant.value}-${state}`} banks={banks} initialQuery={query} onClose={() => setOpen(false)} onPick={onPick} />}
    {open && origin !== null && variant.value === "f" && <FullScreenPicker key={`${variant.value}-${state}-${step}`} banks={banks} initialQuery={query} initialStep={step} onClose={() => setOpen(false)} onPick={onPick} />}
    {open && origin !== null && variant.kind === "production" && <BankPickerSheet
      key={`${variant.value}-${state}`}
      onClose={() => setOpen(false)}
      disclosurePlacement={variant.placement}
      stickySearch={variant.sticky}
      banksOverride={fixtureBanks(origin)}
      initialQuery={query}
      initiallyExpanded={state === "expanded"} />}
  </main>;
}
