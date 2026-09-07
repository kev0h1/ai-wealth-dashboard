// Build-time feature flags, one constant per NEXT_PUBLIC_* env var. See
// frontend/lib/webProduct.ts for the same pattern: NEXT_PUBLIC_* vars are
// inlined at build time, so these are plain module-scope constants, not
// something read at request time.

// TrueLayer picker flag (backlog A16). The Accounts "Add" menu's legacy
// "Add Bank via TrueLayer" entry only renders when this is "on". "Add Bank"
// (Finexer) is the one connect path everywhere else; TrueLayer stays
// reachable on UAT (the VPS frontend service and UAT mobile builds) so it
// can still be exercised, but is hidden on Vercel prod and the prod mobile
// build. Set `NEXT_PUBLIC_TRUELAYER_PICKER=on` to show it; leave it unset to
// hide it.
export const TRUELAYER_PICKER = process.env.NEXT_PUBLIC_TRUELAYER_PICKER === "on";
