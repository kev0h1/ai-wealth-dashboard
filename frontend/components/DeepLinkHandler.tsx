"use client";

import { useEffect } from "react";
import { registerDeepLinkHandler } from "@/lib/deepLinks";

// Listens for wealthdash:// returns for the whole app lifetime (A68), not just
// inside the sign-in loop, and republishes them as the wd:deeplink window event.
// Renders nothing.
export default function DeepLinkHandler() {
  useEffect(() => registerDeepLinkHandler(), []);
  return null;
}
