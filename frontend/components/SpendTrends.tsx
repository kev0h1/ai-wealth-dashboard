"use client";

// The Trends tab on the Spend page: a user-configurable stack of chart
// widgets, all computed client-side from the already-loaded transactions and
// scoped to the pay period the user is viewing. One widget can be pinned to
// the home page (PinnedWidgetCard), where it renders compact and deep-links
// back here.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  ChartPie, BarChart3, TrendingUp, AlignStartVertical, MoreVertical,
  Pin, PinOff, Trash2, Plus, ChevronRight,
} from "lucide-react";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, Transaction } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { CATEGORY_COLOURS } from "@/lib/categories";
import {
  PayPeriodConfig, prevPeriodWithConfig, filterPeriod,
} from "@/lib/payPeriod";

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export type WidgetId = "category_pie" | "daily_bars" | "period_compare" | "size_distribution";

export const DEFAULT_WIDGETS: WidgetId[] = ["category_pie", "daily_bars"];

const WIDGET_META: Record<WidgetId, { title: string; description: string; Icon: typeof ChartPie }> = {
  category_pie: {
    title: "Category breakdown",
    description: "Where this period's spend went, as a donut",
    Icon: ChartPie,
  },
  daily_bars: {
    title: "Daily spend",
    description: "How much you spent each day this period",
    Icon: BarChart3,
  },
  period_compare: {
    title: "Period comparison",
    description: "Total spend across your last six pay periods",
    Icon: TrendingUp,
  },
  size_distribution: {
    title: "Transaction sizes",
    description: "How many transactions fall in each price band",
    Icon: AlignStartVertical,
  },
};

const ALL_WIDGETS = Object.keys(WIDGET_META) as WidgetId[];

function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && v in WIDGET_META;
}

