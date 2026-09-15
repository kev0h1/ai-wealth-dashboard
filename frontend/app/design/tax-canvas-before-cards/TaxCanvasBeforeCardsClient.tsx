"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Home,
  Info,
  PieChart,
  Target,
  X,
} from "lucide-react";
import MoneyText from "@/components/MoneyText";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import {
  getTaxPreviewModel,
  TAX_PREVIEW_STATES,
  TAX_STATE_LABELS,
  type TaxAction,
  type TaxPreviewModel,
  type TaxPreviewState,
} from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: Variant[] = ["a", "b", "c"];

const VARIANT_NOTES: Record<Variant, { title: string; thesis: string; rule: string; tradeoff: string }> = {
  a: {
    title: "A · Guided reading · recommended",
    thesis: "One calm reading order moves from the personalised verdict to the most valuable lever, then the bounded checklist and dates.",
    rule: "Orientation and explanation stay on the canvas. Cards are reserved for the pension calculation, actionable groups and the date ledger. Navigation remains present, while Tax prompts live inside Penny's chat.",
    tradeoff: "It is the clearest phone experience, but desktop deliberately remains a focused reading column rather than becoming a dashboard.",
  },
  b: {
    title: "B · Decision rail",
    thesis: "The personalised verdict becomes a sticky canvas rail on desktop while the calculations and actions move beside it.",
    rule: "The rail holds only orientation, explanation and tax-year position. Every boundary in the work column contains an action or evidence object. Navigation remains present, while Tax prompts live inside Penny's chat.",
    tradeoff: "Desktop scanning is faster, but the rail creates a stronger split between understanding the position and acting on it.",
  },
  c: {
    title: "C · Deadline path",
    thesis: "The page organises the same tax facts by when they matter: before 5 Apr, during the year, and at the filing dates.",
    rule: "Canvas landmarks carry the sequence. Cards contain the calculation, each bounded action group and the dated obligations. Navigation remains present, while Tax prompts live inside Penny's chat.",
    tradeoff: "The time-based story is distinctive, but it is less faithful to the live page's current levers-first mental model.",
  },
};

function PageTitle({ model, progressBelow = true }: { model: TaxPreviewModel; progressBelow?: boolean }) {
  return (
    <header>
      <a
        href="/design"
        className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-xl px-1.5 text-[13px] font-medium text-slate-600 [-webkit-tap-highlight-color:transparent] transition-colors hover:text-slate-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:text-white"
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back
      </a>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white">
            Tax efficiency
          </h1>
          <p className="mt-2 max-w-[65ch] text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-400">
            Your allowances, deadlines and next useful move for tax year {model.taxYear.label}.
          </p>
        </div>
        <p className="text-[12px] font-medium text-slate-600 dark:text-slate-400">
          Illustrative preview · {model.stateLabel}
        </p>
      </div>
      {progressBelow && <TaxYearProgress model={model} className="mt-6" />}
    </header>
  );
}

function TaxYearProgress({ model, className = "" }: { model: TaxPreviewModel; className?: string }) {
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
        <div className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400" style={{ width: `${model.taxYear.progressPct}%` }} />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[11px] text-slate-600 dark:text-slate-400">
        <span>6 Apr</span>
        <span className="text-center">{model.taxYear.daysLeft} days left</span>
        <span className="text-right">5 Apr</span>
      </div>
    </div>
  );
}

function VerdictCanvas({ model, compact = false }: { model: TaxPreviewModel; compact?: boolean }) {
  return (
    <section aria-labelledby="tax-verdict-heading" className={compact ? "" : "max-w-3xl"}>
      <h2
        id="tax-verdict-heading"
        className={`${compact ? "text-[26px]" : "text-[30px] sm:text-[34px]"} max-w-[22ch] text-balance font-bold leading-[1.13] tracking-[-0.035em] text-slate-950 dark:text-white`}
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
      <p className="mt-1.5 max-w-[65ch] text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">{children}</p>
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

function PensionLever({ model }: { model: TaxPreviewModel }) {
  const showCalculation = model.leverStatus === "action";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-labelledby="pension-lever-title">
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

function ActionGroup({ items, done, onToggle, ariaLabel }: { items: TaxAction[]; done: Set<string>; onToggle: (key: string) => void; ariaLabel: string }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <ActionRow key={item.key} item={item} done={done.has(item.key)} onToggle={() => onToggle(item.key)} />
      ))}
    </div>
  );
}

