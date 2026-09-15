"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import type { Account } from "@wealth/shared";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { BankBadge, accountBrand, type TermsPill } from "@/components/AccountMiniCard";
import ReconnectStrip from "@/components/ReconnectStrip";
import SegmentedControl from "@/components/SegmentedControl";
import TransactionRow from "@/components/TransactionRow";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import {
  filterEstate,
  type Estate,
  type EstateGroup,
  type EstateLens,
  type EstateRow,
} from "@/lib/accountsEstate";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import {
  DETAIL_FIXTURES,
  PREVIEW_STATES,
  PREVIEW_STATE_LABELS,
  estateForState,
  isDetailState,
  type AccountDetailFixture,
  type AccountsPreviewState,
} from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: Variant[] = ["a", "b", "c"];
const LENSES: EstateLens[] = ["All", "Current", "Savings", "Credit", "Investment", "Owed"];

const VARIANT_NOTES: Record<Variant, { title: string; thesis: string; rule: string; tradeoff: string }> = {
  a: {
    title: "A · Quiet position · recommended",
    thesis: "Net worth gets one clear reading. The account-group subtotals below explain its make-up where the user can inspect and act on each position.",
    rule: "The header answers one question only. Existing account ledgers carry the evidence, so the same figures are not repeated as a second hero.",
    tradeoff: "It is the calmest and most direct option, but the full composition is understood by scanning the group headings rather than one summary.",
  },
  b: {
    title: "B · Own and owe",
    thesis: "Net worth remains the verdict, followed by a quiet two-part split between the money and investments held and the balances owed.",
    rule: "Plain-language buckets replace the equation. The focused group switcher keeps the working area short while preserving every account.",
    tradeoff: "It explains the position fastest at a glance, but introduces two supporting figures into the opening canvas.",
  },
  c: {
    title: "C · Details on demand",
    thesis: "The opening stays as quiet as A, with the calculation available as a stacked ledger only when someone asks how the position is built.",
    rule: "Progressive disclosure keeps arithmetic out of the default reading. Desktop gives the optional statement a sticky rail while account work continues beside it.",
    tradeoff: "It offers the strongest show-your-working path, but adds a disclosure control that most users may never need.",
  },
};

function money(value: number, hidden = false, exact = false): string {
  if (hidden) return "£••••";
  const magnitude = Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: exact ? 2 : 0,
    maximumFractionDigits: exact ? 2 : 0,
  });
  return `${value < 0 ? "−" : ""}£${magnitude}`;
}

function positionFigures(estate: Estate) {
  const cash = estate.groups
    .filter((group) => group.kind === "Current" || group.kind === "Savings")
    .reduce((sum, group) => sum + group.subtotal, 0)
    + estate.rows.filter((row) => row.kind === "Offline").reduce((sum, row) => sum + row.balance, 0);
  const investments = estate.groups.find((group) => group.kind === "Investment")?.subtotal ?? 0;
  const cardPosition = estate.groups.find((group) => group.kind === "Credit")?.subtotal ?? 0;
  const owned = estate.rows.filter((row) => row.balance > 0).reduce((sum, row) => sum + row.balance, 0);
  const owed = Math.abs(estate.rows.filter((row) => row.balance < 0).reduce((sum, row) => sum + row.balance, 0));

  return { cash, investments, cardPosition, owned, owed };
}

