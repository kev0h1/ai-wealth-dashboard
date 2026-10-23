import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { fixtureMoney, type DisplayAccount, type SpendFromModel } from "./model";

export function SpendFromVariant({ variant, model }: { variant: "a" | "b" | "c"; model: SpendFromModel }) {
  if (variant === "a") return <BankRow model={model} />;
  if (variant === "b") return <AccountList model={model} />;
  return <FoldedAccounts model={model} />;
}

function SharedCap({ model }: { model: SpendFromModel }) {
  return <>
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
    <p className="mt-1 text-[13px] font-normal leading-5 text-slate-600 dark:text-slate-300">{model.accounts.length === 1 ? "Within the estimate above." : "One estimate across these accounts."}</p>
  </>;
}
function ScopeNote({ model }: { model: SpendFromModel }) {
  if (model.accounts.length < 2 || model.accounts.every(account => account.limit === null)) return null;
  return <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-300">Account limits share the total above.</p>;
}
function AccountIdentity({ account }: { account: DisplayAccount }) {
  const brand = accountBrand(account.account);
  return <>
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
    <span className="min-w-0">
      <span className="block break-words text-[13px] font-medium leading-5 text-slate-700 dark:text-slate-200">{account.label}</span>
      {account.detail && <span className="block break-words text-[12px] leading-5 text-slate-600 dark:text-slate-300">{account.detail}</span>}
    </span>
  </>;
}
function LowerLimit({ account }: { account: DisplayAccount }) {
  if (account.limit === null) return null;
  return <span className="shrink-0 text-right text-[12px] leading-5 text-slate-600 dark:text-slate-300"><span data-g320-limit><MoneyText text={fixtureMoney(account.limit)} /></span> held</span>;
}
function MoveReserve({ account }: { account: DisplayAccount }) {
  if (account.moveAmount === null) return null;
  return <p className="col-span-2 col-start-2 mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`${fixtureMoney(account.moveAmount)} held back for the move`} /></p>;
}
function BankRow({ model }: { model: SpendFromModel }) {
  return <section data-g320-spend-from="a" aria-label="Accounts to spend from" className="mt-4">
    <SharedCap model={model} />
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
      {model.accounts.map(account => <li data-g320-account={account.id} key={account.id} className="grid min-w-0 max-w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2">
        <AccountIdentity account={account} />
        {account.limit !== null && <p className="col-start-2 text-[12px] leading-5 text-slate-600 dark:text-slate-300"><span data-g320-limit><MoneyText text={fixtureMoney(account.limit)} /></span> held</p>}
      </li>)}
    </ul>
    {model.move && <p className="mt-3 text-[12px] leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`${fixtureMoney(model.move.amount)} is already held back in ${model.move.source} for the move above.`} /></p>}
    <ScopeNote model={model} />
  </section>;
}
function AccountList({ model }: { model: SpendFromModel }) {
  return <section data-g320-spend-from="b" aria-label="Accounts to spend from" className="mt-4">
    <SharedCap model={model} />
    <ul className="mt-3 space-y-3">
      {model.accounts.map(account => <li data-g320-account={account.id} key={account.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
        <AccountIdentity account={account} />
        <LowerLimit account={account} />
        <MoveReserve account={account} />
      </li>)}
    </ul>
    <ScopeNote model={model} />
  </section>;
}
function FoldedAccounts({ model }: { model: SpendFromModel }) {
  const [primary, ...others] = model.accounts;
  if (!primary) return null;
  return <section data-g320-spend-from="c" aria-label="Accounts to spend from" className="mt-4">
    <SharedCap model={model} />
    <div data-g320-account={primary.id} className="mt-3 grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
      <AccountIdentity account={primary} />
      <LowerLimit account={primary} />
    </div>
    {others.length > 0 && <details className="mt-2">
      <DisclosureSummary className="min-h-11 cursor-pointer rounded-lg text-[13px] font-medium text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200">{others.length === 1 ? "1 other account" : `${others.length} other accounts`}</DisclosureSummary>
      <ul className="space-y-3 py-2">
        {others.map(account => <li data-g320-account={account.id} key={account.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
          <AccountIdentity account={account} />
          <LowerLimit account={account} />
        </li>)}
      </ul>
    </details>}
    <ScopeNote model={model} />
  </section>;
}
