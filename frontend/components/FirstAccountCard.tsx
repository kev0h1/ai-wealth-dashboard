"use client";

/** The "nothing connected yet" card. One component, two call sites (the
 *  fresh-user hero and the "Your estate" empty state), because those two had
 *  drifted into near-identical copies of the same markup and only one of
 *  them was ever going to get fixed.
 *
 *  A67 — tier: `canConnect` decides whether Connect a bank is offered at
 *  all. The Statements plan has no open banking (the server answers those
 *  connect endpoints with a 402), so offering the button there was an
 *  invitation to a dead end. While the plan is still resolving the card
 *  shows the upload route, which every plan has, and Connect appears once it
 *  is known to be available — additive, so no control ever flashes up and
 *  disappears. See lib/openBankingAccess.ts.
 *
 *  A67 — provider: `onConnect` opens the Finexer bank picker rather than
 *  requesting a connect link directly. The direct call would have gone to
 *  `api.finexerConnectLink(undefined)`, i.e. `create_consent(provider=None)`,
 *  which POSTs /consents with no provider at all — a shape no previously
 *  live caller ever used (the picker passes `bank.id`, ReconnectStrip passes
 *  `provider_id`, and the only zero-argument caller before A67 went to
 *  TrueLayer). Choosing the bank first keeps this button on the exact path
 *  Accounts already uses, instead of betting the single most important
 *  button in the app on an unverified Finexer API shape.
 *
 *  G135 — route: every path out of this card used to be the bank-connect
 *  OAuth flow, and Home suppresses the whole "Your estate" block (with its
 *  "Manage" link) for a fresh user, so a user who could not or did not want
 *  to connect a bank had no way to reach /accounts at all, which is where
 *  statement upload and offline accounts live. The secondary link below is
 *  that missing door.
 *
 *  G135, the rest of the audit, recorded so nobody repeats it: Planning's
 *  own dead-end was fixed too (app/planning/GrowPanel.tsx's empty ladder was
 *  a paragraph telling the user to connect an account, with no link). Spend
 *  (app/components/SpendPage.tsx) and Upcoming (app/planning/PlanningPage.tsx)
 *  were checked and deliberately left alone: neither has any notion of a
 *  fresh user at all — both fetch accounts but never test `.length`, and
 *  their empty states are about a pay period having no data, not about
 *  having nothing connected. Giving them one is a new empty state needing a
 *  design round, not a route fix. Outside Home, /accounts is also absent
 *  from BottomNav and Sidebar, Settings only scroll-anchors to an in-page
 *  section, and lib/pennyScreenConfig.tsx carries its "Your accounts" link
 *  in the `home` config only — all IA decisions for Kevin, not this item.
 *
 *  Extracted to its own file (G135, 2026-09-28 re-review): this component
 *  takes no hooks and no data of its own, everything arrives as props, which
 *  makes it the smallest piece that can be rendered outside HomePage's own
 *  fetch-and-context tree. scripts/fresh-user-accounts-route.test.mjs
 *  renders it directly to pin the "Other ways to add accounts" door; the
 *  destination itself (`onOtherWays={() => router.push("/accounts")}`) is
 *  still wired by the caller, so that check also reads HomePage.tsx's own
 *  source for the literal wiring rather than pretending a mock callback
 *  proves where the real one goes. */
export default function FirstAccountCard({
  canConnect,
  onConnect,
  onUploadStatement,
  onOtherWays,
  tutorialId,
  ctaTutorialId,
}: {
  canConnect: boolean;
  onConnect: () => void;
  onUploadStatement: () => void;
  onOtherWays: () => void;
  tutorialId?: string;
  ctaTutorialId?: string;
}) {
  return (
    <div data-tutorial-id={tutorialId} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5">
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
        {canConnect ? "Connect your first bank" : "Add your first account"}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-snug">
        {canConnect
          ? "Read-only access through open banking, we can never move your money."
          : "Your plan works from statements you upload. Add one to get started, or track an account yourself."}
      </p>
      <button
        onClick={canConnect ? onConnect : onUploadStatement}
        data-tutorial-id={ctaTutorialId}
        className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4"
      >
        {canConnect ? "Connect a bank" : "Upload a statement"}
      </button>
      <button
        onClick={onOtherWays}
        className="w-full min-h-[44px] mt-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
      >
        Other ways to add accounts
      </button>
    </div>
  );
}
