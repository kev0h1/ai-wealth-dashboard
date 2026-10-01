import type { SpendVerdict } from "@/lib/api";

const currency = new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

export function spendHeroMoney(value: number): string {
  const pennies = Math.round(Math.abs(value) * 100);
  return `${value < 0 && pennies > 0 ? "−" : ""}${currency.format(pennies / 100)}`;
}

/** Presentation of the existing verdict operands, never a second forecast. */
export function spendHeroModel(verdict: SpendVerdict) {
  const latestPace = [...(verdict.pace_series ?? [])].reverse().find((point) => point.usual != null);
  const usual = verdict.state === "early" || verdict.state === "nobaseline"
    ? null : latestPace?.usual ?? null;
  const difference = usual == null ? null : verdict.pills.spent - usual;
  const direction = difference == null ? "unavailable"
    : Math.round(Math.abs(difference) * 100) === 0 ? "level"
      : difference > 0 ? "above" : "below";
  const named = verdict.notables.reduce((sum, item) => sum + item.spent, 0);
  const unresolved = verdict.unresolved.total;

  return {
    usual, difference, direction,
    status: direction === "unavailable" ? "No comparison"
      : direction === "level" ? "In line" : direction === "above" ? "Above usual" : "Below usual",
    totalDays: verdict.period.days_left == null ? null : verdict.period.days_elapsed + verdict.period.days_left,
    named, unresolved,
    other: Math.max(0, verdict.pills.spent - named - unresolved),
    moved: verdict.moved_total ?? verdict.moved.reduce((sum, item) => sum + item.amount, 0),
    hasMoved: verdict.moved.length > 0,
  };
}
