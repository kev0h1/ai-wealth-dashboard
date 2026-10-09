"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PennySheetHeader, PennySheetPanel } from "@/components/PennySheet";
import PennyComposer from "@/components/PennyComposer";
import PennyStarterState from "@/components/PennyStarterState";
import { PennyChatToolbar } from "@/components/PennyChatActions";
import PennyHistorySheet from "@/components/PennyHistorySheet";
import PennyOpenLastChatRow from "@/components/PennyOpenLastChatRow";
import type { PennyConversationSummary } from "@/lib/api";
import { SuggestionChip } from "@/components/PennyConversation";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { usePennyThreadAnchor } from "@/lib/usePennyThreadAnchor";
import FixtureBottomNav from "../_components/FixtureBottomNav";

// G240 gate preview (variant A, Clear runway, approved by Kevin 2026-10-08).
// Renders the PRODUCTION PennySheetPanel (presentation="fullscreen", the same
// prop PennySheet passes), PennySheetHeader, PennyComposer, the empty-state
// layout (PennyStarterState) and the production SuggestionChip. Not the real
// thing: PennyConversation itself fetches its own data (canISuggestions,
// Penny sends), so its thread logic, chip ordering and send path are NOT
// exercised here; the chip labels below are fixtures and the replies are
// local. The empty-state gate is therefore a partial copy of the data source
// only (CLAUDE.md exception), not of the markup. No Penny call is made.
//
// G248 (variant A, Quiet toolbar, approved by Kevin 2026-10-09): the header
// toolbar row (PennyChatToolbar through PennySheetHeader's `toolbar` prop) and
// the history sheet (PennyHistorySheet with the PennyOpenLastChatRow footer)
// are the production components with fixture rows. The stored-chat session
// (create on first send, resume, load-latest, cap) lives in PennyConversation
// and lib/pennyChatController.ts, covered by check:g248-penny-history, not
// by this page. ?history=1 opens the history sheet.

const NOW = new Date("2026-10-09T12:00:00Z");
const HISTORY: PennyConversationSummary[] = [
  { id: "c1", title: "Can I afford a weekend away?", created_at: "2026-10-09T08:12:00Z", updated_at: "2026-10-09T08:20:00Z", preview: "You have £84 free until payday, so a cheap weekend is possible.", turn_count: 6, at_cap: false },
  { id: "c2", title: "Why is my food spending up?", created_at: "2026-10-08T17:02:00Z", updated_at: "2026-10-08T17:09:00Z", preview: "Two big shops landed in the same week.", turn_count: 4, at_cap: false },
  { id: "c3", title: "What is coming out before payday?", created_at: "2026-10-05T07:30:00Z", updated_at: "2026-10-05T07:34:00Z", preview: "Three bills, £212 in total, the largest on the 12th.", turn_count: 4, at_cap: false },
  { id: "c4", title: "How is my card balance changing?", created_at: "2026-09-28T19:40:00Z", updated_at: "2026-09-28T19:55:00Z", preview: "It grew by £46 this pay period.", turn_count: 8, at_cap: false },
];

type Turn = { id: number; role: "user" | "assistant"; text: string };

