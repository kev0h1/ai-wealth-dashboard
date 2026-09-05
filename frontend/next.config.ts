import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

// Capacitor/mobile static export: Next's `output: 'export'` does not support
// rewrites() or redirects(), so both are disabled when MOBILE_EXPORT is set.
// The API base is instead baked in directly via NEXT_PUBLIC_API_URL.
const MOBILE_EXPORT = !!process.env.MOBILE_EXPORT;

const nextConfig: NextConfig = {
  // Vercel builds natively (it sets VERCEL=1); "standalone" is only for the
  // self-hosted `next start` path and can break Vercel builds, so opt out there.
  output: MOBILE_EXPORT ? "export" : process.env.VERCEL ? undefined : "standalone",
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
