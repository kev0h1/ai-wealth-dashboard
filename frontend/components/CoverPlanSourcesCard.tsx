"use client";

import type { LucideIcon } from "lucide-react";
import { Landmark, ShieldCheck, Wallet } from "lucide-react";
import type { Account } from "@/lib/api";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import Toggle from "@/components/Toggle";

type SourceClass = "current" | "savings";

type SourceGroup = {
  kind: SourceClass;
  number: string;
  title: string;
  short: string;
  rule: string;
  icon: LucideIcon;
};

const SOURCE_GROUPS: SourceGroup[] = [
  {
    kind: "current",
    number: "1",
    title: "Current accounts",
    short: "Connected used first",
    rule: "Within this connected step, Sorted uses the fewest accounts it can, choosing the highest live headroom first. Accounts that are short are skipped.",
    icon: Wallet,
  },
  {
    kind: "savings",
    number: "2",
    title: "Savings",
    short: "Connected used second",
    rule: "Connected savings follows only when every allowed connected current account combined cannot cover the amount. Manual transfers are checked after connected accounts.",
    icon: Landmark,
  },
];

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

function SourceAccountRow({
  account,
  excluded,
  short,
  onToggle,
}: {
  account: Account;
  excluded: boolean;
  short: boolean;
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
          short || excluded ? "text-slate-600 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"
        }`}>
          <span className={short || excluded ? "min-w-0" : "truncate"}>
            {short ? (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
                Skipped while this account is short
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
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              Manual transfer
            </span>
          )}
        </span>
      </span>
      {short ? (
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
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          Choose the accounts Sorted may suggest. Your own bills, set-asides and a <span className="money">£10</span> buffer stay protected in every account.
        </p>
      </header>

      <div className="px-4 pb-4">
        {liveRoute ? (
          <CoverRouteSummary route={liveRoute} accounts={accounts} hideAmounts={hideAmounts} />
        ) : (
          <CoverOutcome accounts={accounts} excludedIds={excludedIds} />
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700/70">
        {SOURCE_GROUPS.map((group, groupPosition) => {
          const Icon = group.icon;
          const groupAccounts = accounts.filter((account) => sourceClass(account) === group.kind);
          return (
            <section
              key={group.kind}
              aria-labelledby={`cover-${group.kind}-heading`}
              className={groupPosition > 0 ? "border-t border-slate-100 dark:border-slate-700/70" : ""}
            >
              <div className="flex items-start gap-3 px-4 pb-2 pt-4">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-indigo-200 bg-white text-[12px] font-bold text-indigo-700 dark:border-indigo-400/25 dark:bg-slate-800 dark:text-indigo-300">
                  {group.number}
                  {groupPosition < SOURCE_GROUPS.length - 1 && (
                    <span aria-hidden="true" className="absolute left-1/2 top-full h-5 w-px -translate-x-1/2 bg-indigo-200 dark:bg-indigo-400/20" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <h3 id={`cover-${group.kind}-heading`} className="text-[14px] font-bold text-slate-900 dark:text-slate-100">
                      {group.title}
                    </h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      {group.short}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{group.rule}</p>
                </div>
                <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
              </div>
              {groupAccounts.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {groupAccounts.map((account) => (
                    <SourceAccountRow
                      key={account.id}
                      account={account}
                      excluded={excludedIds.has(account.id)}
                      short={shortAccountIds.has(account.id)}
                      onToggle={onToggle}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-4 pb-4 pl-16 text-[12px] text-slate-500 dark:text-slate-400">
                  No {group.kind} accounts connected.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
