"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import type { Account } from "@/lib/api";
import styles from "./fresh.module.css";
import {
  AccountRow,
  classOf,
  FOCUS,
  matchesQuery,
  SECONDARY,
  usability,
} from "./shared";

export type FreshProps = {
  accounts: Account[];
  excludedIds: Set<string>;
  shortAccountIds: Set<string>;
  hideAmounts: boolean;
  onToggle: (id: string) => void;
  status: "ready" | "loading" | "error" | "save-error";
  saveMessage: string | null;
  retry: () => void;
  retrySave: () => void;
  saving: boolean;
  themeClass?: string;
};

const GROUPS = [
  ["current", "Current accounts"],
  ["savings", "Savings"],
] as const;

function Intro({ headingId }: { headingId: string }) {
  return (
    <header className="max-w-2xl">
      <h2 id={headingId} className="text-[21px] font-bold tracking-tight text-slate-950 dark:text-white">Choose accounts for cover</h2>
      <p className={`mt-2 text-[14px] leading-relaxed ${SECONDARY}`}>
        Allow an account to appear in cover suggestions. You decide whether to move money.
      </p>
      <p className={`mt-2 text-[13px] leading-relaxed ${SECONDARY}`}>
        Current accounts are considered first. Savings are considered only if needed. Suggestions leave a <span className="money">£10</span> buffer after the account&rsquo;s own bills and plans.
      </p>
    </header>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return <label className="relative block">
    <span className="sr-only">Find an account</span>
    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
    <input data-g200-search type="search" value={value} onChange={event => onChange(event.target.value)} placeholder="Find an account or bank" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-[16px] text-slate-950 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-400" />
  </label>;
}

function Status({ props }: { props: FreshProps }) {
  if (props.status === "loading") return <p role="status" className={`rounded-xl bg-slate-100 px-3 py-3 text-[13px] ${SECONDARY} dark:bg-white/[0.06]`}>Checking which accounts can help today…</p>;
  if (props.status === "error") return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[13px] text-slate-800 dark:border-amber-400/30 dark:bg-amber-400/[0.08] dark:text-slate-100"><p>We could not check today&rsquo;s account availability. Your permission choices are unchanged.</p><button type="button" data-g200-retry onClick={props.retry} className={`mt-1 font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 ${FOCUS}`}>Try again</button></div>;
  if (props.status === "save-error" && !props.saveMessage) return <p role="status" data-g200-save-status className={`rounded-xl bg-slate-100 px-3 py-3 text-[13px] ${SECONDARY} dark:bg-white/[0.06]`}>The last preview change could not be saved. Your previous choice is still in place.</p>;
  if (props.saveMessage) return <div role="status" data-g200-save-status className={`rounded-xl bg-slate-100 px-3 py-3 text-[13px] ${SECONDARY} dark:bg-white/[0.06]`}><p>{props.saveMessage}</p>{props.saveMessage.startsWith("Could not save") && <button type="button" data-g200-retry-save onClick={props.retrySave} className={`mt-1 font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 ${FOCUS}`}>Try change again</button>}</div>;
  return null;
}

function Availability({ account, props }: { account: Account; props: FreshProps }) {
  if (props.status === "loading") return <span className={`mt-1 block text-[12px] ${SECONDARY}`}>Availability is still being checked.</span>;
  if (props.status === "error") return <span className={`mt-1 block text-[12px] ${SECONDARY}`}>Availability is unavailable right now.</span>;
  const shortIds = props.shortAccountIds;
  const reason = usability(account, shortIds);
  if (!reason) return null;
  return <span className={`mt-1 block text-[12px] ${SECONDARY}`}>{reason === "short" ? "Cannot spare anything today." : "Empty today."}</span>;
}

function DirectoryRows({ accounts, props }: { accounts: Account[]; props: FreshProps }) {
  return <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
    {accounts.map(account => <AccountRow key={account.id} account={account} allowed={!props.excludedIds.has(account.id)} reason={null} showBalance={false} hideAmounts={props.hideAmounts} onToggle={props.onToggle} disabled={props.saving} availability={<Availability account={account} props={props} />} />)}
  </ul>;
}

function Empty({ query }: { query: string }) {
  return <p role="status" className={`py-5 text-[14px] ${SECONDARY}`}>{query ? "No accounts match that search." : "There are no accounts to choose from yet."}</p>;
}

export function AccountDirectory(props: FreshProps) {
  const [query, setQuery] = useState("");
  const matches = props.accounts.filter(account => matchesQuery(account, query));
  return <section aria-labelledby="cover-d-heading" className="space-y-5">
    <Intro headingId="cover-d-heading" />
    <Status props={props} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_210px] lg:items-start">
      <div className="glass-card overflow-hidden rounded-2xl p-4">
        <SearchField value={query} onChange={setQuery} />
        {props.status === "loading" ? <div className="space-y-3 pt-5" aria-hidden="true"><div className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /><div className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /></div> : matches.length === 0 ? <Empty query={query} /> : GROUPS.map(([kind, label]) => {
          const group = matches.filter(account => classOf(account) === kind);
          return group.length ? <section key={kind} className="mt-5 first:mt-4"><h3 className="mb-2 text-[13px] font-semibold text-slate-700 dark:text-slate-200">{label}</h3><DirectoryRows accounts={group} props={props} /></section> : null;
        })}
      </div>
      <div role="region" aria-label="How permission differs from availability" className="hidden border-l border-slate-200 pl-4 text-[13px] leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:block"><ShieldCheck size={18} aria-hidden="true" className="mb-2 text-indigo-600 dark:text-indigo-400" /><p className="font-semibold text-slate-900 dark:text-white">Your choice stays separate</p><p className="mt-1">An account can be allowed and still be unable to spare money today. That does not turn it off.</p><a href="/upcoming" className={`mt-3 inline-flex min-h-11 items-center font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 ${FOCUS}`}>See today&rsquo;s suggestion in Upcoming</a></div>
    </div>
    <a href="/upcoming" className={`inline-flex min-h-11 items-center font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 lg:hidden ${FOCUS}`}>See today&rsquo;s suggestion in Upcoming</a>
  </section>;
}

