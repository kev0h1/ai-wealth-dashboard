"use client";
import { useEffect } from "react";

// Module-level reference counter so stacked sheets keep the blur until ALL close.
let sheetCount = 0;

function getAppShell(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("app-shell");
}

export function useSheetOpen() {
  useEffect(() => {
    sheetCount += 1;
    const el = getAppShell();
    if (el) el.classList.add("sheet-open");

    return () => {
      sheetCount -= 1;
      if (sheetCount <= 0) {
        sheetCount = 0; // guard against underflow
        const shell = getAppShell();
        if (shell) shell.classList.remove("sheet-open");
      }
    };
  }, []);
}
