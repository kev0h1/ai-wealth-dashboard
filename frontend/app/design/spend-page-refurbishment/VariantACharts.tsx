"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Car,
  ChartNoAxesCombined,
  ChartPie,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import SpendTrends, { DEFAULT_HOME_PINNED_WIDGET, DEFAULT_WIDGETS, PaceCurveWidget, type WidgetData } from "@/components/SpendTrends";
import type { Transaction } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { PACE_SERIES, PERIOD_HISTORY } from "./data";
import { focusRing, money, Money } from "./shared";

export type ChartPlacement = "here" | "page";

export type PreviewChartId =
  | "pace"
  | "period"
  | "category"
  | "daily"
  | "sizes"
  | "transport"
  | "debt";

type ChartMeta = {
  title: string;
  description: string;
  Icon: LucideIcon;
};

const CHART_META: Record<PreviewChartId, ChartMeta> = {
  pace: { title: "Spending pace", description: "This period against your learned usual", Icon: Activity },
  period: { title: "Period comparison", description: "Out and usual across six pay periods", Icon: TrendingUp },
  category: { title: "Category breakdown", description: "Where this period's spending went", Icon: ChartPie },
  daily: { title: "Daily spend", description: "How much you spent each day", Icon: BarChart3 },
  sizes: { title: "Payment sizes", description: "Payments grouped by amount", Icon: AlignStartVertical },
  transport: { title: "Transport by mode", description: "Car, public transport and rideshare", Icon: Car },
  debt: { title: "Card balance ahead", description: "Where card balances are heading", Icon: TrendingDown },
};

const ALL_CHARTS = Object.keys(CHART_META) as PreviewChartId[];
const INITIAL_CHARTS: PreviewChartId[] = ["pace", "period"];

export type ChartCollectionState = {
  charts: PreviewChartId[];
  pinned: PreviewChartId | null;
};

export const INITIAL_CHART_COLLECTION: ChartCollectionState = {
  charts: INITIAL_CHARTS,
  pinned: "period",
};

export const CHART_TRANSACTIONS: Transaction[] = [
  { id: "chart-1", account_id: "preview", date: "2026-09-02", amount: 2080, currency: "GBP", description: "Bills", category: "Bills", transaction_type: "debit" },
  { id: "chart-2", account_id: "preview", date: "2026-09-05", amount: 612, currency: "GBP", description: "Eating out", category: "Eating Out", transaction_type: "debit" },
  { id: "chart-3", account_id: "preview", date: "2026-09-08", amount: 448, currency: "GBP", description: "Transport", category: "Transport", transaction_type: "debit" },
  { id: "chart-4", account_id: "preview", date: "2026-09-11", amount: 421, currency: "GBP", description: "Groceries", category: "Groceries", transaction_type: "debit" },
  { id: "chart-5", account_id: "preview", date: "2026-09-13", amount: 1075, currency: "GBP", description: "Other spending", category: "Shopping", transaction_type: "debit" },
  { id: "chart-prev-1", account_id: "preview", date: "2026-08-12", amount: 1620, currency: "GBP", description: "Previous bills", category: "Bills", transaction_type: "debit" },
  { id: "chart-prev-2", account_id: "preview", date: "2026-08-18", amount: 1990, currency: "GBP", description: "Previous spending", category: "Shopping", transaction_type: "debit" },
  { id: "chart-prev-3", account_id: "preview", date: "2026-07-14", amount: 3385, currency: "GBP", description: "Earlier spending", category: "Bills", transaction_type: "debit" },
  { id: "chart-prev-4", account_id: "preview", date: "2026-06-15", amount: 3900, currency: "GBP", description: "Earlier spending", category: "Bills", transaction_type: "debit" },
];

const WIDGET_DATA: WidgetData = {
  periodTxns: CHART_TRANSACTIONS.slice(0, 5),
  allTxns: CHART_TRANSACTIONS,
  periodStart: new Date("2026-08-30T00:00:00Z"),
  periodEnd: new Date("2026-09-26T00:00:00Z"),
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  colours: {},
  paceSeries: PACE_SERIES.map((point) => ({ ...point })),
};