function BankFolder({ bank, accounts, props, forcedOpen, open, onToggle }: { bank: string; accounts: Account[]; props: FreshProps; forcedOpen: boolean; open: boolean; onToggle: () => void }) {
  const visible = forcedOpen || open;
  return <section className="border-t border-slate-100 first:border-t-0 dark:border-slate-700/70">
    <button type="button" onClick={onToggle} aria-expanded={visible} className={`flex min-h-14 w-full items-center gap-3 text-left ${FOCUS}`}><span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold text-slate-950 dark:text-white">{bank}</span><span className={`block text-[12px] ${SECONDARY}`}>Account permissions</span></span><ChevronDown size={17} aria-hidden="true" className={`text-slate-500 transition-transform ${visible ? "rotate-180" : ""}`} /></button>
    {visible && <DirectoryRows accounts={accounts} props={props} />}
  </section>;
}

export function BankFolders(props: FreshProps) {
  const [query, setQuery] = useState("");
  const [openBanks, setOpenBanks] = useState<Set<string>>(() => new Set([props.accounts.map(account => account.provider).sort((a, b) => a.localeCompare(b))[0]].filter(Boolean)));
  const groups = useMemo(() => {
    const map = new Map<string, Account[]>();
    props.accounts.filter(account => matchesQuery(account, query)).forEach(account => map.set(account.provider, [...(map.get(account.provider) ?? []), account]));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [props.accounts, query]);
  const toggleBank = (bank: string) => setOpenBanks(previous => {
    const next = new Set(previous);
    if (next.has(bank)) next.delete(bank);
    else next.add(bank);
    return next;
  });
  return <section aria-labelledby="cover-e-heading" className="space-y-5"><Intro headingId="cover-e-heading" /><Status props={props} /><div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]"><div role="region" aria-label="Bank index" className="hidden lg:block"><p className="text-[13px] font-semibold text-slate-900 dark:text-white">Banks</p><nav aria-label="Bank folders" className="mt-2 space-y-1">{groups.map(([bank]) => <a key={bank} href={`#g200-bank-${bank.replaceAll(" ", "-")}`} className={`flex min-h-11 items-center text-[13px] ${SECONDARY}`}>{bank}</a>)}</nav></div><div className="glass-card rounded-2xl p-4"><SearchField value={query} onChange={setQuery} />{groups.length ? <div className="mt-3">{groups.map(([bank, accounts]) => <div id={`g200-bank-${bank.replaceAll(" ", "-")}`} key={bank}><BankFolder bank={bank} accounts={accounts} props={props} forcedOpen={Boolean(query)} open={openBanks.has(bank)} onToggle={() => toggleBank(bank)} /></div>)}</div> : <Empty query={query} />}</div></div><a href="/upcoming" className={`inline-flex min-h-11 items-center font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 ${FOCUS}`}>See today&rsquo;s suggestion in Upcoming</a></section>;
}

function PermissionSheet({ props, close }: { props: FreshProps; close: () => void }) {
  const [query, setQuery] = useState("");
  const accounts = props.accounts.filter(account => matchesQuery(account, query));
  return (
    <SheetFrame
      title="Edit account permissions"
      description="Allow an account to appear in cover suggestions. You decide whether to move money."
      onClose={close}
      themeClass={props.themeClass}
      bodyClassName={`px-5 py-4 ${styles.permissions}`}
      footer={<button type="button" data-g200-done onClick={close} className="mb-1 w-full rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white active:scale-[0.99]">Done</button>}
    >
      <Status props={props} />
      <SearchField value={query} onChange={setQuery} />
      {accounts.length ? <DirectoryRows accounts={accounts} props={props} /> : <Empty query={query} />}
    </SheetFrame>
  );
}

export function AllowedListEditor(props: FreshProps) {
  const [open, setOpen] = useState(false);
  const allowed = props.accounts.filter(account => !props.excludedIds.has(account.id));
  const unavailable = props.status === "ready" || props.status === "save-error" ? allowed.filter(account => usability(account, props.shortAccountIds)) : [];
  return <section aria-labelledby="cover-f-heading" className="space-y-5"><Intro headingId="cover-f-heading" /><Status props={props} /><div className="glass-card rounded-2xl p-4"><h3 className="text-[16px] font-bold text-slate-950 dark:text-white">Accounts allowed for cover</h3><p className={`mt-1 text-[14px] ${SECONDARY}`}>{allowed.length === 0 ? "No accounts are allowed at the moment." : `${allowed.length} ${allowed.length === 1 ? "account is" : "accounts are"} allowed for cover.`}</p>{unavailable.length > 0 && <p className={`mt-3 border-t border-slate-100 pt-3 text-[13px] ${SECONDARY} dark:border-slate-700/70`}>{unavailable.length} {unavailable.length === 1 ? "allowed account cannot" : "allowed accounts cannot"} spare anything today. Open the account list to review each one.</p>}<button type="button" data-g200-open-editor onClick={() => setOpen(true)} className={`mt-4 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white active:scale-[0.99] ${FOCUS}`}>Edit account permissions</button></div><a href="/upcoming" className={`inline-flex min-h-11 items-center font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300 ${FOCUS}`}>See today&rsquo;s suggestion in Upcoming</a>{open && <PermissionSheet props={props} close={() => setOpen(false)} />}</section>;
}
