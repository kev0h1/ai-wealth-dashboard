"use client";

// TEMPORARY PREVIEW — G51, cover-plan source settings scale round.
// Static fixtures only. No API requests and no production settings changes.
// Reworks the shipped CoverPlanSourcesCard, which renders every account in
// every class as its own always-expanded toggle row: on a real seventeen
// non-credit-account estate that ran for several screens with roughly a
// screen of prose above the first control (Kevin, 2026-09-12).
// /design/cover-plan-sources-scale?variant=a|b|c&state=all|savings|short&mode=light|dark

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Landmark,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Toggle from "@/components/Toggle";

type Variant = "a" | "b" | "c";
type PreviewState = "all" | "savings" | "short";
type Mode = "light" | "dark";
type SourceClass = "current" | "savings";

type ScaleAccount = {
  id: string;
  name: string;
  provider: string;
  mark: string;
  markClass: string;
  kind: SourceClass;
  headroom: number;
  selfShort?: number;
  manual?: boolean;
};

type Leg = { account: ScaleAccount; amount: number };
type CoverResult = { legs: Leg[]; uncovered: number };

const GAP = 760;

// Kevin's real estate: 4 current accounts (one manual, one short) and 13
// savings pots (one manual, four sitting at zero) — seventeen non-credit
// accounts total, matching the estate the shipped card could not scale to.
const FIXTURE: ScaleAccount[] = [
  {
    id: "barclays-current",
    name: "Everyday household joint current account",
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
    id: "petty-cash",
    name: "Petty cash tin",
    provider: "Offline",
    mark: "£",
    markClass: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    kind: "current",
    headroom: 120,
    manual: true,
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
    id: "emergency-fund",
    name: "Emergency fund",
    provider: "Chase",
    mark: "C",
    markClass: "bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300",
    kind: "savings",
    headroom: 3400,
  },
  {
    id: "isa",
    name: "ISA",
    provider: "NatWest",
    mark: "N",
    markClass: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    kind: "savings",
    headroom: 1200,
  },
  {
    id: "house-deposit",
    name: "House deposit",
    provider: "NatWest",
    mark: "N",
    markClass: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    kind: "savings",
    headroom: 5200,
  },
  {
    id: "wedding-fund",
    name: "Wedding fund",
    provider: "Starling",
    mark: "S",
    markClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    kind: "savings",
    headroom: 890,
  },
  {
    id: "car-fund",
    name: "Car fund",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 150,
  },
  {
    id: "gift-fund",
    name: "Gift fund",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 60,
  },
  {
    id: "christmas-pot",
    name: "Christmas pot",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 40,
  },
  {
    id: "cash-reserve",
    name: "Cash reserve",
    provider: "Offline",
    mark: "£",
    markClass: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    kind: "savings",
    headroom: 790,
    manual: true,
  },
  {
    id: "groceries-pot",
    name: "Groceries",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 0,
  },
  {
    id: "transport-pot",
    name: "Transport",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 0,
  },
  {
    id: "roundup-pot",
    name: "Round up",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 0,
  },
  {
    id: "holiday-pot",
    name: "Holiday",
    provider: "Monzo",
    mark: "M",
    markClass: "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900",
    kind: "savings",
    headroom: 0,
  },
];

const GROUPS: Array<{
  kind: SourceClass;
  number: string;
  title: string;
  rule: string;
  icon: typeof Wallet;
}> = [
  {
    kind: "current",
    number: "1",
    title: "Current accounts",
    rule: "Highest headroom first, using as few transfers as possible. An account that is short itself is skipped.",
    icon: Wallet,
  },
  {
    kind: "savings",
    number: "2",
    title: "Savings",
    rule: "Reached only when every allowed current account combined cannot cover the amount. A manual transfer account is checked last, after every connected account in both classes, because moving it needs you to act.",
    icon: Landmark,
  },
];

const PRESET_EXCLUSIONS: Record<PreviewState, string[]> = {
  all: [],
  savings: ["barclays-current", "monzo-current", "petty-cash"],
  short: FIXTURE.map((account) => account.id),
};

