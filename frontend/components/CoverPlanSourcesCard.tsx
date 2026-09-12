"use client";

import { Fragment, useState } from "react";
import { ArrowRight, ChevronDown, Search, ShieldCheck } from "lucide-react";
import type { Account } from "@/lib/api";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import Toggle from "@/components/Toggle";

type SourceClass = "current" | "savings";

type SourceGroup = {
  kind: SourceClass;
  number: string;
  title: string;
  rule: string;
};

// G51 (Kevin, 2026-09-12, search-first exceptions manager, variant B of the
// cover-plan-sources-scale round): the safeguard text these groups carry
// used to sit as a paragraph above every account in the class; it now lives
// behind the "How this works" disclosure in the header, and the class
// itself only ever shows as the two-step ranking strip plus its allowed
// count. Every safeguard statement stays true here: current before savings,
// a class reached only once every earlier class combined cannot cover the
// amount, highest headroom first and fewest legs preferred within a class,
// each source keeping a £10 buffer, and an account that is itself short
// skipped outright.
const SOURCE_GROUPS: SourceGroup[] = [
  {
    kind: "current",
    number: "1",
    title: "Current accounts",
    rule: "Within this step, Sorted uses the fewest accounts it can, choosing the highest live headroom first. An account that is short itself is skipped.",
  },
  {
    kind: "savings",
    number: "2",
    title: "Savings",
    rule: "Savings is reached only when every allowed current account combined cannot cover the amount. A manual-transfer account is checked last, after every connected account in both classes, because moving it needs you to act.",
  },
];

// Past this many turned-off exceptions, collapse the list behind a closed
// disclosure rather than render every row flat. Variant B measured 1248px
// at 390 wide with every account excluded before this cap (Kevin,
// 2026-09-12, cover-plan-sources-scale round); the cap keeps the
// closed-by-default height bounded while an explicit tap still reaches the
// full list.
const EXCEPTION_CAP = 5;

export type LiveCoverRoute = {
  headline: string;
  detail: string;
  legs: Array<{
    accountId: string;
    name: string;
    provider: string;
    amount: number;
  }>;
  risk: boolean;
};

const NO_SHORT_ACCOUNTS = new Set<string>();

function maskMoney(text: string, hidden: boolean): string {
  return hidden ? text.replace(/[~−+-]?£[\d,]+(?:\.\d+)?/gi, "£••••") : text;
}

function sourceClass(account: Account): SourceClass {
  const type = (account.type ?? "").toLowerCase();
  const subtype = (account.subtype ?? "").toLowerCase();
  return type.includes("saving") || subtype.includes("saving") || subtype.includes("isa")
    ? "savings"
    : "current";
}

// The engine's own eligibility, not whichever move card happens to be live
// (G50): `shortAccountIds` must be the set of accounts the source finder
// itself currently treats as too short to use. A zero-balance pot is a
// separate, purely presentational fold — it holds nothing to move
// regardless of engine state, so it never needs a live simulation to flag.
function skipReason(account: Account, shortAccountIds: Set<string>): "short" | "empty" | null {
  if (shortAccountIds.has(account.id)) return "short";
  if (account.balance <= 0) return "empty";
  return null;
}

function matchesQuery(account: Account, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    account.name.toLowerCase().includes(needle) || account.provider.toLowerCase().includes(needle)
  );
}

