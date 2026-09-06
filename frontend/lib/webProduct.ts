// Web product build flag (backlog A10). Vercel's production project sets
// NEXT_PUBLIC_WEB_PRODUCT=off so every product route renders the "Sorted is
// an app" shell (components/AppOnlyPage.tsx) instead of the real app —
// /terms, /privacy, the OAuth/webhook return routes and the design previews
// stay reachable (see AuthProvider.tsx). Left unset on UAT and baked "on" by
// scripts/build-mobile.sh so a Capacitor export can never ship locked.
//
// NEXT_PUBLIC_* vars are inlined at build time (see lib/api.ts's API_BASE for
// the same pattern), so this is a plain module-scope constant, not something
// read at request time.
export const WEB_PRODUCT_OFF = process.env.NEXT_PUBLIC_WEB_PRODUCT === "off";

// Store links are not known yet (Play listing is backlog A9, still
// pending) — StoreBadges.tsx renders a "coming soon" placeholder badge
// whenever its URL is empty.
export const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || "";
export const PLAY_STORE_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || "";