const NOTES: Record<Variant, { title: string; thesis: string; tradeoff: string }> = {
  a: {
    title: "A · Collapsed classes, exceptions inline",
    thesis:
      "Each class folds to one line, an allowed count and a chevron. Any account the user has actually turned off shows as a small red note under that line without opening anything; opening a class reveals search once it holds more than five accounts and tucks empty pots behind their own fold.",
    tradeoff:
      "Two levels of disclosure (class, then empty pots) means the fullest inspection costs two taps, and the card's height still grows a little once several classes and their exceptions are visible at once.",
  },
  b: {
    title: "B · Search-first exceptions manager",
    thesis:
      "The ranking becomes a single static strip (Current N/M, Savings N/M); the account list itself starts nearly empty, showing only accounts the user has turned off and a folded skipped count, with a search box as the one door into all seventeen accounts.",
    tradeoff:
      "Browsing the full estate without a specific name in mind means typing something or tapping Browse all; a user who wants to scan every savings pot at a glance has to ask for that list rather than finding it already open.",
  },
  c: {
    title: "C · Drill-in, one screen at a time",
    thesis:
      "The card never shows an account row on its own summary screen, only two tappable rows (Current, Savings) each stating its allowed count and any exceptions; tapping a row swaps the whole card body for that class's list with its own search and empty-pot fold, and a back arrow returns.",
    tradeoff:
      "The summary screen is the shortest of the three by a wide margin, but comparing an account in Current against one in Savings needs a full navigation round trip rather than a look down the page.",
  },
};

function money(value: number): string {
  return `£${Math.round(Math.abs(value)).toLocaleString("en-GB")}`;
}

function skipReason(account: ScaleAccount): "short" | "empty" | null {
  if (account.selfShort) return "short";
  if (account.headroom < 5) return "empty";
  return null;
}

function matchesQuery(account: ScaleAccount, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    account.name.toLowerCase().includes(needle) || account.provider.toLowerCase().includes(needle)
  );
}

function coverFromTier(candidates: ScaleAccount[], remaining: number): { legs: Leg[]; remaining: number } {
  if (remaining <= 0 || candidates.length === 0) return { legs: [], remaining };
  const sorted = [...candidates].sort((a, b) => b.headroom - a.headroom || a.id.localeCompare(b.id));
  const total = sorted.reduce((sum, account) => sum + account.headroom, 0);
  const legs: Leg[] = [];
  let left = remaining;

  if (total < remaining) {
    for (const account of sorted) {
      const amount = Math.min(left, account.headroom);
      if (amount >= 5) {
        legs.push({ account, amount });
        left -= amount;
      }
    }
    return { legs, remaining: left };
  }

  let cumulative = 0;
  const chosen: ScaleAccount[] = [];
  for (const account of sorted) {
    chosen.push(account);
    cumulative += account.headroom;
    if (cumulative >= left) break;
  }
  for (const account of chosen) {
    const amount = Math.min(left, account.headroom);
    if (amount >= 5) {
      legs.push({ account, amount });
      left -= amount;
    }
  }
  return { legs, remaining: left };
}

// The engine's own eligibility (headroom and self-short state), never the
// live move cards a different surface happens to render — the G50 fix this
// round must carry forward.
function findCover(excludedIds: Set<string>, gap = GAP): CoverResult {
  const eligible = (account: ScaleAccount) => !excludedIds.has(account.id) && !skipReason(account);
  const tierCurrent = FIXTURE.filter((a) => a.kind === "current" && !a.manual && eligible(a));
  const tierSavings = FIXTURE.filter((a) => a.kind === "savings" && !a.manual && eligible(a));
  const tierManual = FIXTURE.filter((a) => a.manual && eligible(a));

  let remaining = gap;
  const legs: Leg[] = [];
  for (const tier of [tierCurrent, tierSavings, tierManual]) {
    if (remaining <= 0) break;
    const result = coverFromTier(tier, remaining);
    legs.push(...result.legs);
    remaining = result.remaining;
  }
  return { legs, uncovered: Math.max(0, remaining) };
}

