"use client";

// G236 Accounts header round (eye, header balance, one-handed Add). Design
// skill: impeccable. Directions drafted with openai/gpt-6-astra, rewritten to
// DESIGN.md (tokens, sizes and the offsets below are DESIGN.md's and
// BottomNav's, not Astra's).
//
// What is production here: AccountsHeader (the "today" header, extracted
// unchanged from AccountsPage), AccountLedgerRow for every row, SegmentedControl
// and FixtureBottomNav. What is a hand-authored PROPOSAL, marked "Proposal" on
// screen: the A/B/C headers, the floating Add, the Add row, the bottom bar, the
// "Balances hidden" chip and the Settings switch. The list chrome (find bar,
// lens chips, group cards) is inline in AccountsPage and mirrored here.

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, EyeOff, Plus, Search, Upload, TrendingUp } from "lucide-react";
import AccountsHeader from "@/components/AccountsHeader";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import SegmentedControl from "@/components/SegmentedControl";
import { filterEstate, type Estate, type EstateGroup, type EstateLens, type EstateRow } from "@/lib/accountsEstate";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { ADD_CHOICES, estateFor, type AccountsCount } from "./fixtures";

export type Variant = "today" | "a" | "b" | "c";
export const VARIANTS: { id: Variant; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

const NOTES: Record<Variant, { title: string; body: string; weak: string }> = {
  today: {
    title: "Today · production header",
    body: "The shipped header, rendered by AccountsHeader. The eye masks Net worth and the group subtotals but not the account rows (AccountLedgerRow has no hide prop today), so with the eye on every balance in the list still shows. Hide it and see.",
    weak: "Add is top right, out of thumb reach. The eye is the only control for hide balances in the whole app.",
  },
  a: {
    title: "A · Verdict header · Proposal",
    body: "Net worth is the one Display figure with a Caption under it, on the canvas. No eye: a quiet Balances hidden chip appears when hidden and returns the figures. Add is a 56px floating action in the thumb zone, above the nav and clear of Penny.",
    weak: "Net worth dominates a page people also use to manage accounts. Production BottomNav paints a 116px scrim (nav-scrim, z-40) over this zone, so the floating action sits at z-45 above it, and the fold-in must do the same or its lower half fades into a gradient that reads as Penny's. The floating action covers the right-hand balances as rows scroll under it.",
  },
  b: {
    title: "B · Quiet header · Proposal",
    body: "Title only, Net worth as one Caption line, no eye. Add is a full-width outlined row at the top of the list, in the flow, never over content.",
    weak: "The top of the list is not the thumb zone, and the row scrolls away. Net worth loses at-a-glance weight.",
  },
  c: {
    title: "C · Toolbar · Proposal",
    body: "Title and Net worth as in A, no eye. The group filter moves into a bar above the nav with Add beside it, so both live in the thumb zone and nothing floats alone.",
    weak: "Crowded at 390px: four filters fit, Investment and Owed are cut. A fixed bar is 62px tall and covers list content beneath it.",
  },
};

// BottomNav is a 64px rail at max(inset, 10px) from the bottom, so its top edge
// is about 74px up, and the raised Penny button (56px, 28px proud) reaches about
// 102px at the centre. The floating Add sits 16px above the rail and to the right
// of Penny; the full-width bar must clear Penny itself, so it sits 8px above it.
const OFFSET = `bottom-[calc(max(env(safe-area-inset-bottom,0px),10px)+var(--design-controls-clearance,0px)+80px)]`;
const OFFSET_BAR = `bottom-[calc(max(env(safe-area-inset-bottom,0px),10px)+var(--design-controls-clearance,0px)+112px)]`;

function money(v: number, hidden: boolean): string {
  if (hidden) return "£••••";
  return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function groupsOf(estate: Estate): EstateGroup[] {
  const result = [...estate.groups];
  const offline = estate.rows.filter((r) => r.kind === "Offline");
  if (offline.length > 0) result.push({ kind: "Offline", label: "Offline accounts", count: offline.length, subtotal: offline.reduce((s, r) => s + r.balance, 0), rows: offline });
  return result;
}

/* ───────────── list chrome (mirrors AccountsPage) ───────────── */

function ListChrome({ estate, hidden, maskRows, showLens, lens, onLens }: { estate: Estate; hidden: boolean; maskRows: boolean; showLens: boolean; lens: EstateLens; onLens: (l: EstateLens) => void }) {
  const [query, setQuery] = useState("");
  const filtering = query.trim() !== "" || lens !== "All";
  const filtered = filterEstate(estate.rows, { query, lens });
  const LENSES: EstateLens[] = ["All", "Current", "Savings", "Credit", "Investment", "Owed"];
  const noop = () => {};
  const row = (r: EstateRow) => <AccountLedgerRow key={r.id} row={r} onClick={noop} hideAmount={maskRows && hidden} />;
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <input type="text" name="account-search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an account…" aria-label="Find an account" className="w-full min-h-[44px] rounded-xl glass-tile pl-9 pr-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      {showLens && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LENSES.map((l) => (
            <button key={l} type="button" onClick={() => onLens(l)} aria-pressed={lens === l} className={`shrink-0 min-h-[44px] px-3.5 rounded-full text-[13px] font-semibold transition-colors motion-reduce:transition-none ${lens === l ? "bg-indigo-500 text-white" : "glass-tile text-slate-500 dark:text-slate-400"}`}>{l}</button>
          ))}
        </div>
      )}
      {filtering ? (
        <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">{filtered.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No accounts match</p> : filtered.map(row)}</div>
      ) : (
        <>
          {estate.pinned.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label="Pinned accounts">
              <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pinned</p>
              <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">{estate.pinned.map(row)}</div>
            </section>
          )}
          {groupsOf(estate).map((g) => (
            <section key={g.label} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label={`${g.label} accounts`}>
              <div className="flex min-h-16 items-center justify-between gap-3 px-4">
                <span>
                  <span role="heading" aria-level={2} className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">{g.label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{g.count} {g.count === 1 ? "account" : "accounts"}</span>
                </span>
                <span className="money text-[14px] font-semibold text-slate-800 dark:text-slate-200">{money(g.subtotal, hidden)}</span>
              </div>
              <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">{g.rows.map(row)}</div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/* ───────────── proposal pieces ───────────── */

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</p>;
}

/** Quiet chip shown instead of the eye while balances are hidden. The 44px target is the button; the pill inside stays small. */
function HiddenChip({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" data-hidden-chip onClick={onShow} className="mt-1 inline-flex min-h-11 items-center rounded-xl active:scale-95 transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
        <EyeOff size={13} aria-hidden="true" />
        Balances hidden · Show
      </span>
    </button>
  );
}

function ChoiceList({ onChoose, className }: { onChoose: () => void; className: string }) {
  const icons = [<Plus key="b" size={14} />, <Upload key="s" size={14} />, <TrendingUp key="i" size={14} />, <Plus key="o" size={14} />];
  return (
    <div role="menu" aria-label="Add an account" className={className}>
      {ADD_CHOICES.map((c, i) => (
        <button key={c} role="menuitem" type="button" onClick={onChoose} className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5 dark:active:bg-white/10">
          <span aria-hidden="true" className="text-slate-400 shrink-0">{icons[i]}</span>
          {c}
        </button>
      ))}
    </div>
  );
}

const MENU_BOX = "z-30 w-56 overflow-hidden rounded-2xl border border-slate-100 bg-white py-1 shadow-xl divide-y divide-slate-100 dark:border-white/10 dark:bg-slate-800 dark:divide-white/5";

function Proposal() {
  return <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">Proposal</span>;
}

function SettingsProposal({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <section aria-label="Proposed Settings control" className="mt-5 rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-600">
      <Label>Settings, Privacy<Proposal /></Label>
      <div className="mt-2 flex min-h-11 items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hide balances</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">Masks every figure on every screen. One setting, shared everywhere.</p>
        </div>
        <button type="button" role="switch" aria-checked={hidden} aria-label="Hide balances" onClick={onToggle} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${hidden ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"}`}>
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${hidden ? "translate-x-[22px]" : "translate-x-0.5"}`} />
        </button>
      </div>
    </section>
  );
}

/* ───────────── the preview ───────────── */

export interface PreviewProps {
  variant: Variant;
  count: AccountsCount;
  hidden: boolean;
  menuOpen?: boolean;
  chrome?: ReactNode;
}

export default function AccountsHeaderPreview({ variant, count, hidden: hiddenIn, menuOpen: menuIn = false, chrome }: PreviewProps) {
  const estate = estateFor(count);
  const [hidden, setHidden] = useState(hiddenIn);
  const [menuOpen, setMenuOpen] = useState(menuIn);
  const [lens, setLens] = useState<EstateLens>("All");
  const addRef = useRef<HTMLDivElement>(null);
  const note = NOTES[variant];
  const total = estate.rows.length;
  const nwText = money(estate.netWorth, hidden);
  const cardTotal = estate.rows.filter((r) => r.kind === "Credit").reduce((s, r) => s + Math.abs(Math.min(r.balance, 0)), 0);
  const nw = {
    value: estate.netWorth,
    cardTotal,
    bankCount: estate.rows.filter((r) => r.source === "bank" && r.kind !== "Offline").length,
    investmentCount: estate.rows.filter((r) => r.source === "investment").length,
    offlineCount: estate.rows.filter((r) => r.kind === "Offline").length,
  };
  const close = () => setMenuOpen(false);
  // Escape closes the menu and returns focus to the Add control (guidelines: keyboard parity).
  const onEscape = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      addRef.current?.querySelector<HTMLElement>("[data-add-control]")?.focus();
    }
  };
  const toggleMenu = () => setMenuOpen((v) => !v);
  const items = (
    <>
      {ADD_CHOICES.map((c) => (
        <button key={c} type="button" onClick={close} className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-3 text-sm font-medium text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 active:bg-slate-100 dark:active:bg-white/10">
          <Plus size={14} aria-hidden="true" className="text-slate-400 flex-shrink-0" />
          {c}
        </button>
      ))}
    </>
  );

  const addButtonBase = "inline-flex items-center justify-center gap-1.5 bg-indigo-600 text-white font-semibold text-sm transition-transform motion-reduce:transition-none active:scale-95 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]";

  return (
    <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
      {chrome}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{note.title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{note.body}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">Weakness: {note.weak}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">The find bar, filter chips and group cards below are mirrored from AccountsPage, not the production components; rows are production. Fold-in: balances default to hidden, so removing the eye without the Settings Hide balances switch would leave a new user unable to reveal them. Ship the switch, gate on preferencesReady, and pass hideAmount on every row.</p>
      </div>

      <div className="mx-auto w-full max-w-[430px] pb-[calc(11rem+env(safe-area-inset-bottom,0px))]">
        {variant === "today" && (
          <div className="relative z-30 px-4 pt-4 pb-6">
            <AccountsHeader
              showAdd
              addMenuOpen={menuOpen}
              onToggleAdd={toggleMenu}
              addMenuRef={addRef}
              addMenuItems={items}
              netWorth={nw}
              hidden={hidden}
              onToggleHidden={() => setHidden((v) => !v)}
            />
          </div>
        )}

        {variant === "a" && (
          <header className="px-4 pt-5 pb-5">
            <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
            <div className="mt-5" data-tutorial-id="tutorial-networth">
              <Label>Net worth</Label>
              <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white"><span aria-hidden="true">{nwText}</span><span className="sr-only">{hidden ? "Balance hidden" : nwText}</span></p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">across {total} accounts</p>
              {hidden && <HiddenChip onShow={() => setHidden(false)} />}
            </div>
          </header>
        )}

        {variant === "b" && (
          <header className="px-4 pt-5 pb-1">
            <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400" data-tutorial-id="tutorial-networth">
              Net worth <span aria-hidden="true" className="money text-slate-950 dark:text-white">{nwText}</span><span className="sr-only">{hidden ? "hidden" : nwText}</span> · {total} accounts
            </p>
            {hidden && <HiddenChip onShow={() => setHidden(false)} />}
            <div className="relative mt-4" ref={addRef} onKeyDown={onEscape}>
              <button type="button" data-add-control onClick={toggleMenu} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Add account" className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-transparent px-4 text-sm font-semibold text-slate-800 transition-transform motion-reduce:transition-none active:scale-95 hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-white/5`}>
                <Plus size={16} aria-hidden="true" />
                Add account
                <ChevronDown size={14} aria-hidden="true" className={`opacity-70 transition-transform motion-reduce:transition-none ${menuOpen ? "rotate-180" : ""}`} />
              </button>
              {menuOpen && <ChoiceList onChoose={close} className={`absolute left-0 right-0 top-[calc(100%+6px)] ${MENU_BOX} w-auto`} />}
            </div>
          </header>
        )}

        {variant === "c" && (
          <header className="px-4 pt-5 pb-5">
            <h1 className="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1>
            <div className="mt-5" data-tutorial-id="tutorial-networth">
              <Label>Net worth</Label>
              <p className="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white"><span aria-hidden="true">{nwText}</span><span className="sr-only">{hidden ? "Balance hidden" : nwText}</span></p>
              {hidden && <HiddenChip onShow={() => setHidden(false)} />}
            </div>
          </header>
        )}

        <div className={`px-4 ${variant === "today" ? "" : variant === "b" ? "pt-5" : ""}`}>
          <ListChrome estate={estate} hidden={hidden} maskRows={variant !== "today"} showLens={variant !== "c"} lens={lens} onLens={setLens} />
          {variant !== "today" && <SettingsProposal hidden={hidden} onToggle={() => setHidden((v) => !v)} />}
        </div>
      </div>

      {variant === "a" && (
        <div ref={addRef} onKeyDown={onEscape} className={`fixed right-5 z-[45] ${OFFSET}`}>
          {menuOpen && <ChoiceList onChoose={close} className={`absolute bottom-[calc(100%+8px)] right-0 ${MENU_BOX}`} />}
          <button type="button" data-add-control onClick={toggleMenu} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Add account" className={`${addButtonBase} size-14 rounded-full shadow-xl`}>
            <Plus size={22} aria-hidden="true" />
          </button>
        </div>
      )}

      {variant === "c" && (
        <div ref={addRef} onKeyDown={onEscape} className={`fixed inset-x-3 z-[45] mx-auto max-w-[406px] ${OFFSET_BAR}`}>
          {menuOpen && <ChoiceList onChoose={close} className={`absolute bottom-[calc(100%+8px)] right-0 ${MENU_BOX}`} />}
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <SegmentedControl
              ariaLabel="Group accounts by"
              className="min-w-0 flex-1"
              options={["All", "Current", "Savings", "Credit"]}
              value={lens === "Investment" || lens === "Owed" ? "All" : lens}
              onChange={(v) => setLens(v as EstateLens)}
            />
            <button type="button" data-add-control onClick={toggleMenu} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Add account" className={`${addButtonBase} min-h-11 shrink-0 rounded-xl px-3`}>
              <Plus size={16} aria-hidden="true" />
              Add
            </button>
          </div>
        </div>
      )}

      <FixtureBottomNav />
    </div>
  );
}

