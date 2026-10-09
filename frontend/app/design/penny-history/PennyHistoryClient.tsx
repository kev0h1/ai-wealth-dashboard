"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { PennySheetHeader, PennySheetPanel } from "@/components/PennySheet";
import PennyComposer from "@/components/PennyComposer";
import PennyHistorySheet, { type PennyHistoryRowStyle } from "@/components/PennyHistorySheet";
import PennyOpenLastChatRow from "@/components/PennyOpenLastChatRow";
import { PennyChatIcons, PennyChatMenu, PennyChatToolbar } from "@/components/PennyChatActions";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { usePennyThreadAnchor } from "@/lib/usePennyThreadAnchor";
import { pennyComposerCapState } from "@/lib/pennyConversationSession";
import type { PennyConversationSummary } from "@/lib/api";
import FixtureBottomNav from "../_components/FixtureBottomNav";

// G248 design round: Penny chat history. Renders the PRODUCTION
// PennySheetPanel (fullscreen), PennySheetHeader (toolbar / trailingActions
// props), PennyChatActions, PennyComposer (chatFull), PennyHistorySheet and
// PennyOpenLastChatRow with fixture data through their real props. The thread
// bubbles are hand-authored because PennyConversation fetches its own data,
// so thread logic, chip ordering and the send path are not gated here. No
// Penny call is made and nothing is saved.
//
// A  Quiet toolbar: labelled New chat and History row, flat ledger list with a
//    visible bin, the switch in the history footer.
// B  Single menu: one options button, roomier rows with an options button,
//    the switch in Settings only.
// C  Compact icons: icons beside Close, rows under TODAY and EARLIER, the
//    switch in both homes.

type Variant = "a" | "b" | "c";
type State = "chat" | "list" | "empty" | "cap" | "setting";
type Turn = { id: number; role: "user" | "assistant"; text: string };

const NOW = new Date("2026-10-09T12:00:00Z");
const FIXTURES: PennyConversationSummary[] = [
  { id: "c1", title: "Can I afford a weekend away?", created_at: "2026-10-09T08:12:00Z", updated_at: "2026-10-09T08:20:00Z", preview: "You have £84 free until payday, so a cheap weekend is possible.", turn_count: 6, at_cap: false },
  { id: "c2", title: "Why is my food spending up?", created_at: "2026-10-08T17:02:00Z", updated_at: "2026-10-08T17:09:00Z", preview: "Two big shops landed in the same week.", turn_count: 4, at_cap: false },
  { id: "c3", title: "What is coming out before payday?", created_at: "2026-10-05T07:30:00Z", updated_at: "2026-10-05T07:34:00Z", preview: "Three bills, £212 in total, the largest on the 12th.", turn_count: 4, at_cap: false },
  { id: "c4", title: "How is my card balance changing?", created_at: "2026-09-28T19:40:00Z", updated_at: "2026-09-28T19:55:00Z", preview: "It grew by £46 this pay period.", turn_count: 8, at_cap: false },
  { id: "c5", title: "Set aside £50 for the boiler service", created_at: "2026-09-21T10:00:00Z", updated_at: "2026-09-21T10:06:00Z", preview: "I can set that up for you to confirm.", turn_count: 2, at_cap: false },
];
const THREAD: Turn[] = [
  { id: 1, role: "user", text: "Can I afford a weekend away?" },
  { id: 2, role: "assistant", text: "You have £84 free until payday, so a cheap weekend is possible. A hotel would not fit." },
  { id: 3, role: "user", text: "What if I drive?" },
  { id: 4, role: "assistant", text: "Fuel for the trip is around £40, which still leaves you about £44 free." },
  { id: 5, role: "user", text: "And food?" },
  { id: 6, role: "assistant", text: "Packing lunches keeps it inside what is left." },
];

