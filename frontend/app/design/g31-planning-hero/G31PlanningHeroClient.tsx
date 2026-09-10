"use client";

// TEMPORARY PREVIEW — G31, Planning hero design round.
// Static reconciled fixtures only. No API requests or production changes.
// /design/g31-planning-hero?variant=a|b|c&state=short|spare&mode=light|dark&open=1

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Gauge } from "lucide-react";

type Variant = "a" | "b" | "c";
type State = "short" | "spare";
type Mode = "light" | "dark";

type Fixture = {
  state: State;
  income: number;
  spending: number;
  debt: number;
  result: number;
};

const FIXTURES: Record<State, Fixture> = {
  short: { state: "short", income: 2104, spending: 2103, debt: 120, result: -119 },
  spare: { state: "spare", income: 2555, spending: 2103, debt: 120, result: 332 },
};

const NOTES: Record<Variant, { title: string; thesis: string; risk: string }> = {
  a: {
    title: "A · Plain verdict · recommended",
    thesis: "Say the result once in ordinary language, then let a single calm disclosure carry the evidence.",
    risk: "The exact three-month lens is inside the calculation, so a user who never opens it sees only the shorter methodology sentence.",
  },
  b: {
    title: "B · Cockpit reading",
    thesis: "Lead with a signed monthly position and make the three measured months part of the instrument.",
    risk: "Faster for financially confident users, but less conversational and the month markers add another visual object.",
  },
  c: {
    title: "C · Open working",
    thesis: "Keep the entire reconciled calculation visible so no tap is needed to understand where the result came from.",
    risk: "The evidence competes with the verdict and makes a long-horizon landing card feel like a compact statement.",
  },
};

function money(value: number, signed = false): string {
  const magnitude = `£${Math.abs(value).toLocaleString("en-GB")}`;
  if (!signed) return magnitude;
  if (value < 0) return `−${magnitude}`;
  if (value > 0) return `+${magnitude}`;
  return magnitude;
}

function DirectionDot({ state }: { state: State }) {
  return (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${state === "short" ? "bg-red-500 dark:bg-red-400" : "bg-emerald-500 dark:bg-emerald-400"}`}
    />
  );
}

function Ledger({ fixture, resultLabel = "Monthly position" }: { fixture: Fixture; resultLabel?: string }) {
  const rows = [
    { label: "Typical income", value: money(fixture.income, true) },
    { label: "Typical spending", value: money(-fixture.spending, true) },
    { label: "Debt repayments", value: money(-fixture.debt, true) },
  ];

  return (
    <div className="mt-2">
      <dl className="space-y-0.5 text-[13px] text-slate-600 dark:text-slate-300">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-9 items-center justify-between gap-4">
            <dt>{row.label}</dt>
            <dd className="money shrink-0 font-semibold text-slate-900 dark:text-slate-100">{row.value}</dd>
          </div>
        ))}
        <div className={`mt-2 flex min-h-12 items-center justify-between gap-4 rounded-xl px-3 ${fixture.state === "short" ? "bg-red-50/80 dark:bg-red-400/[0.08]" : "bg-emerald-50/80 dark:bg-emerald-400/[0.08]"}`}>
          <dt className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <DirectionDot state={fixture.state} />
            {resultLabel}
          </dt>
          <dd className="money shrink-0 font-bold text-slate-950 dark:text-white">
            {money(fixture.result, true)} {fixture.state}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
        Monthly median across Jun, Jul and Aug. Transfers to savings and investments are excluded.
      </p>
    </div>
  );
}

function CalculationDisclosure({ fixture, defaultOpen, label }: { fixture: Fixture; defaultOpen: boolean; label: string }) {
  return (
    <details className="group mt-3" open={defaultOpen ? true : undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-[13px] font-semibold text-indigo-600 outline-none transition-colors active:opacity-70 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <Ledger fixture={fixture} />
    </details>
  );
}

function HeroShell({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="glass-hero overflow-hidden rounded-3xl p-5">
      {children}
    </section>
  );
}

function VariantA({ fixture, defaultOpen }: { fixture: Fixture; defaultOpen: boolean }) {
  const isShort = fixture.state === "short";
  return (
    <HeroShell labelledBy="variant-a-heading">
      <div className="flex items-center gap-1.5">
        <Gauge size={13} aria-hidden="true" className="text-indigo-500" />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Planning</p>
      </div>
      <h2 id="variant-a-heading" className="mt-4 text-[28px] font-bold leading-[1.12] tracking-tight text-slate-950 dark:text-white text-pretty">
        {isShort ? "You’re " : "You have "}
        <span className="money whitespace-nowrap">{money(fixture.result)}</span>
        {isShort ? " short" : " spare"} in a typical month
      </h2>
      <p className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
        Based on your recent income, typical spending and debt repayments.
      </p>
      <CalculationDisclosure fixture={fixture} defaultOpen={defaultOpen} label="How we calculated this" />
    </HeroShell>
  );
}

function VariantB({ fixture, defaultOpen }: { fixture: Fixture; defaultOpen: boolean }) {
  const isShort = fixture.state === "short";
  return (
    <HeroShell labelledBy="variant-b-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Gauge size={13} aria-hidden="true" className="text-indigo-500" />
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Monthly position</p>
        </div>
        <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${isShort ? "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"}`}>
          <DirectionDot state={fixture.state} />
          {isShort ? "Short" : "Spare"}
        </span>
      </div>
      <h2 id="variant-b-heading" className="money mt-5 text-[38px] font-bold leading-none tracking-[-0.045em] text-slate-950 dark:text-white">
        {money(fixture.result, true)}
      </h2>
      <p className="mt-2 text-[14px] font-medium text-slate-700 dark:text-slate-200">
        Income after typical spending and debt repayments.
      </p>
      <div className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-white/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Three-month view</p>
          <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-600 dark:text-slate-300" aria-label="June, July and August">
            <span>Jun</span><span>Jul</span><span>Aug</span>
          </div>
        </div>
      </div>
      <CalculationDisclosure fixture={fixture} defaultOpen={defaultOpen} label="See the monthly calculation" />
    </HeroShell>
  );
}

