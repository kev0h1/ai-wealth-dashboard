import { Capacitor } from "@capacitor/core";
import { api } from "./api";

// Last APNs/FCM token we registered with the backend, so `unregisterCapacitorPush`
// can tell the server which token to drop without re-reading it from the OS.
const TOKEN_STORAGE_KEY = "wd_apns_token";

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// "ios" | "android" | "web" — falls back to "ios" since that's the only
// platform this app ships today; keeps a future Android build from having
// its FCM tokens mis-reported as iOS if Capacitor.getPlatform() ever throws.
function platform(): string {
  try {
    return Capacitor.getPlatform() || "ios";
  } catch {
    return "ios";
  }
}

export type PushInitResult = "granted" | "denied" | "unavailable";

/**
 * Registers this device for native push notifications (APNs on iOS, FCM on
 * Android) via Capacitor. No-op off native platforms.
 *
 * Guarded + dynamically imported so the web build / static export never
 * touches @capacitor/push-notifications (it isn't proven SSR-safe).
 */
export async function initCapacitorPush(): Promise<PushInitResult> {
  if (!isNative()) return "unavailable";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") return "denied";

    await PushNotifications.addListener("registration", (token) => {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token.value);
      } catch {
        /* ignore */
      }
      api.registerApnsToken(token.value, platform()).catch((e) => {
        console.error("[capacitorPush] failed to send token to backend", e);
      });
    });

    await PushNotifications.addListener("registrationError", (error) => {
      console.error("[capacitorPush] registration error", error.error);
    });

    await PushNotifications.register();
    return "granted";
  } catch (e) {
    console.error("[capacitorPush] init failed", e);
    return "unavailable";
  }
}

/**
 * Tells the backend to drop this device's push token and unregisters the
 * device locally. No-op off native platforms.
 */
export async function unregisterCapacitorPush(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let token: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (token) {
      await api.unregisterApnsToken(token).catch(() => {});
      try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    await PushNotifications.unregister();
  } catch (e) {
    console.error("[capacitorPush] unregister failed", e);
  }
}

/**
 * Best-effort read of the OS-level notification permission, without
 * triggering a registration. Used to initialise the Settings toggle.
 */
export async function isCapacitorPushRegistered(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    return status.receive === "granted";
  } catch {
    return false;
  }
}