const PLANS: Record<Variant, { rowStyle: PennyHistoryRowStyle; footerSetting: boolean; settingsSetting: boolean; actions: string; setting: string }> = {
  a: { rowStyle: "ledger", footerSetting: true, settingsSetting: false, actions: "Quiet toolbar", setting: "In the history sheet" },
  b: { rowStyle: "overflow", footerSetting: false, settingsSetting: true, actions: "Single menu", setting: "In Settings" },
  c: { rowStyle: "sections", footerSetting: true, settingsSetting: true, actions: "Compact icons", setting: "In both" },
};

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const subscribeToMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function PreviewWindow({ open, onClose, variant, state }: { open: boolean; onClose: () => void; variant: Variant; state: State }) {
  const plan = PLANS[variant];
  const mounted = useSyncExternalStore(subscribeToMount, clientMounted, serverMounted);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(state === "list" || state === "empty" || (state === "setting" && plan.footerSetting && !plan.settingsSetting));
  const [conversations, setConversations] = useState<PennyConversationSummary[]>(state === "empty" ? [] : FIXTURES);
  const [messages, setMessages] = useState<Turn[]>(state === "cap" ? [...THREAD, ...THREAD.map(t => ({ ...t, id: t.id + 10 }))].slice(0, 12) : THREAD);
  const [full, setFull] = useState(state === "cap");
  const [openLast, setOpenLast] = useState(false);
  const [usageShown, setUsageShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
  const { anchorToLatest, onScroll } = usePennyThreadAnchor(thread, open);
  useLayoutEffect(() => { if (open && thread.current) anchorToLatest(); }, [open, messages, historyOpen, anchorToLatest]);

  function newChat() { setMessages([]); setFull(false); setHistoryOpen(false); setInput(""); }
  function resume(id: string) { void id; setMessages(THREAD); setFull(false); setHistoryOpen(false); }
  const capState = pennyComposerCapState(full);

  const actionHandlers = { onNewChat: newChat, onHistory: () => setHistoryOpen(true) };
  const toolbar = variant === "a" ? <PennyChatToolbar {...actionHandlers} /> : undefined;
  const trailing = variant === "b" ? <PennyChatMenu {...actionHandlers} /> : variant === "c" ? <PennyChatIcons {...actionHandlers} /> : undefined;

  if (!mounted) return null;
  return createPortal(<>
    {open && <div aria-hidden="true" className="fixed inset-0 z-[56] touch-none" onClick={close} />}
    <PennySheetPanel isOpen={open} panelRef={open ? ref : undefined} presentation="fullscreen">
      {historyOpen && <PennyHistorySheet
        conversations={conversations} activeId="c1" rowStyle={plan.rowStyle} now={NOW}
        onResume={resume} onClose={() => setHistoryOpen(false)}
        onDelete={id => setConversations(list => list.filter(c => c.id !== id))}
        footer={plan.footerSetting ? <PennyOpenLastChatRow checked={openLast} onChange={setOpenLast} /> : undefined}
      />}
      <div className={historyOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <div className="shrink-0" onClickCapture={event => {
          if ((event.target as HTMLElement).closest('a[href="#preview-info"]')) event.preventDefault();
        }}>
          <PennySheetHeader pennyUsed={3} pennyLimit={20} usageRevealed={usageShown}
            handleAvatarTap={() => setUsageShown(v => !v)} close={close}
            headerLinks={[{ label: "Your plan and updates", href: "#preview-info" }]}
            toolbar={toolbar} trailingActions={trailing} />
        </div>
        <div ref={thread} data-penny-scroll role="log" aria-label="Preview conversation" aria-live="polite" aria-relevant="additions text"
          onScroll={onScroll}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4 pt-3 text-[14px] leading-6 [scrollbar-width:thin]">
          {messages.length === 0 && <p className="text-slate-600 dark:text-slate-300">Ask me about your money. This is a new chat.</p>}
          {messages.map(turn => <div key={turn.id} className={turn.role === "user" ? "ml-8 break-words rounded-2xl bg-indigo-50 px-3 py-2 text-slate-900 dark:bg-indigo-950 dark:text-slate-100" : "mr-4 break-words text-slate-700 dark:text-slate-200"}>
            <span className="sr-only">{turn.role === "user" ? "You" : "Penny"}: </span>{turn.text}
          </div>)}
        </div>
        <div data-penny-composer-wrap className="shrink-0 border-t border-slate-200/70 px-4 pb-3 pt-2 dark:border-slate-700">
          <PennyComposer inputRef={inputRef} value={input} onChange={setInput} onSend={() => setInput("")}
            placeholder="Ask Penny a question…" loading={false} atCap={false}
            chatFull={capState.notice && capState.action ? { notice: capState.notice, actionLabel: capState.action, onAction: newChat } : undefined} />
        </div>
      </div>
    </PennySheetPanel>
  </>, document.body);
}

export default function PennyHistoryClient() {
  const params = useSearchParams();
  const v = params.get("variant");
  const variant: Variant = v === "b" || v === "c" ? v : "a";
  const s = params.get("state");
  const state: State = s === "list" || s === "empty" || s === "cap" || s === "setting" ? s : "chat";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(params.get("open") === "1" || (s !== null && !(s === "setting" && PLANS[variant].settingsSetting)));
  const [pageOpenLast, setPageOpenLast] = useState(false);
  const plan = PLANS[variant];
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const href = (over: Partial<{ variant: string; state: string; mode: string }>) =>
    `?variant=${over.variant ?? variant}&state=${over.state ?? state}&mode=${over.mode ?? mode}`;
  const link = (label: string, over: Partial<{ variant: string; state: string; mode: string }>, active: boolean) =>
    <a key={label} href={href(over)} aria-current={active ? "true" : undefined}
      className={`${button} ${active ? "bg-indigo-600 text-white" : "text-slate-700 dark:text-slate-200"}`}>{label}</a>;

  return <main className="min-h-dvh bg-slate-100 px-4 pb-36 pt-6 text-slate-900 dark:bg-slate-900 dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Penny chat history</h1>
      <p id="preview-info" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Three proposals for where New chat and History live, what the history list looks like, and where the Open my last chat switch lives. The full-screen sheet, header, composer, history sheet and switch row are the production components with fixture data; the conversation bubbles are hand-authored because the live conversation fetches its own data, so its thread logic and send path are not gated here. Nothing is sent or saved.</p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><strong>Variant {variant.toUpperCase()}</strong>: {plan.actions} in the header, switch {plan.setting.toLowerCase()}.</p>

      {state === "setting" && plan.settingsSetting && (
        <section aria-label="Settings Penny card" className="mt-4">
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 px-4 pt-4">
              <MessageCircle size={18} aria-hidden="true" className="text-slate-500 dark:text-slate-400" />
              <h2 className="text-base font-bold">Penny</h2>
            </div>
            <PennyOpenLastChatRow inset="card" checked={pageOpenLast} onChange={setPageOpenLast} />
          </div>
        </section>
      )}
      <nav aria-label="Variant" className="mt-4 flex flex-wrap gap-2">
        {(["a", "b", "c"] as const).map(x => link(`Variant ${x.toUpperCase()}`, { variant: x }, x === variant))}
      </nav>
      <nav aria-label="State" className="mt-2 flex flex-wrap gap-2">
        {([["Chat", "chat"], ["History", "list"], ["No history", "empty"], ["Chat full", "cap"], ["Setting", "setting"]] as const).map(([label, st]) => link(label, { state: st }, st === state))}
      </nav>
      <nav aria-label="Theme" className="mt-2 flex flex-wrap gap-2">
        <a className={button} href={href({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light" : "Dark"} theme</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-4 bg-indigo-600 px-5 text-white`}>Open Penny</button>

    </div>
    <div data-penny-navigation><FixtureBottomNav active="Home" onPennyClick={() => setOpen(v2 => !v2)} pennyExpanded={open} /></div>
    <PreviewWindow key={`${variant}-${state}`} open={open} onClose={() => setOpen(false)} variant={variant} state={state} />
  </main>;
}
