// TEMPORARY PREVIEW INDEX — delete with the preview routes
//
// Static index of the active /design/* preview routes so the owner can
// bookmark one URL on his phone instead of the individual previews.
// No data fetching, no client state — plain links only.
//
// Keep this current for every new preview: every directory under
// app/design/*/page.tsx needs an entry here, and every slug listed here
// needs a matching directory. `npm run check:design-index`
// (scripts/check-design-index.mjs) enforces that and runs as part of
// `scripts/session.sh finish`.

import type { Metadata } from "next";
import Link from "next/link";

// A76 (DSGN-04, A48 pentest): these preview routes are unreleased product
// directions and must not be indexed by search engines. See also the
// X-Robots-Tag header in next.config.ts and app/robots.ts, which cover the
// whole /design/* subtree (this metadata only covers this one page).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type PreviewRoute = {
  slug: string;
  name: string;
  description: string;
  states: { label: string; value: string }[];
  variants?: { label: string; value: string }[];
  group?: "current" | "earlier";
};

const ROUTES: PreviewRoute[] = [
  {
    slug: "spend-tips",
    name: "spend-tips",
    description:
      "Spend tips integration round (owner brief 2026-09-04: 'Penny noticed' rows wedged under category rows break the list grammar, truncate the fact and contradict 'Looking normal'; corrected 2026-09-05: a category tap routes to the transactions page, not a sheet) · A tip count + estimate folded into the category subline, tip waits behind a one-line row under the filter chips on the transactions page, above the payments / B one 'Ways to save' card under the list with a reconciled total and a door to Patterns / C both · real InsightCard over the owner's live tips · ?variant=a|b|c&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "marketing-kit",
    name: "Sorted marketing kit · C22",
    description: "C Real life retained; D Payday path now gathers real payment cards from different accounts outside the phone; E Money movement replaces Penny bubbles with a suggested transfer route. Generated 3D scenes and production components. Sorted suggests, the user transfers with their bank. Creative review, not approved advertising.",
    states: [{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }],
    variants: [{ label: "C · Real life", value: "c" }, { label: "D · Payday path", value: "d" }, { label: "E · Money movement", value: "e" }],
    group: "current",
  },
  {
    slug: "accounts-header",
    name: "Accounts header, eye and Add · G236",
    description:
      "G236, skill: impeccable, directions drafted with openai/gpt-6-astra and rewritten to DESIGN.md · Three points only: the eye toggle, the header balance and a one-handed Add · Today renders the production header (extracted unchanged) and shows the defect: the eye leaves the account rows unmasked · A Verdict header, Net worth as the one Display figure, no eye, a 56px floating Add · B Quiet header, Net worth as a Caption line, no eye, a full-width Add row at the top of the list · C Toolbar, no eye, the group filter and Add in a bar above the nav · A Balances hidden chip replaces the eye, and a proposed Settings switch holds the one global control · Invented accounts · ?variant=today|a|b|c&accounts=6|20&balances=shown|hidden&mode=light|dark&menu=open",
    states: [
      { label: "6 accounts", value: "6" },
      { label: "20 accounts", value: "20" },
    ],
    variants: [
      { label: "A · Verdict header", value: "a" },
      { label: "B · Quiet header", value: "b" },
      { label: "C · Toolbar", value: "c" },
      { label: "Today", value: "today" },
    ],
    group: "current",
  },
  {
    slug: "bank-consent-journeys",
    name: "Bank connection journeys · A155 · approved G",
    description: "Approved G renders the production BankConnectionFlow with fixture banks and inert operations. The search is fixed below the header, outside the scrolling results. Full unchanged notice before Continue to Finexer. H and I are earlier alternatives, not production; I still needs Finexer approval. No live connection starts.",
    states: [{ label: "Start", value: "start" }, { label: "No results", value: "noresults" }, { label: "Handoff problem", value: "error" }, { label: "Load problem (G)", value: "load-error" }, { label: "Loading (G)", value: "loading" }, { label: "Empty list (G)", value: "empty" }, { label: "Opening Finexer (G)", value: "pending" }],
    variants: [{ label: "G · Bank first", value: "g" }, { label: "H · One continuous page", value: "h" }, { label: "I · Notice at consent", value: "i" }],
  },
  {
    slug: "upcoming-by-account",
    name: "Upcoming By account, attention first · G229",
    description:
      "G229, skill: impeccable · Alignment, not a variant round: the By account card on Upcoming now leads with accounts that need attention (short for payments, then short for plans, then ones to watch) and folds the rest behind one quiet row such as 3 accounts are fine, using the same grid-template-rows fold as Planning's rungs · An honest all-clear line when nothing needs attention · Renders the production card with invented accounts · ?fixture=long|watch|clear|all&mode=light|dark",
    states: [
      { label: "Long list, 2 need attention", value: "long" },
      { label: "One to watch, 5 fine", value: "watch" },
      { label: "All clear", value: "clear" },
      { label: "Every account short", value: "all" },
    ],
  },
  {
    slug: "plan-deferral",
    name: "Ease a goal plan for one period · G228 · shipped look",
    description:
      "G228 (Kevin picked A, 2026-10-07): the production Goal plan card and easing sheet rendered through real props with fixture figures · when cash is short and no safe move covers it, ease a plan for this period only, keeping the date or keeping the amount, with the engine's own figures (rounded up to £5) · no undo, reverting is editing the plan on Planning · set-asides and plans never trade cash · states: eligible (open the sheet), capped, deferred (the one-line result)",
    states: [{ label: "Eligible", value: "eligible" }, { label: "Capped", value: "capped" }, { label: "Deferred", value: "deferred" }],
  },
  {
    slug: "finexer-consent-intro",
    name: "Finexer consent page intro block · G226 · shipped look (A canvas)",
    description:
      "G226 + A151: Approved A, folded in, with the template name AURIQ LTD (Finexer substitutes it into its headline and footer) and a line naming Finexer Ltd as the provider. The shipped Sorted intro (eyebrow, one sentence, Finexer line, hairline) at the top of the Finexer-hosted consent page, rendered from the live header.html and sorted*.css inside a MOCK of Finexer's page built from Kevin's Android screenshots (not a production component) · light and dark · dim headings are Finexer's styling pending A147's effect",
    states: [
      { label: "Dark", value: "dark" },
      { label: "Light", value: "light" },
    ],
  },
  {
    slug: "ai-intro-reel",
    name: "AI live-action stories around the reel · G224 · Café and Night out (Veo 3.1 Fast)",
    description:
      "G224: two AI-generated live-action stories around the untouched G223 reel · CAFÉ an 8 second intro, a woman walks into a café and the camera pushes into her phone (no audio) · NIGHT OUT a 20 second intro and outro, friends invite a man out, he says wait a sec, the phone plays the reel, then he runs to them smiling (with audio) · switch between the two at the top · muted autoplay, loops, controls to unmute · the people are AI-generated and must be labelled as AI on TikTok and Meta",
    states: [{ label: "Play", value: "play" }],
  },
  {
    slug: "reel-safe-to-spend",
    name: "First Sorted reel, Safe to Spend · G223 · 15s vertical video (Remotion)",
    description:
      "G223: a 15 second, 1080x1920 vertical reel for TikTok, Reels and Stories, built in Remotion from the G222 Safe-to-Spend ad, a capabilities proof of concept · plays here muted and looping with controls, fitted to the screen · HOOK \"It\u2019s the 20th. What can you actually spend?\" · MESS the late-month maths tumbling in to a big ? · ANSWER a phone slides up with the production SafeToSpendCard through its real props and the figure counts up to \u00a3184 · PROOF a highlight over \"estimated\" and \"after bills, plans and your \u00a3100 buffer\" · END CARD icon, wordmark, \"Know what you can spend before payday.\", Get Sorted · burned-in captions, TikTok safe zones kept clear, no audio (music added later in CapCut) · fictional persona, emerald figure, indigo CTA, no gradient, no red · motion by emil-design-eng under PRODUCT.md and DESIGN.md · the MP4 is rendered with npm run reel:render · ?frame=0..449 freezes on one frame",
    states: [
      { label: "Play", value: "play" },
    ],
  },
  {
    slug: "ad-safe-to-spend",
    name: "First Sorted ad, Safe to Spend · G222 · three static art directions",
    description:
      "G222 round 1: one ad message (what can you spend until payday) for TikTok, Instagram and Facebook, aimed at people who worry about money until payday · A The question (headline names the feeling, the card answers it), B The number (the figure leads, the card is evidence), C The relief (late-month maths against one number) · each renders at exact artboard size, feed 1080x1350 for Facebook and Instagram, story 1080x1920 for TikTok, Reels and Stories with the platform safe zones kept clear · the phone imagery is the production SafeToSpendCard through its real props with a fictional persona, no real bank, name or data · art direction by design-taste-frontend under PRODUCT.md and DESIGN.md, emerald figure, indigo CTA, no gradient, no red · add &chrome=1 for the switcher · ?variant=a|b|c&format=feed|story&mode=light|dark",
    states: [
      { label: "Feed", value: "feed" },
      { label: "Story", value: "story" },
    ],
    variants: [
      { label: "A The question", value: "a" },
      { label: "B The number", value: "b" },
      { label: "C The relief", value: "c" },
    ],
  },
  {
    slug: "sts-accounts-route",
    name: "Safe to Spend route to Accounts · G219 · approved B, folded in",
    description:
      "G219: approved B, folded in. The quiet Your accounts link ships by default in the Safe to Spend action row below the disclaimer, beside the primary action or alone, in every state that renders a figure including syncing, never on loading, error or the first-sync shell · renders only the production SafeToSpendCard through props with fixture data, no variant switcher · ?state=on-track|tight|card|short-cash|short-plans|syncing&logos=on|missing&mode=light|dark",
    states: [
      { label: "On track", value: "on-track" },
      { label: "Tight", value: "tight" },
      { label: "Check card bill", value: "card" },
      { label: "Short (cash)", value: "short-cash" },
      { label: "Short (plans only)", value: "short-plans" },
      { label: "Syncing", value: "syncing" },
    ],
  },
  {
    slug: "allocation-shortfall",
    name: "Allocation shortfall card · G217 · approved A, folded in",
    description:
      "G217 fold-in of Kevin's pick (A, same anatomy lighter; revised 2026-10-06; materiality floor £5): the PRODUCTION AllocationShortfallCard rendered through props under the production MoveCard, as they stack on Home · ink figure in mono, neutral icon, no red, no amber, no Penny gradient · the move is a recommendation sentence (\"You could move £X from Savings, which looks able to spare it\"), never a button, because the app does not move money; one full-width action, Adjust set-aside; with no source a line saying why · the paying account is hedged (\"based on recent transfers\") when inferred · Adjust set-aside opens the this-period sheet, with Change every period leading to the full editor",
    states: [{ label: "Estimated account", value: "estimated" }, { label: "Known account", value: "known" }, { label: "No source", value: "no-source" }],
  },
  {
    slug: "sync-loading",
    name: "Sync loading state · G214 · approved B, folded in",
    description:
      "G214, Kevin's pick B (stale-marked figure), now shipped: while a bank sync runs the Safe to Spend figure steps down to secondary ink with Last known amount and an as-of time, the chip carries the ring, and Accounts shows a ring beside the balance, Pending for a never-synced bank and a banner with Try again once a sync stalls or fails · the first sign-up has no hero yet, so the same grammar shows No figure yet above the sign-in ledger · renders the production SafeToSpendCard, FirstSyncCard, AccountLedgerRow and SyncNote with fixture props, nothing syncs · ?surface=hero|accounts&state=refresh|new-bank|background|stalled|failed|first-sync&mode=light|dark",
    states: [{ label: "Refresh", value: "refresh" }, { label: "New bank", value: "new-bank" }, { label: "Background", value: "background" }, { label: "Stalled", value: "stalled" }, { label: "Failed", value: "failed" }, { label: "First sign-up", value: "first-sync" }],
  },
  {
    slug: "safe-to-spend-figure",
    name: "Safe to Spend figure colour · G218 · approved B, folded in",
    description:
      "G218, approved B (Kevin 2026-10-06) and folded in: the Safe to Spend figure is emerald On track, red only for a cash shortfall (red-500 in dark mode), amber when the shortfall exists only because of plans and envelopes, ink for Tight, card checks, error, degraded and syncing · renders the production SafeToSpendCard through props with fixture data, so a drift in the shipped colours shows here · ?state=on-track|tight|card|short-cash|short-plans|error|degraded|syncing&mode=light|dark&view=single|strip|compare",
    states: [
      { label: "Short (cash)", value: "short-cash" },
      { label: "On track", value: "on-track" },
      { label: "Short (plans only)", value: "short-plans" },
      { label: "Tight", value: "tight" },
      { label: "Check card bill", value: "card" },
      { label: "Error", value: "error" },
      { label: "Degraded", value: "degraded" },
      { label: "Syncing", value: "syncing" },
      { label: "Spend from capped (G234)", value: "capped" },
    ],
  },
  {
    slug: "first-sync",
    name: "First bank sync state · G210",
    description:
      "G210: what Home shows while a first bank sync is running, stuck or failed, instead of the connect hero and a red verdict computed from partial data · a calm ledger (bank connected, fetching transactions, working out your figures) reusing the G202 sign-in ledger, a stalled state after 10 minutes with Try again, a failed state with Try again and Connect a different bank, and Safe to Spend's own syncing branch with no figure and no verdict · no red, no gradient · renders the production FirstSyncCard and SafeToSpendCard with fixture props, an established user adding a second bank sees the ledger above a normal verdict · nothing syncs · ?state=syncing|stalled|failed|second-bank|sts-syncing&mode=light|dark",
    states: [{ label: "Syncing", value: "syncing" }, { label: "Stalled", value: "stalled" }, { label: "Failed", value: "failed" }, { label: "Second bank", value: "second-bank" }, { label: "Safe to Spend, syncing", value: "sts-syncing" }],
  },
  {
    slug: "app-lock",
    name: "App lock screen · G203 · approved A, folded in",
    description:
      "G203 · approved A, folded in (Kevin picked A, Quiet door, 2026-10-04; skill: impeccable): the full-screen app lock shown behind Face ID, Touch ID or fingerprint, now the shipped look · this page renders ONLY the production components/LockScreenView.tsx through props, so it cannot drift from the app · centred flat indigo tile carrying the white Penny mark, heading, status line, full-width 48px Unlock, flat canvas with no gradient, motion off under reduced motion · copy names Face ID, Touch ID, your fingerprint, face unlock or your passcode per device, with honest not-confirmed and timed-out states · states: idle, prompting (no buttons, the OS sheet is up), failed and timed out (Try again plus the sign-out escape hatch, only after a failure) · fixture props only, the real gate is never mounted, unlock and sign out do nothing · ?state=idle|prompting|failed|timeout&device=iphone-face|iphone-touch|android-fingerprint|android-face|passcode|unresolved&mode=light|dark",
    states: [
      { label: "Idle", value: "idle" },
      { label: "Prompting", value: "prompting" },
      { label: "Failed", value: "failed" },
      { label: "Timed out", value: "timeout" },
    ],
  },
  {
    slug: "signin-loading",
    name: "Signing-in state · G202 · approved A, folded in",
    description:
      "G202 · approved A, folded in (Kevin picked Two stages on 2026-10-04): the calm 'signing you in' state shown from the moment the in-app browser returns until the session is ready or the attempt fails · a two-row ledger of the two real stages (browser hand-back, then session check), 'Still signing you in' after 20s with Cancel on screen, a focused role=alert notice on failure or timeout, and tap-to-retry when Sorted cannot be reached · renders the production LoginScreen and SignInProgress through the phase and nowMs props with a fake clock, fixtures only, nothing signs in · ?state=waiting|waiting-slow|checking|resume|failed|timeout|unreachable&mode=light|dark&t=<seconds>&live=1&chrome=0",
    states: [{ label: "Signing in 0s", value: "waiting" }, { label: "Signing in 25s", value: "waiting-slow" }, { label: "Checking session", value: "checking" }, { label: "Resumed", value: "resume" }, { label: "Failed", value: "failed" }, { label: "Timed out", value: "timeout" }, { label: "Unreachable", value: "unreachable" }],
  },
  {
    slug: "settings-overhaul",
    name: "Settings overhaul · G201",
    description:
      "G201 settings overhaul design round (skills: impeccable, directions drafted with openai/gpt-6-astra and rewritten to DESIGN.md): the Account hub at /settings regrouped by the job the user is doing, with deep configuration on drill-ins and sign out and delete isolated at the end · A Clear directory: four groups, 13 status rows, one page each / B Five jobs: five destinations, the shortest hub, related controls together in workspaces / C Quick adjustments first: three switches on the hub, bounded edits in sheets · every variant has the hub plus drill-in pages (cover plan safeguards placeholder linking to G200, pay period via the real sheet, notifications, sign-in methods, delete on its own screen) · renders production Toggle, ConfirmDialog, SheetFrame, PayPeriodSettingsSheet, YourPlanCard and CoverPlanSourcesCard, hub rows and several blocks are hand-authored stand-ins · static fixtures, nothing saves · ?variant=a|b|c&page=hub|notifications|cover-plan|signin|delete|money|experience|account&state=ready|attention|relay|empty&mode=light|dark&sheet=pay-period|financial",
    states: [{ label: "Ready", value: "ready" }, { label: "Notifications blocked", value: "attention" }, { label: "Apple relay account", value: "relay" }, { label: "New account, web", value: "empty" }],
    variants: [{ label: "A · Clear directory", value: "a" }, { label: "B · Five jobs", value: "b" }, { label: "C · Quick adjustments first", value: "c" }],
  },
  {
    slug: "signin-handoff",
    name: "Sign-in hand-off page · G199 · approved B, folded in",
    description:
      "G199 · approved B, folded in (Kevin 2026-10-03): the page shown in the Android Chrome Custom Tab / iOS in-app browser after Google sign-in (Signed in, Taking you back to Sorted, Return to Sorted) and its error state · Open cockpit, type-led heading with the mark beside it, action anchored low under a hairline, no card · every frame renders the shared template the backend serves, in light and dark · no gradient, no green, no red · A108 adds the bank-connect frames (Bank connected, Bank did not link) from the same template · ?state=ok|hint|error|bank-ok|bank-error&mode=light|dark",
    states: [{ label: "Signed in", value: "ok" }, { label: "After 3 seconds", value: "hint" }, { label: "Did not complete", value: "error" }, { label: "Bank connected", value: "bank-ok" }, { label: "Bank did not link", value: "bank-error" }],
  },
  {
    slug: "penny-keyboard",
    name: "Penny keyboard · G197",
    description: "G197, approved B restored (Kevin 2026-10-02): Codex's conversation-first layout from G191 (02c22ef4) over the G196 keyboard mechanics. Tapping the input changes nothing. Once a software keyboard is up the Penny window takes over the visible height in one move, with a compact header (a clear gap between its line and the close button), the links and question chips hidden, the conversation filling the space and the composer and its note on the keyboard edge. Nothing moves afterwards, the page behind cannot scroll, and the navigation and Penny button hide. Uses the production Penny panel, header, composer and thread anchor with local-only replies. Physical iOS Safari, Android Chrome and Capacitor keyboard checks remain required. ?state=short|long|empty|error&mode=light|dark",
    states: [{ label: "Short thread", value: "short" }, { label: "Long thread", value: "long" }, { label: "Empty", value: "empty" }, { label: "Reply error", value: "error" }],
  },
  {
    slug: "penny-fullscreen",
    name: "Ask Penny full screen · G240",
    description: "G240, approved variant A (Clear runway), Kevin 2026-10-08. Gate preview: the Ask Penny sheet as a phone takeover from the top safe area to the bottom safe area (or the keyboard edge) on a solid surface. Renders the production Penny panel, header, composer, empty-state layout and chip; the chip labels and replies are fixtures because the live conversation fetches its own data. Type into it on your phone, light and dark. ?mode=light|dark&thread=empty|long&open=1 (state= also works)",
    states: [{ label: "Empty", value: "empty" }, { label: "Long thread", value: "long" }],
  },
  {
    slug: "g176-account-status",
    name: "g176-account-status",
    description:
      "G176 formatting follow-up, skill: impeccable polish · Approved B, Warning & info symbols · Two-decimal amounts in a fixed right-hand column, separate regular-font Left after / Short for captions, and estimates attached to the affected result · Renders the production By account card and account/plan working, using the shared account walk and plan calculations · Invented fixtures only, no API services · Hero and financial logic unchanged · ?variant=b&state=mixed|covered|estimated|short|moves|unknown|overlap|large|loading|error|empty&mode=light|dark",
    states: [
      { label: "Some accounts short", value: "mixed" },
      { label: "Everything covered", value: "covered" },
      { label: "Covered with an estimate", value: "estimated" },
      { label: "All accounts short", value: "short" },
      { label: "Optional transfers", value: "moves" },
      { label: "Balance unavailable", value: "unknown" },
      { label: "Calculation needs checking", value: "overlap" },
      { label: "Long names and large amounts", value: "large" },
      { label: "Plans loading", value: "loading" },
      { label: "Plans could not load", value: "error" },
      { label: "No account payments", value: "empty" },
    ],
    variants: [
      { label: "B · Approved warning & info", value: "b" },
    ],
  },
  {
    slug: "g176-account-plans",
    name: "g176-account-plans",
    description:
      "G176 follow-up, skills: impeccable and emil-design-eng · Account details include remaining allocations and this-period goal contributions, with explicit paying-account evidence and no guessed source from the receiving pot · A Balance first keeps working folded; B Working first shows both balances and the full calculation · Both prototype a single persistent Details/Edit sheet with Back, Cancel, Save, error recovery and account linking · Six invented examples, no live data or API calls · Original production hero and By account card retained as page context; proposed detail layouts and source selection are preview-only · Hero arithmetic and payment-lag caveat unchanged · Future implementation must establish source provenance and prove any forecast-transfer overlap before account deductions · ?variant=a|b&state=gap|covered|unassigned|billgap|missing|empty&mode=light|dark&view=account|payment",
    states: [
      { label: "Plans need cash", value: "gap" },
      { label: "Everything funded", value: "covered" },
      { label: "Paying account unknown", value: "unassigned" },
      { label: "A bill is short", value: "billgap" },
      { label: "Balance unavailable", value: "missing" },
      { label: "No set-asides", value: "empty" },
    ],
    variants: [
      { label: "A · Balance first", value: "a" },
      { label: "B · Working first", value: "b" },
    ],
  },
  {
    slug: "g176-upcoming-rows",
    name: "g176-upcoming-rows",
    description:
      "G176, skill: impeccable · Approved C, Needs a look: real production day groups keep issues open and covered payments folded; production row details and sheet show the working before editing · A By account and B Cash view remain as earlier comparisons · invented source-account fixtures include mixed, all-short, all-covered and optional-move states · mixed has £185 left overall but £200 needed in two accounts, with separate working · genuine bill gaps use a small red signifier; unfunded own moves use amber · preview editing and dismissal only change fixtures, with Undo · the live page keeps its existing runway calculation and payment-lag caveat, with a separate production By account card and shared account working · ?variant=a|b|c&state=mixed|short|covered|moves&mode=light|dark",
    states: [
      { label: "Some accounts short", value: "mixed" },
      { label: "All accounts short", value: "short" },
      { label: "All covered", value: "covered" },
      { label: "Own transfers", value: "moves" },
    ],
    variants: [
      { label: "A · By account", value: "a" },
      { label: "B · Cash view", value: "b" },
      { label: "C · Needs a look", value: "c" },
    ],
  },
  {
    slug: "sheet-swipe",
    name: "sheet-swipe",
    description:
      "G205, skill: emil-design-eng · Swipe a sheet down to close it · Real production SheetFrame and goal sheet with a long scrolling body · Drag from the new grab bar or header at any time, or from the body only when scrolled to the top · Past a fifth of the height or a quick flick closes, otherwise it springs back · Locked sheet ignores swipe like the cross · Phones only, desktop dialogs unchanged · ?mode=light|dark",
    states: [{ label: "Try it", value: "" }],
  },
  {
    slug: "card-terms-sheet",
    name: "card-terms-sheet",
    description:
      "G225, skill: impeccable · Alignment of the credit card terms sheet to the G192 sheet anatomy and DESIGN.md form patterns, not a new look · One section rhythm (space between question groups, label then helper then control), a typed rate in ink with only the placeholder grey, the stray full-width 0% button removed so Yes and No are the only answers, the 0% question reworded for a card with nothing on it, clearer offers copy, month pickers on the G136 DateField, and a sheet that hugs its content above the sticky footer · Renders the production CardTermsSheet through its real props with fixture cards; a fetch stand-in answers only the representative-rate lookup · ?state=balance|lookup|zero|promos (card= also works)&mode=light|dark",
    states: [
      { label: "Balance, rate confirmed", value: "balance" },
      { label: "Rate found", value: "lookup" },
      { label: "£0 balance", value: "zero" },
      { label: "Existing deals", value: "promos" },
    ],
  },
  {
    slug: "bank-picker",
    name: "bank-picker",
    description:
      "A155 round 2, skills: design-taste-frontend (art direction) with impeccable · Kevin asked for a fresh design that treats the bank picker as a selector with the wording built in: D Popular first (the agency sentence in a bordered How this connection works strip above search and six popular banks), E Index rail (search, then the sentence as the opening notice row of the list, six 44px alphabet jumps down the right), F Two-step page (a full-screen page: step one explains the connection and carries the sentence, step two is the selector; Onboarding, Home and Accounts would navigate to it instead of opening a sheet) · D, E and F are hand-authored proposals, not the production sheet · F's two reassurance lines are proposed copy awaiting Kevin's sign-off, and F step 2 repeats the sentence on purpose so it is visible without step 1 · Sentence visible by default in all three · Directions drafted with openai/gpt-6-astra, rewritten to DESIGN.md · Round 1 follows: A155, skill: impeccable · Kevin 2026-10-08 (iPhone): the agency sentence was a five-line block pinned to the footer, the search grew taller once text was typed and scrolled away with the list · Every variant renders the real BankPickerSheet through new optional props, fixture banks, no API calls · All three fix the search the same way (fixed 44px in every state, clear button inside the field, pinned under the header while the list scrolls) · Directions drafted with openai/gpt-6-astra, rewritten to DESIGN.md · A shows the full sentence as the last row of the list with a short pinned line and a Full notice jump; B pins one line that opens in place to the sentence (needs Finexer to confirm it satisfies A4.2); C sets the full sentence in the header under Powered by Finexer, which takes about six lines so the list starts around a third of the way down a 390 by 844 phone · Today is the current footer for comparison · ?variant=today|a|b|c|d|e|f&state=empty|typing|scrolled|noresults|chooser|expanded&mode=light|dark",
    states: [
      { label: "Empty search", value: "empty" },
      { label: "Typing", value: "typing" },
      { label: "Scrolled", value: "scrolled" },
      { label: "No results", value: "noresults" },
      { label: "Step 2 (F)", value: "chooser" },
      { label: "Expanded notice (B)", value: "expanded" },
    ],
    variants: [
      { label: "D · Popular first", value: "d" },
      { label: "E · Index rail", value: "e" },
      { label: "F · Two-step page", value: "f" },
      { label: "A · End of the list", value: "a" },
      { label: "B · Expands in place", value: "b" },
      { label: "C · In the header", value: "c" },
      { label: "Today", value: "today" },
    ],
  },
  {
    slug: "sheet-anatomy",
    name: "sheet-anatomy",
    description:
      "G192 approved B, skill: impeccable adapt · Near-full-height task sheets share a fixed header, plain close control, independently scrolling body and safe-area action footer · Imports the real production goal and filter sheets with local fixture operations, no live API calls · Includes long lists, empty lists, save failure, save/clear controls and nested-flow checks · Customer sheets now share this frame; Penny and centred confirmation dialogs remain separate · A is retained for comparison · ?variant=a|b&state=goal|long|empty|error|contract&mode=light|dark",
    states: [
      { label: "Usual content", value: "goal" },
      { label: "Long account list", value: "long" },
      { label: "Empty lists", value: "empty" },
      { label: "Save error", value: "error" },
      { label: "Navigation checks", value: "contract" },
    ],
    variants: [
      { label: "B · Approved focused task", value: "b" },
      { label: "A · Compact", value: "a" },
    ],
  },
  {
    slug: "payday-plan-standing-orders",
    name: "payday-plan-standing-orders",
    description:
      "G173, skill: impeccable · Kevin 2026-09-27: \"The payday plan was conceived to prevent too much movement of money. I get £4,000 salary into my account and I have certain standing orders set up; can I be better at improving the standing orders, because I would always move money around to cover bills. The user would look at this and be like oh I need to change my standing orders so I don't have to move money again during the month.\" · A 'Two-column ledger' — each destination shows Standing order left and Needs ~ right with an arrow-free \"send £298 less\"/\"start one at ~£150\" line, the payments/spending/buffer working folded behind one card-level \"Show the working\" disclosure; B 'Adjustment list' — leads with the hero verdict figure (£612 less across 2 standing orders here) and lists only the destinations that need a change, everything already right folded into one \"6 standing orders are about right\" disclosure row; C 'Before and after' — a compact Account/Standing order/Needs/Adjust table across every destination at once, the delta cell highlighted (ink, no red), the salary tile above and the \"stays with you\" line below · every variant keeps the Penny minimise chevron and Home dismiss × exactly as production renders them (CardHeader in shared.tsx, copied verbatim from components/PaydayPlanCard.tsx's own inline header markup, the same local-unexported-JSX reasoning the month-closed-card round used), plus the salary tile (SalaryTile, also copied verbatim) — PRODUCTION-BOUNDARY NOTE: the destination row itself is what this round redesigns, so it is hand-authored in every variant rather than forking PaydayPlanCard's existing dest-row markup, which only ever showed the recommended move, never a standing-order-vs-need comparison · fixture data only, no API calls · salary (£4,798, Barclays Premier Current Account), the real account names (HSBC's MAINGI K M, Monzo's Kevin Mbithi Maingi, NatWest's THE NUMBER ONE, matching app/design/g128-payday-reconcile/fixtures.ts) and all eight standing-order amounts are Kevin's real 2026-08-10 observed payday ritual, as is NatWest's stated £596 need and Monzo's £1,016 spend median; every other need TOTAL (HSBC's £1,587, Monzo's £1,066 = £1,016 spend + the plan's own £50 default buffer, NatWest's payments/spend/buffer split, and the ninth Council Tax Reserve row demonstrating \"needs a standing order but has none\") is illustrative, invented for this preview and labelled \"illustrative\" on the need figure itself (never on NatWest's stated £596) in all three variants · Monzo's real £90 gap (£1,106 sent vs £1,016 usual spend) is preserved rather than erased: the plan's default £50 buffer leaves a genuine £40 overage that still folds into \"about right\" under the £100 threshold, the honest outcome, and that threshold is stated on the card itself (\"Changes under £100 are folded away in this preview\", near Show the working on A and near N standing orders are about right on B) rather than left only in code comments · a destination needs a change once the standing order and its need differ by £100 or more (a preview design choice, not a backend rule); no red anywhere, an under-funded destination gets a small amber dot signifier only, per DESIGN.md's Red Is Risk Rule · ?variant=a|b|c&surface=home|penny&state=default|minimised&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
    variants: [
      { label: "A · Two-column ledger", value: "a" },
      { label: "B · Adjustment list", value: "b" },
      { label: "C · Before and after", value: "c" },
    ],
  },
  {
    slug: "month-closed-card",
    name: "month-closed-card",
    description:
      "G168, skill: impeccable · Kevin 2026-09-26 06:12: the month-closed (\"needle\") card, \"Your month closed on Thursday. Here's how it went\", has no dismiss on Home and is absent from the Penny hub · A 'Chip and chevron' — Home's existing bare card gains only the standard glass × in its usual top-right slot; Penny renders the same full card in the permanent section under the payday plan with a chevron-up Minimise that collapses to a one-line row, tapping the row expands it back / B 'Row-first on Penny' — Penny starts collapsed to that same one-line row (the payday plan stays the section's hero), expanding in place on tap with the same Minimise to collapse it again; Home unchanged from A / C 'Verdict row' — both surfaces lead with the month's own figure as a Numbers-Lead row, the story folded behind a disclosure, Home dismissible and Penny minimisable exactly as A and B · every variant: dismiss only on Home (keyed needle:<period_end>, mirrors the real dismissed-set companion.py already honours), minimise only on Penny, never dismiss, mirroring the payday plan's own owner rule (G164) · components/HomeBrief.tsx's needle rendering (~2102-2117) is inline markup inside BriefBody, not an exported component, so every variant hand-authors that markup rather than forking a component that doesn't exist to import; DismissChip/MinimiseControl are copied verbatim from HomeBrief.tsx/the G164 payday-plan-executed preview, since the production originals are local, unexported functions · Variant C's led figure and story are illustrative: the real needle item is \"invitation only, no figures\" per companion.py's own comment, so there is no real Kevin number to reuse for it, unlike the headline/action copy and route, which are the real backend strings · fixture data only, no API calls · ?variant=a|b|c&surface=home|penny&state=default|minimised&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
    variants: [
      { label: "A · Chip & chevron", value: "a" },
      { label: "B · Row-first", value: "b" },
      { label: "C · Verdict row", value: "c" },
    ],
  },
  {
    slug: "g134-home-inventory",
    name: "g134-home-inventory",
    description:
      "G134 — a CATALOGUE of the entire Home surface, not an art-direction round: every zone in Home's real render order (app/components/HomePage.tsx), every brief-card kind in its dismissible state (labelled with its real component name and the condition that makes it appear, in BriefBody's own fixed order — celebration, cliff, trajectory, rhythm, rhythm-info, intent_pace, unfunded_move, ask, needle, other, move; move renders last), all ten SafeToSpendCard states, plus ReconnectStrip, PaydayPlanSection (entry row / active), HomeBriefClearedRow, PinnedWidgetCard, AccountLedgerRow and TransactionRow/TeachingSheet — every one a real production component fed fixture data through its real props, previewMode where the component takes one. A separate realistic-stacks section runs real BriefBody at 1/2/3/everything cards via the Stack control. Self-fetching components with no props escape hatch (UpcomingBillsStrip, HomeInsightSpotlight, OfferCard, FuelSavingsCard, GroceryBasketCard) are named and explained in the page's own copy rather than forked. Static fixtures only, no API calls · ?mode=light|dark&state=stack-one|stack-two|stack-three|stack-all|balances-hidden",
    states: [
      { label: "Stack: everything", value: "stack-all" },
      { label: "Stack: one card", value: "stack-one" },
      { label: "Stack: two cards", value: "stack-two" },
      { label: "Stack: three cards", value: "stack-three" },
      { label: "Balances hidden", value: "balances-hidden" },
    ],
  },
  {
    slug: "g149-transfer-review-placement",
    name: "g149-transfer-review-placement",
    description:
      "G149 Spend timeline placement round · A treats transfer review as a true pay-period event, with the timeline rail marker, text indent and event rhythm; B keeps it as a quiet period-level affordance beside the period summary, never stranded between timeline nodes · the guardrail wording and intended review behaviour are preserved, with one, many and clear fixture states in light and dark · no API calls, no mutations, and it renders the real production TransferReviewGuardrail component · ?variant=a|b&state=single|many|clear&mode=light|dark",
    states: [
      { label: "One transfer", value: "single" },
      { label: "Many transfers", value: "many" },
      { label: "Nothing to review", value: "clear" },
    ],
    variants: [
      { label: "A · Timeline event", value: "a" },
      { label: "B · Period affordance", value: "b" },
    ],
  },
  {
    slug: "ops-board-mobile",
    name: "ops-board-mobile",
    description:
      "H56 Focus-first round for /ops/go-live on a phone, Kevin's pick landed (2026-09-17): ribbon (sticky tappable counts strip over dense single-line rows) is the pick, folded into production as app/ops/go-live/MobileRibbonBoard.tsx, which BoardView.tsx now mounts below lg in place of the old two-axis lane-strip scroll through 300 cards across 8 sections and 7 states. The ribbon variant here imports and renders that same production component with fixture data through its real props, a genuine gate per CLAUDE.md, not a copy: its counts strip drives the same filters.states FilterBar.tsx owns via the shared toggleValue helper, kanban stays desktop-only, and there is no drag, a tap opens the real detail sheet · live-now (every in-flight item as one full card under a heading) and waiting (grouped Waiting on you before In motion) are reference-only, hand-authored, not picked, kept for comparison and marked as such in the switcher · every variant still shares real StatePill (with a compact mode that drops the free-text reason/branch on dense rows), PriorityPill, OwnerInitialChip, UnblocksTags, FilterBar and ItemDetailSheet from app/ops/go-live, fed a dated fixture slice of TODO.md (fixtures.ts) including several full-paragraph titles · typing in the real search bar or picking a state chip genuinely filters the fixture set via lib/goLive's own filterItems · static fixtures only, no API calls or mutations · ?variant=live-now|ribbon|waiting&mode=light|dark",
    states: [{ label: "Interactive board", value: "interactive" }],
    // Ribbon leads the list (Kevin's pick, H56, 2026-09-17): PreviewCard's
    // bottom "light"/"dark" links default to `variants[0]`, so ordering
    // this first is what makes the index's own default tap land on the
    // real production component rather than one of the two not-picked,
    // hand-authored references.
    variants: [
      { label: "Ribbon", value: "ribbon" },
      { label: "Live now", value: "live-now" },
      { label: "Waiting on", value: "waiting" },
    ],
  },
  { slug: "g99-month-story-canvas", name: "g99-month-story-canvas", description: "G99 Canvas Before Cards review for the Month story · A anchored spotlight / B quiet centre / C close focus · the real production StoryPlayer renders fixture data through its supported design-review props, retaining its immersive dark canvas, playback controls, reduced-motion treatment and return path · no API calls or mutations · ?variant=a|b|c&state=interactive", states: [{ label: "Interactive story", value: "interactive" }], variants: [{ label: "A · Anchored spotlight", value: "a" }, { label: "B · Quiet centre", value: "b" }, { label: "C · Close focus", value: "c" }] },
  { slug: "g98-month-canvas", name: "g98-month-canvas", description: "G98 Canvas Before Cards review for Month · A reading / B evidence rail / C editorial ledger · monthly verdict and explanation live on the canvas, with reconciled evidence earning its boundary and a preserved path to the month story · static fixtures, no API calls or mutations · ?variant=a|b|c&state=ahead|steady|short|empty|loading|error&mode=light|dark", states: [{ label: "Ahead", value: "ahead" }, { label: "Steady", value: "steady" }, { label: "Short", value: "short" }, { label: "History building", value: "empty" }, { label: "Loading", value: "loading" }, { label: "Error", value: "error" }], variants: [{ label: "A · Reading", value: "a" }, { label: "B · Evidence rail", value: "b" }, { label: "C · Editorial ledger", value: "c" }] },
  {slug:"mirror-canvas-before-cards",name:"mirror-canvas-before-cards",description:"G97 Canvas Before Cards review for Mirror · A editorial reading / B paired traits / C progressive evidence · behavioural reading stays on the canvas, while selectable aims and bounded transaction evidence earn a card · fixture-only, no API calls or production edits · ?variant=a|b|c&state=portrait|aim|empty&mode=light|dark",states:[{label:"Portrait",value:"portrait"},{label:"Active aim",value:"aim"},{label:"Not enough data",value:"empty"}],variants:[{label:"A · Editorial",value:"a"},{label:"B · Paired",value:"b"},{label:"C · Evidence",value:"c"}]},
  {slug:"money-shape-canvas-before-cards",name:"money-shape-canvas-before-cards",description:"G95 Canvas Before Cards review for Your money shape · A editorial instrument / B split reading / C progressive reference rail · one pay-shape instrument leads on the canvas while explanation and reference shapes are disclosed only when useful · fixture-only, no API calls or production edits · ?variant=a|b|c&state=steady|changed|thin&mode=light|dark",states:[{label:"Steady",value:"steady"},{label:"Changed",value:"changed"},{label:"Thin history",value:"thin"}],variants:[{label:"A · Editorial",value:"a"},{label:"B · Split",value:"b"},{label:"C · Reference",value:"c"}]},
  { slug: "transactions-canvas-before-cards", name: "transactions-canvas-before-cards", description: "G92 Canvas Before Cards review for Transactions · A canvas search reading / B desktop context rail / C evidence-forward groups · search, context and summary stay on canvas while dense date groups and expandable teaching evidence keep earned boundaries · populated, long-list, loading, empty and error fixtures only · ?variant=a|b|c&state=populated|long|loading|empty|error&mode=light|dark", states: [{label:"Populated",value:"populated"},{label:"Long list",value:"long"},{label:"Loading",value:"loading"},{label:"Empty",value:"empty"},{label:"Error",value:"error"}], variants: [{label:"A · Canvas",value:"a"},{label:"B · Context rail",value:"b"},{label:"C · Evidence",value:"c"}] },
  { slug: "g119-transactions-live", name: "g119-transactions-live", description: "G119 Transactions round two, on real data · A day-groups + page pager + bottom sheet / B day-groups + infinite scroll + inline row expand / C day-groups + load-more + full-screen detail · reads the signed-in viewer's own GET /transactions/search (page/page_size), read-only, falls back to synthetic fixtures when signed out · row tap opens that transaction's real detail with the ability to change it (non-mutating port of TeachingSheet's fork logic, never a group-level popup) · ?variant=a|b|c&state=auto|populated|long|empty|loading&mode=light|dark", states: [{label:"Live/fixture",value:"auto"},{label:"Populated",value:"populated"},{label:"Long list",value:"long"},{label:"Empty",value:"empty"},{label:"Loading",value:"loading"}], variants: [{label:"A · Sheet",value:"a"},{label:"B · Inline",value:"b"},{label:"C · Full screen",value:"c"}] },
  {
    slug: "g93-penny-canvas",
    name: "g93-penny-canvas",
    description: "G93 Canvas Before Cards review for Penny · A conversation line / B evidence rail / C compact companion · the thread is the primary canvas, while proposals, confirmations and bounded evidence earn cards · static fixtures only, no API calls or mutations · ?variant=a|b|c&state=ready|loading|error|allowance&mode=light|dark",
    states: [{ label: "Ready", value: "ready" }, { label: "Loading", value: "loading" }, { label: "Error", value: "error" }, { label: "Allowance used", value: "allowance" }],
    variants: [{ label: "A · Conversation line", value: "a" }, { label: "B · Evidence rail", value: "b" }, { label: "C · Compact companion", value: "c" }],
  },
  {
    slug: "accounts-canvas-before-cards",
    name: "accounts-canvas-before-cards",
    description:
      "G87 Canvas Before Cards review for Accounts, revised after mobile UAT · A Quiet position (recommended) / B Own and owe / C Details on demand · every route keeps net worth as the sole verdict and removes the four-part equation from the default reading · A lets account-group subtotals explain the position, B adds two plain-language supporting figures, and C reveals a stacked ledger only on request · cards remain for account groups, reconnect actions and interactive detail records · real AccountLedgerRow, ReconnectStrip, SegmentedControl and TransactionRow components over fixture-only data · mixed, reconnect, empty, current, expired, credit, offline and investment states · persistent global navigation, no API calls or production changes · ?variant=a|b|c&state=estate|attention|empty|detail-current|detail-expired|detail-credit|detail-manual|detail-investment&mode=light|dark",
    states: [
      { label: "Mixed estate", value: "estate" },
      { label: "Reconnect needed", value: "attention" },
      { label: "Nothing connected", value: "empty" },
      { label: "Current detail", value: "detail-current" },
      { label: "Expired detail", value: "detail-expired" },
      { label: "Credit detail", value: "detail-credit" },
      { label: "Offline detail", value: "detail-manual" },
      { label: "Investment detail", value: "detail-investment" },
    ],
    variants: [
      { label: "A · Quiet position", value: "a" },
      { label: "B · Own and owe", value: "b" },
      { label: "C · Details on demand", value: "c" },
    ],
  },
  {
    slug: "offline-account",
    name: "offline-account",
    description:
      "G233 offline account detail alignment · the avatar is a neutral wallet glyph instead of OF initials, the kind line reads Offline account once (never Offline · Offline), and Add transaction sits beside the search field as a compact outlined 44px button with 12px between them and 20px before the list · renders the production AccountDetailIdentity, AccountDetailKindLine, AccountTransactionsToolbar and TransactionRow through props · fixtures only, no live data · ?account=offline|bank&mode=light|dark",
    states: [
      { label: "Offline account", value: "offline" },
      { label: "Bank account", value: "bank" },
    ],
  },
  {
    slug: "home-cleanup",
    name: "home-cleanup",
    description:
      "G221 Home clean-up, approved C and folded in (Kevin 2026-10-06) · the shipped look: one rhythm down the Home stack (12 between cards in a group, 20 between sections, 8 under a section label; pinned cards inside Your money) and the Your estate block with its rows and one footer row, All N accounts (See your account for one), in place of the Manage link and the +N more row · renders the production SafeToSpendCard, HomeBrief cards, tip and Coming up cards, FirstAccountCard, HomeEstateSection and TransactionRow through props · account names use the brand-aware tidy name · synthetic accounts, no live data · ?accounts=1|4|20|fresh&mode=light|dark",
    states: [
      { label: "1 account", value: "1" },
      { label: "4 accounts", value: "4" },
      { label: "20 accounts", value: "20" },
      { label: "Fresh user", value: "fresh" },
    ],
  },
  {
    slug: "g88-home-real",
    name: "g88-home-real",
    description:
      "G88 companion round: the same A/B/C Canvas Before Cards shells judged against Kevin's OWN real Home data instead of invented fixtures (his explicit, repeated request, authorised knowing /design is public and unauthenticated — see realFixtures.ts's header for the full authorisation note; the data subject's own decision, not this session's default) · his actual verdict state is Tight, not the earlier round's invented On-track figure, so the hero is the REAL production SafeToSpendCard fed his real payload through its data prop, showing the true amber \"Tight\" chip and its \"See your cards\" recovery link (driven by his real card debt) · the three supporting cards are the real MoveCard, CelebrationCard and CliffCard (CliffCard also renders his real debt-trajectory item) fed his three real companion.py items, not replica markup · every real figure lives in ONE commented module, realFixtures.ts, cross-checked line by line against the source dump, deliberately not repeated as literal numbers anywhere else on this page (including here) so pulling his data later is a genuine one-file edit · the old \"This pay period\" IN/OUT/MOVED strip is REMOVED (not carried over as invented numbers) because those figures were not part of the Home dump this preview is scoped to · variant B's two-column board opens the hero's own \"How we got\" breakdown by default so the left column has real content, not empty space, and stacks cards single-column at a wider share of the row so real card markup does not get squeezed · FixtureBottomNav renders on every state so the Penny gradient button sits beside the real hero · no API calls · the hide-balances state is answered entirely inside this preview, via a fetch stand-in for /preferences scoped to this component's mount and torn down on unmount, so it never reads or writes a real stored preference, signed in or not, and \"tight\" vs \"hidden\" render the real hero figure vs the real mask for any visitor · ?variant=a|b|c&state=tight|hidden&mode=light|dark",
    states: [
      { label: "Kevin's real state (Tight)", value: "tight" },
      { label: "Balances hidden", value: "hidden" },
    ],
    variants: [
      { label: "A · Reading line", value: "a" },
      { label: "B · Today board", value: "b" },
      { label: "C · Rhythm", value: "c" },
    ],
  },
  {
    slug: "upcoming-canvas-before-cards",
    name: "upcoming-canvas-before-cards",
    description: "G90 Upcoming second round after phone review · uses the owner's £612 available, £771 due, −£159 payday forecast and £231.30 Barclays account gap · the Summer holiday envelope is visibly an envelope and honestly starts with the next pay, so it does not alter the current-period arithmetic · A five-day reading / B money path / C action first · preview controls occupy their own top bar instead of obscuring page content · includes covered and set-aside-predictions states · fixture-only, no API calls or production edits · ?variant=a|b|c&state=short|healthy|hidden&mode=light|dark",
    states: [{ label: "My figures", value: "short" }, { label: "Covered", value: "healthy" }, { label: "Set-aside predictions", value: "hidden" }],
    variants: [{ label: "A · Five-day reading", value: "a" }, { label: "B · Money path", value: "b" }, { label: "C · Action first", value: "c" }],
  },
  {
    slug: "g124-upcoming-refine",
    name: "g124-upcoming-refine",
    description:
      "G124/G127 approved (variant A throughout, including the Set-aside treatment; cluster interval rule; Kevin 2026-09-18) and folded into production by G131 in two passes. Pass one: the hero, the bounded day-card grammar and the cluster-marker algorithm are no longer reimplemented here — this preview imports the SAME shared components and functions PlanningPage.tsx now renders (components/upcoming/UpcomingHeroCard.tsx, components/upcoming/UpcomingDayCard.tsx, components/upcoming/UpcomingDivider.tsx, lib/upcomingMarkers.ts). The \"gap\" and \"rhythm\" interval rules and the switcher that used to compare all three are gone; only cluster ships. Settling-row correction (reversing an earlier misreading): the long \"Left earlier today, still settling\" line under the payment name is gone, and the right-hand slot under the figure reads \"Settling\" (capitalised) where a live row's \"After: £X left\" sits. Header typography matches the codex reference: no \"UPCOMING\" eyebrow, h1 at 28px/bold/tight tracking, header row items-start, hero micro-label promoted to a real h2. Day headings carry the absolute date (\"Mon 21 Sep\"). Red in the hero is confined to the headline figure and the \"N accounts short\" badge only. Pass two: the Set-aside block was the round's own third complaint (a bare-number title, \"50\"; a shouty bank string truncated mid-word, \"Fed by INTEREST PAID GROSS FOR PERIOD 3…\") and Kevin's \"design A looks good\" picked its treatment too, a gap the first pass's brief missed. Variant A (\"today's shape, kept, with the typography/truncation fixes applied in place, every line still always showing\") is folded into PlanningPage.tsx's PlansSection; B (compact chip) and C (progressive disclosure) do not ship and are removed the same way gap/rhythm were — setAsideVariants.tsx and setAsideHelpers.ts are gone. components/upcoming/SetAsideList.tsx is the one shared list component both this preview and PlanningPage.tsx render; lib/setAsideDisplay.ts holds the humanising logic (title case with a curated UK-banking acronym list, word-safe truncation, a card-like string collapsed to \"Brand •• 1234\") both consume. Whether set-asides should be user-nameable — the real fix for a bare numeric name — is a functionality question Kevin has not decided; that stays open, no fallback label is invented. STILL FIXTURE-ONLY, disclosed as such: the individual upcoming-list ROW BODY (DayGroups.tsx's `Row`) is a hand-authored match against representative fixtures, not an import — PlanningPage.tsx's `renderRow` is a page-scoped closure over live risk-walk state, edit sheets and dismiss handlers that is out of this fold-in's scope to extract. G133 (2026-09-19): the swipe-to-dismiss WRAPPER around that row body is no longer part of that disclosure — SwipeDismissRow was already a self-contained, props-only component, so it is now extracted to components/upcoming/SwipeDismissRow.tsx and imported here verbatim, the same instance PlanningPage.tsx renders, closing the gap that let a transparent-sliding-layer regression through a mid-swipe review undetected. No API calls, no production edits beyond the shared components above · ?state=positive|negative&mode=light|dark",
    states: [{ label: "Projected: left", value: "positive" }, { label: "Projected: short", value: "negative" }],
  },
  {
    slug: "home-brief-cards",
    name: "home-brief-cards",
    description:
      "G48 Home brief card-family design round across AskPayday, AskGeneric, Celebration, Cliff, UnfundedMove, IntentPace, Move and Rhythm · the same real-behaviour fixtures in three presentation grammars: A Calm spine ranks verdict, evidence and actions in one vertical reading order, B Action dock separates decisions from evidence with a stable footer, C Folded brief compresses quiet cards while keeping dense move evidence explicitly available · every variant tests an overdue £70 unfunded AMERICAN EXPRESS move, a £70 three-source cover plan, multi-card stacking, all eight card types, light and dark themes · presentation only, no API calls · G103 adds the Debt state: the debt-trajectory card now leads on the three-month movement in what is owed (\"£412 · more owed than three months ago\") with the direction spoken in the headline, and drops the £24,926 carried total to the last line of the body, so Home stops shouting a stock that cannot change this pay period · shown as the card read BEFORE the change plus all five states after it, rising while interest is charged, rising with everything on 0%, coming down, holding steady, and rising on 0% with an end date on file, each rendered through the PRODUCTION CliffCard from components/HomeBrief.tsx fed real CompanionItem props (not replica markup) so the preview stays a regression gate · every string is verbatim from app.services.companion.trajectory_copy · ?variant=a|b|c&state=stack|family|trajectory&mode=light|dark",
    states: [
      { label: "Home stack", value: "stack" },
      { label: "All eight cards", value: "family" },
      { label: "Debt trajectory states", value: "trajectory" },
    ],
  },
  {
    slug: "cover-plan-safeguards",
    name: "cover-plan-safeguards",
    description:
      "G200 cover plan safeguards redesign (Kevin 2026-10-03, Android Settings screenshots): the shipped card mixes a live move, an opaque 0/0 to 2/3 strip, search, a Turned off group and a long skipped list with red dots into one wall of state · separates the user's choice (which accounts may fund cover) from the engine's current answer, with plain-English not-usable copy and no red outside the one genuine no-source case · A permission slip (verdict and exceptions lead, accounts behind one door, no live move, links to Upcoming) / B cover route (the engine's fixed order as two steps plus protections, one hedged sentence about today) / C permission ledger (search and Turned off/Allowed/All views, balances, built to stand alone as a drill-in page) · design drafted with openai/gpt-6-astra, rewritten to DESIGN.md · variants share the production card's props; 'now' renders the shipped CoverPlanSourcesCard with a live move for comparison · fixture data only · ?variant=a|b|c|now&state=default|all|none|stuck&estate=std|long&frame=inline|page&mode=light|dark",
    variants: [
      { label: "A Permission slip", value: "a" },
      { label: "B Cover route", value: "b" },
      { label: "C Permission ledger", value: "c" },
      { label: "Shipped today", value: "now" },
    ],
    states: [
      { label: "Two turned off", value: "default" },
      { label: "Nothing turned off", value: "all" },
      { label: "Everything off", value: "none" },
      { label: "Only cannot-spare left", value: "stuck" },
    ],
  },
  {
    slug: "cover-plan-sources-scale",
    name: "cover-plan-sources-scale",
    description:
      "G51 cover-plan safeguards scale round (Kevin 2026-09-12, rejecting the shipped G46 card): the shipped card renders every account in every class as an always-expanded toggle row with no search, collapse or limit, running several screens on the owner's real 17-account estate (4 current including 1 short and 1 manual, 13 savings including 1 manual and 4 empty pots) · A collapsed classes, exceptions inline: each class folds to one line with an allowed count, currently-excluded accounts show as a small note without opening anything, search and an empty-pots fold appear only once a class is opened / B search-first exceptions manager: ranking becomes a static two-step strip, the list starts showing only turned-off and skipped accounts, search is the one door into all 17 / C drill-in, one screen at a time: the summary shows only two tappable class rows, tapping one swaps the whole card body for that class's own search-and-list screen with a back arrow · every variant keeps the two-class waterfall (current before savings, a class reached only when the earlier one combined cannot cover the amount, highest headroom first, fewest legs preferred, a £10 buffer, short accounts skipped), keeps offline as a 'Manual transfer' attribute on an account of its real class rather than its own rung, fixes the G49 label sizing (uppercase, tracked) and the G50 skip derivation (from the account's own headroom/short state, not from live move cards) · H40 (2026-09-13): the CoverOutcome heading in the shipped component (components/CoverPlanSourcesCard.tsx) has six branches, and the original three states here only reached three of them, leaving the 'no account has headroom right now' copy G66 added unreachable from any URL; three states were added (current-only, no-headroom, savings-only) using preset exclusions on the same 17-account fixture, none of the original three states changed · fixture data only, no API calls · ?variant=a|b|c&state=all|savings|short|current-only|no-headroom|savings-only&mode=light|dark",
    states: [
      { label: "Current accounts cover it", value: "all" },
      { label: "Savings enters", value: "savings" },
      { label: "Everything off", value: "short" },
      { label: "Current accounts are the only source", value: "current-only" },
      { label: "No account has headroom right now", value: "no-headroom" },
      { label: "Savings would be checked first", value: "savings-only" },
    ],
  },
  {
    slug: "g96-receipts-canvas",
    name: "g96-receipts-canvas",
    description: "G96 Canvas Before Cards Receipts round · A Scan first leads with scan status / B Review rail holds the next action beside review records on desktop / C Receipt journey explains scan, review and price history on the canvas · static fixtures only, no API calls or production edits · ?variant=a|b|c&state=ready|empty|loading|error&mode=light|dark",
    states: [{ label: "Ready to review", value: "ready" }, { label: "No receipts", value: "empty" }, { label: "Reading receipt", value: "loading" }, { label: "Couldn’t read", value: "error" }],
    variants: [{ label: "A · Scan first", value: "a" }, { label: "B · Review rail", value: "b" }, { label: "C · Receipt journey", value: "c" }],
  },
  {
    slug: "g94-settings-canvas",
    name: "g94-settings-canvas",
    description: "G94 Canvas Before Cards Settings round · A Guided settings keeps canvas orientation and one dependable reading order / B Settings rail keeps long-page navigation visible on desktop / C Intent groups orders controls by account access, behaviour, then security and data · static fixture only, no API calls or production edits · ?variant=a|b|c&state=ready|attention|empty&mode=light|dark",
    states: [{ label: "Ready", value: "ready" }, { label: "Needs attention", value: "attention" }, { label: "New account", value: "empty" }],
  },
  {
    slug: "g91-cards-canvas",
    name: "g91-cards-canvas",
    description:
      "G91 Canvas Before Cards Cards round · A Reconciled position puts debt, movement and arithmetic on the canvas before the card account register / B Trajectory rail keeps the position visible beside the bounded account projections on desktop / C Drivers first exposes the spending drivers before the account inventory · static fixture data, no API calls or production edits · ?variant=a|b|c&state=growing|reducing|empty&mode=light|dark",
    states: [
      { label: "Balance growing", value: "growing" },
      { label: "Balance reducing", value: "reducing" },
      { label: "No carried balance", value: "empty" },
    ],
  },
  {
    slug: "cards-page",
    name: "cards-page",
    description:
      "G10 round 2: the whole /cards page (faithful replica of all five existing sections against a seven-card fixture, this preview route itself untouched) with four treatments of \"where each card is headed\" in place, including a duplicate-named pair (\"NatWest Mastercard\" twice) · A ledger rows: sixth section below THE TRAJECTORY, one row per carried card in WHERE IT MOVED's own grammar, cleared-monthly cards fold into one quiet line / B timeline: same sixth section, a 24-month rail with one dot per carried card at its clear month and hollow promo-end ticks, plus an accessible list / C no new section: each WHERE IT MOVED row gains one subline under \"£X owed\" (promo end, clear month, or \"clears in full each month\") and the lead line sits alone under THE TRAJECTORY with no panel, making the page shorter rather than longer / C2, Kevin's pick: the same idea as C but the outlook fact moves to the LEFT column under the card name instead of stacking under \"£X owed\" on the right, so both columns carry two lines instead of the right column carrying three, and the row shrinks back to the live page's height · names=raw|clean toggles a display-only name-cleaning proposal (title-cased shouty descriptors, last-4-digit suffixes to disambiguate the duplicate Mastercards), raw is the default and matches the live page exactly · variant c2 SHIPPED to the live /cards page (app/cards/CardsPage.tsx) on 2026-09-09, driven by real GET /cards/story outlook fields; this fixture-driven preview is kept in place for side-by-side comparison, not deleted · ?variant=a|b|c|c2&names=raw|clean&mode=light|dark",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "safe-to-spend-hero",
    name: "safe-to-spend-hero",
    description:
      "G14: Kevin approved the Proposed treatment 2026-09-09 and it shipped to the live components/SafeToSpendCard.tsx that same day — the hero is now always the cash position (safe_to_spend_cash, floored at £0), bills-short shows the cash gap in red (\"£42 short\"), cards-short still clamps to £0 amber, and both short states share one secondary line (\"£761 went on cards unpaid this period\") shown only when there is card growth to report; the old \"What makes up the safety gap\" bar/breakdown and the cards-short fallback sentence are gone from the live card. This preview is kept in place for comparison, not as live navigation — it is still a replica (not imported by the real card) showing Today (the now-superseded pre-G14 behaviour) alongside Proposed (what actually shipped), Today and Proposed stacked side by side · backend's net safe_to_spend is unchanged, still what Penny and Can I...? reason over · ?treatment=today|proposed|both&state=bills-short|cards-short|comfortable|tight&mode=light|dark",
    states: [
      { label: "Bills short", value: "bills-short" },
      { label: "Cards short", value: "cards-short" },
      { label: "Comfortable", value: "comfortable" },
      { label: "Tight", value: "tight" },
    ],
  },
  {
    slug: "invite-only",
    name: "invite-only",
    description:
      "D5: the real components/LoginScreen.tsx rendered with error=\"invite_only\" — the calm 'Sorted is invite-only right now' screen a refused sign-in shows instead of a bare 403, reached from the web callback's ?error=invite_only redirect or a native sign-in's INVITE_ONLY result",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "planning-ladder-timeline",
    name: "Planning checkpoint timeline · G187",
    description:
      "G187 approved B, skill: impeccable · Shared production PlanningCheckpointTimeline: one card per expanded completed/later group with 16px either side of its dividers · External rail, live figures, original detail/options and privacy retained · B imports the production component; A is the unselected comparison · ?variant=b|a&expand=done|later|all&scenario=buffer|debt|goals|done|empty|hidden|long|attention|neutral&mode=light|dark",
    variants: [
      { label: "A · Individual cards", value: "a" },
      { label: "B · Grouped cards", value: "b" },
    ],
    states: [
      { label: "Active buffer", value: "buffer" },
      { label: "Active debt", value: "debt" },
      { label: "Investing stage", value: "goals" },
      { label: "Hidden balances", value: "hidden" },
    ],
  },
  {
    slug: "planning",
    name: "planning",
    description: "Planning page revamp (taste + impeccable pass) · 3 art-direction variants (A ledger: banner merges into the TO LAST hero card, repeated culprit collapses to a per-row Why? toggle / B timeline: shortfall compresses to account chips + one footnote explanation / C brief: verdict as one sentence, disclaimer behind an info tap, list chunked into This week / Next two weeks / Next pay period) against the real Barclays £231.30 shortfall + repeated-culprit case",
    states: [
      { label: "Shortfall", value: "short" },
      { label: "Healthy", value: "healthy" },
    ],
  },
  {
    slug: "spend-verdict-a",
    name: "spend-verdict-a",
    description: "Spend A, verdict first: net line leads, Out/In/Moved demoted to a hairline row, ranked cards",
    states: [
      { label: "Normal", value: "normal" },
      { label: "Nothing", value: "nothing" },
      { label: "Everything", value: "everything" },
      { label: "No baseline", value: "nobaseline" },
      { label: "Early", value: "early" },
    ],
  },
  {
    slug: "insights-live",
    name: "insights-live",
    description: "STANDING design twin for Insights, kept even after the Insights page itself retired 2026-09-05 (owner phone report 2026-09-01, \"still empty cards\"; updated same-day for the cost-driven TTL reversal; extended 2026-09-02 for the money-shape redesign, then again same-day for Kevin's phone feedback — job rows link to real transactions not Planning, and (after a short-lived separate \"Over time\" block was retired the same day per Kevin's redirect) a period/average PICKER built into the hero itself) · renders the REAL exported components/InsightCard.tsx components (InsightCard, CompactInsightRow, isCompactPullInsight, InsightsHero) against fixture payloads shaped field-for-field like the live GET /savings-insights serializer output · one fixture per insight.state (fresh with the weekly-default expiry line, fresh with a dated-claim expiry line, quiet never-researched, quiet expired-since-last-pass, substituted, verified) plus the is_new invariant case · ALSO renders the real MoneyShapeHero/WhatWorksCard/ReferenceShapesRow (now app/spend/shape/) against MONEY_SHAPE_FIXTURES (GET /money-shape shaped fixtures, copy mirrors backend/app/services/money_shape.py's deterministic templates) independently selectable via its own `shape` param: ok_change (live Penny proposal, carries 8 periods + 3/6-month averages exercising the hero's own period/average picker sheet), ok_keep (trait kept, celebration chip), ok_nochoice (undecided trait, \"choose in your Mirror\" link), no_pattern (headline-only, no rows), thin (both cards fall back to their one-line placeholder), overspent (\"Beyond take-home\" row, no red, calm_start proposal) · closes the verification blind spot that let three prior fix rounds ship on code-trace alone, before this twin existed nobody ever rendered the pixels · ?mode=light|dark&state=all|fresh_weekly|fresh_claim|quiet_never_researched|quiet_expired|substituted|verified|is_new&shape=ok_change|ok_keep|ok_nochoice|no_pattern|thin|overspent",
    states: [{ label: "Everything", value: "all" }],
  },
  {
    slug: "month-story",
    name: "month-story",
    description: "Month in Review story · count-up scoped to the spending hero only, staggered category rows, per-card logo rows on Cards, three spotlight-glow variants (?variant=a|b|c)",
    states: [{ label: "Play", value: "everything" }],
  },
  {
    slug: "spend-hero-scale",
    name: "Spend hero type refinement · G186",
    description:
      "G186 typography B approved, skill: impeccable · B renders production SpendPaceHero with its quiet label, 30px Out and separate Usual caption · A is the unselected heading-led comparison · Figures, calculations and controls unchanged; G140 evidence also renders its production component · ?variant=b|a&state=phone|normal|early|nobaseline|long&mode=light|dark",
    variants: [
      { label: "A · Compact heading", value: "a" },
      { label: "B · Approved", value: "b" },
    ],
    states: [
      { label: "Phone example", value: "phone" },
      { label: "Below usual", value: "normal" },
      { label: "Long figures", value: "long" },
    ],
  },
  {
    slug: "spend-hero",
    name: "Spend hero consistency · G186",
    description:
      "G186 original hero round, skill: impeccable · A renders the latest production SpendPaceHero, now refined by the approved B typography round at /design/spend-hero-scale · B and C retain the previous SpendJourneySummary for comparison · Evidence sections here remain illustrative; the approved G140 preview renders the production pace ledger · Sticky journey navigation retained · ?variant=a|b|c&state=normal|everything|nothing|nobaseline|early|closed|unplaced|nomoved|empty|loading|error|long&mode=light|dark",
    variants: [
      { label: "A · Pace instrument", value: "a" },
      { label: "B · Existing summary", value: "b" },
      { label: "C · Canvas control", value: "c" },
    ],
    states: [
      { label: "Below usual", value: "normal" },
      { label: "Above usual", value: "everything" },
      { label: "No baseline", value: "nobaseline" },
    ],
  },
  {
    slug: "spend-live",
    name: "spend-live",
    description: "Spend page · fixtures reference (real components)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-pace-copy",
    name: "Spend pace explanation · G140",
    description:
      "G140, skill: impeccable clarify · Approved A renders the production SpendPaceEvidence with invented fixtures; B remains an unselected copy proposal · Coordinated with G186: the hero speaks the pace verdict once, the named-category ledger explains the signed difference and calculated remainder · Existing arithmetic and backend unchanged · ?variant=a|b&state=under|over|level|balanced|unplaced|long|none|baseline&mode=light|dark",
    variants: [
      { label: "A · Named ledger", value: "a" },
      { label: "B · Short explanation", value: "b" },
    ],
    states: [
      { label: "Below usual", value: "under" },
      { label: "Above usual", value: "over" },
      { label: "Still learning", value: "baseline" },
    ],
  },

  // ── Earlier rounds (2026-08-05 to 2026-09-02) ──────────────────────────
  // Older preview directories that still render but predate the current
  // surface map. Kept indexed rather than deleted so they stay reachable
  // and check:design-index has no untracked directories to flag.
  {
    slug: "account-detail",
    name: "account-detail",
    description:
      "Redesigned account-detail view as a mini statement, balance-forward header, no dead space, Transactions and Categories tabs. See accounts-preview for the index (2026-08-16)",
    states: [{ label: "Everything", value: "everything" }],
    group: "earlier",
  },
];

