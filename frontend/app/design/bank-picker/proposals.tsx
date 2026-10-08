"use client";

// A155 round 2 (skill: design-taste-frontend for the art direction, impeccable for the
// craft, DESIGN.md wins on any conflict). These three layouts are PROPOSALS, hand-authored
// because the production BankPickerSheet cannot render a tile grid, an index rail or a
// two-step page through props. Once Kevin picks one, the pick is folded into the real
// sheet and this preview must import that component instead of this copy.
//
// Shared rules: the A4.1 sentence is always rendered in full, visible by default, at the
// 12px Caption step. Search is a fixed 44px field in every state. No motion on load.
// Targets are 44px or more. No red or amber, no gradient (that is Penny's).

import { useRef, useState, type RefObject } from "react";
import { ChevronLeft, Search, ShieldCheck, X } from "lucide-react";
import { resolveApiAsset } from "@/lib/api";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";
import { SheetFrame } from "@/components/SheetFrame";
import { pickerDescription, type Bank } from "@/components/BankPickerSheet";

export const POPULAR_IDS = ["barclays", "halifax", "lloyds-bank", "monzo", "natwest", "santander"];
export const RAIL_GROUPS = ["A-D", "E-H", "I-L", "M-P", "Q-T", "U-Z"] as const;

const CAPTION = "text-xs leading-5 text-slate-600 dark:text-slate-300";
const INK = "text-slate-900 dark:text-slate-100";
const TITLE = "text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-300";
const PRESS = "hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-700/60 dark:active:bg-slate-700";
const SEARCH_BAR = 72; // pt-3 + 44px field + pb-3 + 1px hairline

type Ref = RefObject<HTMLInputElement | null>;
interface PickProps { onPick: (bank: Bank) => void }

export function matchBanks(banks: Bank[], query: string): Bank[] {
  const q = query.trim().toLowerCase();
  return q ? banks.filter(b => b.name.toLowerCase().includes(q)) : banks;
}

export function groupOf(name: string): string {
  const c = name[0].toUpperCase();
  return RAIL_GROUPS.find(g => c >= g[0] && c <= g[2]) ?? "U-Z";
}

/** The fixed legal sentence, never clamped, never behind a tap. */
export function Sentence({ className = "" }: { className?: string }) {
  return <p data-agent-disclosure className={`${CAPTION} ${className}`}>{AGENT_DISCLOSURE}</p>;
}

function Mark({ bank, large = false }: { bank: Bank; large?: boolean }) {
  return <span aria-hidden="true" className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-white dark:border-slate-600 ${large ? "size-12" : "size-10"}`}>
    {bank.logo
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={resolveApiAsset(bank.logo)} alt="" width={large ? 36 : 32} height={large ? 36 : 32} className={large ? "size-9 object-contain" : "size-8 object-contain"} />
      : <span className="text-sm font-bold text-slate-700">{bank.name[0]}</span>}
  </span>;
}

/** Fixed 44px field in every state, clear button inside it, pinned under the header. */
export function ProposalSearch({ query, setQuery, inputRef }: { query: string; setQuery: (q: string) => void; inputRef: Ref }) {
  return <div data-bank-search="sticky" className={`sticky top-0 z-10 border-b border-slate-100 bg-white pb-3 pt-3 dark:border-slate-700 dark:bg-slate-900 px-6`}>
    <div data-bank-search-field className="relative h-11 rounded-xl bg-slate-100 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-700">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-300" />
      <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} type="search" placeholder="Search by bank name…" aria-label="Search banks"
        autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
        className="block h-11 w-full appearance-none rounded-xl bg-transparent py-0 pl-10 pr-11 text-base leading-6 text-slate-800 outline-none placeholder:text-slate-600 dark:text-slate-100 dark:placeholder:text-slate-300 [&::-webkit-search-cancel-button]:hidden" />
      {query && <button type="button" data-compact aria-label="Clear search" onClick={() => { setQuery(""); inputRef.current?.focus({ preventScroll: true }); }}
        className={`absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 ${FOCUS}`}>
        <X size={16} aria-hidden="true" />
      </button>}
    </div>
  </div>;
}

export function NoResults() {
  return <div role="status" className="px-6 py-10 text-center">
    <p className={TITLE}>No banks found</p>
    <p className={`mt-1 ${CAPTION}`}>Try another name or check the spelling.</p>
  </div>;
}

function BankRow({ bank, onPick }: { bank: Bank } & PickProps) {
  return <li><button type="button" onClick={() => onPick(bank)} aria-label={`Choose ${bank.name}`}
    className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${PRESS} ${FOCUS}`}>
    <Mark bank={bank} />
    <span className={`min-w-0 flex-1 truncate text-sm font-medium ${INK}`}>{bank.name}</span>
  </button></li>;
}

