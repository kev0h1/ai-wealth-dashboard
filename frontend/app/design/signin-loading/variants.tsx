"use client";

// TEMPORARY PREVIEW, G202 "signing you in" design round.
// Directions drafted with openai/gpt-6-astra and rewritten to DESIGN.md (see
// the note on the page). Static, no requests, nothing signs in. These
// renderers are handed to the PRODUCTION components/LoginScreen through its
// optional phase / renderPhase props; the shell, mark, form buttons and
// regulatory line on screen are the production ones.

import { useEffect, useRef, type ReactNode } from "react";
import type { LoginPhase, LoginPhaseSlots } from "@/components/LoginScreen";

export type VariantId = "a" | "b" | "c";

// From this point the copy owns up to a slow attempt. Matches the planner's
// "after about 20s".
export const SLOW_AFTER_MS = 20_000;

type Signing = Extract<LoginPhase, { kind: "signing-in" }>;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800";

function Primary({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className={`min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none ${focusRing}`}
    >
      {children}
    </button>
  );
}

function Secondary({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className={`min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-100 ${focusRing}`}
    >
      {children}
    </button>
  );
}

function providerName(a: Signing["attempt"]) {
  return a === "apple" ? "Apple" : "Google";
}

export function signingCopy(p: Signing) {
  const slow = p.elapsedMs >= SLOW_AFTER_MS;
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
    ? { title: "Sign-in timed out", line: "We waited five minutes without hearing back. Try again below." }
    : { title: "We could not sign you in", line: "The sign-in did not finish. Try again below." };
}

export const UNREACHABLE = {
  title: "Could not reach Sorted",
  line: "You are signed in on this device, but we could not reach Sorted. Your sign-in is kept, so you can try again.",
};

// The one polite live region. Content changes announce; nothing ticks.
function Status({ title, line, focusOnMount, align = "left" }: { title: string; line: string; focusOnMount?: boolean; align?: "left" | "center" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <div
      ref={ref}
      tabIndex={focusOnMount ? -1 : undefined}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`min-w-0 rounded-lg focus:outline-none ${align === "center" ? "text-center" : ""}`}
    >
      <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{line}</p>
    </div>
  );
}

// The failed notice is a role="alert" and takes focus when it appears, so a
// screen reader and a keyboard both land on the explanation, not the buttons.
function FailedNotice({ reason, dotted }: { reason: "failed" | "timeout"; dotted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const c = failedCopy(reason);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-atomic="true"
      className="mb-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900/40"
    >
      {dotted && <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />}
      <div className="min-w-0">
        <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-slate-100">{c.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{c.line}</p>
      </div>
    </div>
  );
}

