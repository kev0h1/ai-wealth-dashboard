import type { PayPeriodConfig } from "./payPeriod";
import type { SubscriptionInfo, IdentitiesResponse } from "./api";

export function settingsIdentityState(identities: IdentitiesResponse | null) {
  const relayPrimary = identities?.primary_email.toLowerCase().endsWith("@privaterelay.appleid.com") ?? false;
  return {
    googlePrimary: identities !== null && !relayPrimary,
    applePrimary: relayPrimary && identities?.linked.some(link => link.provider === "apple" && link.auto) === true,
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function ordinal(day: number): string {
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : (suffixes[day % 10] ?? "th");
  return `${day}${suffix}`;
}
export function settingsPayPeriodLabel(config: PayPeriodConfig): string {
  switch (config.type) {
    case "calendar_month": return "Calendar month";
    case "last_friday": return "Last Friday";
    case "last_weekday_of_month": return `Last ${WEEKDAYS[config.weekday] ?? "weekday"}`;
    case "monthly_pay_date": return `Monthly · ${ordinal(config.day)}`;
    case "weekly": return `Weekly · ${WEEKDAYS[config.weekday] ?? "payday"}`;
    case "biweekly": return `Every two weeks · ${WEEKDAYS[config.weekday] ?? "payday"}`;
    case "custom": return "Custom dates";
  }
}
export function settingsPlanLabel(info: SubscriptionInfo | null, attempted: boolean): string {
  if (!info) return attempted ? "Could not load plan" : "Checking…";
  const tier = info.tier.charAt(0).toUpperCase() + info.tier.slice(1);
  const used = info.usage?.penny_messages;
  const limit = info.usage?.penny_limit;
  // The server's limit already includes top-ups. Never count them twice.
  const remaining = info.usage?.penny_remaining ?? (typeof limit === "number" && typeof used === "number" ? Math.max(0, limit - used) : null);
  return remaining === null ? `${tier} plan` : `${tier} · ${remaining.toLocaleString("en-GB")} messages left`;
}
