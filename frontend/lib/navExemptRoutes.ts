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
// list IS the exemption mechanism, and it is read by three independent
// consumers that must never drift apart:
//   1. components/BottomNav.tsx (`isNavExemptPath`) — decides at runtime
//      whether to render on the current pathname.
//   2. components/Sidebar.tsx (`isNavExemptPath`) — the desktop rail, the
//      same decision on the same list. Added by H75: it did not consult
//      this list at all until then, so every entry below still got the
//      desktop rail (except /terms and /privacy, which escaped by
//      globals.css's separate `html.legal-page aside` rule). An entry here
//      now means "no primary navigation on this route", both rails, which
//      is what the reasons below were already written to mean.
//   3. scripts/check-nav-coverage.mjs — run at session-finish (like
//      check:design-index, check:legal-content) — fails if this list's
//      entries no longer correspond to a real route, if either rail stops
//      consulting the list, if `isNavExemptPath` stops exempting a listed
//      route in any shape it can be reached in, or if a real, non-design
//      route imports the real BottomNav a second time (which would
//      double-render it, the opposite failure).
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

// H75 (Kevin, 2026-09-17): the entries above are written the way a route is
// spelled in the browser ("/ops/go-live"), but a route is not always REACHED
// that way. The Board Android app (H66) bundles the same Next static export
// this repo builds with `npm run build:mobile`, and Capacitor's local asset
// server resolves request paths to asset files by exact filename with no
// extension guessing, so Board's start shim sends the WebView to the literal
// file the export emits: "/ops/go-live.html". usePathname() then reports
// "/ops/go-live.html", the old exact `pathname === path` comparison missed,
// and BottomNav rendered over a private owner-only admin board it is
// explicitly exempted from.
//
// That is a whole class, not one route: EVERY entry in this list is matched
// the same way, so any of them reached as a literal exported file has the
// same hole, and the Sorted app bundles the same export. So the pathname is
// normalised here, once, in the matcher — never by adding a second ".html"
// twin of each entry, which would double the list, drift the moment an entry
// changes, and break scripts/check-nav-coverage.mjs's "every entry resolves
// to a real page.tsx" check (there is no app/ops/go-live.html/page.tsx).
//
// The normalisation is deliberately narrow: only the shapes below, all of
// which mean "the same route, spelled as a file", are folded away.
//   1. a trailing ".html"  — "/ops/go-live.html" -> "/ops/go-live"  (the
//      export's shape today: next.config.ts does not set trailingSlash, so
//      the export emits ops/go-live.html, not ops/go-live/index.html)
//   2. a trailing "/index" left behind by step 1 — "/ops/go-live/index.html"
//      -> "/ops/go-live" (the shape the export would emit if trailingSlash
//      were ever turned on; stripped ONLY when it came from a ".html" file,
//      so a hypothetical real route literally named ".../index" is untouched)
//   3. a trailing slash — "/ops/go-live/" -> "/ops/go-live"
// Nothing else is touched: no case folding, no segment rewriting, no
// prefix-matching an entry that didn't already prefix-match. A pathname that
// merely starts with an entry's text ("/growth", "/terms-and-conditions")
// still does not match, exactly as before.
export function normaliseNavPath(pathname: string): string {
  let normalised = pathname;
  if (normalised.endsWith(".html")) {
    normalised = normalised.slice(0, -".html".length);
    if (normalised.endsWith("/index")) {
      // Leave the trailing "/" for the next step to remove, so "/index.html"
      // collapses to "/" rather than to the empty string.
      normalised = normalised.slice(0, -"index".length);
    }
  }
  if (normalised.length > 1 && normalised.endsWith("/")) {
    normalised = normalised.slice(0, -1);
  }
  return normalised === "" ? "/" : normalised;
}

export function isNavExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normalised = normaliseNavPath(pathname);
  return NAV_EXEMPT_ROUTES.some(({ path }) =>
    path.endsWith("/")
      ? normalised === path.slice(0, -1) || normalised.startsWith(path)
      : normalised === path
  );
}

// ── Pre-paint <html> classes ─────────────────────────────────────────────
//
// The exemption list has to be answerable BEFORE React runs, not just at
// render time, because hiding the rail is only half of hiding the rail:
// #app-shell reserves 16rem of margin-left for it at >= 1024px (globals.css),
// and that margin is pure reserved space, since the rail itself is
// `position: fixed`. Remove the rail without releasing the margin and an
// exempt route renders with a 256px dead gutter and its content pushed
// 128px off centre — measured on /design, /ops/go-live, /ops/broadcast and
// /oauth/consent before this was added. The release has to happen pre-paint
// for the same reason the dark-mode class does: doing it in an effect would
// flash the full shell first.
//
// So this module builds the <head> script, rather than app/layout.tsx
// hand-writing one. layout.tsx is a server component (no "use client"), so
// it can import this constant and interpolate it; the list, the
// normalisation and the matching rule then exist in exactly one file. The
// earlier version of this fix hand-inlined the normalisation in layout.tsx
// with a comment on each side asking a future reader to keep the two in
// step — which is the same class of promise that let components/Sidebar.tsx
// ignore this list entirely until H75, i.e. the bug this item exists to fix.
// scripts/check-nav-coverage.mjs now EXECUTES this script against the same
// case table it runs isNavExemptPath over, so the two cannot drift silently.
//
// Two classes come out of it:
//   `nav-exempt`  on every route in the list above — hides the rail
//                 pre-paint and releases its reserved margin (globals.css).
//                 components/Sidebar.tsx keeps it in sync across client-side
//                 route changes, which this script cannot see.
//   `legal-page`  on the published legal documents only. What is left under
//                 that class is now genuinely legal-specific: those two
//                 pages are full-bleed at EVERY width, where an exempt app
//                 route keeps the normal 430px phone shell below lg.
export const LEGAL_PAGE_ROUTES = ["/terms", "/privacy"];

// The normalisation above, as the few characters of ES5 a pre-paint script
// can run. Kept next to normaliseNavPath deliberately; check-nav-coverage
// asserts the two agree on every case in its table rather than trusting
// this comment.
const PRE_PAINT_NORMALISE_JS =
  "if(p.slice(-5)==='.html'){p=p.slice(0,-5);if(p.slice(-6)==='/index'){p=p.slice(0,-5)}}" +
  "if(p.length>1&&p.slice(-1)==='/'){p=p.slice(0,-1)}";

export const PRE_PAINT_NAV_SCRIPT =
  `try{var p=location.pathname;${PRE_PAINT_NORMALISE_JS}` +
  `var E=${JSON.stringify(NAV_EXEMPT_ROUTES.map(({ path }) => path))},` +
  `L=${JSON.stringify(LEGAL_PAGE_ROUTES)},c=document.documentElement.classList,i,q;` +
  `for(i=0;i<E.length;i++){q=E[i];` +
  `if(q.slice(-1)==='/'?(p===q.slice(0,-1)||p.indexOf(q)===0):p===q){c.add('nav-exempt');break}}` +
  `if(L.indexOf(p)>-1){c.add('legal-page')}}catch(e){}`;