function outcome(result: CoverResult) {
  if (result.uncovered > 0) {
    return {
      tone: "risk" as const,
      label: <><span className="money">{money(result.uncovered)}</span> still uncovered</>,
      detail: <>Allowed accounts can provide <span className="money">{money(GAP - result.uncovered)}</span> of this <span className="money">{money(GAP)}</span> gap.</>,
    };
  }
  const usedManual = result.legs.some((leg) => leg.account.manual);
  const usedSavings = result.legs.some((leg) => leg.account.kind === "savings" && !leg.account.manual);
  const manualAmount = result.legs.filter((leg) => leg.account.manual).reduce((sum, leg) => sum + leg.amount, 0);
  const savingsAmount = result.legs
    .filter((leg) => leg.account.kind === "savings" && !leg.account.manual)
    .reduce((sum, leg) => sum + leg.amount, 0);

  if (usedManual) {
    return {
      tone: "watch" as const,
      label: "A manual transfer enters the plan",
      detail: <>You would move <span className="money">{money(manualAmount)}</span> yourself because the connected accounts allowed could not cover the rest.</>,
    };
  }
  if (usedSavings) {
    return {
      tone: "watch" as const,
      label: "Savings enters the plan",
      detail: <><span className="money">{money(savingsAmount)}</span> would come from savings because allowed current accounts cannot cover the gap.</>,
    };
  }
  return {
    tone: "neutral" as const,
    label: "Covered from current accounts",
    detail: `${result.legs.length} ${result.legs.length === 1 ? "transfer" : "transfers"}; savings and manual accounts stay untouched.`,
  };
}

function BankMark({ account }: { account: ScaleAccount }) {
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

function Disclosure({ open, children }: { open: boolean; children: ReactNode }) {
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
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
    </div>
  );
}

