"use client";

import { usePathname } from "next/navigation";

/**
 * System-wide ambient glow — three tiers (see the recipe + doctrine comment
 * in app/globals.css: .glow-hero / .glow-ambient-tier / .glow-minimal, all
 * built from the same single indigo field at three different peak alphas).
 *
 *   hero    — the primary financial insight/verdict: Home (Safe-to-Spend),
 *             /cards, /debt-plan, /grow.
 *   ambient — supports content, never competes: /spend, /planning,
 *             /insights, /mirror.
 *   minimal — dense/utility screens that rely on surface contrast and
 *             typography, not glow: /settings, /accounts, /month, and
 *             everything else not listed (including /login).
 *
 * Mounted once in app/layout.tsx in place of the old hardcoded glow div.
 * /design/** previews own their own glow entirely and get nothing here.
 */

type Tier = "hero" | "ambient" | "minimal";

interface RouteGlow {
  /** Exact path for "/", otherwise a prefix matched against `${path}/`. */
  path: string;
  tier: Tier;
  /** Optional per-route override of --glow-y (px) — the field's vertical
   *  centre. Omit to use the shared default set on :root/.dark. */
  y?: number;
}

// The single source of truth for route → tier (+ optional vertical centre).
// Per-screen tuning is a one-line edit here.
export const GLOW_ROUTES: RouteGlow[] = [
  { path: "/", tier: "hero", y: 200 }, // Home — centred on the Safe-to-Spend hero
  { path: "/cards", tier: "hero" },
  { path: "/debt-plan", tier: "hero" },
  { path: "/grow", tier: "hero" },
  { path: "/spend", tier: "ambient" },
  { path: "/planning", tier: "ambient" },
  { path: "/insights", tier: "ambient" },
  { path: "/mirror", tier: "ambient" },
  { path: "/settings", tier: "minimal" },
  { path: "/accounts", tier: "minimal" },
  { path: "/month", tier: "minimal" },
];

// Everything not matched above (incl. /login) falls back to minimal.
const DEFAULT_TIER: Tier = "minimal";

const TIER_CLASS: Record<Tier, string> = {
  hero: "glow-hero",
  ambient: "glow-ambient-tier",
  minimal: "glow-minimal",
};

function matchRoute(pathname: string): RouteGlow | undefined {
  return (
    GLOW_ROUTES.find((route) => route.path === pathname) ??
    GLOW_ROUTES.find(
      (route) => route.path !== "/" && pathname.startsWith(`${route.path}/`)
    )
  );
}

export default function GlowField() {
  const pathname = usePathname() ?? "/";

  // /design/** previews (e.g. /design/premium, /design/glow) own their own
  // glow field entirely — this component renders nothing there.
  if (pathname === "/design" || pathname.startsWith("/design/")) return null;

  const route = matchRoute(pathname);
  const tier = route?.tier ?? DEFAULT_TIER;
  const style =
    route?.y != null ? ({ "--glow-y": `${route.y}px` } as React.CSSProperties) : undefined;

  return (
    <div
      aria-hidden="true"
      className="app-glow pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        className={`${TIER_CLASS[tier]} absolute left-1/2 -translate-x-1/2 top-[4vh] h-[96vh] w-[135vw] max-w-[780px]`}
        style={style}
      />
    </div>
  );
}
