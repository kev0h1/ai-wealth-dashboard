// The single native deep-link contract (A68). Mirrors ../shared/deep-links.json
// and backend/app/core/deep_links.py. The two path segments are frozen: installed
// app binaries bundle older client code whose appUrlOpen regex matches
// /auth-(done|complete)/, so new information goes in query parameters only.

export const DEEP_LINK_SCHEME = "wealthdash";
export const SIGNIN_PATH = "auth-done";
export const BANK_CONNECTED_PATH = "auth-complete";
export const QUERY_PROVIDER = "provider";
export const QUERY_CONNECTION = "connection";
export const QUERY_STATUS = "status";

export const DEEP_LINK_EVENT = "wd:deeplink";

export type DeepLinkKind = "signin" | "bank_connected" | "unknown";

export interface DeepLinkDetail {
  kind: DeepLinkKind;
  provider?: string;
  connection?: string;
  status?: "ok" | "error";
}

const UNKNOWN: DeepLinkDetail = { kind: "unknown" };

/** Tolerant parse: scheme case, extra/missing slashes and a trailing slash are
 * all accepted; anything that is not our scheme with a known path is "unknown". */
export function parseDeepLink(url: string): DeepLinkDetail {
  if (typeof url !== "string") return UNKNOWN;
  const m = /^([a-z][a-z0-9+.-]*):\/{0,3}([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!m || m[1].toLowerCase() !== DEEP_LINK_SCHEME) return UNKNOWN;
  const path = m[2].replace(/^\/+|\/+$/g, "").toLowerCase();
  if (path === SIGNIN_PATH) return { kind: "signin" };
  if (path !== BANK_CONNECTED_PATH) return UNKNOWN;
  const q = new URLSearchParams(m[3] ?? "");
  const detail: DeepLinkDetail = { kind: "bank_connected" };
  const provider = q.get(QUERY_PROVIDER);
  const connection = q.get(QUERY_CONNECTION);
  const status = q.get(QUERY_STATUS);
  if (provider) detail.provider = provider;
  if (connection) detail.connection = connection;
  if (status === "ok" || status === "error") detail.status = status;
  return detail;
}

async function closeBrowserBestEffort(): Promise<void> {
  // A139: destructure the plugin and call it here. Never `return Browser` (or
  // anything that resolves to the Capacitor plugin proxy) from an async
  // function: the proxy is thenable-shaped, so the promise machinery calls
  // .then on it and it rejects as "not implemented".
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    // Already closed, not open, or not native: nothing to do.
  }
}

/** Parse a returned URL and, when it is ours, announce it to the app and close
 * the in-app browser. Returns the parsed detail. */
export function dispatchDeepLink(
  url: string,
  target: Pick<EventTarget, "dispatchEvent"> | undefined = typeof window === "undefined" ? undefined : window,
  closeBrowser: () => Promise<void> = closeBrowserBestEffort,
): DeepLinkDetail {
  const detail = parseDeepLink(url);
  if (detail.kind === "unknown") return detail;
  target?.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail }));
  void closeBrowser().catch(() => {});
  return detail;
}

let registered = false;

/** Register once, native only. Returns a remove function. */
export function registerDeepLinkHandler(): () => void {
  if (registered || typeof window === "undefined") return () => {};
  registered = true;
  let removed = false;
  let handle: { remove: () => Promise<void> } | undefined;
  void (async () => {
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) {
        registered = false;
        return;
      }
      const { App } = await import("@capacitor/app");
      const h = await App.addListener("appUrlOpen", ({ url }) => { dispatchDeepLink(url); });
      if (removed) { void h.remove(); return; }
      handle = h;
      // Cold start: the app was launched by the return URL itself.
      const launch = await App.getLaunchUrl();
      if (launch?.url) dispatchDeepLink(launch.url);
    } catch {
      registered = false;
    }
  })();
  return () => {
    removed = true;
    registered = false;
    if (handle) void handle.remove().catch(() => {});
  };
}
