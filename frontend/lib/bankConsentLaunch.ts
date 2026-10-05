// A108: how the bank picker launches consent. Pure so it can be tested.
export type LaunchMode = "browser" | "rn" | "location";

/** Native Capacitor shell: in-app browser. RN WebView bridge: external browser
 * via postMessage. Otherwise (web) the full-page redirect. */
export function launchMode(isNative: boolean, hasRnBridge: boolean): LaunchMode {
  if (isNative) return "browser";
  if (hasRnBridge) return "rn";
  return "location";
}

/** The `native` flag sent on the link request: only the in-app browser flow. */
export function buildLinkQuery(native: boolean): { native: boolean } {
  return { native };
}
