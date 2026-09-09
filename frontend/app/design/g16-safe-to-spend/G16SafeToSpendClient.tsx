"use client";

// TEMPORARY PREVIEW — G16 Safe to Spend communication proposal.
// Static fixtures only: this route does not fetch account data and does not
// import or alter the production SafeToSpendCard.
//
// /design/g16-safe-to-spend?case=carried|cleared|unconfirmed&mode=light|dark&open=1

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ChevronDown, CreditCard, ShieldCheck } from "lucide-react";

type CaseSlug = "carried" | "cleared" | "unconfirmed";
type Mode = "light" | "dark";

type Fixture = {
  slug: CaseSlug;
  label: string;
  cashNow: number;
  lowestCash: number;
  plans: number;
  buffer: number;
  cashBeforeCardCheck: number;
  cardGrowth: number;
  cardReserve: number;
  cardDueLabel: string | null;
  paydayLabel: string;
  syncLabel: string;
  pace: number | null;
};

const CASE_ORDER: CaseSlug[] = ["carried", "cleared", "unconfirmed"];

const CASES: Record<CaseSlug, Fixture> = {
  carried: {
    slug: "carried",
    label: "Carried balance",
    cashNow: 640,
    lowestCash: 260,
    plans: 72,
    buffer: 150,
    cashBeforeCardCheck: 38,
    cardGrowth: 761,
    cardReserve: 0,
    cardDueLabel: null,
    paydayLabel: "Wed 21 Oct",
    syncLabel: "Synced 2 hours ago",
    pace: 6.33,
  },
  cleared: {
    slug: "cleared",
    label: "Cleared monthly",
    cashNow: 640,
    lowestCash: 260,
    plans: 72,
    buffer: 150,
    cashBeforeCardCheck: 38,
    cardGrowth: 761,
    cardReserve: 0,
    cardDueLabel: "14 Oct",
    paydayLabel: "Wed 21 Oct",
    syncLabel: "Synced 2 hours ago",
    pace: 6.33,
  },
  unconfirmed: {
    slug: "unconfirmed",
    label: "Bill not learned",
    cashNow: 420,
    lowestCash: 160,
    plans: 25,
    buffer: 90,
    cashBeforeCardCheck: 45,
    cardGrowth: 190,
    cardReserve: 190,
    cardDueLabel: null,
    paydayLabel: "Tue 20 Oct",
    syncLabel: "Synced 40 minutes ago",
    pace: null,
  },
};

function fmt(value: number, pennies = false): string {
  return `£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: pennies ? 2 : 0,
    maximumFractionDigits: pennies ? 2 : 0,
  })}`;
}

function ThemeEffect({ mode }: { mode: Mode }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const scheme = document.querySelector('meta[name="color-scheme"]');
    const oldScheme = scheme?.getAttribute("content") ?? null;

    root.classList.toggle("dark", mode === "dark");
    scheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");

    return () => {
      root.classList.toggle("dark", hadDark);
      if (oldScheme === null) scheme?.removeAttribute("content");
      else scheme?.setAttribute("content", oldScheme);
    };
  }, [mode]);

  return null;
}

function CalculationRow({
  operator,
  label,
  value,
  detail,
  total = false,
  risk = false,
}: {
  operator?: "" | "−" | "→" | "=";
  label: string;
  value: string;
  detail?: string;
  total?: boolean;
  risk?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-2 py-2.5 ${total ? "mt-1 border-t border-slate-300 pt-3.5 dark:border-slate-600" : "border-b border-slate-100 last:border-b-0 dark:border-white/[0.07]"}`}>
      <span className={`money pt-px text-xs font-semibold ${total ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} aria-hidden="true">
        {operator}
      </span>
      <div className="min-w-0">
        <dt className={`${total ? "font-bold text-slate-900 dark:text-slate-100" : "font-medium text-slate-700 dark:text-slate-200"} text-[13px] leading-snug`}>
          {label}
        </dt>
        {detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{detail}</p>}
      </div>
      <dd className={`money shrink-0 text-sm font-semibold ${risk ? "text-amber-700 dark:text-amber-300" : total ? "text-slate-950 dark:text-white" : "text-slate-800 dark:text-slate-100"}`}>
        {value}
      </dd>
    </div>
  );
}

