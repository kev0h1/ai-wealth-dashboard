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
//   said they "also make sense" (home, upcoming); everywhere else the owner
//   asked for a specific, curated set instead, so the generic can-I chips
//   would just be noise competing with it.
//
// Two chip kinds (PennyChip below):
// - `ask`: a chip carrying a `chipId` (2026-09-06, Penny usage ring round —
//   see PennyChip's own comment for why this replaced the old
//   `deterministic` boolean) is answered for free through POST /penny/chip
//   (PennyConversation.tsx's `sendChip`) — currently the payday-status path
//   (PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK below), the saving-vs-investing/
//   Lifetime ISA explainers (`planning` entry below) and the four tax
//   explainers (`tax` entry below). A `kind: "llm"` response, or a 404 (the
//   backend hasn't shipped that chip id yet), falls back to the ordinary
//   LLM round-trip below. An `ask` chip with NO `chipId` always goes through
//   that ordinary round-trip (PennyConversation's `send()`), same as typing
//   the question by hand — every domain question (spend/planning/debt) stays
//   in this class even though its headline is engine-derived: the reply is
//   still one LLM phrasing call over that headline.
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
// `/accounts`, `/mirror`, `/transactions`, `/tax`, `/receipts`, `/planning`,
// `/upcoming`, `/cards`. Two surfaces the brief for this feature guessed at
// do NOT exist as routable targets, see the `spend` entry below for what
// replaced them. `/grow` also appeared in this list originally; it's now a
// redirect to `/planning` (Grow folded in, 2026-09-04), not a distinct
// screen any chip below routes to. `/tax`/`/receipts` were `/insights/tax`/
// `/insights/receipts` until the Insights page retired (2026-09-05, see the
// `insights` entry's own comment below) — moved to top-level routes, links
// updated here to match.

import type { PennyAskContext } from "@/components/PennySheetProvider";

export type PennyChip =
  | { kind: "ask"; label: string; q: string; chipId?: string; short?: string }
  | { kind: "link"; label: string; href: string; short?: string };