function CoverOutcome({ accounts, excludedIds }: { accounts: Account[]; excludedIds: Set<string> }) {
  const allowed = accounts.filter((account) => !excludedIds.has(account.id));
  const connectedCurrent = allowed.filter((account) => !account.manual && sourceClass(account) === "current");
  const connectedSavings = allowed.filter((account) => !account.manual && sourceClass(account) === "savings");
  const manual = allowed.filter((account) => account.manual);

  let risk = false;
  let heading = "Connected current accounts stay first";
  let detail = "Connected savings follows only if all allowed connected current accounts combined cannot cover a gap.";

  if (allowed.length === 0) {
    risk = true;
    heading = "A future gap would be uncovered";
    detail = "No account is allowed as a cover source. Turn at least one account on for Sorted to suggest a transfer.";
  } else if (connectedCurrent.length > 0) {
    if (connectedSavings.length > 0 && manual.length > 0) {
      detail = "Connected savings follows only if current accounts cannot cover a gap. Any manual transfer is checked after connected accounts.";
    } else if (connectedSavings.length === 0 && manual.length > 0) {
      detail = "If connected current accounts cannot cover a gap, a manually managed account is checked next and you would make the transfer.";
    } else if (connectedSavings.length === 0) {
      heading = "Connected current accounts are the only source";
      detail = "Any amount these accounts cannot cover would be left uncovered.";
    }
  } else if (connectedSavings.length > 0) {
    heading = "Connected savings would be checked first";
    detail = manual.length > 0
      ? "No connected current account is allowed. A manual transfer is checked only if connected savings cannot cover the gap."
      : "No connected current account is allowed, so the next cover suggestion would start with connected savings.";
  } else {
    heading = "A manual transfer may be needed";
    detail = "Only manually managed accounts are allowed, so you would need to make any suggested transfer yourself.";
  }

  return (
    <section
      aria-live="polite"
      className={`rounded-2xl border p-4 ${
        risk
          ? "border-red-200 bg-red-50/70 dark:border-red-400/20 dark:bg-red-400/[0.06]"
          : "border-indigo-100 bg-indigo-50/60 dark:border-indigo-400/15 dark:bg-indigo-400/[0.06]"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        With these safeguards
      </p>
      <p className="mt-1.5 flex items-center gap-2 text-[15px] font-bold text-slate-950 dark:text-white">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${risk ? "bg-red-500 dark:bg-red-400" : "bg-indigo-500 dark:bg-indigo-400"}`}
        />
        {heading}
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{detail}</p>
    </section>
  );
}

function CoverRouteSummary({
  route,
  accounts,
  hideAmounts,
}: {
  route: LiveCoverRoute;
  accounts: Account[];
  hideAmounts: boolean;
}) {
  return (
    <section
      aria-live="polite"
      className={`rounded-2xl border p-4 ${
        route.risk
          ? "border-red-200 bg-red-50/70 dark:border-red-400/20 dark:bg-red-400/[0.06]"
          : "border-indigo-100 bg-indigo-50/60 dark:border-indigo-400/15 dark:bg-indigo-400/[0.06]"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Cover plan right now
      </p>
      <p className="mt-1.5 flex items-start gap-2 text-[15px] font-bold text-slate-950 dark:text-white">
        <span
          aria-hidden="true"
          className={`mt-1.5 size-2 shrink-0 rounded-full ${route.risk ? "bg-red-500 dark:bg-red-400" : "bg-indigo-500 dark:bg-indigo-400"}`}
        />
        <MoneyText text={maskMoney(route.headline, hideAmounts)} />
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
        <MoneyText text={maskMoney(route.detail, hideAmounts)} />
      </p>

      {route.legs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {route.legs.map((leg) => {
            const account = accounts.find((candidate) => candidate.id === leg.accountId) ?? {
              id: leg.accountId,
              name: leg.name,
              provider: leg.provider,
              type: "bank",
              balance: 0,
              currency: "GBP",
              status: "connected",
            };
            const brand = accountBrand(account);
            return (
              <div
                key={leg.accountId}
                className="inline-flex min-h-8 max-w-full min-w-0 items-center gap-2 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200 dark:shadow-none"
              >
                <BankBadge
                  logoSrc={brand.logoSrc}
                  initials={brand.initials}
                  altText={brand.label}
                  brandBg={brand.background}
                  size={20}
                />
                <span className="min-w-0 max-w-36 truncate">{leg.name}</span>
                <span className="money shrink-0 font-bold text-slate-950 dark:text-white">
                  {hideAmounts ? "£••••" : `£${Math.round(leg.amount).toLocaleString("en-GB")}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Disclosure({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
    </div>
  );
}

function HowThisWorks({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
      Current accounts go first, then savings, and every source keeps a <span className="money">£10</span> buffer.{" "}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-my-[12px] inline-flex min-h-[44px] items-center font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
      >
        {open ? "Hide how this works" : "How this works"}
      </button>
    </p>
  );
}

function HowThisWorksPanel() {
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
      <p>
        Choose the accounts Sorted may suggest. Your own bills, set-asides and a <span className="money">£10</span> buffer stay protected in every account.
      </p>
      {SOURCE_GROUPS.map((group) => (
        <p key={group.kind}>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{group.number}. {group.title}.</span> {group.rule}
        </p>
      ))}
    </div>
  );
}

function RankingStrip({
  accounts,
  excludedIds,
  shortAccountIds,
}: {
  accounts: Account[];
  excludedIds: Set<string>;
  shortAccountIds: Set<string>;
}) {
  const counts = SOURCE_GROUPS.map((group) => {
    const classAccounts = accounts.filter((account) => sourceClass(account) === group.kind);
    const eligible = classAccounts.filter((account) => !skipReason(account, shortAccountIds));
    const allowed = eligible.filter((account) => !excludedIds.has(account.id));
    return { group, eligibleCount: eligible.length, allowedCount: allowed.length };
  });

  const summary = counts.map(({ group, eligibleCount, allowedCount }) => `${group.title} ${allowedCount} of ${eligibleCount} allowed`).join(", ");

  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-700/70 dark:bg-white/[0.03]">
      {/* The visible strip is presentational; a screen reader gets only the
          short summary below, so toggling one account announces "3 of 3
          allowed" rather than re-reading every badge and label. */}
      <p aria-live="polite" className="sr-only">{summary}</p>
      {counts.map(({ group, eligibleCount, allowedCount }, index) => (
        <Fragment key={group.kind}>
          {index > 0 && <ArrowRight size={12} aria-hidden="true" className="text-slate-300 dark:text-slate-600" />}
          <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
            {group.number}
          </span>
          <span aria-hidden="true" className="text-[12px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {group.title}, {allowedCount}/{eligibleCount}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function SourceAccountRow({
  account,
  excluded,
  reason,
  onToggle,
}: {
  account: Account;
  excluded: boolean;
  reason: "short" | "empty" | null;
  onToggle: (id: string) => void;
}) {
  const brand = accountBrand(account);
  const accountClass = sourceClass(account);
  const classLabel = accountClass === "savings" ? "Savings" : "Current account";

  return (
    <div className="flex min-h-[68px] items-center gap-3 px-4 py-2.5">
      <BankBadge
        logoSrc={brand.logoSrc}
        initials={brand.initials}
        altText={brand.label}
        brandBg={brand.background}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">
          {account.name}
        </span>
        <span className={`mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-snug ${
          reason || excluded ? "text-slate-600 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"
        }`}>
          <span className={reason || excluded ? "min-w-0" : "truncate"}>
            {reason === "short" ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
                Skipped while this account is short
              </span>
            ) : reason === "empty" ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
                Skipped, this pot is empty
              </span>
            ) : excluded ? (
              "Excluded from every cover suggestion"
            ) : account.manual ? (
              `${classLabel}, checked after connected accounts`
            ) : (
              account.provider
            )}
          </span>
          {account.manual && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              Manual transfer
            </span>
          )}
        </span>
      </span>
      {reason ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          Skipped
        </span>
      ) : (
        <Toggle
          checked={!excluded}
          onChange={() => onToggle(account.id)}
          label={`${excluded ? "Allow" : "Exclude"} ${account.name} as a cover source`}
        />
      )}
    </div>
  );
}

