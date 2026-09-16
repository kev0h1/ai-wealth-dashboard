"use client";

// TEMPORARY PREVIEW — G111 (backlog item G111), design round only.
//
// G110 shipped one quiet line under the Home Safe-to-Spend hero naming the
// best account to spend from. Live on Kevin's phone it reads "In Main G:
// £25 spare right now. This account only, not your full Safe to Spend."
// under a £226 hero. He raised two things (see scripts/backlog.py show
// G111 for the full ticket):
//
//   1. He cannot tell which BANK holds that cash — "Main G" is an account
//      name, nothing on the line identifies Chase. G107 bundled logos for
//      nine major UK providers locally (public/banks/), no third-party
//      request involved (A34/A27's CSP: img-src is self, data:, blob:
//      only). This route reuses the exact same helpers the rest of the
//      app uses for that — accountBrand()/bankLogoSrc()/BankBadge from
//      components/AccountMiniCard.tsx — so bank identity here renders
//      byte-identical to everywhere else it already appears.
//   2. He asked whether the account with the MOST runway should lead. The
//      shipped rule ranks current accounts before savings, then by
//      headroom, which conflicts with that exactly when a savings pot
//      holds the most — the case where the honest answer is to move it
//      first, not spend from it (lib/spendFromAccount.ts's own kind:
//      "savings_pot" branch already says this when NO current account
//      qualifies). The gap this round exists to close is narrower: when a
//      current account DOES qualify and leads, but a savings pot holds
//      more anyway, the shipped copy says nothing about the pot at all —
//      see the "conflict" fixture in fixtures.ts, where the baseline
//      variant genuinely goes silent on the £180 sitting in House
//      deposit. Each new variant below decides differently how loud to
//      make that silence.
//
// Four variants:
//   current — the CURRENT shipped line and disclosure, unchanged, so
//             Kevin can compare every proposal against what he already
//             has. No bank mark (that's exactly the gap being fixed) and,
//             in the conflict state, no mention of the savings pot at all
//             (also exactly the gap).
//   a       — bank badge + bank name inline on the primary line, and a
//             conflict gets its OWN second line, same weight as the
//             primary line, with its own badge and a leading amber
//             attention dot (the same signifier lib/spendFromAccount.ts's
//             `spendFromNeedsAttention` already uses for this class of
//             situation — DESIGN.md's "amber lives in a signifier" rule).
//             The loudest of the three: most explicit, costs the most
//             height.
//   b       — a small two-row ledger (bank badge, name, a neutral kind tag,
//             the figure in mono/tabular) rather than prose. Row two only
//             appears for the conflict state — otherwise the card stays
//             exactly as quiet as it is today (one row). Most scannable at
//             a glance, but the most permanent height in the case that
//             matters.
//   c       — the quietest: a small inline bank mark (14px) folded into
//             the existing sentence, no dedicated row. A conflict extends
//             the SAME paragraph with one more clause, flagged with the
//             one leading amber dot the shipped card already uses for
//             "needs attention" states (spendFromNeedsAttention), rather
//             than inventing a new signifier. Cheapest in height, closest
//             to what already ships.
//
// Every variant, in every state, keeps the scope qualifier G110 was
// rejected for missing: whenever a real headroom figure is shown, "This
// account only, not your full Safe to Spend." (or the "none" state's own
// "Checked account by account, not against your full Safe to Spend.")
// appears verbatim, never implied.
//
// No fetch, no api.* call, no cookies/headers access — static fixtures
// only (fixtures.ts), so this route stays covered by /design's
// auth-exempt, zero-user-data guarantee (check:design-no-live-data).
// Credit cards are structurally excluded from every fixture (only
// "transaction"/"savings" typed accounts appear) matching the production
// cash-led rule (source_capacity already excludes every credit card
// server-side, reinforced by cover_source_eligible).
//
// /design/g111-spend-from-bank?variant=current|a|b|c&state=leads|conflict|none|unbundled&mode=light|dark
//
// Review notes (impeccable design hook + DESIGN.md's named rules, before
// this went to Kevin):
//   - Font sizes: every literal text-[Npx] here (11px/12px/13px/15px/38px
//     on the hero and the "current" block, 12.5px/9px/14px on VariantB's
//     ledger row) is a verbatim match to components/SafeToSpendCard.tsx's
//     own already-shipped sizes for the exact same roles (hero figure,
//     caption, spend-from line, disclosure). This preview reproduces that
//     card, it does not introduce a new scale — same reasoning cards-page's
//     own review notes already recorded for its off-ramp sizes.
//   - Gray-on-colour: the switcher's unselected-pill text-slate-400 on
//     bg-slate-900/90 is copied verbatim from every other /design/*
//     preview's own fixed-bottom Switcher (see CardsPageVariantsClient.tsx);
//     it's a light-on-dark pairing the hook's heuristic mis-reads as
//     washed-out gray-on-colour. The top illustrative-fixtures caption
//     (text-slate-400/500 on bg-[#f0f2f7] dark:bg-[#0f172a]) is the same
//     canvas-not-saturated pairing cards-page's own notes already covered.
//   - Copy: no em dashes in any user-facing string (fixtures.ts and this
//     file); scope qualifier ("This account only, not your full Safe to
//     Spend." / the "none" state's own sentence) survives in every variant
//     and every state that has a figure to qualify.
//   - Colour: amber appears only as the existing leading-dot signifier
//     (AttentionDot) or VariantB's neutral-vs-caution kind tag, never as
//     the colour of a money figure or a full sentence (The Red Is Risk
//     Rule / "amber lives in the signifier" both hold — nothing here is
//     red, nothing here is risk).
//   - The indigo→violet gradient does not appear anywhere in this route;
//     the switcher's selected-pill indigo-600 is the ordinary solid brand
//     colour, not the gradient (Penny Gradient Rule).
//   - Tap targets: every switcher pill is min-h-[44px], matching every
//     other /design/* preview's switcher.
//   - Motion: none added, content renders immediately (no visibility-
//     gating animation).
//   - Dark mode: every new string carries dark: pairs, verified via the
//     mode=dark screenshots in the G111 report.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { BankBadge, accountBrand } from "@/components/AccountMiniCard";
import { spendFromHeroLine, spendFromAlternativeLine } from "@/lib/spendFromAccount";
import { STATES, STATE_ORDER, toBaselineResult, type StateSlug } from "./fixtures";
import type { Account } from "@/lib/api";

