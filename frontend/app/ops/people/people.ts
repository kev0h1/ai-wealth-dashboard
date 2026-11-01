// E12: pure helpers for the People page (filters, search, wording). Kept apart
// from the page so scripts/e12-people.test.mjs can exercise them directly.
import type { OpsPerson } from "@/lib/api";

export type PeopleFilter = "active" | "revoked" | "signed_up" | "never_signed_up";

export const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "revoked", label: "Revoked" },
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
} as const;

export const ACTION_LABELS: Record<string, string> = {
  invite: "Invited",
  revoke: "Revoked access",
  restore: "Restored access",
  erase: "Removed user",
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
  if (p.owner) return "Owner";
  if (p.allowlist_status === "revoked") return "Revoked";
  if (p.allowlist_status === "invited") return "Invited";
  return "No invite";
}

export function sourceLabel(p: OpsPerson): string {
  switch (p.source) {
    case "owner":
      return "Owner";
    case "invite":
      return "Invite";
    case "migrated":
      return "Migrated list";
    default:
      return "Open sign-up";
  }
}

// "Active" means can sign in now: the owner, an invited person, or someone
// signed up without an invite. Revoked is the only inactive state.
export function isActive(p: OpsPerson): boolean {
  return p.owner || p.allowlist_status !== "revoked";
}

export function matchesFilter(p: OpsPerson, filter: PeopleFilter | null): boolean {
  if (filter === null) return true;
  switch (filter) {
    case "active":
      return isActive(p);
    case "revoked":
      return !p.owner && p.allowlist_status === "revoked";
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
