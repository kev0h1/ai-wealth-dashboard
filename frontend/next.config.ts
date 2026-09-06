import type { NextConfig } from "next";
import { execSync } from "child_process";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

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

const nextConfig: NextConfig = {
  // Vercel builds natively (it sets VERCEL=1); "standalone" is only for the
  // self-hosted `next start` path and can break Vercel builds, so opt out there.
  output: MOBILE_EXPORT ? "export" : process.env.VERCEL ? undefined : "standalone",
  env: {
    NEXT_PUBLIC_BUILD_TAG: resolveBuildTag(),
  },
  transpilePackages: ["@wealth/shared"],
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