function AlsoWorthKnowing({ model, done, onToggle }: { model: TaxPreviewModel; done: Set<string>; onToggle: (key: string) => void }) {
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
        <ChevronDown size={17} className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
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

function KeyDates({ model }: { model: TaxPreviewModel }) {
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
          <p className="pl-11 text-[12px] font-semibold text-slate-600 dark:text-slate-300 sm:pl-0 sm:pt-1">{item.date}</p>
        </div>
      ))}
    </div>
  );
}

const PENNY_PROMPTS = [
  "How does pension carry-forward work?",
  "What counts as salary sacrifice?",
  "Do I need to register for self-assessment?",
  "How does Gift Aid reduce my tax?",
];

function PennyEntry({ onOpen, open }: { onOpen: () => void; open: boolean }) {
  return (
    <section aria-label="Ask Penny about tax">
      <button
        type="button"
        onClick={onOpen}
        aria-controls="g86-penny-chat"
        aria-expanded={open}
        className="flex min-h-12 w-full cursor-pointer touch-manipulation items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:hover:bg-slate-700"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: BRAND_GRADIENT }}>
          <PennyMark size={14} className="text-white" />
        </span>
        <span className="text-[14px] text-slate-600 dark:text-slate-300">Ask Penny about tax…</span>
      </button>
    </section>
  );
}

function PennyChatPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(110px+env(safe-area-inset-bottom,0px)+var(--g86-preview-clearance))] z-[70] px-3 lg:inset-x-auto lg:bottom-[calc(24px+var(--g86-preview-clearance))] lg:left-auto lg:right-6 lg:px-0">
      <section
        id="g86-penny-chat"
        role="dialog"
        aria-labelledby="g86-penny-chat-title"
        className="mx-auto flex max-h-[65dvh] min-h-[22rem] w-full max-w-[420px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/[0.04] dark:border-slate-700 dark:bg-slate-900 dark:ring-white/[0.08]"
      >
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: BRAND_GRADIENT }}>
            <PennyMark size={18} className="text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="g86-penny-chat-title" className="text-[16px] font-bold text-slate-950 dark:text-white">Penny</h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Tax questions</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close Penny chat"
            className="flex size-11 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-slate-500 [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-100 hover:text-slate-900 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overscroll-contain overflow-y-auto px-4 py-4">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">What would you like to understand?</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">
            Choose a Tax question or ask in your own words.
          </p>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Tax quick questions">
            {PENNY_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setSelectedPrompt(prompt)}
                aria-pressed={selectedPrompt === prompt}
                className={`inline-flex min-h-11 max-w-full cursor-pointer touch-manipulation items-center whitespace-normal rounded-full border px-4 py-2 text-left text-[13px] font-medium leading-5 [-webkit-tap-highlight-color:transparent] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${selectedPrompt === prompt ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-400/10 dark:text-indigo-200" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="mt-5 min-h-20 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800" aria-live="polite">
            {selectedPrompt ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Ready to ask</p>
                <p className="mt-1 text-[13px] leading-5 text-slate-800 dark:text-slate-200">{selectedPrompt}</p>
              </>
            ) : (
              <p className="text-[13px] leading-5 text-slate-500 dark:text-slate-400">Your question will appear here.</p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Illustrative chat. No message is sent.</p>
        </div>
      </section>
    </div>
  );
}

const PREVIEW_NAV_TABS = [
  { href: "/", label: "Home", Icon: Home, slot: 0 },
  { href: "/spend?view=period", label: "Spend", Icon: PieChart, slot: 1 },
  { href: "/upcoming", label: "Upcoming", Icon: CalendarClock, slot: 3 },
  { href: "/planning", label: "Planning", Icon: Target, slot: 4 },
];

function PreviewBottomNav({ pennyOpen, onTogglePenny }: { pennyOpen: boolean; onTogglePenny: () => void }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="nav-scrim pointer-events-none fixed inset-x-0 bottom-[var(--g86-preview-clearance)] z-40 h-[116px] lg:hidden"
      />
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom,0px),10px)+var(--g86-preview-clearance))] z-50 flex justify-center lg:hidden"
      >
        <div className="relative w-[calc(100%-28px)] max-w-[402px]">
          <button
            type="button"
            onClick={onTogglePenny}
            aria-label="Penny"
            aria-controls="g86-penny-chat"
            aria-expanded={pennyOpen}
            aria-pressed={pennyOpen}
            className="absolute -top-7 left-1/2 z-10 flex size-14 -translate-x-1/2 cursor-pointer touch-manipulation items-center justify-center rounded-2xl [-webkit-tap-highlight-color:transparent] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
            style={{
              background: BRAND_GRADIENT,
              boxShadow: pennyOpen
                ? "0 4px 14px rgba(79,70,229,0.35), 0 0 0 6px rgba(79,70,229,0.18)"
                : "0 4px 14px rgba(79,70,229,0.35)",
            }}
          >
            <PennyMark size={22} className="text-white" />
          </button>

          <div className="glass-rail relative rounded-[22px]">
            <div className="relative grid h-16 grid-cols-5 px-1.5">
              {PREVIEW_NAV_TABS.map((tab) => (
                <Link
                  key={tab.label}
                  href={tab.href}
                  style={{ gridColumnStart: tab.slot + 1 }}
                  className="relative z-10 flex min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-2xl [-webkit-tap-highlight-color:transparent] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none"
                >
                  <tab.Icon size={22} strokeWidth={1.8} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span className="text-[11px] font-medium leading-none text-slate-500 dark:text-slate-400">{tab.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}

function Disclaimer() {
  return (
    <p className="text-pretty text-center text-[11px] leading-4 text-slate-600 dark:text-slate-400">
      Estimates only. Speak to a qualified financial adviser or accountant for personalised advice.
    </p>
  );
}

function DesignNote({ variant }: { variant: Variant }) {
  const note = VARIANT_NOTES[variant];
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700" aria-labelledby="design-note-title">
      <h2 id="design-note-title" className="text-[14px] font-bold text-indigo-700 dark:text-indigo-300">{note.title}</h2>
      <p className="mt-2 text-[13px] leading-5 text-slate-700 dark:text-slate-300">{note.thesis}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Rule:</span> {note.rule}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Trade-off:</span> {note.tradeoff}</p>
    </section>
  );
}

function EmptyIncome({ model, variant }: { model: TaxPreviewModel; variant: Variant }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 lg:px-8">
      <PageTitle model={model} />
      <section className="mt-10 max-w-2xl">
        <h2 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-slate-950 dark:text-white">Add your income in Settings</h2>
        <p className="mt-3 max-w-[60ch] text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-400">
          Your tax levers and estimates personalise from the income and pension you set there.
        </p>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          <a href="/settings" className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800">
            Go to Settings
          </a>
        </div>
      </section>
      <div className="mt-12"><DesignNote variant={variant} /></div>
    </div>
  );
}

type TaxVariantProps = {
  model: TaxPreviewModel;
  done: Set<string>;
  onToggle: (key: string) => void;
  onOpenPenny: () => void;
  pennyOpen: boolean;
};

function VariantA({ model, done, onToggle, onOpenPenny, pennyOpen }: TaxVariantProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 lg:px-8">
      <PageTitle model={model} />
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

      <div className="mt-10"><PennyEntry onOpen={onOpenPenny} open={pennyOpen} /></div>
      <div className="mt-7"><Disclaimer /></div>
      <div className="mt-12"><DesignNote variant="a" /></div>
    </div>
  );
}

function VariantB({ model, done, onToggle, onOpenPenny, pennyOpen }: TaxVariantProps) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
      <PageTitle model={model} progressBelow={false} />
      <div className="mt-9 grid items-start gap-12 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.4fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-6">
          <TaxYearProgress model={model} />
          <div className="mt-10"><VerdictCanvas model={model} compact /></div>
        </aside>

        <div className="space-y-11">
          <section className="space-y-4">
            <SectionIntro title="Most useful next move">The calculation is bounded here because it turns your position into a concrete lever.</SectionIntro>
            <PensionLever model={model} />
          </section>
          <section className="space-y-4">
            <SectionIntro title="Your tax checks">Mark off the things you have handled. The facts stay visible after they are done.</SectionIntro>
            <ActionGroup items={model.mainActions} done={done} onToggle={onToggle} ariaLabel="Tax checks" />
            <AlsoWorthKnowing model={model} done={done} onToggle={onToggle} />
          </section>
          <section className="space-y-4">
            <SectionIntro title="Key dates">Three dates worth keeping in view for this tax year.</SectionIntro>
            <KeyDates model={model} />
          </section>
          <PennyEntry onOpen={onOpenPenny} open={pennyOpen} />
          <Disclaimer />
        </div>
      </div>
      <div className="mt-14"><DesignNote variant="b" /></div>
    </div>
  );
}

function VariantC({ model, done, onToggle, onOpenPenny, pennyOpen }: TaxVariantProps) {
  const isaActions = model.mainActions.filter((item) => item.key === "isa");
  const duringYearActions = model.mainActions.filter((item) => item.key !== "isa");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 lg:px-8">
      <PageTitle model={model} />
      <div className="mt-10"><VerdictCanvas model={model} /></div>

      <div className="relative mt-14 space-y-14 sm:pl-10 sm:before:absolute sm:before:bottom-8 sm:before:left-[11px] sm:before:top-2 sm:before:w-px sm:before:bg-slate-300 sm:dark:before:bg-slate-700">
        <section className="relative space-y-4">
          <span className="absolute -left-10 top-1 hidden size-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:flex" aria-hidden="true">1</span>
          <SectionIntro title="Before 5 Apr">Use anything that resets at the end of the tax year, starting with the highest-value move.</SectionIntro>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.8fr)]">
            <PensionLever model={model} />
            <ActionGroup items={isaActions} done={done} onToggle={onToggle} ariaLabel="Allowance deadline actions" />
          </div>
        </section>

        <section className="relative space-y-4">
          <span className="absolute -left-10 top-1 hidden size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-[11px] font-bold text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:flex" aria-hidden="true">2</span>
          <SectionIntro title="During the year">Keep the reliefs and checks that apply to you together, without turning each fact into its own card.</SectionIntro>
          {duringYearActions.length > 0 && (
            <ActionGroup items={duringYearActions} done={done} onToggle={onToggle} ariaLabel="During the year actions" />
          )}
          <AlsoWorthKnowing model={model} done={done} onToggle={onToggle} />
        </section>

        <section className="relative space-y-4">
          <span className="absolute -left-10 top-1 hidden size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-[11px] font-bold text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:flex" aria-hidden="true">3</span>
          <SectionIntro title="When filing is due">The dated obligations stay together as one calendar object.</SectionIntro>
          <KeyDates model={model} />
        </section>
      </div>

      <div className="mt-12"><PennyEntry onOpen={onOpenPenny} open={pennyOpen} /></div>
      <div className="mt-7"><Disclaimer /></div>
      <div className="mt-12"><DesignNote variant="c" /></div>
    </div>
  );
}

function PreviewControls({ variant, mode, state }: { variant: Variant; mode: Mode; state: TaxPreviewState }) {
  const hrefFor = (next: { variant?: Variant; mode?: Mode; state?: TaxPreviewState }) => {
    const params = new URLSearchParams({
      variant: next.variant ?? variant,
      mode: next.mode ?? mode,
      state: next.state ?? state,
    });
    return `?${params.toString()}`;
  };

  return (
    <nav aria-label="G86 design preview controls" className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1.5">
        {VARIANTS.map((item) => (
          <a
            key={item}
            href={hrefFor({ variant: item })}
            aria-current={variant === item ? "page" : undefined}
            className={`inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-xl px-3 text-[12px] font-semibold [-webkit-tap-highlight-color:transparent] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transition-none ${variant === item ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
          >
            {item.toUpperCase()} · {item === "a" ? "Reading" : item === "b" ? "Rail" : "Timeline"}
          </a>
        ))}
        <label className="ml-auto flex min-h-11 touch-manipulation items-center rounded-xl bg-white/10 px-2.5 text-[12px] text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400">
          <span className="sr-only">Preview tax state</span>
          <select
            name="preview-state"
            value={state}
            onChange={(event) => window.location.assign(hrefFor({ state: event.target.value as TaxPreviewState }))}
            className="cursor-pointer bg-slate-800 pr-1 font-semibold text-white outline-none"
          >
            {TAX_PREVIEW_STATES.map((item) => <option key={item} value={item} className="bg-slate-900">{TAX_STATE_LABELS[item]}</option>)}
          </select>
        </label>
        <a
          href={hrefFor({ mode: mode === "dark" ? "light" : "dark" })}
          className="inline-flex min-h-11 cursor-pointer touch-manipulation items-center rounded-xl px-3 text-[12px] font-semibold text-slate-300 [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transition-none"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function TaxCanvasBeforeCardsClient() {
  const params = useSearchParams();
  const requestedVariant = params.get("variant") as Variant | null;
  const requestedState = params.get("state") as TaxPreviewState | null;
  const variant = requestedVariant && VARIANTS.includes(requestedVariant) ? requestedVariant : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state = requestedState && TAX_PREVIEW_STATES.includes(requestedState) ? requestedState : "trap";
  const hideControls = params.get("controls") === "0";
  const model = useMemo(() => getTaxPreviewModel(state), [state]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pennyOpen, setPennyOpen] = useState(false);
  const pennyReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousDark = root.classList.contains("dark");
    const previousColourScheme = root.style.colorScheme;
    const previousThemeColour = themeMeta?.getAttribute("content") ?? null;

    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    themeMeta?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");

    return () => {
      root.classList.toggle("dark", previousDark);
      root.style.colorScheme = previousColourScheme;
      if (previousThemeColour === null) themeMeta?.removeAttribute("content");
      else themeMeta?.setAttribute("content", previousThemeColour);
    };
  }, [mode]);

  const toggleDone = (key: string) => {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openPenny = () => {
    pennyReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPennyOpen(true);
  };

  const closePenny = () => {
    setPennyOpen(false);
    window.requestAnimationFrame(() => pennyReturnFocusRef.current?.focus());
  };

  const togglePenny = () => {
    if (pennyOpen) closePenny();
    else openPenny();
  };

  const content = !model.hasIncome
    ? <EmptyIncome model={model} variant={variant} />
    : variant === "b"
      ? <VariantB model={model} done={done} onToggle={toggleDone} onOpenPenny={openPenny} pennyOpen={pennyOpen} />
      : variant === "c"
        ? <VariantC model={model} done={done} onToggle={toggleDone} onOpenPenny={openPenny} pennyOpen={pennyOpen} />
        : <VariantA model={model} done={done} onToggle={toggleDone} onOpenPenny={openPenny} pennyOpen={pennyOpen} />;

  return (
    <div
      className={mode === "dark" ? "dark" : ""}
      style={{
        colorScheme: mode,
        "--g86-preview-clearance": hideControls ? "0px" : "108px",
      } as React.CSSProperties}
    >
      <div className={`min-h-dvh bg-[#f0f2f7] text-slate-950 selection:bg-indigo-200 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white ${hideControls ? "pb-32" : "pb-60"} lg:pb-28`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <p className="sr-only">Illustrative figures, not real balances. G86 Tax canvas before cards variant {variant.toUpperCase()}.</p>
        <a href="#g86-main" className="sr-only fixed left-3 top-3 z-[100] rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:text-white">
          Skip to Tax content
        </a>
        <main id="g86-main" tabIndex={-1}>{content}</main>
        <PennyChatPreview open={pennyOpen} onClose={closePenny} />
        <PreviewBottomNav pennyOpen={pennyOpen} onTogglePenny={togglePenny} />
        {!hideControls && <PreviewControls variant={variant} mode={mode} state={state} />}
      </div>
    </div>
  );
}
