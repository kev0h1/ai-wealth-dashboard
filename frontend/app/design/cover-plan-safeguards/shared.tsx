"use client";

// G200 cover plan safeguards round: shared pieces for the three variants.
//
// Every variant takes the SAME props as the production CoverPlanSourcesCard
// (accounts, excludedIds, shortAccountIds, hideAmounts, onToggle), so the
// picked one can be moved into components/ and swapped into SettingsPage with
// no change at the call site. Nothing here fetches anything: the preview is
// fixtures only.
//
// What is a real user choice today: the allow-list (excludedIds). The class
// order (current before savings), the within-class ranking and the 10 pound
// buffer are fixed by the engine, so every variant states them as rules and
// none draws a drag handle or stepper that implies otherwise.

import { useId, useState, type ReactNode } from "react";
import { AlertCircle, ChevronDown, Search, Wallet } from "lucide-react";
import type { Account } from "@/lib/api";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import Toggle from "@/components/Toggle";
import { sourceClass, type SourceClass } from "@/lib/coverPlanSourceClass";

export type CoverSafeguardsProps = {
  accounts: Account[];
  excludedIds: Set<string>;
  shortAccountIds: Set<string>;
  hideAmounts: boolean;
  onToggle: (id: string) => void;
};

export type Usability = "short" | "empty" | null;

// Same two tests the production card applies (skipReason): the engine's own
// short set, plus a pot holding nothing.
export function usability(account: Account, shortIds: Set<string>): Usability {
  if (shortIds.has(account.id)) return "short";
  if (account.balance <= 0) return "empty";
  return null;
}

// Plain words for an account that cannot help today. Neutral, never red: it is
// a live condition of the account, not a risk and not the user's choice.
export function unusableCopy(reason: Exclude<Usability, null>): string {
  return reason === "short" ? "Cannot spare any today." : "Nothing in it today.";
}

const KEEP_UPPER = new Set(["ISA", "LISA", "JISA", "UK", "ATM", "PLC"]);

// Bank feeds often send account names in capitals. Render them as a person
// would write them; names already in mixed case are left exactly as written.
export function displayName(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function money(value: number, hidden: boolean): string {
  if (hidden) return "£••••";
  return `${value < 0 ? "−" : ""}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}

export function classOf(account: Account): SourceClass {
  return sourceClass(account);
}

export function matchesQuery(account: Account, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${displayName(account.name)} ${account.provider} ${account.manual ? "manual" : ""}`
    .toLowerCase()
    .includes(needle);
}

export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800";
export const SECONDARY = "text-slate-600 dark:text-slate-300";
export const LINK = `inline-flex min-h-11 items-center rounded-xl text-[14px] font-semibold text-indigo-600 active:opacity-70 dark:text-indigo-400 ${FOCUS}`;

/** The one derived model every variant reads. */
export function useCoverModel({ accounts, excludedIds, shortAccountIds }: CoverSafeguardsProps) {
  const allowed = accounts.filter((a) => !excludedIds.has(a.id));
  const turnedOff = accounts.filter((a) => excludedIds.has(a.id));
  const allowedUsable = allowed.filter((a) => !usability(a, shortAccountIds));
  const allowedUnusable = allowed.filter((a) => usability(a, shortAccountIds));
  const currentUsable = allowedUsable.filter((a) => classOf(a) === "current");
  const savingsUsable = allowedUsable.filter((a) => classOf(a) === "savings");
  return { allowed, turnedOff, allowedUsable, allowedUnusable, currentUsable, savingsUsable };
}

/** Section frame: orientation on the canvas, the work inside one card. */
export function Frame({
  headingId,
  title,
  intro,
  children,
}: {
  headingId: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId}>
      <header className="px-1 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Cover plan safeguards
        </p>
        <h2 id={headingId} className="mt-1 text-[17px] font-bold text-slate-950 dark:text-white">
          {title}
        </h2>
        <p className={`mt-1 text-[14px] leading-snug ${SECONDARY}`}>{intro}</p>
      </header>
      <div className="glass-card overflow-hidden rounded-2xl px-4">{children}</div>
    </section>
  );
}

