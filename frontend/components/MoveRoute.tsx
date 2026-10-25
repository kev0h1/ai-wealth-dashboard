"use client";

// G334: the move-route pieces Home's move cards draw, extracted from
// HomeBrief.tsx so Penny's move-plan card reuses the exact same diagram.
// No visual change on Home: the markup and classes are unchanged.
import { displayAccountName } from "@/lib/accountName";
import { ArrowRight, ChevronDown } from "lucide-react";
import { BankBadge, BANK_META, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { AmountText } from "@/components/MoneyText";

export function resolveBankChip(provider: string) {
  const key = bankKey({ provider });
  const meta = BANK_META[key];
  return {
    logoSrc: bankLogoSrc(meta),
    initials: meta?.initials ?? (provider || "?").slice(0, 2).toUpperCase(),
    label: meta?.label ?? (provider || "Bank"),
    bg: meta?.bg,
    initialsSize: meta?.initialsSize,
  };
}

export type MoveLedgerLeg = { provider: string; name: string; amount: number };

export function moveMoney(value: number, hideNetWorth: boolean) {
  return hideNetWorth ? "£••••" : `£${Math.round(value).toLocaleString("en-GB")}`;
}

export function MoveAccountIcon({ account, size = 28 }: { account: { provider: string; name: string }; size?: number }) {
  const chip = resolveBankChip(account.provider);
  return (
    <BankBadge
      logoSrc={chip.logoSrc}
      initials={chip.initials}
      initialsSize={chip.initialsSize}
      altText={chip.label}
      brandBg={chip.bg}
      size={size}
    />
  );
}

/**
 * Compact account identity for a transfer endpoint. One to three accounts
 * show every real icon. Larger sets show two real icons and a counted final
 * tile. Depth always follows reading order: first is in front, the last item
 * is at the rear whether it is a bank icon or +N.
 */
export function MoveAccountStack({ accounts, size = 28 }: { accounts: readonly MoveLedgerLeg[]; size?: number }) {
  const visibleAccounts = accounts.length > 3 ? accounts.slice(0, 2) : accounts;
  const remaining = accounts.length - visibleAccounts.length;
  const displayCount = visibleAccounts.length + (remaining > 0 ? 1 : 0);

  return (
    <span
      data-account-icon-stack
      role="img"
      aria-label={accounts.map(account => account.name).join(", ")}
      className="flex shrink-0 -space-x-2"
    >
      {visibleAccounts.map((account, index) => (
        <span
          key={`${account.provider}-${account.name}-${index}`}
          data-account-icon={account.provider}
          className="relative inline-flex rounded-lg ring-2 ring-slate-50 dark:ring-slate-900"
          style={{ zIndex: displayCount - index }}
        >
          <MoveAccountIcon account={account} size={size} />
        </span>
      ))}
      {remaining > 0 && (
        <span
          data-more-account-icon={remaining}
          aria-label={`${remaining} more accounts`}
          className="relative inline-grid shrink-0 place-items-center rounded-lg bg-slate-700 font-bold text-white ring-2 ring-slate-50 dark:bg-slate-500 dark:ring-slate-900"
          style={{ width: size, height: size, zIndex: 1, fontSize: Math.max(9, Math.round(size * 0.36)) }}
        >
          +{remaining}
        </span>
      )}
    </span>
  );
}

export function MoveRouteSummary({
  sources,
  destination,
}: {
  sources: readonly MoveLedgerLeg[];
  destination: { provider: string; name: string };
}) {
  const firstSource = sources[0];
  return (
    <div
      data-move-route-summary
      className="mt-3 grid grid-cols-[minmax(0,0.9fr)_28px_minmax(0,1.1fr)] items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3 max-[350px]:grid-cols-1 dark:border-slate-700 dark:bg-slate-900/30"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <MoveAccountStack accounts={sources} />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">From</p>
          <p className="text-[12px] font-semibold leading-4 text-slate-900 dark:text-white">
            {sources.length === 1 ? firstSource.name : `${sources.length} accounts`}
          </p>
        </div>
      </div>
      <span aria-hidden="true" className="grid size-7 justify-self-center place-items-center rounded-full border border-slate-200 bg-white text-indigo-600 max-[350px]:rotate-90 dark:border-slate-600 dark:bg-slate-800 dark:text-indigo-300">
        <ArrowRight size={14} />
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <MoveAccountIcon account={destination} />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">To</p>
          <p className="text-[12px] font-semibold leading-4 text-slate-900 dark:text-white">{displayAccountName(destination.name)}</p>
        </div>
      </div>
    </div>
  );
}

export function MoveSourcesDisclosure({
  legs,
  hideNetWorth,
  totalAmount,
}: {
  legs: readonly MoveLedgerLeg[];
  hideNetWorth: boolean;
  totalAmount: number;
}) {
  return (
    <details data-source-disclosure className="group mt-2 rounded-xl border border-slate-100 dark:border-slate-700">
      <summary className="flex min-h-11 cursor-pointer list-none touch-manipulation items-center justify-between gap-3 rounded-xl px-3 text-[12px] font-semibold text-slate-700 [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden dark:text-slate-200">
        <span>How <span className="money"><AmountText text={moveMoney(totalAmount, hideNetWorth)} /></span> is made up</span>
        <ChevronDown size={15} aria-hidden="true" className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-100 px-3 dark:divide-slate-700 dark:border-slate-700">
        {legs.map((leg, index) => (
          <div key={`${leg.provider}-${leg.name}-${index}`} className="flex min-h-11 items-center gap-2.5 py-1.5">
            <MoveAccountIcon account={leg} size={32} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{leg.name}</span>
            <span className="money shrink-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100"><AmountText text={moveMoney(leg.amount, hideNetWorth)} /></span>
          </div>
        ))}
      </div>
    </details>
  );
}
