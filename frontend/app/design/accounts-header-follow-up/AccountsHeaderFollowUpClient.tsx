"use client";

// G250 follow-up to G236 variant A. Renders the PRODUCTION AccountsHeader,
// AccountLedgerRow, AccountsAddFab and SheetFrame through their real props; only
// the Find field, the lens chips and the group frames are hand-authored here
// (the page's own markup is not a standalone component).
//
// Round 1 (A, B, C, floating Add kept) found the top right empty and the
// floating Add covering amounts. Round 2 (D, E, F, skill: impeccable with
// design-taste-frontend; web-design-guidelines as the audit; Astra drafted):
// Add returns to the top right and the floating button is gone in all three.
//   d  outlined 44px "Add" pill on the title line, Net worth tightened under it
//   e  compact 44px "+" button top right; the Net worth row carries a quiet
//      right-aligned reading (hidden chip when hidden, else "Updated N min ago")
//   f  two-column header: title and Net worth left, a right rail with a filled
//      Add on the title line and the reading / hidden chip on the caption line
//
// /design/accounts-header-follow-up?option|variant=a|b|c|d|e|f&mode=light|dark&accounts=6|18|20&state=shown|hidden[&chrome=off][&open=0|1]

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Search, TrendingUp, Upload } from "lucide-react";
import AccountsHeader, { HiddenChip } from "@/components/AccountsHeader";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import AccountsAddFab, { ADD_FAB_LIST_CLEARANCE } from "@/components/AccountsAddFab";
import { SheetFrame } from "@/components/SheetFrame";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { breakdownFor, estateFor } from "./fixtures";

type Option = "a" | "b" | "c" | "d" | "e" | "f";
const OPTIONS: Option[] = ["a", "b", "c", "d", "e", "f"];

const OPTION_NOTES: Record<Option, { title: string; line: string }> = {
  a: { title: "A  Chip to the top right", line: "Round 1. Balances hidden · Show sits beside the title. Shown state leaves the right empty again. Floating Add kept." },
  b: { title: "B  Breakdown beside Net worth", line: "Round 1. Cash, Cards and Investments from the same rows, masked with the figure. Floating Add kept." },
  c: { title: "C  Last synced and refresh", line: "Round 1. Updated time with a 44px refresh control top right. Floating Add kept." },
  d: { title: "D  Outlined Add pill", line: "Round 2. A 44px outlined Add on the title line; Net worth tightened under it; 20px before Find. No floating button." },
  e: { title: "E  Compact + and a quiet reading", line: "Round 2. A 44px plus top right; the Net worth row carries the hidden chip, or Updated N min ago when shown. No floating button." },
  f: { title: "F  Two-column rail", line: "Round 2. Title and Net worth left; a right rail with a filled Add on the title line and the reading or hidden chip on the caption line. No floating button." },
};

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const press = "active:scale-95 transition-transform motion-reduce:transition-none";

/** The Add menu as a sheet (G192 anatomy, the real SheetFrame), with the production menu rows. */
function AddSheet({ mode, onClose }: { mode: "light" | "dark"; onClose: () => void }) {
  const rows = [
    { label: "Add Bank", Icon: Plus },
    { label: "Statement", Icon: Upload },
    { label: "Investment", Icon: TrendingUp },
    { label: "Offline", Icon: Plus },
  ];
  return (
    <SheetFrame variant="compact" title="Add an account" onClose={onClose} themeClass={mode === "dark" ? "dark" : undefined} bodyClassName="px-2 pb-4 pt-1">
      <div role="menu" aria-label="Add an account" className="divide-y divide-slate-100 dark:divide-white/5">
        {rows.map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={onClose}
            className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 active:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/5 dark:active:bg-white/10 ${focusRing}`}
          >
            <Icon size={16} className="shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </SheetFrame>
  );
}

function AddPill({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-add-control aria-haspopup="dialog" onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-indigo-600 px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${press} ${focusRing}`}>
      <Plus size={15} aria-hidden="true" />
      Add<span className="sr-only"> account</span>
    </button>
  );
}

function AddIcon({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-add-control aria-haspopup="dialog" aria-label="Add account" onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-xl border border-slate-300 text-indigo-700 hover:bg-slate-50 dark:border-slate-600 dark:text-indigo-300 dark:hover:bg-white/5 ${press} ${focusRing}`}>
      <Plus size={20} aria-hidden="true" />
    </button>
  );
}

function AddFilled({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-add-control aria-haspopup="dialog" onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 ${press} ${focusRing}`}>
      <Plus size={15} aria-hidden="true" />
      Add<span className="sr-only"> account</span>
    </button>
  );
}

const Updated = ({ className = "" }: { className?: string }) => (
  <p className={`text-xs text-slate-600 dark:text-slate-400 ${className}`} data-updated>Updated 8 min ago</p>
);

