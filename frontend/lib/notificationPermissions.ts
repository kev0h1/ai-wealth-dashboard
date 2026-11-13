import { Capacitor } from "@capacitor/core";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { isAppLocked } from "@/lib/appLock";
import { awaitPushTokenPost, getCapacitorPushRegistration, initCapacitorPush, PUSH_REGISTRATION_EVENT } from "@/lib/capacitorPush";
import { hasNativeNotificationSettings, reportMissingNotificationBridge, openNativeNotificationSettings, readNativeNotificationSettings } from "@/lib/nativeNotificationSettings";
import type { NotificationDependencies, NotificationPlatform, NotificationReading } from "@/lib/notificationPermissionController";

const askedInMemory = new Set<string>();
const uncertainInMemory = new Set<string>();
const askedKey = (account: string) => `wd_notifications_asked:${account.toLowerCase()}`;
const uncertainKey = (account: string) => `wd_notifications_request_pending:${account.toLowerCase()}`;
const offKey = (account: string) => `wd_web_notifications_off:${account.toLowerCase()}`;
const pendingKey = (account: string) => `wd_web_push_pending:${account.toLowerCase()}`;

function stored(key: string): boolean { try { return localStorage.getItem(key) === "1"; } catch { return false; } }
function store(key: string, on: boolean) { try { if (on) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch {} }

export function noteBrowserPushRegistration(account: string, registered: boolean) {
  store(pendingKey(account), !registered);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_REGISTRATION_EVENT));
}

/** Re-upload an existing subscription after sign-in, without asking or
 * creating one. A saved browser opt-out always wins over this repair. */
export async function resyncWebPush(account: string): Promise<void> {
  const session = getToken();
  const current = () => !!session && getToken() === session && !isAppLocked();
  if (!current() || stored(offKey(account))) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription || !current() || stored(offKey(account))) return;
  noteBrowserPushRegistration(account, false);
  await api.subscribePush(subscription.toJSON());
  if (!current()) return;
  // An explicit opt-out can race the repair's network request. Remove its
  // late registration rather than silently restoring alerts afterwards.
  if (stored(offKey(account))) await api.unsubscribePush(subscription.endpoint);
  else noteBrowserPushRegistration(account, true);
}

function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Notification operation timed out")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export function notificationPlatform(): NotificationPlatform {
  try { const value = Capacitor.getPlatform(); return value === "ios" || value === "android" ? value : "web"; }
  catch { return "web"; }
}

function webUnavailable(): "install" | "browser" | null {
  if ("Notification" in window && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext) return null;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  return ios && !installed ? "install" : "browser";
}

async function serviceWorker() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active) return existing;
  // Auth/onboarding can precede ServiceWorkerRegistrar mounting.
  await navigator.serviceWorker.register("/sw.js");
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Service worker not ready")), 8000);
    navigator.serviceWorker.ready.then(registration => { clearTimeout(timer); resolve(registration); }, error => { clearTimeout(timer); reject(error); });
  });
}

export function notificationDependencies(account: string, session = getToken()): NotificationDependencies {
  const platform = notificationPlatform();
  const active = () => !!session && getToken() === session && !isAppLocked();
  const requireActive = () => { if (!active()) throw new Error("Notification session changed"); };

  return {
    active,
    wasAsked: () => askedInMemory.has(account.toLowerCase()) || stored(askedKey(account)),
    markAsked() {
      askedInMemory.add(account.toLowerCase()); store(askedKey(account), true);
      uncertainInMemory.add(account.toLowerCase()); store(uncertainKey(account), true);
    },
    requestOutcomeUnknown: () => uncertainInMemory.has(account.toLowerCase()) || stored(uncertainKey(account)),
    markRequestCompleted() { uncertainInMemory.delete(account.toLowerCase()); store(uncertainKey(account), false); },
    async read(): Promise<NotificationReading> {
      return deadline((async (): Promise<NotificationReading> => {
      requireActive();
      if (platform !== "web") {
        if (!hasNativeNotificationSettings()) { reportMissingNotificationBridge(); return { platform, permission: "unavailable", registration: "unknown", unavailable: "old-app" }; }
        const { PushNotifications } = await import("@capacitor/push-notifications");
        requireActive();
        const [settings, runtime] = await Promise.all([readNativeNotificationSettings(), PushNotifications.checkPermissions()]);
        requireActive();
        // Android <=12 always grants the runtime permission. The native
        // app/channel enabled checks remain the authority for actual display.
        const permission = settings.enabled && settings.channelEnabled !== false ? "granted" : runtime.receive === "prompt" ? "prompt" : "denied";
        const registration = permission === "granted" ? "checking" : "needed";
        requireActive();
        return { platform, permission, registration, unavailable: null };
      }
      const unavailable = webUnavailable();
      if (unavailable) return { platform, permission: "unavailable", registration: "unknown", unavailable };
      const permission = Notification.permission === "default" ? "prompt" : Notification.permission;
      if (permission !== "granted") return { platform, permission, registration: "needed", unavailable: null };
      const registration = await navigator.serviceWorker.getRegistration("/");
      requireActive();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      requireActive();
      return { platform, permission, registration: stored(offKey(account)) ? "off" : subscription && !stored(pendingKey(account)) ? "ready" : "needed", unavailable: null };
      })(), 8000);
    },
    checkRegistration: platform === "web" ? undefined : async () => {
      requireActive();
      const registration = await deadline(getCapacitorPushRegistration(), 8000);
      requireActive();
      return registration;
    },
    request() {
      requireActive();
      if (platform === "web") {
        // This call must execute in the original click stack.
        return Notification.requestPermission().then(permission => permission === "granted" ? "granted" : "denied");
      }
      return import("@capacitor/push-notifications").then(async ({ PushNotifications }) => {
        requireActive();
        const result = await PushNotifications.requestPermissions();
        return result.receive === "granted" ? "granted" : "denied";
      });
    },
    async register() {
      return deadline((async () => {
      requireActive();
      if (platform !== "web") {
        const result = await initCapacitorPush({ requestPermission: false });
        requireActive();
        if (result !== "granted") throw new Error("Native device registration incomplete");
        await awaitPushTokenPost();
        requireActive();
        if (await getCapacitorPushRegistration() !== "ready") throw new Error("Native token registration not confirmed");
        return;
      }
      if (Notification.permission !== "granted") throw new Error("Browser permission is not allowed");
      const { public_key } = await api.getVapidPublicKey();
      requireActive();
      const registration = await serviceWorker();
      requireActive();
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: public_key });
      requireActive();
      noteBrowserPushRegistration(account, false);
      await api.subscribePush(subscription.toJSON());
      requireActive();
      store(offKey(account), false);
      noteBrowserPushRegistration(account, true);
      })(), 25000);
    },
    async unsubscribe() {
      return deadline((async () => {
      requireActive();
      if (platform !== "web") return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      requireActive();
      const subscription = await registration?.pushManager.getSubscription();
      requireActive();
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint);
        requireActive();
        // The server has stopped delivery even if the browser subsequently
        // fails to remove its local subscription. Preserve that choice.
        store(offKey(account), true);
        if (!await subscription.unsubscribe()) throw new Error("Browser did not remove the subscription");
      }
      requireActive();
      store(offKey(account), true);
      })(), 20000);
    },
    async openSettings() { requireActive(); await openNativeNotificationSettings(); },
  };
}
