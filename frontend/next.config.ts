import type { NextConfig } from "next";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

// scripts/session.sh's branch-per-item worktrees (see CLAUDE.md, "Backlog")
// symlink frontend/node_modules to the shared tree at /root/ai-wealth-dashboard
// rather than installing a separate copy per worktree. Turbopack refuses to
// follow a node_modules symlink that resolves outside the project directory
// ("Symlink [project]/node_modules is invalid, it points out of the
// filesystem root"), which only bites in that worktree layout: the shared
// tree's own node_modules is a real directory, not a symlink, so this is a
// no-op there and in every other build environment (Vercel, Codemagic, the
// systemd `next start` deploy). Detect the symlinked-worktree case and widen
// Turbopack's root to the nearest ancestor that contains both the worktree
// and the shared tree (/root) so it can resolve packages through the link.
function resolveTurbopackRoot(): string | undefined {
  const nodeModulesPath = path.join(__dirname, "node_modules");
  let stat;
  try {
    stat = fs.lstatSync(nodeModulesPath);
  } catch {
    return undefined;
  }
  if (!stat.isSymbolicLink()) return undefined;

  let target: string;
  try {
    target = fs.realpathSync(nodeModulesPath);
  } catch {
    return undefined;
  }

  const projectDir = path.resolve(__dirname, "..");
  const relative = path.relative(projectDir, target);
  const pointsOutsideProject = relative.startsWith("..") || path.isAbsolute(relative);
  if (!pointsOutsideProject) return undefined;

  // Walk up from both the worktree's frontend directory and the shared
  // tree's frontend directory (the symlink target's parent) until the paths
  // agree, e.g. /root/worktrees/feature-H32-x/frontend and
  // /root/ai-wealth-dashboard/frontend both live under /root. This works
  // regardless of how deep scripts/session.sh nests the worktree, unlike a
  // fixed number of ".." hops.
  const targetFrontendDir = path.dirname(target);
  const here = __dirname.split(path.sep);
  const there = targetFrontendDir.split(path.sep);
  const common: string[] = [];
  for (let i = 0; i < Math.min(here.length, there.length); i++) {
    if (here[i] !== there[i]) break;
    common.push(here[i]);
  }
  const root = common.join(path.sep);
  return root || path.sep;
}

const turbopackRoot = resolveTurbopackRoot();

// Derives the login/biometric-lock build tag (see frontend/lib/buildTag.ts)
// at config-load time, i.e. before `next build` starts compiling, so it can
// be inlined via `env:` below as NEXT_PUBLIC_BUILD_TAG. Resolution order:
//   1. NEXT_PUBLIC_BUILD_TAG already set in the environment — used verbatim
//      (lets any environment override the derivation outright).
//   2. Short SHA: VERCEL_GIT_COMMIT_SHA (Vercel) or CM_COMMIT (Codemagic),
//      first 7 chars, else `git rev-parse --short HEAD` run from this
//      file's own directory (works for UAT's in-tree `npm run build`; not
//      used by the mobile static export, which builds from a rsync'd
//      scratch dir with no .git — build-mobile.sh precomputes the tag and
//      exports NEXT_PUBLIC_BUILD_TAG before that build starts, so case 1
//      above wins there instead), else "nogit" if all of that fails.
//   3. BUILD_NUMBER (Codemagic's auto-incrementing build counter), appended
//      as "#<n>" when set.
// Final shape: "build 2026-09-07 9763f81" or "build 2026-09-07 9763f81 #42".
function resolveBuildTag(): string {
  if (process.env.NEXT_PUBLIC_BUILD_TAG) {
    return process.env.NEXT_PUBLIC_BUILD_TAG;
  }

  const date = new Date().toISOString().slice(0, 10);

  let sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CM_COMMIT || "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      sha = "";
    }
  }
  sha = sha ? sha.slice(0, 7) : "nogit";

  const buildNumber = process.env.BUILD_NUMBER ? ` #${process.env.BUILD_NUMBER}` : "";

  return `build ${date} ${sha}${buildNumber}`;
}

