// Plain-language OAuth scope labels, kept word-for-word in sync with the
// backend's own copy (backend/app/routers/oauth.py, SCOPE_DESCRIPTIONS) so
// a scope reads the same wherever a user sees it: the /oauth/consent screen
// (which gets its text straight from that backend map via
// GET /oauth/request/{id}) and Settings' "Connected assistants" card
// (components/ConnectedAssistantsCard.tsx), which only gets bare scope
// strings back from GET /oauth/connections and has to label them itself.
//
// Also used by the /design/oauth-consent and /design/connected-assistants
// fixtures, so a wording change here can't quietly drift between the two
// surfaces or their previews.
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
