"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, EyeOff, Info, X } from "lucide-react";
import FixtureBottomNav from "@/app/design/_components/FixtureBottomNav";
import UpcomingDayCard from "@/components/upcoming/UpcomingDayCard";
import UpcomingRow, {
  type UpcomingRowModel,
  type UpcomingRowTreatment,
} from "@/components/upcoming/UpcomingRow";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { LATE_MOVE_ROWS, NEXT_DAY_ROW, ORDINARY_ROW } from "./fixtures";

type Variant = "a" | "b" | "c";
type PreviewState = "late" | "mixed";
type Mode = "light" | "dark";

const VARIANT_COPY: Record<Variant, { label: string; title: string; summary: string }> = {
  a: {
    label: "A · Shelf",
    title: "Status shelf",
    summary: "One expandable status owns the shared explanation. Rows stay focused on who, how much and what remains.",
  },
  b: {
    label: "B · Cluster",
    title: "Exception cluster",
    summary: "Ordinary payments keep their rhythm. Late account moves become one compact operational group below them.",
  },
  c: {
    label: "C · Caption",
    title: "Inline summary",
    summary: "The lightest intervention: one sentence introduces the state, then the familiar ledger continues underneath.",
  },
};

function href({ variant, state, mode }: { variant: Variant; state: PreviewState; mode: Mode }) {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function statusSentence(count: number) {
  if (count === 0) return "No planned moves from Fri 25 Sept remain in this preview";
  return `${count} planned ${count === 1 ? "move" : "moves"} from Fri 25 Sept ${count === 1 ? "has" : "have"} not left yet`;
}

function formatFixtureDate(iso: string) {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

function SharedExplanation() {
  return (
    <div className="space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
      <p>These are moves between your own accounts. If the source balance is tight, they may simply stay put. There is no fee.</p>
      <p className="font-medium text-slate-700 dark:text-slate-200">Open any move to change it or skip it for this month.</p>
    </div>
  );
}

function StatusShelf({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <section className="bg-slate-50/80 px-4 py-2 dark:bg-slate-900/35" aria-label="Planned move status">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailId}
        className="pointer-events-auto flex min-h-11 w-full items-center gap-2.5 text-left active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">{statusSentence(count)}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
          Details
          <ChevronDown size={14} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={detailId} className="pb-3 pl-[18px] pr-2">
          <SharedExplanation />
        </div>
      )}
    </section>
  );
}

function InlineSummary({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <div className="px-4 py-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={detailId}
        className="pointer-events-auto flex min-h-11 w-full items-center gap-2 text-left active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs font-medium leading-5 text-slate-600 dark:text-slate-300">{statusSentence(count)}</span>
        <Info size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {open && (
        <div id={detailId} className="pb-2 pl-3">
          <SharedExplanation />
        </div>
      )}
    </div>
  );
}

function ExceptionCluster({
  rows,
  renderRow,
}: {
  rows: UpcomingRowModel[];
  renderRow: (row: UpcomingRowModel, treatment: UpcomingRowTreatment) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <section aria-labelledby={`${detailId}-heading`} className="bg-slate-50/70 dark:bg-slate-900/30">
      <div className="px-4 py-2.5">
        <div className="flex min-h-11 items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 id={`${detailId}-heading`} className="text-sm font-semibold text-slate-800 dark:text-slate-100">Moves still waiting</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{rows.length} from Fri 25 Sept</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={detailId}
            className="pointer-events-auto inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
          >
            Why
            <ChevronDown size={14} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
        {open && (
          <div id={detailId} className="pb-2 pl-[18px]">
            <SharedExplanation />
          </div>
        )}
      </div>
      <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
        {rows.map((row) => renderRow(row, "exception-cluster"))}
      </div>
    </section>
  );
}

