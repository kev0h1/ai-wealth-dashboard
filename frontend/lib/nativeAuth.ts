import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
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
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${API_BASE}/auth/mobile/poll?state=${encodeURIComponent(state)}`);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.status === "token" && d.token) {
        setToken(d.token);
        await Browser.close().catch(() => {});
        return true;
      }
      if (d.status === "error") {
        await Browser.close().catch(() => {});
        return false;
      }
    } catch {
      /* keep polling */
    }
  }
  return false;
}
