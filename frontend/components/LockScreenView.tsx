"use client";

import PennyMark from "@/components/PennyMark";
import { lockCopy, type LockScreenViewProps } from "@/lib/lockScreenCopy";

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
 * G203 fold-in: this renders Kevin's approved variant A, "Quiet door"
 * (2026-10-04): a centred flat indigo tile carrying the white Penny mark,
 * heading, status line and a full-width Unlock. No gradient chrome (the
 * indigo to violet gradient belongs to Penny alone). The sign-out escape
 * hatch renders under exactly the condition it always did: only in the
 * failed state (an attempt settled without unlocking), never while the OS
 * prompt is up. Do not harden that away, see BiometricLock's comment.
 */

export type { LockPlatform, LockState, BiometryKind, LockScreenViewProps } from "@/lib/lockScreenCopy";
export { biometryKindFromType, methodPhrase, lockCopy } from "@/lib/lockScreenCopy";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]";

export default function LockScreenView({ platform, biometry, state, failure, buildTag, onUnlock, onSignOut }: LockScreenViewProps) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[999] flex flex-col overflow-y-auto bg-[#f0f2f7] px-5 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-[calc(env(safe-area-inset-top,0px)+16px)] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100"
    >
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center pt-[clamp(32px,12dvh,96px)] text-center">
        <div aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <PennyMark size={34} />
        </div>
        <h1 id="lock-title" className="mt-6 text-xl font-bold leading-7">
          Sorted is locked
        </h1>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-2 min-h-10 max-w-[290px] text-balance text-sm leading-5 text-slate-600 dark:text-slate-400"
        >
          {lockCopy({ platform, biometry, state, failure })}
        </div>
        {state === "prompting" && (
          <div className="mt-4">
            <span aria-hidden="true" className="inline-block size-2 rounded-full bg-indigo-600 motion-safe:animate-pulse dark:bg-indigo-400" />
          </div>
        )}
        {/* The OS sheet is up: no buttons. */}
        {state !== "prompting" && (
          <div className="mt-8 flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={onUnlock}
              className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-transform duration-150 hover:bg-indigo-700 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS}`}
            >
              {state === "failed" ? "Try again" : "Unlock"}
            </button>
            {/* Only once an attempt has settled without unlocking, see
                BiometricLock's escape-hatch comment. */}
            {state === "failed" && (
              <button
                type="button"
                onClick={onSignOut}
                className={`min-h-11 w-full rounded-xl px-2 py-3 text-sm font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:bg-slate-200/60 active:opacity-70 dark:text-slate-200 dark:decoration-slate-600 dark:hover:bg-slate-800 ${FOCUS}`}
              >
                Sign out and use Google instead
              </button>
            )}
          </div>
        )}
      </div>
      {/* Whisper build tag, lets Kevin confirm from the phone itself which
          build is running. See lib/buildTag.ts. */}
      <p className="shrink-0 pt-6 text-center text-[10px] tracking-wide text-slate-400/80 dark:text-slate-500">{buildTag}</p>
    </section>
  );
}
