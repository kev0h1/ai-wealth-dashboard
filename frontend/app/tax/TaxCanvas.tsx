"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Info,
} from "lucide-react";
import MoneyText from "@/components/MoneyText";

export type TaxActionStatus = "action" | "info";

export type TaxAction = {
  key: string;
  title: string;
  detail: string;
  status: TaxActionStatus;
  canMarkDone?: boolean;
  highlight?: boolean;
};

export type TaxYear = {
  label: string;
  progressPct: number;
  daysLeft: number;
  nextYear: number;
};

export type TaxCanvasModel = {
  hasIncome: boolean;
  heroHeadline: string;
  heroBody: string;
  leverTitle: string;
  leverDetail: string;
  leverStatus: TaxActionStatus | "safe";
  pensionNeededTotal: number;
  taxSaving: number;
  effectiveCost: number;
  mainActions: TaxAction[];
  secondaryActions: TaxAction[];
  taxYear: TaxYear;
};

type TaxCanvasProps = {
  model: TaxCanvasModel;
  done: ReadonlySet<string>;
  onToggle: (key: string) => void;
  embedded?: boolean;
  contextLabel?: string;
  onBack?: () => void;
};

function TaxYearProgress({ model, className = "" }: { model: TaxCanvasModel; className?: string }) {
  return (
    <div className={className}>
      <div
        role="progressbar"
        aria-label={`Tax year ${model.taxYear.label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={model.taxYear.progressPct}
        className="h-1.5 overflow-hidden rounded-full bg-slate-300/70 dark:bg-slate-700"
      >
        <div
          className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400"
          style={{ width: `${model.taxYear.progressPct}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[11px] text-slate-600 dark:text-slate-400">
        <span>6 Apr</span>
        <span className="text-center">{model.taxYear.daysLeft} days left</span>
        <span className="text-right">5 Apr</span>
      </div>
    </div>
  );
}

function PageTitle({
  model,
  contextLabel,
  onBack,
}: {
  model: TaxCanvasModel;
  contextLabel?: string;
  onBack?: () => void;
}) {
  return (
    <header>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl px-1.5 text-[13px] font-medium text-slate-600 [-webkit-tap-highlight-color:transparent] transition-colors hover:text-slate-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Back
        </button>
      )}
      <div className={`${onBack ? "mt-3" : ""} flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between`}>
        <div>
          <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white">
            Tax efficiency
          </h1>
          <p className="mt-2 max-w-[65ch] text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-400">
            Your allowances, deadlines and next useful move for tax year {model.taxYear.label}.
          </p>
        </div>
        {contextLabel && (
          <p className="text-[12px] font-medium text-slate-600 dark:text-slate-400">{contextLabel}</p>
        )}
      </div>
      <TaxYearProgress model={model} className="mt-6" />
    </header>
  );
}

function VerdictCanvas({ model }: { model: TaxCanvasModel }) {
  return (
    <section aria-labelledby="tax-verdict-heading" className="max-w-3xl">
      <h2
        id="tax-verdict-heading"
        className="max-w-[22ch] text-balance text-[30px] font-bold leading-[1.13] tracking-[-0.035em] text-slate-950 sm:text-[34px] dark:text-white"
      >
        {model.heroHeadline}
      </h2>
      <p className="mt-4 max-w-[68ch] text-pretty text-[15px] leading-6 text-slate-700 dark:text-slate-300">
        <MoneyText text={model.heroBody} />
      </p>
      <div className="mt-5 flex items-start gap-2.5 text-[13px] font-semibold leading-5 text-slate-800 dark:text-slate-200">
        <span className="mt-[7px] size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        <span>{model.taxYear.daysLeft} days left in {model.taxYear.label}, allowances reset 5 Apr</span>
      </div>
    </section>
  );
}

function SectionIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[20px] font-bold tracking-[-0.02em] text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-1.5 max-w-[65ch] text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">
        {children}
      </p>
    </div>
  );
}

function StatusIcon({ status, done = false }: { status: TaxAction["status"] | "safe"; done?: boolean }) {
  if (done || status === "safe") {
    return <CheckCircle2 size={18} className="text-emerald-500" aria-hidden="true" />;
  }
  if (status === "action") {
    return <AlertCircle size={18} className="text-amber-500" aria-hidden="true" />;
  }
  return <Info size={18} className="text-slate-400" aria-hidden="true" />;
}

function PensionLever({ model }: { model: TaxCanvasModel }) {
  const showCalculation = model.leverStatus === "action";

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"
      aria-labelledby="pension-lever-title"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0"><StatusIcon status={model.leverStatus} /></span>
        <div className="min-w-0 flex-1">
          <h3 id="pension-lever-title" className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">
            <MoneyText text={model.leverTitle} />
          </h3>
          <p className="mt-1.5 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            <MoneyText text={model.leverDetail} />
          </p>
        </div>
      </div>

      {showCalculation && (
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4 text-center dark:border-slate-700">
          <div>
            <dt className="text-[11px] text-slate-500 dark:text-slate-400">Extra needed</dt>
            <dd className="money mt-1 text-[15px] font-bold text-slate-900 dark:text-slate-100">£{model.pensionNeededTotal.toLocaleString("en-GB")}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500 dark:text-slate-400">Tax saved</dt>
            <dd className="money mt-1 text-[15px] font-bold text-emerald-600 dark:text-emerald-400">£{model.taxSaving.toLocaleString("en-GB")}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500 dark:text-slate-400">Costs you</dt>
            <dd className="money mt-1 text-[15px] font-bold text-slate-900 dark:text-slate-100">£{model.effectiveCost.toLocaleString("en-GB")}</dd>
          </div>
        </dl>
      )}

      {showCalculation && (
        <p className="mt-3 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
          Based on the income and pension figures you set in Settings. Update them there if your situation changes.
        </p>
      )}
    </section>
  );
}

