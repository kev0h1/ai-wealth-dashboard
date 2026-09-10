"use client";

// TEMPORARY PREVIEW — G29, fixed-height reconnect treatments.
// Static fixtures only. No account data, navigation or OAuth calls.
// /design/g29-reconnect-rows?variant=a|b|c&surface=accounts|home&mode=light|dark

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { BANK_META, BankBadge, bankKey, type BankMeta } from "@/components/AccountMiniCard";

type Variant = "a" | "b" | "c";
type Surface = "accounts" | "home";
type Mode = "light" | "dark";

type Provider = {
  name: string;
  accounts: number;
};

type Account = {
  name: string;
  provider: string;
  kind: string;
  balance: string;
  stale?: boolean;
};

const PROVIDERS: Provider[] = [
  { name: "NatWest", accounts: 3 },
  { name: "Monzo", accounts: 3 },
  { name: "Amex", accounts: 2 },
];

const STALE_ACCOUNTS: Account[] = [
  { name: "Main account", provider: "NatWest", kind: "Current account", balance: "£1,284", stale: true },
  { name: "Bills account", provider: "NatWest", kind: "Current account", balance: "£620", stale: true },
  { name: "Easy access saver", provider: "NatWest", kind: "Savings", balance: "£2,410", stale: true },
  { name: "Everyday", provider: "Monzo", kind: "Current account", balance: "£386", stale: true },
  { name: "Emergency fund", provider: "Monzo", kind: "Savings pot", balance: "£900", stale: true },
  { name: "Travel", provider: "Monzo", kind: "Savings pot", balance: "£215", stale: true },
  { name: "Platinum Cashback", provider: "Amex", kind: "Credit card", balance: "−£731", stale: true },
  { name: "Rewards", provider: "Amex", kind: "Credit card", balance: "−£184", stale: true },
];

const HOME_ACCOUNTS: Account[] = [
  { name: "Main account", provider: "NatWest", kind: "Current account", balance: "£1,284", stale: true },
  { name: "Emergency fund", provider: "Monzo", kind: "Savings pot", balance: "£900", stale: true },
  { name: "Chase current", provider: "Chase", kind: "Current account", balance: "£472" },
];

const NOTES: Record<Variant, { title: string; thesis: string; risk: string }> = {
  a: {
    title: "A · Connection band · recommended",
    thesis: "One compact disclosure owns the provider-level task. Account rows stay 60px and carry only a quiet status dot.",
    risk: "The disclosure adds one more object above the ledger, so its collapsed state must remain genuinely compact.",
  },
  b: {
    title: "B · Provider queue",
    thesis: "Show the three bank actions immediately, then keep the account ledger clean and fixed-height.",
    risk: "Clearer for urgent repair, but it occupies more space on every visit until all connections are fixed.",
  },
  c: {
    title: "C · Split row actions",
    thesis: "Keep the repair action beside each affected account without allowing it to increase row height.",
    risk: "Eight repeated actions misstate a provider problem and add eight keyboard focus stops. Included as a useful contrast, not the recommendation.",
  },
};

function providerMeta(provider: string): BankMeta {
  return BANK_META[bankKey({ provider })];
}

function logoSrc(meta: BankMeta): string | null {
  if (meta.logoFile) return `/banks/${meta.logoFile}`;
  if (meta.domain) return `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`;
  return null;
}

function ProviderMark({ provider, size = 34 }: { provider: string; size?: number }) {
  const meta = providerMeta(provider);
  return (
    <BankBadge
      logoSrc={logoSrc(meta)}
      initials={meta.initials}
      initialsSize={meta.initialsSize}
      altText={meta.label}
      brandBg={meta.bg}
      size={size}
    />
  );
}

