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

// Guards `PushNotifications.createChannel()`, same reasoning as the listener
// guards above: `initCapacitorPush()` runs on every Settings toggle and on
// every app launch via `resyncCapacitorPush()`, so this must not fire twice.
// There is deliberately ONE channel (`money_updates`) for all push, not one
// per notification type. The app already exposes four granular notification
// preferences in its own Settings, and mirroring those as separate Android
// channels would create two competing control surfaces that can silently
// disagree, for example a user muting an Android channel while the in-app
// preference still reads as on. Also note that Android channels are
// immutable once created: after first creation the app cannot change the
// name, importance or visibility, only the user can from OS settings, so if
// these values ever need to change, that requires a new channel id to take
// effect on installs that already created this one.
let androidChannelCreated = false;

// Resolvers waiting on the next `pushNotificationReceived` event, drained by
// the listener in `initCapacitorPush()`. Backing `onPushReceivedOnce`, which
// the Settings test-push flow uses to confirm a push physically arrived,
// since Android never shows a system notification while the app is
// foregrounded, so a silent no-op and a delivered-but-invisible push would
// otherwise look identical to the user.
const pendingReceiveResolvers = new Set<(received: boolean) => void>();

// Resolvers waiting on the next `registration` event's token, drained by the
// same guarded listener that already exists in `initCapacitorPush()` below,
// mirrors `pendingReceiveResolvers` above. Backs the registration timeout:
// `PushNotifications.register()` resolves as soon as the OS call is made,
// not when a real token (or a registrationError) actually comes back, so
// without this a native bridge that silently drops the callback looks
// identical to a successful registration. Deliberately a second listener is
// NOT added per call, that would stack duplicate "registration" handlers
// exactly like `registrationListenerRegistered` exists to prevent.
const pendingTokenResolvers = new Set<(token: string | null) => void>();

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

export type PushInitResult = "granted" | "denied" | "unavailable" | "no-token";

// Event name for the "user tapped a delivered push notification" handoff
// from `deliverNotificationPath` below into the React tree (see
// `components/NotificationNavigator.tsx`). Exported so both sides reference
// the same string instead of each hardcoding its own copy that could
// silently drift apart.
export const NOTIFICATION_TAP_EVENT = "wd:notification-tap";

// Holds tapped notifications' target paths, in arrival order, from the
// moment each is ready to deliver until `NotificationNavigator` (mounted
// once, near the root, next to `NativePushResync` in layout.tsx) actually
// consumes them. This exists for one specific race: a tap can become ready
// to deliver before that component has mounted (a slow cold start can
// outrun React), in which case the `CustomEvent` dispatched below fires
// with nobody listening yet and would otherwise be lost. A real ARRAY, not
// a single slot: two taps can both queue up before mount (e.g. two pushes
// tapped in quick succession while the app is still cold-launching), and
// collapsing them to one slot would silently discard whichever arrived
// first. `NotificationNavigator` drains the whole queue on mount and
// navigates each in order, so the most recent tap is the one navigated
// last, i.e. it wins and ends up as the final on-screen destination, same
// as if each had been handled live one at a time.
const pendingNotificationPaths: string[] = [];

/**
 * Reads and clears every notification path queued by
 * `deliverNotificationPath` below, oldest first. Called once, from
 * `NotificationNavigator`'s mount effect.
 */
export function consumePendingNotificationPaths(): string[] {
  return pendingNotificationPaths.splice(0, pendingNotificationPaths.length);
}

/**
 * Hands a tapped notification's target path to the React app without ever
 * navigating before the app is actually interactive.
 *
 * Why not the old `window.location.href = path` directly: the
 * `pushNotificationActionPerformed` listener below can fire in two
 * situations a raw location assignment handles badly.
 *   - Cold start: Capacitor buffers the tap that launched the app and
 *     delivers it as soon as the listener is registered, which happens from
 *     `NativePushResync`'s mount effect, i.e. potentially while React is
 *     still hydrating. Assigning `location.href` mid-hydration tears down
 *     the half-booted app and reloads into a possibly-stale bundle/state.
 *   - Warm start: even once the app is running, a full `location.href`
 *     navigation inside a Next.js static export running in Capacitor forces
 *     a hard reload rather than a client-side route change. Combined with
 *     `BiometricLock` (which gates content on native), a hard reload can
 *     land on a freshly-remounted lock screen with stale/half-applied
 *     state, leaving the UI underneath unresponsive, which matches the
 *     reported "a lot of buttons were non responsive" symptom.
 *
 * Fix: never navigate until `document.readyState === "complete"` (waiting
 * for the `load` event if it hasn't fired yet), plus a short settle timeout
 * so any in-flight hydration work gets a tick to finish, then hand off via a
 * `CustomEvent` to `NotificationNavigator`, a small client component that
 * performs a soft SPA navigation with Next.js's `router.push()` instead of a
 * hard reload. This is deliberately simpler than routing through
 * `history.pushState` + `popstate`: App Router navigation isn't driven by
 * `popstate` for programmatic pushes, so `router.push()` in a component that
 * already has `useRouter()` is the direct path, no extra history plumbing
 * needed. `pendingNotificationPaths` above is the fallback for the case
 * where that component still hasn't mounted by the time this fires.
 */
