"use client";

import { ShieldCheck, Fingerprint, LogOut } from "lucide-react";

/**
 * G203: the app-lock screen's PRESENTATION, extracted from
 * components/BiometricLock.tsx so a design round can swap the look without
 * touching the gate.
 *
 * Purely presentational. It owns no state, no timers, no listeners, makes no
 * request and never reads the lock signal: every behaviour (the gate, the
 * inert tracker, the request gate, the privacy cover, the cold-start and
 * resume timeouts, the unlock and sign-out actions) stays in BiometricLock.
 * It only receives what to show and two callbacks.
 *
 * This file currently renders the lock screen exactly as it shipped before
 * G203 (same markup, same classes, same copy), so extracting it changes no
 * pixels. The redesigned variants live under app/design/app-lock/ and take
 * this same props interface; the approved one replaces the body below.
 */

export type LockPlatform = "ios" | "android" | "web";
export type LockState = "idle" | "prompting" | "failed";
/** What the device can actually do, from the plugin's BiometryType. */
export type BiometryKind = "faceId" | "touchId" | "fingerprint" | "face" | "iris" | "none";

export interface LockScreenViewProps {
  platform: LockPlatform;
  biometry: BiometryKind;
  /** idle: waiting for the user; prompting: the OS sheet is up; failed: an attempt ended without unlocking. */
  state: LockState;
  /** Only meaningful when state is "failed". The gate's own status text, shown verbatim by the shipped layout. */
  errorMessage?: string | null;
  /** Only meaningful when state is "failed": why it failed, for layouts that word each case. */
  failure?: "unconfirmed" | "timeout";
  /** Whisper build tag (lib/buildTag.ts). */
  buildTag: string;
  onUnlock: () => void;
  onSignOut: () => void;
}

/** Pure mapping from the plugin's BiometryType enum value (see lib/biometrics.ts) to a kind. */
export function biometryKindFromType(type: number | undefined): BiometryKind {
  switch (type) {
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

export default function LockScreenView({
  state,
  errorMessage,
  buildTag,
  onUnlock,
  onSignOut,
}: LockScreenViewProps) {
  const awaitingAuth = state === "prompting";
  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gradient-to-b from-[#f0f2f7] to-[#e4e8f5] dark:from-[#0f172a] dark:to-[#131c33] px-6">
      <div className="w-20 h-20 rounded-3xl bg-indigo-500 shadow-xl flex items-center justify-center mb-6">
        <Fingerprint size={36} className="text-white" />
      </div>
      <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">Sorted is locked</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-8 max-w-xs">
        {errorMessage ?? "Confirm it's you to see your accounts."}
      </p>
      {!awaitingAuth && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onUnlock}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.97] text-sm font-semibold text-white transition-all shadow-md shadow-indigo-200 dark:shadow-none"
          >
            <ShieldCheck size={16} />
            {errorMessage ? "Try again" : "Unlock"}
          </button>
          {/* Always available once an attempt has settled without
              unlocking, see BiometricLock's escape-hatch comment. */}
          {errorMessage && (
            <button
              onClick={onSignOut}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <LogOut size={13} />
              Sign out and use Google instead
            </button>
          )}
        </div>
      )}
      {/* Whisper build tag, lets Kevin confirm from the phone itself which
          build is running. See lib/buildTag.ts. */}
      <p className="absolute bottom-6 text-[10px] text-slate-400/70 dark:text-slate-500/60 tracking-wide">
        {buildTag}
      </p>
    </div>
  );
}