// `deterministic` — REMOVED (2026-09-06, Penny usage ring round). It was
// only ever an ordering hint ("this chip's reply costs no LLM call, put it
// first") with no other reader anywhere. `chipId` replaces it and does more:
// a chip carrying one is answered through POST /penny/chip
// (PennyConversation.tsx's `sendChip`), which is both the new free-chip
// wiring AND, incidentally, the same "cheap, so lead with it" signal the old
// flag gave the chip-row ordering in PennyConversation.tsx — see that file's
// `chipAnsweredAskChips` filter, which now keys off `!!c.chipId` instead of
// `c.deterministic`. Every chip that used to carry `deterministic: true`
// keeps the same effective priority by carrying a `chipId` instead; a chip
// that never had the flag (the tax explainers, the two Spend "how am I
// doing" reassurance chips) gaining a `chipId` here is a genuine behaviour
// change, not a rename — those now also answer for free and rank alongside
// the old deterministic set. See the report this shipped with for the full
// id list and which screen each lives on.
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
  chipId: "home_payday_status",
  short: "Until payday?",
};
const PAYDAY_DUE_ASK: PennyChip = {
  kind: "ask",
  label: "What's still due before payday?",
  q: "What's still due before payday?",
  chipId: "home_payday_due",
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
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      // Savings/investing questions moved over from the old `grow` entry
      // when Grow folded into Planning (2026-09-04) — these are general
      // mechanics, not a verdict on the user's own transactions, so
      // they're answered without an LLM call. `deterministic: true`
      // documents that, same as the payday chips above.
      { kind: "ask", label: "Saving vs investing, how does it work?", q: "Saving vs investing, how does it work?", chipId: "planning_saving_vs_investing", short: "Saving vs investing?" },
      { kind: "ask", label: "What is a Lifetime ISA?", q: "What is a Lifetime ISA?", chipId: "planning_lifetime_isa" },
      { kind: "link", label: "Cards and debt", href: "/cards" },
      { kind: "link", label: "This pay period", href: "/upcoming" },
    ],
    personalisedChips: false,
  },
  upcoming: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [PAYDAY_STATUS_ASK, PAYDAY_DUE_ASK],
    personalisedChips: true,
  },
  spend: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      { kind: "ask", label: "Where did my money go this month?", q: "Where did my money go this month?", chipId: "spend_where_money_went", short: "Where'd it go?" },
      { kind: "ask", label: "Am I spending more than usual?", q: "Am I spending more than usual?", chipId: "spend_more_than_usual", short: "Spending more?" },
      // Fixed, backend-answered explainer (2026-08-26) — same class as
      // PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK above and the `planning` entry's
      // saving-vs-investing chip above: general mechanics, not a verdict on
      // the user's own transactions, so it's answered without an LLM call.
      { kind: "ask", label: "How do categories work?", q: "How do categories work?", chipId: "spend_how_categories_work" },
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
      { kind: "ask", label: "How does pension carry-forward work?", q: "How does pension carry-forward work?", chipId: "tax_pension_carry_forward", short: "Carry-forward?" },
      { kind: "ask", label: "What counts as salary sacrifice?", q: "What counts as salary sacrifice?", chipId: "tax_salary_sacrifice", short: "Salary sacrifice?" },
      { kind: "ask", label: "Do I need to register for self-assessment?", q: "Do I need to register for self-assessment?", chipId: "tax_self_assessment", short: "Self-assessment?" },
      { kind: "ask", label: "How does Gift Aid reduce my tax?", q: "How does Gift Aid reduce my tax?", chipId: "tax_gift_aid", short: "Gift Aid?" },
      // "What is the Marriage Allowance?" chip added then removed same day
      // (2026-08-27, back to the established 4-chip comfortable max): the
      // four explainers above are personalised to the user's own tax
      // position, which outranks a generic explainer, and the topic stays
      // fully reachable through Penny's `explain` tool (the
      // `marriage-allowance` key still exists) by just asking.
    ],
    personalisedChips: false,
  },
  // The Insights page itself retired 2026-09-05 (/insights is now a client
  // redirect to /spend/shape or /tax that never opens this sheet from a
  // real route — see BottomNav.tsx's screenForPathname, which no longer
  // produces "insights" either). This entry, and the "insights" member of
  // `PennyAskContext["screen"]` it depends on, are kept anyway: the standing
  // design twin at app/design/insights-live/InsightsLiveClient.tsx still
  // calls `openPennySheet({ screen: "insights", ... })`, and
  // PennyConversation.tsx's `newBuckets()` requires a bucket for every
  // union member. Removing "insights" would break that twin's typecheck for
  // no live-route benefit, so it stays, unreachable from a real screen but
  // still real for the twin — same "keep it real dead code" call as the
  // `grow` entry below.
  insights: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      PAYDAY_DUE_ASK,
      { kind: "link", label: "Tax", href: "/tax" },
      { kind: "link", label: "Receipts", href: "/receipts" },
    ],
    personalisedChips: false,
  },
  // Kept 2026-09-04 (route now redirects to /planning): Grow folded into
  // Planning, so this key can never actually be reached any more (/grow's
  // page is a client redirect that never opens Penny), but "grow" stays in
  // PennyAskContext["screen"] because PennyConversation.tsx's newBuckets()
  // needs a bucket for every union member — see that union's own comment
  // for the fuller cascade explanation. This entry itself is left as it
  // was before the fold rather than deleted, so it stays a faithful record
  // of what the (now unreachable) Grow screen used to show; its two ask
  // chips were separately copied onto the `planning` entry above, which is
  // the one real callers hit.
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
      { kind: "ask", label: "Am I saving enough?", q: "Am I saving enough?", chipId: "grow_saving_enough", short: "Saving enough?" },
      // Owner decision, 2026-08-25: "Should I be investing instead of
      // saving?" invited a personal investment recommendation, the actual
      // FCA perimeter — relabelled to a general-mechanics question and
      // routed backend-side (can_i.py's _is_saving_vs_investing_question)
      // to a FIXED, general-information explainer, never the LLM. Same
      // question as the `planning` entry's own copy above (this entry is
      // unreachable dead code, see this block's own header comment) — left
      // without a `chipId` here since nothing can ever tap it; the live
      // `planning` entry above carries `chipId: "planning_saving_vs_investing"`.
      { kind: "ask", label: "Saving vs investing, how does it work?", q: "Saving vs investing, how does it work?", short: "Saving vs investing?" },
      { kind: "ask", label: "What is a Lifetime ISA?", q: "What is a Lifetime ISA?" },
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
      // Not a link back to /debt-plan itself (redundant, chip would fire
      // while already on that screen) — Planning is the umbrella page it's
      // reached from (LongTermPlanningPage.tsx's DebtPosition section, an
      // inline `onOpen` prop rather than a named handler these days).
      { kind: "link", label: "Your plan", href: "/planning" },
    ],
    personalisedChips: false,
  },
  // Not yet reachable — see `ConfigScreenKey`'s own comment above. Added
  // 2026-08-26 for the accounts redesign's Penny entry point.
  accounts: {
    headerLinks: DEFAULT_HEADER_LINKS,
    chips: [
      // Fixed, backend-answered explainer, same class as
      // PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK above. No `chipId` (not one of the
      // ids the 2026-09-06 usage-ring round contracted for) — still an
      // ordinary LLM ask chip until a matching backend chip id exists.
      { kind: "ask", label: "How do I add an ISA?", q: "How do I add an ISA?" },
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
