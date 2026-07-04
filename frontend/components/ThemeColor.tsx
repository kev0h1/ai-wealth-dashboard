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
  }, [darkMode]);

  return null;
}
