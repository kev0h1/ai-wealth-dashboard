"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PennySheetHeader, PennySheetPanel } from "@/components/PennySheet";
import PennyComposer from "@/components/PennyComposer";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { usePennyThreadAnchor } from "@/lib/usePennyThreadAnchor";
import FixtureBottomNav from "../_components/FixtureBottomNav";

// G240 design round (impeccable; emil-design-eng for motion: there is none,
// nothing animates on open, close or keyboard; web-design-guidelines as the
// final audit). Every variant renders the PRODUCTION PennySheetPanel (with the
// new opt-in presentation="fullscreen"), PennySheetHeader and PennyComposer.
// Only the empty-conversation content and the composer spacing differ, and
// that content is fixture markup because production's empty state lives inside
// PennyConversation, which fetches its own data. The conversation is local:
// no Penny call is made.

type Variant = "a" | "b" | "c";
type Turn = { id: number; role: "user" | "assistant"; text: string };

const VARIANTS: { id: Variant; name: string; idea: string }[] = [
  { id: "a", name: "Clear runway", idea: "A short starter heading and wrapping question chips fill the empty space, then step aside." },
  { id: "b", name: "Question history", idea: "A card of recent questions leads, and tapping one restores that thread." },
  { id: "c", name: "Decision dock", idea: "Prompts sit as full-width pills just above the composer, within thumb reach." },
];
const STARTERS = ["What is coming up?", "Explain my forecast", "What should I check before payday?"];
const RECENT: { q: string; a: string }[] = [
  { q: "Can I afford a weekend away?", a: "Likely yes, with room to spare. Check Upcoming first, because two bills are expected before payday." },
  { q: "How much could I save this month?", a: "About £120 looks realistic once your set-asides are counted. This is an estimate from your bank data." },
];
const DOCK = ["Can I afford this?", "What should I prioritise?", "Help me build a buffer"];
const LONG: Turn[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, role: i % 2 ? "assistant" : "user",
  text: i % 2 ? "Check the account a payment will leave from, as well as your overall balance. Money in another account does not cover it automatically." : "Which account do I need to check, and how does the forecast work?",
}));
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const chip = "min-h-11 rounded-full bg-slate-100 px-4 text-sm font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-200";
const subscribeToMount = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;

