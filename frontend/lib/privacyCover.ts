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
 * Should the cover be showing after `event`, given whether it is showing
 * now? Never on web or with the lock pref off. Leaving-signals raise it,
 * returning-signals drop it. Nothing here consults the lock screen: when
 * the lock overlay is already up the cover is simply redundant, and it is
 * removed again on the next returning-signal either way.
 */
export function coverAfterEvent(
  current: boolean,
  event: PrivacyCoverEvent,
  native: boolean,
  lockEnabled: boolean
): boolean {
  if (!native || !lockEnabled) return false;
  switch (event) {
    case "pause":
    case "inactive":
      return true;
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
