"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// The decision this preview exists to settle: should Penny's conversation
// stop being a full-page destination (components/PennyConversation.tsx at
// /penny) and instead open as a bottom sheet from the Penny icon in the
// bottom nav, over whatever page the user is already on? And inside that
// sheet, which answer grammar wins: Grammar A "cards" (the variant C inset
// question layout already picked from /design/penny-thread) or Grammar B
// "bubbles" (a real messenger treatment, built well, not a straw man)?
//
// Deep-linkable: /design/penny-sheet?g=cards|bubbles&mode=light|dark.
// The sheet opens automatically on load (so a bookmarked link shows the
// thing being judged immediately) and can be closed/reopened via the
// raised Penny nav button, same as it would in production. Switching `g`
// with the in-sheet segmented control does NOT close or remount the sheet,
// conversation state (any turns typed into the live composer) survives
// the switch.
//
// This route only reads/imports lib/useSheetA11y.ts, lib/useLockBodyScroll.ts,
// lib/useSheetOpen.ts, components/MoneyText.tsx, components/ChatMarkdown.tsx,
// components/PennyMark.tsx and lib/brand.ts (all read-only references, none
// edited). It does NOT import components/PennyConversation.tsx,
// components/BottomNav.tsx, components/CommitmentSheet.tsx, or lib/api.ts,
// everything nav/sheet-shaped here is a local, self-contained stand-in.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MockPlanningBackdrop from "./MockPlanningBackdrop";
import MockBottomNav from "./MockBottomNav";
import PennySheet, { type Grammar } from "./PennySheet";
import { buildInitialThread, cannedReply, PREVIEW_NOTE, type ThreadItem } from "./fixtures";

type Mode = "light" | "dark";

function isGrammar(v: string | null): v is Grammar {
  return v === "cards" || v === "bubbles";
}

export default function PennySheetClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const gParam = searchParams.get("g");
  const grammar: Grammar = isGrammar(gParam) ? gParam : "cards";

  // Starts false and flips true in an effect, not useState(true) directly.
  // PennySheet's shell portals via createPortal(..., document.body), which
  // needs a client-only pass, "document" doesn't exist during SSR. If this
  // defaulted to true, the sheet would try to render (and portal) on the
  // server too. CommitmentSheet/BankPickerSheet dodge this for free because
  // their parents never render them with an already-true initial state;
  // this route deliberately DOES want the sheet open on load ("a bookmarked
  // link shows the thing being judged immediately"), so it opens itself a
  // tick after mount instead.
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ThreadItem[]>(() => buildInitialThread());
  const nextId = useRef(1000);

  useEffect(() => {
    setOpen(true);
  }, []);

  // Theme toggle — same pattern as sibling /design/* routes.
  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const setGrammar = useCallback(
    (g: Grammar) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("g", g);
      // Keeps the sheet's own component tree mounted, this is a query-param
      // change on the same route, not a navigation, so `open`/`items` state
      // (declared above, in this same component) is untouched.
      router.replace(`/design/penny-sheet?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  function handleSend(question: string) {
    const pendingId = nextId.current++;
    setItems((prev) => [...prev, { id: pendingId, kind: "pending", question }]);
    // Simulated round-trip only, no network call, this is a static preview.
    // The delay and resolution both drive the thread's own autoscroll
    // (see PennySheet.tsx's effect keyed on items.length) so it's visibly
    // exercised, not just asserted.
    setTimeout(() => {
      const reply = cannedReply(question);
      setItems((prev) => prev.map((it) => (it.id === pendingId ? { ...reply, id: pendingId } : it)));
    }, 900);
  }

  const otherMode: Mode = mode === "dark" ? "light" : "dark";
  const modeHref = (m: Mode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", m);
    return `/design/penny-sheet?${params.toString()}`;
  };

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div id="app-shell" className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] transition-[filter] duration-200">
        <div className="mx-auto max-w-[430px] pt-3 px-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{PREVIEW_NOTE}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={modeHref(otherMode)}
              className="inline-flex items-center min-h-[36px] rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15 active:scale-95 transition-transform"
            >
              {otherMode === "dark" ? "Dark" : "Light"}
            </a>
            <a href="/design" className="inline-flex items-center min-h-[36px] text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2">
              ‹ All previews
            </a>
            {!open && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center min-h-[36px] rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-white active:scale-95 transition-transform"
                style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
              >
                Reopen sheet
              </button>
            )}
          </div>
        </div>

        <MockPlanningBackdrop />
        <MockBottomNav onPennyTap={() => setOpen((v) => !v)} pennyOpen={open} />
      </div>

      {open && (
        <PennySheet
          grammar={grammar}
          onGrammarChange={setGrammar}
          items={items}
          onSend={handleSend}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
