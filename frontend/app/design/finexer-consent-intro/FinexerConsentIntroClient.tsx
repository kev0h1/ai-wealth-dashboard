"use client";

// G226 design round. This is a MOCK of a third-party page (Finexer's hosted
// consent screen), not a production component: the shipped artifact is
// backend/app/data/finexer_brand/header.html plus CSS synced to Finexer. The
// shell is rebuilt from Kevin's Android screenshots and rendered in an iframe
// so the template CSS cannot leak into this page. Each variant's HTML and CSS
// are the shipped header.html and sorted*.css (via brand.generated.ts), so the
// visual check cannot drift from what ships.

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buildDoc, type IntroMode } from "./fixtures";

export default function FinexerConsentIntroClient() {
  const sp = useSearchParams();
  const mode: IntroMode = sp.get("mode") === "light" ? "light" : "dark";
  const doc = useMemo(() => buildDoc(mode), [mode]);
  const href = (m: string) => `/design/finexer-consent-intro?mode=${m}`;
  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-600 text-slate-300"}`;

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100" style={{ colorScheme: "dark" }}>
      <div className="mx-auto max-w-[430px] px-4 pt-4 pb-3">
        <h1 className="text-lg font-bold">Sorted intro on the Finexer consent page</h1>
        <p className="mt-1 text-xs text-slate-300">
          A mock of Finexer&apos;s hosted page, built from Kevin&apos;s Android screenshots, not a production component.
          Approved A, folded in. The shipped artifact is header.html plus CSS synced to Finexer. The permission list, buttons and regulated
          footer are never touched by the intro. The dim permission headings in Kevin&apos;s screenshots are Finexer&apos;s own styling, pending A147&apos;s effect.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Mode">
          {(["dark", "light"] as const).map((m) => (
            <Link key={m} href={href(m)} className={chip(m === mode)} aria-current={m === mode}>
              {m === "dark" ? "Dark" : "Light"}
            </Link>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[430px]">
        <iframe
          key={mode}
          title="Mock Finexer consent page"
          srcDoc={doc}
          className="block w-full border-0"
          style={{ height: 1040 }}
        />
      </div>
    </main>
  );
}