function PeriodComparisonChart() {
  const maximum = Math.max(...PERIOD_HISTORY.flatMap((period) => [period.out, period.usual]));

  return (
    <ul aria-label="Out compared with usual across six recent pay periods" className="mt-4 space-y-3">
      {PERIOD_HISTORY.map((period) => (
        <li key={period.label}>
          <span className="sr-only">
            {"current" in period && period.current ? "This period" : period.label}: Out {money(period.out)}, usual {money(period.usual)}
          </span>
          <div aria-hidden="true">
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="truncate font-medium text-slate-600 dark:text-slate-300">
                {"current" in period && period.current ? "This period" : period.label.slice(0, 6)}
              </span>
              <Money value={period.out} className="font-bold text-slate-900 dark:text-white" />
            </div>
            <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <span className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${(period.out / maximum) * 100}%` }} />
              <span className="absolute inset-y-[-2px] w-px bg-slate-700 dark:bg-slate-200" style={{ left: `${(period.usual / maximum) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
      <li aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[10px] font-medium text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-indigo-500" />Out</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-slate-700 dark:bg-slate-200" />Usual</span>
      </li>
    </ul>
  );
}

function PaceChart() {
  return (
    <>
      <p className="text-sm leading-snug text-slate-600 dark:text-slate-300">
        Day <span className="font-bold text-slate-900 dark:text-white">13</span>: <Money value={4976} className="font-bold text-slate-900 dark:text-white" /> so far · <Money value={1586} className="font-bold text-slate-900 dark:text-white" /> ahead of usual
      </p>
      <div role="img" aria-label="Cumulative spending pace from day 1 to day 13. Actual spending rose from £410 to £4,976; usual spending rose from £360 to £3,390." className="mt-3">
        <PaceCurveWidget data={WIDGET_DATA} compact />
        <div aria-hidden="true" className="mt-1 flex justify-between px-1 text-[9px] text-slate-500 dark:text-slate-400">
          <span>Day 1</span><span>Day 7</span><span>Day 13</span>
        </div>
      </div>
    </>
  );
}

function SupportingChart({ id }: { id: Exclude<PreviewChartId, "pace" | "period"> }) {
  const labels: Record<typeof id, string> = {
    category: "Bills 42%, groceries 18%, eating out 12%, other 28%",
    daily: "Daily spending ranged from £42 to £780 this period",
    sizes: "Most payments were below £50; four were above £250",
    transport: "Transport spending was split across car, public transport and rideshare",
    debt: "Projected card balances decline over the next six months",
  };

  return (
    <div role="img" aria-label={labels[id]} className="mt-1">
      <div aria-hidden="true" className="flex h-24 items-end gap-2 border-b border-slate-200 px-1 pb-1 dark:border-slate-600">
        {[36, 54, 44, 76, 62, 88, 70, 94].map((height, index) => (
          <span key={index} className={`flex-1 rounded-t-sm ${id === "debt" ? "bg-slate-400 dark:bg-slate-500" : "bg-indigo-500"}`} style={{ height: `${id === "debt" ? 110 - height : height}%` }} />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Preview data for this comparison</p>
    </div>
  );
}

function ChartBody({ id }: { id: PreviewChartId }) {
  if (id === "pace") return <PaceChart />;
  if (id === "period") return <PeriodComparisonChart />;
  return <SupportingChart id={id} />;
}

function ChartCard({ id, index, total, pinned, pinnedChart, arranging, menuOpen, headingLevel, onToggleMenu, onMove, onPin, onRemove }: {
  id: PreviewChartId;
  index: number;
  total: number;
  pinned: boolean;
  pinnedChart: PreviewChartId | null;
  arranging: boolean;
  menuOpen: boolean;
  headingLevel: 3 | 4;
  onToggleMenu: () => void;
  onMove: (direction: -1 | 1) => void;
  onPin: () => void;
  onRemove: () => void;
}) {
  const { title, description, Icon } = CHART_META[id];
  const Heading = headingLevel === 3 ? "h3" : "h4";

  return (
    <article className="relative min-w-0 rounded-2xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <div className="mb-3 flex items-start gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon size={17} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Heading className="text-sm font-bold text-slate-900 dark:text-white">{title}</Heading>
            {pinned && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"><Pin size={10} aria-hidden="true" /> On Home</span>}
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">{description}</p>
        </div>

        {arranging ? (
          <div className="flex shrink-0 gap-1">
            <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${title} up`} className={`flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 ${focusRing}`}><ArrowUp size={15} aria-hidden="true" /></button>
            <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${title} down`} className={`flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 ${focusRing}`}><ArrowDown size={15} aria-hidden="true" /></button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              if (!menuOpen && window.innerWidth < 1024) event.currentTarget.closest("article")?.scrollIntoView({ block: "center" });
              onToggleMenu();
            }}
            aria-label={`Manage ${title}`}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-controls={`chart-actions-${id}`}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 active:scale-95 motion-reduce:transition-none dark:text-slate-400 dark:hover:bg-slate-700 ${focusRing}`}
          ><MoreVertical size={17} aria-hidden="true" /></button>
        )}
      </div>

      {menuOpen && !arranging && (
        <div id={`chart-actions-${id}`} className="absolute right-4 top-14 z-20 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-700">
          <button type="button" onClick={onPin} aria-label={pinned ? `Unpin ${title} from Home` : `Pin ${title} to Home${pinnedChart ? `, replacing ${CHART_META[pinnedChart].title}` : ""}`} className={`flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100 motion-reduce:transition-none dark:text-slate-100 dark:hover:bg-slate-600 ${focusRing}`}>
            {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
            <span>
              <span className="block">{pinned ? "Unpin from Home" : "Pin to Home"}</span>
              {!pinned && pinnedChart && <span className="mt-0.5 block text-[10px] font-medium text-slate-500 dark:text-slate-300">Replaces {CHART_META[pinnedChart].title}</span>}
            </span>
          </button>
          <button type="button" onClick={onRemove} className={`flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 active:bg-red-100 motion-reduce:transition-none dark:text-red-300 dark:hover:bg-red-400/10 ${focusRing}`}><Trash2 size={14} aria-hidden="true" /> Remove chart</button>
        </div>
      )}

      <ChartBody id={id} />
    </article>
  );
}

function AddChartSheet({ available, onAdd, onClose }: { available: PreviewChartId[]; onAdd: (id: PreviewChartId) => void; onClose: () => void }) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  return createPortal(
    <>
      <button type="button" tabIndex={-1} aria-label="Close add chart" onClick={onClose} className="fixed inset-0 z-[120] cursor-default bg-black/40" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="add-chart-title" className="fixed inset-x-0 bottom-0 z-[130] mx-auto max-h-[82dvh] w-full max-w-[430px] overscroll-contain overflow-y-auto rounded-t-3xl border-t border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl dark:border-slate-700 dark:bg-slate-900 lg:bottom-auto lg:top-1/2 lg:max-w-md lg:-translate-y-1/2 lg:rounded-3xl lg:border">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 id="add-chart-title" className="text-lg font-bold text-slate-950 dark:text-white">Add a chart</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Choose what helps you understand this pay period.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}><X size={17} aria-hidden="true" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {available.map((id) => {
            const { title, description, Icon } = CHART_META[id];
            return (
              <button key={id} type="button" onClick={() => onAdd(id)} className={`flex min-h-16 w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left transition-colors hover:bg-indigo-50 active:scale-[0.99] motion-reduce:transition-none dark:bg-slate-800 dark:hover:bg-indigo-400/10 ${focusRing}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300 dark:shadow-none"><Icon size={16} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900 dark:text-white">{title}</span><span className="block text-[11px] text-slate-600 dark:text-slate-400">{description}</span></span>
                <Plus size={16} className="shrink-0 text-indigo-500" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function ChartManagerPreview({ collection, setCollection, headingLevel = 4 }: {
  collection: ChartCollectionState;
  setCollection: Dispatch<SetStateAction<ChartCollectionState>>;
  headingLevel?: 3 | 4;
}) {
  const { charts, pinned } = collection;
  const [arranging, setArranging] = useState(false);
  const [menuOpen, setMenuOpen] = useState<PreviewChartId | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [removed, setRemoved] = useState<{ id: PreviewChartId; index: number; wasPinned: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const available = ALL_CHARTS.filter((id) => !charts.includes(id));

  function moveChart(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= charts.length) return;
    const next = [...charts];
    [next[index], next[target]] = [next[target], next[index]];
    setCollection({ charts: next, pinned });
    setRemoved(null);
    setMessage(`${CHART_META[next[target]].title} moved ${direction < 0 ? "up" : "down"}.`);
  }

  function removeChart(id: PreviewChartId) {
    const index = charts.indexOf(id);
    if (index < 0) return;
    const wasPinned = pinned === id;
    setCollection({ charts: charts.filter((chart) => chart !== id), pinned: wasPinned ? null : pinned });
    setRemoved({ id, index, wasPinned });
    setMenuOpen(null);
    setMessage(`${CHART_META[id].title} removed.`);
  }

  function undoRemove() {
    if (!removed) return;
    const next = [...charts];
    next.splice(Math.min(removed.index, next.length), 0, removed.id);
    setCollection({ charts: next, pinned: removed.wasPinned ? removed.id : pinned });
    setMessage(`${CHART_META[removed.id].title} restored.`);
    setRemoved(null);
  }

  function togglePin(id: PreviewChartId) {
    const next = pinned === id ? null : id;
    const replaced = pinned !== null && pinned !== id ? pinned : null;
    setCollection({ charts, pinned: next });
    setMenuOpen(null);
    setRemoved(null);
    setMessage(next
      ? `${CHART_META[id].title} pinned to Home.${replaced ? ` ${CHART_META[replaced].title} was replaced.` : ""}`
      : `${CHART_META[id].title} unpinned from Home.`);
  }

  function addChart(id: PreviewChartId) {
    setCollection({ charts: [...charts, id], pinned });
    setGalleryOpen(false);
    setRemoved(null);
    setMessage(`${CHART_META[id].title} added.`);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{charts.length} shown · {ALL_CHARTS.length} available</p>
        {charts.length > 1 && (
          <button type="button" onClick={() => { setArranging((value) => !value); setMenuOpen(null); }} aria-pressed={arranging} className={`min-h-11 rounded-xl border px-3 text-xs font-bold transition-colors active:scale-95 motion-reduce:transition-none ${arranging ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"} ${focusRing}`}>{arranging ? "Done" : "Reorder"}</button>
        )}
      </div>

      {message && (
        <div role="status" aria-live="polite" className="mt-3 flex min-h-11 items-center gap-3 rounded-xl bg-slate-100 px-3 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <span className="min-w-0 flex-1">{message}</span>
          {removed && <button type="button" onClick={undoRemove} className={`min-h-9 shrink-0 font-bold text-indigo-600 dark:text-indigo-300 ${focusRing}`}>Undo</button>}
        </div>
      )}

      <div className="mt-3 space-y-3">
        {charts.map((id, index) => (
          <ChartCard key={id} id={id} index={index} total={charts.length} pinned={pinned === id} pinnedChart={pinned} arranging={arranging} menuOpen={menuOpen === id} headingLevel={headingLevel} onToggleMenu={() => setMenuOpen(menuOpen === id ? null : id)} onMove={(direction) => moveChart(index, direction)} onPin={() => togglePin(id)} onRemove={() => removeChart(id)} />
        ))}

        {charts.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"><p className="text-sm font-bold text-slate-900 dark:text-white">No charts shown</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Add the first chart to build your view.</p></div>
        )}
      </div>

      {available.length > 0 && (
        <button type="button" onClick={() => setGalleryOpen(true)} className={`mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-300 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-50 active:scale-[0.99] motion-reduce:transition-none dark:border-indigo-400/40 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focusRing}`}><Plus size={16} aria-hidden="true" /> Add chart</button>
      )}

      {galleryOpen && <AddChartSheet available={available} onAdd={addChart} onClose={() => setGalleryOpen(false)} />}
    </div>
  );
}

function SeparatePageEntry({ href, collection }: { href: string; collection: ChartCollectionState }) {
  const visible = collection.charts.slice(0, 2);
  const hiddenCount = collection.charts.length - visible.length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-sm font-bold text-slate-900 dark:text-white">Your chart collection</p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{collection.charts.length} {collection.charts.length === 1 ? "chart is" : "charts are"} selected. Add, remove, reorder or pin from the chart workspace.</p></div>
        <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold tabular-nums text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">{collection.charts.length} of {ALL_CHARTS.length}</span>
      </div>
      <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {visible.map((id) => {
          const { Icon, title } = CHART_META[id];
          return <div key={id} className="flex min-h-14 items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon size={15} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>{collection.pinned === id && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300"><Pin size={10} aria-hidden="true" /> Home</span>}</div>;
        })}
        {hiddenCount > 0 && <div className="flex min-h-11 items-center text-xs font-semibold text-slate-600 dark:text-slate-300">+{hiddenCount} more in your chosen order</div>}
        {visible.length === 0 && <div className="flex min-h-14 items-center text-xs text-slate-600 dark:text-slate-400">No charts selected yet</div>}
        {collection.pinned && !visible.includes(collection.pinned) && <div className="flex min-h-11 items-center justify-between gap-3 text-xs"><span className="text-slate-600 dark:text-slate-400">Pinned to Home</span><span className="font-semibold text-slate-900 dark:text-white">{CHART_META[collection.pinned].title}</span></div>}
      </div>
      <Link href={href} className={`mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-indigo-600 px-4 text-left text-white transition-colors hover:bg-indigo-700 active:scale-[0.99] motion-reduce:transition-none ${focusRing}`}>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15"><ChartNoAxesCombined size={17} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-bold">Open your charts</span><span className="block text-[11px] text-indigo-100">Manage all seven chart choices</span></span>
        <ArrowRight size={17} className="shrink-0" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default function VariantACharts({ placement, pageHref, collection, setCollection }: {
  placement: ChartPlacement;
  pageHref: string;
  collection: ChartCollectionState;
  setCollection: Dispatch<SetStateAction<ChartCollectionState>>;
}) {
  if (placement === "page") return <SeparatePageEntry href={pageHref} collection={collection} />;
  return (
    <SpendTrends
      embedded
      preview={{ widgets: DEFAULT_WIDGETS, pinnedWidget: DEFAULT_HOME_PINNED_WIDGET }}
      periodTxns={WIDGET_DATA.periodTxns}
      allTxns={WIDGET_DATA.allTxns}
      periodStart={WIDGET_DATA.periodStart}
      periodEnd={WIDGET_DATA.periodEnd}
      payPeriodConfig={WIDGET_DATA.payPeriodConfig}
      colours={WIDGET_DATA.colours}
      paceSeries={WIDGET_DATA.paceSeries}
    />
  );
}
