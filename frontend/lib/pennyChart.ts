// G252: typed chart specs in Penny's replies. Pure functions, no React.
//
// The spec is built and validated on the server (backend/app/services/
// penny_chart.py): 1..4 series, at most 36 points per series (8 slices for a
// donut, the rest already grouped into "Other"), typed values, no HTML, and a
// summary sentence the server wrote from the data. The client still treats it
// as untrusted: a malformed spec renders nothing, and every string is drawn as
// React text, never as markup.
import { getCategoryColour, CATEGORY_COLOURS } from "./categories";
import { currencySymbol } from "./currency";
import { formatTableDate, formatTableMoney, normalisePennyTable, type PennyTableBlock, type PennyTableCell, type PennyTableColumn } from "./pennyTable";

export type PennyChartType = "bar" | "line" | "stacked_bar" | "donut";
export type PennyChartXKind = "date" | "category" | "text";
export type PennyChartUnit = "money" | "number" | "rate";
export type PennyChartMoney = { amount: number; currency: string };
export type PennyChartPoint = { x: string; y: number };
export type PennyChartSeries = { name: string; points: PennyChartPoint[] };
export type PennyChartSpec = {
  type: PennyChartType;
  title: string;
  x: { label: string; kind: PennyChartXKind };
  y: { label: string; unit: PennyChartUnit; currency?: string };
  series: PennyChartSeries[];
  note?: string;
  summary: string;
};

export const CHART_MAX_SERIES = 4;
export const CHART_MAX_POINTS = 36;
export const CHART_MAX_SLICES = 8;
const TYPES = new Set(["bar", "line", "stacked_bar", "donut"]);
const X_KINDS = new Set(["date", "category", "text"]);
const UNITS = new Set(["money", "number", "rate"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null;
}

/** Defensive shape check on a spec from the wire or from storage. Returns a
 * clean copy (y values flattened to numbers) or null. */
export function normalisePennyChart(raw: unknown): PennyChartSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !TYPES.has(r.type)) return null;
  const type = r.type as PennyChartType;
  const title = str(r.title, 80);
  const summary = str(r.summary, 600);
  if (!title || !summary) return null;
  const xr = r.x as Record<string, unknown> | undefined;
  const yr = r.y as Record<string, unknown> | undefined;
  if (!xr || !yr) return null;
  const xLabel = str(xr.label, 40);
  const yLabel = str(yr.label, 40);
  if (!xLabel || typeof xr.kind !== "string" || !X_KINDS.has(xr.kind)) return null;
  if (!yLabel || typeof yr.unit !== "string" || !UNITS.has(yr.unit)) return null;
  const unit = yr.unit as PennyChartUnit;
  const currency = typeof yr.currency === "string" ? yr.currency : undefined;
  if (unit === "money" && !currency) return null;
  if (!Array.isArray(r.series) || r.series.length < 1 || r.series.length > CHART_MAX_SERIES) return null;
  if (type === "donut" && r.series.length !== 1) return null;
  const limit = type === "donut" ? CHART_MAX_SLICES : CHART_MAX_POINTS;
  const series: PennyChartSeries[] = [];
  for (const s of r.series as unknown[]) {
    const sr = s as Record<string, unknown>;
    const name = str(sr?.name, 40);
    if (!name || !Array.isArray(sr.points) || sr.points.length < 1 || sr.points.length > limit) return null;
    const points: PennyChartPoint[] = [];
    for (const p of sr.points as unknown[]) {
      const pr = p as Record<string, unknown>;
      const x = typeof pr?.x === "string" ? pr.x : null;
      const yv = unit === "money"
        ? ((pr?.y as PennyChartMoney | undefined)?.amount)
        : pr?.y;
      if (x === null || typeof yv !== "number" || !Number.isFinite(yv)) return null;
      if (xr.kind === "date" && !ISO_DATE.test(x)) return null;
      if ((type === "donut" || type === "stacked_bar") && yv < 0) return null;
      points.push({ x, y: yv });
    }
    series.push({ name, points });
  }
  const spec: PennyChartSpec = {
    type, title, summary, series,
    x: { label: xLabel, kind: xr.kind as PennyChartXKind },
    y: { label: yLabel, unit, ...(unit === "money" ? { currency } : {}) },
  };
  if (typeof r.note === "string" && r.note.trim()) spec.note = r.note;
  return spec;
}

