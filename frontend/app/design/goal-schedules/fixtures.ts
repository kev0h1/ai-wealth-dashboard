// Local-only maths for the G351 design preview. These calendar months are a
// fixed October 2026 fixture, never the user's live pay-period configuration.
export type Draft = { kind: "daily" | "weekly" | "custom" | "percent"; start: string; first: string; step: string; count: string; amounts: string; percent: string; pay: string };
export const DEFAULT_DRAFT: Draft = { kind: "daily", start: "2026-01-01", first: "0.04", step: "0.04", count: "365", amounts: "", percent: "", pay: "" };
export const EXAMPLES: { id: string; label: string; draft: Draft }[] = [
  { id: "daily", label: "4p challenge", draft: DEFAULT_DRAFT },
  { id: "weekly", label: "Weekly steps", draft: { ...DEFAULT_DRAFT, kind: "weekly", first: "1", step: "1", count: "52" } },
  { id: "custom", label: "Custom months", draft: { ...DEFAULT_DRAFT, kind: "custom", start: "2026-10-01", amounts: "100, 150, 200" } },
  { id: "percent", label: "10% of pay", draft: { ...DEFAULT_DRAFT, kind: "percent", start: "2026-10-01", percent: "10", pay: "3000", count: "3" } },
];
type Month = { label: string; amount: number; key: string };
export type Preview = { error?: string; name: string; summary: string; total: number; period: number; next: Array<{ label: string; amount: number }>; months: Month[]; end: string; due: number; first: number; last: number; estimated: boolean };
const TODAY = "2026-10-28", MAX = { daily: 3660, weekly: 520, custom: 120, percent: 120 };
const empty = (error?: string): Preview => ({ error, name: "Schedule", summary: "Check the schedule details.", total: 0, period: 0, next: [], months: [], end: "", due: 0, first: 0, last: 0, estimated: false });
const utc = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const d = new Date(`${value}T12:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null; };
const iso = (d: Date) => d.toISOString().slice(0, 10), addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000), addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const pence = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : null;
const countOf = (value: string, cap: number) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= cap ? Number(value) : null;
const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", ...(d.getUTCFullYear() === 2026 ? {} : { year: "numeric" }), timeZone: "UTC" });
export const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateLabel = (value: string) => { const d = utc(value); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""; };

export function buildPreview(draft: Draft): Preview {
  const start = utc(draft.start); if (!start) return empty("Choose a valid start date.");
  const events: Array<{ due: Date; amount: number }> = []; let name = "Schedule", summary = "", estimated = false;
  if (draft.kind === "custom") {
    const amounts = draft.amounts.split(",").map(s => pence(s.trim()));
    if (!amounts.length || amounts.some(a => a === null || a < 1 || a > 100000000) || amounts.length > MAX.custom) return empty("Enter 1 to 120 positive monthly amounts, separated by commas.");
    amounts.forEach((amount, i) => events.push({ due: i ? addMonths(start, i) : start, amount: amount! })); name = "Custom months"; summary = "A different amount each pay period.";
  } else if (draft.kind === "percent") {
    const count = countOf(draft.count, MAX.percent), pct = /^\d+(?:\.\d{1,2})?$/.test(draft.percent.trim()) ? Number(draft.percent) : NaN, pay = pence(draft.pay);
    if (!count || !Number.isFinite(pct) || pct <= 0 || pct > 100 || !pay || pay < 1 || pay > 100000000) return empty("Enter a percentage, expected pay and 1 to 120 pay periods.");
    const raw = pay * pct / 100, floor = Math.floor(raw);
    const amount = raw - floor === 0.5 ? floor + floor % 2 : Math.round(raw); for (let i = 0; i < count; i++) events.push({ due: i ? addMonths(start, i) : start, amount }); name = `${pct}% of pay`; summary = `Set aside ${pct}% of expected pay each pay period.`; estimated = true;
  } else {
    const first = pence(draft.first), step = draft.step.trim() === "0" ? 0 : pence(draft.step), count = countOf(draft.count, MAX[draft.kind]);
    if (!first || first < 1 || step === null || step < 0 || !count) return empty(`Enter positive amounts and 1 to ${MAX[draft.kind]} ${draft.kind === "daily" ? "days" : "weeks"}.`);
    const stride = draft.kind === "daily" ? 1 : 7; for (let i = 0; i < count; i++) events.push({ due: addDays(start, i * stride), amount: first + i * step });
    const unit = draft.kind === "daily" ? "day" : "week";
    const defaultDaily = draft.kind === "daily" && draft.start === DEFAULT_DRAFT.start && draft.first === DEFAULT_DRAFT.first && draft.step === DEFAULT_DRAFT.step && draft.count === DEFAULT_DRAFT.count;
    name = defaultDaily ? "4p challenge" : draft.kind === "daily" ? "Daily steps" : "Weekly steps";
    summary = `Start at ${first < 100 ? `${first}p` : money(first / 100)}, then add ${step < 100 ? `${step}p` : money(step / 100)} each ${unit} for ${count} ${unit}${count === 1 ? "" : "s"}.`;
  }
  const totalPence = events.reduce((sum, e) => sum + e.amount, 0); if (events.some(e => e.amount > 100000000) || totalPence > 100000000) return empty("The schedule total must be £1,000,000 or less.");
  const month = (year: number, index: number): Month => { const begin = new Date(Date.UTC(year, index, 1)), end = new Date(Date.UTC(year, index + 1, 1)); return { label: monthLabel(begin), key: iso(begin).slice(0, 7), amount: events.filter(e => e.due >= begin && e.due < end).reduce((sum, e) => sum + e.amount, 0) / 100 }; };
  const first = events[0], last = events.at(-1)!; const months: Month[] = [];
  for (let cursor = new Date(Date.UTC(first.due.getUTCFullYear(), first.due.getUTCMonth(), 1)); cursor <= last.due; cursor = addMonths(cursor, 1)) months.push(month(cursor.getUTCFullYear(), cursor.getUTCMonth()));
  const october = months.find(m => m.key === "2026-10")?.amount ?? 0, duePence = events.filter(e => iso(e.due) <= TODAY).reduce((sum, e) => sum + e.amount, 0);
  return { name, summary, total: totalPence / 100, period: october, next: months.filter(m => m.key > "2026-10").slice(0, 2).map(({ label, amount }) => ({ label, amount })), months, end: iso(draft.kind === "daily" ? last.due : new Date(Date.UTC(last.due.getUTCFullYear(), last.due.getUTCMonth() + 1, 0))), due: duePence / 100, first: first.amount / 100, last: last.amount / 100, estimated };
}