// Capacitor/mobile static export: Next's `output: 'export'` does not support
// rewrites() or redirects(), so both are disabled when MOBILE_EXPORT is set.
// The API base is instead baked in directly via NEXT_PUBLIC_API_URL.
const MOBILE_EXPORT = !!process.env.MOBILE_EXPORT;

// A27: security headers. `output: 'export'` (MOBILE_EXPORT) doesn't support
// headers() at all (same reason rewrites()/redirects() are disabled for it
// above) — the Capacitor shells get their headers from whatever serves the
// static bundle, not from here.
//
// CSP reality check (verified 2026-09-14 against a real build, headless
// Chrome, console inspected — see the A27 backlog item for the transcript):
// a HASH-only script-src does NOT work on this app, and the reason is not
// this app's own code. The two `dangerouslySetInnerHTML` `<script>` tags in
// app/layout.tsx (dark mode pre-paint class, nav-exempt/legal-page
// pre-paint class)
// ARE the only inline scripts this app AUTHORS (grepped, still true), and
// their hashes are listed below for documentation/defence-in-depth — but
// Next.js's own App Router injects ADDITIONAL inline scripts on every page
// itself (`self.__next_f.push(...)`, the React Server Components flight
// payload that hydrates the page), and their content is different per page
// and per build. A hash allow-list can't cover content that isn't static.
//
// Next's own fix for this is a per-request nonce, generated in
// `middleware.ts` and threaded through `headers()`/a `nonce` prop on every
// script tag. That was evaluated and deliberately NOT done here: reading
// `headers()` to get the nonce forces whatever reads it out of static
// rendering into a per-request dynamic render — and app/layout.tsx wraps
// EVERY route, including the ~80 currently-static `/design/*` preview pages
// and every other statically-generated page in this app (see `next build`'s
// own route table, marked `○ (Static)`). Trading that much of the app's
// static generation for a script-src that's hash/nonce-only instead of
// 'unsafe-inline' is not a good trade for what it buys here (script
// injection still needs an XSS hole to exploit in the first place; this
// header is defence in depth, not the only thing standing between an
// attacker and a script tag). If Next's own inline-script behaviour changes
// (or this app is willing to pay the static-rendering cost), the
// middleware.ts + nonce pattern is the documented way to tighten this
// further — see https://nextjs.org/docs/app/guides/content-security-policy.
// This app's own two inline scripts, for the record (not used in the CSP
// itself — see below for why): app/layout.tsx's dark-mode pre-paint class
// script hashes to 'sha256-J/QwB0zj3eeOw1RuRZ77XPxpqMrdt6AMmA0OQZc2XC4=',
// the nav-exempt/legal-page pre-paint class script to
// 'sha256-w6fPoAFT7WoyZc6NWLvzBup5yAk9LrNRck5SQoI2Tm4=' (H75 changed this
// one: it is now BUILT from lib/navExemptRoutes.ts rather than written out
// in layout.tsx, so its content, and therefore this hash, changes whenever
// the exemption list does — one more reason these hashes are documentation
// and not the CSP itself). Per the CSP spec, a
// script-src that carries ANY hash-source or nonce-source makes browsers
// IGNORE 'unsafe-inline' entirely (it only exists as a fallback for browsers
// too old to understand hash/nonce sources) — so listing these hashes
// alongside 'unsafe-inline' would not be a harmless belt-and-braces
// addition, it would silently turn 'unsafe-inline' off and re-block Next's
// own dynamically-injected flight-data scripts (see the CSP reality-check
// comment above). They are deliberately NOT in the CSP below for that
// reason; if this ever moves to the nonce-based approach, generate fresh
// nonces per request instead of resurrecting these hashes.