function deliverNotificationPath(path: string): void {
  const dispatch = () => {
    pendingNotificationPaths.push(path);
    window.dispatchEvent(new CustomEvent(NOTIFICATION_TAP_EVENT, { detail: { path } }));
  };
  // `load` fires once resources are in, not once React has finished
  // hydrating, so this settle window is a pragmatic delay, not a guarantee.
  // Kept short deliberately: this is still the user's one tap, it should
  // land promptly once the app can actually handle it.
  const SETTLE_MS = 50;
  if (document.readyState === "complete") {
    setTimeout(dispatch, SETTLE_MS);
  } else {
    window.addEventListener("load", () => setTimeout(dispatch, SETTLE_MS), { once: true });
  }
}

/**
 * Serialises a non-string value for a diagnostic report. `JSON.stringify`
 * covers the common case (a plain object from a Capacitor plugin), falling
 * back to `String(value)` for anything it can't handle, for example a
 * circular reference or a bare Error instance's own quirks.
 */
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Reports a native push registration failure to the backend's
 * `/push/client-diagnostic` sink, so it lands in journalctl. A release
 * TestFlight build has no Safari Web Inspector, so `console.error` alone is
 * completely invisible there, this is the only way these failures have ever
 * been observable. Deliberately swallows its own errors (network failure,
 * 401, whatever), a broken diagnostic report must never become a second,
 * unrelated failure for the caller to handle.
 */
function reportPushDiagnostic(stage: string, detail: unknown, plat: string): void {
  const message = typeof detail === "string" ? detail : safeSerialize(detail);
  api.reportPushDiagnostic(stage, message, plat).catch(() => {
    /* best-effort, there is nothing more useful to do if the report itself fails */
  });
}

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
          reportPushDiagnostic("tokenPostFailed", e instanceof Error ? e.message : e, plat);
        });
        for (const resolve of pendingTokenResolvers) resolve(token.value);
        pendingTokenResolvers.clear();
      });
    }

    if (!registrationErrorListenerRegistered) {
      registrationErrorListenerRegistered = true;
      await PushNotifications.addListener("registrationError", (error) => {
        console.error("[capacitorPush] registration error", error.error);
        // This is the single most important diagnostic line in this file.
        // On iOS the "registrationError" event is almost certainly what has
        // been firing all along, silently, since no APNs token has ever
        // reached the backend, and console.error is invisible in a release
        // TestFlight build. Without this report there is no way to know why
        // registration failed at all.
        reportPushDiagnostic("registrationError", error?.error ?? error, platform());
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
        deliverNotificationPath(path);
      });
    }

    // Android only, iOS has no notification-channel concept and
    // `createChannel` does not exist on that platform, calling it there
    // would throw.
    if (platform() === "android" && !androidChannelCreated) {
      androidChannelCreated = true;
      try {
        await PushNotifications.createChannel({
          id: "money_updates",
          name: "Money updates",
          description: "Balance, bills, and spending alerts.",
          importance: 4, // IMPORTANCE_HIGH, lets a push show as a heads-up (banner) notification
          visibility: 0, // VISIBILITY_PRIVATE, shows on the lockscreen but hides the content until unlocked
          vibration: true,
        });
      } catch (e) {
        // A channel failure must never block registration, registration
        // working matters more than the channel. Worst case without it,
        // pushes still deliver, they just land on Capacitor's default
        // channel with no per-app control in Android settings.
        console.error("[capacitorPush] createChannel failed", e);
      }
    }

    // `register()` only resolves once the OS call has been *made*, not once
    // a real token (or failure) has come back, so calling it and returning
    // immediately made silence indistinguishable from success, exactly the
    // failure mode this whole diagnostic effort exists to fix. Wait for the
    // "registration" listener above to actually resolve with a token, up to
    // 10 seconds, before deciding this call succeeded.
    const tokenPromise = new Promise<string | null>((resolve) => {
      const onResolve = (token: string | null) => {
        pendingTokenResolvers.delete(onResolve);
        resolve(token);
      };
      pendingTokenResolvers.add(onResolve);
      setTimeout(() => onResolve(null), 10000);
    });

    await PushNotifications.register();
    const token = await tokenPromise;
    if (!token) {
      const plat = platform();
      reportPushDiagnostic(
        "registrationTimeout",
        `No push token arrived within 10s on platform=${plat}.`,
        plat,
      );
      return "no-token";
    }
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

export type CapacitorPushPermission = "granted" | "prompt" | "denied";

/**
 * Reads OS push permission without prompting or registering anything, a
 * pure status read, via the same dynamic-import pattern as the rest of this
 * file (keeps @capacitor/push-notifications out of the web bundle). Drives
 * the native Settings notifications UI (SettingsPage.tsx): whether to show
 * the quiet "delivered by your phone" status row, a "Turn on notifications"
 * prompt row, or the blocked message. Off native, or on any check failure,
 * reports "denied" since there is nothing to promote to prompt/granted.
 */
export async function getCapacitorPushPermission(): Promise<CapacitorPushPermission> {
  if (!isNative()) return "denied";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "granted";
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") return "prompt";
    return "denied";
  } catch {
    return "denied";
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
