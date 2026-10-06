"use client";

// G221 estate directions B and C (A removes the block, so it renders nothing).
// Rows are the production AccountLedgerRow through bankToRow / investmentToRow;
// the only difference from production is the tidy account name (accountName.ts)
// and the chrome around the rows. `data-accounts-route` marks every control in
// the estate region that goes to the full accounts list, so the check can count
// routes. "Today" is the production components/HomeEstateSection, not a copy.

import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import HomeEstateSection from "@/components/HomeEstateSection";
import { bankToRow, investmentToRow } from "@/lib/accountsEstate";
import { tidyAccountName } from "./accountName";
import { topPicks, type EstateFixture } from "./fixtures";

const noop = () => {};
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
const HAIR = "border-t border-slate-100 dark:border-white/5";

type Row = ReturnType<typeof bankToRow>;
const tidy = (r: Row): Row => ({ ...r, name: tidyAccountName(r.name) });

interface Props {
  estate: EstateFixture;
  className?: string;
  style?: CSSProperties;
  /** Gap under the section label (the rhythm's label gap). */
  labelGap: string;
}

/** B: pinned accounts only, max 4 rows, plain label, no Manage, no footer. Hidden when nothing is pinned. */
export function EstatePinnedOnly({ estate, className, style, labelGap }: Props) {
  const { accounts, investment, pinnedIds } = estate;
  const rows: Row[] = [
    ...pinnedIds.map((id) => accounts.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => tidy(bankToRow(a, pinnedIds))),
    ...(investment && pinnedIds.includes(investment.id) ? [investmentToRow(investment, pinnedIds)] : []),
  ].slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <section className={className} style={style} aria-labelledby="estate-heading" data-estate-variant="b">
      <p id="estate-heading" className={`${LABEL} ${labelGap}`}>Pinned accounts</p>
      <div className="glass-card rounded-2xl overflow-hidden">
        {rows.map((row, i) => (
          <div key={row.id} className={i > 0 ? HAIR : ""}>
            <AccountLedgerRow row={row} onClick={noop} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** C: the block stays, one footer row replaces Manage and "+N more accounts". */
export function EstateAllFooter({ estate, className, style, labelGap }: Props) {
  const { accounts, investment, pinnedIds, total } = estate;
  const { top } = topPicks(accounts, pinnedIds, investment);
  const rows: Row[] = [
    ...top.map((a) => tidy(bankToRow(a, pinnedIds))),
    ...(investment ? [investmentToRow(investment, pinnedIds)] : []),
  ];
  const footer = total === 1 ? "See your account" : `All ${total} accounts`;
  return (
    <section className={className} style={style} aria-labelledby="estate-heading" data-estate-variant="c">
      <p id="estate-heading" className={`${LABEL} ${labelGap}`}>Your estate</p>
      <div className="glass-card rounded-2xl overflow-hidden">
        {rows.map((row, i) => (
          <div key={row.id} className={i > 0 ? HAIR : ""}>
            <AccountLedgerRow row={row} onClick={noop} />
          </div>
        ))}
        <button
          type="button"
          data-accounts-route="all"
          onClick={noop}
          className={`${rows.length > 0 ? HAIR : ""} w-full min-h-11 flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 active:bg-slate-50 dark:active:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
        >
          {footer} <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export type Variant = "today" | "a" | "b" | "c";

/** The estate region for one variant. Fresh users (total 0) get nothing: FirstAccountCard owns that route. */
export function EstateRegion({ variant, estate, className, style, labelGap }: Props & { variant: Variant }) {
  if (estate.total === 0) return null;
  if (variant === "a") return null;
  if (variant === "b") return <EstatePinnedOnly estate={estate} className={className} style={style} labelGap={labelGap} />;
  if (variant === "c") return <EstateAllFooter estate={estate} className={className} style={style} labelGap={labelGap} />;
  const { accounts, investment, pinnedIds } = estate;
  const { top, hidden } = topPicks(accounts, pinnedIds, investment);
  return (
    <HomeEstateSection
      className={className}
      style={style}
      loading={false}
      accountCount={accounts.length}
      topPickAccounts={top}
      topPickInvestment={investment}
      investmentCount={investment ? 1 : 0}
      hiddenAccountCount={hidden}
      pinnedIds={pinnedIds}
      onManage={noop}
      onOpenAccount={noop}
      onOpenInvestments={noop}
      onViewAll={noop}
      emptyState={null}
    />
  );
}
