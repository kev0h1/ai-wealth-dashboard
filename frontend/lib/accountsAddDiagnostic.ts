// G477: on-device diagnostic for the Accounts "+ Add" menu. A release
// TestFlight build has no Web Inspector, so when a tap opens nothing the only
// evidence is what the app itself reports. Same pattern as G466: one
// fire-and-forget report to POST /push/client-diagnostic, errors swallowed.
//
// Two triggers, ONE report per launch in total (module-level singleton):
//  - a tap on an add action whose sheet or flow is not on screen ~2s later;
//  - the bank access read still unresolved ~8s after the page mounted.
// The detail carries state names and the platform only: no user data, no
// tokens, no URLs. Nothing here touches a native plugin, so there is no proxy
// that could be returned from a promise (A133).

export type AddPath = "bank" | "statement" | "investment" | "offline";
export type AddAccessState = "loading" | "timeout" | "allowed" | "denied" | "error";

export interface AddSnapshot {
  access: AddAccessState;
  ready: boolean;
  allowed: boolean;
}

export interface AddDiagnosticDeps {
  /** "ios" | "android" on a native build, null on the web (nothing is reported). */
  platform(): "ios" | "android" | null;
  build: string;
  /** True when a dialog or sheet is on screen. */
  sheetOpen(): boolean;
  send(stage: string, detail: string, platform: "ios" | "android"): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const ADD_TAP_CHECK_MS = 2_000;
export const ADD_ACCESS_CHECK_MS = 8_000;

export function createAddDiagnostic(deps: AddDiagnosticDeps) {
  let sent = false;
  const timers = new Set<unknown>();

  function report(path: AddPath, reason: string, snap: AddSnapshot) {
    if (sent) return;
    let platform: "ios" | "android" | null = null;
    try { platform = deps.platform(); } catch { platform = null; }
    if (!platform) return;
    sent = true;
    try {
      deps.send(
        `accounts-add-${path}`,
        `reason=${reason} access=${snap.access} ready=${snap.ready} allowed=${snap.allowed} platform=${platform} build=${deps.build}`,
        platform,
      );
    } catch { /* best effort */ }
  }

  function arm(ms: number, fn: () => void) {
    let handle: unknown;
    handle = deps.setTimer(() => { timers.delete(handle); fn(); }, ms);
    timers.add(handle);
    return () => { timers.delete(handle); deps.clearTimer(handle); };
  }

  return {
    /** A tap on an add action. Reports if nothing opened within ~2s. */
    tapped(path: AddPath, getSnapshot: () => AddSnapshot): () => void {
      if (sent) return () => {};
      return arm(ADD_TAP_CHECK_MS, () => {
        if (!deps.sheetOpen()) report(path, "no-sheet-after-tap", getSnapshot());
      });
    },
    /** Starts the access watchdog. Reports if access is still loading (or has timed out) at ~8s. */
    watchAccess(getSnapshot: () => AddSnapshot): () => void {
      if (sent) return () => {};
      return arm(ADD_ACCESS_CHECK_MS, () => {
        const snap = getSnapshot();
        // Only a still-pending read (or one that hit its own timeout) is unresolved; a fast failure (offline) is not.
        if (snap.access === "loading" || snap.access === "timeout") report("bank", "access-unresolved", snap);
      });
    },
    /** Test and unmount hook: cancels any pending check. */
    dispose() {
      for (const t of timers) deps.clearTimer(t);
      timers.clear();
    },
    hasSent: () => sent,
  };
}