function ConnectionDot({ label = "Connection needs attention" }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function AccountRow({ account, rowAction }: { account: Account; rowAction?: boolean }) {
  const contents = (
    <>
      <ProviderMark provider={account.provider} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">
          {account.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
          {account.stale && <ConnectionDot />}
          <span className="truncate">{account.provider} · {account.kind}</span>
        </span>
      </span>
      <span className={`money shrink-0 text-[15px] font-semibold ${account.balance.startsWith("−") ? "text-red-500 dark:text-red-400" : "text-slate-900 dark:text-slate-100"}`}>
        {account.balance}
      </span>
    </>
  );

  if (!rowAction || !account.stale) {
    return (
      <button type="button" className="flex h-[60px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:active:bg-white/5">
        {contents}
      </button>
    );
  }

  return (
    <div className="flex h-[60px] w-full items-stretch">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 pl-4 pr-2 text-left transition-colors active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:active:bg-white/5">
        {contents}
      </button>
      <button
        type="button"
        aria-label={`Reconnect ${account.provider} for ${account.name}`}
        className="grid w-12 shrink-0 place-items-center text-indigo-600 transition-colors active:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-indigo-400 dark:active:bg-indigo-400/10"
      >
        <RefreshCw size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function ProviderActions({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "pt-1" : "mt-2"}>
      {PROVIDERS.map((provider) => (
        <div key={provider.name} className="flex min-h-12 items-center gap-3">
          <ProviderMark provider={provider.name} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{provider.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {provider.accounts} {provider.accounts === 1 ? "account" : "accounts"}
            </p>
          </div>
          <button type="button" className="min-h-11 rounded-lg px-2 text-[13px] font-semibold text-indigo-600 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">
            Reconnect
          </button>
        </div>
      ))}
    </div>
  );
}

function ConnectionBand({ surface }: { surface: Surface }) {
  return (
    <details className="group glass-card rounded-2xl px-4">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
        <ConnectionDot />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Connections need attention</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">3 banks · 8 accounts</span>
        </span>
        <span className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Review</span>
        <ChevronDown size={16} aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pb-3">
        <p className="mb-1 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
          Reconnect each bank once to resume updates{surface === "home" ? " on Home" : ""}.
        </p>
        <ProviderActions compact />
      </div>
    </details>
  );
}

function ProviderQueue() {
  return (
    <section className="glass-card rounded-2xl px-4 pb-2 pt-4">
      <div className="flex items-start gap-2.5">
        <ConnectionDot />
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Reconnect 3 banks</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">Updates have paused for 8 accounts.</p>
        </div>
      </div>
      <ProviderActions />
    </section>
  );
}

function Ledger({ accounts, variant }: { accounts: Account[]; variant: Variant }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 dark:bg-[#1a2334] dark:shadow-none dark:ring-white/[0.07]">
      {accounts.map((account, index) => (
        <div key={`${account.provider}-${account.name}`} className={index ? "border-t border-slate-100 dark:border-white/[0.06]" : ""}>
          <AccountRow account={account} rowAction={variant === "c"} />
        </div>
      ))}
    </section>
  );
}

function SurfacePreview({ variant, surface }: { variant: Variant; surface: Surface }) {
  const accounts = surface === "home" ? HOME_ACCOUNTS : STALE_ACCOUNTS;
  return (
    <div className="space-y-3">
      {surface === "home" ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Your estate</p>
          <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">Your chosen accounts, with connection status kept separate.</p>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Accounts</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Your estate</h2>
          </div>
          <p className="money text-[18px] font-bold text-slate-900 dark:text-white">£4,900</p>
        </div>
      )}

      {variant === "a" && <ConnectionBand surface={surface} />}
      {variant === "b" && <ProviderQueue />}
      {variant === "c" && (
        <p className="flex min-h-11 items-center gap-2 px-1 text-[12px] text-slate-500 dark:text-slate-400">
          <ConnectionDot />
          Reconnect from the refresh control on each affected account.
        </p>
      )}

      <Ledger accounts={accounts} variant={variant} />

      <button type="button" className="flex min-h-11 w-full items-center justify-center gap-1 text-[13px] font-semibold text-indigo-600 active:opacity-70 dark:text-indigo-400">
        See all accounts
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function Controls({ variant, surface, mode }: { variant: Variant; surface: Surface; mode: Mode }) {
  const variants: Variant[] = ["a", "b", "c"];
  return (
    <nav aria-label="Preview controls" className="fixed inset-x-0 z-50 flex justify-center px-3 pointer-events-none" style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/95 p-1 shadow-xl">
        {variants.map((item) => (
          <a key={item} href={`?variant=${item}&surface=${surface}&mode=${mode}`} className={`grid min-h-11 min-w-11 place-items-center rounded-full text-xs font-bold transition-colors active:scale-95 ${variant === item ? "bg-indigo-600 text-white" : "text-slate-400"}`}>
            {item.toUpperCase()}
          </a>
        ))}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
        <a href={`?variant=${variant}&surface=${surface === "home" ? "accounts" : "home"}&mode=${mode}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95">
          {surface === "home" ? "Accounts" : "Home"}
        </a>
        <a href={`?variant=${variant}&surface=${surface}&mode=${mode === "dark" ? "light" : "dark"}`} className="flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-slate-300 active:scale-95">
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function G29ReconnectRowsClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const surface: Surface = params.get("surface") === "home" ? "home" : "accounts";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const note = NOTES[variant];

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", mode === "dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <main className="min-h-dvh bg-[#f0f2f7] pb-32 pt-6 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] space-y-5 px-4">
          <header>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reconnect rows</h1>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">G29 · 8 stale accounts across 3 banks</p>
          </header>

          <aside className="glass-card rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{note.title}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{note.thesis}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400"><span className="font-semibold">Trade-off:</span> {note.risk}</p>
          </aside>

          <SurfacePreview variant={variant} surface={surface} />
        </div>
        <Controls variant={variant} surface={surface} mode={mode} />
      </main>
    </div>
  );
}