function PositionContext({ estate, hidden, variant }: { estate: Estate; hidden: boolean; variant: Variant }) {
  const { cash, investments, cardPosition, owned, owed } = positionFigures(estate);

  if (estate.rows.length === 0) {
    return null;
  }

  if (variant === "a") {
    return null;
  }

  if (variant === "b") {
    return (
      <dl className="mt-5 grid max-w-sm grid-cols-2 gap-6 border-t border-slate-300/80 pt-4 dark:border-slate-700">
        <div>
          <dt className="text-[11px] font-medium text-slate-600 dark:text-slate-400">You own</dt>
          <dd className="money mt-1 text-[16px] font-bold text-slate-900 dark:text-slate-100">{hidden ? "£••••" : money(owned)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium text-slate-600 dark:text-slate-400">You owe</dt>
          <dd className="money mt-1 text-[16px] font-bold text-slate-900 dark:text-slate-100">{hidden ? "£••••" : money(owed)}</dd>
        </div>
      </dl>
    );
  }

  return (
    <details className="group mt-4 max-w-sm border-t border-slate-300/80 dark:border-slate-700">
      <summary className="flex min-h-11 touch-manipulation cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-semibold text-slate-700 [-webkit-tap-highlight-color:transparent] marker:content-none hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:text-white [&::-webkit-details-marker]:hidden">
        What makes this up
        <ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <dl className="pb-2 text-[12px] text-slate-600 dark:text-slate-400">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <dt>Cash and savings</dt>
          <dd className="money font-semibold text-slate-900 dark:text-slate-100">{hidden ? "£••••" : money(cash)}</dd>
        </div>
        <div className="flex min-h-8 items-center justify-between gap-4">
          <dt>Investments</dt>
          <dd className="money font-semibold text-slate-900 dark:text-slate-100">{hidden ? "£••••" : money(investments)}</dd>
        </div>
        <div className="flex min-h-8 items-center justify-between gap-4">
          <dt>Card position</dt>
          <dd className="money font-semibold text-slate-900 dark:text-slate-100">{hidden ? "£••••" : money(cardPosition)}</dd>
        </div>
        <div className="mt-1 flex min-h-9 items-center justify-between gap-4 border-t border-slate-300/80 pt-1 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
          <dt>Net worth</dt>
          <dd className="money font-bold">{hidden ? "£••••" : money(estate.netWorth)}</dd>
        </div>
      </dl>
    </details>
  );
}

function AddMenu({ open, onToggle, onChoose }: { open: boolean; onToggle: () => void; onChoose: (label: string) => void }) {
  const options = [
    { label: "Connect a Bank", Icon: Landmark },
    { label: "Upload Statement", Icon: Upload },
    { label: "Add Investment", Icon: TrendingUp },
    { label: "Add Offline Account", Icon: Plus },
  ];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="g87-add-options"
        className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
      >
        <Plus size={16} aria-hidden="true" />
        Add
        <ChevronDown size={14} className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id="g87-add-options" aria-label="Add an account" className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {options.map(({ label, Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onChoose(label)}
              className="flex min-h-11 w-full touch-manipulation items-center gap-2.5 px-3.5 text-left text-[13px] font-medium text-slate-700 [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-700 dark:active:bg-slate-700 motion-reduce:transition-none"
            >
              <Icon size={15} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type HeaderProps = {
  estate: Estate;
  hidden: boolean;
  onToggleHidden: () => void;
  addOpen: boolean;
  onToggleAdd: () => void;
  onChooseAdd: (label: string) => void;
};

function AccountsCanvasHeader({ estate, hidden, onToggleHidden, addOpen, onToggleAdd, onChooseAdd, variant }: HeaderProps & { variant: Variant }) {
  const bankCount = estate.rows.filter((row) => row.source === "bank" && row.kind !== "Offline").length;
  const investmentCount = estate.rows.filter((row) => row.source === "investment").length;
  const offlineCount = estate.rows.filter((row) => row.kind === "Offline").length;

  return (
    <header>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Accounts</h1>
          <p className="mt-1 max-w-[62ch] text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Everything you own and owe, in one position.</p>
        </div>
        <AddMenu open={addOpen} onToggle={onToggleAdd} onChoose={onChooseAdd} />
      </div>

      <div className="mt-8 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600 dark:text-slate-400">Net worth</p>
          <p className="money mt-1 text-[34px] font-bold leading-none tracking-[-0.035em] text-slate-950 dark:text-white" aria-label={hidden ? "Net worth hidden" : undefined}>
            {hidden ? "£••••••" : money(estate.netWorth)}
          </p>
          <p className="mt-2 text-[12px] text-slate-600 dark:text-slate-400">
            {bankCount} bank {bankCount === 1 ? "account" : "accounts"} · {investmentCount} {investmentCount === 1 ? "investment" : "investments"} · {offlineCount} offline
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleHidden}
          aria-label={hidden ? "Show summary balances" : "Hide summary balances"}
          className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-slate-200/70 text-slate-600 [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-300/70 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          {hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      <PositionContext estate={estate} hidden={hidden} variant={variant} />
    </header>
  );
}

function EstateControls({ query, onQuery, lens, onLens }: { query: string; onQuery: (value: string) => void; lens: EstateLens; onLens: (value: EstateLens) => void }) {
  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <input
          type="search"
          name="account-search"
          autoComplete="off"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Find an account…"
          aria-label="Find an account"
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-[14px] text-slate-900 shadow-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear account search"
            className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Account filters">
        {LENSES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onLens(item)}
            aria-pressed={lens === item}
            className={`min-h-11 shrink-0 touch-manipulation rounded-full px-3.5 text-[13px] font-semibold [-webkit-tap-highlight-color:transparent] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${lens === item ? "bg-indigo-600 text-white" : "bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountGroupCard({ group, hidden, collapsed, onToggle, onSelect, fixed = false }: { group: EstateGroup; hidden: boolean; collapsed: boolean; onToggle: () => void; onSelect: (row: EstateRow) => void; fixed?: boolean }) {
  const headerContent = (
    <>
      <span>
        <span role="heading" aria-level={2} className="block text-[15px] font-bold text-slate-900 dark:text-slate-100">{group.label}</span>
        <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{group.count} {group.count === 1 ? "account" : "accounts"}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="money text-[14px] font-semibold text-slate-800 dark:text-slate-200">{hidden ? "£••••" : money(group.subtotal)}</span>
        {!fixed && <ChevronDown size={16} className={`text-slate-400 transition-transform motion-reduce:transition-none ${collapsed ? "" : "rotate-180"}`} aria-hidden="true" />}
      </span>
    </>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-label={`${group.label} accounts`}>
      {fixed ? (
        <div className="flex min-h-16 items-center justify-between gap-3 px-4">{headerContent}</div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-h-16 w-full touch-manipulation items-center justify-between gap-3 px-4 text-left [-webkit-tap-highlight-color:transparent] transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none dark:hover:bg-slate-700/60 dark:active:bg-slate-700"
        >
          {headerContent}
        </button>
      )}
      {!collapsed && (
        <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700 dark:border-slate-700">
          {group.rows.map((row) => (
            <AccountLedgerRow
              key={row.id}
              row={row}
              onClick={onSelect}
              termsPill={termsForRow(row)}
              onTermsClick={row.kind === "Credit" ? () => onSelect(row) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function termsForRow(row: EstateRow): TermsPill | null {
  if (row.id === "amex-card") return { label: "19.9% APR", accruing: true };
  if (row.id === "natwest-card") return { label: "0% until Aug 2027", accruing: false };
  if (row.id === "john-lewis-credit") return { label: "0% until Mar 2027", accruing: false };
  if (row.id === "amex-reserve") return { label: "0% until Feb 2027", accruing: false };
  return null;
}

function EmptyEstate({ onChoose }: { onChoose: (label: string) => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" aria-labelledby="empty-estate-title">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
        <Landmark size={25} aria-hidden="true" />
      </span>
      <h2 id="empty-estate-title" className="mt-4 text-[18px] font-bold text-slate-950 dark:text-white">Bring your first account into view</h2>
      <p className="mx-auto mt-2 max-w-[52ch] text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Connect securely through Open Banking, or start from a statement. Net worth will build from the positions you add.</p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <button type="button" onClick={() => onChoose("Connect a Bank")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800">
          <Plus size={16} aria-hidden="true" /> Connect a Bank
        </button>
        <button type="button" onClick={() => onChoose("Upload Statement")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
          <Upload size={16} aria-hidden="true" /> Upload Statement
        </button>
      </div>
    </section>
  );
}

function DesignNote({ variant }: { variant: Variant }) {
  const note = VARIANT_NOTES[variant];
  return (
    <section className="rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700" aria-label="Design direction">
      <h2 className="text-[14px] font-bold text-indigo-700 dark:text-indigo-300">{note.title}</h2>
      <p className="mt-2 text-[13px] leading-5 text-slate-700 dark:text-slate-300">{note.thesis}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Rule:</span> {note.rule}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Trade-off:</span> {note.tradeoff}</p>
    </section>
  );
}

function PreviewNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-medium text-indigo-800 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-200">{message}</p>;
}

function allGroups(estate: Estate): EstateGroup[] {
  const result = [...estate.groups];
  const offlineRows = estate.rows.filter((row) => row.kind === "Offline");
  if (offlineRows.length > 0) {
    result.push({ kind: "Offline", label: "Offline accounts", count: offlineRows.length, subtotal: offlineRows.reduce((sum, row) => sum + row.balance, 0), rows: offlineRows });
  }
  if (estate.inactive.length > 0) {
    result.push({ kind: "Current", label: "Inactive", count: estate.inactive.length, subtotal: estate.inactive.reduce((sum, row) => sum + row.balance, 0), rows: estate.inactive });
  }
  return result;
}

type ListSharedProps = HeaderProps & {
  estate: Estate;
  query: string;
  onQuery: (value: string) => void;
  lens: EstateLens;
  onLens: (value: EstateLens) => void;
  filteredRows: EstateRow[];
  filtering: boolean;
  collapsed: Record<string, boolean>;
  onToggleGroup: (label: string) => void;
  onSelect: (row: EstateRow) => void;
  focusGroup: string;
  onFocusGroup: (label: string) => void;
  notice: string | null;
  onReconnect: (provider: string) => void;
};

function ReconnectArea({ estate, onReconnect }: { estate: Estate; onReconnect: (provider: string) => void }) {
  const providers = Array.from(new Set(estate.attention.map((row) => row.provider))).map((provider) => ({ provider, provider_id: `${provider.toLowerCase()}-preview`, account_count: estate.attention.filter((row) => row.provider === provider).length }));
  return <ReconnectStrip providers={providers} onReconnect={(item) => onReconnect(item.provider)} />;
}

function FilteredCard({ rows, hidden, onSelect }: { rows: EstateRow[]; hidden: boolean; onSelect: (row: EstateRow) => void }) {
  const group: EstateGroup = { kind: "Current", label: `${rows.length} ${rows.length === 1 ? "result" : "results"}`, count: rows.length, subtotal: rows.reduce((sum, row) => sum + row.balance, 0), rows };
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-[14px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:shadow-none">No accounts match. Clear the search or choose another filter.</div>;
  }
  return <AccountGroupCard group={group} hidden={hidden} collapsed={false} onToggle={() => {}} onSelect={onSelect} fixed />;
}

function VariantAList(props: ListSharedProps) {
  const groups = allGroups(props.estate);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6 lg:px-8">
      <AccountsCanvasHeader {...props} variant="a" />
      <div className="mt-8 space-y-3">
        <PreviewNotice message={props.notice} />
        <ReconnectArea estate={props.estate} onReconnect={props.onReconnect} />
        {props.estate.rows.length === 0 ? <EmptyEstate onChoose={props.onChooseAdd} /> : (
          <>
            <EstateControls query={props.query} onQuery={props.onQuery} lens={props.lens} onLens={props.onLens} />
            {props.filtering ? <FilteredCard rows={props.filteredRows} hidden={props.hidden} onSelect={props.onSelect} /> : groups.map((group) => (
              <AccountGroupCard key={group.label} group={group} hidden={props.hidden} collapsed={props.collapsed[group.label] ?? group.label === "Inactive"} onToggle={() => props.onToggleGroup(group.label)} onSelect={props.onSelect} />
            ))}
          </>
        )}
      </div>
      <div className="mt-12"><DesignNote variant="a" /></div>
    </div>
  );
}

function VariantBList(props: ListSharedProps) {
  const groups = allGroups(props.estate);
  const selected = groups.find((group) => group.label === props.focusGroup) ?? groups[0];
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6 lg:px-8">
      <AccountsCanvasHeader {...props} variant="b" />
      <div className="mt-8 space-y-4">
        <PreviewNotice message={props.notice} />
        <ReconnectArea estate={props.estate} onReconnect={props.onReconnect} />
        {props.estate.rows.length === 0 ? <EmptyEstate onChoose={props.onChooseAdd} /> : (
          <>
            <EstateControls query={props.query} onQuery={props.onQuery} lens={props.lens} onLens={props.onLens} />
            {props.filtering ? <FilteredCard rows={props.filteredRows} hidden={props.hidden} onSelect={props.onSelect} /> : (
              <>
                <div className="grid grid-cols-2 gap-x-4 border-y border-slate-300/80 py-2 dark:border-slate-700 sm:grid-cols-3" aria-label="Account groups">
                  {groups.map((group) => {
                    const active = selected?.label === group.label;
                    return (
                      <button key={group.label} type="button" onClick={() => props.onFocusGroup(group.label)} aria-pressed={active} className={`min-h-16 rounded-xl px-2 py-2 text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${active ? "bg-indigo-100/80 dark:bg-indigo-500/15" : "hover:bg-slate-200/60 dark:hover:bg-slate-800"}`}>
                        <span className={`block text-[12px] font-semibold ${active ? "text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-400"}`}>{group.label}</span>
                        <span className="money mt-1 block text-[15px] font-bold text-slate-900 dark:text-slate-100">{props.hidden ? "£••••" : money(group.subtotal)}</span>
                      </button>
                    );
                  })}
                </div>
                {selected && <AccountGroupCard group={selected} hidden={props.hidden} collapsed={false} onToggle={() => {}} onSelect={props.onSelect} fixed />}
              </>
            )}
          </>
        )}
      </div>
      <div className="mt-12"><DesignNote variant="b" /></div>
    </div>
  );
}

function VariantCList(props: ListSharedProps) {
  const groups = allGroups(props.estate);
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-10 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(290px,0.8fr)_minmax(0,1.55fr)] lg:gap-16 lg:px-8">
      <div className="min-w-0 lg:sticky lg:top-6">
        <AccountsCanvasHeader {...props} variant="c" />
        <div className="mt-10 hidden lg:block"><DesignNote variant="c" /></div>
      </div>
      <div className="min-w-0 space-y-3 lg:pt-2">
        <PreviewNotice message={props.notice} />
        <ReconnectArea estate={props.estate} onReconnect={props.onReconnect} />
        {props.estate.rows.length === 0 ? <EmptyEstate onChoose={props.onChooseAdd} /> : (
          <>
            <EstateControls query={props.query} onQuery={props.onQuery} lens={props.lens} onLens={props.onLens} />
            {props.filtering ? <FilteredCard rows={props.filteredRows} hidden={props.hidden} onSelect={props.onSelect} /> : groups.map((group) => (
              <AccountGroupCard key={group.label} group={group} hidden={props.hidden} collapsed={props.collapsed[group.label] ?? group.label === "Inactive"} onToggle={() => props.onToggleGroup(group.label)} onSelect={props.onSelect} />
            ))}
          </>
        )}
        <div className="pt-8 lg:hidden"><DesignNote variant="c" /></div>
      </div>
    </div>
  );
}

function detailBrandAccount(row: EstateRow): Account {
  if (row.source === "bank") return row.raw as Account;
  return { id: row.id, name: row.name, type: "Investment", balance: row.balance, currency: "GBP", provider: row.provider, status: row.status };
}

function DetailCanvasHeader({ fixture, hidden, onToggleHidden, onBack, onAction, variant }: { fixture: AccountDetailFixture; hidden: boolean; onToggleHidden: () => void; onBack: () => void; onAction: (label: string) => void; variant: Variant }) {
  const brand = accountBrand(detailBrandAccount(fixture.row));
  const negative = fixture.row.balance < 0;
  const caption = fixture.row.kind === "Credit" && negative ? "owed" : fixture.row.kind !== "Credit" && negative ? "overdrawn" : fixture.row.kind === "Credit" && fixture.row.balance > 0 ? "in credit" : null;

  return (
    <header>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-[14px] font-semibold text-slate-600 transition-colors hover:text-slate-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-slate-400 dark:hover:text-white">
          <ArrowLeft size={18} aria-hidden="true" /> Accounts
        </button>
        <div className="flex gap-1">
          {fixture.row.kind === "Offline" && <button type="button" onClick={() => onAction("Edit account")} aria-label="Edit account" className="flex size-11 items-center justify-center rounded-xl bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"><Pencil size={16} aria-hidden="true" /></button>}
          {fixture.row.source === "investment" && <button type="button" onClick={() => onAction("Refresh prices")} aria-label="Refresh prices" className="flex size-11 items-center justify-center rounded-xl bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"><RefreshCw size={16} aria-hidden="true" /></button>}
          <button type="button" onClick={() => onAction("Pin to Home")} aria-label="Pin to Home" className="flex size-11 items-center justify-center rounded-xl bg-amber-100/80 text-amber-700 hover:bg-amber-200/80 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/15"><Star size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => onAction("Remove account")} aria-label="Remove account" className="flex size-11 items-center justify-center rounded-xl bg-rose-100 text-rose-700 hover:bg-rose-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"><Trash2 size={16} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-bold text-slate-950 dark:text-white">{fixture.row.name}</h1>
          <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">{fixture.row.kind === "Credit" ? "Credit card" : fixture.row.kind} · {fixture.row.provider}</p>
        </div>
      </div>

      <div className="mt-6 flex items-start justify-between gap-3">
        <div>
          <p className={`money text-[34px] font-bold leading-none tracking-[-0.035em] ${fixture.terms?.risk ? "text-rose-700 dark:text-rose-300" : "text-slate-950 dark:text-white"}`} aria-label={hidden ? "Balance hidden" : undefined}>{hidden ? "£••••" : money(fixture.row.balance, false, true)}</p>
          {caption && <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">{caption}</p>}
          {fixture.terms && <span className={`mt-2 inline-flex min-h-7 items-center rounded-full px-2.5 text-[11px] font-semibold ${fixture.terms.risk ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200" : "bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{fixture.terms.label}</span>}
        </div>
        <button type="button" onClick={onToggleHidden} aria-label={hidden ? "Show balance" : "Hide balance"} className="flex size-11 items-center justify-center rounded-full bg-slate-200/70 text-slate-600 hover:bg-slate-300/70 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">{hidden ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
      </div>
      <p className="mt-4 max-w-[62ch] text-pretty text-[13px] leading-5 text-slate-700 dark:text-slate-300">{fixture.supporting}</p>
      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">{fixture.updated}</p>
      {variant !== "c" && <div className="mt-5 border-t border-slate-300/80 dark:border-slate-700" />}
    </header>
  );
}

function CategoryList({ fixture, onChoose }: { fixture: AccountDetailFixture; onChoose: (category: string) => void }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      {(fixture.categories ?? []).map((category) => {
        const colour = getCategoryColour(category.name, {});
        const Icon = getCategoryIcon(category.name, {});
        return (
          <button key={category.name} type="button" onClick={() => onChoose(category.name)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/60 dark:active:bg-slate-700">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${colour}26` }}><Icon size={16} style={{ color: colour }} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{category.name}</span><span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{category.count} payments · 90 days</span></span>
            <span className="money text-[14px] font-bold text-slate-900 dark:text-slate-100">{money(category.total, false, true)}</span>
          </button>
        );
      })}
    </div>
  );
}

function RecordsList({ fixture, activeTab, onAction }: { fixture: AccountDetailFixture; activeTab: string; onAction: (label: string) => void }) {
  const holdings = activeTab === "Holdings" ? fixture.holdings : undefined;
  const records = activeTab === "Notes" ? fixture.rules : activeTab === "Rules" ? fixture.rules : undefined;
  if (holdings) {
    return <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">{holdings.map((holding) => <button key={holding.name} type="button" onClick={() => onAction(`Open ${holding.name}`)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/60 dark:active:bg-slate-700"><span className="flex size-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"><TrendingUp size={16} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{holding.name}</span><span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{holding.units}</span></span><span className="money text-[14px] font-bold text-slate-900 dark:text-slate-100">{money(holding.value)}</span></button>)}</div>;
  }
  return <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">{(records ?? []).map((record) => <button key={record.name} type="button" onClick={() => onAction(`Open ${record.name}`)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/60 dark:active:bg-slate-700"><span className="flex size-9 items-center justify-center rounded-xl bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">{activeTab === "Notes" ? <FileText size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}</span><span className="min-w-0 flex-1"><span className={`block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100 ${record.active ? "" : "line-through opacity-60"}`}>{record.name}</span><span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{record.detail}</span></span></button>)}</div>;
}

function DetailPanel({ fixture, notice, onAction }: { fixture: AccountDetailFixture; notice: string | null; onAction: (label: string) => void }) {
  const [activeTab, setActiveTab] = useState(fixture.tabs[0]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setActiveTab(fixture.tabs[0]);
    setQuery("");
  }, [fixture.row.id, fixture.state, fixture.tabs]);

  const filteredTransactions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return fixture.transactions ?? [];
    return (fixture.transactions ?? []).filter((transaction) => `${transaction.merchant_name ?? ""} ${transaction.description} ${transaction.category ?? ""}`.toLowerCase().includes(search));
  }, [fixture.transactions, query]);

  return (
    <div className="space-y-3">
      <PreviewNotice message={notice} />
      {fixture.reconnect && <ReconnectStrip providers={[{ provider: fixture.row.provider, provider_id: "detail-preview", account_count: 1 }]} onReconnect={() => onAction(`Reconnect ${fixture.row.provider}`)} />}
      <SegmentedControl options={fixture.tabs} value={activeTab} onChange={setActiveTab} ariaLabel="Account detail view" />
      {activeTab === "Transactions" && (
        <>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <input type="search" name="transaction-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions…" aria-label="Search transactions" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-[14px] text-slate-900 shadow-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear transaction search" className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-400"><X size={16} aria-hidden="true" /></button>}
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
            {filteredTransactions.length > 0 ? filteredTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onClick={() => onAction(`Open ${transaction.merchant_name ?? transaction.description}`)} />) : <p className="px-4 py-10 text-center text-[14px] text-slate-600 dark:text-slate-400">No transactions match. Clear the search and try again.</p>}
          </div>
        </>
      )}
      {activeTab === "Categories" && <CategoryList fixture={fixture} onChoose={(category) => { setActiveTab("Transactions"); setQuery(category); }} />}
      {(activeTab === "Rules" || activeTab === "Holdings" || activeTab === "Notes") && <RecordsList fixture={fixture} activeTab={activeTab} onAction={onAction} />}
    </div>
  );
}

