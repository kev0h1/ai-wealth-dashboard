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

// Sign in with Apple is only offered on iOS native builds — there's no
// Google-style cross-platform web fallback worth building for a single-user
// app, and Apple's own guidelines are for the native ASAuthorization flow
// on iOS specifically.
export function isIOSNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

// This app's Capacitor appId (see capacitor-spike/capacitor.config.json) —
// on iOS native, Sign in with Apple uses ASAuthorizationAppleIDProvider
// directly, so `clientId` here just needs to match the bundle id; it plays
// no OAuth-redirect role the way a web "Services ID" flow would.
const APPLE_CLIENT_ID = "co.uk.auriqltd.sorted";

export async function nativeAppleLogin(): Promise<boolean> {
  let identityToken: string | undefined;
  let fullName: string | undefined;

  try {
    // Dynamic import so a web build (which never calls this function,
    // gated by isIOSNative() at the call site) doesn't need the plugin's
    // native-only code paths resolved eagerly.
    const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
    const { response } = await SignInWithApple.authorize({
      clientId: APPLE_CLIENT_ID,
      // Unused by the native iOS flow (no redirect happens), but required
      // by the plugin's TypeScript signature.
      redirectURI: `${API_BASE}/auth/apple/native`,
      scopes: "email name",
    });
    identityToken = response.identityToken;
    // Apple only ever sends the name on the very first authorization for
    // this app + Apple ID pair — pass along whatever we got so the backend
    // can use it, and it'll fall back to the email local-part after that.
    fullName = [response.givenName, response.familyName].filter(Boolean).join(" ") || undefined;
  } catch {
    return false;
  }

  if (!identityToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/apple/native`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken, fullName }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.ok && data.session_token) {
      setToken(data.session_token);
      return true;
    }
    return false;
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
