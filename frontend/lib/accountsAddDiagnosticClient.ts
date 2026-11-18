// G477: the real wiring for lib/accountsAddDiagnostic.ts (one instance per launch).
import { Capacitor } from "@capacitor/core";
import { api } from "@/lib/api";
import { createAddDiagnostic } from "@/lib/accountsAddDiagnostic";

function nativePlatform(): "ios" | "android" | null {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const p = Capacitor.getPlatform();
    return p === "ios" || p === "android" ? p : null;
  } catch {
    return null;
  }
}

let shared: ReturnType<typeof createAddDiagnostic> | null = null;

export function accountsAddDiagnostic(): ReturnType<typeof createAddDiagnostic> {
  if (!shared) {
    shared = createAddDiagnostic({
      platform: nativePlatform,
      build: process.env.NEXT_PUBLIC_BUILD_TAG || "build dev",
      sheetOpen: () => typeof document !== "undefined" && !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      // Our own api call returns a real Promise; errors are swallowed.
      send: (stage, detail, platform) => { try { api.reportPushDiagnostic(stage, detail, platform).catch(() => { /* best effort */ }); } catch { /* best effort */ } },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
  }
  return shared;
}
