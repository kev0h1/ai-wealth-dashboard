// G203: the lock screen's pure types and copy, kept out of the .tsx so a
// plain-Node check can import them (scripts/lock-screen-view.test.mjs).
// components/LockScreenView.tsx re-exports everything here.

export type LockPlatform = "ios" | "android" | "web";
export type LockState = "idle" | "prompting" | "failed";
/** What the device can actually do, from the plugin's BiometryType. "unknown" means the hardware check has not resolved yet; "none" means passcode only. */
export type BiometryKind = "faceId" | "touchId" | "fingerprint" | "face" | "iris" | "none" | "unknown";

export interface LockScreenViewProps {
  platform: LockPlatform;
  biometry: BiometryKind;
  /** idle: waiting for the user; prompting: the OS sheet is up; failed: an attempt ended without unlocking. */
  state: LockState;
  /** The gate's own status text. Kept in the contract, no longer shown: the copy below is worded per biometry and failure. */
  errorMessage?: string | null;
  /** Only meaningful when state is "failed": why it failed. Defaults to "unconfirmed". */
  failure?: "unconfirmed" | "timeout";
  /** Whisper build tag (lib/buildTag.ts). */
  buildTag: string;
  onUnlock: () => void;
  onSignOut: () => void;
}

/** Pure mapping from the plugin's BiometryType enum value (see lib/biometrics.ts) to a kind. */
export function biometryKindFromType(type: number | undefined): BiometryKind {
  switch (type) {
    case undefined:
      return "unknown";
    case 1:
      return "touchId";
    case 2:
      return "faceId";
    case 3:
      return "fingerprint";
    case 4:
      return "face";
    case 5:
      return "iris";
    default:
      return "none";
  }
}

/** The phrase a sentence can use, per platform and what the device offers. Null while unknown. */
export function methodPhrase(platform: LockPlatform, biometry: BiometryKind): string | null {
  if (biometry === "unknown") return null;
  if (biometry === "none") return "your passcode";
  if (platform === "ios" && biometry === "faceId") return "Face ID";
  if (platform === "ios" && biometry === "touchId") return "Touch ID";
  if (platform === "android" && biometry === "fingerprint") return "your fingerprint";
  if (platform === "android" && biometry === "face") return "face unlock";
  return "your biometrics";
}

export function lockCopy(p: Pick<LockScreenViewProps, "platform" | "biometry" | "state" | "failure">): string {
  const method = methodPhrase(p.platform, p.biometry);
  if (p.state === "prompting") {
    return method ? `Confirm with ${method} in the prompt.` : "Confirm in the prompt.";
  }
  if (p.state === "failed") {
    const again = method ? `Try ${method} again.` : "Try again.";
    return p.failure === "timeout" ? `Nothing came back from the prompt. ${again}` : `That wasn't confirmed. ${again}`;
  }
  return method ? `Confirm it's you with ${method} to see your accounts.` : "Confirm it's you to see your accounts.";
}