type Variant = "current" | "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

function amount(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function heroAmount(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** One leading amber dot — the exact signifier lib/spendFromAccount.ts's
 *  consumer (SafeToSpendCard.tsx) already renders for a "needs attention"
 *  state. Reused rather than reinvented so this round doesn't introduce a
 *  second caution idiom. */
function AttentionDot() {
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />;
}

function bankBadgeProps(account: Account, size: number) {
  const brand = accountBrand(account);
  return {
    logoSrc: brand.logoSrc,
    initials: brand.initials,
    altText: `${brand.label} logo`,
    brandBg: brand.background,
    size,
  };
}

/** variant="current" — exactly what SafeToSpendCard.tsx renders today via
 *  spendFromHeroLine/spendFromAlternativeLine. No bank mark. In the
 *  conflict state the alternative is null by fixture construction (see
 *  fixtures.ts), so this variant says nothing about House deposit at all —
 *  that silence is deliberate, it is the "before" every other variant is
 *  measured against. */
function CurrentBlock({ state }: { state: StateSlug }) {
  const fixture = STATES[state];
  const result = toBaselineResult(fixture);
  const line = spendFromHeroLine(result, amount);
  const altLine = spendFromAlternativeLine(result, amount);
  const needsAttention = result.kind === "savings_pot" || result.kind === "none";
  if (!line) return null;
  return (
    <div data-testid="spend-from-block">
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        {needsAttention && <AttentionDot />}
        <MoneyText text={line} />
      </p>
      {altLine && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            How we got {heroAmount(fixture.hero)}
            <ChevronDown size={13} aria-hidden="true" />
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
            <MoneyText text={altLine} />
          </p>
        </div>
      )}
    </div>
  );
}

/** variant="a" — bank badge + bank name inline on the primary line; a
 *  conflict gets its own full second line, same visual weight, its own
 *  badge, and the shared attention dot. */
function VariantABlock({ state }: { state: StateSlug }) {
  const fixture = STATES[state];
  if (!fixture.best) {
    // "none" — no account to badge, same sentence as the shipped card.
    return (
      <div data-testid="spend-from-block">
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          <AttentionDot />
          <MoneyText text="No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend." />
        </p>
      </div>
    );
  }
  const bestBrand = accountBrand(fixture.best.account);
  const primary = `In ${fixture.best.account.name} (${bestBrand.label}): ${amount(fixture.best.headroom)} spare right now. This account only, not your full Safe to Spend.`;
  const altLine = fixture.alternative
    ? `Next best: ${fixture.alternative.account.name}, ${amount(fixture.alternative.headroom)} spare in that account.`
    : null;
  const conflictLine = fixture.conflict
    ? `${fixture.conflict.account.name} holds more, ${amount(fixture.conflict.headroom)} in savings, not cash ready. Move it into ${fixture.best.account.name} first if you would rather spend from there.`
    : null;
  return (
    <div data-testid="spend-from-block">
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        <BankBadge {...bankBadgeProps(fixture.best.account, 18)} />
        <MoneyText text={primary} />
      </p>
      {conflictLine && fixture.conflict && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          <AttentionDot />
          <BankBadge {...bankBadgeProps(fixture.conflict.account, 18)} />
          <MoneyText text={conflictLine} />
        </p>
      )}
      {altLine && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            How we got {heroAmount(fixture.hero)}
            <ChevronDown size={13} aria-hidden="true" />
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
            {fixture.alternative && <BankBadge {...bankBadgeProps(fixture.alternative.account, 14)} />}
            <MoneyText text={altLine} />
          </p>
        </div>
      )}
    </div>
  );
}

