// G222 ad fixtures. A fully fictional persona: nothing here comes from a real
// user, bank or account. Typed against lib/api's SafeToSpend so the production
// SafeToSpendCard renders it through its real props.
//
// The sums reconcile exactly as the card's own ledger does:
// £640 in the account, less £236 of bills, £120 set aside for a plan and a
// £100 buffer, leaves £184 until payday.

import type { SafeToSpend } from "@/lib/api";
import type { SpendFromResult } from "@/lib/spendFromAccount";

export type Variant = "a" | "b" | "c";
export type Format = "feed" | "story";
export type Mode = "light" | "dark";

export const VARIANTS: { id: Variant; label: string }[] = [
  { id: "a", label: "A The question" },
  { id: "b", label: "B The number" },
  { id: "c", label: "C The relief" },
];

// Exact artboard pixel sizes. feed = Facebook and Instagram 4:5, story =
// TikTok, Reels and Stories 9:16.
export const SIZES: Record<Format, { w: number; h: number }> = {
  feed: { w: 1080, h: 1350 },
  story: { w: 1080, h: 1920 },
};

// TikTok and Reels UI sits over these margins in the 1080x1920 frame.
export const STORY_SAFE = { top: 160, bottom: 420, right: 140, left: 72 };

export const PERSONA = {
  inAccount: 640,
  bills: 236,
  planSetAside: 120,
  buffer: 100,
  safe: 184,
  daysToPayday: 9,
} as const;

export const AD_DATA: Extract<SafeToSpend, { status: "ok" }> = {
  status: "ok",
  safe_to_spend: PERSONA.safe,
  safe_to_spend_cash: PERSONA.safe,
  card_growth_reserved: 0,
  next_payday: "2026-10-15T00:00:00",
  days_until_payday: PERSONA.daysToPayday,
  bills_total: PERSONA.bills,
  income_before_payday: 0,
  buffer: PERSONA.buffer,
  state: "comfortable",
  short_reason: null,
  estimated: true,
  spendable_now: PERSONA.inAccount,
  lowest_projected_balance: PERSONA.inAccount - PERSONA.bills,
  commitments_reserved: PERSONA.planSetAside,
  commitments_count: 1,
  allocations_reserved: 0,
  last_synced: null,
  calculation_status: "complete",
};

// The bank rail is left out of the ad: the unavailable "loading" result makes
// the production card render no spend-from block at all, so no bank, real or
// invented, is implied. The figure and its ledger stay exactly as shipped.
export const AD_SPEND_FROM: SpendFromResult = { kind: "unavailable", reason: "loading" };

export const DISCLAIMER = "Example figures. Safe to Spend is an estimate.";
