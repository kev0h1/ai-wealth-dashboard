"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import PortfolioGrowthCard from "@/components/PortfolioGrowthCard";
import PortfolioGrowthDetail from "@/components/PortfolioGrowthDetail";
import type { GrowthVariant } from "@/components/portfolio-growth/GrowthSplit";
import type { GrowthRange } from "@/lib/investmentGrowth";
import { FIXTURES, growthFor, type Fixture } from "./fixtures";

const VARIANTS: { value: "a" | "b" | "c"; label: string; kind: GrowthVariant; note: string }[] = [
  { value: "a", label: "A · The Quiet Ledger", kind: "ledger", note: "Statement-like: thin line, ruled paid-in and growth rows, two-line holding rows." },
  { value: "b", label: "B · Breathing Room", kind: "breathing", note: "Slow reading: dot chart, stacked blocks, holdings in inset panels." },
  { value: "c", label: "C · Contribution and Difference", kind: "pair", note: "Value against dashed paid-in line, so added money and growth read apart." },
];

const chip = "touch-manipulation inline-flex min-h-[44px] items-center rounded-full px-3 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function PreviewClient() {
  const params = useSearchParams();
  const variant = VARIANTS.find((v) => v.value === params.get("variant")) ?? VARIANTS[0];
  const fixture = (FIXTURES.find((f) => f.value === params.get("state"))?.value ?? "growing") as Fixture;
  const dark = params.get("mode") === "dark";
  const [range, setRange] = useState<GrowthRange>("all");

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains("dark") !== dark) root.classList.toggle("dark", dark);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
    return () => obs.disconnect();
  }, [dark]);

  const q = (c: { variant?: string; state?: string; mode?: string }) =>
    `?variant=${c.variant ?? variant.value}&state=${c.state ?? fixture}&mode=${c.mode ?? (dark ? "dark" : "light")}`;
  const growth = growthFor(fixture, range);

  return (
    <main className="mx-auto min-h-screen max-w-[430px] bg-[#f0f2f7] px-4 pb-16 pt-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">G271 · Portfolio growth · preview</p>
      <nav aria-label="Variant" className="mt-1 flex flex-wrap gap-x-1">
        {VARIANTS.map((v) => (
          <Link key={v.value} href={q({ variant: v.value })} replace className={`${chip} ${v.value === variant.value ? "bg-indigo-600 text-white" : "text-slate-700 dark:text-slate-300"}`}>{v.label}</Link>
        ))}
      </nav>
      <nav aria-label="Example" className="flex flex-wrap gap-x-1">
        {FIXTURES.map((f) => (
          <Link key={f.value} href={q({ state: f.value })} replace className={`${chip} ${f.value === fixture ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-700 dark:text-slate-300"}`}>{f.label}</Link>
        ))}
        <Link href={q({ mode: dark ? "light" : "dark" })} replace className={`${chip} text-slate-700 dark:text-slate-300`}>{dark ? "Light" : "Dark"}</Link>
      </nav>
      <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">{variant.note} Invented figures.</p>

      <h2 className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Card</h2>
      <PortfolioGrowthCard title="Stocks and Shares ISA" growth={growth} range={range} onRangeChange={setRange} variant={variant.kind} onOpen={() => {}} />

      <h2 className="mt-8 mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Drill-in</h2>
      <PortfolioGrowthDetail title="Stocks and Shares ISA" growth={growth} range={range} onRangeChange={setRange} variant={variant.kind} />
    </main>
  );
}
