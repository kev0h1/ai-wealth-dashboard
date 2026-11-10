// E12: pure helpers for the People page (filters, search, wording). Kept apart
// from the page so scripts/e12-people.test.mjs can exercise them directly.
import type { OpsPerson } from "@/lib/api";

export type PeopleFilter = "active" | "revoked" | "no_access" | "signed_up" | "never_signed_up";

export const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "revoked", label: "Revoked" },
  { key: "no_access", label: "No access" },
  { key: "signed_up", label: "Signed up" },
  { key: "never_signed_up", label: "Never signed up" },
];

export const WORDING = {
  title: "People",
  intro: "Everyone who can use Sorted, and who has actually signed up.",
  forbidden: "This page is for the account owner.",
  loadFailed: "Couldn't load people. Try refreshing.",
  invitePlaceholder: "name@example.com",
  inviteButton: "Invite",
  searchPlaceholder: "Search by email",
  notRecorded: "Not recorded",
  empty: "No one matches.",
  auditTitle: "Activity",
  auditEmpty: "Nothing yet.",
  revokeTitle: "Revoke access?",
  revokeConfirm: "Revoke access",
  removeTitle: "Remove this user?",
  removeConfirm: "Remove user",
  removeTypeLabel: "Type their email address to confirm",
  loadMore: "Show more",
  openSignupHint: "Open sign-up is on, so people with no access can still sign in.",
  allowButton: "Allow",
  restoreButton: "Restore",
  backfillButton: "Allow all",
  backfillTitle: "Allow all of these accounts?",
  backfillTypeLabel: "Type ALLOW to confirm",
  backfillConfirm: "Allow all",
  backfillWord: "ALLOW",
  backfillFailed: "Couldn't allow these accounts, try again.",
} as const;

export type AccessAction = "allow" | "revoke" | "restore" | null;

// The chip shown for a row: what sign-in would do with this person.
export function accessLabel(p: OpsPerson): string {
  switch (p.access) {
    case "owner":
      return "Owner";
    case "allowed":
      return "Allowed";
    case "revoked":
      return "Revoked";
    default:
      return "No access";
  }
}

// The single action that matches the state. Revoke only ever appears on an
// allowed row, so it is never offered to someone sign-in already refuses.
export function accessAction(p: OpsPerson): AccessAction {
  switch (p.access) {
    case "allowed":
      return "revoke";
    case "no_access":
      return "allow";
    case "revoked":
      return "restore";
    default:
      return null;
  }
}

export function backfillBanner(count: number): string {
  return count === 1
    ? "1 signed-up account has no access row. Sign-in refuses it until you allow it."
    : `${count} signed-up accounts have no access row. Sign-in refuses them until you allow them.`;
}

export function backfillMessage(count: number): string {
  return `This gives ${count} signed-up ${count === 1 ? "account" : "accounts"} an allowed row so they can keep signing in. You can revoke any of them from this page afterwards.`;
}

export function backfillConfirmed(typed: string): boolean {
  return typed.trim() === WORDING.backfillWord;
}

export const ACTION_LABELS: Record<string, string> = {
  invite: "Invited",
  allow: "Allowed",
  backfill: "Allowed signed-up accounts",
  revoke: "Revoked access",
  restore: "Restored access",
  erase: "Removed user",
  set_tier: "Set plan",
  grant_topup: "Granted Penny pack",
  reset_trial: "Reset trial",
  cancel_grant: "Cancelled manual grant",
};

export function revokeMessage(email: string): string {
  return `${email} will be signed out at their next request. Their bank connections and data stay in place, and you can restore access later.`;
}

export function removeMessage(email: string): string {
  return `This permanently deletes ${email}'s account and every record Sorted holds for them, and revokes their bank connections. It cannot be undone.`;
}

// A remove is only allowed once the typed text equals the person's email.
export function emailMatches(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase() && email.trim() !== "";
}

export function statusLabel(p: OpsPerson): string {
  return accessLabel(p);
}

export function sourceLabel(p: OpsPerson): string {
  switch (p.source) {
    case "owner":
      return "Owner";
    case "invite":
      return "Invite";
    case "migrated":
      return "Migrated list";
    case "backfill":
      return "Backfilled";
    default:
      return "Open sign-up";
  }
}

// "Active" means can sign in now: the owner or an allowed person.
export function isActive(p: OpsPerson): boolean {
  return p.access === "owner" || p.access === "allowed";
}

export function matchesFilter(p: OpsPerson, filter: PeopleFilter | null): boolean {
  if (filter === null) return true;
  switch (filter) {
    case "active":
      return isActive(p);
    case "revoked":
      return p.access === "revoked";
    case "no_access":
      return p.access === "no_access";
    case "signed_up":
      return p.signed_up;
    case "never_signed_up":
      return !p.signed_up;
  }
}

export function filterPeople(people: OpsPerson[], filter: PeopleFilter | null, query: string): OpsPerson[] {
  const q = query.trim().toLowerCase();
  return people.filter((p) => matchesFilter(p, filter) && (q === "" || p.email.toLowerCase().includes(q)));
}

// Owner first, then most recently active, then the rest by email.
export function sortPeople(people: OpsPerson[]): OpsPerson[] {
  return [...people].sort((a, b) => {
    if (a.owner !== b.owner) return a.owner ? -1 : 1;
    const at = a.last_active_at ?? "";
    const bt = b.last_active_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return a.email.localeCompare(b.email);
  });
}

export function counts(people: OpsPerson[]): Record<PeopleFilter, number> {
  return {
    active: people.filter((p) => matchesFilter(p, "active")).length,
    revoked: people.filter((p) => matchesFilter(p, "revoked")).length,
    no_access: people.filter((p) => matchesFilter(p, "no_access")).length,
    signed_up: people.filter((p) => matchesFilter(p, "signed_up")).length,
    never_signed_up: people.filter((p) => matchesFilter(p, "never_signed_up")).length,
  };
}

export function formatDate(iso: string | null): string {
  if (!iso) return WORDING.notRecorded;
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return WORDING.notRecorded;
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function planLabel(p: OpsPerson): string {
  if (!p.signed_up || !p.plan) return "None";
  return p.on_trial ? `${p.plan}, on trial` : p.plan;
}

// A195: wording for the "On the default plan" report.
export const DEFAULT_TIER_WORDING = {
  title: "On the default plan",
  intro: "People whose plan comes only from the default, not from a subscription, trial, store purchase or grant.",
  show: "Show who",
  hide: "Hide",
  empty: "No one is on a plan only because of the default.",
  loadFailed: "Couldn't load the default plan report.",
  grantHint: "Open a person below and set their plan to keep them on Plus.",
} as const;

export function defaultTierSummary(r: {
  default_only_count: number;
  would_change_count: number;
  configured_default: string;
  code_default: string;
}): string {
  const people = r.default_only_count === 1 ? "1 person is" : `${r.default_only_count} people are`;
  if (r.default_only_count === 0) return DEFAULT_TIER_WORDING.empty;
  if (r.would_change_count === 0) {
    return `${people} on the default plan (${r.configured_default}). None would change.`;
  }
  const drop = r.would_change_count === 1 ? "1 would move" : `${r.would_change_count} would move`;
  return `${people} on ${r.configured_default} only by default. ${drop} to ${r.code_default} when the new default applies.`;
}

export function tierLabel(tier: string): string {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "";
}
