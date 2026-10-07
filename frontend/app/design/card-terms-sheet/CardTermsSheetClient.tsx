"use client";

// G225 card terms sheet, alignment to the existing system (impeccable, no
// variant round). Renders the PRODUCTION CardTermsSheet through its real props
// (cards, ready, startAccountId, onClose, onSaved) with fixture cards.
// One stand-in, said plainly: the sheet asks POST /card-terms/<id>/lookup for
// the representative rate when a card has no confirmed terms, so a fetch
// stand-in answers only that endpoint and passes everything else through.

import { useEffect, useLayoutEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import CardTermsSheet from "@/components/CardTermsSheet";
import { CARDS, CASES, lookupFor, type CardCase } from "./fixtures";

type Mode = "light" | "dark";
const noop = () => {};
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const ALL_CARDS = Object.values(CARDS);

export default function CardTermsSheetClient() {
  const params = useSearchParams();
  const raw = params.get("card") ?? params.get("state");
  const card: CardCase = raw === "lookup" || raw === "zero" || raw === "promos" ? raw : "balance";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(true);
  const current = CASES.find(c => c.id === card)!;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  useIsoLayoutEffect(() => {
    const native = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const m = /\/card-terms\/([^/]+)\/lookup(?:[?]|$)/.exec(url);
      if (m) {
        return new Response(JSON.stringify(lookupFor(decodeURIComponent(m[1]))), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return native(input, init);
    }) as typeof window.fetch;
    return () => { window.fetch = native; };
  }, []);

  const href = (n: Partial<{ card: CardCase; mode: Mode }>) => `?card=${n.card ?? card}&mode=${n.mode ?? mode}`;
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;

  return (
    <div className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100`} style={{ colorScheme: mode }}>
      <nav aria-label="G225 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
          {CASES.map(c => (
            <a key={c.id} href={href({ card: c.id })} aria-current={c.id === card ? "page" : undefined} className={chip(c.id === card)}>{c.label}</a>
          ))}
          <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
          <a href={href({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
        </div>
      </nav>
      <main id="content" className="mx-auto max-w-md px-4 pb-24 pt-5">
        <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
          <ArrowLeft size={16} aria-hidden="true" />
          Design rounds
        </a>
        <h1 className="mt-2 text-balance text-[22px] font-bold tracking-[-.02em] text-slate-950 dark:text-white">Card terms sheet</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{current.note}</p>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="mt-4 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:scale-95">Open the sheet</button>
        )}
      </main>
      {open && (
        <CardTermsSheet
          key={card}
          cards={ALL_CARDS}
          ready
          startAccountId={CARDS[card].account_id}
          onClose={() => setOpen(false)}
          onSaved={noop}
        />
      )}
    </div>
  );
}