interface WidgetData {
  periodTxns: Transaction[];
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function spendDebits(txns: Transaction[]): Transaction[] {
  return txns.filter(t => t.transaction_type === "debit" && (t.category || "Other") !== "Transfer");
}

const fmtGBP = (n: number) =>
  `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

// Log-safe floor for zero-spend days on the daily chart
const DAILY_LOG_FLOOR = 0.1;

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(15,23,42,0.92)",
  border: "none",
  borderRadius: 10,
  padding: "6px 10px",
  fontSize: 11,
  color: "#f1f5f9",
} as const;

/* ── Widget renderers ─────────────────────────────────────────────── */

function CategoryPieWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const slices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of data.periodTxns) {
      const cat = t.category || "Other";
      if (cat === "Transfer" || cat === "Income") continue;
      // Credits are refunds — net them against the category
      map[cat] = (map[cat] ?? 0) + (t.transaction_type === "credit" ? -Math.abs(t.amount) : Math.abs(t.amount));
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter(s => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data.periodTxns]);

  if (slices.length === 0) return <EmptyWidget compact={compact} />;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const colour = (name: string) =>
    data.colours[name] ?? CATEGORY_COLOURS[name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;

  return (
    <div className="flex items-center gap-3">
      <div className={compact ? "w-20 h-20" : "w-32 h-32"} style={{ flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices} dataKey="value" nameKey="name"
              innerRadius={compact ? 24 : 38} outerRadius={compact ? 38 : 60}
              paddingAngle={2.5} cornerRadius={3} strokeWidth={0} isAnimationActive={false}
            >
              {slices.map(s => <Cell key={s.name} fill={colour(s.name)} />)}
            </Pie>
            {!compact && <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtGBP(Number(v ?? 0))} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {slices.slice(0, compact ? 3 : 5).map(s => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colour(s.name) }} />
            <span className="text-xs text-slate-600 dark:text-slate-300 truncate flex-1">{s.name}</span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              {Math.round((s.value / total) * 100)}%
            </span>
          </div>
        ))}
        {slices.length > (compact ? 3 : 5) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-4">
            +{slices.length - (compact ? 3 : 5)} more
          </p>
        )}
      </div>
    </div>
  );
}

function DailyBarsWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const days = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const t of spendDebits(data.periodTxns)) {
      const key = t.date.slice(0, 10);
      byDay[key] = (byDay[key] ?? 0) + Math.abs(t.amount);
    }
    const out: { label: string; spend: number; displaySpend: number }[] = [];
    const d = new Date(data.periodStart);
    const today = new Date();
    while (d <= data.periodEnd && d <= today) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const spend = byDay[key] ?? 0;
      // Log scale so one rent-sized day doesn't flatten every other bar;
      // floor keeps zero-spend days from breaking the log axis (same
      // treatment as the Budget page's daily summary)
      out.push({
        label: `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`,
        spend,
        displaySpend: Math.max(spend, DAILY_LOG_FLOOR),
      });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [data.periodTxns, data.periodStart, data.periodEnd]);

  if (!days.some(d => d.spend > 0)) return <EmptyWidget compact={compact} />;
  const ticks = [days[0]?.label, days[Math.floor(days.length / 2)]?.label, days[days.length - 1]?.label].filter(Boolean) as string[];

  return (
    <div className={compact ? "h-20" : "h-36"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {!compact && (
            <XAxis dataKey="label" ticks={ticks} tickLine={false} axisLine={false}
              tick={{ fontSize: 9, fill: tickFill }} interval="preserveStartEnd" />
          )}
          <YAxis hide scale="log" domain={[DAILY_LOG_FLOOR, "auto"]} allowDataOverflow />
          <Tooltip
            trigger="click"
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, _n, item) =>
              fmtGBP(Number((item as { payload?: { spend?: number } })?.payload?.spend ?? v ?? 0))
            }
            cursor={{ fill: "rgba(100,116,139,0.08)" }}
          />
          <Bar dataKey="displaySpend" radius={[2, 2, 0, 0]} maxBarSize={12} isAnimationActive={false}>
            {days.map((d, i) => (
              <Cell key={i} fill="#6366f1" fillOpacity={d.spend <= 0 ? 0.15 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PeriodCompareWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const periods = useMemo(() => {
    // Walk back five periods from the one being viewed
    const out: { label: string; spend: number; current: boolean }[] = [];
    let start = data.periodStart;
    let end = data.periodEnd;
    for (let i = 0; i < 6; i++) {
      const txns = spendDebits(filterPeriod(data.allTxns, start, end));
      out.unshift({
        label: `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`,
        spend: txns.reduce((s, t) => s + Math.abs(t.amount), 0),
        current: i === 0,
      });
      [start, end] = prevPeriodWithConfig(start, data.payPeriodConfig);
    }
    // Drop leading periods with no data (before the user's history begins)
    while (out.length > 1 && out[0].spend === 0) out.shift();
    return out;
  }, [data.allTxns, data.periodStart, data.periodEnd, data.payPeriodConfig]);

  if (periods.every(p => p.spend === 0)) return <EmptyWidget compact={compact} />;

  return (
    <div className={compact ? "h-20" : "h-36"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={periods} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {!compact && (
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: tickFill }} />
          )}
          {!compact && (
            <YAxis width={34} tickLine={false} axisLine={false}
              tick={{ fontSize: 9, fill: tickFill }} tickFormatter={(v: number) => fmtGBP(v)} />
          )}
          <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE} formatter={(v) => fmtGBP(Number(v ?? 0))} cursor={{ fill: "rgba(100,116,139,0.08)" }} />
          <Bar dataKey="spend" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {periods.map((p, i) => (
              <Cell key={i} fill={p.current ? "#6366f1" : "#c7d2fe"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SIZE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "<£5", min: 0, max: 5 },
  { label: "£5–10", min: 5, max: 10 },
  { label: "£10–25", min: 10, max: 25 },
  { label: "£25–50", min: 25, max: 50 },
  { label: "£50–100", min: 50, max: 100 },
  { label: "£100–250", min: 100, max: 250 },
  { label: "£250+", min: 250, max: Infinity },
];

function SizeDistributionWidget({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const bands = useMemo(() => {
    const counts = SIZE_BANDS.map(b => ({ label: b.label, count: 0 }));
    for (const t of spendDebits(data.periodTxns)) {
      const amt = Math.abs(t.amount);
      const idx = SIZE_BANDS.findIndex(b => amt >= b.min && amt < b.max);
      if (idx >= 0) counts[idx].count += 1;
    }
    return counts;
  }, [data.periodTxns]);

  if (bands.every(b => b.count === 0)) return <EmptyWidget compact={compact} />;

  return (
    <div className={compact ? "h-20" : "h-36"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bands} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {!compact && (
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 8.5, fill: tickFill }} interval={0} />
          )}
          {!compact && (
            <YAxis width={24} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 9, fill: tickFill }} />
          )}
          <Tooltip trigger="click" contentStyle={TOOLTIP_STYLE}
            formatter={(v) => [`${Number(v ?? 0)} transaction${Number(v ?? 0) !== 1 ? "s" : ""}`, ""]}
            cursor={{ fill: "rgba(100,116,139,0.08)" }} />
          <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyWidget({ compact }: { compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${compact ? "h-20" : "h-24"}`}>
      <p className="text-xs text-slate-500 dark:text-slate-400">No spending in this period</p>
    </div>
  );
}

