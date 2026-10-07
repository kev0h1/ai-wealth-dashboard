"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { PennySheetHeader, PennySheetPanel } from "@/components/PennySheet";
import PennyComposer from "@/components/PennyComposer";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { usePennyThreadAnchor } from "@/lib/usePennyThreadAnchor";
import FixtureBottomNav from "../_components/FixtureBottomNav";

type Turn = { id: number; role: "user" | "assistant"; text: string };
const SHORT: Turn[] = [
  { id: 1, role: "user", text: "What should I check before payday?" },
  { id: 2, role: "assistant", text: "Start with Upcoming. It shows what is expected to leave each account and highlights anything that needs a look." },
];
const LONG: Turn[] = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1, role: index % 2 ? "assistant" : "user",
  text: index % 2 ? "Check the account a payment will leave from, as well as your overall balance. Money in another account does not cover it automatically. You can open an account to see how its forecast adds up." : "Can you explain which account I need to check and how the forecast works?",
}));
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const subscribeToMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function PreviewWindow({ open, onClose, scenario }: {
  open: boolean; onClose: () => void; scenario: string;
}) {
  const mounted = useSyncExternalStore(subscribeToMount, clientMounted, serverMounted);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Turn[]>(scenario === "empty" ? [] : scenario === "long" ? LONG : SHORT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [usageShown, setUsageShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
  const { anchorToLatest, onScroll } = usePennyThreadAnchor(thread, open);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  useLayoutEffect(() => {
    if (open && thread.current) {
      anchorToLatest();
    }
  }, [open, messages, loading, error, anchorToLatest]);

  function reply(retry = false) {
    if (loading || (!retry && !input.trim())) return;
    if (!retry) {
      setMessages(previous => [...previous, { id: Date.now(), role: "user", text: input.trim() }]);
      setInput("");
    }
    setError(false);
    setLoading(true);
    timeout.current = setTimeout(() => {
      setLoading(false);
      if (scenario === "error" && !retry) { setError(true); return; }
      setMessages(previous => [...previous, { id: Date.now(), role: "assistant", text: "This is a local preview reply. Your draft and conversation stay in place when the keyboard opens or closes. Nothing has been sent to Penny or saved to your account." }]);
    }, 900);
  }

  if (!mounted) return null;
  return createPortal(<>
    {open && <div aria-hidden="true" className="fixed inset-0 z-[56] touch-none" onClick={close} />}
    <PennySheetPanel isOpen={open} panelRef={open ? ref : undefined}>
      <div className="shrink-0" onClickCapture={event => {
        // Let the shared header close through the sheet's history entry,
        // without adding a competing fragment navigation in this fixture.
        if ((event.target as HTMLElement).closest('a[href="#preview-info"]')) event.preventDefault();
      }}>
        <PennySheetHeader pennyUsed={3} pennyLimit={20} usageRevealed={usageShown}
          handleAvatarTap={() => setUsageShown(value => !value)} close={close}
          headerLinks={[{ label: "Preview only · no live data", href: "#preview-info" }]} />
      </div>
      <div data-penny-secondary className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 px-5 py-2 dark:border-slate-700" aria-label="Example questions">
        {["What is coming up?", "Explain my forecast"].map(label => <button type="button" key={label}
          className="min-h-11 shrink-0 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-200"
          onClick={() => setInput(label)}>{label}</button>)}
      </div>
      <div ref={thread} data-penny-thread role="log" aria-label="Preview conversation" aria-live="polite" aria-relevant="additions text"
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 text-[13px] leading-5 [scrollbar-width:thin]">
        {!messages.length && <p className="text-slate-600 dark:text-slate-300">Ask a question below. This preview uses local replies, not your accounts.</p>}
        {messages.map(turn => <div key={turn.id} className={turn.role === "user" ? "ml-6 break-words rounded-2xl bg-indigo-50 px-3 py-2 text-slate-900 dark:bg-indigo-950 dark:text-slate-100" : "mr-3 break-words text-slate-700 dark:text-slate-200"}>
          <span className="sr-only">{turn.role === "user" ? "You" : "Penny"}: </span>{turn.text}
        </div>)}
        {loading && <p role="status" className="text-slate-500 dark:text-slate-400">Preparing preview reply…</p>}
        {error && <div><p role="alert">The preview reply could not load. Your question is still here.</p><button type="button" className={`${button} mt-2 border border-slate-300 dark:border-slate-600`} onClick={() => reply(true)}><RefreshCw size={16} aria-hidden="true" />Try again</button></div>}
      </div>
      <div data-penny-composer-wrap className="shrink-0 px-5 pb-6 pt-2">
        <PennyComposer inputRef={inputRef} value={input} onChange={setInput} onSend={() => reply()}
          placeholder="Ask Penny a question…" loading={loading} atCap={false} />
      </div>
    </PennySheetPanel>
  </>, document.body);
}

export default function PennyKeyboardClient() {
  const params = useSearchParams();
  const scenario = ["short", "long", "empty", "error"].includes(params.get("state") ?? "") ? params.get("state")! : "short";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const href = (s = scenario, m = mode) => `?state=${s}&mode=${m}`;

  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-36 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Typing with Penny</h1>
      <p id="preview-info" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Open Penny, then tap the input on your phone. Nothing moves when you tap. Once the keyboard is up, the window takes over the screen, once, as the approved conversation-first layout: a compact header, the links and question shortcuts step aside, the conversation fills the space and the input with its note sits on the keyboard. The navigation and Penny button step aside and the page behind cannot scroll. Nothing changes afterwards, and dismissing the keyboard brings the links and shortcuts back. A hardware keyboard changes nothing. These are local example conversations, not live Penny messages.</p>
      <nav aria-label="Theme" className="mt-4 flex flex-wrap gap-2">
        <a className={button} href={href(scenario, mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light" : "Dark"} theme</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-5 bg-indigo-600 px-5 text-white`}>Open Penny</button>
      <nav aria-label="Conversation examples" className="mt-6 flex flex-wrap gap-2">
        {([['short','Short thread'],['long','Long thread'],['empty','Empty'],['error','Reply error']] as const).map(([value,label]) => <a key={value} href={href(value)} aria-current={scenario === value ? "page" : undefined} className={`${button} ${scenario === value ? "bg-white dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>{label}</a>)}
      </nav>
      <section className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Try on both phones</h2><p className="mt-1">Type, send a message, dismiss the keyboard, reopen it, then close Penny. Try a long thread and rotate the phone. The window should not move when you tap, then take over the screen once, with a compact header (a clear gap between its line and the close button), no links or shortcuts, the input and its note fully visible on the keyboard edge, no scrolling of the page behind, and your draft kept. Browser emulation cannot verify a real software keyboard.</p></section>
    </div>
    <div data-penny-navigation><FixtureBottomNav active="Home" onPennyClick={() => setOpen(value => !value)} pennyExpanded={open} /></div>
    <PreviewWindow open={open} onClose={() => setOpen(false)} scenario={scenario} />
  </main>;
}
