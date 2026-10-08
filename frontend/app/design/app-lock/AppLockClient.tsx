"use client";

// G203 app-lock preview, after Kevin picked variant A "Quiet door"
// (2026-10-04). Skill: impeccable; directions drafted with
// openai/gpt-6-astra and rewritten to DESIGN.md.
//
// Fixture states only. This page NEVER mounts the real gate
// (components/BiometricLock.tsx): that would lock the preview and install
// the inert/request gates on a public route. It renders the presentational
// layer through props with a no-op unlock and sign-out.
// It renders ONLY the PRODUCTION components/LockScreenView.tsx, so the
// preview cannot drift from what shipped.
// /design/app-lock?state=idle|prompting|failed|timeout
//   &device=iphone-face|iphone-touch|android-fingerprint|android-face|passcode&mode=light|dark&chrome=0

import { useSearchParams } from "next/navigation";
import LockScreenView, { type BiometryKind, type LockPlatform, type LockScreenViewProps } from "@/components/LockScreenView";

type PState = "idle" | "prompting" | "failed" | "timeout";

const STATES: { value: PState; label: string }[] = [
  { value: "idle", label: "Idle" },
  { value: "prompting", label: "Prompting" },
  { value: "failed", label: "Failed" },
  { value: "timeout", label: "Timed out" },
];
const DEVICES: Record<string, { label: string; platform: LockPlatform; biometry: BiometryKind }> = {
  "iphone-face": { label: "iPhone Face ID", platform: "ios", biometry: "faceId" },
  "iphone-touch": { label: "iPhone Touch ID", platform: "ios", biometry: "touchId" },
  "android-fingerprint": { label: "Android fingerprint", platform: "android", biometry: "fingerprint" },
  "android-face": { label: "Android face", platform: "android", biometry: "face" },
  unresolved: { label: "Check pending", platform: "ios", biometry: "unknown" },
  passcode: { label: "Passcode only", platform: "ios", biometry: "none" },
};

// The two texts the shipped gate sets verbatim.
const SHIPPED_UNCONFIRMED = "Face/fingerprint wasn't confirmed. Try again.";
const SHIPPED_TIMEOUT = "Face/fingerprint didn't respond. Try again.";

function noop() {}

export default function AppLockClient() {
  const params = useSearchParams();
  const pstate = (STATES.find((s) => s.value === params.get("state"))?.value ?? "idle") as PState;
  const deviceKey = params.get("device") && DEVICES[params.get("device") as string] ? (params.get("device") as string) : "iphone-face";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const chrome = params.get("chrome") !== "0";
  const device = DEVICES[deviceKey];

  const state: LockScreenViewProps["state"] = pstate === "timeout" ? "failed" : pstate;
  const failure = pstate === "timeout" ? "timeout" : pstate === "failed" ? "unconfirmed" : undefined;
  const props: LockScreenViewProps = {
    platform: device.platform,
    biometry: device.biometry,
    state,
    failure,
    errorMessage: state === "failed" ? (failure === "timeout" ? SHIPPED_TIMEOUT : SHIPPED_UNCONFIRMED) : null,
    buildTag: "build 2f3a1c7",
    onUnlock: noop,
    onSignOut: noop,
  };

  const link = (over: Record<string, string>) => {
    const q = new URLSearchParams({ state: pstate, device: deviceKey, mode, ...(chrome ? {} : { chrome: "0" }), ...over });
    return `?${q.toString()}`;
  };
  const pill = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-full px-3 text-[12px] font-semibold ${
      active
        ? "bg-indigo-600 text-white"
        : "bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
    }`;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="flex h-dvh flex-col bg-[#f0f2f7] dark:bg-[#0f172a]">
        {chrome && (
          <nav aria-label="Preview controls" className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            {STATES.map((s) => (
              <a key={s.value} href={link({ state: s.value })} className={pill(s.value === pstate)}>{s.label}</a>
            ))}
            <span className="w-2" />
            {Object.entries(DEVICES).map(([k, d]) => (
              <a key={k} href={link({ device: k })} className={pill(k === deviceKey)}>{d.label}</a>
            ))}
            <a href={link({ mode: mode === "dark" ? "light" : "dark" })} className={pill(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
          </nav>
        )}
        {/* transform makes this the containing block for the fixed lock root */}
        <div className="relative min-h-0 flex-1 overflow-hidden [transform:translateZ(0)]">
          <LockScreenView {...props} />
        </div>
      </div>
    </div>
  );
}
