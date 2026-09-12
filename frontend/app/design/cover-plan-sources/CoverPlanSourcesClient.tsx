"use client";

// TEMPORARY PREVIEW — G46, cover-plan source settings design round.
// Static fixtures only. No API requests and no production settings changes.
// /design/cover-plan-sources?variant=a|b|c&state=all|savings|short&mode=light|dark

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowRight,
  ChevronLeft,
  CircleAlert,
  Landmark,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import Toggle from "@/components/Toggle";

type Variant = "a" | "b" | "c";
type PreviewState = "all" | "savings" | "short";
type Mode = "light" | "dark";
type SourceKind = "current" | "savings" | "offline";

type SourceAccount = {
  id: string;
  name: string;
  provider: string;
  mark: string;
  markClass: string;
  kind: SourceKind;
  headroom: number;
  selfShort?: number;
};

type Leg = {
  account: SourceAccount;
  amount: number;
};

type CoverResult = {
  legs: Leg[];
  uncovered: number;
};

const GAP = 760;

const ACCOUNTS: SourceAccount[] = [
  {
    id: "barclays-current",
    name: "Everyday current",
    provider: "Barclays",
    mark: "B",
    markClass: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
    kind: "current",
    headroom: 610,
  },
  {
    id: "monzo-current",
    name: "Monzo current",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "current",
    headroom: 260,
  },
  {
    id: "starling-bills",
    name: "Bills account",
    provider: "Starling",
    mark: "S",
    markClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    kind: "current",
    headroom: 0,
    selfShort: 35,
  },
  {
    id: "rainy-day",
    name: "Rainy day",
    provider: "NatWest",
    mark: "N",
    markClass: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    kind: "savings",
    headroom: 2390,
  },
  {
    id: "holiday-pot",
    name: "Holiday pot",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 470,
  },
  {
    id: "cash-reserve",
    name: "Cash reserve",
    provider: "Offline account",
    mark: "£",
    markClass: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    kind: "offline",
    headroom: 790,
  },
];

const GROUPS: Array<{
  kind: SourceKind;
  number: string;
  title: string;
  short: string;
  rule: string;
  icon: typeof Wallet;
}> = [
  {
    kind: "current",
    number: "1",
    title: "Current accounts",
    short: "Used first",
    rule: "Highest headroom first. Accounts that are short themselves are skipped.",
    icon: Wallet,
  },
  {
    kind: "savings",
    number: "2",
    title: "Savings",
    short: "Only if current falls short",
    rule: "Reached only when all allowed current accounts combined cannot cover the gap.",
    icon: Landmark,
  },
  {
    kind: "offline",
    number: "3",
    title: "Offline money",
    short: "Last resort",
    rule: "Used last because moving it needs a manual transfer.",
    icon: LockKeyhole,
  },
];

const PRESET_EXCLUSIONS: Record<PreviewState, string[]> = {
  all: [],
  savings: ["monzo-current"],
  short: ["monzo-current", "rainy-day", "holiday-pot", "cash-reserve"],
};

const NOTES: Record<Variant, { title: string; thesis: string; tradeoff: string }> = {
  a: {
    title: "A · Live source ladder · recommended",
    thesis: "Put the answer first: show the exact route for a real gap, then group every account in the order the engine will consider it.",
    tradeoff: "The live example takes more room than today’s collapsed row, but it makes every switch immediately explain itself.",
  },
  b: {
    title: "B · Ranked register",
    thesis: "Treat source order as one compact register, with each account’s movable headroom and likely role visible on the row.",
    tradeoff: "It is fastest to scan, but showing ranking, headroom and impact together creates the densest option.",
  },
  c: {
    title: "C · Safeguard map",
    thesis: "Lead with the cover consequence and let the user inspect one source class at a time through a three-stage map.",
    tradeoff: "The policy is calm and compact, but comparing accounts across classes takes an extra tap.",
  },
};