function ConsequenceCard({ result }: { result: CoverResult }) {
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
      {result.legs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {result.legs.map((leg) => (
            <div
              key={leg.account.id}
              className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-full bg-white px-2.5 text-[12px] font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200 dark:shadow-none"
            >
              <span className={`grid size-5 shrink-0 place-items-center rounded-md text-[9px] font-bold ${leg.account.markClass}`}>
                {leg.account.mark}
              </span>
              <span className="max-w-[8rem] truncate">{leg.account.name}</span>
              <span className="money shrink-0 font-bold text-slate-950 dark:text-white">{money(leg.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
        className="font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
      >
        {open ? "Hide how this works" : "How this works"}
      </button>
    </p>
  );
}

function HowThisWorksPanel() {
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
      {GROUPS.map((group) => (
        <p key={group.kind}>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{group.number}. {group.title}.</span> {group.rule}
        </p>
      ))}
    </div>
  );
}

function AccountRow({
  account,
  excluded,
  onToggle,
}: {
  account: ScaleAccount;
  excluded: boolean;
  onToggle: (id: string) => void;
}) {
  const reason = skipReason(account);
  return (
    <div className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
      <BankMark account={account} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="max-w-[10rem] truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">
            {account.name}
          </span>
          {account.manual && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              Manual transfer
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          {reason === "short" ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
              Skipped, this account is <span className="money">{money(account.selfShort ?? 0)}</span> short
            </span>
          ) : reason === "empty" ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
              Skipped, this pot is empty
            </span>
          ) : excluded ? (
            "Excluded from every cover suggestion"
          ) : (
            <><span className="money">{money(account.headroom)}</span> can move after bills and the <span className="money">£10</span> buffer</>
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

function ClassAccountList({
  accounts,
  excludedIds,
  onToggle,
  search,
}: {
  accounts: ScaleAccount[];
  excludedIds: Set<string>;
  onToggle: (id: string) => void;
  search: string;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const filtered = search ? accounts.filter((account) => matchesQuery(account, search)) : accounts;
  const visible = filtered.filter((account) => skipReason(account) !== "empty");
  const empty = filtered.filter((account) => skipReason(account) === "empty");

  if (filtered.length === 0) {
    return <p className="px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">No accounts match &ldquo;{search}&rdquo;.</p>;
  }

  return (
    <>
      {visible.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {visible.map((account) => (
            <AccountRow key={account.id} account={account} excluded={excludedIds.has(account.id)} onToggle={onToggle} />
          ))}
        </div>
      )}
      {empty.length > 0 && (
        <div className={visible.length > 0 ? "border-t border-slate-100 dark:border-slate-700/70" : ""}>
          <button
            type="button"
            onClick={() => setShowEmpty((value) => !value)}
            aria-expanded={showEmpty}
            className="flex min-h-11 w-full items-center gap-2 px-4 text-[12px] font-semibold text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${showEmpty ? "rotate-180" : ""}`}
            />
            {empty.length} empty {empty.length === 1 ? "pot" : "pots"}, skipped
          </button>
          <Disclosure open={showEmpty}>
            <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700/60 dark:border-slate-700/70">
              {empty.map((account) => (
                <AccountRow key={account.id} account={account} excluded={excludedIds.has(account.id)} onToggle={onToggle} />
              ))}
            </div>
          </Disclosure>
        </div>
      )}
    </>
  );
}

function HeaderBlock({
  eyebrow,
  title,
  howOpen,
  onToggleHow,
}: {
  eyebrow: string;
  title: string;
  howOpen: boolean;
  onToggleHow: () => void;
}) {
  return (
    <header className="px-4 pb-3 pt-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{eyebrow}</p>
      </div>
      <h2 className="mt-2 text-[17px] font-bold text-slate-950 dark:text-white">{title}</h2>
      <HowThisWorks open={howOpen} onToggle={onToggleHow} />
      <Disclosure open={howOpen}>
        <HowThisWorksPanel />
      </Disclosure>
    </header>
  );
}

type VariantProps = { excluded: Set<string>; onToggle: (id: string) => void };

function VariantA({ excluded, onToggle }: VariantProps) {
  const result = useMemo(() => findCover(excluded), [excluded]);
  const [openClass, setOpenClass] = useState<SourceClass | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [search, setSearch] = useState<Record<SourceClass, string>>({ current: "", savings: "" });

  return (
    <section aria-labelledby="cover-sources-a-heading" className="glass-card overflow-hidden rounded-2xl">
      <HeaderBlock
        eyebrow="Cover plan safeguards"
        title="Where cover money can come from"
        howOpen={howOpen}
        onToggleHow={() => setHowOpen((value) => !value)}
      />
      <div className="px-4 pb-4">
        <ConsequenceCard result={result} />
      </div>
      <div className="border-t border-slate-100 dark:border-slate-700/70">
        {GROUPS.map((group, index) => {
          const accounts = FIXTURE.filter((account) => account.kind === group.kind);
          const eligible = accounts.filter((account) => !skipReason(account));
          const allowed = eligible.filter((account) => !excluded.has(account.id));
          const excludedAccounts = eligible.filter((account) => excluded.has(account.id));
          const skippedCount = accounts.length - eligible.length;
          const open = openClass === group.kind;
          return (
            <section key={group.kind} className={index > 0 ? "border-t border-slate-100 dark:border-slate-700/70" : ""}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenClass(open ? null : group.kind)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:active:bg-white/[0.03]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-indigo-200 bg-white text-[12px] font-bold text-indigo-700 dark:border-indigo-400/25 dark:bg-slate-800 dark:text-indigo-300">
                  {group.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{group.title}</span>
                    <span className="shrink-0 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                      {allowed.length} of {eligible.length} allowed
                    </span>
                  </span>
                  {excludedAccounts.length > 0 && (
                    <span className="mt-1 flex flex-col gap-0.5">
                      {excludedAccounts.map((account) => (
                        <span key={account.id} className="flex items-center gap-1.5 text-[12px] text-red-600 dark:text-red-400">
                          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red-500 dark:bg-red-400" />
                          <span className="truncate">{account.name} is off</span>
                        </span>
                      ))}
                    </span>
                  )}
                  {skippedCount > 0 && (
                    <span className="mt-1 block text-[12px] text-slate-400 dark:text-slate-500">
                      {skippedCount} skipped
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                />
              </button>
              <Disclosure open={open}>
                <div className="border-t border-slate-100 dark:border-slate-700/70">
                  {accounts.length > 5 && (
                    <div className="px-4 pb-3 pt-3">
                      <SearchField
                        value={search[group.kind]}
                        onChange={(value) => setSearch((previous) => ({ ...previous, [group.kind]: value }))}
                        placeholder={`Search ${group.title.toLowerCase()}`}
                      />
                    </div>
                  )}
                  <ClassAccountList accounts={accounts} excludedIds={excluded} onToggle={onToggle} search={search[group.kind]} />
                </div>
              </Disclosure>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function VariantB({ excluded, onToggle }: VariantProps) {
  const result = useMemo(() => findCover(excluded), [excluded]);
  const [howOpen, setHowOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [browseAll, setBrowseAll] = useState(false);

  const eligible = FIXTURE.filter((account) => !skipReason(account));
  const skipped = FIXTURE.filter((account) => skipReason(account));
  const excludedAccounts = eligible.filter((account) => excluded.has(account.id));
  const currentEligible = eligible.filter((account) => account.kind === "current");
  const savingsEligible = eligible.filter((account) => account.kind === "savings");
  const currentAllowed = currentEligible.filter((account) => !excluded.has(account.id));
  const savingsAllowed = savingsEligible.filter((account) => !excluded.has(account.id));

  const showList = query.length > 0 || browseAll;
  const matches = showList ? FIXTURE.filter((account) => matchesQuery(account, query)) : [];
  const [skippedOpen, setSkippedOpen] = useState(false);

  return (
    <section aria-labelledby="cover-sources-b-heading" className="glass-card overflow-hidden rounded-2xl">
      <HeaderBlock
        eyebrow="Cover plan safeguards"
        title="Accounts Sorted may use"
        howOpen={howOpen}
        onToggleHow={() => setHowOpen((value) => !value)}
      />
      <div className="px-4 pb-3">
        <ConsequenceCard result={result} />
      </div>
      <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-700/70 dark:bg-white/[0.03]">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">1</span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Current, {currentAllowed.length}/{currentEligible.length}
        </span>
        <ArrowRight size={12} aria-hidden="true" className="text-slate-300 dark:text-slate-600" />
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">2</span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Savings, {savingsAllowed.length}/{savingsEligible.length}
        </span>
      </div>

      <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/70">
        <SearchField value={query} onChange={setQuery} placeholder="Search your 17 accounts" />
        {!browseAll && (
          <button
            type="button"
            onClick={() => setBrowseAll(true)}
            className="mt-2 text-[12px] font-semibold text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
          >
            Browse all 17 accounts
          </button>
        )}
      </div>

      {showList ? (
        <div className="border-t border-slate-100 dark:border-slate-700/70">
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400">No accounts match &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {matches.map((account) => (
                <AccountRow key={account.id} account={account} excluded={excluded.has(account.id)} onToggle={onToggle} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-slate-100 dark:border-slate-700/70">
          {excludedAccounts.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-slate-500 dark:text-slate-400">
              All {eligible.length} eligible accounts are allowed. Search to turn one off.
            </p>
          ) : (
            <>
              <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Turned off ({excludedAccounts.length})
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {excludedAccounts.map((account) => (
                  <AccountRow key={account.id} account={account} excluded onToggle={onToggle} />
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
                {skipped.length} skipped ({skipped.filter((a) => a.selfShort).length} short, {skipped.filter((a) => !a.selfShort).length} empty)
              </button>
              <Disclosure open={skippedOpen}>
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700/60 dark:border-slate-700/70">
                  {skipped.map((account) => (
                    <AccountRow key={account.id} account={account} excluded={excluded.has(account.id)} onToggle={onToggle} />
                  ))}
                </div>
              </Disclosure>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function VariantC({ excluded, onToggle }: VariantProps) {
  const result = useMemo(() => findCover(excluded), [excluded]);
  const [screen, setScreen] = useState<"summary" | SourceClass>("summary");
  const [search, setSearch] = useState<Record<SourceClass, string>>({ current: "", savings: "" });
  const [howOpen, setHowOpen] = useState(false);

  if (screen !== "summary") {
    const group = GROUPS.find((candidate) => candidate.kind === screen)!;
    const accounts = FIXTURE.filter((account) => account.kind === screen);
    return (
      <section aria-labelledby="cover-sources-c-heading" className="glass-card overflow-hidden rounded-2xl">
        <header className="flex items-center gap-2 px-2 pb-1 pt-2">
          <button
            type="button"
            onClick={() => setScreen("summary")}
            aria-label="Back to cover plan safeguards"
            className="grid size-9 shrink-0 place-items-center rounded-full text-slate-600 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-slate-800"
          >
            <ChevronLeft size={19} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Cover plan safeguards
            </p>
            <h2 id="cover-sources-c-heading" className="text-[16px] font-bold text-slate-950 dark:text-white">
              {group.title}
            </h2>
          </div>
        </header>
        <p className="px-4 pb-3 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{group.rule}</p>
        {accounts.length > 5 && (
          <div className="px-4 pb-3">
            <SearchField
              value={search[screen]}
              onChange={(value) => setSearch((previous) => ({ ...previous, [screen]: value }))}
              placeholder={`Search ${group.title.toLowerCase()}`}
            />
          </div>
        )}
        <div className="border-t border-slate-100 dark:border-slate-700/70">
          <ClassAccountList accounts={accounts} excludedIds={excluded} onToggle={onToggle} search={search[screen]} />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="cover-sources-c-heading" className="glass-card overflow-hidden rounded-2xl">
      <HeaderBlock
        eyebrow="Cover plan safeguards"
        title="Protect where money stays"
        howOpen={howOpen}
        onToggleHow={() => setHowOpen((value) => !value)}
      />
      <div className="px-4 pb-4">
        <ConsequenceCard result={result} />
      </div>
      <div className="border-t border-slate-100 dark:border-slate-700/70">
        {GROUPS.map((group, index) => {
          const accounts = FIXTURE.filter((account) => account.kind === group.kind);
          const eligible = accounts.filter((account) => !skipReason(account));
          const allowed = eligible.filter((account) => !excluded.has(account.id));
          const excludedAccounts = eligible.filter((account) => excluded.has(account.id));
          return (
            <button
              key={group.kind}
              type="button"
              onClick={() => setScreen(group.kind)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:active:bg-white/[0.03] ${
                index > 0 ? "border-t border-slate-100 dark:border-slate-700/70" : ""
              }`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-indigo-200 bg-white text-[12px] font-bold text-indigo-700 dark:border-indigo-400/25 dark:bg-slate-800 dark:text-indigo-300">
                {group.number}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold text-slate-900 dark:text-slate-100">{group.title}</span>
                  <span className="shrink-0 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                    {allowed.length} of {eligible.length} allowed
                  </span>
                </span>
                {excludedAccounts.length > 0 && (
                  <span className="mt-0.5 block truncate text-[12px] text-red-600 dark:text-red-400">
                    Off: {excludedAccounts.map((account) => account.name).join(", ")}
                  </span>
                )}
              </span>
              <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-400 dark:text-slate-500" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SettingsContext() {
  return (
    <>
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back"
          className="grid size-11 shrink-0 place-items-center rounded-full text-slate-600 active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:active:bg-slate-800"
        >
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
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">Standard, bank data up to date</span>
        </span>
        <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Manage</span>
      </div>
    </>
  );
}

function Controls({ variant, state, mode }: { variant: Variant; state: PreviewState; mode: Mode }) {
  const nextState: Record<PreviewState, PreviewState> = { all: "savings", savings: "short", short: "all" };
  const stateLabel: Record<PreviewState, string> = { all: "Current covers it", savings: "Savings enters", short: "Everything off" };
  return (
    <nav
      aria-label="Preview controls"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        {(["a", "b", "c"] as Variant[]).map((item) => (
          <a
            key={item}
            href={`?variant=${item}&state=${state}&mode=${mode}`}
            className={`grid min-h-11 min-w-11 place-items-center rounded-full text-xs font-bold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none motion-reduce:transition-none ${
              variant === item ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {item.toUpperCase()}
          </a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a
          href={`?variant=${variant}&state=${nextState[state]}&mode=${mode}`}
          className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none"
        >
          {stateLabel[state]}
        </a>
        <a
          href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 motion-reduce:transform-none"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function CoverPlanSourcesScaleClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: PreviewState = rawState === "savings" || rawState === "short" ? rawState : "all";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(PRESET_EXCLUSIONS[state]));
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setExcluded(new Set(PRESET_EXCLUSIONS[state]));
  }
  const note = NOTES[variant];

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
            <aside className="glass-card rounded-2xl p-4 lg:sticky lg:top-5">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <CircleAlert size={15} aria-hidden="true" />
                <p className="text-[10px] font-semibold uppercase tracking-widest">G51 design round</p>
              </div>
              <p className="mt-3 text-[13px] font-bold text-slate-900 dark:text-slate-100">{note.title}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
              <p className="mt-2 hidden text-[12px] leading-relaxed text-slate-500 dark:text-slate-400 lg:block">
                <span className="font-semibold">Trade-off:</span> {note.tradeoff}
              </p>
              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700/70">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Fixture</p>
                <p className="mt-1 text-[17px] font-bold text-slate-950 dark:text-white">17 non-credit accounts</p>
                <p className="mt-1 hidden text-[12px] leading-relaxed text-slate-500 dark:text-slate-400 lg:block">
                  4 current (1 short, 1 manual) and 13 savings (1 manual, 4 empty), the shape of the owner&rsquo;s own estate. Use the
                  bottom state control to switch which accounts are turned off, or toggle accounts directly.
                </p>
              </div>
            </aside>

            <div className="mx-auto min-w-0 w-full max-w-[430px] space-y-4">
              <SettingsContext />
              {variant === "a" && <VariantA excluded={excluded} onToggle={toggleAccount} />}
              {variant === "b" && <VariantB excluded={excluded} onToggle={toggleAccount} />}
              {variant === "c" && <VariantC excluded={excluded} onToggle={toggleAccount} />}
            </div>
          </div>
        </div>
        <Controls variant={variant} state={state} mode={mode} />
      </main>
    </div>
  );
}
