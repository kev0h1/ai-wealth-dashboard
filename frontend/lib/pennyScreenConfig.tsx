// Per-screen configuration for the Penny sheet's header links and chip row.
// See PennySheetProvider.tsx's PennyAskContext.screen (what screen opened
// the sheet) and BottomNav.tsx's screenForPathname (how the nav derives it
// from the current route). Two things vary by screen, both defined here so
// PennySheet.tsx (header) and PennyConversation.tsx (chips) don't hardcode
// per-screen copy inline:
//
// - `headerLinks`: the quiet link row under the sheet's title. Every screen
//   falls back to DEFAULT_HEADER_LINKS (today's single "Your plan and
//   updates" row) unless it has something more useful to offer — currently
//   only Home does (owner: the accounts/mirror doors "also make sense" from
//   inside the sheet). Capped at 3 by convention; PennySheet.tsx truncates
//   rather than wraps.
// - `chips`: what shows in the chip row above the composer, alongside (or
//   instead of) the personalised `canISuggestions` £-chips
//   PennyConversation already fetches app-wide. `personalisedChips` decides
//   whether those still show for THIS screen — true only where the owner
//   said they "also make sense" (home, planning); everywhere else the owner
//   asked for a specific, curated set instead, so the generic can-I chips
//   would just be noise competing with it.
//
// Two chip kinds (PennyChip below):
// - `ask`: submits `q` through PennyConversation's existing `send()`, same
//   LLM round-trip as typing the question by hand. `deterministic: true`
//   documents (informational only, no UI difference yet) that the backend
//   answers this WITHOUT an LLM call — currently the greeting path, the
//   payday-status path (PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK below), and the
//   saving-vs-investing explainer (`grow` entry below). Domain
//   questions (spend/planning/debt/grow) are NOT deterministic even though
//   their headline is engine-derived: the reply is still one LLM phrasing
//   call over that headline.
// - `link`: pure client-side navigation, zero LLM, zero network — the
//   owner's "deterministic where possible" made literal for the cases that
//   don't need Penny's judgement at all, just a door to where the answer
//   already lives.
//
// `label` and `q` are kept equal on every `ask` chip below by convention.
// PennyConversation's asked/dismissed bookkeeping for these chips matches
// against `q` (what actually gets sent, not what's displayed) — if a future
// chip needs a shorter button label than its full question, that's fine,
// just remember the two are no longer interchangeable for that matching.
//
// Route survey behind the `link` chips and headerLinks below (2026-08-25,
// `find app -name page.tsx`): confirmed real, routable pages used here are
// `/accounts`, `/mirror`, `/transactions`, `/insights/tax`,
// `/insights/receipts`, `/planning`, `/grow`, `/debt-plan`. Two surfaces the
// brief for this feature guessed at do NOT exist as routable targets, see
// the `spend` entry below for what replaced them.

import type { PennyAskContext } from "@/components/PennySheetProvider";

export type PennyChip =
  | { kind: "ask"; label: string; q: string; deterministic?: boolean; short?: string }
  | { kind: "link"; label: string; href: string; short?: string };
// `short` — DEPRECATED, no longer read anywhere (2026-08-25, REVERTED: the
// compact chip-row label added the same day for "a horizontally scrollable
// row at the top ... summarised"). Owner screenshot found the actual bug
// this shipped: the row showed "Still due?" right next to "What's still
// due before payday?", the SAME question twice — once via a config chip's
// `short` and once via a personalised suggestion whose full label rendered
// untransformed, since summarising also strips meaning a short label like
// "Still due?" isn't parseable on its own once separated from its chip.
// PennyConversation.tsx's sheet-mode chip row now always renders `label`/
// `q` in full (the row scrolls horizontally precisely so length is fine)
// and no longer reads this field at all. Left in the type and on every
// existing entry below rather than stripped out — the render change is the
// decision that matters here, not a mechanical field removal across every
// chip in this file — but treat it as dead: do not add `short` to a new
// chip, and do not resurrect the old `c.short ?? c.label` read without
// re-litigating this owner call first.