function VariantC({ fixture }: { fixture: Fixture }) {
  const isShort = fixture.state === "short";
  return (
    <HeroShell labelledBy="variant-c-heading">
      <div className="flex items-center gap-1.5">
        <Gauge size={13} aria-hidden="true" className="text-indigo-500" />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Planning</p>
      </div>
      <h2 id="variant-c-heading" className="mt-4 text-[24px] font-bold leading-tight tracking-tight text-slate-950 dark:text-white text-pretty">
        {isShort ? "Income is not covering a typical month" : "Income is covering a typical month"}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        The monthly working stays visible here.
      </p>
      <Ledger fixture={fixture} resultLabel={isShort ? "Short each month" : "Spare each month"} />
    </HeroShell>
  );
}

function PreviewContext() {
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Planning section shortcuts">
      {[
        ["Buffer", "£900"],
        ["Debt", "£3,420"],
        ["Goals", "2 active"],
      ].map(([label, value]) => (
        <div key={label} className="glass-card rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
          <p className={`${label === "Goals" ? "" : "money "}mt-1 truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function Controls({ variant, state, mode, open }: { variant: Variant; state: State; mode: Mode; open: boolean }) {
  const variants: Variant[] = ["a", "b", "c"];
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 z-50 flex justify-center px-3 pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        {variants.map((item) => (
          <a key={item} href={`?variant=${item}&state=${state}&mode=${mode}${open ? "&open=1" : ""}`} className={`grid min-h-11 min-w-11 place-items-center rounded-full text-xs font-bold transition-colors active:scale-95 ${variant === item ? "bg-indigo-600 text-white" : "text-slate-400"}`}>
            {item.toUpperCase()}
          </a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a href={`?variant=${variant}&state=${state === "short" ? "spare" : "short"}&mode=${mode}${open ? "&open=1" : ""}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95">
          {state === "short" ? "Spare" : "Short"}
        </a>
        <a href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}${open ? "&open=1" : ""}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95">
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function G31PlanningHeroClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const state: State = params.get("state") === "spare" ? "spare" : "short";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const defaultOpen = params.get("open") === "1";
  const fixture = FIXTURES[state];
  const note = NOTES[variant];

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", mode === "dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-32 pt-6 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] space-y-5 px-4">
          <header>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Planning hero</h1>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">G31 · one result, optional evidence</p>
          </header>

          <aside className="glass-card rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{note.title}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400"><span className="font-semibold">Trade-off:</span> {note.risk}</p>
          </aside>

          {variant === "a" && <VariantA fixture={fixture} defaultOpen={defaultOpen} />}
          {variant === "b" && <VariantB fixture={fixture} defaultOpen={defaultOpen} />}
          {variant === "c" && <VariantC fixture={fixture} />}

          <PreviewContext />
        </div>
        <Controls variant={variant} state={state} mode={mode} open={defaultOpen} />
      </main>
    </div>
  );
}
