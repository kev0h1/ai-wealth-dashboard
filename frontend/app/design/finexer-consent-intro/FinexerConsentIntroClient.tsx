"use client";

// G226 design round. This is a MOCK of a third-party page (Finexer's hosted
// consent screen), not a production component: the shipped artifact is
// backend/app/data/finexer_brand/header.html plus CSS synced to Finexer. The
// shell is rebuilt from Kevin's Android screenshots and rendered in an iframe
// so the template CSS cannot leak into this page. Each variant's HTML and CSS
// are the real files under backend/app/data/finexer_brand/intro/ (via
// brand.generated.ts), so the visual check cannot drift from what would ship.

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { VARIANTS, buildDoc, type IntroMode, type IntroVariant } from "./fixtures";

const IDS = VARIANTS.map((v) => v.id);

export default function FinexerConsentIntroClient() {
  const sp = useSearchParams();
  const raw = sp.get("variant");
  const variant: IntroVariant = IDS.includes(raw as IntroVariant) ? (raw as IntroVariant) : "a";
  const mode: IntroMode = sp.get("mode") === "light" ? "light" : "dark";
  const doc = useMemo(() => buildDoc(variant, mode), [variant, mode]);
  const href = (v: string, m: string) => `/design/finexer-consent-intro?variant=${v}&mode=${m}`;
  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-600 text-slate-300"}`;
  const note = VARIANTS.find((v) => v.id === variant)?.note;

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100" style={{ colorScheme: "dark" }}>
      <div className="mx-auto max-w-[430px] px-4 pt-4 pb-3">
        <h1 className="text-lg font-bold">Sorted intro on the Finexer consent page</h1>
        <p className="mt-1 text-xs text-slate-300">
          A mock of Finexer&apos;s hosted page, built from Kevin&apos;s Android screenshots, not a production component.
          The shipped artifact is header.html plus CSS synced to Finexer. The permission list, buttons and regulated
          footer are never touched by the intro.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Variant">
          {VARIANTS.map((v) => (
            <Link key={v.id} href={href(v.id, mode)} className={chip(v.id === variant)} aria-current={v.id === variant}>
              {v.label}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex gap-2" role="group" aria-label="Mode">
          {(["dark", "light"] as const).map((m) => (
            <Link key={m} href={href(variant, m)} className={chip(m === mode)} aria-current={m === mode}>
              {m === "dark" ? "Dark" : "Light"}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-300">{note}</p>
      </div>
      <div className="mx-auto max-w-[430px]">
        <iframe
          key={`${variant}-${mode}`}
          title="Mock Finexer consent page"
          srcDoc={doc}
          className="block w-full border-0"
          style={{ height: 1040 }}
        />
      </div>
    </main>
  );
}