const CURRENT_ROUTES = ROUTES.filter((route) => (route.group ?? "current") === "current");
const EARLIER_ROUTES = ROUTES.filter((route) => route.group === "earlier");

function PreviewCard({ route }: { route: PreviewRoute }) {
  const defaultVariant = route.variants?.[0]?.value;

  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <div className="text-sm font-semibold text-slate-900 dark:text-white">
        {route.name}
      </div>
      <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
        {route.description}
      </div>

      {route.variants && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Variants</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {route.variants.map((variant) => (
              <Link
                key={variant.value}
                href={`/design/${route.slug}?mode=dark&state=${route.states[0].value}&variant=${variant.value}`}
                className="inline-flex min-h-[44px] items-center rounded-full bg-indigo-50 px-3.5 py-2 text-[11px] font-semibold text-indigo-600 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-300"
              >
                {variant.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`${route.variants ? "mt-2" : "mt-3"} flex flex-wrap gap-2`}>
        {route.states.map((s) => (
          <Link
            key={s.value}
            href={`/design/${route.slug}?mode=dark&state=${s.value}${defaultVariant ? `&variant=${defaultVariant}` : ""}`}
            className="inline-flex items-center min-h-[44px] rounded-full px-3.5 py-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15 active:scale-95 transition-transform"
          >
            {s.label}
          </Link>
        ))}
      </div>

      <div className="mt-2">
        <Link
          href={`/design/${route.slug}?mode=light&state=${route.states[0].value}${defaultVariant ? `&variant=${defaultVariant}` : ""}`}
          className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2"
        >
          light
        </Link>
      </div>
    </div>
  );
}

export default function DesignIndexPage() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">
          Design previews
        </h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Temporary review builds. Newest first.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {CURRENT_ROUTES.map((route) => (
            <PreviewCard key={route.slug} route={route} />
          ))}
        </div>

        {EARLIER_ROUTES.length > 0 && (
          <>
            <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Earlier rounds
            </p>
            <div className="mt-3 flex flex-col gap-3">
              {EARLIER_ROUTES.map((route) => (
                <PreviewCard key={route.slug} route={route} />
              ))}
            </div>
          </>
        )}

        <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
          These routes are deleted after review.
        </p>
      </div>
    </div>
  );
}