export type PennyHeaderLink = { label: string; href: string };

export type ScreenConfig = {
  headerLinks: PennyHeaderLink[];
  chips: PennyChip[];
  /** Whether PennyConversation's personalised `canISuggestions` £-chips
   * still render for this screen, ahead of `chips` above — see this file's
   * header comment. */
  personalisedChips: boolean;
};

/** Today's single header link, unchanged — every screen without a more
 * specific row below falls back to this (PennySheet.tsx's original,
 * pre-config behaviour). */
const DEFAULT_HEADER_LINKS: PennyHeaderLink[] = [
  { label: "Your plan and updates", href: "/penny" },
];

/** The two backend-deterministic payday questions (see this file's header
 * comment) — defined once so Home/Planning/Insights don't each retype the
 * exact question string the backend's tier-1 checks key off. */
const PAYDAY_STATUS_ASK: PennyChip = {
  kind: "ask",
  label: "How am I doing until payday?",
  q: "How am I doing until payday?",
  deterministic: true,
  short: "Until payday?",
};
const PAYDAY_DUE_ASK: PennyChip = {
  kind: "ask",
  label: "What's still due before payday?",
  q: "What's still due before payday?",
  deterministic: true,
  short: "Still due?",
};

// "accounts" isn't yet a member of `PennyAskContext["screen"]`
// (PennySheetProvider.tsx's own union — this feature's owning file, out of
// scope for this change; see the report this shipped with for the
// one-line addition it needs) — added here as a LOCAL, forward-compatible
// widening rather than blocked on that edit landing first. A strict
// SUPERSET of `PennyAskContext["screen"]` (keeps "other" and every real
// screen, adds "accounts"), not a replacement for it, so every existing
// caller passing a real `PennyAskContext["screen"] | undefined` still
// type-checks unchanged. `getPennyScreenConfig` below accepts this wider
// type, so the moment the provider's union gains "accounts" (and
// BottomNav.tsx's screenForPathname can start returning it), the
// `accounts` entry below is already live with zero further changes here.
// Until then this key is simply unreachable — no real
// `PennyAskContext["screen"]` value can ever equal "accounts" — so it
// costs nothing to have ready.
type ConfigScreenKey = PennyAskContext["screen"] | "accounts";

