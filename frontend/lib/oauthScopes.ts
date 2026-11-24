// Plain-language OAuth scope labels, kept word-for-word in sync with the
// backend's own copy (backend/app/routers/oauth.py, SCOPE_DESCRIPTIONS) so
// a scope reads the same wherever a user sees it: the /oauth/consent screen
// (which gets its text straight from that backend map via
// GET /oauth/request/{id}) and Settings' "Connected assistants" card
// (components/ConnectedAssistantsCard.tsx), which only gets bare scope
// strings back from GET /oauth/connections and has to label them itself.
export const OAUTH_SCOPE_LABELS: Record<string, string> = {
  "accounts:read": "Balances and account names",
  "plans:read": "Bills, plans, goals and your tax position figures",
  "insights:read": "Spending verdicts and insights",
};

// "Balances and account names, Bills, plans, goals and your tax position
// figures" — a comma-joined plain-language summary of a connection's
// granted scopes, for the one-line subtitle under a connected assistant's
// name. Falls back to the raw scope string for anything not in the map
// above, so an unrecognised future scope still renders something rather
// than vanishing.
export function describeScopes(scopes: string[]): string {
  return scopes.map((s) => OAUTH_SCOPE_LABELS[s] || s).join(", ");
}

// F28: the fuller, per-scope disclosure shown on the consent screen (variant A
// of the F23 design round, approved by Kevin). The backend's own short
// description (SCOPE_DESCRIPTIONS) is only the fallback for a scope this map
// does not know, so a new backend scope still renders something honest.
export const OAUTH_SCOPE_DISCLOSURES: Record<string, { title: string; description: string }> = {
  "accounts:read": {
    title: "Account information and balances",
    description:
      "For example, account names, balances, account activity, investment positions, your money overview and today\u2019s brief. It does not include raw transaction rows.",
  },
  "plans:read": {
    title: "Upcoming bills, plans and tax figures",
    description:
      "For example, upcoming bills, recurring payments, savings goals, debt and savings positions, affordability checks, and your tax position figures.",
  },
  "insights:read": {
    title: "Spending analysis by category and merchant",
    description:
      "For example, spending totals by category, merchant-based insights, your spending verdict and trends. It does not include raw transaction rows.",
  },
};

export function scopeDisclosure(scope: string, fallbackDescription: string): { title: string; description: string } {
  return OAUTH_SCOPE_DISCLOSURES[scope] || { title: OAUTH_SCOPE_LABELS[scope] || scope, description: fallbackDescription };
}

// Flip one scope in the user's selection. Pure so the toggle is testable.
export function toggleScope(selected: string[], scope: string): string[] {
  return selected.includes(scope) ? selected.filter((s) => s !== scope) : [...selected, scope];
}

// The scopes to send as `granted_scopes`: exactly the user's ticked boxes,
// in the order the assistant requested them, never anything not requested.
export function grantedScopesFor(requested: string[], selected: string[]): string[] {
  return requested.filter((s) => selected.includes(s));
}

// POST /oauth/decision body. Deny sends no scopes at all; an approval always
// names the subset explicitly (the backend rejects an empty one).
export function buildDecisionBody(
  reqId: string,
  approve: boolean,
  grantedScopes?: string[],
): { req_id: string; approve: boolean; granted_scopes?: string[] } {
  if (!approve) return { req_id: reqId, approve: false };
  return { req_id: reqId, approve: true, granted_scopes: grantedScopes ?? [] };
}
