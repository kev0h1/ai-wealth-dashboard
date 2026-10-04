"use client";

// TEMPORARY PREVIEW, G203 app-lock redesign round.
//
// Three hand-authored directions for the lock screen, drafted by
// openai/gpt-6-astra and rewritten to DESIGN.md (flat canvas, no gradient
// anywhere, no red, Figtree, 44px targets, focus ring, reduced motion).
// They share the production props interface (LockScreenViewProps in
// components/LockScreenView.tsx), so the picked one drops into that file's
// body. They are hand-authored while exploring: the baseline ("current" in
// the preview) renders the real production component.

import PennyMark from "@/components/PennyMark";
import type { BiometryKind, LockPlatform, LockScreenViewProps } from "@/components/LockScreenView";

/** The phrase a sentence can use, per platform and what the device offers. */
export function methodPhrase(platform: LockPlatform, biometry: BiometryKind): string {
  if (biometry === "none") return "your passcode";
  if (platform === "ios" && biometry === "faceId") return "Face ID";
  if (platform === "ios" && biometry === "touchId") return "Touch ID";
  if (platform === "android" && biometry === "fingerprint") return "your fingerprint";
  if (platform === "android" && biometry === "face") return "face unlock";
  return "your biometrics";
}

export function lockCopy(p: Pick<LockScreenViewProps, "platform" | "biometry" | "state" | "failure">) {
  const method = methodPhrase(p.platform, p.biometry);
  if (p.state === "prompting") {
    return { label: "Waiting", text: `Confirm with ${method} in the prompt.` };
  }
  if (p.state === "failed") {
    return p.failure === "timeout"
      ? { label: "Timed out", text: `Nothing came back from the prompt. Try ${method} again.` }
      : { label: "Not confirmed", text: `That wasn't confirmed. Try ${method} again.` };
  }
  return { label: "Locked", text: `Confirm it's you with ${method} to see your accounts.` };
}

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]";

const SHELL =
  "fixed inset-0 z-[999] flex flex-col overflow-y-auto bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 " +
  "pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-[calc(env(safe-area-inset-bottom,0px)+12px)] px-5";

function Actions({
  state,
  onUnlock,
  onSignOut,
  className = "",
}: Pick<LockScreenViewProps, "state" | "onUnlock" | "onSignOut"> & { className?: string }) {
  // The OS sheet is up: no buttons, exactly as shipped.
  if (state === "prompting") return null;
  return (
    <div className={`flex w-full flex-col gap-2 ${className}`}>
      <button
        type="button"
        onClick={onUnlock}
        className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-transform duration-150 hover:bg-indigo-700 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS}`}
      >
        {state === "failed" ? "Try again" : "Unlock"}
      </button>
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
  );
}

function BuildTag({ buildTag }: { buildTag: string }) {
  return (
    <p className="shrink-0 pt-6 text-center text-[10px] tracking-wide text-slate-400/80 dark:text-slate-500">
      {buildTag}
    </p>
  );
}

/** Calm waiting cue: a quiet dot that fades, still when motion is reduced. */
function WaitingDot() {
  return (
    <span aria-hidden="true" className="inline-block size-2 rounded-full bg-indigo-600 motion-safe:animate-pulse dark:bg-indigo-400" />
  );
}

function Status({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={`min-h-10 text-sm leading-5 text-slate-600 dark:text-slate-400 ${className}`}>
      {text}
    </div>
  );
}

/** A. Quiet door: centred, flat indigo tile carrying the Penny mark. */
export function LockA(props: LockScreenViewProps) {
  const copy = lockCopy(props);
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="lock-a-title" className={SHELL}>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center pt-[clamp(32px,12dvh,96px)] text-center">
        <div aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <PennyMark size={34} />
        </div>
        <h1 id="lock-a-title" className="mt-6 text-xl font-bold leading-7">
          Sorted is locked
        </h1>
        <Status text={copy.text} className="mt-2 max-w-[290px]" />
        {props.state === "prompting" && <div className="mt-4"><WaitingDot /></div>}
        <Actions state={props.state} onUnlock={props.onUnlock} onSignOut={props.onSignOut} className="mt-8" />
      </div>
      <BuildTag buildTag={props.buildTag} />
    </section>
  );
}

/** B. Open ledger: large ink mark, left-aligned stack, action in the thumb zone. */
export function LockB(props: LockScreenViewProps) {
  const copy = lockCopy(props);
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="lock-b-title" className={SHELL}>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="pt-[clamp(16px,6dvh,56px)]">
          <div aria-hidden="true" className="text-slate-900 dark:text-slate-100">
            <PennyMark size={88} />
          </div>
          <h1 id="lock-b-title" className="mt-6 text-xl font-bold leading-7">
            Sorted is locked
          </h1>
          <Status text={copy.text} className="mt-2 max-w-[300px]" />
          {props.state === "prompting" && <div className="mt-3"><WaitingDot /></div>}
        </div>
        <Actions state={props.state} onUnlock={props.onUnlock} onSignOut={props.onSignOut} className="mt-auto pt-8" />
      </div>
      <BuildTag buildTag={props.buildTag} />
    </section>
  );
}

/** C. Bounded checkpoint: one card on the canvas, state as a label chip. */
export function LockC(props: LockScreenViewProps) {
  const copy = lockCopy(props);
  return (
    <section role="dialog" aria-modal="true" aria-labelledby="lock-c-title" className={SHELL}>
      <div className="mx-auto w-full max-w-sm flex-1 pt-[clamp(16px,8dvh,72px)]">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="shrink-0 text-indigo-600 dark:text-indigo-400">
              <PennyMark size={32} />
            </div>
            <h1 id="lock-c-title" className="text-xl font-bold leading-7">
              Sorted is locked
            </h1>
          </div>
          <div className="mt-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase leading-4 tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              {props.state === "prompting" && <WaitingDot />}
              {props.state === "failed" && <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-amber-500" />}
              {copy.label}
            </span>
            <Status text={copy.text} className="mt-3" />
          </div>
          <Actions state={props.state} onUnlock={props.onUnlock} onSignOut={props.onSignOut} className="mt-6" />
        </div>
      </div>
      <BuildTag buildTag={props.buildTag} />
    </section>
  );
}
