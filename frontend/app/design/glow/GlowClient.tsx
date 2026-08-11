"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ScanFace, ChevronRight, CalendarClock } from "lucide-react";

type Mode = "light" | "dark";
type Variant = "A" | "B" | "C";

// Light-mode candidates — geometry per the original brief (2026-08-07 pick).
const LIGHT_GLOW: Record<Variant, React.CSSProperties | null> = {
  A: {
    background: [
      "radial-gradient(ellipse 85% 420px at 50% 210px, rgba(129,140,248,0.13), rgba(129,140,248,0.055) 50%, transparent 84%)",
      "radial-gradient(ellipse 62% 66% at 50% 100%, rgba(99,102,241,0.045), rgba(99,102,241,0.027) 55%, transparent 92%)",
    ].join(", "),
  },
  B: {
    background: [
      "radial-gradient(ellipse 72% 400px at 50% 215px, rgba(255,255,255,0.85), rgba(238,240,255,0.40) 48%, transparent 80%)",
      "radial-gradient(ellipse 95% 520px at 50% 260px, rgba(139,92,246,0.05), transparent 75%)",
      "radial-gradient(ellipse 62% 66% at 50% 100%, rgba(99,102,241,0.045), rgba(99,102,241,0.027) 55%, transparent 92%)",
    ].join(", "),
  },
  C: null,
};

// Dark-mode candidates — A is exactly globals.css .dark .glow-ambient (the
// shipped baseline, unchanged); B and C are raised/tightened re-cuts of the
// same two-layer core+fringe recipe, same tail in all three.
const DARK_TAIL =
  "radial-gradient(ellipse 62% 66% at 50% 100%, rgba(99,102,241,0.03), rgba(99,102,241,0.018) 55%, transparent 92%)";

const DARK_GLOW: Record<Variant, React.CSSProperties | null> = {
  A: {
    background: [
      "radial-gradient(ellipse 50% 246px at 50% 235px, rgba(99,102,241,0.32), rgba(99,102,241,0.16) 45%, transparent 72%)",
      "radial-gradient(ellipse 52% 302px at 50% 325px, rgba(139,92,246,0.13), rgba(139,92,246,0.065) 45%, transparent 70%)",
      DARK_TAIL,
    ].join(", "),
  },
  B: {
    background: [
      "radial-gradient(ellipse 50% 246px at 50% 180px, rgba(99,102,241,0.32), rgba(99,102,241,0.16) 45%, transparent 72%)",
      "radial-gradient(ellipse 52% 302px at 50% 270px, rgba(139,92,246,0.13), rgba(139,92,246,0.065) 45%, transparent 70%)",
      DARK_TAIL,
    ].join(", "),
  },
  C: {
    background: [
      "radial-gradient(ellipse 42% 210px at 50% 185px, rgba(99,102,241,0.42), rgba(99,102,241,0.18) 45%, transparent 70%)",
      "radial-gradient(ellipse 48% 260px at 50% 285px, rgba(139,92,246,0.16), rgba(139,92,246,0.07) 45%, transparent 68%)",
      DARK_TAIL,
    ].join(", "),
  },
};

const GLOW: Record<Mode, Record<Variant, React.CSSProperties | null>> = {
  light: LIGHT_GLOW,
  dark: DARK_GLOW,
};

const CAPTIONS: Record<Mode, Record<Variant, string>> = {
  light: {
    A: "A · Minimal field — one wide, quiet ellipse. No second source, no seam.",
    B: "B · Luminous sheen — light that brightens the canvas, not colour laid on top.",
    C: "C · No glow — the field is retired here; it stays a dark-mode-only signature.",
  },
  dark: {
    A: "A · Current — production dark glow, unchanged (baseline).",
    B: "B · Raised — same light, peak sits between greeting and first card.",
    C: "C · Spotlight — tighter, brighter core; calmer card interiors.",
  },
};

const VARIANT_LABEL: Record<Mode, Record<Variant, string>> = {
  light: { A: "Minimal", B: "Sheen", C: "None" },
  dark: { A: "Current", B: "Raised", C: "Spotlight" },
};

