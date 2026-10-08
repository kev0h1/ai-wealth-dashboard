// A149: undo a bank hand-off the user walked away from. Pressing Back on
// Finexer's or the bank's page (bfcache restore), closing the in-app browser
// with its X, or an iPhone swipe back all return to the sheet with the chosen
// bank still "connecting". Nothing completed, so this is treated exactly like
// Cancel: the connecting state clears, the A108 pending stash is dropped, and
// no error is shown. A genuine completed consent (the wd:deeplink bank_connected
// event from A68/A108) always wins: it marks the attempt complete, and every
// abandon trigger other than a bfcache restore waits a short grace window so a
// deep link arriving just after the app becomes visible is not raced.
import { PENDING_BANK_RETURN_KEY } from "./bankConnectReturn";

export const BANK_ATTEMPT_KEY = "wd_bank_attempt";
export const BANK_RETURN_GRACE_MS = 1500;

type Listener = (e?: unknown) => void;
interface Target {
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
}
export interface BankReturnEnv {
  win: Target;
  doc: Target & { visibilityState?: string };
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Subscribe to the native in-app browser closing; returns an unsubscribe. */
  onBrowserFinished?: (fn: () => void) => () => void;
  graceMs?: number;
  /** Fired when an attempt is abandoned; the owner clears its connecting state. */
  onReset: () => void;
}

export interface BankReturnGuard {
  /** Call when the hand-off starts. Returns the new attempt id. */
  begin(): number;
  /** Call when the hand-off failed to start (the owner already cleared its state). */
  end(): void;
  /** Call when a completed consent return was processed. */
  complete(): void;
  activeAttempt(): number | null;
  detach(): void;
}

export function attachBankReturnReset(env: BankReturnEnv): BankReturnGuard {
  const grace = env.graceMs ?? BANK_RETURN_GRACE_MS;
  let counter = 0;
  let active: number | null = null;
  let left = false;
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };
  const clearAttemptKey = () => { try { env.storage?.removeItem(BANK_ATTEMPT_KEY); } catch {} };

  function abandon() {
    if (active === null) return;
    cancelTimer();
    active = null;
    left = false;
    clearAttemptKey();
    try { env.storage?.removeItem(PENDING_BANK_RETURN_KEY); } catch {}
    env.onReset();
  }
  function abandonAfterGrace() {
    if (active === null) return;
    const id = active;
    cancelTimer();
    timer = env.setTimeout(() => {
      timer = null;
      if (active === id) abandon();
    }, grace);
  }

  // A remount after Back (no bfcache) finds a stale attempt key with no live attempt.
  try { if (env.storage?.getItem(BANK_ATTEMPT_KEY)) env.storage.removeItem(BANK_ATTEMPT_KEY); } catch {}

  const onPageShow: Listener = (e) => { if ((e as { persisted?: boolean } | undefined)?.persisted) abandon(); };
  const onVisibility: Listener = () => {
    if (active === null) return;
    if (env.doc.visibilityState === "hidden") { left = true; return; }
    if (left) abandonAfterGrace();
  };
  const onBlur: Listener = () => { if (active !== null) left = true; };
  const onFocus: Listener = () => { if (active !== null && left) abandonAfterGrace(); };
  const onPopState: Listener = () => abandonAfterGrace();
  const onDeepLink: Listener = (e) => {
    const d = (e as { detail?: { kind?: string } } | undefined)?.detail;
    if (d?.kind === "bank_connected") guard.complete();
  };

  env.win.addEventListener("pageshow", onPageShow);
  env.win.addEventListener("blur", onBlur);
  env.win.addEventListener("focus", onFocus);
  env.win.addEventListener("popstate", onPopState);
  env.win.addEventListener("wd:deeplink", onDeepLink);
  env.doc.addEventListener("visibilitychange", onVisibility);
  const offBrowser = env.onBrowserFinished?.(abandonAfterGrace);

  const guard: BankReturnGuard = {
    begin() {
      cancelTimer();
      counter += 1;
      active = counter;
      left = false;
      try { env.storage?.setItem(BANK_ATTEMPT_KEY, String(active)); } catch {}
      return active;
    },
    end() { cancelTimer(); active = null; left = false; clearAttemptKey(); },
    complete() { cancelTimer(); active = null; left = false; clearAttemptKey(); },
    activeAttempt: () => active,
    detach() {
      cancelTimer();
      env.win.removeEventListener("pageshow", onPageShow);
      env.win.removeEventListener("blur", onBlur);
      env.win.removeEventListener("focus", onFocus);
      env.win.removeEventListener("popstate", onPopState);
      env.win.removeEventListener("wd:deeplink", onDeepLink);
      env.doc.removeEventListener("visibilitychange", onVisibility);
      offBrowser?.();
    },
  };
  return guard;
}
