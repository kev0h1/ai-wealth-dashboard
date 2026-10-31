"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ChevronRight, CircleAlert, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import styles from "./preview.module.css";

// G379 proposes the Home entry only. Every review link targets Spend's existing
// deep-link handler, which opens MiscategorisedReviewSheet after data has loaded.
// No duplicate review sheet, API calls, transaction corrections or new rules.
const reviewHref = "/spend?review=1";
type Example = "pending" | "single" | "many" | "checked" | "loading" | "error";
const examples: { value: Example; label: string }[] = [
  { value: "pending", label: "3 to check" }, { value: "single", label: "1 to check" },
  { value: "many", label: "14 to check" }, { value: "checked", label: "All checked" },
  { value: "loading", label: "Checking" }, { value: "error", label: "Could not check" },
];

export default function HomeTransfersPreview() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const [example, setExample] = useState<Example>(examples.find(e => e.value === params.get("state"))?.value ?? "pending");
  const [dark, setDark] = useState(params.get("mode") !== "light");
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  const [reconnect, setReconnect] = useState(params.get("reconnect") !== "0");
  const [ready, setReady] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; setReady(true); }, [dark]);
  const count = example === "many" ? 14 : example === "single" ? 1 : 3;
  const money = (value: number) => <span className="font-mono tabular-nums">{hidden ? "£••••" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value)}</span>;
  const optionHref = (next: string) => `?${new URLSearchParams({ variant: next, state: example, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0", reconnect: reconnect ? "1" : "0" })}`;

  let entry;
  if (example === "checked") entry = <div className={styles.quiet} data-transfer-entry><Check size={18} aria-hidden="true" className="text-emerald-700 dark:text-emerald-300" /><span>Transfers all checked</span></div>;
  else if (example === "loading") entry = <div className={styles.quiet} data-transfer-entry role="status"><LoaderCircle size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /><span>Checking for transfers…</span></div>;
  else if (example === "error") entry = <div className={styles.failed} data-transfer-entry><div className="flex items-start gap-3"><CircleAlert size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-300" /><div><h3 className="text-sm font-semibold">Transfers couldn’t be checked</h3><p className={`${styles.muted} mt-1`}>Try again or open transfer review.</p></div></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={styles.control} onClick={() => setExample("pending")}>Try again</button><a data-review-link href={reviewHref} className={styles.textLink}>Review transfers <ArrowRight size={16} aria-hidden="true" /></a></div></div>;
  else if (variant === "a") entry = <a href={reviewHref} data-review-link data-transfer-entry className={styles.strip}>
    <span className={styles.icon}><ArrowLeftRight size={20} aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block text-base font-bold">{count} {count === 1 ? "transfer" : "transfers"} to check</span><span className={`${styles.muted} mt-1 block`}>Check money moved between your accounts.</span></span>
    <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300" />
  </a>;
  else entry = <section data-transfer-entry className={styles.actionCard} aria-labelledby="transfer-heading">
    <div className="flex items-center gap-3"><ArrowLeftRight size={21} aria-hidden="true" className="shrink-0 text-indigo-700 dark:text-indigo-300" /><h3 id="transfer-heading" className="flex-1 text-base font-bold">Check your transfers</h3><span className={styles.count} aria-label={`${count} to check`}>{count}</span></div>
    <p className={`${styles.muted} mt-3`}>Help Sorted tell money moved from money spent.</p>
    <a href={reviewHref} data-review-link className={styles.primary}>Review transfers <ArrowRight size={17} aria-hidden="true" /></a>
  </section>;

  return <main className={styles.page} data-g379-ready={ready}>
    <a href="#home-preview" className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-11">Skip to Home preview</a>
    <div className={styles.shell}>
      <header className={styles.review}>
        <a href="/design" className={styles.textLink}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
        <h1 className="mt-2 text-xl font-bold">Home transfer shortcut · G379</h1>
        <p className={`${styles.muted} mt-2`}>Two banner options. Both open the existing “Review these transfers” screen.</p>
        <nav className={styles.controls} aria-label="Banner design options">{[["a", "A · Notification strip"], ["b", "B · Clear action"]].map(([id, label]) => <a key={id} href={optionHref(id)} className={`${styles.control} ${variant === id ? styles.selected : ""}`} aria-current={variant === id ? "page" : undefined}>{label}</a>)}</nav>
        <details className="mt-3"><summary className={styles.summary}>Examples and display</summary><div className={styles.controls}><label className="flex flex-col gap-2 text-sm font-semibold">Transfers<select value={example} onChange={event => setExample(event.target.value as Example)}>{examples.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><div className={styles.controls}><button type="button" className={styles.control} onClick={() => setDark(!dark)}>{dark ? "Light theme" : "Dark theme"}</button><button type="button" className={styles.control} aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}{hidden ? "Show figures" : "Hide figures"}</button><button type="button" className={styles.control} aria-pressed={reconnect} onClick={() => setReconnect(!reconnect)}>Reconnect needed</button></div><p className={`${styles.muted} mt-3`}>Example figures and counts. Review links open your real transfer-review screen, so its count may differ. No transactions change when you open it.</p></details>
      </header>
      <div className={styles.columns} id="home-preview">
        <div>
          <header className="mb-5"><h2 className="text-[28px] font-bold leading-tight tracking-tight">Good morning, Alex</h2><p className={`${styles.muted} mt-3`}>{example === "checked" ? "Your transfers are checked. Here’s your money for the rest of this pay period." : "Check your transfers, then see what’s left for the rest of this pay period."}</p></header>
          <div className={styles.stack}>
            {reconnect && <div className={styles.reconnect} data-reconnect><span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /><p className="flex-1 text-sm font-semibold">Barclays needs reconnecting</p><a href="/accounts" className={styles.textLink}>Reconnect</a></div>}
            {entry}
            <div className={styles.contextRow} data-cover-plan><div><p className="text-base font-bold">Cover your upcoming bills</p><p className={`${styles.muted} mt-1`}>Move {money(45)} to your bills account.</p></div><ChevronRight size={19} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-300" /></div>
            <div className={styles.contextRow} data-payday-plan><div><p className="text-base font-semibold">Payday plan</p><p className={`${styles.muted} mt-1`}>See how your next pay could be split.</p></div><ChevronRight size={19} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-300" /></div>
            <section className={styles.hero} aria-label="Example left to spend"><div className="flex items-center justify-between gap-3"><p className={styles.eyebrow}>Estimated left to spend</p><span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold dark:bg-slate-700"><CircleAlert size={15} aria-hidden="true" className="text-amber-700 dark:text-amber-300" />Tight</span></div><p className="mt-6 text-[30px] font-bold">{money(242)}</p><p className={`${styles.muted} mt-3`}>About {money(60)} a day until Friday, after upcoming bills and envelopes.</p><p className={`${styles.eyebrow} mt-6`}>Spend from</p><div className={styles.account}><span>Barclays</span><span>up to {money(108)}</span></div><div className={styles.account}><span>Starling</span><span>up to {money(59)}</span></div><p className={`${styles.muted} mt-3`}>Separate account limits, not amounts to add together.</p><a href="/accounts" className={`${styles.textLink} mt-4 w-full justify-end`}>Your accounts <ArrowRight size={17} aria-hidden="true" /></a></section>
          </div>
        </div>
        <section className={styles.aside} aria-label="Design intent"><h2 className="text-base font-bold">The same review, easier to reach</h2><p className={`${styles.muted} mt-3`}>The banner sits below reconnection and above the cover and payday plans. It stays until transfers are checked.</p><p className={`${styles.muted} mt-3`}>Tapping it opens the existing screen with “Same transfer”, “Not the same” and the current correction options.</p><p className={`${styles.muted} mt-3`}>G376’s categorisation design remains a separate step for telling Sorted what a transaction was.</p><p className={`${styles.muted} mt-4 flex items-start gap-2`}><ShieldCheck size={18} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-300" aria-hidden="true" />This preview only changes the entry point. It doesn’t introduce another review flow.</p></section>
      </div>
    </div>
  </main>;
}
