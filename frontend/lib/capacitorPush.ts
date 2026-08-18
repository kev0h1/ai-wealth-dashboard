import { Capacitor } from "@capacitor/core";
import { api } from "./api";

// Last APNs/FCM token we registered with the backend, so `unregisterCapacitorPush`
// can tell the server which token to drop without re-reading it from the OS.
const TOKEN_STORAGE_KEY = "wd_push_token";

// Guards `pushNotificationActionPerformed` registration so calling
// `initCapacitorPush()` more than once (e.g. re-toggling the Settings switch)
// never stacks a second listener and double-navigates on a single tap.
let actionListenerRegistered = false;

// Resolves a push payload's `url` to a safe, app-relative path — mirrors
// `public/sw.js`'s `notificationclick` handler (`data.url || "/"`), plus a
// same-origin guard so a tampered/absolute-external url can never navigate
// the app off-domain.
function resolveNotificationPath(rawUrl: unknown): string {
  const url = typeof rawUrl === "string" && rawUrl.length > 0 ? rawUrl : "/";
  // App-relative ("/spend?view=list") — the common case sent by the backend
  // (see send_push_to_user/notify_new_transactions in backend/app/core/push.py).
  // Reject protocol-relative ("//evil.com") which browsers treat as absolute.
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    /* not a parseable URL — fall through to the safe default */
  }
  return "/";
}

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
      const plat = platform();
      const registration =
        plat === "android"
          ? api.registerFcmToken(token.value, plat)
          : api.registerApnsToken(token.value, plat);
      registration.catch((e) => {
        console.error("[capacitorPush] failed to send token to backend", e);
      });
    });

    await PushNotifications.addListener("registrationError", (error) => {
      console.error("[capacitorPush] registration error", error.error);
    });

    // Tapping a delivered notification (iOS: `notification.data.url` via
    // `request.content.userInfo` — the APNs payload's top-level `url` key
    // set by `send_apns_push` in backend/app/core/push.py; Android: same
    // `notification.data.url` path, populated from the FCM message's
    // `data.url` by `send_fcm_push`) should land on that url, not wherever
    // the app happened to be left.
    if (!actionListenerRegistered) {
      actionListenerRegistered = true;
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const path = resolveNotificationPath(action?.notification?.data?.url);
        window.location.href = path;
      });
    }

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
      const unregistration =
        platform() === "android"
          ? api.unregisterFcmToken(token)
          : api.unregisterApnsToken(token);
      await unregistration.catch(() => {});
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
