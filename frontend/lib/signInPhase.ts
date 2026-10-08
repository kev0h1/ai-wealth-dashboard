// G202: the one vocabulary for "a native sign-in is in flight". Pure, no
// imports, so scripts/mobile-login-loop.test.mjs can exercise it under node.
//
// LoginScreen owns the phase (set on the tap, cleared on every exit);
// AuthProvider only hands it a `resuming` signal for a login that outlived a
// process kill. Everything the screen says about a sign-in is derived from
// these types.

export type SignInAttempt = "google" | "apple" | "resume";
export type SignInStage = "provider" | "session";

export type LoginPhase =
  | { kind: "idle" }
  | { kind: "signing-in"; attempt: SignInAttempt; stage: SignInStage; startedAt: number }
  | { kind: "failed"; reason: "failed" | "timeout" }
  | { kind: "unreachable" };

export type SigningPhase = Extract<LoginPhase, { kind: "signing-in" }>;

// AuthProvider -> LoginScreen: a Google sign-in started before the app was
// killed or reloaded is still being awaited (lib/pendingLogin.ts startedAt),
// so the elapsed clock is the real one, not restarted at relaunch.
export interface ResumingLogin {
  startedAt: number;
  stage: SignInStage;
  // "unreachable" (A135): the session check could not reach the server; the
  // token is KEPT and the screen offers Try again.
  ended?: "failed" | "timeout" | "unreachable";
}

// From this point the copy owns up to a slow attempt.
export const SLOW_AFTER_MS = 20_000;

export function isSlow(startedAt: number, nowMs: number): boolean {
  return nowMs - startedAt >= SLOW_AFTER_MS;
}

export function providerName(a: SignInAttempt): string {
  return a === "apple" ? "Apple" : "Google";
}

export function signingCopy(p: SigningPhase, nowMs: number) {
  const slow = isSlow(p.startedAt, nowMs);
  const base =
    p.stage === "session"
      ? "Checking your session."
      : p.attempt === "resume"
        ? "Finishing the sign-in you started."
        : `Waiting for ${providerName(p.attempt)}.`;
  return {
    slow,
    title: slow ? "Still signing you in" : "Signing you in",
    line: slow ? `${base} This is taking longer than usual.` : base,
  };
}

export function failedCopy(reason: "failed" | "timeout") {
  return reason === "timeout"
    ? { title: "Sign-in took too long", line: "We did not hear back in time. Try again below." }
    : { title: "We could not sign you in", line: "The sign-in did not finish. Try again below." };
}

export const UNREACHABLE = {
  title: "Could not reach Sorted",
  line: "You are signed in on this device, but we could not reach Sorted. Your sign-in is kept, so you can try again.",
};

// What the screen shows, given LoginScreen's own phase and AuthProvider's
// resuming signal. Local phase always wins; the resume signal only fills in
// while nothing local is happening.
export function derivePhase(local: LoginPhase, resuming?: ResumingLogin | null): LoginPhase {
  if (local.kind !== "idle") return local;
  if (!resuming) return local;
  if (resuming.ended === "unreachable") return { kind: "unreachable" };
  if (resuming.ended) return { kind: "failed", reason: resuming.ended };
  return { kind: "signing-in", attempt: "resume", stage: resuming.stage, startedAt: resuming.startedAt };
}

// G202: run-id guard. Each sign-in attempt takes an id; a result that arrives
// for a cancelled or superseded attempt must not touch the phase.
export function createRunGuard() {
  let current = 0;
  return {
    next: () => ++current,
    cancel: () => { current++; },
    isCurrent: (id: number) => id === current,
  };
}
