"use client";

// TEMPORARY PREVIEW, G202 "signing you in" design round.
// Static fixtures. No API requests, nothing signs in, no production edits to
// the flow (LoginScreen gained three optional props that production never
// passes).
// /design/signin-loading?variant=a|b|c&state=waiting|waiting-slow|checking|checking-slow|resume|failed|timeout|unreachable&mode=light|dark[&t=<seconds>][&live=1][&chrome=0]
//
// Rendered from production: components/LoginScreen (shell, mark, title, the
// real Google and Apple buttons, the regulatory line, the invite-only branch
// untouched). Hand-authored for the round: the phase panels in ./variants.tsx,
// which are the only thing a pick would promote. Elapsed time is a fixture
// (or a fake clock with live=1), never a real sign-in.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import LoginScreen, { type LoginPhase } from "@/components/LoginScreen";
import { RENDERERS, VARIANT_META, type VariantId } from "./variants";

const VARIANTS: VariantId[] = ["a", "b", "c"];

type StateId = "waiting" | "waiting-slow" | "checking" | "checking-slow" | "resume" | "failed" | "timeout" | "unreachable";

const STATES: { id: StateId; label: string; elapsed: number; phase: (elapsedMs: number) => LoginPhase }[] = [
  { id: "waiting", label: "Signing in, 0s", elapsed: 0, phase: (e) => ({ kind: "signing-in", attempt: "google", stage: "provider", elapsedMs: e }) },
  { id: "waiting-slow", label: "Signing in, 25s", elapsed: 25, phase: (e) => ({ kind: "signing-in", attempt: "google", stage: "provider", elapsedMs: e }) },
  { id: "checking", label: "Checking session, 2s", elapsed: 2, phase: (e) => ({ kind: "signing-in", attempt: "google", stage: "session", elapsedMs: e }) },
  { id: "checking-slow", label: "Checking session, 25s", elapsed: 25, phase: (e) => ({ kind: "signing-in", attempt: "google", stage: "session", elapsedMs: e }) },
  { id: "resume", label: "Resumed after a kill", elapsed: 3, phase: (e) => ({ kind: "signing-in", attempt: "resume", stage: "provider", elapsedMs: e }) },
  { id: "failed", label: "Failed", elapsed: 0, phase: () => ({ kind: "failed", reason: "failed" }) },
  { id: "timeout", label: "Timed out", elapsed: 0, phase: () => ({ kind: "failed", reason: "timeout" }) },
  { id: "unreachable", label: "Unreachable", elapsed: 0, phase: () => ({ kind: "unreachable" }) },
];

const pill =
  "inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function SigninLoadingClient() {
  const params = useSearchParams();
  const rawV = params.get("variant");
  const variant: VariantId = VARIANTS.includes(rawV as VariantId) ? (rawV as VariantId) : "a";
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
  const elapsedMs = (baseSeconds + (live ? ticks : 0)) * 1000;

  const phase = useMemo(() => state.phase(elapsedMs), [state, elapsedMs]);
  const q = (over: Record<string, string>) => {
    const next = new URLSearchParams({ variant, state: state.id, mode: dark ? "dark" : "light", ...(showChrome ? {} : { chrome: "0" }), ...over });
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
            <div className="flex gap-1 rounded-xl bg-slate-900 p-1 dark:border dark:border-slate-700">
              {VARIANTS.map((v) => (
                <Link key={v} href={q({ variant: v })} aria-current={v === variant ? "page" : undefined} className={`${pill} flex-1 justify-center ${v === variant ? "bg-indigo-600 text-white" : "text-slate-300"}`}>
                  {VARIANT_META[v].label}
                </Link>
              ))}
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

      <LoginScreen phase={phase} renderPhase={RENDERERS[variant]} hideMarkWhileSigningIn={variant === "c"} />

      {showChrome && (
        <div className="mx-auto max-w-sm px-6 pb-16 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{VARIANT_META[variant].label}</p>
          <p className="mt-1">{VARIANT_META[variant].note}</p>
          <p className="mt-3">
            Rendered from production: LoginScreen (shell, mark, title, the real Google and Apple buttons, the regulatory line). Hand-authored for this round: the phase panels, which are the only thing a pick would promote. Elapsed time and every outcome are fixtures, nothing signs in. From 20s the copy changes to &quot;Still signing you in&quot; and the way out stays on screen. A failed attempt returns to the form with its reason, never an alert, and takes focus. No red (The Red Is Risk Rule), no gradient (The Penny Gradient Rule), reduced motion turns the ring and pulses static. Directions drafted with Astra (openai/gpt-6-astra) and rewritten to DESIGN.md. Today none of this reaches production: AuthProvider passes none of the new props.
          </p>
        </div>
      )}
    </div>
  );
}
