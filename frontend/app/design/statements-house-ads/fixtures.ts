// B58 design round (skill: impeccable). Synthetic fixtures only: no requests,
// no real user data. The eligibility function below is the rule set the
// fold-in item will move server-side; the previews call it so a toggle proves
// the card disappears, rather than a variant simply not drawing it.
//
// The trial is the existing card-first one (B45): 14 days, card details up
// front, renews unless cancelled. The trial-available disclosure is built
// from lib/billingCopy.ts trialDisclosureLine (the B22 wording) so it cannot
// drift. The trial-used line has no billingCopy helper: only money() is
// shared. TODO fold-in: add a billingCopy helper for it and use the server
// price and charge timing.

import { money, trialDisclosureLine } from "@/lib/billingCopy";

export type Placement = "home" | "upload" | "limit";
export type HouseAdAccount =
  | "statements-trial-available"
  | "statements-trial-used"
  | "trial-active"
  | "lite"
  | "standard"
  | "plus";
/** trialAvailable true: the user has never used the 14-day trial. */
export type TrialState = "available" | "used";

export const ACCOUNTS: { id: HouseAdAccount; label: string; note: string }[] = [
  { id: "statements-trial-available", label: "Statements, trial available", note: "Free Statements plan, the 14-day trial has never been used (trialAvailable true). The card invites them to try Lite and says card details are needed." },
  { id: "statements-trial-used", label: "Statements, trial used", note: "Free Statements plan, the one trial per person is spent (trialAvailable false). A plain subscribe prompt." },
  { id: "trial-active", label: "On the 14-day trial", note: "Currently trialling a paid plan. Counts as a trial user, so no card." },
  { id: "lite", label: "Lite", note: "Paying. No card." },
  { id: "standard", label: "Standard", note: "Paying. No card." },
  { id: "plus", label: "Plus", note: "Paying. No card." },
];

// The existing plan picker (Settings, Your plan). Link only: the card never
// starts a trial or a purchase itself.
export const PLAN_PICKER_HREF = "/settings?section=penny-plan";

// How long a dismissed card stays hidden, per placement, per user.
export const SNOOZE_DAYS = 7;

// Fixture price. In production this is the server's Lite price for the
// selected period (info.prices_gbp), never hardcoded.
export const LITE_MONTHLY_GBP = 5.99;

export function trialStateFor(account: HouseAdAccount): TrialState | null {
  if (account === "statements-trial-available") return "available";
  if (account === "statements-trial-used") return "used";
  return null;
}

export type EligibilityInput = {
  account: HouseAdAccount;
  /** Left to spend hero is in a genuine risk state (red). Hides every house ad. */
  riskState: boolean;
  /** ISO time until which this placement is snoozed, or null. */
  snoozedUntil: string | null;
  now: string;
};

export type EligibilityResult = { show: true; trial: TrialState } | { show: false; reason: string };

export function houseAdEligibility(input: EligibilityInput): EligibilityResult {
  const trial = trialStateFor(input.account);
  if (!trial) return { show: false, reason: input.account === "trial-active" ? "On the trial: counts as a trial user." : "Paying plan: house ads never show." };
  if (input.riskState) return { show: false, reason: "Hero is in a risk state: nothing to sell next to a genuine cash problem." };
  if (input.snoozedUntil && input.snoozedUntil > input.now) return { show: false, reason: `Dismissed: hidden for ${SNOOZE_DAYS} days.` };
  return { show: true, trial };
}

export type AdCopy = { title: string; body: string; cta: string; fine: string; compare: { upload: string; live: string } };

// The disclosure sits on the card, next to the action (B22): that a card is
// needed and that it renews unless cancelled. Built from billingCopy phrases.
const FINE_AVAILABLE = `${trialDisclosureLine(14, LITE_MONTHLY_GBP, "when the trial ends", "every month")} Card details needed.`;
const FINE_USED = `${money(LITE_MONTHLY_GBP)} every month, cancel any time.`;

// One headline per placement, two bodies (one per trial state). British
// English, no em dashes, no exclamation marks, no savings or money-saved
// claims. "Left to spend" is the product's own term.
export const COPY: Record<Placement, Record<TrialState, AdCopy>> = {
  home: {
    available: {
      title: "See your real Left to spend",
      body: "Connect your banks and Lite keeps it live. Try Lite free for 14 days.",
      cta: "Try Lite free for 14 days",
      fine: FINE_AVAILABLE,
      compare: { upload: "As of your last statement", live: "Refreshed from your banks" },
    },
    used: {
      title: "See your real Left to spend",
      body: "Subscribe and Lite keeps it live on your connected banks.",
      cta: "See plans",
      fine: FINE_USED,
      compare: { upload: "As of your last statement", live: "Refreshed from your banks" },
    },
  },
  upload: {
    available: {
      title: "Lite keeps this up to date automatically",
      body: "Connect your banks and new payments appear without another upload. Try Lite free for 14 days.",
      cta: "Try Lite free for 14 days",
      fine: FINE_AVAILABLE,
      compare: { upload: "Next update needs a new upload", live: "Updates from your banks" },
    },
    used: {
      title: "Lite keeps this up to date automatically",
      body: "Subscribe to Lite and your banks update this for you, with no more uploads.",
      cta: "See plans",
      fine: FINE_USED,
      compare: { upload: "Next update needs a new upload", live: "Updates from your banks" },
    },
  },
  limit: {
    available: {
      title: "That is your 3 uploads for this month",
      body: "Everything you have imported stays here to look at. Lite connects your banks instead, so there is nothing to upload. Try Lite free for 14 days.",
      cta: "Try Lite free for 14 days",
      fine: FINE_AVAILABLE,
      compare: { upload: "3 uploads a month", live: "Connected, no uploads" },
    },
    used: {
      title: "That is your 3 uploads for this month",
      body: "Everything you have imported stays here to look at, and your uploads reset on 1 November. Subscribe to Lite to connect your banks instead.",
      cta: "See plans",
      fine: FINE_USED,
      compare: { upload: "3 uploads a month", live: "Connected, no uploads" },
    },
  },
};

// What the fold-in item should log server-side (first-party only, no
// third-party analytics, no per-tap user trail beyond a counter row).
export const MEASUREMENT = [
  "impression: one per placement per user per day, written when the card first renders on screen (placement, variant, trial_state).",
  "dismiss: one per dismiss tap (placement, trial_state); also writes the snooze, so a later impression is suppressed for 7 days.",
  "tap: one per tap on the card action (placement, trial_state), logged before navigating to the plan picker.",
  "Counts are aggregated per day, per placement, per trial_state. No device ids, no third-party SDKs, nothing sent off our own API.",
  "Funnel read by the owner: taps / impressions per placement, dismiss rate, and plan changes within 24 hours of a tap (joined server-side on user id, never exported).",
];

export const IMPORTED = [
  { bank: "Barclays Current", detail: "42 payments, to 14 Oct", id: "st-1" },
  { bank: "Monzo Joint", detail: "31 payments, to 9 Oct", id: "st-2" },
  { bank: "Amex Gold", detail: "18 payments, to 11 Oct", id: "st-3" },
];
