import { Capacitor } from "@capacitor/core";

// Persisted the same way as other local prefs (see PreferencesContext's
// "wd_dark" pattern) — read directly by BiometricLock before the app shell
// (and any API calls) mount, so it can't depend on a network round-trip.
export const LOCK_PREF_KEY = "wd_biometric_lock";

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isLockEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LOCK_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLockEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LOCK_PREF_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export interface BiometryAvailability {
  supported: boolean;
  /** Raw BiometryType enum value from the plugin (0 = none, 1 = touchId, 2 = faceId, ...). */
  biometryType?: number;
}

/**
 * Checks native biometric availability. Resolves to `{ supported: false }`
 * off native platforms without importing the plugin, so this is safe to call
 * unconditionally from web/SSR code paths too.
 */
export async function isAvailable(): Promise<BiometryAvailability> {
  if (!isNative()) return { supported: false };
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const result = await BiometricAuth.checkBiometry();
    return { supported: result.isAvailable, biometryType: result.biometryType };
  } catch {
    return { supported: false };
  }
}

/**
 * Prompts the OS biometric dialog (Face ID / Touch ID / fingerprint), with a
 * device-passcode fallback. Resolves `true` on success and `false` on any
 * failure or user cancellation — it never throws, so callers can treat it as
 * a simple boolean gate.
 */
export async function authenticate(reason = "Unlock Sorted"): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason,
      allowDeviceCredential: true,
      iosFallbackTitle: "Use Passcode",
    });
    return true;
  } catch {
    return false;
  }
}