/** variant="b" — a small two-row ledger. Row two (the conflict) only
 *  renders in the conflict state; every other state stays exactly as
 *  quiet as one row. */
function LedgerRow({
  account,
  headroom,
  tag,
  tagTone,
  attention,
}: {
  account: Account;
  headroom: number;
  tag: string;
  tagTone: "neutral" | "caution";
  attention?: boolean;
}) {
  const brand = accountBrand(account);
  return (
    <div className="flex items-center gap-2 py-1">
      {attention && <AttentionDot />}
      <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={`${brand.label} logo`} brandBg={brand.background} size={20} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{account.name}</p>
        <span
          className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
            tagTone === "caution"
              ? "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
              : "bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-300"
          }`}
        >
          {tag}
        </span>
      </div>
      <span className="money shrink-0 text-[14px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{amount(headroom)}</span>
    </div>
  );
}

function VariantBBlock({ state }: { state: StateSlug }) {
  const fixture = STATES[state];
  if (!fixture.best) {
    return (
      <div data-testid="spend-from-block">
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          <AttentionDot />
          <MoneyText text="No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend." />
        </p>
      </div>
    );
  }
  const scopeCaption = fixture.conflict
    ? "Cash ready now, this account only, not your full Safe to Spend above. Savings holds more, move it first to spend it."
    : "Spare right now, this account only, not your full Safe to Spend above.";
  return (
    <div data-testid="spend-from-block" className="mt-1.5">
      <LedgerRow account={fixture.best.account} headroom={fixture.best.headroom} tag="Cash now" tagTone="neutral" />
      {fixture.conflict && (
        <LedgerRow account={fixture.conflict.account} headroom={fixture.conflict.headroom} tag="Savings, has more" tagTone="caution" attention />
      )}
      <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{scopeCaption}</p>
      {fixture.alternative && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            How we got {heroAmount(fixture.hero)}
            <ChevronDown size={13} aria-hidden="true" />
          </p>
          <div className="mt-2">
            <LedgerRow account={fixture.alternative.account} headroom={fixture.alternative.headroom} tag="Next best" tagTone="neutral" />
          </div>
        </div>
      )}
    </div>
  );
}

/** variant="c" — the quietest: a 14px inline bank mark folded into the
 *  existing sentence, no dedicated row. A conflict extends the same
 *  paragraph with one more clause, flagged by the single leading amber dot
 *  the shipped card already uses (spendFromNeedsAttention), not a second
 *  signifier. */
function VariantCBlock({ state }: { state: StateSlug }) {
  const fixture = STATES[state];
  if (!fixture.best) {
    return (
      <div data-testid="spend-from-block">
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
          <AttentionDot />
          <MoneyText text="No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend." />
        </p>
      </div>
    );
  }
  const primary = `In ${fixture.best.account.name}: ${amount(fixture.best.headroom)} spare right now. This account only, not your full Safe to Spend.`;
  const withConflict = fixture.conflict
    ? `${primary} ${fixture.conflict.account.name} holds more, ${amount(fixture.conflict.headroom)} in savings, move it first to spend it.`
    : primary;
  const altLine = fixture.alternative
    ? `Next best: ${fixture.alternative.account.name}, ${amount(fixture.alternative.headroom)} spare in that account.`
    : null;
  return (
    <div data-testid="spend-from-block">
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        {!!fixture.conflict && <AttentionDot />}
        <BankBadge {...bankBadgeProps(fixture.best.account, 14)} />
        <MoneyText text={withConflict} />
      </p>
      {altLine && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
            How we got {heroAmount(fixture.hero)}
            <ChevronDown size={13} aria-hidden="true" />
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
            <MoneyText text={altLine} />
          </p>
        </div>
      )}
    </div>
  );
}

function ReplicaHero({ variant, state }: { variant: Variant; state: StateSlug }) {
  const fixture = STATES[state];
  return (
    <section className="sts-card relative rounded-3xl p-5 glass-hero" aria-labelledby="g111-heading">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safe to Spend</p>
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
          <ShieldCheck size={13} className="shrink-0" aria-hidden="true" />
          Comfortable
        </span>
      </div>

      <h2 id="g111-heading" className="mt-5">
        <span className="money block text-[38px] font-bold leading-none tracking-[-0.05em] text-emerald-700 dark:text-emerald-300">
          {heroAmount(fixture.hero)}
        </span>
        <span className="mt-2 block text-[15px] font-semibold text-slate-700 dark:text-slate-200">available in cash until Wed 21 Oct</span>
      </h2>

      <p className="mt-2 text-[13px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">
        After upcoming bills, your £150 buffer.
      </p>

      {variant === "current" && <CurrentBlock state={state} />}
      {variant === "a" && <VariantABlock state={state} />}
      {variant === "b" && <VariantBBlock state={state} />}
      {variant === "c" && <VariantCBlock state={state} />}
    </section>
  );
}

function Switcher({ variant, state, mode }: { variant: Variant; state: StateSlug; mode: Mode }) {
  return (
    <div
      id="g111-switcher"
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl max-w-[94vw]">
        {VARIANTS.map((v) => (
          <a
            key={v.value}
            href={`?variant=${v.value}&state=${state}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v.value === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.label}
          </a>
        ))}
        {STATE_ORDER.map((s) => (
          <a
            key={s}
            href={`?variant=${variant}&state=${s}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-2.5 text-[11px] font-semibold transition-colors active:scale-95 ${
              s === state ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {STATES[s].label}
          </a>
        ))}
        <a
          href={`?variant=${variant}&state=${state}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 active:scale-95 transition-colors"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();

  const rawVariant = params.get("variant");
  const variant: Variant = (["current", "a", "b", "c"] as string[]).includes(rawVariant ?? "")
    ? (rawVariant as Variant)
    : "current";
  const rawState = params.get("state");
  const state: StateSlug = (STATE_ORDER as string[]).includes(rawState ?? "") ? (rawState as StateSlug) : "leads";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-2xl px-4 pt-6 space-y-4">
          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
            Illustrative fixtures, not real balances. Modeled on Kevin&apos;s real Home figures (hero £226, Main G, Kevin Mbithi Maingi) so this is judged against something recognisable, see fixtures.ts.
          </p>

          <ReplicaHero variant={variant} state={state} />
        </div>

        <Switcher variant={variant} state={state} mode={mode} />
      </div>
    </div>
  );
}

export default function SpendFromBankVariantsClient() {
  return <Inner />;
}
