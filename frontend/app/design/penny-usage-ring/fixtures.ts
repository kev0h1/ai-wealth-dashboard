// TEMPORARY PREVIEW — delete after design review.
//
// Fixture data for the four `?state=` values this preview supports. Fixed
// numbers, not randomised, so every screenshot of a given state is
// reproducible.

export type UsageState = "low" | "high" | "cap" | "unlimited";

export interface UsageData {
  used: number;
  limit: number | null;
  tier: string;
}

export const USAGE_STATES: UsageState[] = ["low", "high", "cap", "unlimited"];

export const USAGE_FIXTURES: Record<UsageState, UsageData> = {
  low: { used: 37, limit: 150, tier: "Standard" },
  high: { used: 128, limit: 150, tier: "Standard" },
  cap: { used: 150, limit: 150, tier: "Standard" },
  unlimited: { used: 214, limit: null, tier: "Unlimited" },
};

export function usageFraction(data: UsageData): number {
  if (data.limit == null || data.limit <= 0) return 0;
  return Math.max(0, Math.min(1, data.used / data.limit));
}

export function usageIsAmber(data: UsageData): boolean {
  return usageFraction(data) >= 0.8;
}
