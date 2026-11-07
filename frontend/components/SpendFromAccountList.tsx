import { BankIcon, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import { topSpendFromAccounts, type SpendFromAccount } from "@/lib/spendFromAccount";

type SpendFromAccountListProps = {
  entries: SpendFromAccount[];
  amount: (value: number) => string;
  /** Legacy display context. Limits already include cover-move reserves. */
  coverMoveVisible: boolean;
  reserveByAccount?: Record<string, number>;
  destinationsByAccount?: Record<string, string[]>;
  onLogoError: (logoSrc: string) => void;
  kind: "bank-rail" | "name-fallback";
};

/**
 * G436: each row is that account's own Available, the balance left after its
 * own payments, goals and set-asides. Nothing is shared out; the top two by
 * that figure are shown, positive only (a shortfall is shown where it is
 * acted on, on Upcoming and the account page).
 */
export default function SpendFromAccountList({
  entries,
  amount,
  onLogoError,
  kind,
}: SpendFromAccountListProps) {
  const positive = entries.filter(entry => Number.isFinite(entry.headroom) && entry.headroom > 0);
  const shown = topSpendFromAccounts(positive);
  const brands = shown.map((entry) => accountBrand(entry.account).label);

  return (
    <section
      data-g115-treatment={kind}
      data-spend-from-layout="account-list"
      aria-label="Current accounts to spend from"
      className="mt-4"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Spend from</p>
      <ul aria-label="Current accounts to spend from" className="mt-2 space-y-2">
        {shown.map((entry) => {
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
                <span data-spend-from-limit><MoneyText text={amount(entry.headroom)} /></span>
              </span>
            </li>
          );
        })}
      </ul>
      {shown.length > 0 && (
        <p className={`${shown.length > 1 ? "mt-3" : "mt-2"} text-[12px] leading-5 text-slate-600 dark:text-slate-300`}>
          {shown.length === 1 ? "Showing your top account. " : "Showing your top 2. "}
          {shown.length === 1 ? "See it in Your accounts." : "See them all in Your accounts."}
        </p>
      )}
    </section>
  );
}
