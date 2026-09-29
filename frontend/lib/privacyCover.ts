// A122 (pentest, LOW): the app-switcher / recents snapshot must not show
// live figures while the biometric lock is enabled.
//
// The pure decision half of the web-layer privacy cover, kept free of the
// DOM and Capacitor so scripts/privacy-cover.test.mjs can exercise it in
// the repo's plain-Node runner. components/BiometricLock.tsx is the only
// caller and owns the DOM side (an opaque node appended to document.body).
//
// The cover is a belt on top of the native mechanisms (Android FLAG_SECURE
// via the PrivacyScreen plugin, iOS overlay patched in by codemagic.yaml).
// It is the only mechanism on a build where those native pieces are
// absent, and it also covers the JS-visible half on Android.

/** Lifecycle signals that can change whether the cover is wanted. */
export type PrivacyCoverEvent =
  | "pause" // Capacitor App "pause" (didEnterBackground / onPause)
  | "resume" // Capacitor App "resume" (willEnterForeground / onResume)
  | "inactive" // appStateChange { isActive: false } (willResignActive) or document hidden
  | "active"; // appStateChange { isActive: true } or document visible

/**
 * Should the cover be showing after `event`? Never on web or with the lock
 * pref off. On Android, leaving-signals (pause, inactive) raise it. On iOS
 * only `pause` (didEnterBackground) raises it: `inactive` (willResignActive)
 * also fires when the Face ID sheet appears and would blank the lock screen
 * mid-prompt, and the native didEnterBackground overlay is the real iOS fix.
 * Returning-signals drop it everywhere. Switching the lock off while covered
 * drops it too.
 */
export function coverAfterEvent(
  current: boolean,
  event: PrivacyCoverEvent,
  native: boolean,
  lockEnabled: boolean,
  platform: string = "android"
): boolean {
  if (!native || !lockEnabled) return false;
  switch (event) {
    case "pause":
      return true;
    case "inactive":
      return platform === "ios" ? current : true;
    case "resume":
    case "active":
      return false;
    default:
      return current;
  }
}

/** Only Android needs the native FLAG_SECURE bridge; iOS is patched in CI. */
export function needsNativePrivacyBridge(native: boolean, platform: string): boolean {
  return native && platform === "android";
}
