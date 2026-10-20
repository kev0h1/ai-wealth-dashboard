"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/PreferencesContext";
import { BalancesHiddenContext } from "@/lib/balancesHidden";

/**
 * B56: the single app-level source of the Hide balances mask. Mounted once in
 * Providers, just inside PreferencesProvider, so every route and the
 * layout-level Penny sheet inherit it. Hidden until preferences resolve, the
 * same rule Home's Safe-to-Spend card has always used.
 *
 * Design previews (/design/*) are auth-exempt, load no preferences and render
 * fixture figures, so they stay visible: their markup is evidence of the
 * preview only and must never be masked by an unresolved preference.
 */
export function isDesignPreviewPath(pathname: string | null): boolean {
  return pathname === "/design" || (pathname?.startsWith("/design/") ?? false);
}

export default function AppBalancesHidden({ children }: { children: ReactNode }) {
  const { hideNetWorth, preferencesReady } = usePreferences();
  const pathname = usePathname();
  const hidden = !isDesignPreviewPath(pathname) && (hideNetWorth || !preferencesReady);
  return <BalancesHiddenContext.Provider value={hidden}>{children}</BalancesHiddenContext.Provider>;
}