function money(value: number): string {
  return `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
}

function findCover(excluded: Set<string>, gap = GAP): CoverResult {
  const legs: Leg[] = [];
  let remaining = gap;

  for (const group of GROUPS) {
    if (remaining <= 0) break;
    const candidates = ACCOUNTS
      .filter((account) => account.kind === group.kind)
      .filter((account) => !excluded.has(account.id) && !account.selfShort && account.headroom >= 5)
      .sort((a, b) => b.headroom - a.headroom || a.id.localeCompare(b.id));

    const classTotal = candidates.reduce((sum, account) => sum + account.headroom, 0);
    if (classTotal < remaining) {
      for (const account of candidates) {
        const amount = Math.min(remaining, account.headroom);
        if (amount >= 5) {
          legs.push({ account, amount });
          remaining -= amount;
        }
      }
      continue;
    }

    let cumulative = 0;
    const chosen: SourceAccount[] = [];
    for (const account of candidates) {
      chosen.push(account);
      cumulative += account.headroom;
      if (cumulative >= remaining) break;
    }
    for (const account of chosen) {
      const amount = Math.min(remaining, account.headroom);
      if (amount >= 5) {
        legs.push({ account, amount });
        remaining -= amount;
      }
    }
    break;
  }

  return { legs, uncovered: Math.max(0, remaining) };
}

function groupIndex(kind: SourceKind): number {
  return GROUPS.findIndex((group) => group.kind === kind);
}

function BankMark({ account }: { account: SourceAccount }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-9 shrink-0 place-items-center rounded-xl text-[12px] font-bold ${account.markClass}`}
    >
      {account.mark}
    </span>
  );
}

