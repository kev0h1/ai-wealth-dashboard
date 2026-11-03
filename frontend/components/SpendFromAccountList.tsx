import { BankIcon, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import type { SpendFromAccount } from "@/lib/spendFromAccount";

type SpendFromAccountListProps = {
  entries: SpendFromAccount[];
  pool: number | null;
  amount: (value: number) => string;
  /** Legacy display context. Limits already include cover-move reserves. */
  coverMoveVisible: boolean;
  reserveByAccount?: Record<string, number>;
  destinationsByAccount?: Record<string, string[]>;
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
  onLogoError,
  kind,
}: SpendFromAccountListProps) {
  const brands = entries.map((entry) => accountBrand(entry.account).label);
  const hasKnownPool = pool !== null;
  const hasLowerLimit = entries.some((entry) =>
    !hasKnownPool || Math.round(entry.headroom) < Math.round(pool),
  );

  return (
    <section
      data-g115-treatment={kind}
      data-spend-from-layout="account-list"
      aria-label="Current accounts to spend from"
      className="mt-4"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Spend from</p>
      <ul aria-label="Current accounts to spend from" className="mt-2 space-y-2">
        {entries.map((entry) => {
          const brand = accountBrand(entry.account);
          // G410: every listed account shows its figure. The old rule hid "up to" when the
          // (pool-capped) figure was not below the pool, which left the one account whose
          // figure equals Left to spend with no amount at all.
          const sameBank = brands.filter((label) => label === brand.label).length > 1;

          return (
            <li
              key={entry.accountId}
              data-spend-from-account={entry.accountId}
              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2"
            >
              <BankIcon
                identity={entry.account}
                altText=""
                size={24}
                onLogoError={brand.logoSrc ? () => onLogoError(brand.logoSrc!) : undefined}
              />
              <span className="min-w-0">
                <span className="block break-words text-[12px] font-medium leading-5 text-slate-700 dark:text-slate-200">{brand.label}</span>
                {sameBank && <span className="block break-words text-[12px] leading-5 text-slate-600 dark:text-slate-300">{displayAccountName(entry.name)}</span>}
              </span>
              <span className="shrink-0 text-right text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                up to <span data-spend-from-limit><MoneyText text={amount(entry.headroom)} /></span>
              </span>
            </li>
          );
        })}
      </ul>
      {entries.length > 0 && (
        <p className={`${entries.length > 1 ? "mt-3" : "mt-2"} text-[12px] leading-5 text-slate-600 dark:text-slate-300`}>
          {entries.length > 1
            ? `Showing your top ${entries.length} accounts. Each amount is the most that account could cover. Don't add them together. `
            : `Showing your top account. ${!hasLowerLimit ? "Within the estimate above." : "This is the most that account could cover."} `}
          See all in Your accounts.
        </p>
      )}
    </section>
  );
}