function BankTile({ bank, onPick }: { bank: Bank } & PickProps) {
  return <li><button type="button" onClick={() => onPick(bank)} aria-label={`Choose ${bank.name}`}
    className={`flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-800 ${PRESS} ${FOCUS}`}>
    <Mark bank={bank} large />
    <span className={`w-full break-words text-sm font-medium leading-5 ${INK}`}>{bank.name}</span>
  </button></li>;
}

/* ------------------------------------------------------------------ D */

export function PopularBody({ banks, query, setQuery, inputRef, onPick }: { banks: Bank[]; query: string; setQuery: (q: string) => void; inputRef: Ref } & PickProps) {
  const typing = query.trim() !== "";
  const filtered = matchBanks(banks, query);
  const popular = POPULAR_IDS.map(id => banks.find(b => b.id === id)).filter((b): b is Bank => !!b);
  return <>
    <section aria-labelledby="pk-how" className="mx-6 mb-1 mt-4 border-b border-slate-100 pb-4 dark:border-slate-700">
      <h3 id="pk-how" className={TITLE}>How this connection works</h3>
      <Sentence className="mt-2" />
    </section>
    <ProposalSearch query={query} setQuery={setQuery} inputRef={inputRef} />
    {!typing && <section aria-labelledby="pk-pop" className="px-6 pt-5">
      <h3 id="pk-pop" className={TITLE}>Popular</h3>
      <ul className="mt-3 grid grid-cols-3 gap-2">{popular.map(b => <BankTile key={b.id} bank={b} onPick={onPick} />)}</ul>
    </section>}
    <section aria-labelledby="pk-all" className="px-3 pb-6 pt-5">
      {filtered.length > 0 && <h3 id="pk-all" className={`px-3 ${TITLE}`}>{typing ? "Matching banks" : "All banks"}</h3>}
      {filtered.length === 0 ? <NoResults /> : <ul className="mt-2">{filtered.map(b => <BankRow key={b.id} bank={b} onPick={onPick} />)}</ul>}
    </section>
  </>;
}

export function PopularSheet({ banks, initialQuery, onClose, onPick }: { banks: Bank[]; initialQuery: string; onClose: () => void } & PickProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  return <SheetFrame title="Choose your bank" description={pickerDescription("finexer", "footer")} onClose={onClose} bodyClassName="px-0 py-0">
    <PopularBody banks={banks} query={query} setQuery={setQuery} inputRef={inputRef} onPick={onPick} />
  </SheetFrame>;
}

/* ------------------------------------------------------------------ E */

function jumpTo(group: string) {
  const first = document.querySelector<HTMLElement>(`[data-index-group="${group}"]`);
  first?.scrollIntoView({ block: "start" });
  first?.focus({ preventScroll: true });
}

export function IndexBody({ banks, query, setQuery, inputRef, onPick }: { banks: Bank[]; query: string; setQuery: (q: string) => void; inputRef: Ref } & PickProps) {
  const typing = query.trim() !== "";
  const filtered = matchBanks(banks, query);
  const letters = [...new Set(filtered.map(b => b.name[0].toUpperCase()))];
  const firstLetterOfGroup = new Map<string, string>();
  for (const l of letters) { const g = groupOf(l); if (!firstLetterOfGroup.has(g)) firstLetterOfGroup.set(g, l); }
  return <>
    <ProposalSearch query={query} setQuery={setQuery} inputRef={inputRef} />
    <section aria-labelledby="pk-note" className="mx-6 mt-4 flex gap-3 border-b border-slate-100 pb-4 dark:border-slate-700">
      <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-slate-600 dark:text-slate-300" />
      <div>
        <h3 id="pk-note" className={TITLE}>Provided by Finexer LTD</h3>
        <Sentence className="mt-1" />
      </div>
    </section>
    {filtered.length === 0 ? <NoResults /> : <div className="relative pb-6 pl-3 pr-16">
      {!typing && <nav aria-label="Jump to banks" className="absolute bottom-0 right-1.5 top-3 w-[46px]">
        <ul className="sticky flex flex-col rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" style={{ top: SEARCH_BAR + 12 }}>
          {RAIL_GROUPS.map(g => {
            const has = firstLetterOfGroup.has(g);
            return <li key={g}><button type="button" disabled={!has} onClick={() => jumpTo(g)} aria-label={`Jump to banks ${g.replace("-", " to ")}`}
              className={`grid h-11 w-11 place-items-center rounded-xl text-xs font-semibold ${has ? "text-slate-800 dark:text-slate-100" : "text-slate-500 opacity-60 dark:text-slate-400"} ${PRESS} ${FOCUS}`}>{g}</button></li>;
          })}
        </ul>
      </nav>}
      {typing
        ? <ul className="pt-2">{filtered.map(b => <BankRow key={b.id} bank={b} onPick={onPick} />)}</ul>
        : letters.map(l => {
            const g = groupOf(l);
            const first = firstLetterOfGroup.get(g) === l;
            return <section key={l} aria-labelledby={`pk-idx-${l}`}>
              <h3 id={`pk-idx-${l}`} tabIndex={-1} {...(first ? { "data-index-group": g } : {})}
                className={`px-3 pb-1 pt-4 text-xs font-semibold leading-5 text-slate-600 outline-none dark:text-slate-300`} style={{ scrollMarginTop: SEARCH_BAR }}>{l}</h3>
              <ul>{filtered.filter(b => b.name[0].toUpperCase() === l).map(b => <BankRow key={b.id} bank={b} onPick={onPick} />)}</ul>
            </section>;
          })}
    </div>}
  </>;
}