function FixtureRowSheet({
  row,
  onClose,
  onSkip,
}: {
  row: UpcomingRowModel;
  onClose: () => void;
  onSkip: () => void;
}) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const isLateMove = Boolean(row.isMovement && row.pending);
  const expectedDateLabel = formatFixtureDate(row.expectedDate);
  const plannedDateLabel = formatFixtureDate(row.originalDate ?? row.expectedDate);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[65] bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-[70]">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="g176-row-sheet-title"
          className="glass-sheet mx-auto flex max-h-[85dvh] w-full max-w-[500px] flex-col rounded-t-3xl"
        >
          <div className="flex shrink-0 justify-center pb-1 pt-3" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-600" />
          </div>
          <div className="flex items-start gap-3 px-5 pb-4 pt-2">
            <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${row.categoryColour}26` }} aria-hidden="true">
              <row.CategoryIcon size={16} style={{ color: row.categoryColour }} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="g176-row-sheet-title" className="break-words text-base font-semibold leading-6 text-slate-900 dark:text-slate-100">{row.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isLateMove ? `Planned ${plannedDateLabel}` : `Expected ${expectedDateLabel}`} · <span className="font-mono tabular-nums">−£{row.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-700 dark:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            <section className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800" aria-labelledby="g176-status-heading">
              <div className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                <div>
                  <h3 id="g176-status-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">{isLateMove ? "Still waiting to leave" : "Included in forecast"}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                    {isLateMove
                      ? `This move was planned for ${plannedDateLabel}. If the source balance is tight, it may simply stay put. There is no fee.`
                      : `This payment is still included in the forecast for ${expectedDateLabel}.`}
                  </p>
                </div>
              </div>
            </section>
            <dl className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-slate-500 dark:text-slate-400">From</dt>
                <dd className="text-right font-medium text-slate-800 dark:text-slate-100">{row.accountLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-slate-500 dark:text-slate-400">Forecast</dt>
                <dd className="text-right font-medium text-slate-800 dark:text-slate-100">Still included this month</dd>
              </div>
            </dl>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Keep in forecast
              </button>
              {isLateMove && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="min-h-11 w-full rounded-xl px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Dismiss for this month
                </button>
              )}
            </div>
            <p className="text-center text-xs text-slate-400 dark:text-slate-500">Preview only. No forecast or payment changes here.</p>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function PreviewControls({ variant, state, mode }: { variant: Variant; state: PreviewState; mode: Mode }) {
  const chip = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-3 bottom-3 z-[80] mx-auto flex max-w-max gap-1 overflow-x-auto rounded-2xl bg-slate-950/95 p-1.5 shadow-xl">
      {(["a", "b", "c"] as Variant[]).map((value) => (
        <Link key={value} href={href({ variant: value, state, mode })} aria-current={variant === value ? "page" : undefined} className={`${chip} ${variant === value ? "bg-white text-slate-950" : "text-slate-200 hover:bg-slate-800"}`}>
          {value.toUpperCase()}
        </Link>
      ))}
      <Link href={href({ variant, state: state === "late" ? "mixed" : "late", mode })} className={`${chip} text-slate-200 hover:bg-slate-800`}>
        {state === "late" ? "Mixed" : "Moves only"}
      </Link>
      <Link href={href({ variant, state, mode: mode === "dark" ? "light" : "dark" })} className={`${chip} text-slate-200 hover:bg-slate-800`}>
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

export default function G176Client() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const state: PreviewState = params.get("state") === "mixed" ? "mixed" : "late";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [activeRow, setActiveRow] = useState<UpcomingRowModel | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const colourScheme = document.querySelector('meta[name="color-scheme"]');
    const previousColourScheme = colourScheme?.getAttribute("content") ?? null;

    root.classList.toggle("dark", mode === "dark");
    colourScheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");

    return () => {
      root.classList.toggle("dark", wasDark);
      if (previousColourScheme === null) colourScheme?.removeAttribute("content");
      else colourScheme?.setAttribute("content", previousColourScheme);
    };
  }, [mode]);

  const lateRows = LATE_MOVE_ROWS.filter((row) => !dismissed.has(row.rowKey));
  const regularRows = state === "mixed" ? [ORDINARY_ROW] : [];
  const note = VARIANT_COPY[variant];

  function renderRow(row: UpcomingRowModel, treatment: UpcomingRowTreatment) {
    return (
      <UpcomingRow
        key={row.rowKey}
        model={row}
        treatment={treatment}
        lateStatusGrouped
        onOpen={() => setActiveRow(row)}
        onDismiss={() => {}}
      />
    );
  }

  let activeRows: React.ReactNode[];
  if (variant === "a") {
    activeRows = [
      ...(lateRows.length > 0 ? [<StatusShelf key="status" count={lateRows.length} />] : []),
      ...regularRows.map((row) => renderRow(row, "status-shelf")),
      ...lateRows.map((row) => renderRow(row, "status-shelf")),
    ];
  } else if (variant === "b") {
    activeRows = [
      ...regularRows.map((row) => renderRow(row, "status-shelf")),
      ...(lateRows.length > 0 ? [<ExceptionCluster key="cluster" rows={lateRows} renderRow={renderRow} />] : []),
    ];
  } else {
    activeRows = [
      ...(lateRows.length > 0 ? [<InlineSummary key="summary" count={lateRows.length} />] : []),
      ...regularRows.map((row) => renderRow(row, "inline-summary")),
      ...lateRows.map((row) => renderRow(row, "inline-summary")),
    ];
  }

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode, "--design-controls-clearance": "108px" } as React.CSSProperties}>
      <div className="min-h-dvh overflow-x-hidden bg-[#f0f2f7] pb-64 text-slate-900 selection:bg-indigo-200 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100 lg:pb-24">
        <a href="#g176-main" className="sr-only fixed left-4 top-3 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only">Skip to row preview</a>
        <main id="g176-main" className="mx-auto w-full max-w-xl px-4 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
          <Link href="/design" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-sm font-medium text-slate-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
            <ArrowLeft size={17} aria-hidden="true" />
            Design rounds
          </Link>

          <header className="mt-3 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">What will enter or leave, and whether every payment is covered.</p>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
              <EyeOff size={20} strokeWidth={1.75} className="text-slate-300 dark:text-slate-600" />
            </span>
          </header>

          <section className="mt-8 space-y-3" aria-labelledby="g176-upcoming-heading">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <h2 id="g176-upcoming-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note.title}. {note.summary}</p>
              </div>
              <p className="hidden shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:block">“After” is your projected cash</p>
            </div>

            {previewStatus && (
              <p role="status" className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-200">{previewStatus}</p>
            )}

            {activeRows.length > 0 && (
              <UpcomingDayCard
                dayKeyIso="2026-09-29"
                heading="Today · Tue 29 Sep"
                activeRows={activeRows}
                settlingRows={[]}
              />
            )}

            <UpcomingDayCard
              dayKeyIso="2026-09-30"
              heading="Tomorrow · Wed 30 Sep"
              activeRows={[renderRow(NEXT_DAY_ROW, variant === "b" ? "status-shelf" : variant === "c" ? "inline-summary" : "status-shelf")]}
              settlingRows={[]}
            />
          </section>

          <p className="mt-6 px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Static invented figures only. Tap a row to inspect the proposed detail and dismissal path.</p>
        </main>

        <FixtureBottomNav active="Upcoming" />
        <PreviewControls variant={variant} state={state} mode={mode} />

        {activeRow && (
          <FixtureRowSheet
            row={activeRow}
            onClose={() => setActiveRow(null)}
            onSkip={() => {
              setDismissed((current) => new Set(current).add(activeRow.rowKey));
              setPreviewStatus(lateRows.length === 1
                ? "All planned moves have been dismissed for this month in the preview."
                : `${activeRow.name} dismissed for this month in the preview.`);
              setActiveRow(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
