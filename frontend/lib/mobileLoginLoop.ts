// A133: the poll/return loop behind nativeGoogleLogin, split out of
// nativeAuth.ts with its native bits injected so it can be unit tested in node
// (scripts/mobile-login-loop.test.mjs). No imports on purpose.
//
// Guarantees:
//   - polls are serialised: at most one pollOnce() in flight, so a token can
//     never be handed to setToken twice; a trigger that arrives mid-poll
//     schedules exactly one re-poll afterwards (the in-flight poll may have
//     been issued before the server stored the token).
//   - the in-app browser is closed as soon as the wealthdash://auth-done
//     deep link arrives, even while a poll is in flight or stuck.
//   - finish() always clears the interval, the overall timeout and the
//     listeners, and resolves even if Browser.close() never settles.

export type PollResult = "ok" | "invite_only" | "err" | "pending";
// G202: "timeout" (the overall bound) and "cancelled" (the caller's abort
// signal) are told apart from "failed" so the screen can say which.
export type LoginResult = "ok" | "invite_only" | "failed" | "timeout" | "cancelled";

export interface LoginLoopHandlers {
  onActive: () => void;
  onUrlOpen: (url?: string) => void;
  onBrowserFinished: () => void;
}

export interface LoginLoopDeps {
  pollOnce: () => Promise<PollResult>;
  closeBrowser: () => Promise<unknown>;
  addListeners: (h: LoginLoopHandlers) => Promise<Array<{ remove: () => unknown }>>;
  intervalMs?: number;
  timeoutMs?: number;
  closeTimeoutMs?: number;
}

const AUTH_RETURN_URL = /auth-(done|complete)/;

export function runMobileLoginLoop(deps: LoginLoopDeps, signal?: AbortSignal): Promise<LoginResult> {
  const intervalMs = deps.intervalMs ?? 2000;
  const timeoutMs = deps.timeoutMs ?? 5 * 60 * 1000;
  const closeTimeoutMs = deps.closeTimeoutMs ?? 1500;

  return new Promise<LoginResult>((resolve) => {
    let settled = false;
    let inFlight = false;
    let rerun = false;
    const handles: Array<{ remove: () => unknown }> = [];
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function removeAll(list: Array<{ remove: () => unknown }>) {
      for (const h of list) {
        try { void h.remove(); } catch { /* ignore */ }
      }
    }

    function closeBrowserNow(): Promise<void> {
      try {
        return Promise.resolve(deps.closeBrowser()).then(() => {}, () => {});
      } catch {
        return Promise.resolve();
      }
    }

    async function finish(result: LoginResult) {
      if (settled) return;
      settled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeAll(handles.splice(0));
      // Bounded: a Browser.close() that never settles must not strand the caller.
      await Promise.race([closeBrowserNow(), new Promise<void>((r) => setTimeout(r, closeTimeoutMs))]);
      resolve(result);
    }

    async function triggerPoll() {
      if (settled) return;
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      try {
        do {
          rerun = false;
          let result: PollResult = "pending";
          try { result = await deps.pollOnce(); } catch { result = "pending"; }
          if (settled) return;
          if (result === "ok") { await finish("ok"); return; }
          if (result === "invite_only") { await finish("invite_only"); return; }
          if (result === "err") { await finish("failed"); return; }
        } while (rerun && !settled);
      } finally {
        inFlight = false;
      }
    }

    intervalId = setInterval(() => { void triggerPoll(); }, intervalMs);
    timeoutId = setTimeout(() => { void finish("timeout"); }, timeoutMs);
    // G202: Cancel. Stops the interval and listeners and closes the sheet via
    // the same finish() path as every other exit.
    if (signal) {
      if (signal.aborted) void finish("cancelled");
      else signal.addEventListener("abort", () => { void finish("cancelled"); }, { once: true });
    }

    deps
      .addListeners({
        onActive: () => { void triggerPoll(); },
        onUrlOpen: (url) => {
          // Close the sheet right away; do not wait for (or depend on) a poll.
          // The global handler (lib/deepLinks.ts, A68) also closes the browser on
          // every wealthdash:// return; a second Browser.close() is harmless
          // because closeBrowserNow already tolerates a rejected close. This
          // listener stays because it owns the login promise.
          if (!settled && url !== undefined && AUTH_RETURN_URL.test(url)) void closeBrowserNow();
          void triggerPoll();
        },
        onBrowserFinished: () => { void triggerPoll(); },
      })
      .then((added) => {
        if (settled) removeAll(added);
        else handles.push(...added);
      })
      .catch(() => { /* listeners are an optimisation; the interval still polls */ });

    void triggerPoll();
  });
}
