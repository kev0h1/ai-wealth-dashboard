import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import type { SpendFromAccount } from "@/lib/spendFromAccount";
import { money, MOVE } from "./fixtures";

export function accountsNeedFullWidth(entries: SpendFromAccount[]) {
  const labels = entries.map(entry => accountBrand(entry.account).label);
  return labels.some((label, index) => label.length > 16 || labels.indexOf(label) !== index);
}

export function AccountNotes({ move }: { move: boolean }) {
  return <div data-g324-account-notes className="space-y-1 text-pretty text-[12px] leading-5 text-slate-600 dark:text-slate-300">
    <p>Separate account limits, not amounts to add together.</p>
    {move && <p data-g324-move><MoneyText text={`${money(MOVE.amount)} already held back in ${MOVE.source} for the move to ${MOVE.destination}.`} /></p>}
  </div>;
}

/** Local coded proposals only. The entries are the existing best account
 * and its next alternative, with server-shaped ceilings, never balances. */
export default function VisibleAccounts({ entries, pool }: { entries: SpendFromAccount[]; pool: number }) {
  const brands = entries.map(entry => accountBrand(entry.account));
  return <section data-g324-visible-accounts aria-label="Accounts holding this estimate" className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
    <ul className="mt-2 space-y-2">{entries.map((entry, index) => {
      const brand = brands[index];
      const sameBank = brands.filter(item => item.label === brand.label).length > 1;
      const showLimit = Math.round(entry.headroom) < Math.round(pool);
      return <li key={entry.accountId} data-g324-visible-account={entry.accountId} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
        <span className="min-w-0 break-words text-[12px] font-medium leading-5 text-slate-700 dark:text-slate-200">{brand.label}{sameBank && <span className="block font-normal text-slate-600 dark:text-slate-300">{displayAccountName(entry.name)}</span>}</span>
        {showLimit && <span data-g324-visible-limit className="whitespace-nowrap text-right text-[12px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={money(entry.headroom)} /> held</span>}
      </li>;
    })}</ul>
    {entries.length === 1 && Math.round(entries[0].headroom) >= Math.round(pool) && <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-300">Within the estimate above.</p>}
  </section>;
}
