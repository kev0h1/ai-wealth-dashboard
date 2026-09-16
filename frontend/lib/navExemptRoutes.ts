// Single source of truth for which routes never render the primary bottom
// navigation (components/BottomNav.tsx).
//
// G79 (Kevin, 2026-09-16): "every page must have the nav bar. Treat any
// surface without it as a defect unless Kevin has explicitly exempted it."
// Before this file, BottomNav was mounted per-page (15 page components each
// remembering to render it), which is exactly how app/spend/shape/ShapePage.tsx
// lost it silently — nobody was watching for a NEW page that forgot to add
// it. The fix: BottomNav is now mounted exactly once, in app/layout.tsx,
// as a sibling of components/Sidebar.tsx — every route gets it by default,
// structurally, with no per-page opt-in possible any more. The only way a
// route can now lack the nav is by matching an entry in this list, so this
// list IS the exemption mechanism, and it is read by two independent
// consumers that must never drift apart:
//   1. components/BottomNav.tsx (`isNavExemptPath`) — decides at runtime
//      whether to render on the current pathname.
//   2. scripts/check-nav-coverage.mjs — run at session-finish (like
//      check:design-index, check:legal-content) — fails if this list's
//      entries no longer correspond to a real route, or if a real,
//      non-design route imports the real BottomNav a second time (which
//      would double-render it, the opposite failure).
//
// Signed-in-but-gated states (LoginScreen, Onboarding, AppOnlyPage) are
// deliberately NOT listed here: they're not routes, they're what
// components/AuthProvider.tsx renders IN PLACE OF the whole app shell
// (Sidebar and BottomNav both) before a session exists, exactly the same
// way Sidebar has always been suppressed pre-login. Nothing to exempt.
export interface NavExemptRoute {
  // Exact pathname, or a "prefix/" ending in "/" to exempt a whole subtree.
  path: string;
  // Why this route is allowed to be missing the nav — required, and read
  // by scripts/check-nav-coverage.mjs (must be a real sentence, not a stub).
  reason: string;
}

export const NAV_EXEMPT_ROUTES: NavExemptRoute[] = [
  {
    path: "/design/",
    reason:
      "Static design-preview mockups (app/design/**), not real product surfaces — several already render their own fixture/mock nav (FixtureBottomNav, MockBottomNav) for the specific state they're demonstrating; the real nav would double up with those and would navigate a reviewer off the preview entirely.",
  },
  {
    path: "/terms",
    reason:
      "Public, unauthenticated legal document for anonymous visitors and regulators; deliberately chromeless already (see globals.css's html.legal-page rule, which also hides the desktop Sidebar here).",
  },
  {
    path: "/privacy",
    reason:
      "Public, unauthenticated legal document; same reasoning and the same html.legal-page CSS rule as /terms.",
  },
  {
    path: "/oauth/consent",
    reason:
      "MCP OAuth consent screen — an external client's browser lands here with no session at all (GET /auth/oauth/authorize), and the page manages its own auth (renders LoginScreen itself when needed) rather than going through the normal gate; it is not a surface a signed-in user navigates to or from.",
  },
  {
    path: "/month/story",
    reason:
      "Full-screen immersive story player (StoryPlayer.tsx renders a fixed inset-0 z-50 takeover with its own close control), the same category as a full-screen sheet — the nav rail would sit underneath/behind the takeover, not usefully alongside it.",
  },
  {
    path: "/ops/go-live",
    reason:
      "Private, owner-only admin board (backend 403s anyone but the owner/bot identity) reached only by a direct URL Kevin types or bookmarks, never linked from the product's own navigation; it is not part of the Home/Spend/Penny/Upcoming/Planning surface the nav represents.",
  },
  {
    path: "/ops/broadcast",
    reason:
      "Private, owner-only admin tool, same reasoning as /ops/go-live (linked only from that board, never from the nav).",
  },
  {
    path: "/grow",
    reason:
      "Client-side redirect only (Grow folded into Planning, 2026-09-04) — renders a blank div for one tick before router.replace('/planning'); there is no content here for a user to navigate away from.",
  },
  {
    path: "/insights",
    reason:
      "Client-side redirect only (Insights retired, 2026-09-05) — renders a blank div for one tick before redirecting to /spend/shape or /tax; kept for old deep links/bookmarks, not a real destination.",
  },
];

export function isNavExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return NAV_EXEMPT_ROUTES.some(({ path }) =>
    path.endsWith("/") ? pathname === path.slice(0, -1) || pathname.startsWith(path) : pathname === path
  );
}
