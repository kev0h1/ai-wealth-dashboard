"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { isNativePlatform, isIOSNative, nativeGoogleLogin, nativeAppleLogin, cancelNativeLogin, getRelayClaim, clearRelayClaim, sendRelayClaimCode, verifyRelayClaimCode } from "@/lib/nativeAuth";
import { BUILD_TAG } from "@/lib/buildTag";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";
import { createRunGuard, derivePhase, type LoginPhase, type ResumingLogin } from "@/lib/signInPhase";
import RelayClaimScreen from "@/components/RelayClaimScreen";
import { FailedNotice, SigningInPanel, UnreachablePanel } from "@/components/SignInProgress";

export type { LoginPhase, ResumingLogin } from "@/lib/signInPhase";

interface LoginScreenProps {
  error?: string | null;
  // A135: AuthProvider's in-place session establishment. When given, a native
  // sign-in transitions without a page reload (a reload discards a token that
  // only lives in memory). Hosts without it (oauth consent, app-only shell)
  // keep the reload. G202: the signal aborts the session check on Cancel.
  onSignedIn?: (signal?: AbortSignal, fresh?: boolean) => Promise<"ok" | "rejected" | "unreachable">;
  // G202: AuthProvider's signal that a Google sign-in started before a process
  // kill or reload is still being awaited. Its startedAt is the persisted
  // pending login's, so the elapsed clock is the real one.
  resuming?: ResumingLogin | null;
  // Cancel pressed while `resuming`: AuthProvider drops its resume signal.
  // `discardSession` is true only for an explicit "Use a different account".
  onCancelResume?: (discardSession?: boolean) => void;
  // Preview only (/design/signin-loading): drive the phase and a fake clock
  // from outside. Production passes neither, LoginScreen owns the phase.
  phase?: LoginPhase;
  nowMs?: number;
}

