// E14: pure helpers for the People page's Subscription section (labels,
// confirmations, guard copy). Kept apart so scripts/e14-subscription.test.mjs
// can exercise them directly.
import type { OpsSubscription } from "@/lib/api";

export const TIERS = ["statements", "lite", "standard", "plus"] as const;
export const PACKS = ["small", "medium", "large"] as const;

export const SUB_WORDING = {
  section: "Subscription",
  loading: "Loading subscription",
  loadFailed: "Couldn't load this subscription. Try again.",
  setTier: "Set plan",
  grantPack: "Grant Penny pack",
  resetTrial: "Reset trial",
  cancelGrant: "Cancel manual grant",
  reasonLabel: "Reason, kept in the activity list",
  reasonPlaceholder: "Why you are making this change",
  expiryLabel: "Ends on, optional",
  expiryHint: "Leave empty for no end date. After this date they return to the default plan.",
  tierLabel: "Plan",
  packLabel: "Pack",
  typeTier: "Type the plan name to confirm",
  typePack: "Type the pack name to confirm",
  typeReset: "Type RESET to confirm",
  resetWord: "RESET",
  cancel: "Cancel",
  applyFailed: "Couldn't make that change, try again.",
  resetNote: "This clears the trial markers so they can take the introductory trial again. Their plan, status and any Stripe details stay as they are.",
  cancelNote: "This removes the plan you set by hand. They return to the default plan, or to their live store plan if they have one.",
  setNote: "This sets the plan by hand. It changes only Sorted's own record, and takes effect on their next request.",
  packNote: "This adds a Penny message pack at no charge. It is not recorded as a purchase.",
} as const;

export function providerGuard(provider: OpsSubscription["live_provider"]): string | null {
  if (provider === "stripe") return "Live Stripe subscription. Manage it in Stripe, not here.";
  if (provider === "apple") return "Live App Store subscription. Manage it in the store, not here.";
  if (provider === "google") return "Live Google Play subscription. Manage it in the store, not here.";
  return null;
}

export function providerLabel(s: OpsSubscription): string {
  const name = s.provider === "stripe" ? "Stripe" : s.provider === "apple" ? "App Store" : s.provider === "google" ? "Google Play" : "None";
  if (s.provider === "none") return name;
  return `${name}, ${s.provider_live ? "live" : "not live"}`;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "On trial";
    case "past_due":
      return "Payment overdue";
    case "expired":
      return "Ended";
    case "default":
      return "Default plan";
    default:
      return status;
  }
}

export function sourceLabel(source: string | null): string {
  switch (source) {
    case "default":
      return "Default, not subscribed";
    case "free_selected":
      return "Chosen by them";
    case "manual":
      return "Set by Sorted";
    case "stripe":
      return "Stripe";
    case "apple":
      return "App Store";
    case "google":
      return "Google Play";
    default:
      return "Unknown";
  }
}

export function periodLabel(period: string | null): string {
  switch (period) {
    case "monthly":
      return "Monthly";
    case "six_months":
      return "Every 6 months";
    case "three_months":
      return "Every 3 months";
    case "annual":
      return "Yearly";
    default:
      return "None";
  }
}

export function capitalise(v: string): string {
  return v ? v[0].toUpperCase() + v.slice(1) : v;
}

function date(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function trialLabel(s: OpsSubscription): string {
  if (!s.trial_started_at && !s.trial_ends_at) return "No trial on record";
  const start = s.trial_started_at ? `Started ${date(s.trial_started_at)}` : "";
  const end = s.trial_ends_at ? `${s.trial_started_at ? ", " : ""}${new Date(s.trial_ends_at) > new Date() ? "ends" : "ended"} ${date(s.trial_ends_at)}` : "";
  return `${start}${end}`;
}

export function renewalLabel(s: OpsSubscription): string {
  if (s.cancels_at) return `Cancels ${date(s.cancels_at)}`;
  if (s.renews_at) return `Renews ${date(s.renews_at)}`;
  return "None";
}

export function grantLabel(s: OpsSubscription): string {
  const g = s.manual_grant;
  if (!g) return "None";
  const tier = capitalise(g.tier ?? s.tier);
  if (!g.expires_at) return `${tier}, no end date`;
  return g.lapsed ? `${tier}, ended ${date(g.expires_at)}` : `${tier}, until ${date(g.expires_at)}`;
}

export function pennyLabel(s: OpsSubscription): string {
  const p = s.penny;
  const base = p.monthly_allowance === null ? `${p.used} used, no monthly limit` : `${p.used} used of ${p.monthly_allowance} a month`;
  return p.topup_messages > 0 ? `${base}, plus ${p.topup_messages} from packs` : base;
}

export function packLabel(p: OpsSubscription["penny"]["packs"][number]): string {
  const from = p.source === "admin" ? "Granted" : "Bought";
  return `${from}, ${p.remaining} of ${p.messages} left${p.expires_at ? `, expires ${date(p.expires_at)}` : ""}`;
}

export function mcpLabel(s: OpsSubscription): string {
  const a = s.mcp.allowance;
  return a === null ? `${s.mcp.used} used, no limit` : `${s.mcp.used} used of ${a}`;
}

export type SubAction = "set-tier" | "topup" | "reset-trial" | "cancel-grant";

// What must be typed before each action can be sent. cancel-grant is a neutral
// confirm with no typing.
export function expectedConfirm(action: SubAction, ctx: { tier: string; pack: string }): string | null {
  if (action === "set-tier") return ctx.tier;
  if (action === "topup") return ctx.pack;
  if (action === "reset-trial") return SUB_WORDING.resetWord;
  return null;
}

export function confirmOk(action: SubAction, typed: string, ctx: { tier: string; pack: string }): boolean {
  const want = expectedConfirm(action, ctx);
  if (want === null) return true;
  const got = typed.trim();
  return action === "reset-trial" ? got === want : got.toLowerCase() === want.toLowerCase();
}

export function canSubmit(action: SubAction, typed: string, reason: string, ctx: { tier: string; pack: string }): boolean {
  return reason.trim() !== "" && confirmOk(action, typed, ctx);
}
