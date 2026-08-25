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
// `short` (2026-08-25, owner: chips become "a horizontally scrollable row
// at the top ... summarised"): the compact label shown in the sheet's new
// scrollable chip row (PennyConversation.tsx's top row, sheet mode only).
// `label`/`q` stay the full question text — `short` is purely a display
// affordance, never what gets sent or matched against `askedLabels`/
// `dismissedChips` (those still key off `q`, see this file's header
// comment). Optional: every `link` chip's `label` here is already short
// ("Tax", "Receipts", "Your plan", "Fix a category"), so those fall back to
// `label` unshortened (PennyConversation.tsx does `c.short ?? c.label`)
// rather than adding a redundant field with the same value.

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

const CONFIGS: Record<Exclude<PennyAskContext["screen"], "other">, ScreenConfig> = {
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
      // /transactions is the real, routable categorisation surface. The two
      // targets this feature's brief guessed at don't qualify: the
      // Categories tab under Spend is retired (SpendPage.tsx's own comment:
      // "the old three-way Categories/Transactions/Trends tabs are
      // retired"), and the miscategorised-transfers review sheet has no
      // route or query param of its own, it's local `reviewOpen` state on
      // SpendPage opened only from that page's own in-page banner.
      // /transactions ("the global transactions hub", per its own header
      // comment) is where category correction actually lives app-wide,
      // reached through TeachingSheet same as every other recategorise
      // flow, so it's the honest "more on how to categorise" door.
      { kind: "link", label: "Fix a category", href: "/transactions" },
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
 * — every real call site already passes a `screen` (see PennyAskContext). */
export function getPennyScreenConfig(screen: PennyAskContext["screen"] | undefined): ScreenConfig {
  if (!screen || screen === "other") return OTHER_CONFIG;
  return CONFIGS[screen];
}