function DetailPage({ fixture, variant, hidden, onToggleHidden, onBack, notice, onAction }: { fixture: AccountDetailFixture; variant: Variant; hidden: boolean; onToggleHidden: () => void; onBack: () => void; notice: string | null; onAction: (label: string) => void }) {
  if (variant === "c") {
    return <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-start gap-10 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(290px,0.8fr)_minmax(0,1.55fr)] lg:gap-16 lg:px-8"><div className="min-w-0 lg:sticky lg:top-6"><DetailCanvasHeader fixture={fixture} hidden={hidden} onToggleHidden={onToggleHidden} onBack={onBack} onAction={onAction} variant={variant} /><div className="mt-10 hidden lg:block"><DesignNote variant={variant} /></div></div><div className="min-w-0 space-y-8 lg:pt-14"><DetailPanel fixture={fixture} notice={notice} onAction={onAction} /><div className="lg:hidden"><DesignNote variant={variant} /></div></div></div>;
  }
  return <div className={`mx-auto w-full px-4 pt-6 sm:px-6 lg:px-8 ${variant === "a" ? "max-w-3xl" : "max-w-4xl"}`}><DetailCanvasHeader fixture={fixture} hidden={hidden} onToggleHidden={onToggleHidden} onBack={onBack} onAction={onAction} variant={variant} /><div className="mt-5"><DetailPanel fixture={fixture} notice={notice} onAction={onAction} /></div><div className="mt-12"><DesignNote variant={variant} /></div></div>;
}

