"use client";

// G202 (approved variant A, "Two stages"): what the login card says while a
// native sign-in is in flight. The card becomes a two-row ledger of the two
// real stages, the browser hand-back and the session check, with a ring on
// the live row and a tick on the finished one. LoginScreen owns the phase and
// renders these; the copy and the 20s "Still signing you in" rule live in
// lib/signInPhase.ts.
//
// No red (The Red Is Risk Rule), no gradient (The Penny Gradient Rule),
// reduced motion turns the ring static.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SLOW_AFTER_MS,
  UNREACHABLE,
  failedCopy,
  providerName,
  signingCopy,
  type SigningPhase,
} from "@/lib/signInPhase";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800";

function Primary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none ${focusRing}`}
    >
      {children}
    </button>
  );
}

function Secondary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-100 ${focusRing}`}
    >
      {children}
    </button>
  );
}

// The one polite live region. Content changes announce; nothing ticks.
function Status({ title, line, focusOnMount }: { title: string; line: string; focusOnMount?: boolean }) {
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
      className="min-w-0 rounded-lg focus:outline-none"
    >
      <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{line}</p>
    </div>
  );
}

// A calm in-progress ring. Static under reduced motion, and it never stands
// alone: the words beside it carry the state.
function Ring() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-indigo-600/25 border-t-indigo-600 animate-spin motion-reduce:animate-none dark:border-indigo-400/25 dark:border-t-indigo-400"
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

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      {icon}
      <span className="min-w-0 flex-1 text-sm text-slate-900 dark:text-slate-100">{label}</span>
      <span className={whisper}>{value}</span>
    </li>
  );
}

const ledger =
  "divide-y divide-slate-200 rounded-2xl border border-slate-200 px-4 dark:divide-slate-700 dark:border-slate-600";

// Wall-clock "now" that only re-renders once, at the moment the attempt turns
// slow (nothing ticks). `nowOverride` is the preview's fake clock.
function useNow(startedAt: number, nowOverride?: number): number {
  const [tick, setTick] = useState<number | null>(null);
  useEffect(() => {
    if (nowOverride !== undefined) return;
    const left = SLOW_AFTER_MS - (Date.now() - startedAt);
    if (left <= 0) {
      setTick(Date.now());
      return;
    }
    const id = setTimeout(() => setTick(Date.now()), left + 5);
    return () => clearTimeout(id);
  }, [startedAt, nowOverride]);
  return nowOverride ?? tick ?? startedAt;
}

export function SigningInPanel({
  phase,
  nowMs,
  onCancel,
}: {
  phase: SigningPhase;
  nowMs?: number;
  onCancel: () => void;
}) {
  const now = useNow(phase.startedAt, nowMs);
  const c = signingCopy(phase, now);
  const first = phase.attempt === "resume" ? "Earlier sign-in" : `${providerName(phase.attempt)} sign-in`;
  return (
    <div className="space-y-5">
      <Status title={c.title} line={c.line} />
      <ol aria-label="Sign-in stages" className={ledger}>
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
      <Secondary onClick={onCancel}>Cancel</Secondary>
    </div>
  );
}

// A failed attempt is a role="alert" that takes focus when it appears, so a
// screen reader and a keyboard both land on the explanation, not the buttons.
// Replaces the old window.alert(). Remount (key) to re-announce a repeat.
export function FailedNotice({ reason }: { reason: "failed" | "timeout" }) {
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
      <div className="min-w-0">
        <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-slate-100">{c.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{c.line}</p>
      </div>
    </div>
  );
}

export function UnreachablePanel({ onRetry, onOtherAccount }: { onRetry: () => void; onOtherAccount: () => void }) {
  return (
    <div className="space-y-5">
      <Status title={UNREACHABLE.title} line={UNREACHABLE.line} focusOnMount />
      <ol aria-label="Sign-in stages" className={ledger}>
        <Row icon={<Check />} label="Signed in on this device" value="Done" />
        <Row icon={<Hollow />} label="Session check" value="Not reached" />
      </ol>
      <div className="space-y-3">
        <Primary onClick={onRetry}>Try again</Primary>
        <Secondary onClick={onOtherAccount}>Use a different account</Secondary>
      </div>
    </div>
  );
}