export default function LoginScreen({ error, onSignedIn, resuming, onCancelResume, phase: phaseOverride, nowMs }: LoginScreenProps) {
  // Starts false on both server and client so hydration matches (Capacitor
  // doesn't exist during the export build), then flips true post-mount if
  // we're actually running inside the iOS native shell.
  const [showApple, setShowApple] = useState(false);
  useEffect(() => {
    setShowApple(isIOSNative());
  }, []);

  // D5: the native sign-in flows resolve their own "invite_only" outcome
  // (see lib/nativeAuth.ts) independently of the `error` query-param prop
  // (which only the web OAuth redirect sets), so this is tracked locally
  // and OR'd with the prop below.
  const [nativeInviteOnly, setNativeInviteOnly] = useState(false);
  // "Try another account" doesn't navigate anywhere — it just returns to
  // the normal sign-in buttons so a different account can be tried,
  // clearing whichever of the two sources (prop or local) set it.
  const [inviteOnlyDismissed, setInviteOnlyDismissed] = useState(false);
  // D9: a refused Hide My Email sign-in lands on the claim screen, not a
  // dead end. Holds the prompt the backend sent; the claim token itself
  // stays in lib/nativeAuth.
  const [relayClaimPrompt, setRelayClaimPrompt] = useState<string | null>(null);

  // G202: the single phase source for a native sign-in. `startedAt` is set on
  // the Google/Apple tap and the phase returns to "idle" on every exit (ok,
  // rejected, unreachable, cancel, failure, timeout). Failed and unreachable
  // are phases too, so the screen never falls back to a bare form with no
  // explanation (and the retry no longer flashes the form).
  const [local, setLocal] = useState<LoginPhase>({ kind: "idle" });
  // Remounts the failed notice so a repeat failure re-announces and refocuses.
  const [noticeSeq, setNoticeSeq] = useState(0);
  // Each attempt gets a run id; a result for a cancelled or superseded run is
  // ignored. The controller aborts an in-flight session check on Cancel.
  const runRef = useRef(createRunGuard());
  const sessionAbortRef = useRef<AbortController | null>(null);
  const lastAttemptRef = useRef<"google" | "apple">("google");
  // D13: true once the user themselves started a Google/Apple attempt. A retry of
  // AuthProvider's cold-start session check (stored token, `resuming`) is not a
  // fresh sign-in and must not move the user to Home.
  const userAttemptRef = useRef(false);
  const phase = phaseOverride ?? derivePhase(local, resuming);

  function fail(reason: "failed" | "timeout") {
    setNoticeSeq((n) => n + 1);
    setLocal({ kind: "failed", reason });
  }

  async function establish(run: number, attempt: "google" | "apple", startedAt: number) {
    if (!onSignedIn) {
      window.location.reload();
      return;
    }
    setLocal({ kind: "signing-in", attempt, stage: "session", startedAt });
    const ctrl = new AbortController();
    sessionAbortRef.current = ctrl;
    let outcome: "ok" | "rejected" | "unreachable";
    try {
      outcome = await onSignedIn(ctrl.signal, userAttemptRef.current);
    } finally {
      if (sessionAbortRef.current === ctrl) sessionAbortRef.current = null;
    }
    if (!runRef.current.isCurrent(run)) return; // cancelled while checking
    if (outcome === "unreachable") setLocal({ kind: "unreachable" }); // token kept; tap retries
    else if (outcome === "rejected") fail("failed");
    // "ok": AuthProvider has set the user and replaces this screen.
  }

  async function runNative(attempt: "google" | "apple") {
    const run = runRef.current.next();
    const startedAt = Date.now();
    lastAttemptRef.current = attempt;
    userAttemptRef.current = true;
    setLocal({ kind: "signing-in", attempt, stage: "provider", startedAt });
    const result = attempt === "google" ? await nativeGoogleLogin() : await nativeAppleLogin();
    if (!runRef.current.isCurrent(run)) return; // cancelled
    if (result === "ok") await establish(run, attempt, startedAt);
    else if (result === "relay_claim") {
      setRelayClaimPrompt(getRelayClaim()?.prompt ?? "");
      setLocal({ kind: "idle" });
    } else if (result === "invite_only") {
      setNativeInviteOnly(true);
      setLocal({ kind: "idle" });
    } else if (result === "cancelled") setLocal({ kind: "idle" });
    else fail(result === "timeout" ? "timeout" : "failed");
  }

  function retrySessionCheck() {
    const run = runRef.current.next();
    void establish(run, lastAttemptRef.current, Date.now());
  }

  // Cancel: stop the loop (or the Apple exchange), clear the pending login,
  // abort the session check, and return to the idle form.
  function cancelSignIn() {
    runRef.current.cancel();
    sessionAbortRef.current?.abort();
    cancelNativeLogin();
    userAttemptRef.current = false;
    setLocal({ kind: "idle" });
    onCancelResume?.();
  }

  function dismissPhase() {
    // "Use a different account" on the unreachable panel.
    userAttemptRef.current = false;
    runRef.current.cancel();
    setLocal({ kind: "idle" });
    onCancelResume?.(true); // A135: the user chose another account, so drop the kept token
  }

  async function handleGoogleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!isNativePlatform()) return; // web: let the href redirect happen as before
    e.preventDefault();
    await runNative("google");
  }

  async function handleAppleClick() {
    await runNative("apple");
  }

  if (relayClaimPrompt !== null) {
    return (
      <RelayClaimScreen
        prompt={relayClaimPrompt}
        onSend={sendRelayClaimCode}
        onVerify={verifyRelayClaimCode}
        onVerified={() => {
          setRelayClaimPrompt(null);
          lastAttemptRef.current = "apple";
          userAttemptRef.current = true;
          void establish(runRef.current.next(), "apple", Date.now());
        }}
        onBack={() => {
          clearRelayClaim();
          setRelayClaimPrompt(null);
        }}
      />
    );
  }

  const isInviteOnly = (error === "invite_only" || nativeInviteOnly) && !inviteOnlyDismissed;

  if (isInviteOnly) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mb-5 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="Sorted" width={64} height={64} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mb-3">
            Sorted is invite-only right now
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-8">
            We are letting people in gradually. If you were expecting access, check the address you signed in with or ask the person who invited you.
          </p>
          <button
            type="button"
            onClick={() => {
              setInviteOnlyDismissed(true);
              setNativeInviteOnly(false);
            }}
            className="w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 active:scale-95 transition font-medium text-slate-700 dark:text-slate-100 text-sm shadow-sm"
          >
            Try another account
          </button>
        </div>
      </div>
    );
  }

  const slotted = phase.kind === "signing-in" || phase.kind === "unreachable";

  const signInButtons = (
    <>
          <a
            href={`${API_BASE}/auth/google`}
            onClick={handleGoogleClick}
            className="flex items-center justify-center gap-3 w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 active:scale-95 transition font-medium text-slate-700 dark:text-slate-100 text-sm shadow-sm"
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.3 6.5v5.4h7c4.1-3.8 6.6-9.4 6.6-15.9z"/>
              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7-5.4c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.6C7.9 41.2 15.4 46 24 46z"/>
              <path fill="#FBBC05" d="M11.6 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-3 .7-4.3v-5.6H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.9l7.3-5.6z"/>
              <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 7.9 6.8 4.3 14.1l7.3 5.6c1.7-5.2 6.6-9 12.4-9z"/>
            </svg>
            Continue with Google
          </a>

          {showApple && (
            <button
              onClick={handleAppleClick}
              className="mt-3 flex items-center justify-center gap-2 w-full py-3.5 px-4 rounded-2xl bg-black hover:bg-neutral-900 active:scale-95 transition font-medium text-white text-sm shadow-sm"
            >
              <svg width="17" height="20" viewBox="0 0 814 1000" aria-hidden="true">
                <path fill="#fff" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
              </svg>
              Continue with Apple
            </button>
          )}
    </>
  );

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="text-center mb-10">
          {/* Canonical "settle" mark (dark navy tile, purple stacked bars) —
              generated from capacitor-spike/assets/icon.png and already
              deployed as the web favicon/app-icon set at /icons/icon-192.png. */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mb-5 overflow-hidden">
            {/* Plain <img>, not next/image: the mobile Capacitor build is a
                static export (output: 'export') without images.unoptimized
                set, so next/image would emit a /_next/image?url=... optimizer
                URL that 404s in the exported bundle. A 192px static icon
                doesn't need runtime optimization anyway. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="Sorted" width={64} height={64} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Sorted</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">See where your money stands.</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-8">
          {!slotted && (
            <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6 leading-relaxed">
              Sign in with your Google account to access your dashboard.
            </p>
          )}

          {error && error !== "invite_only" && (
            <div role="alert" className="mb-5 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40">
              <p className="text-sm text-slate-700 dark:text-slate-200 text-center">{error}</p>
            </div>
          )}

          {phase.kind === "signing-in" ? (
            <SigningInPanel phase={phase} nowMs={nowMs} onCancel={cancelSignIn} />
          ) : phase.kind === "unreachable" ? (
            <UnreachablePanel onRetry={retrySessionCheck} onOtherAccount={dismissPhase} />
          ) : (
            <>
              {phase.kind === "failed" && <FailedNotice key={noticeSeq} reason={phase.reason} />}
              {signInButtons}
            </>
          )}
        </div>

        {/* Regulatory disclosure (Q6/A9) — single source of truth in lib/regulatoryCopy.ts */}
        <p className="mt-8 px-4 text-center text-xs leading-relaxed text-slate-600 dark:text-slate-400">
          {AGENT_DISCLOSURE}
        </p>

        {/* Whisper build tag — see lib/buildTag.ts for why this exists. */}
        <p className="mt-3 text-center text-[10px] text-slate-400/70 dark:text-slate-500/60 tracking-wide">
          {BUILD_TAG}
        </p>
      </div>
    </div>
  );
}
