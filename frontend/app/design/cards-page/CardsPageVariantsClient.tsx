"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// G10 round 2: the earlier round (/design/cards-outlook) showed only the
// proposed "where each card is headed" section against a 3-card fixture.
// Kevin viewed his real /cards page and asked to see the WHOLE page with
// the variants in place — his real page has seven cards and Variants A/B
// repeat that whole list a second time, which the old fixture hid. His
// card names are also raw bank descriptors with a duplicate ("MASTERCARD"
// twice), which the old fixture didn't carry either. This preview fixes
// both: the full five-section replica (see ReplicaSections.tsx) plus
// three variants of the new content, and a names=raw|clean toggle that
// makes the duplicate-name ambiguity visible in every variant by default.
//
//   /design/cards-page?variant=a|b|c&names=raw|clean&mode=light|dark
//
// Variant summary:
//   A — new section, ledger rows: ordinary account-row grammar (badge,
//       name, rate pill, pace + clear month), matching WHERE IT MOVED's
//       own layout.
//   B — new section, timeline: same lead line, a 24-month rail with a dot
//       per carried card at its clear month and hollow promo-end ticks,
//       then the same compact list underneath for accessibility.
//   C — no new section: each WHERE IT MOVED row gains one subline under
//       "£X owed" (a promo end, a plain clear month, or "clears in full
//       each month"), and the lead line sits on its own below THE
//       TRAJECTORY with no panel around it. This is the option that makes
//       the page shorter, not longer.
//
// Review notes (independent pass against DESIGN.md's named rules and the
// Web Interface Guidelines, before this went to Kevin):
//   - Copy: no em dashes anywhere in this route's user-facing strings —
//     checked fixtures.ts, shared.tsx, ReplicaSections.tsx and all three
//     variant files; this comment block and code comments are allowed em
//     dashes (not user-facing), everything rendered to the page is not.
//   - Copy: the lead line is a projection, not a promise ("would clear",
//     shared.tsx's leadLine()), matching the no-conviction-on-predictions
//     doctrine — carried over unchanged from cards-outlook's own lead
//     line, which already passed this check.
//   - Colour: The Red Is Risk Rule — red is never used by any of the new
//     content; the pre-existing rose "owed" caption in WHERE IT MOVED is
//     verbatim CardsPage.tsx, not new. Amber appears only on the one card
//     genuinely being charged interest (fx-natwest-1, 27.9%, £168 charged
//     last cycle) — its rate pill in A/B, its rail dot in B, and its
//     subline in C. Every other carried card (including the promo card)
//     stays neutral slate even though it carries debt. Fixed during this
//     pass: an early draft of cRowSubline() in shared.tsx defaulted every
//     card without a payoffMonth to amber "no clear date yet"; only the
//     NatWest Mastercard actually paying interest should read amber, so
//     the amber flag is now keyed off outlook.payingInterest specifically,
//     not off the absence of a clear date.
//   - Colour: the indigo dots on Variant B's rail are the brand's ordinary
//     solid Adviser Indigo voice (buttons, focus rings, nav), not the
//     indigo→violet gradient — the Penny Gradient Rule restricts the
//     gradient, not the solid brand colour, and this exact pattern already
//     shipped unchanged in cards-outlook/VariantB.tsx.
//   - Names toggle: names=clean is a display-only proposal (CARD_META in
//     fixtures.ts), no backend change. Shouty ALL-CAPS descriptors are
//     title-cased ("IBCM PLATINUM" → "IBCM Platinum", "SMITH,JOHN A/MR" →
//     "Smith, John A"), and the two identically-named NatWest "MASTERCARD"
//     cards get "NatWest Mastercard 4821" / "NatWest Mastercard 0219"
//     (last 4 digits preferred over a bare "(2)" suffix per the brief).
//     names=raw (the default) shows exactly what the live page shows
//     today, so the ambiguity between the two Mastercards is visible in
//     every variant, not hidden by this proposal.
//   - Hit sizes: every switcher pill is min-h-[44px], matching every other
//     /design/* preview's switcher.
//   - Contrast: amber pill/subline pairing (bg-amber-50/text-amber-600
//     light, bg-amber-500/15/text-amber-400 dark) is the same pairing
//     already shipped on Spend's pace badge and reused unchanged from
//     cards-outlook — not a new pair introduced by this round.
//   - Money is mono: every new £ figure routes through MoneyText or
//     carries `money`/`font-mono tabular-nums` directly, matching
//     CardsPage.tsx's own convention.
//   - Font sizes: the impeccable design hook flagged the text-[10px] rate
//     pill and text-[11px] captions/sublines across ReplicaSections.tsx
//     and both variants as off the documented type ramp. These are
//     verbatim matches to CardsPage.tsx's own already-shipped APR pill
//     (text-[10px]) and balance caption (text-[11px]) — the same
//     pre-existing gap cards-outlook's review already flagged and left
//     alone as out of scope for a proposal that doesn't touch the live
//     page. Left as-is here for the same reason; a documented type-ramp
//     fix is a separate follow-up against CardsPage.tsx itself.
//   - Layout: screenshotted Variant B's rail at 390px — the inset
//     percentage mapping carried over from cards-outlook/VariantB.tsx
//     (pctFor(), 4% inset) keeps every tick, label and dot inside the
//     card at this width, same fix already proven there.
//   - Layout: Variant C's per-row subline sits directly under the
//     existing balance caption inside the same right-hand column
//     (ReplicaSections.tsx), so it never disturbs the row's badge/name
//     alignment; checked at 390px against all seven rows including the
//     two cleared-monthly cards and the zero-movement cards.
//   - Motion: none added; no rise-in/stagger on this route (matches the
//     no-visibility-gating-animations rule — content is visible
//     immediately, not cascaded in on load).
//   - Dark mode: every new string carries dark: pairs; verified via the
//     mode=dark screenshots listed in the report.
//   - The impeccable design hook flagged the top caption and the static
//     "Back" row (text-slate-400/500 on bg-[#f0f2f7]/dark:bg-[#0f172a]) as
//     "gray text on colored background". False positive: the page
//     background here is the same near-white/near-black canvas as every
//     other screen, not a saturated colour, and this is the exact
//     slate-400/500-on-canvas pairing CardsPage.tsx's own back button and
//     Whisper labels already use — not a new pairing introduced by this
//     preview.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import MoneyText from "@/components/MoneyText";
import ReplicaSections from "./ReplicaSections";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import { EXTRA_PER_MONTH, DEBT_FREE_MONTH } from "./fixtures";
import { leadLine } from "./shared";