function CardBalanceFact({ fixture }: { fixture: Fixture }) {
  const isUnconfirmed = fixture.cardReserve > 0;

  return (
    <aside
      className={`mt-5 rounded-2xl border px-3.5 py-3.5 ${
        isUnconfirmed
          ? "border-amber-200/80 bg-amber-50/65 dark:border-amber-700/45 dark:bg-amber-400/[0.08]"
          : "border-slate-200/80 bg-slate-50/80 dark:border-white/[0.08] dark:bg-white/[0.035]"
      }`}
      aria-label="Card balance activity"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${isUnconfirmed ? "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/70 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/10"}`}>
          <CreditCard size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.075em] text-slate-500 dark:text-slate-400">
              Card balances this pay period
            </p>
            <p aria-label={`increase of ${fmt(fixture.cardGrowth)}`} className="money shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100">
              +{fmt(fixture.cardGrowth)}
            </p>
          </div>
          {isUnconfirmed && (
            <div className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/12 dark:text-amber-200">
              <AlertCircle size={13} aria-hidden="true" />
              Repayment not confirmed
            </div>
          )}
          <p className="mt-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">
            {isUnconfirmed
              ? `${fmt(fixture.cardGrowth)} was added to a card whose repayment has not been identified, so we held it back.`
              : fixture.cardDueLabel
                ? `Due around ${fixture.cardDueLabel}. It is not deducted from today’s cash figure.`
                : "This added to your card balances this pay period. It is not deducted from the cash above."}
          </p>
          {!isUnconfirmed && (
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Net balance change: purchases minus refunds and repayments.
            </p>
          )}
          {isUnconfirmed && (
            <p className="mt-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              That leaves a {fmt(fixture.cardReserve - fixture.cashBeforeCardCheck)} safety shortfall.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function SafeToSpendPreview({ fixture, open }: { fixture: Fixture; open: boolean }) {
  const isUnconfirmed = fixture.cardReserve > 0;
  const heroAmount = isUnconfirmed ? 0 : fixture.cashBeforeCardCheck;
  const finalPosition = fixture.cashBeforeCardCheck - fixture.cardReserve;
  const StatusIcon = isUnconfirmed ? AlertCircle : ShieldCheck;

  return (
    <section className="hero-arrive overflow-hidden rounded-3xl border border-white/70 bg-white shadow-sm dark:border-white/[0.08] dark:bg-slate-900 dark:shadow-none" aria-labelledby={`g16-heading-${fixture.slug}`}>
      <div className="p-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">Safe to Spend</p>
          <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${isUnconfirmed ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20" : "bg-slate-100 text-amber-800 dark:bg-white/[0.07] dark:text-amber-200"}`}>
            <StatusIcon size={13} aria-hidden="true" />
            {isUnconfirmed ? "Check card bill" : "Tight"}
          </span>
        </div>

        <h1 id={`g16-heading-${fixture.slug}`} className="mt-5">
          <span className="money block text-[40px] font-bold leading-none tracking-[-0.055em] text-slate-950 dark:text-white">{fmt(heroAmount)}</span>
          <span className="mt-2 block text-[15px] font-semibold text-slate-700 dark:text-slate-200">available in cash until {fixture.paydayLabel}</span>
        </h1>

        <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          {isUnconfirmed
            ? `The cash forecast found ${fmt(fixture.cashBeforeCardCheck)}, then held back an unconfirmed card bill.`
            : `After upcoming bills, plans and your ${fmt(fixture.buffer)} buffer.`}
        </p>

        <CardBalanceFact fixture={fixture} />
      </div>

      <details key={`${fixture.slug}-${open}`} open={open} className="group border-t border-slate-100 dark:border-white/[0.08]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-semibold text-indigo-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-white/[0.035] [&::-webkit-details-marker]:hidden">
          How we got {fmt(heroAmount)}
          <ChevronDown size={17} className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="border-t border-slate-100 px-5 pb-5 pt-4 dark:border-white/[0.07]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.085em] text-slate-500 dark:text-slate-400">Cash calculation</h2>
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Exact steps</span>
          </div>

          <dl className="mt-1.5">
            <CalculationRow operator="" label="Cash available now" value={`+${fmt(fixture.cashNow)}`} detail="Across included current accounts." />
            <CalculationRow operator="→" label="Lowest cash before payday" value={fmt(fixture.lowestCash)} detail="After applying forecast bills and income in date order." />
            <CalculationRow operator="−" label="Plans and allocations" value={fmt(fixture.plans)} />
            <CalculationRow operator="−" label="Safety buffer" value={fmt(fixture.buffer)} />
            <CalculationRow operator="=" label="Cash available until payday" value={fmt(fixture.cashBeforeCardCheck)} total />
          </dl>

          {isUnconfirmed ? (
            <div className="mt-5">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.085em] text-amber-700 dark:text-amber-300">Card safety check</h2>
              <dl className="mt-1.5">
                <CalculationRow operator="−" label="Unconfirmed card reserve" value={fmt(fixture.cardReserve)} detail="Held back because no repayment forecast has been learned." />
                <CalculationRow operator="=" label="Safety position" value={`−${fmt(Math.abs(finalPosition))}`} detail="The negative position is shown here; the amount available above cannot fall below £0." total risk />
              </dl>
            </div>
          ) : (
            <p className="mt-4 border-l-2 border-slate-200 pl-3 text-[12px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 text-pretty">
              The {fmt(fixture.cardGrowth)} card balance change is shown above for context. It is not part of this cash calculation.
            </p>
          )}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500 dark:border-white/[0.08] dark:text-slate-400">
        <span>{fixture.pace == null ? `Pay period ends ${fixture.paydayLabel}` : `${fmt(fixture.pace, true)}/day until ${fixture.paydayLabel}`}</span>
        <span aria-hidden="true">·</span>
        <span>{fixture.syncLabel}</span>
      </div>
    </section>
  );
}

