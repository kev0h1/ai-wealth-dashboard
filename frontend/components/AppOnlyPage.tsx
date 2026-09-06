"use client";

import { useState } from "react";
import Link from "next/link";
import LoginScreen from "@/components/LoginScreen";
import StoreBadges from "@/components/StoreBadges";

// The web-only shell (backlog A10). AuthProvider.tsx renders this in place
// of the real product on every route when NEXT_PUBLIC_WEB_PRODUCT=off and
// the signed-in session isn't the owner's — anonymous visitors land here
// too, since there is no separate marketing page in this app. Calm Cockpit:
// same canvas colours as the rest of the shell, no card, no Penny gradient
// (that belongs to the AI adviser alone, see DESIGN.md's Penny Gradient
// Rule), just the mark, the verdict-style headline, one supporting line,
// the store badges, and a quiet footer.
//
// "Owner sign-in" swaps this shell for the real LoginScreen in place, kept
// as local component state rather than a prop, so this component works
// identically whether AuthProvider renders it for a locked-out visitor or
// the /design/app-only preview renders it standalone.
export default function AppOnlyPage() {
  const [showSignIn, setShowSignIn] = useState(false);

  if (showSignIn) {
    return <LoginScreen error={null} />;
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-7 px-6 py-12 text-center bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-sm">
        {/* Plain <img>, not next/image — this shell can render for an
            anonymous visitor before any optimizer route is warm, and the
            mobile export never reaches this component at all (see
            scripts/build-mobile.sh). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="Sorted" width={80} height={80} className="w-full h-full object-cover" />
      </div>

      <div className="max-w-xs space-y-2">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.025em] text-slate-900 dark:text-slate-100">
          Sorted is an app.
        </h1>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Get it on your phone to see where your money stands.
        </p>
      </div>

      <StoreBadges />

      <footer className="mt-4 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
          <Link href="/terms" className="hover:underline">Terms</Link>
          <span aria-hidden="true">&middot;</span>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
        </div>
        <button
          type="button"
          onClick={() => setShowSignIn(true)}
          className="text-[11px] text-slate-400 dark:text-slate-600 hover:underline active:scale-95 transition-transform motion-reduce:transition-none"
        >
          Owner sign-in
        </button>
      </footer>
    </div>
  );
}
