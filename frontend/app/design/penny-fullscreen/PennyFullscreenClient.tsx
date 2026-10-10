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
import { SuggestionChip, VerdictBubble } from "@/components/PennyConversation";
import type { PennyTableBlock } from "@/lib/pennyTable";
import type { PennyChartSpec } from "@/lib/pennyChart";
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

type Turn = { id: number; role: "user" | "assistant"; text: string; table?: boolean; chart?: string };

// G251: ?table=1 seeds a question and a table answer. The bubble is the
// production VerdictBubble and the table is the production PennyTable, drawn
// from this fixture block (six columns, so it must scroll at 390px).
const TABLE_FIXTURE: PennyTableBlock = {
  title: "OpenRouter transactions",
  columns: [
    { key: "date", label: "Date", kind: "date", align: "left" },
    { key: "description", label: "Description", kind: "text", align: "left" },
    { key: "amount", label: "Amount", kind: "money", align: "right" },
    { key: "gbp", label: "In GBP", kind: "money", align: "right" },
    { key: "rate", label: "FX rate", kind: "rate", align: "right" },
    { key: "fee", label: "Fee", kind: "money", align: "right" },
  ],
  rows: [
    { date: "2026-10-04", description: "OpenRouter", amount: { amount: -20, currency: "USD" }, gbp: { amount: -15.1, currency: "GBP" }, rate: 1.3245, fee: { amount: -0.45, currency: "USD" } },
    { date: "2026-09-28", description: "OpenRouter", amount: { amount: -10, currency: "USD" }, gbp: { amount: -7.48, currency: "GBP" }, rate: 1.3369, fee: null },
    { date: "2026-09-12", description: "OpenRouter top-up", amount: { amount: -5, currency: "GBP" }, gbp: { amount: -5, currency: "GBP" }, rate: null, fee: null },
    { date: "2026-08-30", description: "OpenRouter", amount: { amount: -42.5, currency: "USD" }, gbp: { amount: -31.9, currency: "GBP" }, rate: 1.3322, fee: { amount: -0.9, currency: "USD" } },
    { date: "2026-08-02", description: "OpenRouter", amount: { amount: -1234.56, currency: "USD" }, gbp: { amount: -928.4, currency: "GBP" }, rate: 1.3298, fee: { amount: -2.5, currency: "USD" } },
  ],
  note: "Showing the 5 most recent of 14 matches.",
};
const TABLE_TURNS: Turn[] = [
  { id: 1, role: "user", text: "Tabulate my OpenRouter transactions" },
  { id: 2, role: "assistant", text: "", table: true },
];

