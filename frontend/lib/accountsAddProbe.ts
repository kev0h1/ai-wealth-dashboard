// G478 TEMPORARY on-device probe. Kevin removes this after confirming the
// Accounts "+ Add" menu works on TestFlight. To remove: delete this file,
// lib/accountsAddProbeClient.ts, scripts/g478-accounts-add-layer.test.mjs and
// its package.json script, and the `runAddMenuProbe` effect in
// components/AccountsAddMenu.tsx.
//
// When the menu opens on a native iPhone, records what element is on top at
// each item's centre (tag, id, classes, data-attribute names: no text, no
// user data), the safe-area insets, the viewport and the build, and sends ONE
// report per launch to POST /push/client-diagnostic, stage accounts-add-probe.
// It runs on menu open, so it does not depend on a tap reaching a button.

export interface ProbeDeps {
  platform(): "ios" | "android" | null;
  build: string;
  insets(): { top: string; right: string; bottom: string; left: string };
  viewport(): { w: number; h: number; dpr: number };
  elementFromPoint(x: number, y: number): unknown;
  send(stage: string, detail: string, platform: "ios" | "android"): void;
}

export interface ProbeItem { rect: { left: number; top: number; width: number; height: number }; el: unknown }

interface ElLike {
  tagName?: string; id?: string; className?: unknown;
  getAttributeNames?: () => string[];
  closest?: (sel: string) => ElLike | null;
  parentElement?: ElLike | null;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function describeElement(node: unknown, menuItem: unknown, menuRoot: unknown): string {
  const el = node as ElLike | null;
  if (!el || !el.tagName) return "none";
  const cls = typeof el.className === "string" ? el.className : "";
  const attrs = (el.getAttributeNames?.() ?? []).filter((a) => a.startsWith("data-")).slice(0, 3).join("+");
  const where = node === menuItem ? "self" : (menuItem as { contains?: (n: unknown) => boolean } | null)?.contains?.(node) ? "inside" : (menuRoot as { contains?: (n: unknown) => boolean } | null)?.contains?.(node) ? "menu" : "OTHER";
  const parent = el.parentElement;
  const hint = el.closest?.("[data-tutorial-overlay],[data-add-control],[data-tutorial-id]");
  const hintAttr = hint ? (hint.getAttributeNames?.() ?? []).filter((a) => a.startsWith("data-")).slice(0, 1).join("") : "";
  return `${where}:${el.tagName.toLowerCase()}#${clip(el.id || "", 20)}.${clip(cls.trim().split(/\s+/).slice(0, 4).join("."), 60)}[${attrs}]^${parent?.tagName?.toLowerCase() ?? ""}~${hintAttr}`;
}

export function createAddProbe(deps: ProbeDeps) {
  let sent = false;
  return {
    hasSent: () => sent,
    /** Probes the open menu. Never throws; sends at most once per launch, native iOS only. */
    run(menuRoot: unknown, items: ProbeItem[]): boolean {
      if (sent) return false;
      try {
        if (deps.platform() !== "ios") return false;
        sent = true;
        const parts = items.slice(0, 5).map((it, i) => {
          const x = Math.round(it.rect.left + it.rect.width / 2);
          const y = Math.round(it.rect.top + it.rect.height / 2);
          return `i${i}@${x},${y}=${describeElement(deps.elementFromPoint(x, y), it.el, menuRoot)}`;
        });
        const ins = deps.insets();
        const vp = deps.viewport();
        const detail = clip(`insets=${ins.top}/${ins.right}/${ins.bottom}/${ins.left} vp=${vp.w}x${vp.h}@${vp.dpr} build=${deps.build} ${parts.join(" ")}`, 480);
        deps.send("accounts-add-probe", detail, "ios");
        return true;
      } catch {
        return false;
      }
    },
  };
}