const CONFIGS: Record<Exclude<ConfigScreenKey, "other">, ScreenConfig> = {
  home: {
    headerLinks: [
      { label: "Your plan and updates", href: "/penny" },
      { label: "Your accounts", href: "/accounts" },
      { label: "Mirror", href: "/mirror" },
    ],
    // Owner: the can-I £-chips "also make sense on the home page" — kept,
    // personalised chips lead, this deterministic one is appended after.
    chips: [PAYDAY_STATUS_ASK],
    personalisedChips: true,
  },
  planning: {
    // Unchanged header — plain default. Planning USED to have its own
    // PennyPromptBar above the fold, which was the original reason this
    // stayed default rather than growing a Planning-specific header row;
    // that bar is retired now (PlanningPage.tsx's header comment on
    // PennyPromptBar's removal, 2026-08-25) but the header still has
    // nothing more useful to offer here than the one default link, so this
    // stays as-is.
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [PAYDAY_STATUS_ASK, PAYDAY_DUE_ASK],
    personalisedChips: true,
  },
  spend: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      { kind: "ask", label: "Where did my money go this month?", q: "Where did my money go this month?", short: "Where'd it go?" },
      { kind: "ask", label: "Am I spending more than usual?", q: "Am I spending more than usual?", short: "Spending more?" },
      // Fixed, backend-deterministic explainer (2026-08-26) — same class as
      // PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK above and the `grow` entry's
      // saving-vs-investing chip below: general mechanics, not a verdict on
      // the user's own transactions, so it's answered without an LLM call.
      { kind: "ask", label: "How do categories work?", q: "How do categories work?", deterministic: true },
      // Was a blunt "Fix a category" link straight to /transactions — the
      // owner's actual complaint (his screenshot: the Spend page's own "N
      // transfers to review" banner opens a same-transfer-pairs review
      // sheet with Penny-attributed reasons and confirm/reject, but this
      // chip skipped straight past it to the raw all-transactions list).
      // MiscategorisedReviewSheet is SpendPage's own component state with no
      // route of its own, so this now points at /spend?review=1:
      // SpendPage.tsx's own ?review= effect opens that exact sheet once its
      // candidate counts have loaded, and — if there's genuinely nothing to
      // review right now — self-falls-back to router.replace("/transactions")
      // so this chip still lands somewhere useful either way.
      { kind: "link", label: "Review transfers", href: "/spend?review=1" },
    ],
    personalisedChips: false,
  },
  tax: {
    headerLinks: DEFAULT_HEADER_LINKS,
    // TaxPennyEntry.tsx's QUICK array, carried over verbatim so the same
    // four prompts are reachable as chips inside an already-open sheet, not
    // only from that page's own row. LLM explainers (ExplainerBubble), not
    // deterministic.
    chips: [
      { kind: "ask", label: "How does pension carry-forward work?", q: "How does pension carry-forward work?", short: "Carry-forward?" },
      { kind: "ask", label: "What counts as salary sacrifice?", q: "What counts as salary sacrifice?", short: "Salary sacrifice?" },
      { kind: "ask", label: "Do I need to register for self-assessment?", q: "Do I need to register for self-assessment?", short: "Self-assessment?" },
      { kind: "ask", label: "How does Gift Aid reduce my tax?", q: "How does Gift Aid reduce my tax?", short: "Gift Aid?" },
      // "What is the Marriage Allowance?" chip added then removed same day
      // (2026-08-27, back to the established 4-chip comfortable max): the
      // four explainers above are personalised to the user's own tax
      // position, which outranks a generic explainer, and the topic stays
      // fully reachable through Penny's `explain` tool (the
      // `marriage-allowance` key still exists) by just asking.
    ],
    personalisedChips: false,
  },
  insights: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      PAYDAY_DUE_ASK,
      { kind: "link", label: "Tax", href: "/insights/tax" },
      { kind: "link", label: "Receipts", href: "/insights/receipts" },
    ],
    personalisedChips: false,
  },
  grow: {
    headerLinks: DEFAULT_HEADER_LINKS,
    // Savings/investing questions, not debt ones — see this file's route
    // survey note in the report this shipped with: the brief that specified
    // this feature paired debt-domain example questions ("How am I doing on
    // my debt?"/"When will my card be clear?") with the GROW screen, which
    // reads like a copy/paste mix-up given /debt-plan turned out to be a
    // real, separate route. Those two questions live on the `debt` entry
    // below instead; Grow gets its own domain's questions.
    chips: [
      { kind: "ask", label: "Am I saving enough?", q: "Am I saving enough?", short: "Saving enough?" },
      // Owner decision, 2026-08-25: "Should I be investing instead of
      // saving?" invited a personal investment recommendation, the actual
      // FCA perimeter — relabelled to a general-mechanics question and
      // routed backend-side (can_i.py's _is_saving_vs_investing_question)
      // to a FIXED, deterministic, general-information explainer, never the
      // LLM. `deterministic: true` documents that, same as the payday chips
      // above.
      { kind: "ask", label: "Saving vs investing, how does it work?", q: "Saving vs investing, how does it work?", deterministic: true, short: "Saving vs investing?" },
      // Money-basics retirement (2026-08-27): the rotating "Money basics"
      // Home card is gone, its 16 curated explainers now ground Penny's
      // `explain` tool instead (backend/app/services/penny_tools.py's
      // `_BASICS_COPY`, built from app/content/money_basics.py). These two
      // map straight to that registry's `lisa`/`cash-vs-ss-isa` keys — same
      // deterministic, no-verdict-on-your-own-data class as the
      // saving-vs-investing chip above.
      { kind: "ask", label: "What is a Lifetime ISA?", q: "What is a Lifetime ISA?", deterministic: true },
      // "Cash ISA or Stocks and Shares ISA?" chip removed (2026-08-27, back
      // to the established 4-chip comfortable max) — the saving-vs-investing
      // explainer chip above already covers adjacent ground, and the topic
      // stays fully reachable through Penny's `explain` tool (the
      // `cash-vs-ss-isa` key still exists) by just asking.
      // Not a link back to /grow itself (redundant, chip would fire while
      // already on that screen) — Planning is the umbrella page Grow is
      // actually reached from (PlanningPage.tsx's onGrowTap).
      { kind: "link", label: "Your plan", href: "/planning" },
    ],
    personalisedChips: false,
  },
  debt: {
    headerLinks: DEFAULT_HEADER_LINKS,
    // Debt has its own route after all (/debt-plan, DebtPlanPage.tsx) —
    // the brief for this feature assumed it might not; see this file's
    // header comment / the shipping report for the route survey that found
    // it. Mapped from screenForPathname in BottomNav.tsx.
    chips: [
      { kind: "ask", label: "How am I doing on my debt?", q: "How am I doing on my debt?", short: "Debt check" },
      { kind: "ask", label: "When will my card be clear?", q: "When will my card be clear?", short: "Card clear when?" },
      // Same reasoning as `grow` above: not a link back to /debt-plan
      // itself (redundant), Planning is the umbrella page it's reached
      // from (PlanningPage.tsx's onDebtTap).
      { kind: "link", label: "Your plan", href: "/planning" },
    ],
    personalisedChips: false,
  },
  // Not yet reachable — see `ConfigScreenKey`'s own comment above. Added
  // 2026-08-26 for the accounts redesign's Penny entry point.
  accounts: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      // Fixed, backend-deterministic explainer, same class as
      // PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK above.
      { kind: "ask", label: "How do I add an ISA?", q: "How do I add an ISA?", deterministic: true },
      // No "Your accounts" link chip here — the user is already ON that
      // page, so it would be a link back to itself. Mirror is the sensible
      // next door instead (same choice Home's header row makes).
      { kind: "link", label: "Mirror", href: "/mirror" },
    ],
    personalisedChips: false,
  },
};

/** "other"/no-screen fallback — preserves today's actual behaviour exactly:
 * canISuggestions chips were the only chip source PennyConversation ever
 * showed, unconditionally, on every screen, with the one default header
 * link. */
const OTHER_CONFIG: ScreenConfig = {
  headerLinks: DEFAULT_HEADER_LINKS,
  chips: [],
  personalisedChips: true,
};

/** Single lookup PennySheet.tsx and PennyConversation.tsx both call.
 * `screen` is optional only for defensive typing against `ctx` being
 * `undefined` (PennySheetProvider's initial state before any `open()` call)
 * — every real call site already passes a `screen` (see PennyAskContext).
 * Accepts `ConfigScreenKey` (i.e. also "accounts") rather than just
 * `PennyAskContext["screen"]` — every actual caller today only ever HAS a
 * real `PennyAskContext["screen"]` to pass (a subtype), so this widening is
 * forward-compatible and changes nothing for them; it just means this
 * function doesn't need editing again once "accounts" becomes a real,
 * producible screen value (see `ConfigScreenKey`'s own comment). */
export function getPennyScreenConfig(screen: ConfigScreenKey | undefined): ScreenConfig {
  if (!screen || screen === "other") return OTHER_CONFIG;
  return CONFIGS[screen];
}