export default function GlowClient() {
  const [mode, setMode] = useState<Mode>("light");
  const [variant, setVariant] = useState<Variant>("A");
  const glow = GLOW[mode][variant];

  function handleModeChange(next: Mode) {
    setMode(next);
    setVariant("A"); // variant choice doesn't carry meaning across modes
  }

  // This preview controls its own theme locally (via the `dark` class on the
  // wrapper below) regardless of the visitor's saved theme — force the
  // html-level class off so the real app's localStorage preference never
  // leaks in and fights the local toggle. Restore whatever was there on
  // unmount.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, []);

  return (
    // relative isolate: this wrapper's own opaque background otherwise
    // paints on top of the -z-10 fixed glow child, because without a new
    // stacking context here the glow falls back to the body's stacking
    // context (body has `isolate` in app/layout.tsx, but that's the real
    // app shell, not this standalone page). Matches how layout.tsx keeps
    // the glow visible beneath its own canvas.
    //
    // The `dark` class here — not on <html> — is the only theme control on
    // this page: Tailwind's class strategy matches any ancestor, so every
    // `dark:` variant inside the replica lights up from this one class.
    <div
      className={`relative isolate min-h-dvh pb-40 ${
        mode === "dark" ? "dark bg-[#0f172a]" : "bg-[#f0f2f7]"
      }`}
    >
      {/* Glow layer — same geometry slot as app/layout.tsx's .app-glow, but
          the gradient itself is swapped per-variant via inline style since
          these candidates don't exist in globals.css yet (dark · A is the
          one exception — it's the exact production recipe). */}
      {glow && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div
            className="absolute left-1/2 top-[4vh] h-[96vh] w-[135vw] max-w-[780px] -translate-x-1/2"
            style={glow}
          />
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-10">
        {/* ── Preview header ─────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
            Design preview
          </p>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">
            {mode === "dark" ? "Dark-mode glow" : "Light-mode glow"}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Compare on this page only — the app is unchanged.
          </p>
        </div>

        {/* ── Home top-fold replica (static) ────────────────────────────── */}
        <div className="space-y-3">
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
            Good evening, Kevin
          </h1>
          <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
            Nothing needs you today. Cash is tight for the rest of this pay period, but the
            bills are mapped — I&apos;ll flag anything that needs you.
          </p>
        </div>

        {/* Payday plan row */}
        <div className="glass-card rounded-2xl w-full min-h-[44px] px-4 py-3 flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              Payday plan
            </span>
            <span className="block text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
              Pay period ends Friday — see how I&apos;d split your next pay cheque
            </span>
          </span>
          <ChevronRight
            size={16}
            aria-hidden="true"
            className="flex-shrink-0 text-slate-400 dark:text-slate-500"
          />
        </div>

        {/* Safe-to-Spend hero */}
        <div className="hero-arrive rounded-3xl p-5 glass-hero">
          <div className="flex items-center gap-1.5 mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Safe to Spend
            </p>
            <AlertCircle
              size={14}
              className="text-amber-500 dark:text-amber-400 flex-shrink-0"
              aria-hidden="true"
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug">
              Tight until your pay period ends — £299 in hand.
            </h2>

            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Now</span>
                  <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">£471</span>
                </div>
                <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Bills</span>
                  <span className="text-base font-semibold text-slate-800 dark:text-slate-100 tabular-nums num text-left">−£172</span>
                </div>
                <div className="flex flex-col gap-0.5 items-start rounded-xl glass-tile px-3 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 text-left">Free</span>
                  <span className="text-base font-semibold tabular-nums num text-left text-amber-500 dark:text-amber-400">£299</span>
                </div>
              </div>

              <div className="w-full rounded-xl glass-tile px-3 py-2.5 flex items-center justify-between gap-3 text-left">
                <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="text-base font-semibold tabular-nums num text-slate-600 dark:text-slate-300">£299</span>
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">free</span>
                  <span className="text-[13px] text-slate-400 dark:text-slate-500" aria-hidden="true">·</span>
                  <span className="text-base font-semibold tabular-nums num text-emerald-600 dark:text-emerald-400">£421</span>
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">paid off credit cards</span>
                </p>
                <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0" aria-hidden="true">›</span>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[13px] text-slate-500 dark:text-slate-400 num">£10.50/day until pay period end</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 num">Pay period ends Friday · ~£1,850 expected</p>
            </div>
          </div>
        </div>

        {/* How your money behaves */}
        <div className="rounded-2xl glass-card px-4">
          <div className="w-full min-h-[44px] flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <ScanFace size={15} aria-hidden="true" className="text-slate-400 flex-shrink-0" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">How your money behaves</span>
            </div>
            <span className="text-sm text-slate-400 dark:text-slate-500">›</span>
          </div>
        </div>

        {/* Coming up */}
        <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <CalendarClock size={17} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Coming up · 14 days</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="text-sm font-semibold text-amber-500">2 due tomorrow</span>
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">3 bills over the next 2 weeks</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-slate-400 dark:text-slate-500">total out</p>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 num">£172</p>
          </div>
        </div>
      </div>

      {/* ── Mode + variant switcher — fixed bottom-centre ─────────────────── */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 px-4"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <p className="text-xs text-slate-500 dark:text-slate-400 bg-white/90 dark:bg-slate-800/90 backdrop-blur rounded-full px-3 py-1 border border-slate-200 dark:border-slate-700 shadow-sm text-center max-w-xs">
          {CAPTIONS[mode][variant]}
        </p>

        {/* Light · Dark — switching mode resets variant to A */}
        <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full p-1 shadow-sm flex items-center gap-1">
          {(["light", "dark"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              aria-pressed={mode === m}
              className={`h-11 min-w-11 px-4 rounded-full text-sm font-semibold transition-colors ${
                mode === m
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              }`}
            >
              {m === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>

        {/* A · B · C — candidates for the active mode */}
        <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-full p-1 shadow-sm flex items-center gap-1">
          {(["A", "B", "C"] as Variant[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              aria-pressed={variant === v}
              className={`h-11 min-w-11 px-4 rounded-full text-sm font-semibold transition-colors ${
                variant === v
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              }`}
            >
              {v} · {VARIANT_LABEL[mode][v]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
