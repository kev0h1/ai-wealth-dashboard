import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { DisclosureSummary } from "@/components/Disclosure";
import MoneyText from "@/components/MoneyText";
import { fixtureMoney, type SpendFromModel } from "./model";

export type RightVariant = "d" | "e" | "f";

type DisplayAccount = SpendFromModel["accounts"][number];
type Props = {
  variant: RightVariant;
  model: SpendFromModel;
  placement?: "beside" | "below";
};

const sectionWidth = (placement: Props["placement"]) => placement === "beside"
  ? "w-[clamp(7rem,40vw,10.5rem)] shrink-0"
  : "w-full";

function AccountName({ account, compact = false }: { account: DisplayAccount; compact?: boolean }) {
  const brand = accountBrand(account.account);
  return <>
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
    <span className="min-w-0">
      <span className={`block break-words font-medium leading-4 text-slate-700 dark:text-slate-200 ${compact ? "text-[12px]" : "text-[13px]"}`}>{account.label}</span>
      {account.detail && <span className="mt-0.5 block break-words text-[12px] leading-4 text-slate-600 dark:text-slate-300">{account.detail}</span>}
    </span>
  </>;
}

function AccountLimit({ account, stacked = false }: { account: DisplayAccount; stacked?: boolean }) {
  if (account.limit === null) return null;
  return <span className={`text-[13px] leading-4 text-slate-600 dark:text-slate-300 ${stacked ? "block" : "shrink-0 text-right"}`}><span data-g320-limit><MoneyText text={fixtureMoney(account.limit)} /></span><span className="block text-[11px] text-slate-500 dark:text-slate-400">held</span></span>;
}

function RailRow({ account }: { account: DisplayAccount }) {
  return <li data-g320-account={account.id} className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2">
    <AccountName account={account} compact />
    <AccountLimit account={account} />
  </li>;
}

function ColumnRow({ account }: { account: DisplayAccount }) {
  const brand = accountBrand(account.account);
  return <li data-g320-account={account.id} className="min-w-0">
    <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText="" brandBg={brand.background} size={24} />
    <span className="mt-1 block break-words text-[12px] font-medium leading-4 text-slate-700 dark:text-slate-200">{account.label}</span>
    {account.detail && <span className="mt-0.5 block break-words text-[12px] leading-4 text-slate-600 dark:text-slate-300">{account.detail}</span>}
    <span className="mt-1 block"><AccountLimit account={account} stacked /></span>
  </li>;
}

function NamedRail({ model, placement }: Pick<Props, "model" | "placement">) {
  return <section data-g320-spend-from="d" data-g320-placement={placement} aria-label="Accounts holding the estimate" className={sectionWidth(placement)}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
    <ul className="mt-2 space-y-2.5">
      {model.accounts.map(account => <RailRow key={account.id} account={account} />)}
    </ul>
  </section>;
}

function PairedColumns({ model, placement }: Pick<Props, "model" | "placement">) {
  return <section data-g320-spend-from="e" data-g320-placement={placement} aria-label="Accounts holding the estimate" className={sectionWidth(placement)}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-3">
      {model.accounts.map(account => <ColumnRow key={account.id} account={account} />)}
    </ul>
  </section>;
}

function FoldedAccounts({ model, placement }: Pick<Props, "model" | "placement">) {
  const [lead, ...others] = model.accounts;
  if (!lead) return null;
  return <section data-g320-spend-from="f" data-g320-placement={placement} aria-label="Accounts holding the estimate" className={sectionWidth(placement)}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Held in</p>
    <ul className="mt-2"><RailRow account={lead} /></ul>
    {others.length > 0 && <details className="mt-1">
      <DisclosureSummary className="min-h-11 cursor-pointer rounded-lg py-2 text-[12px] font-medium text-slate-700 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:text-white">{others.length === 1 ? "1 other account" : `${others.length} other accounts`}</DisclosureSummary>
      <ul className="space-y-2.5 pb-1 pt-1">
        {others.map(account => <RailRow key={account.id} account={account} />)}
      </ul>
    </details>}
  </section>;
}

export function HeroAccountVariants({ variant, model, placement = "beside" }: Props) {
  if (model.accounts.length === 0) return null;
  if (variant === "d") return <NamedRail model={model} placement={placement} />;
  if (variant === "e") return <PairedColumns model={model} placement={placement} />;
  return <FoldedAccounts model={model} placement={placement} />;
}