/** Axis and tooltip text for a value on this chart's y axis. */
export function formatChartValue(spec: PennyChartSpec, v: number, compact = false): string {
  if (spec.y.unit === "money") {
    if (!compact) return formatTableMoney({ amount: v, currency: spec.y.currency ?? "GBP" });
    const body = `${currencySymbol(spec.y.currency)}${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
    return v < 0 ? `−${body}` : body;
  }
  if (spec.y.unit === "rate") return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** Label for an x value: dates use the app's short day. */
export function formatChartX(spec: PennyChartSpec, x: string, now?: Date): string {
  return spec.x.kind === "date" ? formatTableDate(x, now) : x;
}

// ── colour: information, from the app's own category palette ───────────────
// Series or slices named after a category wear that category's colour (the
// user's overrides win). Anything else (a total, a net) wears a fixed-order
// neutral-friendly set: Adviser Indigo first, then teal, slate and sky. Red,
// amber and the Penny gradient are never used for a non-category series.
const FALLBACK_LIGHT = ["#4f46e5", "#0d9488", "#64748b", "#0284c7"];
const FALLBACK_DARK = ["#818cf8", "#2dd4bf", "#94a3b8", "#38bdf8"];

export function isKnownCategory(name: string, overrides?: Record<string, string>): boolean {
  return name in CATEGORY_COLOURS || (!!overrides && name in overrides);
}

export function chartColour(
  spec: PennyChartSpec, name: string, index: number, dark: boolean, overrides?: Record<string, string>,
): string {
  if (isKnownCategory(name, overrides)) return getCategoryColour(name, overrides);
  if (spec.type === "donut") return getCategoryColour(name, overrides); // slices are categories: a stable hue per name
  return (dark ? FALLBACK_DARK : FALLBACK_LIGHT)[index % FALLBACK_LIGHT.length];
}

// ── data for recharts and for the table fallback ───────────────────────────
export type ChartRow = { x: string; label: string; [key: string]: string | number | null };

/** One row per x (first-seen order, dates ascending), one `s<i>` key per series. */
export function chartRows(spec: PennyChartSpec, now?: Date): ChartRow[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of spec.series) for (const p of s.points) if (!seen.has(p.x)) { seen.add(p.x); order.push(p.x); }
  if (spec.x.kind === "date") order.sort();
  return order.map((x) => {
    const row: ChartRow = { x, label: formatChartX(spec, x, now) };
    spec.series.forEach((s, i) => { row[`s${i}`] = s.points.find((p) => p.x === x)?.y ?? null; });
    return row;
  });
}

/** The accessible data table fallback, as a G251 table block. */
export function chartToTable(spec: PennyChartSpec): PennyTableBlock | null {
  const rows = chartRows(spec);
  const valueKind: PennyTableColumn["kind"] = spec.y.unit;
  const cell = (v: number | null): PennyTableCell =>
    v === null ? null : spec.y.unit === "money" ? { amount: v, currency: spec.y.currency ?? "GBP" } : v;
  const columns: PennyTableColumn[] = [
    { key: "x", label: spec.x.label, kind: spec.x.kind === "date" ? "date" : "text", align: "left" },
    ...spec.series.map((s, i) => ({ key: `s${i}`, label: spec.series.length === 1 && spec.type !== "donut" ? spec.y.label : s.name, kind: valueKind, align: "right" as const })),
  ];
  return normalisePennyTable({
    title: spec.title,
    columns,
    rows: rows.map((r) => ({ x: r.x, ...Object.fromEntries(spec.series.map((_, i) => [`s${i}`, cell(r[`s${i}`] as number | null)])) })),
    note: spec.note,
  });
}