// style-src ALSO needs 'unsafe-inline': this app sets React `style={{...}}`
// props on well over a hundred components, which render as inline
// `style="..."` HTML attributes — CSP has no practical hash/nonce mechanism
// for those either (a nonce only covers <style> elements/attributes
// rendered by the SAME request that carries the nonce, and every one of
// these is a distinct, per-render, dynamic value). Tightening this further
// would mean rewriting every inline `style` prop to a class or a CSS custom
// property first — real work, not a config change; not attempted here.
const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  // Same-origin only: every real API call goes through the /api/:path*
  // rewrite above (frontend/lib/api.ts's API_BASE defaults to "/api"), so
  // there is no cross-origin fetch/XHR target to allow. Bank-consent
  // redirects (TrueLayer/Finexer/Apple/Google sign-in) are top-level page
  // navigations, not fetch/XHR, so they're unaffected by connect-src.
  `connect-src 'self'`,
  `frame-ancestors 'none'`,
  `frame-src 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

// Locks down every Permissions-Policy feature this app doesn't use. The
// receipt-scan camera capture (app/receipts/ReceiptsPage.tsx,
// components/GroceryBasketCard.tsx) uses `<input type="file"
// capture="environment">`, which hands off to the OS camera app — it does
// NOT use getUserMedia/the in-page Permissions API camera feature, so
// `camera=()` here does not break it.
const PERMISSIONS_POLICY = [
  "camera=()", "microphone=()", "geolocation=()", "payment=()",
  "usb=()", "magnetometer=()", "gyroscope=()", "accelerometer=()",
  "interest-cohort=()",
].join(", ");

async function securityHeaders() {
  if (MOBILE_EXPORT) return [];
  const headers = [
    // includeSubDomains + preload: this app owns no other subdomains that
    // need to stay reachable over plain HTTP, and preload is a one-way
    // door only Kevin should submit (hstspreload.org) — the header alone
    // does not submit it, so this is safe to ship ahead of that decision.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
  // CSP only in production: `next dev`'s own HMR client needs 'unsafe-eval'
  // and a ws:// connect-src this CSP deliberately doesn't grant, and dev is
  // never internet-facing, so there's nothing this would protect there —
  // shipping it anyway would just break local development.
  if (process.env.NODE_ENV === "production") {
    headers.push({ key: "Content-Security-Policy", value: CSP });
  }
  return headers;
}

const nextConfig: NextConfig = {
  // Vercel builds natively (it sets VERCEL=1); "standalone" is only for the
  // self-hosted `next start` path and can break Vercel builds, so opt out there.
  output: MOBILE_EXPORT ? "export" : process.env.VERCEL ? undefined : "standalone",
  env: {
    NEXT_PUBLIC_BUILD_TAG: resolveBuildTag(),
  },
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
  transpilePackages: ["@wealth/shared"],
  async headers() {
    const headers = await securityHeaders();
    if (headers.length === 0) return [];
    return [{ source: "/:path*", headers }];
  },
  async rewrites() {
    if (MOBILE_EXPORT) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/:path*`,
      },
    ];
  },
  async redirects() {
    if (MOBILE_EXPORT) return [];
    return [
      { source: "/budget", destination: "/spend", permanent: false },
      { source: "/debt", destination: "/cards", permanent: false },
      // /debt-plan page retired 2026-08-30 (functionality moved to the Card
      // plan surfaces), redirect old deep links (incl. historical
      // notification links) straight to its successor rather than 404.
      { source: "/debt-plan", destination: "/cards", permanent: false },
      // Grow folded into Planning, 2026-09-04.
      { source: "/grow", destination: "/planning", permanent: false },
      // Insights page retired 2026-09-05: tax and receipts became their own
      // top-level routes, everything else redirects to the money shape's
      // new home. These rules only run on the web build — redirects() is
      // disabled for MOBILE_EXPORT (see the guard above), so the Capacitor
      // app relies entirely on app/insights/page.tsx's own client redirect
      // for this route (which reimplements the same `?tab=tax` distinction
      // below, purely for that build). The `?tab=tax` rule must come BEFORE
      // the blanket `/insights` rule: Next preserves the query string across
      // a redirect, so without this more-specific rule ahead of it, the
      // blanket rule below would fire first (it matches on path alone) and
      // send `/insights?tab=tax` to `/spend/shape?tab=tax`, not `/tax`.
      { source: "/insights/tax", destination: "/tax", permanent: false },
      { source: "/insights/receipts", destination: "/receipts", permanent: false },
      {
        source: "/insights",
        has: [{ type: "query", key: "tab", value: "tax" }],
        destination: "/tax",
        permanent: false,
      },
      { source: "/insights", destination: "/spend/shape", permanent: false },
    ];
  },
};

export default nextConfig;
