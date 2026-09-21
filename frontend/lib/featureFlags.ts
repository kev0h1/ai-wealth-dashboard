// Build-time feature flags, one constant per NEXT_PUBLIC_* env var. See
// frontend/lib/webProduct.ts for the same pattern: NEXT_PUBLIC_* vars are
// inlined at build time, so these are plain module-scope constants, not
// something read at request time.

// The legacy bank-picker flag (backlog A16, `NEXT_PUBLIC_TRUELAYER_PICKER`)
// used to live here as a `TRUELAYER_PICKER` boolean. A67 moved it: it is now
// read in `next.config.ts`, which inlines the provider's identifier and
// display name as build-time constants that `lib/legacyBankProvider.ts`
// derives everything from. The reason is measured, not stylistic — with the
// flag as a module constant here, a production build still shipped the
// entire menu entry, its label and the provider's endpoint paths, gated only
// by a `&&` that never fired. Import from `@/lib/legacyBankProvider`
// instead; the operator-facing env var name has not changed.

// MCP connector flag (backlog A17). The connector (F2 OAuth authorisation
// server + F3 /mcp Streamable HTTP endpoint) is built but not yet part of
// the Finexer compliance answers ("planned", not live), so production
// ships with it entirely hidden: Settings' "Connected assistants" card
// doesn't render (and never fetches connections/audit), the OAuth consent
// page shows a calm "not available yet" screen instead of running the
// consent flow, and the Privacy/Terms "AI assistants" sections are
// stripped from the rendered legal pages (see lib/legalContent.ts).
// Mirrors MCP_CONNECTOR_ENABLED on the backend; the two must be turned on
// together (UAT only, for now; see DEPLOY.md). Set
// `NEXT_PUBLIC_MCP_CONNECTOR=on` to show it; leave it unset to hide it.
export const MCP_CONNECTOR = process.env.NEXT_PUBLIC_MCP_CONNECTOR === "on";

// F8: the connector's own public URL, shown in Settings' "Connected
// assistants" empty state (components/ConnectedAssistantsCard.tsx) as the
// address a user points Claude/ChatGPT at. Mirrors the backend's
// MCP_PUBLIC_URL (backend/app/core/config.py) — the two must point at the
// same host, since this is only copy, not a live request the frontend
// makes. Defaults to the prod API host's /mcp path so a prod build works
// with no env var set; UAT sets `NEXT_PUBLIC_MCP_URL` in its own
// frontend/.env.local once a dedicated connector hostname (e.g.
// mcp.wealth.auriqltd.co.uk) exists, so UAT never shows the prod host to a
// UAT user (see DEPLOY.md's MCP connector section).
export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || "https://api.wealth.auriqltd.co.uk/mcp";
