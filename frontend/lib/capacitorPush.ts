import { Capacitor } from "@capacitor/core";
import { api } from "./api";
import { getToken } from "./auth";

// Last APNs/FCM token we registered with the backend, so `unregisterCapacitorPush`
// can tell the server which token to drop without re-reading it from the OS.
const TOKEN_STORAGE_KEY = "wd_push_token";

// Guards `pushNotificationActionPerformed` registration so calling
// `initCapacitorPush()` more than once (e.g. re-toggling the Settings switch)
// never stacks a second listener and double-navigates on a single tap.
let actionListenerRegistered = false;

// Same stacking guard as `actionListenerRegistered`, one per listener type.
// `initCapacitorPush()` is now called both from the Settings toggle AND
// (via `resyncCapacitorPush`) from app launch, so every listener it adds
// must be idempotent across repeat calls, not just the action one.
let registrationListenerRegistered = false;
let registrationErrorListenerRegistered = false;
let receivedListenerRegistered = false;

// Resolvers waiting on the next `pushNotificationReceived` event, drained by
// the listener in `initCapacitorPush()`. Backing `onPushReceivedOnce`, which
// the Settings test-push flow uses to confirm a push physically arrived,
// since Android never shows a system notification while the app is
// foregrounded, so a silent no-op and a delivered-but-invisible push would
// otherwise look identical to the user.
const pendingReceiveResolvers = new Set<(received: boolean) => void>();

// Guards `resyncCapacitorPush()`. `resyncInFlight` stops two overlapping
// calls from both running the async work. `resyncCompleted` is set ONLY
// after `initCapacitorPush()` has actually been awaited without throwing
// earlier in the try block (a native-bridge exception from
// checkPermissions(), or a failed dynamic import). A throw must leave
// `resyncCompleted` false so a later call in the same session can retry,
// collapsing this into a single "ran once" flag would permanently disable
// self-heal for exactly the case it exists for, a flaky bridge. Do not
// simplify this back to one boolean.
let resyncCompleted = false;
let resyncInFlight = false;

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

    if (!registrationListenerRegistered) {
      registrationListenerRegistered = true;
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
    }

    if (!registrationErrorListenerRegistered) {
      registrationErrorListenerRegistered = true;
      await PushNotifications.addListener("registrationError", (error) => {
        console.error("[capacitorPush] registration error", error.error);
      });
    }

    // Android never surfaces a system notification for a push received
    // while the app is foregrounded, it only fires this event, so this is
    // the only signal available to confirm a test push actually arrived
    // (see `onPushReceivedOnce`, consumed by the Settings test-push flow).
    if (!receivedListenerRegistered) {
      receivedListenerRegistered = true;
      await PushNotifications.addListener("pushNotificationReceived", () => {
        for (const resolve of pendingReceiveResolvers) resolve(true);
        pendingReceiveResolvers.clear();
      });
    }

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
 * Whether this device is actually registered for push with the backend,
 * not merely whether the OS granted permission. On Android the
 * POST_NOTIFICATIONS grant persists for the package across reinstalls and
 * logouts, so reading permission alone renders the Settings toggle already
 * on while zero tokens have ever reached the backend, the user never taps
 * it, and `initCapacitorPush()` never runs. This checks OS permission,
 * a locally stored token, and finally asks the backend to confirm it still
 * holds that token.
 */
export async function isCapacitorPushRegistered(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") return false;

    let storedToken: string | null = null;
    try {
      storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (!storedToken) return false;

    try {
      const result = await api.getNativePushStatus(storedToken);
      return result.registered;
    } catch {
      // A flaky network here must not flip the toggle off, since that would
      // trick the user into tapping it, which takes the unregister branch
      // and turns push off for a device that is probably still registered.
      // Permission granted plus a locally stored token is the best evidence
      // we have offline, so we trust it until a real backend answer says
      // otherwise.
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Self-heals two drift cases without ever prompting for permission: an FCM
 * token that rotated silently, and a token whose registration POST failed
 * the first time (e.g. the app was launched offline). Safe to call on every
 * app load, since it only re-registers when permission is already granted
 * and a session exists, both of which mean the device was already opted in
 * by a deliberate Settings action, not this call.
 */
export async function resyncCapacitorPush(): Promise<void> {
  if (resyncCompleted || resyncInFlight) return;
  if (!isNative()) return;
  if (!getToken()) return; // no session yet, the register POST would just 401
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    // Never trigger the OS permission prompt from a background resync; that
    // must stay a deliberate tap on the Settings toggle. A not-yet-granted
    // permission is a legitimate no-op, not a failure, so it must not mark
    // this resync as in-flight or completed, a later call this session
    // (e.g. after the user grants it via the Settings toggle) stays free
    // to do the real work.
    if (status.receive !== "granted") return;
    resyncInFlight = true;
    await initCapacitorPush();
    resyncCompleted = true;
  } catch {
    /* best-effort, a failed resync just leaves the existing token in place */
  } finally {
    resyncInFlight = false;
  }
}

/**
 * Resolves true if a `pushNotificationReceived` event fires within
 * `timeoutMs`, false on timeout. Used by the Settings test-push flow to
 * confirm a push physically reached this device, since Capacitor's Android
 * plugin never shows a system notification while the app is foregrounded.
 */
export function onPushReceivedOnce(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onResolve = (received: boolean) => {
      pendingReceiveResolvers.delete(onResolve);
      resolve(received);
    };
    pendingReceiveResolvers.add(onResolve);
    setTimeout(() => onResolve(false), timeoutMs);
  });
}
