"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { isNativePlatform, isIOSNative, nativeGoogleLogin, nativeAppleLogin } from "@/lib/nativeAuth";
import { BUILD_TAG } from "@/lib/buildTag";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";

interface LoginScreenProps {
  error?: string | null;
}

export default function LoginScreen({ error }: LoginScreenProps) {
  // Starts false on both server and client so hydration matches (Capacitor
  // doesn't exist during the export build), then flips true post-mount if
  // we're actually running inside the iOS native shell.
  const [showApple, setShowApple] = useState(false);
  useEffect(() => {
    setShowApple(isIOSNative());
  }, []);

  async function handleGoogleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!isNativePlatform()) return; // web: let the href redirect happen as before
    e.preventDefault();
    const ok = await nativeGoogleLogin();
    if (ok) {
      window.location.reload();
    } else {
      alert("Sign-in failed. Please try again.");
    }
  }

  async function handleAppleClick() {
    const ok = await nativeAppleLogin();
    if (ok) {
      window.location.reload();
    } else {
      alert("Sign-in failed. Please try again.");
    }
  }

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
          <p className="text-sm text-slate-600 dark:text-slate-300 text-center mb-6 leading-relaxed">
            Sign in with your Google account to access your dashboard.
          </p>

          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

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
        </div>

        {/* Regulatory disclosure (Q6/A9) — single source of truth in lib/regulatoryCopy.ts */}
        <p className="mt-8 px-4 text-center text-xs leading-relaxed text-slate-400 dark:text-slate-500">
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
