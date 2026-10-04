"use client";

// G202 · approved variant A (Two stages), folded into production.
// This page renders the PRODUCTION components/LoginScreen (and through it
// components/SignInProgress) with its phase and clock supplied through props.
// Nothing here is a copy of shipped markup. Static fixtures, no API requests,
// nothing signs in; elapsed time is a fake clock (optionally ticking, live=1).
// /design/signin-loading?state=waiting|waiting-slow|checking|resume|failed|timeout|unreachable&mode=light|dark[&t=<seconds>][&live=1][&chrome=0]

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import LoginScreen, { type LoginPhase } from "@/components/LoginScreen";

type StateId = "waiting" | "waiting-slow" | "checking" | "resume" | "failed" | "timeout" | "unreachable";

// Fixed fake epoch, so the preview never reads the real clock.
const T0 = 1_000_000;

const STATES: { id: StateId; label: string; elapsed: number; phase: LoginPhase }[] = [
  { id: "waiting", label: "Signing in, 0s", elapsed: 0, phase: { kind: "signing-in", attempt: "google", stage: "provider", startedAt: T0 } },
  { id: "waiting-slow", label: "Signing in, 25s", elapsed: 25, phase: { kind: "signing-in", attempt: "google", stage: "provider", startedAt: T0 } },
  { id: "checking", label: "Checking session, 2s", elapsed: 2, phase: { kind: "signing-in", attempt: "google", stage: "session", startedAt: T0 } },
  { id: "resume", label: "Resumed after a kill", elapsed: 3, phase: { kind: "signing-in", attempt: "resume", stage: "provider", startedAt: T0 } },
  { id: "failed", label: "Failed", elapsed: 0, phase: { kind: "failed", reason: "failed" } },
  { id: "timeout", label: "Timed out", elapsed: 0, phase: { kind: "failed", reason: "timeout" } },
  { id: "unreachable", label: "Unreachable", elapsed: 0, phase: { kind: "unreachable" } },
];

const pill =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function SigninLoadingClient() {
  const params = useSearchParams();
  const state = STATES.find((s) => s.id === params.get("state")) ?? STATES[0];
  const dark = params.get("mode") === "dark";
  const showChrome = params.get("chrome") !== "0";
  const live = params.get("live") === "1";
  const tParam = params.get("t");
  const baseSeconds = tParam !== null && !Number.isNaN(Number(tParam)) ? Number(tParam) : state.elapsed;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
  }, [dark]);

  // Fake clock: fixed unless live=1, then it counts up from the fixture.
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setTicks((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [live]);
  const nowMs = T0 + (baseSeconds + (live ? ticks : 0)) * 1000;

  const phase = state.phase;
  const q = (over: Record<string, string>) => {
    const next = new URLSearchParams({ state: state.id, mode: dark ? "dark" : "light", ...(showChrome ? {} : { chrome: "0" }), ...over });
    return `?${next.toString()}`;
  };

  return (
    <div>
      {showChrome && (
        <div className="sticky top-0 z-20 border-b border-slate-300 bg-white/95 px-4 py-3 text-slate-900 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
          <div className="mx-auto flex max-w-sm flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Link href="/design" className="inline-flex min-h-11 items-center text-sm font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">
                Design index
              </Link>
              <Link href={q({ mode: dark ? "light" : "dark" })} className={`${pill} text-slate-700 dark:text-slate-300`}>
                {dark ? "Light" : "Dark"}
              </Link>
            </div>
            <div className="flex flex-wrap gap-1">
              {STATES.map((s) => (
                <Link key={s.id} href={q({ state: s.id })} aria-current={s.id === state.id ? "true" : undefined} className={`${pill} border border-slate-300 dark:border-slate-700 ${s.id === state.id ? "bg-slate-200 text-slate-950 dark:bg-slate-700 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}>
                  {s.label}
                </Link>
              ))}
              <Link href={q({ live: live ? "0" : "1" })} className={`${pill} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300`}>
                {live ? "Clock: live (stop)" : "Clock: start live"}
              </Link>
            </div>
          </div>
        </div>
      )}

      <LoginScreen phase={phase} nowMs={nowMs} />

      {showChrome && (
        <div className="mx-auto max-w-sm px-6 pb-16 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-slate-100">Approved: A · Two stages</p>
          <p className="mt-1">
            The card becomes a two-row ledger of the two real stages, the browser hand-back and the session check, with a ring on the live row and a tick on the finished one. From 20s the copy changes to &quot;Still signing you in&quot; and Cancel stays on screen. A failed attempt returns to the form with its reason in a focused role=alert notice, never a browser alert.
          </p>
          <p className="mt-3">
            Everything on screen is the production LoginScreen and SignInProgress. Only the phase and the clock are supplied here, as fixtures; nothing signs in. No red (The Red Is Risk Rule), no gradient (The Penny Gradient Rule), reduced motion turns the ring static.
          </p>
        </div>
      )}
    </div>
  );
}
