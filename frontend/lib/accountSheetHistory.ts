// History-state contract for the Accounts page's account-detail sheet — a
// same-URL state switch (see app/components/AccountsPage.tsx's
// handleSelectAccount/handleBack), not a real route navigation.
//
// G116: the entry pushed on open used to carry ONLY `{ accountDetail: id }`,
// with no spread of the outgoing entry's existing state. That silently
// dropped whatever ScrollReset.tsx (lib/scrollNavDetect.ts) had already
// stamped on the /accounts entry (`__wdNavSeq`), so a later traversal back
// onto this entry — e.g. open the detail sheet, navigate to another route,
// press back — read as a FRESH push rather than a POP (the stamp's PRESENCE
// is ScrollReset's whole signal, see lib/scrollNavDetect.ts), and
// ScrollReset scrolled the accounts list back to the top instead of
// restoring the remembered position. lib/useSheetA11y.ts's own
// `history.pushState({ ...(history.state ?? {}), __sheetA11yId: id }, "")`
// (H71) already gets this right by spreading `history.state` first; this
// module gives the Accounts page the same contract as an importable,
// independently testable function rather than reinventing it inline.
//
// Extracted to its own file (rather than left inline, the way
// useSheetA11y.ts does it) purely so it can be unit tested without
// rendering the whole page component — see scripts/account-sheet-history
// .test.mjs — matching the pattern lib/scrollNavDetect.ts already set for
// this exact class of bug (G108).

/** The state to push when opening the account-detail sheet: whatever the
 *  current entry already carries (e.g. ScrollReset's `__wdNavSeq` stamp),
 *  plus the `accountDetail` marker this page's own popstate handler and
 *  `handleBack` read to know a pushed entry exists. */
export function stampAccountDetailState(
  currentState: unknown,
  accountId: string
): Record<string, unknown> {
  const base =
    currentState != null && typeof currentState === "object"
      ? (currentState as Record<string, unknown>)
      : {};
  return { ...base, accountDetail: accountId };
}

/** True when the CURRENT history entry is one `stampAccountDetailState`
 *  pushed, meaning a close should consume it via `history.back()` so the
 *  system/hardware back gesture and the in-app close affordance stay on
 *  the same path. False for any entry this module never pushed — most
 *  notably a deep link (`/accounts?id=X`), which opens the detail view
 *  without ever pushing an `accountDetail` entry — so closing there just
 *  clears local state instead of calling `history.back()` on an entry it
 *  doesn't own. */
export function hasAccountDetailEntry(currentState: unknown): boolean {
  return (
    currentState != null &&
    typeof currentState === "object" &&
    Boolean((currentState as Record<string, unknown>).accountDetail)
  );
}
