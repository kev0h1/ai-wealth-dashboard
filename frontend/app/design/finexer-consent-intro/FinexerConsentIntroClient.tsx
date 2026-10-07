"use client";

// G226 design round, A151 agent-name correction. This is a MOCK of a third-party page (Finexer's hosted
// consent screen), not a production component: the shipped artifact is
// backend/app/data/finexer_brand/header.html plus CSS synced to Finexer. The
// shell is rebuilt from Kevin's Android screenshots and rendered in an iframe
// so the template CSS cannot leak into this page. The header, CSS and app_name
// are the real files under backend/app/data/finexer_brand and finexer_template.py (via
// brand.generated.ts), so the visual check cannot drift from what would ship.

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
        <h1 className="text-lg font-bold">Finexer consent page template (AURIQ LTD agent, Sorted intro)</h1>
        <p className="mt-1 text-xs text-slate-300">
          A mock of Finexer&apos;s hosted page, built from Kevin&apos;s Android screenshots, not a production component.
          The shipped artifact is header.html plus CSS synced to Finexer. The headline and footer show the template's app_name, AURIQ LTD, because Finexer substitutes it there; the Sorted identity is the logo and intro. The permission list, buttons and regulated
          footer are never resized, dimmed or hidden by our CSS. The Light chip shows the light tokens only, while the real light template switches to dark tokens on a phone set to dark. The dim permission headings in Kevin&apos;s screenshots are Finexer&apos;s own styling, handled on A147, not this round.
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
          style={{ height: 1160 }}
        />
      </div>
    </main>
  );
}