function PreviewWindow({ open, onClose, variant, seed }: { open: boolean; onClose: () => void; variant: Variant; seed: string }) {
  const mounted = useSyncExternalStore(subscribeToMount, clientMounted, serverMounted);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Turn[]>(seed === "long" ? LONG : []);
  const [loading, setLoading] = useState(false);
  const [usageShown, setUsageShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { ref, close } = useSheetA11y<HTMLDivElement>(onClose, { lockScroll: true, backToClose: true });
  const { anchorToLatest, onScroll } = usePennyThreadAnchor(thread, open);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  useLayoutEffect(() => { if (open && thread.current) anchorToLatest(); }, [open, messages, loading, anchorToLatest]);

  function ask(text: string, answer?: string) {
    const q = text.trim();
    if (loading || !q) return;
    setMessages(prev => [...prev, { id: Date.now(), role: "user", text: q }]);
    setInput("");
    setLoading(true);
    timeout.current = setTimeout(() => {
      setLoading(false);
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "assistant", text: answer ?? "This is a local preview reply. Nothing has been sent to Penny or saved to your account." }]);
    }, 700);
  }

  const empty = messages.length === 0 && !loading;
  // Per-variant composer spacing (px): A 8/12, B 12/12, C 12/12 above the safe area.
  const wrapPad = variant === "b" ? "px-4 pt-3 pb-3" : variant === "c" ? "px-3 pt-3 pb-3" : "px-4 pt-2 pb-3";

  if (!mounted) return null;
  return createPortal(<>
    {open && <div aria-hidden="true" className="fixed inset-0 z-[56] touch-none" onClick={close} />}
    <PennySheetPanel isOpen={open} panelRef={open ? ref : undefined} presentation="fullscreen">
      <div className="shrink-0" onClickCapture={event => {
        if ((event.target as HTMLElement).closest('a[href="#preview-info"]')) event.preventDefault();
      }}>
        <PennySheetHeader pennyUsed={3} pennyLimit={20} usageRevealed={usageShown}
          handleAvatarTap={() => setUsageShown(v => !v)} close={close}
          headerLinks={[{ label: "Your plan and updates", href: "#preview-info" }]} />
      </div>

      <div ref={thread} data-penny-scroll role="log" aria-label="Preview conversation" aria-live="polite" aria-relevant="additions text"
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4 text-[14px] leading-6 [scrollbar-width:thin]">
        {empty && variant === "a" && <div data-penny-fs-secondary className="flex min-h-full flex-col items-center justify-center py-6 text-center">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">What would you like to check?</p>
          <p className="mt-1 max-w-[18rem] text-sm text-slate-600 dark:text-slate-300">Ask about your money, or start with one of these.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {STARTERS.map(label => <button key={label} type="button" className={chip} onClick={() => setInput(label)}>{label}</button>)}
          </div>
        </div>}
        {empty && variant === "b" && <section data-penny-fs-secondary aria-label="Recent questions" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Recent questions</h2>
          <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">
            {RECENT.map(item => <li key={item.q}>
              <button type="button" onClick={() => ask(item.q, item.a)} className="flex min-h-11 w-full items-center py-2 text-left text-sm font-medium text-slate-900 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100">{item.q}</button>
            </li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Example history for this preview.</p>
        </section>}
        {empty && variant === "c" && <p data-penny-fs-secondary className="pt-2 text-sm text-slate-600 dark:text-slate-300">Ask a question below, or pick a prompt.</p>}
        {messages.map(turn => <div key={turn.id} className={turn.role === "user" ? "ml-8 break-words rounded-2xl bg-indigo-50 px-3 py-2 text-slate-900 dark:bg-indigo-950 dark:text-slate-100" : "mr-4 break-words text-slate-700 dark:text-slate-200"}>
          <span className="sr-only">{turn.role === "user" ? "You" : "Penny"}: </span>{turn.text}
        </div>)}
        {loading && <p role="status" className="text-slate-500 dark:text-slate-400">Preparing preview reply…</p>}
      </div>

      {variant === "c" && empty && <div data-penny-fs-secondary className="shrink-0 space-y-2 px-3 pb-3" aria-label="Prompts">
        {DOCK.map(label => <button key={label} type="button" className={`${chip} flex w-full items-center justify-start`} onClick={() => setInput(label)}>{label}</button>)}
      </div>}

      <div data-penny-composer-wrap className={`shrink-0 border-t border-slate-200/70 dark:border-slate-700 ${wrapPad}`}>
        <PennyComposer inputRef={inputRef} value={input} onChange={setInput} onSend={() => ask(input)}
          placeholder="Ask Penny a question…" loading={loading} atCap={false} />
      </div>
    </PennySheetPanel>
  </>, document.body);
}

export default function PennyFullscreenClient() {
  const params = useSearchParams();
  const variant: Variant = (["a", "b", "c"] as const).find(v => v === (params.get("variant") ?? params.get("state"))) ?? "a";
  const seed = params.get("thread") === "long" ? "long" : "empty";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(params.get("open") === "1");
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = previousScheme; };
  }, [mode]);
  const href = (v = variant, m = mode, s = seed) => `?variant=${v}&mode=${m}&thread=${s}`;
  const current = VARIANTS.find(v => v.id === variant)!;

  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-36 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Ask Penny, full screen</h1>
      <p id="preview-info" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">The sheet runs from the top safe area to the bottom safe area on a solid surface, so nothing of the page shows around it, with or without the keyboard. Open it, tap the input and type on your phone. All three share that frame and differ in how the empty conversation is used. Replies are local, not live advice.</p>
      <div className="mt-4 rounded-2xl bg-white p-4 text-sm dark:bg-slate-800">
        <p className="font-semibold">Tip card on the page behind</p>
        <p className="mt-1 text-slate-600 dark:text-slate-300">If any of this shows above or around the open sheet, the takeover has leaked.</p>
      </div>
      <nav aria-label="Variant" className="mt-5 flex flex-wrap gap-2">
        {VARIANTS.map(v => <a key={v.id} href={href(v.id)} aria-current={variant === v.id ? "page" : undefined}
          className={`${button} ${variant === v.id ? "bg-indigo-600 text-white" : "bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{v.id.toUpperCase()} {v.name}</a>)}
      </nav>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{current.idea}</p>
      <nav aria-label="Options" className="mt-4 flex flex-wrap gap-2">
        <a className={button} href={href(variant, mode === "dark" ? "light" : "dark")}>{mode === "dark" ? "Light" : "Dark"} theme</a>
        <a className={button} href={href(variant, mode, seed === "long" ? "empty" : "long")}>{seed === "long" ? "Start empty" : "Start with a long thread"}</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-5 bg-indigo-600 px-5 text-white`}>Open Penny</button>
      <section className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Try on both phones</h2><p className="mt-1">Open Penny and check the header clears the clock and notch. Tap the input: the page behind must not show above or beside the sheet, the composer sits on the keyboard, and the starter content steps aside. Dismiss the keyboard and it returns. Rotate, send a message, close. A hardware or headless browser cannot show a real software keyboard.</p></section>
    </div>
    <div data-penny-navigation><FixtureBottomNav active="Home" onPennyClick={() => setOpen(v => !v)} pennyExpanded={open} /></div>
    <PreviewWindow key={`${variant}-${seed}`} open={open} onClose={() => setOpen(false)} variant={variant} seed={seed} />
  </main>;
}