export function IndexSheet({ banks, initialQuery, onClose, onPick }: { banks: Bank[]; initialQuery: string; onClose: () => void } & PickProps) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  return <SheetFrame title="Choose your bank" description={pickerDescription("finexer", "footer")} onClose={onClose} bodyClassName="px-0 py-0">
    <IndexBody banks={banks} query={query} setQuery={setQuery} inputRef={inputRef} onPick={onPick} />
  </SheetFrame>;
}

/* ------------------------------------------------------------------ F */

export function IntroBody() {
  return <div className="px-6 pb-6 pt-4">
    <h1 className="text-3xl font-bold leading-9 tracking-tight text-slate-900 dark:text-slate-100">Connect your bank</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Sorted uses Finexer, a regulated open banking provider, to read your accounts once you approve the connection at your bank.</p>
    <ul className="mt-5 border-y border-slate-100 dark:border-slate-700">
      <li className="py-4">
        <h2 className={TITLE}>You approve it at your bank</h2>
        <p className={`mt-1 ${CAPTION}`}>Your bank asks you to confirm. Your bank login stays with your bank.</p>
      </li>
      <li className="border-t border-slate-100 py-4 dark:border-slate-700">
        <h2 className={TITLE}>Sorted reads, it does not spend</h2>
        <p className={`mt-1 ${CAPTION}`}>It can see balances and transactions. Sorted cannot move money.</p>
      </li>
    </ul>
    <section aria-labelledby="pk-who" className="mt-5">
      <h2 id="pk-who" className={TITLE}>Who provides this</h2>
      <Sentence className="mt-2" />
    </section>
  </div>;
}

export function ChooserBody({ banks, query, setQuery, inputRef, onPick }: { banks: Bank[]; query: string; setQuery: (q: string) => void; inputRef: Ref } & PickProps) {
  const filtered = matchBanks(banks, query);
  return <>
    <ProposalSearch query={query} setQuery={setQuery} inputRef={inputRef} />
    <Sentence className="px-6 pt-4" />
    {filtered.length === 0 ? <NoResults /> : <ul className="grid grid-cols-2 gap-2 px-6 pb-6 pt-4">{filtered.map(b => <BankTile key={b.id} bank={b} onPick={onPick} />)}</ul>}
  </>;
}

export function FullScreenPicker({ banks, initialQuery, initialStep, onClose, onPick }: { banks: Bank[]; initialQuery: string; initialStep: 1 | 2; onClose: () => void } & PickProps) {
  const [step, setStep] = useState<1 | 2>(initialStep);
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const icon = `grid size-11 flex-shrink-0 place-items-center rounded-xl text-slate-700 dark:text-slate-200 ${PRESS} ${FOCUS}`;
  return <section aria-label="Add a bank" data-full-screen className="fixed inset-0 z-50 flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <header className="flex h-14 flex-shrink-0 items-center gap-1 border-b border-slate-100 px-2 dark:border-slate-700">
      {step === 2 && <button type="button" aria-label="Back to how this works" onClick={() => setStep(1)} className={icon}><ChevronLeft size={20} aria-hidden="true" /></button>}
      {step === 1
        ? <p className="flex-1 px-3 text-lg font-bold leading-7">Add a bank</p>
        : <h1 className="flex-1 px-1 text-lg font-bold leading-7">Choose your bank</h1>}
      <button type="button" aria-label="Close" onClick={onClose} className={icon}><X size={20} aria-hidden="true" /></button>
    </header>
    <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {step === 1 ? <IntroBody /> : <ChooserBody banks={banks} query={query} setQuery={setQuery} inputRef={inputRef} onPick={onPick} />}
    </div>
    {step === 1 && <footer className="flex-shrink-0 border-t border-slate-100 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 dark:border-slate-700">
      <button type="button" onClick={() => setStep(2)} className={`min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:bg-indigo-700 ${FOCUS}`}>Choose your bank</button>
    </footer>}
  </section>;
}