function StatusDot({ tone }: { tone: "neutral" | "watch" | "risk" }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${
        tone === "risk"
          ? "bg-red-500 dark:bg-red-400"
          : tone === "watch"
            ? "bg-amber-500 dark:bg-amber-400"
            : "bg-indigo-500 dark:bg-indigo-400"
      }`}
    />
  );
}

function outcome(result: CoverResult) {
  const lastKind = result.legs.at(-1)?.account.kind ?? "current";
  const laterAmount = result.legs
    .filter((leg) => leg.account.kind !== "current")
    .reduce((sum, leg) => sum + leg.amount, 0);

  if (result.uncovered > 0) {
    return {
      tone: "risk" as const,
      label: <><span className="money">{money(result.uncovered)}</span> still uncovered</>,
      detail: <>Allowed accounts can provide <span className="money">{money(GAP - result.uncovered)}</span> of this <span className="money">{money(GAP)}</span> gap.</>,
    };
  }
  if (lastKind === "offline") {
    return {
      tone: "watch" as const,
      label: "Offline money enters the plan",
      detail: <><span className="money">{money(laterAmount)}</span> would need a manual transfer because allowed current accounts and savings cannot cover the gap.</>,
    };
  }
  if (lastKind === "savings") {
    return {
      tone: "watch" as const,
      label: "Savings enters the plan",
      detail: <><span className="money">{money(laterAmount)}</span> would come from savings because allowed current accounts cannot cover the gap.</>,
    };
  }
  return {
    tone: "neutral" as const,
    label: "Covered from current accounts",
    detail: `${result.legs.length} ${result.legs.length === 1 ? "transfer" : "transfers"}; savings and offline money stay untouched.`,
  };
}

function AccountToggle({
  account,
  excluded,
  onToggle,
  compact = false,
  secondary,
}: {
  account: SourceAccount;
  excluded: Set<string>;
  onToggle: (id: string) => void;
  compact?: boolean;
  secondary?: ReactNode;
}) {
  const allowed = !excluded.has(account.id);
  const skipped = Boolean(account.selfShort);
  return (
    <div className={`flex min-h-[68px] items-center gap-3 ${compact ? "px-3 py-2" : "px-4 py-2.5"}`}>
      <BankMark account={account} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">
          {account.name}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          {skipped ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-red-500 dark:bg-red-400" />
              Skipped; this account is <span className="money">{money(account.selfShort ?? 0)}</span> short
            </span>
          ) : secondary ?? (
            <><span className="money">{money(account.headroom)}</span> can move after bills and the <span className="money">£10</span> buffer</>
          )}
        </span>
      </span>
      {skipped ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-400">
          Skipped
        </span>
      ) : (
        <Toggle
          checked={allowed}
          onChange={() => onToggle(account.id)}
          label={`${allowed ? "Exclude" : "Allow"} ${account.name} as a cover source`}
        />
      )}
    </div>
  );
}

function RouteSummary({ result, expanded = false }: { result: CoverResult; expanded?: boolean }) {
  const summary = outcome(result);
  return (
    <section
      aria-live="polite"
      className={`rounded-2xl border p-4 ${
        summary.tone === "risk"
          ? "border-red-200 bg-red-50/70 dark:border-red-400/20 dark:bg-red-400/[0.06]"
          : "border-indigo-100 bg-indigo-50/60 dark:border-indigo-400/15 dark:bg-indigo-400/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            If an account needs <span className="money">{money(GAP)}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-[15px] font-bold text-slate-950 dark:text-white">
            <StatusDot tone={summary.tone} />
            {summary.label}
          </p>
        </div>
        <span className="money shrink-0 text-[22px] font-bold text-slate-950 dark:text-white">{money(GAP)}</span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{summary.detail}</p>

      <div className={`mt-3 ${expanded ? "space-y-2" : "flex flex-wrap items-center gap-2"}`}>
        {result.legs.map((leg, index) => (
          <div
            key={leg.account.id}
            className={expanded
              ? "flex min-h-11 items-center gap-2.5 rounded-xl bg-white/80 px-3 dark:bg-white/[0.05]"
              : "inline-flex min-h-8 items-center gap-2 rounded-full bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200 dark:shadow-none"}
          >
            <span className={`grid size-5 shrink-0 place-items-center rounded-md text-[9px] font-bold ${leg.account.markClass}`}>{leg.account.mark}</span>
            <span className={expanded ? "min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700 dark:text-slate-200" : ""}>
              {leg.account.name}
            </span>
            <span className="money shrink-0 font-bold text-slate-950 dark:text-white">{money(leg.amount)}</span>
            {expanded && index < result.legs.length - 1 && <ArrowDown size={13} aria-hidden="true" className="text-slate-400" />}
          </div>
        ))}
        {result.uncovered > 0 && (
          <div className={expanded
            ? "flex min-h-11 items-center justify-between rounded-xl bg-white/80 px-3 dark:bg-white/[0.05]"
            : "inline-flex min-h-8 items-center gap-2 rounded-full bg-white px-2.5 text-[11px] font-semibold shadow-sm dark:bg-slate-800 dark:shadow-none"}
          >
            <span className="text-slate-600 dark:text-slate-300">Uncovered</span>
            <span className="money ml-2 font-bold text-red-600 dark:text-red-400">{money(result.uncovered)}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function VariantA({ excluded, result, onToggle }: VariantProps) {
  return (
    <section aria-labelledby="cover-sources-heading-a" className="glass-card overflow-hidden rounded-3xl">
      <header className="px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Cover plan safeguards</p>
            <h2 id="cover-sources-heading-a" className="mt-0.5 text-[17px] font-bold text-slate-950 dark:text-white">Where cover money can come from</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
              Choose the accounts Sorted may suggest. Your own bills and a <span className="money">£10</span> buffer stay protected in every account.
            </p>
          </div>
        </div>
      </header>

      <div className="px-4 pb-4">
        <RouteSummary result={result} />
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700/70">
        {GROUPS.map((group, groupPosition) => {
          const Icon = group.icon;
          const groupAccounts = ACCOUNTS.filter((account) => account.kind === group.kind);
          return (
            <section key={group.kind} aria-labelledby={`a-${group.kind}-heading`} className={groupPosition > 0 ? "border-t border-slate-100 dark:border-slate-700/70" : ""}>
              <div className="flex items-start gap-3 px-4 pb-2 pt-4">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-indigo-200 bg-white text-[12px] font-bold text-indigo-700 dark:border-indigo-400/25 dark:bg-slate-800 dark:text-indigo-300">
                  {group.number}
                  {groupPosition < GROUPS.length - 1 && <span aria-hidden="true" className="absolute left-1/2 top-full h-5 w-px -translate-x-1/2 bg-indigo-200 dark:bg-indigo-400/20" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <h3 id={`a-${group.kind}-heading`} className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{group.title}</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{group.short}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{group.rule}</p>
                </div>
                <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {groupAccounts.map((account) => (
                  <AccountToggle key={account.id} account={account} excluded={excluded} onToggle={onToggle} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

type VariantProps = {
  excluded: Set<string>;
  result: CoverResult;
  onToggle: (id: string) => void;
};

function impactWithout(account: SourceAccount, excluded: Set<string>, current: CoverResult): ReactNode {
  if (account.selfShort) return "Always skipped while this account is short.";
  if (excluded.has(account.id)) return "Excluded from every cover suggestion.";
  const nextExcluded = new Set(excluded);
  nextExcluded.add(account.id);
  const next = findCover(nextExcluded);
  const currentLast = current.legs.at(-1)?.account.kind;
  const nextLast = next.legs.at(-1)?.account.kind;
  if (next.uncovered > 0) return <>Off leaves <span className="money">{money(next.uncovered)}</span> uncovered.</>;
  if (nextLast !== currentLast && nextLast === "savings") return "Off brings savings into the plan.";
  if (nextLast !== currentLast && nextLast === "offline") return "Off brings offline money into the plan.";
  const isUsed = current.legs.some((leg) => leg.account.id === account.id);
  if (isUsed) return <>Used for <span className="money">{money(current.legs.find((leg) => leg.account.id === account.id)?.amount ?? 0)}</span> in this example.</>;
  return "Not needed for this example gap.";
}

function VariantB({ excluded, result, onToggle }: VariantProps) {
  let rank = 0;
  return (
    <section aria-labelledby="cover-sources-heading-b" className="glass-card overflow-hidden rounded-3xl">
      <header className="px-4 pb-4 pt-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Source order</p>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="cover-sources-heading-b" className="text-[17px] font-bold text-slate-950 dark:text-white">Accounts Sorted may use</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">Ranked exactly as the cover engine checks them.</p>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">
            <span className="money">£10</span> kept back
          </span>
        </div>
      </header>

      <div className="border-y border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-700/70 dark:bg-white/[0.025]">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          <StatusDot tone={outcome(result).tone} />
          <span className="flex-1">{outcome(result).label}</span>
          <span className="money text-slate-950 dark:text-white">{money(GAP)} gap</span>
        </div>
      </div>

      <div>
        {GROUPS.map((group) => {
          const accounts = ACCOUNTS.filter((account) => account.kind === group.kind);
          return (
            <section key={group.kind} aria-labelledby={`b-${group.kind}-heading`} className="border-b border-slate-100 last:border-b-0 dark:border-slate-700/70">
              <div className="flex min-h-10 items-center gap-2 bg-slate-50/60 px-4 dark:bg-white/[0.025]">
                <span className="grid size-5 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">{group.number}</span>
                <h3 id={`b-${group.kind}-heading`} className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{group.title}</h3>
                <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">{group.short}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {accounts.map((account) => {
                  const excludedAccount = excluded.has(account.id);
                  const skipped = Boolean(account.selfShort);
                  if (!excludedAccount && !skipped) rank += 1;
                  const usedLeg = result.legs.find((leg) => leg.account.id === account.id);
                  return (
                    <div key={account.id} className={`grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-2 px-4 py-3 ${excludedAccount ? "opacity-60" : ""}`}>
                      <span className={`money grid size-7 place-items-center rounded-lg text-[11px] font-bold ${skipped || excludedAccount ? "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500" : usedLeg ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"}`}>
                        {skipped ? "–" : excludedAccount ? "Off" : rank}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{account.name}</span>
                          {usedLeg && <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">In plan</span>}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                          {skipped ? (
                            <>Account is <span className="money">{money(account.selfShort ?? 0)}</span> short itself · skipped until it recovers.</>
                          ) : (
                            <><span className="money">{money(account.headroom)}</span> movable · {impactWithout(account, excluded, result)}</>
                          )}
                        </span>
                      </span>
                      {skipped ? (
                        <span className="text-right text-[10px] font-semibold text-slate-400">Short</span>
                      ) : (
                        <Toggle checked={!excludedAccount} onChange={() => onToggle(account.id)} label={`${excludedAccount ? "Allow" : "Exclude"} ${account.name} as a cover source`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/70">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-500" />
          Headroom already protects each account’s own bills, set-asides and <span className="money">£10</span> buffer. Highest headroom wins ties; fewer transfers win within a source class.
        </p>
      </footer>
    </section>
  );
}

function VariantC({ excluded, result, onToggle }: VariantProps) {
  const usedKinds = new Set(result.legs.map((leg) => leg.account.kind));
  const firstUsed = result.legs[0]?.account.kind ?? "current";
  const [activeKind, setActiveKind] = useState<SourceKind>(firstUsed);
  const group = GROUPS.find((candidate) => candidate.kind === activeKind) ?? GROUPS[0];
  const accounts = ACCOUNTS.filter((account) => account.kind === activeKind);

  return (
    <section aria-labelledby="cover-sources-heading-c" className="glass-card overflow-hidden rounded-3xl">
      <header className="px-4 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <SlidersHorizontal size={17} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Cover plan safeguards</p>
            <h2 id="cover-sources-heading-c" className="mt-0.5 text-[17px] font-bold text-slate-950 dark:text-white">Protect where money stays</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">Turn an account off to keep every cover suggestion away from it.</p>
          </div>
        </div>
      </header>

      <div className="px-4 pb-4">
        <RouteSummary result={result} expanded />
      </div>

      <div className="border-t border-slate-100 px-4 py-4 dark:border-slate-700/70">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">The order never changes</p>
        <div className="mt-3 grid grid-cols-[1fr_16px_1fr_16px_1fr] items-center">
          {GROUPS.map((candidate, index) => {
            const Icon = candidate.icon;
            const active = candidate.kind === activeKind;
            const used = usedKinds.has(candidate.kind);
            return (
              <div key={candidate.kind} className="contents">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveKind(candidate.kind)}
                  className={`min-h-[78px] rounded-xl border px-2 py-2 text-left transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transform-none motion-reduce:transition-none ${
                    active
                      ? "border-indigo-300 bg-indigo-50 dark:border-indigo-400/35 dark:bg-indigo-400/[0.08]"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                  }`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <Icon size={14} aria-hidden="true" className={active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"} />
                    {used && <span className="size-1.5 rounded-full bg-indigo-500" aria-label="Used in this example" />}
                  </span>
                  <span className="mt-2 block text-[10px] font-bold text-slate-800 dark:text-slate-100">{candidate.number}. {candidate.kind === "offline" ? "Offline" : candidate.title}</span>
                  <span className="mt-0.5 block text-[9px] leading-tight text-slate-400 dark:text-slate-500">{candidate.short}</span>
                </button>
                {index < GROUPS.length - 1 && <ArrowRight size={13} aria-hidden="true" className="mx-auto text-slate-300 dark:text-slate-600" />}
              </div>
            );
          })}
        </div>
      </div>

      <section aria-labelledby={`c-${group.kind}-heading`} className="border-t border-slate-100 dark:border-slate-700/70">
        <div className="px-4 pb-2 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={`c-${group.kind}-heading`} className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{group.title}</h3>
            <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">{group.short}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{group.rule}</p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {accounts.map((account) => (
            <AccountToggle key={account.id} account={account} excluded={excluded} onToggle={onToggle} compact />
          ))}
        </div>
      </section>
    </section>
  );
}

function SettingsContext() {
  return (
    <>
      <header className="flex items-center gap-3">
        <button type="button" aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-full text-slate-600 active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-slate-800">
          <ChevronLeft size={21} aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-[21px] font-bold text-slate-950 dark:text-white">Settings</h1>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Money decisions</p>
        </div>
      </header>
      <div className="glass-card flex min-h-16 items-center gap-3 rounded-2xl px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Your plan</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">Standard · bank data up to date</span>
        </span>
        <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Manage</span>
      </div>
    </>
  );
}

function Controls({ variant, state, mode }: { variant: Variant; state: PreviewState; mode: Mode }) {
  const nextState: Record<PreviewState, PreviewState> = { all: "savings", savings: "short", short: "all" };
  const stateLabel: Record<PreviewState, string> = { all: "Current", savings: "Savings", short: "Uncovered" };
  return (
    <nav aria-label="Preview controls" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        {(["a", "b", "c"] as Variant[]).map((item) => (
          <a key={item} href={`?variant=${item}&state=${state}&mode=${mode}`} className={`grid min-h-11 min-w-11 place-items-center rounded-full text-xs font-bold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none motion-reduce:transition-none ${variant === item ? "bg-indigo-600 text-white" : "text-slate-400"}`}>
            {item.toUpperCase()}
          </a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a href={`?variant=${variant}&state=${nextState[state]}&mode=${mode}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none">
          {stateLabel[state]}
        </a>
        <a href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none">
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function CoverPlanSourcesClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: PreviewState = rawState === "savings" || rawState === "short" ? rawState : "all";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(PRESET_EXCLUSIONS[state]));
  const result = useMemo(() => findCover(excluded), [excluded]);
  const note = NOTES[variant];

  useEffect(() => {
    setExcluded(new Set(PRESET_EXCLUSIONS[state]));
  }, [state]);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", mode === "dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, [mode]);

  function toggleAccount(id: string) {
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-32 pt-5 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[880px] px-4">
          <div className="grid items-start gap-5 lg:grid-cols-[280px_430px] lg:justify-center">
            <aside data-g46-note className="glass-card rounded-2xl p-4 lg:sticky lg:top-5">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <CircleAlert size={15} aria-hidden="true" />
                <p className="text-[10px] font-semibold uppercase tracking-widest">G46 design round</p>
              </div>
              <p className="mt-3 text-[13px] font-bold text-slate-900 dark:text-slate-100">{note.title}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
              <p className="mt-2 hidden text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 lg:block"><span className="font-semibold">Trade-off:</span> {note.tradeoff}</p>
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700/70">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Fixture</p>
                <p className="money mt-1 text-[17px] font-bold text-slate-950 dark:text-white">{money(GAP)} cover gap</p>
                <p className="mt-1 hidden text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 lg:block">Use the bottom state control or switch accounts directly. Every consequence is calculated locally from the settled engine order.</p>
              </div>
            </aside>

            <div className="mx-auto w-full max-w-[430px] space-y-4">
              <SettingsContext />
              {variant === "a" && <VariantA excluded={excluded} result={result} onToggle={toggleAccount} />}
              {variant === "b" && <VariantB excluded={excluded} result={result} onToggle={toggleAccount} />}
              {variant === "c" && <VariantC excluded={excluded} result={result} onToggle={toggleAccount} />}
            </div>
          </div>
        </div>
        <Controls variant={variant} state={state} mode={mode} />
      </main>
    </div>
  );
}