// A calm in-progress ring. Static quarter-arc under reduced motion, and it
// never stands alone: the words beside it carry the state.
function Ring({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-2 border-indigo-600/25 border-t-indigo-600 animate-spin motion-reduce:animate-none dark:border-indigo-400/25 dark:border-t-indigo-400 ${className}`}
      style={{ animationDuration: "1.1s" }}
    />
  );
}

function Check() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-indigo-600 dark:text-indigo-400">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Hollow() {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 dark:border-slate-600" />;
}

const whisper = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-300";

// ---------------------------------------------------------------- A
function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      {icon}
      <span className="min-w-0 flex-1 text-sm text-slate-900 dark:text-slate-100">{label}</span>
      <span className={whisper}>{value}</span>
    </li>
  );
}

function RenderA(phase: LoginPhase, { form }: LoginPhaseSlots) {
  void form;
  if (phase.kind === "failed") return <FailedNotice reason={phase.reason} />;
  if (phase.kind === "unreachable") {
    return (
      <div className="space-y-5">
        <Status title={UNREACHABLE.title} line={UNREACHABLE.line} focusOnMount />
        <ol aria-label="Sign-in stages" className="divide-y divide-slate-200 rounded-2xl border border-slate-200 px-4 dark:divide-slate-700 dark:border-slate-600">
          <Row icon={<Check />} label="Signed in on this device" value="Done" />
          <Row icon={<Hollow />} label="Session check" value="Not reached" />
        </ol>
        <div className="space-y-3">
          <Primary>Try again</Primary>
          <Secondary>Use a different account</Secondary>
        </div>
      </div>
    );
  }
  const c = signingCopy(phase);
  const first = phase.attempt === "resume" ? "Earlier sign-in" : `${providerName(phase.attempt)} sign-in`;
  return (
    <div className="space-y-5">
      <Status title={c.title} line={c.line} />
      <ol aria-label="Sign-in stages" className="divide-y divide-slate-200 rounded-2xl border border-slate-200 px-4 dark:divide-slate-700 dark:border-slate-600">
        {phase.stage === "provider" ? (
          <>
            <Row icon={<Ring />} label={first} value="Waiting" />
            <Row icon={<Hollow />} label="Session check" value="Next" />
          </>
        ) : (
          <>
            <Row icon={<Check />} label={first} value="Received" />
            <Row icon={<Ring />} label="Session check" value="Checking" />
          </>
        )}
      </ol>
      <Secondary>Cancel</Secondary>
    </div>
  );
}

// ---------------------------------------------------------------- B
function RenderB(phase: LoginPhase, { form }: LoginPhaseSlots) {
  if (phase.kind === "failed") return <FailedNotice reason={phase.reason} dotted />;
  if (phase.kind === "unreachable") {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-900/40">
          <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
          <Status title={UNREACHABLE.title} line={UNREACHABLE.line} focusOnMount />
        </div>
        <div className="space-y-3">
          <Primary>Try again</Primary>
          <Secondary>Use a different account</Secondary>
        </div>
      </div>
    );
  }
  const c = signingCopy(phase);
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-400/30 dark:bg-indigo-500/10">
        <span aria-hidden="true" className="relative mt-2 flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-60 animate-ping motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
        </span>
        <Status title={c.title} line={c.line} />
      </div>
      {/* The real buttons, held in place: inert removes them from focus and
          the accessibility tree, the dim is only the visual echo of that. */}
      <div inert aria-hidden="true" className="pointer-events-none select-none opacity-40">
        {form}
      </div>
      <Secondary>Cancel sign-in</Secondary>
    </div>
  );
}

// ---------------------------------------------------------------- C
function MarkWithRing() {
  return (
    <div className="relative inline-flex h-16 w-16 items-center justify-center">
      <span aria-hidden="true" className="absolute -inset-2 rounded-[1.75rem] border-2 border-indigo-600/30 animate-pulse motion-reduce:animate-none dark:border-indigo-400/30" />
      <div className="h-16 w-16 overflow-hidden rounded-2xl shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={64} height={64} className="h-full w-full object-cover" />
      </div>
    </div>
  );
}

function RenderC(phase: LoginPhase, { form }: LoginPhaseSlots) {
  void form;
  if (phase.kind === "failed") return <FailedNotice reason={phase.reason} />;
  if (phase.kind === "unreachable") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <Status title={UNREACHABLE.title} line={UNREACHABLE.line} focusOnMount align="center" />
        <div className="w-full space-y-3">
          <Primary>Try again</Primary>
          <Secondary>Use a different account</Secondary>
        </div>
      </div>
    );
  }
  const c = signingCopy(phase);
  return (
    <div className="flex min-h-72 flex-col items-center text-center">
      <div className="mt-2">
        <MarkWithRing />
      </div>
      <div className="mt-8 w-full">
        <Status title={c.title} line={c.line} align="center" />
      </div>
      <div className="mt-auto w-full pt-8">
        <Secondary>Cancel</Secondary>
      </div>
    </div>
  );
}

export const RENDERERS: Record<VariantId, (p: LoginPhase, s: LoginPhaseSlots) => ReactNode> = {
  a: RenderA,
  b: RenderB,
  c: RenderC,
};

export const VARIANT_META: Record<VariantId, { label: string; note: string }> = {
  a: {
    label: "A · Two stages",
    note: "The card becomes a two-row ledger of the two real stages, the browser hand-back and the session check, with a ring on the live row and a tick on the finished one. The most literal, so the user can see where the wait is.",
  },
  b: {
    label: "B · Held form",
    note: "The familiar buttons stay where they were but are inert and dimmed, under a status strip with a soft indigo pulse. Keeps spatial memory and makes it obvious the buttons are paused, at the cost of showing a form you cannot use.",
  },
  c: {
    label: "C · Settled hand-off",
    note: "The form geometry goes and the Sorted mark moves into the card with a calm ring around it, so the wait reads as handing over to Sorted. Quietest, closest to a splash screen, so the sentence and the Cancel button carry the honesty.",
  },
};
