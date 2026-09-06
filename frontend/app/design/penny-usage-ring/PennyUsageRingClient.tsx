"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Three art-direction variants of a Penny message-allowance meter, staged
// on static mocks of the sheet header (components/PennySheet.tsx), the
// bottom nav (components/BottomNav.tsx) and the composer
// (components/PennyConversation.tsx) — see MockSheetFrame.tsx and
// MockBottomNav.tsx for why those are copied markup, not imports.
//
// Deep-linkable: /design/penny-usage-ring?mode=light|dark&state=low|high|cap|unlimited
//   low       37 of 150 messages used (Standard tier)
//   high      128 of 150 (amber threshold)
//   cap       150 of 150 (full, amber, "top up or wait" copy)
//   unlimited an uncapped tier — each variant shows how the meter itself
//             either disappears or reads "no limit" rather than drawing a
//             ring that can never fill.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import MockSheetFrame from "./MockSheetFrame";
import MockBottomNav from "./MockBottomNav";
import { USAGE_FIXTURES, USAGE_STATES, type UsageState } from "./fixtures";

type Mode = "light" | "dark";

function isState(v: string | null): v is UsageState {
  return !!v && (USAGE_STATES as string[]).includes(v);
}

function Toolbar({ state, mode }: { state: UsageState; mode: Mode }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {USAGE_STATES.map((s) => (
          <a
            key={s}
            href={`?state=${s}&mode=${mode}`}
            className={`flex min-h-11 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors active:scale-95 ${
              s === state ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {s === "low" ? "Low" : s === "high" ? "High" : s === "cap" ? "Cap" : "Unlimited"}
          </a>
        ))}
        <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />
        <a
          href={`?state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-11 items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function SectionHeading({ letter, title, caption }: { letter: string; title: string; caption: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-500/15 text-[11px] font-bold text-indigo-600 dark:text-indigo-300">
          {letter}
        </span>
        <h2 className="text-[16px] font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{caption}</p>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawState = params.get("state");
  const state: UsageState = isState(rawState) ? rawState : "low";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const data = USAGE_FIXTURES[state];

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 space-y-8">
          <div>
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Penny usage ring</h1>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Message-allowance meter · 3 art-direction variants
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              {data.tier} tier ·{" "}
              {data.limit == null ? (
                <>no monthly limit</>
              ) : (
                <>
                  <span className="money">{data.used}</span> of <span className="money">{data.limit}</span> messages used this
                  month
                </>
              )}
            </p>
          </div>

          <section className="space-y-3">
            <SectionHeading
              letter="A"
              title="Avatar ring"
              caption="A thin ring around the Penny avatar in the sheet header. Tap the avatar to toggle the caption underneath the title (shown here by default)."
            />
            <MockSheetFrame variant="avatarRing" state={state} data={data} />
          </section>

          <section className="space-y-3">
            <SectionHeading
              letter="B"
              title="Nav button ring"
              caption="Visible without opening the sheet at all: the same ring, drawn as a halo around the raised centre Penny button. The sheet header underneath stays exactly as it is today, no ring on the avatar."
            />
            <MockBottomNav state={state} data={data} />
            <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
              Sheet header, unchanged
            </p>
            <MockSheetFrame variant="plain" state={state} data={data} headerOnly />
          </section>

          <section className="space-y-3">
            <SectionHeading
              letter="C"
              title="Composer meter"
              caption="No ring anywhere. A hairline bar sits directly above the composer input with the count right-aligned above it. At Cap, the placeholder changes and sending disables."
            />
            <MockSheetFrame variant="composerMeter" state={state} data={data} />
          </section>
        </div>

        <Toolbar state={state} mode={mode} />
      </div>
    </div>
  );
}

export default function PennyUsageRingClient() {
  return <Inner />;
}