export function Disclosure({
  title,
  detail,
  defaultOpen = false,
  children,
}: {
  title: string;
  detail?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="border-t border-slate-100 first:border-t-0 dark:border-slate-700/70">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-xl py-3 text-left active:opacity-70 ${FOCUS}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          {detail && <span className={`block text-[12px] ${SECONDARY}`}>{detail}</span>}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-slate-500 transition-transform duration-200 motion-reduce:transition-none dark:text-slate-400 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={panelId}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

/** The fixed rules, in plain words. States what is NOT editable. */
export function Rules() {
  return (
    <div className={`space-y-2 pb-4 text-[13px] leading-relaxed ${SECONDARY}`}>
      <p>You choose which accounts Sorted may suggest. The order below is fixed.</p>
      <p>
        Current accounts come first. Savings are used only if all your allowed current accounts together
        cannot cover the amount.
      </p>
      <p>
        Within each group, the account with the most to spare comes first, and Sorted prefers to use as few
        accounts as it can.
      </p>
      <p>
        Every account keeps <MoneyText text="£10" />, and its own bills and set-asides stay protected.
      </p>
      <p>A manual account follows the same rules in its own group. You would make that transfer yourself.</p>
    </div>
  );
}

export function AccountIcon({ account }: { account: Account }) {
  if (account.manual) {
    return (
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300"
      >
        <Wallet size={17} />
      </span>
    );
  }
  const brand = accountBrand(account);
  return (
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.background} />
  );
}

export function AccountRow({
  account,
  allowed,
  reason,
  showBalance,
  hideAmounts,
  onToggle,
}: {
  account: Account;
  allowed: boolean;
  reason: Usability;
  showBalance: boolean;
  hideAmounts: boolean;
  onToggle: (id: string) => void;
}) {
  const name = displayName(account.name);
  return (
    <li className="flex min-h-[64px] items-center gap-3 py-2">
      <AccountIcon account={account} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[14px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
          {name}
        </span>
        <span className={`block text-[12px] leading-snug ${SECONDARY}`}>
          {account.manual ? "You move this yourself" : account.provider}
          {!allowed ? " · Turned off by you" : ""}
        </span>
        {reason && <span className={`block text-[12px] leading-snug ${SECONDARY}`}>{unusableCopy(reason)}</span>}
      </span>
      {showBalance && (
        <span className="w-[68px] shrink-0 text-right text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <MoneyText text={money(account.balance, hideAmounts)} />
        </span>
      )}
      <Toggle
        checked={allowed}
        onChange={() => onToggle(account.id)}
        label={`${allowed ? "Turn off" : "Allow"} ${name} as a cover source`}
      />
    </li>
  );
}

export function AccountRows({
  accounts,
  props,
  showBalance,
}: {
  accounts: Account[];
  props: CoverSafeguardsProps;
  showBalance: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
      {accounts.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          allowed={!props.excludedIds.has(account.id)}
          reason={usability(account, props.shortAccountIds)}
          showBalance={showBalance}
          hideAmounts={props.hideAmounts}
          onToggle={props.onToggle}
        />
      ))}
    </ul>
  );
}

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="py-3">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-slate-900 dark:text-slate-100">
        Find an account
      </label>
      <div className="relative">
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400"
        />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Name or provider"
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[14px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
        />
      </div>
    </div>
  );
}

export function UpcomingLink() {
  return (
    <div className="border-t border-slate-100 py-1 dark:border-slate-700/70">
      <a href="/upcoming" className={LINK}>
        See today&rsquo;s suggestion on Upcoming
      </a>
    </div>
  );
}

/**
 * Top-of-card notices. Red appears once: no account is allowed at all, so a
 * future gap would genuinely go uncovered (The Red Is Risk Rule). Everything
 * else is neutral ink. Returns null when there is nothing to say.
 */
export function StateNotice({
  total,
  model,
}: {
  total: number;
  model: ReturnType<typeof useCoverModel>;
}) {
  if (total === 0) {
    return (
      <div className="py-4">
        <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Add an account to set up cover.</p>
        <p className={`mt-1 text-[13px] ${SECONDARY}`}>Then choose which accounts Sorted may use.</p>
        <a href="/accounts" className={LINK}>
          Add an account
        </a>
      </div>
    );
  }
  if (model.allowed.length === 0) {
    return (
      <div role="status" className="flex items-start gap-2 pt-4">
        <AlertCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-red-500 dark:text-red-400" />
        <p className="text-[14px] leading-snug text-slate-900 dark:text-slate-100">
          No account is allowed, so a future gap would have nothing to cover it. Allow at least one account below.
        </p>
      </div>
    );
  }
  if (model.allowedUsable.length === 0) {
    return (
      <p role="status" className={`pt-4 text-[13px] leading-snug ${SECONDARY}`}>
        Your choices are saved. None of your allowed accounts can spare anything today, and that can change as
        balances update.
      </p>
    );
  }
  return null;
}
