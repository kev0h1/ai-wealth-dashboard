import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { API_BASE } from "./api";
import { setToken } from "./auth";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function nativeGoogleLogin(): Promise<boolean> {
  const state = "m" + Math.random().toString(36).slice(2) + "_" + Date.now();
  await Browser.open({ url: `${API_BASE}/auth/google/mobile?state=${encodeURIComponent(state)}` });

  async function pollOnce(): Promise<"ok" | "err" | "pending"> {
    try {
      const res = await fetch(`${API_BASE}/auth/mobile/poll?state=${encodeURIComponent(state)}`);
      if (!res.ok) return "pending";
      const d = await res.json();
      if (d.status === "token" && d.token) {
        setToken(d.token);
        return "ok";
      }
      if (d.status === "error") {
        return "err";
      }
    } catch {
      /* keep polling */
    }
    return "pending";
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const listenerHandles: Array<{ remove: () => void }> = [];
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function finish(success: boolean) {
      if (settled) return;
      settled = true;
      if (intervalId !== undefined) clearInterval(intervalId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      for (const handle of listenerHandles) {
        try {
          handle.remove();
        } catch {
          /* ignore */
        }
      }
      await Browser.close().catch(() => {});
      resolve(success);
    }

    async function triggerPoll() {
      if (settled) return;
      const result = await pollOnce();
      if (result === "ok") await finish(true);
      else if (result === "err") await finish(false);
    }

    intervalId = setInterval(() => {
      void triggerPoll();
    }, 2000);

    timeoutId = setTimeout(() => {
      void finish(false);
    }, 5 * 60 * 1000);

    Promise.all([
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void triggerPoll();
      }),
      App.addListener("appUrlOpen", () => {
        void triggerPoll();
      }),
      Browser.addListener("browserFinished", () => {
        void triggerPoll();
      }),
    ]).then((handles) => {
      if (settled) {
        for (const handle of handles) {
          try {
            handle.remove();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      listenerHandles.push(...handles);
    });

    // Also do an immediate poll in case the token is already there.
    void triggerPoll();
  });
}
