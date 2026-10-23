"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Sun, Moon } from "lucide-react";
import SafeToSpendCard, { approvedSpendFromTreatment } from "@/components/SafeToSpendCard";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { spendFromIsCombined, spendFromTreatmentPlan } from "@/lib/spendFromAccount";
import { SCENARIOS, fixtureHero, fixtureSpendFrom } from "./fixtures";
import { displayModel, fixtureMoney, type SpendFromModel } from "./model";
import { SpendFromVariant } from "./SpendFromVariants";

const OPTIONS = [
  { id: "a", title: "Bank row", description: "Bank identities sit together on their own line. The shared limit and move note stay separate." },
  { id: "b", title: "Account list", description: "One aligned row for each account, with lower limits and any move reserve beside the right bank." },
  { id: "c", title: "Folded accounts", description: "One account stays visible. Other account options sit behind a disclosure, under the same shared limit." },
] as const;
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const control = `flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium active:scale-95 ${focus}`;
const neutral = "border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";

function MoveContext({ model }: { model: SpendFromModel }) {
  if (!model.move) return null;
  const source = model.accounts.find(account => account.moveAmount !== null)!;
  const brand = accountBrand(source.account);
  return <section data-g320-move aria-label="Example pending move" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Pending move</p>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] leading-5 text-slate-700 dark:text-slate-200">
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
      <span>{model.move.source}</span><ArrowRight size={16} aria-hidden="true" className="text-slate-400" /><span>{model.move.destination}</span>
      <strong className="ml-auto font-semibold"><MoneyText text={fixtureMoney(model.move.amount)} /></strong>
    </div>
    <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-300">This money is already held back from the spending limits below. The example does not move money.</p>
  </section>;
}

export default function SpendFromLineClient() {
  const params = useSearchParams();
  const variantParam = params.get("variant");
  const variant = variantParam === "b" || variantParam === "c" || variantParam === "current" ? variantParam : "a";
  const scenario = SCENARIOS.find(item => item.id === (params.get("scenario") ?? params.get("state"))) ?? SCENARIOS[1];
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hide") === "1";
  const model = displayModel(scenario);
  const selected = OPTIONS.find(option => option.id === variant);
  const href = (overrides: Record<string, string>) => `?${new URLSearchParams({ variant, scenario: scenario.id, mode: dark ? "dark" : "light", hide: hidden ? "1" : "0", ...overrides }).toString()}`;
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const previousScheme = root.style.colorScheme;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    return () => {
      root.classList.toggle("dark", wasDark);
      root.style.colorScheme = previousScheme;
    };
  }, [dark]);
  useEffect(() => {
    document.documentElement.dataset.g320Ready = "true";
    return () => { delete document.documentElement.dataset.g320Ready; };
  }, []);
  const result = fixtureSpendFrom(scenario);
  const currentPlan = spendFromTreatmentPlan(result, account => Boolean(accountBrand(account).logoSrc), scenario.pool);
  const current = approvedSpendFromTreatment(
    { ...currentPlan, entries: scenario.entries, combined: spendFromIsCombined(scenario.entries, scenario.pool) },
    hidden ? () => "£••••" : fixtureMoney,
    Boolean(scenario.move),
    () => {},
  );
  const treatment = variant === "current"
    ? { ...(current ?? { body: null }), hideBalances: hidden }
    : { body: <SpendFromVariant variant={variant} model={model} />, hideBalances: hidden };

  return <div className={dark ? "dark" : ""}><BalancesHiddenContext.Provider value={hidden}>
    <main data-g320-ready="true" className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 lg:px-8 lg:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="max-w-2xl"><h1 className="text-xl font-bold tracking-tight">Spend from · layout options</h1><p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">G320 proposals using fictional figures. Choose a layout and an example. The hero label stays the same; production is unchanged.</p></header>
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(250px,320px)_minmax(350px,430px)] lg:gap-10">
          <nav aria-label="Design preview controls" className="space-y-3 lg:sticky lg:top-6">
            <div className="grid grid-cols-3 gap-2">{OPTIONS.map(option => <Link key={option.id} href={href({ variant: option.id })} aria-current={variant === option.id ? "page" : undefined} className={`${control} flex-col gap-0.5 text-center ${variant === option.id ? "border-indigo-600 bg-indigo-600 text-white" : neutral}`}><span className="text-xs font-semibold">{option.id.toUpperCase()}</span><span className="text-[12px]">{option.title}</span></Link>)}</div>
            <details className="rounded-xl border border-slate-200 px-3 dark:border-slate-700">
              <DisclosureSummary className={`min-h-11 cursor-pointer py-2 text-[13px] font-medium ${focus}`}>Example: {scenario.label}</DisclosureSummary>
              <div className="grid gap-1 pb-3">{SCENARIOS.map(item => <Link key={item.id} href={href({ scenario: item.id })} aria-current={scenario.id === item.id ? "true" : undefined} className={`flex min-h-11 items-center rounded-lg px-3 text-[13px] ${focus} ${scenario.id === item.id ? "bg-slate-200 font-semibold dark:bg-slate-700" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>{item.label}</Link>)}</div>
            </details>
            <div className="grid grid-cols-2 gap-2"><Link href={href({ mode: dark ? "light" : "dark" })} className={`${control} ${neutral}`}>{dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}{dark ? "Light theme" : "Dark theme"}</Link><Link href={href({ hide: hidden ? "0" : "1" })} className={`${control} ${neutral}`}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{hidden ? "Show balances" : "Hide balances"}</Link></div>
            <Link href={href({ variant: variant === "current" ? "a" : "current" })} className={`flex min-h-11 items-center text-[12px] text-slate-600 underline underline-offset-4 dark:text-slate-300 ${focus}`}>{variant === "current" ? "Back to the proposals" : "Compare the current layout"}</Link>
            <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{selected?.description ?? "Current Spend from renderer, with the same fictional account limits."}</p>
          </nav>
          <div className="min-w-0 space-y-3">
            <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{scenario.description}</p>
            <MoveContext model={model} />
            <div data-g320-card><SafeToSpendCard data={fixtureHero(scenario)} spendFrom={result} coverMoveVisible={Boolean(scenario.move)} previewBalancesVisible spendFromPreview={treatment} /></div>
            <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-300">{selected ? `${variant.toUpperCase()} · ${selected.title}` : "Current layout"}. Layout proposal only. The figures use one shared limit and already include any move shown above.</p>
          </div>
        </div>
      </div>
    </main>
  </BalancesHiddenContext.Provider></div>;
}
