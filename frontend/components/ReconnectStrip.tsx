"use client";

// Quiet strip, progressive disclosure — the reconnect banner variant the
// owner chose on /design/reconnect (2026-08-28) over the two alternatives
// coded alongside it (refined single card, consolidated card). See
// app/design/reconnect/ReconnectClient.tsx for the full three-way comparison
// and the reasoning behind each; that route stays as a reference, this file
// is the shipped shape reproduced faithfully from its Variant C.
//
// A status dot, not an icon chip, is the amber signifier — the quietest cue
// the app has, sized to take up no more room than a reading like "Transport
// 4x usual" would elsewhere on Home. N=1 stays a one-line row with its
// action inline. N>1 collapses to "N accounts need reconnecting · Fix"
// behind a native <details>/<summary> disclosure — no client state needed,
// keyboard- and screen-reader-native — expanding in place to one row per
// provider only when the user actually wants the list.
//
// Extracted out of HomePage.tsx (rather than inlined, like the old
// glass-card banner was) because BANK_META resolution pulls in BankBadge,
// bankKey and a small logo-source helper — enough surface area to earn its
// own file, consistent with the app's other Home card components
// (SafeToSpendCard, UpcomingBillsStrip, ThisMonthStrip, HomeInsightSpotlight).

import { ChevronDown } from "lucide-react";
import { BankBadge, bankKey, BANK_META, type BankMeta } from "@/components/AccountMiniCard";

export type ReconnectProvider = { provider: string; provider_id?: string };

interface ReconnectStripProps {
  providers: ReconnectProvider[];
  onReconnect: (providerId?: string) => void;
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
  if (n === 0) return null;

  if (n === 1) {
    const { provider_id } = providers[0];
    const meta = providerMeta(providers[0]);
    return (
      <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
          {meta.label} needs reconnecting
        </span>
        <button
          type="button"
          onClick={() => onReconnect(provider_id)}
          className="flex-shrink-0 min-h-[44px] -my-2 flex items-center px-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
        >
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <details className="group glass-card rounded-2xl overflow-hidden">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-3 p-4 min-h-[44px] active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-2xl">
        <span aria-hidden="true" className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
          {n} accounts need reconnecting
        </span>
        <span className="flex-shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">Fix</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-slate-900/[0.05] dark:border-white/[0.06] px-4 py-3 flex flex-col gap-3">
        {providers.map((p) => {
          const meta = providerMeta(p);
          return (
            <div key={p.provider} className="flex items-center gap-3">
              <BankBadge
                logoSrc={providerLogoSrc(meta)}
                initials={meta.initials}
                initialsSize={meta.initialsSize}
                altText={meta.label}
                brandBg={meta.bg}
                size={28}
              />
              <span className="flex-1 min-w-0 text-[12px] text-slate-500 dark:text-slate-400 truncate">
                {meta.label} · stopped syncing
              </span>
              <button
                type="button"
                onClick={() => onReconnect(p.provider_id)}
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