function renderWidget(id: WidgetId, data: WidgetData, compact?: boolean) {
  switch (id) {
    case "category_pie":      return <CategoryPieWidget data={data} compact={compact} />;
    case "daily_bars":        return <DailyBarsWidget data={data} compact={compact} />;
    case "period_compare":    return <PeriodCompareWidget data={data} compact={compact} />;
    case "size_distribution": return <SizeDistributionWidget data={data} compact={compact} />;
  }
}

/* ── Widget card chrome ───────────────────────────────────────────── */

function WidgetCard({
  id, data, pinned, otherPinned, onPin, onRemove,
}: {
  id: WidgetId;
  data: WidgetData;
  pinned: boolean;
  otherPinned: boolean; // one Home slot — pinning here evicts the current pin
  onPin: () => void;
  onRemove: () => void;
}) {
  // Hold (300ms) anywhere on the card to lift and drag it into a new spot;
  // quick touches still scroll/tap as normal
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = WIDGET_META[id];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [menuOpen]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "manipulation",
        zIndex: isDragging ? 30 : undefined,
        position: "relative",
      }}
      className={`bg-white dark:bg-slate-800 rounded-2xl p-4 ${
        isDragging ? "shadow-xl ring-2 ring-indigo-300 dark:ring-indigo-500/50 scale-[1.02]" : "shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{meta.title}</p>
          {pinned && <Pin size={11} className="text-indigo-400 flex-shrink-0" />}
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="w-10 h-10 -mr-1 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:bg-slate-100 dark:active:bg-slate-700"
          >
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-52 bg-white dark:bg-slate-700 rounded-xl shadow-lg border border-slate-100 dark:border-slate-600 py-1 overflow-hidden">
              <MenuItem
                icon={pinned ? <PinOff size={13} /> : <Pin size={13} />}
                label={pinned ? "Unpin from Home" : otherPinned ? "Pin to Home (replaces pin)" : "Pin to Home"}
                onClick={() => { setMenuOpen(false); onPin(); }}
              />
              <MenuItem icon={<Trash2 size={13} />} label="Remove" destructive
                onClick={() => { setMenuOpen(false); onRemove(); }} />
            </div>
          )}
        </div>
      </div>
      {renderWidget(id, data)}
    </div>
  );
}

function MenuItem({ icon, label, onClick, destructive }: {
  icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-left active:bg-slate-50 dark:active:bg-slate-600 ${
        destructive ? "text-red-500 dark:text-red-400" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── The Trends tab ───────────────────────────────────────────────── */

export default function SpendTrends(props: {
  periodTxns: Transaction[];
  allTxns: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
}) {
  const { spendWidgets: ctxWidgets, homePinnedWidget: ctxPinned, setSpendWidgets: setCtxWidgets, setHomePinnedWidget: setCtxPinned } = usePreferences();
  // prefsLoaded is true once the context has received the server response (non-null array).
  const prefsLoaded = ctxWidgets !== null;
  const [widgets, setWidgets] = useState<WidgetId[]>(DEFAULT_WIDGETS);
  const [pinnedWidget, setPinnedWidget] = useState<WidgetId | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Sync local state from context whenever context loads/changes.
  useEffect(() => {
    if (ctxWidgets !== null) setWidgets(ctxWidgets.filter(isWidgetId));
  }, [ctxWidgets]);

  useEffect(() => {
    setPinnedWidget(isWidgetId(ctxPinned) ? ctxPinned : null);
  }, [ctxPinned]);

  function saveWidgets(next: WidgetId[]) {
    setWidgets(next);
    setCtxWidgets(next);
    api.updatePreferences({ spend_widgets: next }).catch(() => {});
  }

  function savePinned(next: WidgetId | null) {
    setPinnedWidget(next);
    setCtxPinned(next);
    api.updatePreferences({ home_pinned_widget: next }).catch(() => {});
  }

  function removeWidget(id: WidgetId) {
    saveWidgets(widgets.filter(w => w !== id));
    if (pinnedWidget === id) savePinned(null);
  }

  // TouchSensor (not PointerSensor): pointer events are passive, so the browser
  // hijacks the gesture for scrolling and the lifted card never moves. The touch
  // sensor prevents the scroll takeover once the hold delay has activated.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = widgets.indexOf(active.id as WidgetId);
    const to = widgets.indexOf(over.id as WidgetId);
    if (from < 0 || to < 0) return;
    saveWidgets(arrayMove(widgets, from, to));
  }

  const data: WidgetData = {
    periodTxns: props.periodTxns,
    allTxns: props.allTxns,
    periodStart: props.periodStart,
    periodEnd: props.periodEnd,
    payPeriodConfig: props.payPeriodConfig,
    colours: props.colours,
  };

  const available = ALL_WIDGETS.filter(w => !widgets.includes(w));

  return (
    <div className="px-4 pt-4 space-y-3">
      {prefsLoaded && widgets.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No charts yet — add one below to start visualising your spending.
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgets} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {widgets.map(id => (
              <WidgetCard
                key={id}
                id={id}
                data={data}
                pinned={pinnedWidget === id}
                otherPinned={pinnedWidget !== null && pinnedWidget !== id}
                onPin={() => savePinned(pinnedWidget === id ? null : id)}
                onRemove={() => removeWidget(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {available.length > 0 && (
        <button
          onClick={() => setGalleryOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold active:scale-[0.98] transition-transform"
        >
          <Plus size={14} /> Add widget
        </button>
      )}

      {galleryOpen && (
        <AddWidgetGallery
          available={available}
          onAdd={id => { saveWidgets([...widgets, id]); setGalleryOpen(false); }}
          onClose={() => setGalleryOpen(false)}
        />
      )}
    </div>
  );
}

function AddWidgetGallery({ available, onAdd, onClose }: {
  available: WidgetId[];
  onAdd: (id: WidgetId) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a widget"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] lg:max-w-md lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 bg-white dark:bg-slate-800 rounded-t-3xl lg:rounded-3xl z-[70] max-h-[88vh] overflow-y-auto p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-5"
      >
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Add a widget</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Charts use the pay period you're viewing.
        </p>
        <div className="space-y-2">
          {available.map(id => {
            const { title, description, Icon } = WIDGET_META[id];
            return (
              <button
                key={id}
                onClick={() => onAdd(id)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 active:scale-[0.98] transition-transform text-left"
                  >
                    <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                      <Icon size={16} className="text-indigo-500 dark:text-indigo-400" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{description}</span>
                    </span>
                    <Plus size={15} className="text-slate-300 dark:text-slate-500 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Compact pinned card for the home page ────────────────────────── */

export function PinnedWidgetCard({
  id, transactions, periodStart, periodEnd, payPeriodConfig, colours, onOpen,
}: {
  id: string;
  transactions: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  payPeriodConfig: PayPeriodConfig;
  colours: Record<string, string>;
  onOpen: () => void;
}) {
  const periodTxns = useMemo(
    () => filterPeriod(transactions, periodStart, periodEnd),
    [transactions, periodStart, periodEnd],
  );
  if (!isWidgetId(id)) return null;

  const data: WidgetData = {
    periodTxns, allTxns: transactions, periodStart, periodEnd, payPeriodConfig, colours,
  };

  return (
    <div className="mx-4 mb-5 lg:mx-0">
      <button
        onClick={onOpen}
        className="w-full bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {WIDGET_META[id].title}
          </p>
          <span className="flex items-center gap-0.5 text-[11px] font-semibold text-indigo-500 dark:text-indigo-400">
            Trends <ChevronRight size={12} />
          </span>
        </div>
        {renderWidget(id, data, true)}
      </button>
    </div>
  );
}
