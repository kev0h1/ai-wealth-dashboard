"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEEP_LINK_EVENT, registerDeepLinkHandler, type DeepLinkDetail } from "@/lib/deepLinks";
import { bankSheetState, handleBankConnectReturn, takePendingReturn } from "@/lib/bankConnectReturn";
import { getToken, hydrateToken } from "@/lib/auth";

// Listens for wealthdash:// returns for the whole app lifetime (A68), not just
// inside the sign-in loop, and republishes them as the wd:deeplink window event.
// A108: also routes a bank consent return (refresh data, open Accounts). It sits
// outside the auth gate, so it never uses useAuth: a return that arrives signed
// out is stashed and replayed on wd:session-established (AuthProvider).
// Renders nothing.
export default function DeepLinkHandler() {
  const router = useRouter();
  useEffect(() => registerDeepLinkHandler(), []);
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    const onLink = (e: Event) => {
      const detail = (e as CustomEvent<DeepLinkDetail>).detail;
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