function ActionRow({ item, done, onToggle }: { item: TaxAction; done: boolean; onToggle: () => void }) {
  const content = (
    <>
      <span className="mt-0.5 shrink-0"><StatusIcon status={item.status} done={done} /></span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-bold leading-snug ${done ? "text-slate-500 line-through dark:text-slate-400" : "text-slate-900 dark:text-slate-100"}`}>
          <MoneyText text={item.title} />
        </span>
        <span className="mt-1.5 block text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">
          <MoneyText text={item.detail} />
        </span>
        {item.canMarkDone && (
          <span className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {done ? "Tap to unmark" : "Tap to mark done"}
          </span>
        )}
      </span>
    </>
  );

  const classes = `flex w-full gap-3 px-4 py-4 text-left ${item.highlight ? "ring-1 ring-inset ring-amber-300 dark:ring-amber-600" : ""}`;

  if (!item.canMarkDone) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <button
      type="button"
      aria-pressed={done}
      onClick={onToggle}
      className={`${classes} cursor-pointer touch-manipulation [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 active:scale-[0.99] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none dark:hover:bg-slate-700/50`}
    >
      {content}
    </button>
  );
}

function ActionGroup({
  items,
  done,
  onToggle,
  ariaLabel,
}: {
  items: TaxAction[];
  done: ReadonlySet<string>;
  onToggle: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <ActionRow key={item.key} item={item} done={done.has(item.key)} onToggle={() => onToggle(item.key)} />
      ))}
    </div>
  );
}

function AlsoWorthKnowing({
  model,
  done,
  onToggle,
}: {
  model: TaxCanvasModel;
  done: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full cursor-pointer touch-manipulation items-center justify-between gap-4 px-4 text-left [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none dark:hover:bg-slate-700/50"
      >
        <span>
          <span className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">Also worth knowing</span>
          <span className="mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400">{model.secondaryActions.length} checks and reliefs</span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {model.secondaryActions.map((item) => (
            <ActionRow key={item.key} item={item} done={done.has(item.key)} onToggle={() => onToggle(item.key)} />
          ))}
        </div>
      )}
    </section>
  );
}

function KeyDates({ model }: { model: TaxCanvasModel }) {
  const dates = [
    {
      date: `5 Apr ${model.taxYear.nextYear}`,
      label: "End of tax year",
      detail: "Last day to top up ISA, make extra pension contributions, and use annual reliefs",
    },
    {
      date: `31 Jul ${model.taxYear.nextYear}`,
      label: "Second payment on account",
      detail: "Half your 2025/26 tax bill, due even if you haven't filed yet",
    },
    {
      date: `31 Jan ${model.taxYear.nextYear + 1}`,
      label: "Self-assessment deadline",
      detail: "Online return + any remaining tax + first payment on account for next year",
    },
  ];

  return (
    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      {dates.map((item) => (
        <div key={item.label} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              <CalendarDays size={15} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{item.label}</p>
              <p className="mt-1 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">{item.detail}</p>
            </div>
          </div>
          <p className="pl-11 text-[12px] font-semibold text-slate-600 sm:pl-0 sm:pt-1 dark:text-slate-300">{item.date}</p>
        </div>
      ))}
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="text-pretty text-center text-[11px] leading-4 text-slate-600 dark:text-slate-400">
      Estimates only. Speak to a qualified financial adviser or accountant for personalised advice.
    </p>
  );
}

function EmptyIncome() {
  return (
    <section className="mt-10 max-w-2xl">
      <h2 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-slate-950 dark:text-white">
        Add your income in Settings
      </h2>
      <p className="mt-3 max-w-[60ch] text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-400">
        Your tax levers and estimates personalise from the income and pension you set there.
      </p>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
        <Link
          href="/settings"
          className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
        >
          Go to Settings
        </Link>
      </div>
    </section>
  );
}

function TaxContent({
  model,
  done,
  onToggle,
}: {
  model: TaxCanvasModel;
  done: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      <div className="mt-10"><VerdictCanvas model={model} /></div>

      <section className="mt-12 space-y-4">
        <SectionIntro title="Your levers">
          Start with the move that changes your position most, then work through the checks that apply to you.
        </SectionIntro>
        <PensionLever model={model} />
        <ActionGroup items={model.mainActions} done={done} onToggle={onToggle} ariaLabel="Tax actions" />
        <AlsoWorthKnowing model={model} done={done} onToggle={onToggle} />
      </section>

      <section className="mt-12 space-y-4">
        <SectionIntro title="Key dates">The deadlines that can change what you need to pay or file.</SectionIntro>
        <KeyDates model={model} />
      </section>

      <div className="mt-7"><Disclaimer /></div>
    </>
  );
}

export default function TaxCanvas({
  model,
  done,
  onToggle,
  embedded = false,
  contextLabel,
  onBack,
}: TaxCanvasProps) {
  if (embedded) {
    return model.hasIncome ? (
      <div className="pb-2">
        <TaxContent model={model} done={done} onToggle={onToggle} />
      </div>
    ) : (
      <EmptyIncome />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 lg:px-8">
      <PageTitle model={model} contextLabel={contextLabel} onBack={onBack} />
      {model.hasIncome ? (
        <TaxContent model={model} done={done} onToggle={onToggle} />
      ) : (
        <EmptyIncome />
      )}
    </div>
  );
}
