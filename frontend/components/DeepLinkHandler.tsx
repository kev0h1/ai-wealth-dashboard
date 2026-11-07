"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEEP_LINK_EVENT, registerDeepLinkHandler, type DeepLinkDetail } from "@/lib/deepLinks";
import { bankSheetState, handleBankConnectReturn, takePendingReturn } from "@/lib/bankConnectReturn";
import { getToken, hydrateToken } from "@/lib/auth";
import { clearPendingConsent, resolvePendingConsent } from "@/lib/pendingConsent";
import { isNativePlatform } from "@/lib/nativeAuth";
import { api } from "@/lib/api";

// Listens for wealthdash:// returns for the whole app lifetime (A68), not just
// inside the sign-in loop, and republishes them as the wd:deeplink window event.
// A108: also routes a bank consent return (refresh data, open Accounts). It sits
// outside the auth gate, so it never uses useAuth: a return that arrives signed
// out is stashed and replayed on wd:session-established (AuthProvider).
// Renders nothing.
export default function DeepLinkHandler() {
  const router = useRouter();
  useEffect(() => registerDeepLinkHandler(), []);
  // A193: Android battery saver can close Sorted while the user is at the bank.
  // If that happened, the relaunch finds a consent marker in localStorage and
  // asks the server how that consent ended. The wait lets a return deep link
  // (which clears the marker) arrive first.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("@capacitor/browser").then(({ Browser }) =>
      Browser.addListener("browserFinished", () => clearPendingConsent(window.localStorage)),
    ).then((h) => { if (cancelled) void h.remove(); else off = () => void h.remove(); }).catch(() => {});
    const timer = window.setTimeout(() => {
      void hydrateToken().then(async () => {
        if (getToken() === null) return;
        const out = await resolvePendingConsent(window.localStorage, () => api.finexerPending());
        if (out.kind === "connected") {
          handleBankConnectReturn(
            { kind: "bank_connected", provider: "finexer", connection: out.connectionId, status: "ok" },
            router,
            { hasToken: () => true },
          );
        } else if (out.kind === "failed") {
          router.push(`/accounts?connect=interrupted${out.providerId ? `&provider=${encodeURIComponent(out.providerId)}` : ""}`);
        }
      });
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); off?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    const onLink = (e: Event) => {
      const detail = (e as CustomEvent<DeepLinkDetail>).detail;
      if (detail?.kind === "bank_connected") clearPendingConsent(window.localStorage);
      // Snapshot the picker registry now, synchronously, not after the await.
      const { sheetOpen, stay } = bankSheetState();
      // Cold start: the native token is in memory only until hydrated.
      void hydrateToken().then(() =>
        handleBankConnectReturn(detail, router, { storage, sheetOpen, stay, hasToken: () => getToken() !== null }),
      );
    };
    const onSession = () => {
      const pending = takePendingReturn(storage);
      if (pending) handleBankConnectReturn(pending, router, { hasToken: () => true });
    };
    window.addEventListener(DEEP_LINK_EVENT, onLink);
    window.addEventListener("wd:session-established", onSession);
    return () => {
      window.removeEventListener(DEEP_LINK_EVENT, onLink);
      window.removeEventListener("wd:session-established", onSession);
    };
  }, [router]);
  return null;
}