type Variant = "a" | "b" | "c";
type NamesMode = "raw" | "clean";
type Mode = "light" | "dark";

const VARIANTS: Variant[] = ["a", "b", "c"];
const NAMES: NamesMode[] = ["raw", "clean"];

function Switcher({ variant, names, mode }: { variant: Variant; names: NamesMode; mode: Mode }) {
  return (
    <div
      id="g10p-switcher"
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl max-w-[92vw]">
        {VARIANTS.map((v) => (
          <a
            key={v}
            href={`?variant=${v}&names=${names}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.toUpperCase()}
          </a>
        ))}
        {NAMES.map((n) => (
          <a
            key={n}
            href={`?variant=${variant}&names=${n}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              n === names ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {n === "raw" ? "Raw" : "Clean"}
          </a>
        ))}
        <a
          href={`?variant=${variant}&names=${names}&mode=${mode === "dark" ? "light" : "dark"}`}
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
  const { colours } = useColours();

  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as string[]).includes(rawVariant ?? "") ? (rawVariant as Variant) : "a";
  const rawNames = params.get("names");
  const names: NamesMode = (NAMES as string[]).includes(rawNames ?? "") ? (rawNames as NamesMode) : "raw";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const lead = leadLine(EXTRA_PER_MONTH, DEBT_FREE_MONTH);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-32">
        <div className="mx-auto w-full max-w-2xl px-4 pt-6 space-y-8">
          {/* Illustrative-data caption — required at the very top so this
              is never mistaken for live data. */}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
            Illustrative figures, not real balances.
          </p>

          {/* Back nav — static, this is a preview, not real navigation */}
          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 -mt-4">
            <ChevronLeft size={15} />
            Back
          </div>

          <ReplicaSections
            namesMode={names}
            colours={colours}
            categoryColour={getCategoryColour}
            showSublines={variant === "c"}
          />

          {variant === "a" && <VariantA namesMode={names} />}
          {variant === "b" && <VariantB namesMode={names} />}
          {variant === "c" && lead && (
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-snug -mt-4">
              <MoneyText text={lead} />
            </p>
          )}
        </div>

        <Switcher variant={variant} names={names} mode={mode} />
      </div>
    </div>
  );
}

export default function CardsPageVariantsClient() {
  return <Inner />;
}
