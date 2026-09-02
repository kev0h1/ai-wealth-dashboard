"use client";

// TEMPORARY PREVIEW — delete with the other /design/* routes
//
// Reconnect surface, three coded directions, per owner feedback (2026-08-28):
// "the format of the reconnect is off, how would this look like if we had
// multiple accounts to connect, have impeccable look at this." The live
// banner (frontend/app/components/HomePage.tsx's expiredProviders.map,
// rendered via HomeBrief's `banner` prop) currently stacks one identical
// full glass-card per expired provider — text-left, big-button-right, with
// awkward vertical balance on its own, and never designed past N=1. Nothing
// here ships until Kevin picks; HomePage.tsx and HomeBrief.tsx are untouched.
//
// Fixtures: AMEX, NatWest, Monzo (frontend/components/AccountMiniCard.tsx's
// BANK_META, resolved through the same bankKey() the real Home banner would
// use), shown at N=1, N=2 and N=3 expired providers per variant. No data
// fetching, no client state, no auth — /design/* is exempt (see
// components/AuthProvider.tsx). Deep-linkable at /design/reconnect.
//
// Impeccable lens applied throughout: what does the user actually decide
// (nothing — this is a chore, not a choice, so every variant leads with
// "fix it" rather than asking which account first), how alarming should
// this feel (amber concern, never Risk Red — DESIGN.md's "Red Is Risk"
// rule, this is a stale connection, not a genuine liability), and how do N
// identical cards avoid reading as N separate problems.

import { AlertTriangle, ChevronDown, RefreshCw } from "lucide-react";
import { BankBadge, bankKey, BANK_META, type BankMeta } from "@/components/AccountMiniCard";

type Provider = { provider: string; provider_id?: string };

// Same shape as HomePage.tsx's expiredProviders — provider display name is
// enough for bankKey() to resolve the canonical BANK_META entry.
const ALL_PROVIDERS: Provider[] = [
  { provider: "Amex" },
  { provider: "NatWest" },
  { provider: "Monzo" },
];

const PROVIDER_SETS: Provider[][] = [
  ALL_PROVIDERS.slice(0, 1),
  ALL_PROVIDERS.slice(0, 2),
  ALL_PROVIDERS.slice(0, 3),
];

function providerMeta(p: Provider): BankMeta {
  return BANK_META[bankKey(p)];
}

// Mirrors accountBrand()'s BRANCH 1 logo resolution (AccountMiniCard.tsx) —
// duplicated in miniature here rather than imported, since accountBrand()
// takes a full Account (balance, type, etc.) and these fixtures are
// provider-name-only.
function providerLogoSrc(meta: BankMeta): string | null {
  if (meta.logoFile) return `/banks/${meta.logoFile}`;
  if (meta.domain) return `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`;
  return null;
}

// A bank badge carrying its own amber "needs you" dot — used only where a
// single badge stands in for the whole card's alarm (the N=1 degrade on
// Variants B and C), so the signifier is never duplicated: one card, one
// amber cue, per DESIGN.md's "Figures Are Ink; Amber Lives In The
// Signifier" rule.
function ProviderBadge({ meta, size = 36 }: { meta: BankMeta; size?: number }) {
  return (
    <span className="relative inline-flex flex-shrink-0">
      <BankBadge
        logoSrc={providerLogoSrc(meta)}
        initials={meta.initials}
        initialsSize={meta.initialsSize}
        altText={meta.label}
        brandBg={meta.bg}
        size={size}
      />
      <span
        aria-hidden="true"
        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 dark:bg-amber-400 ring-2 ring-[#f0f2f7] dark:ring-[#0f172a]"
      />
    </span>
  );
}

// ── Variant A — refined single-card-per-provider ────────────────────────
// Keeps today's one-card-per-provider format (owner's stated preference for
// what to fix, not replace) but corrects the actual complaint: the old
// layout centred a two-line text block against a same-row button, so a
// taller button read heavier than the text it sat beside. Here the icon +
// copy sit on their own row (icon top-aligned against two lines, not
// vertically centred against a single button), and Reconnect drops to a
// full-width row of its own below — no more forced side-by-side balance to
// get wrong. The button itself carries a matching RefreshCw glyph so it
// doesn't out-weigh the icon chip above it.
//
// N>1 still stacks (this variant does not solve the "N identical problems"
// framing — that's Variant B/C's job) but a quiet count eyebrow above the
// stack, and a tighter gap-2 between the cards than the app's usual gap-3
// card rhythm, frames them as one family of the same chore rather than N
// unrelated alerts.
function ProviderReconnectCard({ meta }: { meta: BankMeta }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-500/15 dark:bg-amber-400/10 flex items-center justify-center">
          <AlertTriangle size={18} aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
        </span>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {meta.label} needs reconnecting
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
            Transactions have stopped syncing.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-[13px] font-semibold rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <RefreshCw size={13} aria-hidden="true" />
        Reconnect
      </button>
    </div>
  );
}