// G252: ?chart=bar|line|stacked|donut seeds a question and a chart answer. The
// bubble is the production VerdictBubble and the chart is the production
// PennyChart, drawn from these fixture specs (the same shape the server sends).
const eatingOut = [["May 2026", 148], ["Jun 2026", 201.4], ["Jul 2026", 176], ["Aug 2026", 312], ["Sep 2026", 94.5], ["Oct 2026", 128.2]] as const;
const CHART_FIXTURES: Record<string, { question: string; headline: string; reply: string; spec: PennyChartSpec }> = {
  bar: {
    question: "Show my eating out by month as a bar chart",
    headline: "Eating out by month",
    reply: "Here is your eating out for the last six months, shown below.",
    spec: {
      type: "bar", title: "Eating Out by month", x: { label: "Month", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
      series: [{ name: "Eating Out", points: eatingOut.map(([x, y]) => ({ x, y })) }],
      note: "Rolling window, so the earliest month may be part of a month.",
      summary: "Eating Out by month: highest in Aug 2026 at £312, lowest in Sep 2026 at £94.50.",
    },
  },
  line: {
    question: "Chart my Monzo balance over the last 3 months",
    headline: "Money in and out",
    reply: "Sorted keeps no balance history, so this charts the net of money in and out per week instead.",
    spec: {
      type: "line", title: "Monzo over time", x: { label: "Week starting", kind: "date" }, y: { label: "Net", unit: "money", currency: "GBP" },
      series: [{ name: "Net", points: [
        ["2026-07-20", -84.2], ["2026-07-27", 312], ["2026-08-03", -150.75], ["2026-08-10", -62], ["2026-08-17", 40.1], ["2026-08-24", -210.4],
        ["2026-08-31", 1180], ["2026-09-07", -96.3], ["2026-09-14", -134.9], ["2026-09-21", -58.4], ["2026-09-28", 905.2], ["2026-10-05", -77.5],
      ].map(([x, y]) => ({ x: String(x), y: Number(y) })) }],
      note: "Totalled per week. Net of money in and out, not a balance.",
      summary: "Monzo over time: from −£84.20 on 20 Jul to −£77.50 on 5 Oct, highest £1,180 on 31 Aug.",
    },
  },
  stacked: {
    question: "Chart my bills, groceries and eating out by month",
    headline: "Spend by month",
    reply: "Here are the three categories side by side, shown below.",
    spec: {
      type: "stacked_bar", title: "Spending by month", x: { label: "Month", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
      series: [
        { name: "Bills", points: [["Jul 2026", 820], ["Aug 2026", 835], ["Sep 2026", 812], ["Oct 2026", 840]].map(([x, y]) => ({ x: String(x), y: Number(y) })) },
        { name: "Groceries", points: [["Jul 2026", 310], ["Aug 2026", 288], ["Sep 2026", 342], ["Oct 2026", 150]].map(([x, y]) => ({ x: String(x), y: Number(y) })) },
        { name: "Eating Out", points: [["Jul 2026", 176], ["Aug 2026", 312], ["Sep 2026", 94.5], ["Oct 2026", 128.2]].map(([x, y]) => ({ x: String(x), y: Number(y) })) },
      ],
      summary: "Spending by month: Bills, Groceries, Eating Out across 4 periods, highest total in Aug 2026 at £1,435.",
    },
  },
  donut: {
    question: "Pie of where my money went this month",
    headline: "Where it went",
    reply: "Here is the split of this pay period's spending, shown below.",
    spec: {
      type: "donut", title: "Spending by category this pay period", x: { label: "Category", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
      series: [{ name: "Spent", points: [["Bills", 840], ["Groceries", 342], ["Eating Out", 128.2], ["Transport", 96], ["Shopping", 74.5], ["Subscriptions", 41.97], ["Entertainment", 38], ["Other", 61.3]].map(([x, y]) => ({ x: String(x), y: Number(y) })) }],
      note: "Smaller categories grouped as Other",
      summary: "Spending by category this pay period: Bills is the largest at £840, 52% of the £1,621.97 shown.",
    },
  },
};

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
  const [messages, setMessages] = useState<Turn[]>(
    seed === "long" ? LONG : seed === "table" ? TABLE_TURNS
      : seed in CHART_FIXTURES ? [{ id: 1, role: "user", text: CHART_FIXTURES[seed].question }, { id: 2, role: "assistant", text: "", chart: seed }]
      : []);
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
        {messages.map(turn => turn.chart ? <VerdictBubble key={turn.id} onOfferTap={() => {}} msg={{
          id: turn.id, role: "assistant", kind: "verdict", headline: CHART_FIXTURES[turn.chart].headline,
          reply: CHART_FIXTURES[turn.chart].reply, chart: CHART_FIXTURES[turn.chart].spec, degraded: false,
        }} /> : turn.table ? <VerdictBubble key={turn.id} onOfferTap={() => {}} msg={{
          id: turn.id, role: "assistant", kind: "verdict", headline: "Your OpenRouter payments",
          reply: "Here are your 5 most recent OpenRouter payments, 14 in all.", table: TABLE_FIXTURE, degraded: false,
        }} /> : <div key={turn.id} className={turn.role === "user" ? "ml-8 break-words rounded-2xl bg-indigo-50 px-3 py-2 text-slate-900 dark:bg-indigo-950 dark:text-slate-100" : "mr-4 break-words text-slate-700 dark:text-slate-200"}>
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
  const chartParam = params.get("chart") ?? "";
  const seed = chartParam in CHART_FIXTURES ? chartParam : params.get("table") === "1" ? "table" : (params.get("thread") ?? params.get("state")) === "long" ? "long" : "empty";
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
  const href = (m = mode, s = seed) => `?mode=${m}&${s === "table" ? "table=1" : s in CHART_FIXTURES ? `chart=${s}` : `thread=${s}`}`;

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
        <a className={button} href={href(mode, "table")}>Table answer</a>
        {Object.keys(CHART_FIXTURES).map(k => <a key={k} className={button} href={href(mode, k)}>Chart: {k}</a>)}
        <a className={button} href={href(mode, seed === "long" ? "empty" : "long")}>{seed === "long" ? "Start empty" : "Start with a long thread"}</a>
      </nav>
      <button type="button" onClick={() => setOpen(true)} className={`${button} mt-5 bg-indigo-600 px-5 text-white`}>Open Penny</button>
      <section className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300"><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Try on both phones</h2><p className="mt-1">Open Penny and check the header clears the clock and notch. Tap the input: the page behind must not show above or beside the sheet, the composer sits on the keyboard, and the starter content steps aside. Dismiss the keyboard and it returns. Rotate, send a message, close. A hardware or headless browser cannot show a real software keyboard.</p></section>
    </div>
    <div data-penny-navigation><FixtureBottomNav active="Home" onPennyClick={() => setOpen(v => !v)} pennyExpanded={open} /></div>
    <PreviewWindow key={seed} open={open} onClose={() => setOpen(false)} seed={seed} startHistory={startHistory} />
  </main>;
}
