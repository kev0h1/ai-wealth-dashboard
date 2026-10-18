import type { ActiveAim, CompletedAim, MirrorTrait } from "./api";

const currency = /([−+\-]?£)\s*([\d,]+(?:\.\d+)?)/g;

/** Preserve meaningful pence and a real minus, including in portrait prose. */
export function mirrorMoney(value: number, masked = false): string {
  if (masked) return "£••••";
  if (!Number.isFinite(value)) return "Not available";
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function mirrorText(text: string, masked: boolean): string {
  return text.replace(currency, (_match, prefix: string, digits: string) => {
    if (masked) return "£••••";
    const amount = Number(digits.replaceAll(",", ""));
    const negative = prefix.startsWith("−") || prefix.startsWith("-");
    return `${prefix.startsWith("+") ? "+" : ""}${mirrorMoney(negative ? -amount : amount)}`;
  });
}

export function mirrorDate(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "Date unavailable";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function periodLabel(start?: string, end?: string): string {
  if (!start || !end) return "This pay period";
  return `${mirrorDate(start)} to ${mirrorDate(end)}`;
}

export function mirrorCategory(trait: MirrorTrait): string | null {
  return trait.ref_category || trait.title.match(/^Your Signature:\s*(.+)$/i)?.[1].trim() || null;
}

export function completedFor(category: string | null, history: CompletedAim[]): CompletedAim | null {
  if (!category) return null;
  return history.filter(aim => aim.ref === category && Number.isFinite(aim.aim_amount) && Number.isFinite(aim.result_amount))
    .sort((a, b) => b.period_end.localeCompare(a.period_end) || b.resolved_at.localeCompare(a.resolved_at))[0] ?? null;
}

/** One consented loop leads; other patterns remain reachable, not a goals list. */
export function leadingTrait(traits: MirrorTrait[], aims: ActiveAim[], history: CompletedAim[]): MirrorTrait | null {
  return traits.find(t => t.choice === "change" && (aims.some(a => a.ref === mirrorCategory(t)) || completedFor(mirrorCategory(t), history)))
    ?? traits.find(t => t.choice === "change")
    ?? traits.find(t => t.choice === null && mirrorCategory(t))
    ?? traits.find(t => t.choice !== "keep")
    ?? traits[0] ?? null;
}
