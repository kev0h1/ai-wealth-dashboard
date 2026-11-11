import { Capacitor, registerPlugin } from "@capacitor/core";

interface SortedNotificationsPlugin {
  getStatus(): Promise<{ enabled: boolean; channelEnabled?: boolean }>;
  openSettings(): Promise<void>;
}

let bridge: SortedNotificationsPlugin | undefined;

export function hasNativeNotificationSettings(): boolean {
  try {
    if (!Capacitor.isNativePlatform()) return false;
    const headers = (Capacitor as unknown as { PluginHeaders?: Array<{ name: string }> }).PluginHeaders;
    // A133: never invoke a missing native plugin proxy, including a proxy
    // whose `then` method can starve the JS thread on older binaries.
    return Array.isArray(headers)
      ? headers.some(header => header.name === "SortedNotifications")
      : Capacitor.isPluginAvailable("SortedNotifications");
  } catch { return false; }
}

function notificationBridge() {
  if (!hasNativeNotificationSettings()) throw new Error("Notification settings bridge unavailable");
  bridge ??= registerPlugin<SortedNotificationsPlugin>("SortedNotifications");
  return bridge;
}

function bounded<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Notification settings timeout")), 6000);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

export async function readNativeNotificationSettings() {
  // Return the native result, never the plugin object itself from an async function.
  return bounded(notificationBridge().getStatus());
}

export async function openNativeNotificationSettings(): Promise<void> {
  await bounded(notificationBridge().openSettings());
}