function VariantA({ providers }: { providers: Provider[] }) {
  return (
    <div className="flex flex-col gap-2">
      {providers.length > 1 && (
        <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {providers.length} accounts need reconnecting
        </p>
      )}
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <ProviderReconnectCard key={p.provider} meta={providerMeta(p)} />
        ))}
      </div>
    </div>
  );
}

// ── Variant B — one consolidated card ───────────────────────────────────
// The direct answer to "what would N look like": one card, one amber
// signifier, a headline that states the count ("2 accounts need
// reconnecting") so the user reads the scope of the chore in one line
// instead of counting cards. Each provider is a row (real bank badge, not
// another triangle — recognising your own bank is calmer than parsing a
// generic warning glyph three times) with its own Reconnect action, because
// each provider is a genuinely separate OAuth round-trip; one aggregate
// button would promise a single tap that the underlying flow can't deliver.
//
// N=1 degrades to a plain single card — same icon-then-copy-then-full-width-
// button shape as Variant A, so a lone expired provider never grows list
// chrome (divider rows, a count headline) it doesn't need.
function VariantB({ providers }: { providers: Provider[] }) {
  const n = providers.length;

  if (n === 1) {
    const meta = providerMeta(providers[0]);
    return (
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <ProviderBadge meta={meta} />
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
              {meta.label} needs reconnecting
            </p>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
              Transactions have stopped syncing.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-[13px] font-semibold rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <RefreshCw size={13} aria-hidden="true" />
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-500/15 dark:bg-amber-400/10 flex items-center justify-center">
          <AlertTriangle size={18} aria-hidden="true" className="text-amber-600 dark:text-amber-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            {n} accounts need reconnecting
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400 leading-snug text-pretty">
            Transactions have stopped syncing for these.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col divide-y divide-slate-900/[0.05] dark:divide-white/[0.06]">
        {providers.map((p) => {
          const meta = providerMeta(p);
          return (
            <div key={p.provider} className="flex items-center gap-3 py-2.5">
              <BankBadge
                logoSrc={providerLogoSrc(meta)}
                initials={meta.initials}
                initialsSize={meta.initialsSize}
                altText={meta.label}
                brandBg={meta.bg}
                size={30}
              />
              <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate">
                {meta.label}
              </span>
              <button
                type="button"
                className="flex-shrink-0 min-h-[44px] -my-2 flex items-center px-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
              >
                Reconnect
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Variant C — quiet strip, progressive disclosure ─────────────────────
// A genuinely different footprint, not a blend of A/B: a single-line strip
// (a status dot, not an icon chip — the quietest amber signifier the app
// has) that answers the "how alarming should this feel" question by taking
// up as little space as a reading like "Transport 4x usual" would elsewhere
// on Home. This is the variant built to sit directly above the payday plan
// card without competing with it.
//
// N=1 stays a one-line row with its action inline. N>1 becomes a native
// <details>/<summary> disclosure — no client state needed, keyboard- and
// screen-reader-native — collapsed by default to "2 accounts need
// reconnecting · Fix", expanding in place to per-provider rows only when
// the user actually wants to see which accounts. Most visits, most people
// just tap through without ever reading the list; the strip never forces
// that read on them up front.
function VariantC({ providers }: { providers: Provider[] }) {
  const n = providers.length;

  if (n === 1) {
    const meta = providerMeta(providers[0]);
    return (
      <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate">
          {meta.label} needs reconnecting
        </span>
        <button
          type="button"
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

// ── Shared preview scaffolding ───────────────────────────────────────────

// A neighbouring glass card, so the N=2 example reads in context between
// real lit-panel siblings the way it does on Home (between Safe to Spend
// and the payday plan), rather than in isolation.
function NeighbourCard({ label }: { label: string }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Neighbouring card, for context only.</p>
    </div>
  );
}

function NLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

function VariantSection({
  name,
  caption,
  Variant,
}: {
  name: string;
  caption: string;
  Variant: (p: { providers: Provider[] }) => React.JSX.Element;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[13px] font-semibold text-slate-900 dark:text-white">{name}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 text-pretty">{caption}</p>
      </div>

      <div>
        <NLabel>N = 1</NLabel>
        <Variant providers={PROVIDER_SETS[0]} />
      </div>

      <div>
        <NLabel>N = 2 · in context</NLabel>
        <div className="flex flex-col gap-3">
          <NeighbourCard label="Safe to Spend" />
          <Variant providers={PROVIDER_SETS[1]} />
          <NeighbourCard label="Payday plan" />
        </div>
      </div>

      <div>
        <NLabel>N = 3</NLabel>
        <Variant providers={PROVIDER_SETS[2]} />
      </div>
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : undefined}>
      <div
        className="rounded-3xl bg-[#f0f2f7] dark:bg-[#0f172a] p-4"
        style={{ colorScheme: dark ? "dark" : "light" }}
      >
        <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {dark ? "Dark block" : "Light block"}
        </p>
        <div className="flex flex-col gap-10">
          <VariantSection
            name="A · Refined single card"
            caption="Today's one-card-per-provider format, rebalanced: icon+copy on their own row, Reconnect drops to a full-width row below instead of fighting the text for vertical centre. Stacks with a count eyebrow when N>1."
            Variant={VariantA}
          />
          <div className="h-px bg-slate-900/[0.06] dark:bg-white/[0.06]" />
          <VariantSection
            name="B · Consolidated card"
            caption="One card, one amber signifier, a headline that states the count. Real bank badges per row (recognisable, calmer than a repeated triangle), each with its own Reconnect since each provider is a separate OAuth trip. N=1 degrades to a plain single card, no list chrome."
            Variant={VariantB}
          />
          <div className="h-px bg-slate-900/[0.06] dark:bg-white/[0.06]" />
          <VariantSection
            name="C · Quiet strip, progressive disclosure"
            caption="A status dot, not an icon chip — the quietest amber cue in the app. N>1 collapses behind a native disclosure (no client state) so most visits never force the full list into view. Built to sit above the payday plan card without competing with it."
            Variant={VariantC}
          />
        </div>
      </div>
    </div>
  );
}

export default function ReconnectClient() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Reconnect banner</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Three directions at N=1/2/3 expired providers (Amex, NatWest, Monzo). None glow — each carries its own
          amber signifier (icon chip, badge dot, or status dot) as its attention voice, the same reasoning that
          removed &quot;reconnect&quot; from the attention resolver (lib/attention.ts, 2026-08-28).
        </p>

        <div className="mt-6 flex flex-col gap-8">
          <ThemeBlock dark={false} />
          <ThemeBlock dark={true} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          Every action button keeps a 44px tap target and a visible focus ring. Amber never colours a headline,
          money figure, or full sentence (DESIGN.md&apos;s &quot;Figures Are Ink; Amber Lives In The Signifier&quot;) —
          it lives only in a chip, a badge dot, or a status dot. The indigo primary treatment is the only saturated
          colour any Reconnect action wears; this is a stale connection, not a genuine risk, so nothing here reaches
          for Risk Red.
        </p>
      </div>
    </div>
  );
}
