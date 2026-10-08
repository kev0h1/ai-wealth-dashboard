import { Capacitor, registerPlugin } from "@capacitor/core";
import { needsNativePrivacyBridge } from "@/lib/privacyCover";

// A122: thin bridge to the in-repo Android plugin
// (capacitor-spike/android-privacy/PrivacyScreenPlugin.java, installed into
// the generated android/ project by scripts/setup-android-privacy.sh).
// It toggles WindowManager.LayoutParams.FLAG_SECURE, which blanks the
// recents thumbnail and also blocks user screenshots/screen recording, so it
// is only ever switched on while the biometric lock preference is on.
// Registered with core's own registerPlugin, so no new npm dependency. On
// iOS, web, or an Android build without the plugin this is a silent no-op.
interface PrivacyScreenPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

let plugin: PrivacyScreenPlugin | null = null;

export function syncNativePrivacyScreen(enabled: boolean): void {
  try {
    if (!needsNativePrivacyBridge(Capacitor.isNativePlatform(), Capacitor.getPlatform())) return;
    plugin ??= registerPlugin<PrivacyScreenPlugin>("PrivacyScreen");
    plugin.setEnabled({ enabled }).catch((err: unknown) => {
      // Plugin not installed in this build: the web cover still applies, but
      // the recents thumbnail is NOT protected on Android, so say so loudly.
      const msg = String((err as { message?: string } | null)?.message ?? err);
      if (/not implemented|not available/i.test(msg)) {
        console.warn(
          "A122: PrivacyScreen plugin missing from this Android build, recents thumbnail is not protected. Run capacitor-spike/scripts/setup-android-privacy.sh (via setup-android-push.sh) and rebuild."
        );
      }
    });
  } catch {
    /* never let a privacy nicety break the lock */
  }
}
