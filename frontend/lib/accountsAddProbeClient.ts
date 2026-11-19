// G478 TEMPORARY: real wiring for lib/accountsAddProbe.ts. See that file for removal.
import { Capacitor } from "@capacitor/core";
import { api } from "@/lib/api";
import { createAddProbe } from "@/lib/accountsAddProbe";

function nativePlatform(): "ios" | "android" | null {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const p = Capacitor.getPlatform();
    return p === "ios" || p === "android" ? p : null;
  } catch {
    return null;
  }
}

function readInsets() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft };
  probe.remove();
  return out;
}

const probe = createAddProbe({
  platform: nativePlatform,
  build: process.env.NEXT_PUBLIC_BUILD_TAG || "build dev",
  insets: readInsets,
  viewport: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }),
  elementFromPoint: (x, y) => document.elementFromPoint(x, y),
  send: (stage, detail, platform) => { try { api.reportPushDiagnostic(stage, detail, platform).catch(() => { /* best effort */ }); } catch { /* best effort */ } },
});

/** Call once the open menu has painted. */
export function runAddMenuProbe(menuRoot: HTMLElement | null) {
  if (!menuRoot) return;
  const items = [...menuRoot.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) => ({ el, rect: el.getBoundingClientRect() }));
  probe.run(menuRoot, items);
}
