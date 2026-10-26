import type { FixtureAccount, Fixture } from "./fixtures";

export function reading(item: FixtureAccount, phase: Fixture["phase"]) {
  const p = item.position;
  if (item.account.include_in_safe_to_spend === false) return { value: null, unavailable: "Not counted", status: null, tone: "neutral" } as const;
  if (phase === "loading") return { value: null, unavailable: "Checking…", status: null, tone: "neutral" } as const;
  if (!p || p.uncertain || typeof p.after_payments_and_plans !== "number" || !Number.isFinite(p.after_payments_and_plans)) return { value: null, unavailable: "Not available", status: null, tone: "neutral" } as const;
  const value = p.after_payments_and_plans;
  if (phase === "stale") return { value, unavailable: null, status: "Last known", tone: "neutral" } as const;
  if ((p.low_point ?? p.after_payments ?? 0) < 0) return { value, unavailable: null, status: value >= 0 ? "Earlier payment gap" : "Payments short", tone: "risk" } as const;
  if (value < 0 || (p.low_point_and_plans ?? value) < 0) return { value, unavailable: null, status: value >= 0 ? "Earlier plans gap" : "Plans gap", tone: "watch" } as const;
  return { value, unavailable: null, status: null, tone: "neutral" } as const;
}

export function money(value: number) {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function day(iso: string) {
  return new Date(`${iso.slice(0,10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
}
