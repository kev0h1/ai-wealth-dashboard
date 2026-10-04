"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEEP_LINK_EVENT, registerDeepLinkHandler, type DeepLinkDetail } from "@/lib/deepLinks";
import { handleBankConnectReturn } from "@/lib/bankConnectReturn";

// Listens for wealthdash:// returns for the whole app lifetime (A68), not just
// inside the sign-in loop, and republishes them as the wd:deeplink window event.
// A108: also routes a bank consent return (refresh data, open Accounts).
// Renders nothing.
export default function DeepLinkHandler() {
  const router = useRouter();
  useEffect(() => registerDeepLinkHandler(), []);
  useEffect(() => {
    const onLink = (e: Event) => handleBankConnectReturn((e as CustomEvent<DeepLinkDetail>).detail, router);
    window.addEventListener(DEEP_LINK_EVENT, onLink);
    return () => window.removeEventListener(DEEP_LINK_EVENT, onLink);
  }, [router]);
  return null;
}