function Switcher({ caseSlug, mode, open }: { caseSlug: CaseSlug; mode: Mode; open: boolean }) {
  const href = (nextCase: CaseSlug, nextMode: Mode, nextOpen = open) => `?case=${nextCase}&mode=${nextMode}${nextOpen ? "&open=1" : ""}`;

  return (
    <nav aria-label="Preview controls" className="sticky top-0 z-10 -mx-4 mb-6 space-y-2 border-b border-slate-200 bg-[#f0f2f7]/90 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90">
      <div className="flex flex-wrap gap-1.5">
        {CASE_ORDER.map((slug) => (
          <a key={slug} href={href(slug, mode)} className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold ${slug === caseSlug ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10"}`}>
            {CASES[slug].label}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <a href={href(caseSlug, mode === "dark" ? "light" : "dark")} className="inline-flex min-h-9 items-center rounded-full bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10">
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </a>
        <a href={href(caseSlug, mode, !open)} className="inline-flex min-h-9 items-center rounded-full bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10">
          {open ? "Start collapsed" : "Start expanded"}
        </a>
      </div>
    </nav>
  );
}

export default function G16SafeToSpendClient() {
  const params = useSearchParams();
  const requestedCase = params.get("case");
  const caseSlug: CaseSlug = CASE_ORDER.includes(requestedCase as CaseSlug) ? requestedCase as CaseSlug : "carried";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const open = params.get("open") === "1";
  const fixture = CASES[caseSlug];

  return (
    <main className={`min-h-screen bg-[#f0f2f7] pb-20 dark:bg-slate-950 ${mode === "dark" ? "dark" : ""}`}>
      <ThemeEffect mode={mode} />
      <div className="mx-auto max-w-[430px] px-4 pt-4">
        <Switcher caseSlug={caseSlug} mode={mode} open={open} />

        <header className="mb-5 px-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-indigo-500 dark:text-indigo-300">G16 proposal</p>
          <h1 className="mt-1 text-xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Cash and cards, without mixing the maths</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
            The headline answers what is available in cash. Card balance growth stays visible as a separate fact.
          </p>
        </header>

        <SafeToSpendPreview fixture={fixture} open={open} />

        <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white/65 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]" aria-labelledby="reading-order-heading">
          <h2 id="reading-order-heading" className="text-[11px] font-bold uppercase tracking-[0.085em] text-slate-500 dark:text-slate-400">Reading order</h2>
          <ol className="mt-2 space-y-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            <li><span className="money mr-2 text-[11px] font-bold text-indigo-500 dark:text-indigo-300">01</span>Cash available until payday</li>
            <li><span className="money mr-2 text-[11px] font-bold text-indigo-500 dark:text-indigo-300">02</span>Card balance change, kept outside the cash sum</li>
            <li><span className="money mr-2 text-[11px] font-bold text-indigo-500 dark:text-indigo-300">03</span>Reconciled steps, only when requested</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
