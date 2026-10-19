"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WalletCards } from "lucide-react";
import { SpendPeriodBar } from "@/components/SpendHeader";
import SpendPaceHero from "@/components/SpendPaceHero";
import SpendJourneyNav from "@/components/SpendJourneyNav";
import { formatPeriod } from "@/lib/payPeriod";
import { spendHeroMoney } from "@/lib/spendHero";
import { spacingFixture, spacingIncome, STATES, type SpacingState } from "./fixtures";
import styles from "./spend-spacing.module.css";

type Variant = "a" | "b" | "reference";
const VARIANTS = [
  { key: "a", label: "A · Calm rhythm", detail: "One 20px gap between the controls and the hero." },
  { key: "b", label: "B · Closer grouping", detail: "One 12px gap keeps the period controls close to their figures." },
  { key: "reference", label: "Current spacing", detail: "The existing 20px header padding plus 28px content margin." },
] as const;

export default function SpendSpacingPreview() {
  const params = useSearchParams();
  return <Preview key={params.toString()} params={params} />;
}

function Preview({ params }: { params: { get: (name: string) => string | null } }) {
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "reference" ? "reference" : "a";
  const initialState = STATES.find(item => item.key === params.get("state"))?.key ?? "current";
  const [state, setState] = useState<SpacingState>(initialState);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Synthetic examples. No account changes.");
  const dark = params.get("mode") === "dark";
  const clean = params.get("clean") === "1";
  const verdict = spacingFixture(state);
  const selected = VARIANTS.find(item => item.key === variant)!;

  useEffect(() => {
    const root = document.documentElement;
    const priorDark = root.classList.contains("dark");
    const priorScheme = root.style.colorScheme;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const priorTheme = themeMeta?.getAttribute("content") ?? null;
    const frame = requestAnimationFrame(() => {
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      themeMeta?.setAttribute("content", dark ? "#0f172a" : "#f0f2f7");
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(frame); root.classList.toggle("dark", priorDark); root.style.colorScheme = priorScheme;
      if (themeMeta) { if (priorTheme === null) themeMeta.removeAttribute("content"); else themeMeta.setAttribute("content", priorTheme); }
    };
  }, [dark]);

  const link = (next: { variant?: Variant; state?: SpacingState; dark?: boolean; clean?: boolean } = {}) => `?${new URLSearchParams({ variant: next.variant ?? variant, state: next.state ?? state, mode: (next.dark ?? dark) ? "dark" : "light", clean: (next.clean ?? clean) ? "1" : "0" })}`;
  const evidence = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "center", behavior: "auto" });
    setStatus("Example evidence only. No account changes.");
  };
  const destinations = [
    ...(!verdict.pills.spent ? [] : [{ id: "spacing-changes", label: "Changes", value: spendHeroMoney(state === "completed" ? 290.2 : 667.92), needsLook: true }]),
    { id: "spacing-spending", label: "Spending", value: spendHeroMoney(verdict.pills.spent) },
    { id: "spacing-charts", label: "Charts", value: "3 shown" },
  ];

  return <div data-g293-ready={ready} data-g293-variant={variant} data-g293-state={state} className={`${styles.preview} ${dark ? "dark" : ""}`}>
    <a className={styles.skip} href="#g293-spend">Skip to Spend</a>
    {!clean && <aside className={styles.review} aria-label="Spend spacing comparison">
      <h2>Spend spacing</h2>
      <p>The same header and hero, with less space between them. Synthetic examples only.</p>
      <nav className={styles.controls} aria-label="Spacing options">{VARIANTS.map(item => <a key={item.key} href={link({ variant: item.key })} aria-current={variant === item.key ? "page" : undefined}>{item.label}</a>)}</nav>
      <nav className={styles.controls} aria-label="Example periods">{STATES.map(item => <a key={item.key} href={link({ state: item.key })} aria-current={state === item.key ? "page" : undefined}>{item.label}</a>)}<a href={link({ dark: !dark })}>{dark ? "Light" : "Dark"}</a><a href={link({ clean: true })}>View page only</a></nav>
      <p>{selected.detail} All figures, type sizes and controls stay the same.</p>
    </aside>}
    {/* Match SpendPage's real outer inset and header/grid relationship.
        No extra phone frame or padded PreviewCard can conceal the spacing. */}
    <div id="g293-spend" tabIndex={-1} data-g293-page className={`${variant === "reference" ? "" : styles[variant]} mx-auto min-h-dvh max-w-6xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6 lg:px-8 lg:pb-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`} style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top, 0px))" }} onClickCapture={event => {
      if ((event.target as Element).closest('a[href="/transactions"]')) { event.preventDefault(); event.stopPropagation(); setStatus("Search opens Transactions in the app. Navigation stays local in this example."); }
    }}>
      <div data-g293-controls>
        <SpendPeriodBar verdict={verdict} periodLabel={formatPeriod(new Date(`${verdict.period.start}T00:00:00Z`), new Date(`${verdict.period.end}T00:00:00Z`))}
          isCurrentPeriod={!verdict.period.closed} canGoPrev={!verdict.period.closed} onPrev={() => setState("completed")} onNext={() => setState("current")}
          onOpenSettings={() => setStatus("Pay period settings opens in the app.")} onOpenRules={() => setStatus("Categorisation settings opens in the app.")}
          incomeTxns={spacingIncome(verdict)} onTransactionClick={() => setStatus("Example income payment selected.")}
          recentPeriods={[{ offset: 0, label: "Current pay period" }, { offset: 1, label: "Previous pay period" }]} onSelectOffset={offset => setState(offset === 0 ? "current" : "completed")} />
      </div>
      <div data-g293-content className="mt-7 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
        <section aria-label="Pay period summary" className="min-w-0 lg:sticky lg:top-6">
          <SpendPaceHero key={verdict.period.start} verdict={verdict} incomeTxns={spacingIncome(verdict)} onTransactionClick={() => setStatus("Example income payment selected.")} onOutTap={() => evidence("spacing-spending")} onMovedTap={() => evidence("spacing-moved")} />
          <div className="mt-5 hidden lg:block"><SpendJourneyNav destinations={destinations} desktop /></div>
        </section>
        <div className="min-w-0 lg:hidden"><SpendJourneyNav destinations={destinations} /></div>
        <main className="relative min-w-0 pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10 lg:col-start-2 lg:row-start-1">
          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true"><WalletCards size={12} /></span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · {new Date(`${verdict.period.start}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</p>
            <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="money">{spendHeroMoney(verdict.pills.income)}</span> recorded coming in</h2>
          </section>
          {destinations.map(destination => <section id={destination.id} key={destination.id} tabIndex={-1} className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800"><h2 className="text-base font-bold">{destination.label}</h2><p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">Example journey evidence. The spacing proposal does not change this content.</p></section>)}
          <section id="spacing-moved" tabIndex={-1} className="text-[13px] text-slate-600 dark:text-slate-300">Moved separately is not included in Out.</section>
        </main>
      </div>
      <p data-g293-status role="status" className={styles.status}>{status}</p>
      {clean && <a className={styles.back} href={link({ clean: false })}>Show spacing controls</a>}
    </div>
  </div>;
}