export default function AccountsHeaderFollowUpClient() {
  const params = useSearchParams();
  const option: Option = OPTIONS.find((o) => o === (params.get("option") ?? params.get("variant"))) ?? "d";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const p = params.get("accounts");
  const count: 6 | 18 | 20 = p === "6" ? 6 : p === "20" ? 20 : 18;
  const hidden = params.get("state") === "hidden";
  const chrome = params.get("chrome") !== "off";
  const [sheetOpen, setSheetOpen] = useState(params.get("open") === "1");
  const roundTwo = option === "d" || option === "e" || option === "f";

  const menuRef = useRef<HTMLDivElement | null>(null);
  const estate = estateFor(count);
  const href = (n: Record<string, string>) => {
    const q = new URLSearchParams({ option, mode, accounts: String(count), state: hidden ? "hidden" : "shown", ...n });
    return `?${q.toString()}`;
  };
  const pill = "inline-flex min-h-11 items-center rounded-full border px-3 text-xs";
  const on = "border-indigo-500 bg-indigo-600 text-white";
  const off = "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300";
  const openSheet = () => setSheetOpen(true);
  const noop = () => {};

  // Round 2 header props per option.
  const headerProps =
    option === "d"
      ? { topRight: <AddPill onClick={openSheet} /> }
      : option === "e"
        ? {
            topRight: <AddIcon onClick={openSheet} />,
            chipPlacement: "none" as const,
            aside: hidden ? <HiddenChip onShow={noop} /> : <Updated className="flex min-h-11 items-center" />,
          }
        : option === "f"
          ? {
              chipPlacement: "none" as const,
              rail: { top: <AddFilled onClick={openSheet} />, bottom: hidden ? <HiddenChip onShow={noop} className="-mb-3" /> : <Updated /> },
            }
          : {
              chipPlacement: option === "a" ? ("top" as const) : ("below" as const),
              breakdown: option === "b" ? breakdownFor(estate) : undefined,
              lastSynced: option === "c" ? "Updated 8 min ago" : undefined,
              onRefresh: option === "c" ? noop : undefined,
            };

  // Theme belongs to the document, not a wrapper: production components read the html
  // `dark` class (Tailwind dark:, useIsDark). PreferencesProvider re-applies the stored
  // preference after children mount and the app may start dark from wd_dark or the device,
  // so enforce the preview mode with an observer and restore the real state on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="color-scheme"]');
    const wasDark = root.classList.contains("dark");
    const prevScheme = root.style.colorScheme;
    const prevMeta = meta?.getAttribute("content") ?? null;
    const want = mode === "dark";
    const apply = () => {
      if (root.classList.contains("dark") !== want) root.classList.toggle("dark", want);
      root.style.colorScheme = mode;
      meta?.setAttribute("content", mode);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      obs.disconnect();
      root.classList.toggle("dark", wasDark);
      root.style.colorScheme = prevScheme;
      if (meta) { if (prevMeta === null) meta.removeAttribute("content"); else meta.setAttribute("content", prevMeta); }
    };
  }, [mode]);

  const subtotal = (v: number) => (hidden ? "£••••" : `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
  const lenses = ["All", "Current", "Savings", "Credit", "Investment", "Owed"];

  return (
    <div>
      <main className={`min-h-dvh ${mode === "dark" ? "bg-[#0f172a]" : "bg-[#f0f2f7]"}`}>
        {chrome && (
          <div className="px-4 pt-3">
            <div className="flex flex-wrap gap-1.5">
              {OPTIONS.map((o) => (
                <Link key={o} href={href({ option: o })} className={`${pill} ${o === option ? on : off}`}>{OPTION_NOTES[o].title}</Link>
              ))}
              <Link href={href({ accounts: count === 6 ? "18" : count === 18 ? "20" : "6" })} className={`${pill} ${off}`}>{count} accounts</Link>
              <Link href={href({ state: hidden ? "shown" : "hidden" })} className={`${pill} ${off}`}>{hidden ? "Show balances" : "Hide balances"}</Link>
              <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} className={`${pill} ${off}`}>{mode === "dark" ? "Light" : "Dark"}</Link>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{OPTION_NOTES[option].line}</p>
          </div>
        )}

        {/* Round 2 has no floating Add, so the list needs the nav clearance only (the pre-G250 value). */}
        <div className={roundTwo ? "pb-[calc(9rem+env(safe-area-inset-bottom,0px))]" : ADD_FAB_LIST_CLEARANCE} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          {/* The page's header wrapper, with the pb-6 swapped for the Home 20px section gap. */}
          <div className="px-4 pt-4 pb-5">
            <AccountsHeader
              netWorth={{ value: estate.netWorth, accountCount: estate.rows.length }}
              hidden={hidden}
              showChip={hidden}
              onShow={noop}
              tight
              {...headerProps}
            />
          </div>

          <div className="space-y-5 px-4">
            <div className="space-y-3">
              <div aria-hidden="true" className="glass-tile flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-slate-500 dark:text-slate-400">
                <Search size={15} aria-hidden="true" />
                <span>Find an account…</span>
              </div>
              <div aria-hidden="true" className="-mx-1 flex items-center gap-1.5 overflow-x-hidden px-1">
                {lenses.map((l, i) => (
                  <span key={l} className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold ${i === 0 ? "bg-indigo-500 text-white" : "glass-tile text-slate-500 dark:text-slate-400"}`}>{l}</span>
                ))}
              </div>
            </div>

            {estate.pinned.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label="Pinned accounts">
                <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pinned</p>
                <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
                  {estate.pinned.map((row) => (
                    <AccountLedgerRow key={row.id} row={row} hideAmount={hidden} />
                  ))}
                </div>
              </section>
            )}

            {estate.groups.map((g) => (
              <section key={g.kind} aria-label={g.label}>
                <div className="mb-2 flex items-baseline justify-between px-1 text-xs text-slate-600 dark:text-slate-400">
                  <h2 className="font-semibold text-slate-800 dark:text-slate-200">{g.label}</h2>
                  <span className="money tabular-nums">{subtotal(g.subtotal)}</span>
                </div>
                <div className="glass-card overflow-hidden rounded-2xl">
                  {g.rows.map((row, i) => (
                    <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                      <AccountLedgerRow row={row} hideAmount={hidden} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        {!roundTwo && (
          <AccountsAddFab
            open={false}
            onToggle={noop}
            onClose={noop}
            menuRef={menuRef}
            suppressed={false}
            menuItems={<div className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">Add Bank</div>}
          />
        )}
        <FixtureBottomNav />
        {roundTwo && sheetOpen && <AddSheet mode={mode} onClose={() => setSheetOpen(false)} />}
      </main>
    </div>
  );
}
