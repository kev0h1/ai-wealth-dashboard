"use client";

// Quiet strip, progressive disclosure. The provider-level treatment was
// reaffirmed in G29's /design/g29-reconnect-rows round (2026-09-10): the
// strip owns reconnect actions while account rows retain their normal height
// and navigation behaviour.
//
// A status dot, not an icon chip, is the amber signifier — the quietest cue
// the app has, sized to take up no more room than a reading like "Transport
// 4x usual" would elsewhere on Home. N=1 stays a one-line row with its
// action inline. N>1 collapses to one connection summary behind a native
// <details>/<summary> disclosure, expanding to one action per bank consent.
//
// Extracted out of HomePage.tsx (rather than inlined, like the old
// glass-card banner was) because BANK_META resolution pulls in BankBadge,
// bankKey and a small logo-source helper — enough surface area to earn its
// own file, consistent with the app's other Home card components
// (SafeToSpendCard, UpcomingBillsStrip, ThisMonthStrip, HomeInsightSpotlight).

import { ChevronDown } from "lucide-react";
import { BankBadge, bankKey, BANK_META, type BankMeta } from "@/components/AccountMiniCard";

export type ReconnectProvider = {
  provider: string;
  provider_id?: string;
  source?: string;
  account_count?: number;
};

interface ReconnectStripProps {
  providers: ReconnectProvider[];
  onReconnect: (provider: ReconnectProvider) => void;
}

// Neutral fallback for a provider name BANK_META doesn't recognise yet —
// the /design/reconnect fixtures only ever used curated banks (Amex,
// NatWest, Monzo) so the preview never needed this, but live expired
// connections can name any provider TrueLayer/Finexer returns. Mirrors
// accountBrand()'s own Branch 3 neutral default (AccountMiniCard.tsx) and
// its "first two letters, upper-cased" initials fallback, rather than
// crashing on an undefined meta lookup.
function providerMeta(p: ReconnectProvider): BankMeta {
  const meta = BANK_META[bankKey(p)];
  if (meta) return meta;
  return {
    label: p.provider || "Bank",
    bg: "linear-gradient(135deg,#2563eb,#1d4ed8)",
    initials: (p.provider ?? "?").slice(0, 2).toUpperCase(),
  };
}

// Mirrors accountBrand()'s BRANCH 1 logo resolution (AccountMiniCard.tsx) —
// duplicated in miniature here rather than imported, since accountBrand()
// takes a full Account (balance, type, Finexer logo/colour fields, etc.)
// and this strip only ever has a provider name and id to work with.
function providerLogoSrc(meta: BankMeta): string | null {
  if (meta.logoFile) return `/banks/${meta.logoFile}`;
  if (meta.domain) return `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`;
  return null;
}

export default function ReconnectStrip({ providers, onReconnect }: ReconnectStripProps) {
  const n = providers.length;
  const accountCount = providers.reduce((sum, provider) => sum + (provider.account_count ?? 1), 0);
  if (n === 0) return null;

  if (n === 1) {
    const provider = providers[0];
    const meta = providerMeta(provider);
    return (
      <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
          {meta.label} needs reconnecting
        </span>
        <button
          type="button"
          onClick={() => onReconnect(provider)}
          aria-label={`Reconnect ${meta.label}`}
          className="flex-shrink-0 min-h-[44px] -my-2 flex items-center px-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <details className="group glass-card rounded-2xl overflow-hidden">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-3 px-4 min-h-[56px] active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-2xl">
        <span aria-hidden="true" className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="flex-1 min-w-0">
          <span className="block truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            Connections need attention
          </span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            {n} bank connections · {accountCount} accounts
          </span>
        </span>
        <span className="flex-shrink-0 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Review</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="px-4 pb-3 flex flex-col gap-1">
        {providers.map((p) => {
          const meta = providerMeta(p);
          return (
            <div key={`${p.source ?? "bank"}:${p.provider_id ?? p.provider}`} className="flex min-h-[48px] items-center gap-3">
              <BankBadge
                logoSrc={providerLogoSrc(meta)}
                initials={meta.initials}
                initialsSize={meta.initialsSize}
                altText={meta.label}
                brandBg={meta.bg}
                size={28}
              />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{meta.label}</span>
                <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {p.account_count ?? 1} {(p.account_count ?? 1) === 1 ? "account" : "accounts"} · stopped syncing
                </span>
              </span>
              <button
                type="button"
                onClick={() => onReconnect(p)}
                aria-label={`Reconnect ${meta.label}`}
                className="flex-shrink-0 min-h-[44px] -my-2 flex items-center px-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
              >
                Reconnect
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