// The search-first exceptions manager (G51, variant B): the account list
// itself starts almost empty, showing only accounts the user has turned off
// (capped past EXCEPTION_CAP) plus a folded skipped count, with search as
// the door into the full estate and a browse-all affordance for someone
// with no name in mind.
function ExceptionsManager({
  accounts,
  excludedIds,
  shortAccountIds,
  onToggle,
}: {
  accounts: Account[];
  excludedIds: Set<string>;
  shortAccountIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [browseAll, setBrowseAll] = useState(false);
  const [turnedOffOpen, setTurnedOffOpen] = useState(false);
  const [skippedOpen, setSkippedOpen] = useState(false);

  const reasonFor = (account: Account) => skipReason(account, shortAccountIds);
  const eligible = accounts.filter((account) => !reasonFor(account));
  const skipped = accounts.filter((account) => reasonFor(account));
  const excludedAccounts = eligible.filter((account) => excludedIds.has(account.id));
  const shortCount = skipped.filter((account) => reasonFor(account) === "short").length;
  const emptyCount = skipped.length - shortCount;
  const capped = excludedAccounts.length > EXCEPTION_CAP;

  const showList = query.length > 0 || browseAll;
  const matches = showList ? accounts.filter((account) => matchesQuery(account, query)) : [];

  // Short, count-only summaries for the sr-only live regions below — a
  // screen reader hears "3 accounts found" or "2 accounts turned off" when
  // the count changes, not every row in the list that just re-rendered.
  const searchSummary = matches.length === 0
    ? `No accounts match ${query}.`
    : `${matches.length} account${matches.length === 1 ? "" : "s"} found.`;
  const defaultSummary = (excludedAccounts.length === 0
    ? `All ${eligible.length} eligible accounts allowed.`
    : `${excludedAccounts.length} account${excludedAccounts.length === 1 ? "" : "s"} turned off.`
  ) + (skipped.length > 0 ? ` ${skipped.length} skipped.` : "");

  return (
    <>
      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/70">
        <SearchField value={query} onChange={setQuery} placeholder={`Search your ${accounts.length} accounts`} />
        {!browseAll && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setBrowseAll(true)}
              className="-my-[12px] inline-flex min-h-[44px] items-center text-[12px] font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
            >
              Browse all {accounts.length} accounts
            </button>
          </div>
        )}
      </div>

      {showList ? (
        <div className="border-t border-slate-100 dark:border-slate-700/70">
          <p aria-live="polite" className="sr-only">{searchSummary}</p>
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No accounts match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {matches.map((account) => (
                <SourceAccountRow
                  key={account.id}
                  account={account}
                  excluded={excludedIds.has(account.id)}
                  reason={reasonFor(account)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-slate-100 dark:border-slate-700/70">
          <p aria-live="polite" className="sr-only">{defaultSummary}</p>
          {excludedAccounts.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-slate-500 dark:text-slate-400">
              All {eligible.length} eligible accounts are allowed. Search to turn one off.
            </p>
          ) : capped ? (
            <div>
              <button
                type="button"
                onClick={() => setTurnedOffOpen((value) => !value)}
                aria-expanded={turnedOffOpen}
                className="flex min-h-11 w-full items-center gap-2 px-4 text-[12px] font-semibold text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${turnedOffOpen ? "rotate-180" : ""}`}
                />
                {excludedAccounts.length} accounts turned off
              </button>
              <Disclosure open={turnedOffOpen}>
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700/60 dark:border-slate-700/70">
                  {excludedAccounts.map((account) => (
                    <SourceAccountRow key={account.id} account={account} excluded reason={null} onToggle={onToggle} />
                  ))}
                </div>
              </Disclosure>
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Turned off ({excludedAccounts.length})
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {excludedAccounts.map((account) => (
                  <SourceAccountRow key={account.id} account={account} excluded reason={null} onToggle={onToggle} />
                ))}
              </div>
            </>
          )}

          {skipped.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-700/70">
              <button
                type="button"
                onClick={() => setSkippedOpen((value) => !value)}
                aria-expanded={skippedOpen}
                className="flex min-h-11 w-full items-center gap-2 px-4 text-[12px] font-semibold text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
              >
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${skippedOpen ? "rotate-180" : ""}`}
                />
                {skipped.length} skipped ({shortCount} short, {emptyCount} empty)
              </button>
              <Disclosure open={skippedOpen}>
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700/60 dark:border-slate-700/70">
                  {skipped.map((account) => (
                    <SourceAccountRow
                      key={account.id}
                      account={account}
                      excluded={excludedIds.has(account.id)}
                      reason={reasonFor(account)}
                      onToggle={onToggle}
                    />
                  ))}
                </div>
              </Disclosure>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function CoverPlanSourcesCard({
  accounts,
  excludedIds,
  liveRoute = null,
  shortAccountIds = NO_SHORT_ACCOUNTS,
  hideAmounts = false,
  onToggle,
}: {
  accounts: Account[];
  excludedIds: Set<string>;
  liveRoute?: LiveCoverRoute | null;
  shortAccountIds?: Set<string>;
  hideAmounts?: boolean;
  onToggle: (id: string) => void;
}) {
  const [howOpen, setHowOpen] = useState(false);

  return (
    <section aria-labelledby="cover-sources-heading" className="glass-card overflow-hidden rounded-2xl">
      <header className="px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Cover plan safeguards
          </p>
        </div>
        <h2 id="cover-sources-heading" className="mt-2 text-[17px] font-bold text-slate-950 dark:text-white">
          Where cover money can come from
        </h2>
        <HowThisWorks open={howOpen} onToggle={() => setHowOpen((value) => !value)} />
        <Disclosure open={howOpen}>
          <HowThisWorksPanel />
        </Disclosure>
      </header>

      <div className="px-4 pb-4">
        {liveRoute ? (
          <CoverRouteSummary route={liveRoute} accounts={accounts} hideAmounts={hideAmounts} />
        ) : (
          <CoverOutcome accounts={accounts} excludedIds={excludedIds} />
        )}
      </div>

      <RankingStrip accounts={accounts} excludedIds={excludedIds} shortAccountIds={shortAccountIds} />

      <ExceptionsManager
        accounts={accounts}
        excludedIds={excludedIds}
        shortAccountIds={shortAccountIds}
        onToggle={onToggle}
      />
    </section>
  );
}