function PreviewControls({ variant, mode, state }: { variant: Variant; mode: Mode; state: AccountsPreviewState }) {
  const hrefFor = (next: { variant?: Variant; mode?: Mode; state?: AccountsPreviewState }) => {
    const params = new URLSearchParams({ variant: next.variant ?? variant, mode: next.mode ?? mode, state: next.state ?? state });
    return `?${params.toString()}`;
  };
  return (
    <nav aria-label="G87 design preview controls" className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1.5">
        {VARIANTS.map((item) => <a key={item} href={hrefFor({ variant: item })} aria-current={variant === item ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-[12px] font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transition-none ${variant === item ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>{item.toUpperCase()} · {item === "a" ? "Quiet" : item === "b" ? "Own / owe" : "Breakdown"}</a>)}
        <label className="ml-auto flex min-h-11 items-center rounded-xl bg-white/10 px-2.5 text-[12px] text-slate-300 focus-within:ring-2 focus-within:ring-indigo-400">
          <span className="sr-only">Preview Accounts state</span>
          <select name="preview-state" value={state} onChange={(event) => window.location.assign(hrefFor({ state: event.target.value as AccountsPreviewState }))} className="cursor-pointer bg-slate-800 pr-1 font-semibold text-white outline-none">
            {PREVIEW_STATES.map((item) => <option key={item} value={item} className="bg-slate-900">{PREVIEW_STATE_LABELS[item]}</option>)}
          </select>
        </label>
        <a href={hrefFor({ mode: mode === "dark" ? "light" : "dark" })} className="inline-flex min-h-11 items-center rounded-xl px-3 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transition-none">{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
    </nav>
  );
}

export default function AccountsCanvasBeforeCardsClient() {
  const params = useSearchParams();
  const router = useRouter();
  const requestedVariant = params.get("variant") as Variant | null;
  const requestedState = params.get("state") as AccountsPreviewState | null;
  const variant = requestedVariant && VARIANTS.includes(requestedVariant) ? requestedVariant : "a";
  const state = requestedState && PREVIEW_STATES.includes(requestedState) ? requestedState : "estate";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const hideControls = params.get("controls") === "0";
  const estate = estateForState(state);
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<EstateLens>("All");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ Inactive: true });
  const [focusGroup, setFocusGroup] = useState("Current");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousDark = root.classList.contains("dark");
    const previousColourScheme = root.style.colorScheme;
    const previousThemeColour = themeMeta?.getAttribute("content") ?? null;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    themeMeta?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
    return () => {
      root.classList.toggle("dark", previousDark);
      root.style.colorScheme = previousColourScheme;
      if (previousThemeColour === null) themeMeta?.removeAttribute("content");
      else themeMeta?.setAttribute("content", previousThemeColour);
    };
  }, [mode]);

  useEffect(() => {
    setQuery("");
    setLens("All");
    setNotice(null);
    setAddOpen(false);
  }, [state]);

  const filtering = query.trim().length > 0 || lens !== "All";
  const filteredRows = useMemo(() => filterEstate(estate.rows, { query, lens }), [estate.rows, lens, query]);

  const hrefForState = (nextState: AccountsPreviewState, accountId?: string) => {
    const next = new URLSearchParams({ variant, mode, state: nextState });
    if (hideControls) next.set("controls", "0");
    if (accountId) next.set("account", accountId);
    return `?${next.toString()}`;
  };

  const detailStateForRow = (row: EstateRow): AccountsPreviewState => {
    if (row.attention) return "detail-expired";
    if (row.source === "investment") return "detail-investment";
    if (row.kind === "Offline") return "detail-manual";
    if (row.kind === "Credit") return "detail-credit";
    return "detail-current";
  };

  const handleSelect = (row: EstateRow) => router.push(hrefForState(detailStateForRow(row), row.id));
  const chooseAction = (label: string) => { setAddOpen(false); setNotice(`${label} is shown for placement only in this fixture preview. No account changes were made.`); };
  const reconnect = (provider: string) => setNotice(`${provider} reconnect is shown for placement only. No bank connection was opened.`);
  const toggleGroup = (label: string) => setCollapsed((current) => ({ ...current, [label]: !current[label] }));

  let content: React.ReactNode;
  if (isDetailState(state)) {
    const baseFixture = DETAIL_FIXTURES[state];
    const requestedId = params.get("account");
    const requestedRow = requestedId ? estate.rows.find((row) => row.id === requestedId) : undefined;
    let fixture: AccountDetailFixture = requestedRow
      ? {
          ...baseFixture,
          row: requestedRow,
          supporting: requestedRow.kind === "Credit"
            ? baseFixture.supporting
            : `${requestedRow.kind} account at ${requestedRow.provider}. Recent activity is illustrated below.`,
        }
      : baseFixture;
    if (requestedRow?.id === "natwest-card") {
      fixture = {
        ...fixture,
        supporting: "£6,222 owed. The recorded purchase offer is currently applying.",
        terms: { label: "0% until Aug 2027", risk: false },
      };
    } else if (requestedRow?.id === "john-lewis-credit") {
      fixture = {
        ...fixture,
        supporting: "This card is £42.50 in credit.",
        terms: { label: "0% until Mar 2027", risk: false },
      };
    }
    content = <DetailPage fixture={fixture} variant={variant} hidden={hidden} onToggleHidden={() => setHidden((value) => !value)} onBack={() => router.push(hrefForState("estate"))} notice={notice} onAction={chooseAction} />;
  } else {
    const shared: ListSharedProps = {
      estate,
      hidden,
      onToggleHidden: () => setHidden((value) => !value),
      addOpen,
      onToggleAdd: () => setAddOpen((value) => !value),
      onChooseAdd: chooseAction,
      query,
      onQuery: setQuery,
      lens,
      onLens: setLens,
      filteredRows,
      filtering,
      collapsed,
      onToggleGroup: toggleGroup,
      onSelect: handleSelect,
      focusGroup,
      onFocusGroup: setFocusGroup,
      notice,
      onReconnect: reconnect,
    };
    content = variant === "b" ? <VariantBList {...shared} /> : variant === "c" ? <VariantCList {...shared} /> : <VariantAList {...shared} />;
  }

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode, "--design-controls-clearance": hideControls ? "0px" : "108px" } as React.CSSProperties}>
      <div className={`min-h-dvh bg-[#f0f2f7] text-slate-950 selection:bg-indigo-200 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white ${hideControls ? "pb-32" : "pb-60"} lg:pb-16`} style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <p className="sr-only">Illustrative figures, not real balances. G87 Accounts canvas before cards variant {variant.toUpperCase()}.</p>
        <a href="#g87-main" className="sr-only fixed left-3 top-3 z-[100] rounded-xl bg-white px-4 py-3 font-semibold text-slate-950 shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:text-white">Skip to Accounts content</a>
        <main id="g87-main" tabIndex={-1}>{content}</main>
        <FixtureBottomNav />
        {!hideControls && <PreviewControls variant={variant} mode={mode} state={state} />}
      </div>
    </div>
  );
}