const STARTERS = ["What is coming up?", "Explain my forecast", "What should I check before payday?"];
const LONG: Turn[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, role: i % 2 ? "assistant" : "user",
  text: i % 2 ? "Check the account a payment will leave from, as well as your overall balance. Money in another account does not cover it automatically." : "Which account do I need to check, and how does the forecast work?",
}));
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const subscribeToMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function PreviewWindow({ open, onClose, seed, startHistory }: { open: boolean; onClose: () => void; seed: string; startHistory: boolean }) {
  const mounted = useSyncExternalStore(subscribeToMount, clientMounted, serverMounted);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Turn[]>(seed === "long" ? LONG : []);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(startHistory);
  const [chats, setChats] = useState<PennyConversationSummary[]>(HISTORY);
  const [openLast, setOpenLast] = useState(false);
  const [usageShown, setUsageShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
  const { anchorToLatest, onScroll } = usePennyThreadAnchor(thread, open);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  useLayoutEffect(() => { if (open && thread.current) anchorToLatest(); }, [open, messages, loading, anchorToLatest]);

  function ask(text: string) {
    const q = text.trim();
    if (loading || !q) return;
    setMessages(prev => [...prev, { id: Date.now(), role: "user", text: q }]);
    setInput("");
    setLoading(true);
    timeout.current = setTimeout(() => {
      setLoading(false);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "assistant", text: "This is a local preview reply. Nothing has been sent to Penny or saved to your account." }]);
    }, 700);
  }

  const empty = messages.length === 0 && !loading;
  const wrapPad = "px-4 pt-2 pb-3";

  if (!mounted) return null;
  return createPortal(<>
    {open && <div aria-hidden="true" className="fixed inset-0 z-[56] touch-none" onClick={close} />}
    <PennySheetPanel isOpen={open} panelRef={open ? ref : undefined} presentation="fullscreen">
      {historyOpen && <PennyHistorySheet
        conversations={chats} activeId="c1" now={NOW}
        onResume={() => { setMessages(LONG); setHistoryOpen(false); }}
        onDelete={id => setChats(list => list.filter(c => c.id !== id))}
        onClose={() => setHistoryOpen(false)}
        footer={<PennyOpenLastChatRow checked={openLast} onChange={setOpenLast} />}
      />}
      <div className={historyOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
      <div className="shrink-0" onClickCapture={event => {
        if ((event.target as HTMLElement).closest('a[href="#preview-info"]')) event.preventDefault();
      }}>
        <PennySheetHeader pennyUsed={3} pennyLimit={20} usageRevealed={usageShown}
          handleAvatarTap={() => setUsageShown(v => !v)} close={close}
          headerLinks={[{ label: "Your plan and updates", href: "#preview-info" }]}
          toolbar={<PennyChatToolbar onNewChat={() => { setMessages([]); setInput(""); }} onHistory={() => setHistoryOpen(true)} />} />
      </div>

      <div ref={thread} data-penny-scroll role="log" aria-label="Preview conversation" aria-live="polite" aria-relevant="additions text"
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 text-[14px] leading-6 [scrollbar-width:thin]">
        {empty && <PennyStarterState>
          {STARTERS.map(label => <SuggestionChip key={label} label={label} onTap={() => setInput(label)} />)}
        </PennyStarterState>}
        {messages.map(turn => <div key={turn.id} className={turn.role === "user" ? "ml-8 break-words rounded-2xl bg-indigo-50 px-3 py-2 text-slate-900 dark:bg-indigo-950 dark:text-slate-100" : "mr-4 break-words text-slate-700 dark:text-slate-200"}>
          <span className="sr-only">{turn.role === "user" ? "You" : "Penny"}: </span>{turn.text}
        </div>)}
        {loading && <p role="status" className="text-slate-500 dark:text-slate-400">Preparing preview reply…</p>}
      </div>

      <div data-penny-composer-wrap className={`shrink-0 border-t border-slate-200/70 dark:border-slate-700 ${wrapPad}`}>
        <PennyComposer inputRef={inputRef} value={input} onChange={setInput} onSend={() => ask(input)}
          placeholder="Ask Penny a question…" loading={loading} atCap={false} />
      </div>
      </div>
    </PennySheetPanel>
  </>, document.body);
}

export default function PennyFullscreenClient() {
  const params = useSearchParams();
  const seed = (params.get("thread") ?? params.get("state")) === "long" ? "long" : "empty";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const startHistory = params.get("history") === "1";
  const [open, setOpen] = useState(params.get("open") === "1" || startHistory);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const href = (m = mode, s = seed) => `?mode=${m}&thread=${s}`;

  return <main className="min-h-dvh bg-slate-100 px-4 pb-36 pt-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Ask Penny, full screen</h1>
      <p id="preview-info" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">The sheet runs from the top safe area to the bottom safe area on a solid surface, so nothing of the page shows around it, with or without the keyboard. Open it, tap the input and type on your phone. The empty conversation shows a heading and starter chips that step aside once you type. Replies are local, not live advice. The chip labels and replies are fixtures, and the live conversation's thread logic and send path are not gated by this page.</p>
      <div className="mt-4 rounded-2xl bg-white p-4 text-sm dark:bg-slate-800">
        <p className="font-semibold">Tip card on the page behind</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">If any of this shows above or around the open sheet, the takeover has leaked.</p>
      </div>
      <nav aria-label="Options" className="mt-4 flex flex-wrap gap-2">
        <a className={button} href={href(mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light" : "Dark"} theme</a>
        <a className={button} href={href(mode, seed === "long" ? "empty" : "long")}>{seed === "long" ? "Start empty" : "Start with a long thread"}</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-5 bg-indigo-600 px-5 text-white`}>Open Penny</button>
      <section className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Try on both phones</h2><p className="mt-1">Open Penny and check the header clears the clock and notch. Tap the input: the page behind must not show above or beside the sheet, the composer sits on the keyboard, and the starter content steps aside. Dismiss the keyboard and it returns. Rotate, send a message, close. A hardware or headless browser cannot show a real software keyboard.</p></section>
    </div>
    <div data-penny-navigation><FixtureBottomNav active="Home" onPennyClick={() => setOpen(v => !v)} pennyExpanded={open} /></div>
    <PreviewWindow key={seed} open={open} onClose={() => setOpen(false)} seed={seed} startHistory={startHistory} />
  </main>;
}
