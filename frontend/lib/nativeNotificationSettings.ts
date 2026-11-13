import { Capacitor, registerPlugin } from "@capacitor/core";

interface SortedNotificationsPlugin {
  getStatus(): Promise<{ enabled: boolean; channelEnabled?: boolean }>;
  openSettings(): Promise<void>;
}

let bridge: SortedNotificationsPlugin | undefined;

export function hasNativeNotificationSettings(capOverride?: unknown): boolean {
  try {
    const cap = (capOverride ?? Capacitor) as typeof Capacitor;
    if (!cap.isNativePlatform()) return false;
    const headers = (cap as unknown as { PluginHeaders?: Array<{ name: string }> }).PluginHeaders;
    // A133: never invoke a missing native plugin proxy, including a proxy
    // whose `then` method can starve the JS thread on older binaries.
    return Array.isArray(headers)
      ? headers.some(header => header.name === "SortedNotifications")
      : cap.isPluginAvailable("SortedNotifications");
  } catch { return false; }
}

// G466: on-device evidence for why the header check is false. Plugin names
// only, never the plugin proxy (A133), and never anything about the user.
let diagnosticSent = false;
type DiagnosticEnv = { cap: unknown; build: string; send: (stage: string, detail: string, platform: string) => unknown };
export function reportMissingNotificationBridge(env?: Partial<DiagnosticEnv>): void {
  try {
    const cap = (env?.cap ?? Capacitor) as {
      isNativePlatform?: () => boolean; getPlatform?: () => string; PluginHeaders?: Array<{ name?: string }>; registerPlugin?: unknown;
    };
    if (diagnosticSent || !cap.isNativePlatform?.() || cap.getPlatform?.() !== "ios" || hasNativeNotificationSettings(env?.cap)) return;
    diagnosticSent = true;
    const names = Array.isArray(cap.PluginHeaders) ? cap.PluginHeaders.map(h => String(h?.name)).sort() : null;
    const detail = `plugin_headers=${names ? `[${names.join(",")}]` : "absent"} platform=${cap.getPlatform?.()} app=${env?.build ?? process.env.NEXT_PUBLIC_BUILD_TAG ?? "unknown"} registerPlugin=${typeof cap.registerPlugin}`;
    const send = env?.send ?? ((stage, d, platform) => import("./api").then(m => m.api.reportPushDiagnostic(stage, d, platform)));
    void Promise.resolve(send("notification-bridge-missing", detail.slice(0, 480), "ios")).catch(() => { /* best effort */ });
  } catch { /* best effort */ }
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
