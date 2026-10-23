import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import type { SpendFromAccount } from "@/lib/spendFromAccount";

type SpendFromAccountListProps = {
  entries: SpendFromAccount[];
  pool: number | null;
  amount: (value: number) => string;
  coverMoveVisible: boolean;
  reserveByAccount?: Record<string, number>;
  onLogoError: (logoSrc: string) => void;
  kind: "bank-rail" | "name-fallback";
};

/**
 * The approved G320 B treatment. Account limits are independent ceilings on
 * one forecast, rather than amounts that can be added together.
 */
export default function SpendFromAccountList({
  entries,
  pool,
  amount,
  coverMoveVisible,
  reserveByAccount,
  onLogoError,
  kind,
}: SpendFromAccountListProps) {
  const brands = entries.map((entry) => accountBrand(entry.account).label);
  const hasKnownPool = pool !== null;
  const hasLowerLimit = entries.some((entry) =>
    !hasKnownPool || Math.round(entry.headroom) < Math.round(pool),
  );
  const hasReserveSource = entries.some((entry) => (reserveByAccount?.[entry.accountId] ?? 0) > 0);

  return (
    <section
      data-g115-treatment={kind}
      data-spend-from-layout="account-list"
      aria-label="Accounts holding part of this estimate"
      className="mt-4"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
      <p className="mt-1 text-[13px] font-normal leading-5 text-slate-600 dark:text-slate-300">
        {entries.length === 1 ? "Within the estimate above." : "One estimate across these accounts."}
      </p>
      <ul aria-label="Accounts holding part of this estimate" className="mt-3 space-y-3">
        {entries.map((entry) => {
          const brand = accountBrand(entry.account);
          const showLimit = !hasKnownPool || Math.round(entry.headroom) < Math.round(pool);
          const reserve = reserveByAccount?.[entry.accountId] ?? 0;
          const sameBank = brands.filter((label) => label === brand.label).length > 1;

          return (
            <li
              key={entry.accountId}
              data-spend-from-account={entry.accountId}
              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2"
            >
              <BankBadge
                logoSrc={brand.logoSrc}
                initials={brand.initials}
                altText=""
                brandBg={brand.background}
                size={24}
                onLogoError={brand.logoSrc ? () => onLogoError(brand.logoSrc!) : undefined}
              />
              <span className="min-w-0">
                <span className="block break-words text-[13px] font-medium leading-5 text-slate-700 dark:text-slate-200">{brand.label}</span>
                {sameBank && <span className="block break-words text-[12px] leading-5 text-slate-600 dark:text-slate-300">{displayAccountName(entry.name)}</span>}
              </span>
              {showLimit && (
                <span className="shrink-0 text-right text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                  <span data-spend-from-limit><MoneyText text={amount(entry.headroom)} /></span> held
                </span>
              )}
              {coverMoveVisible && reserve > 0 && (
                <p className="col-span-2 col-start-2 mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                  <MoneyText text={`${amount(reserve)} held back for the move`} />
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {coverMoveVisible && !hasReserveSource && (
        <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-300">The move above is already held back.</p>
      )}
      {entries.length > 1 && hasLowerLimit && (
        <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-300">Account limits share the total above.</p>
      )}
    </section>
  );
}
