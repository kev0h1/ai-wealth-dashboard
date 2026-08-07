"use client";

import { useEffect } from "react";
import { usePreferences } from "@/components/PreferencesContext";

const LIGHT = "#f0f2f7";
const DARK  = "#0f172a";

// Drive the PWA status bar (theme-color) off the app's manual dark-mode state.
// We keep a single managed meta and update its content; the per-page viewport
// exports no longer emit theme-color metas, so there is nothing to collapse.
export default function ThemeColor() {
  const { darkMode } = usePreferences();

  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = darkMode ? DARK : LIGHT;

    // Native status-bar icon color (Capacitor): dark icons on light bg, light icons on dark bg.
    // iOS overlays the status bar by default already. We deliberately do NOT
    // force Android into edge-to-edge here: doing so would make Android rely
    // on raw env(safe-area-inset-*), which is unreliable/zero on older
    // Android WebViews — worse than the current safe OS-managed default
    // (WebView inset below the status bar, no collision to mask). Android
    // edge-to-edge needs on-device verification plus a real inset-reporting
    // plugin (e.g. @capacitor-community/safe-area); deferred until there's
    // an Android build to test against.
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setStyle({ style: darkMode ? Style.Dark : Style.Light });
      } catch {}
    })();
  }, [darkMode]);

  return null;
}
