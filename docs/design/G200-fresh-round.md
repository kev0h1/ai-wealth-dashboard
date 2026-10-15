# G200 fresh cover-plan safeguards round

## Verified product and engine facts

This is a Settings permission editor, not a transfer flow. The one saved
choice is the account allow-list: an account is allowed unless its id is in
`cover_plan_excluded_accounts`. Toggling persists through the existing,
serialised preferences update. Penny can also update that same preference.

The source finder, not the setting, decides whether an allowed account can
help at a particular time. Its fixed rules are:

- Current accounts are considered before savings. Savings are considered only
  after the allowed current accounts together cannot cover the gap.
- Within a class, the finder uses the highest headroom first and prefers the
  fewest source accounts. At equal headroom, a connected account comes before
  a manually managed one.
- Every source keeps a fixed £10 buffer. Its own bills, reservations and
  relevant income are included in the underlying headroom calculation.
- A manual account belongs to its actual current or savings class. It is not a
  third source class. If it is selected, the person makes the transfer.

`account_eligibility[id].short` is a standing engine result, independent of
whether a live move happens to be on screen. It means the source finder cannot
use the account at present: its headroom is below £5 after the £10 buffer and
reservations, or, defensively, a current account's own running minimum is
negative. A zero balance is a separate present-availability condition. Neither
condition changes the person's saved permission and neither is a financial-risk
signal on its own.

## Existing contract and preview truth

The production component accepts:

```ts
CoverPlanSourcesCard({
  accounts,
  excludedIds,
  liveRoute?,
  shortAccountIds?,
  hideAmounts?,
  onToggle,
})
```

The existing preview at `/design/cover-plan-safeguards` carries the same
contract through safe fixtures. Its A, B and C variants deliberately ignore
`liveRoute`; the `now` comparison renders the shipped component. The existing
query contract is:

```text
?variant=a|b|c|now&state=default|all|none|stuck&estate=std|long&frame=inline|page&mode=light|dark
```

The fresh directions will retain A to C as references, add D to F, and default
to D. Fixture callbacks remain local state only: no API request is allowed.

The scoped code was compared with the incumbent `CoverPlanSourcesCard`,
`AccountMiniCard` (`BankBadge`), `Toggle`, `SheetFrame`, `sourceClass` and
`PreferencesContext` contracts. D and E keep the shared account row, bank
identity, search and real toggle primitives; F adds the real sheet shell. The
preview accepts production-shaped props and deliberately keeps `liveRoute`
ignored, so no live move is implied. This is composition evidence, not a QA
pass.

The Impeccable helper and launcher/seed detector were unavailable (permission
denied). No replacement identity or undocumented key was invented.

## Design guardrails for D to F

- Make the permission choice unmistakable. A present-availability note must
  leave the toggle operable and must not become a separate skipped bucket.
- State the ordering and £10 buffer as fixed facts, not editable controls or
  numerical counters.
- Show red only for the genuine no-permitted-source case: no account is allowed
  to cover a future gap.
- Do not render a live move, a transfer amount, completion state or an
  automated-transfer implication in Settings. Upcoming owns today's suggested
  move; an in-flow link may take the person there.
- Keep account balances, when shown, distinct from an amount that could be
  moved.
- Retain real `Toggle` and `BankBadge` primitives. Search, selection, save
  status, empty state and error state must work against fixtures.

## Chosen direction contract

This is a code-led extension of the existing Calm Cockpit Settings surface.
It keeps the canvas-led explanation and uses one bounded work surface only
where account editing needs it. There is no new identity, imagery or raster
asset.

### D: Account directory

The default direction starts with the saved choice in plain language: allow an
account to appear in cover suggestions, while the person decides whether to
move money. A stable, searchable directory follows, grouped Current then
Savings. Each row keeps its permission control even when it cannot spare money
today; availability is a neutral caption, separate from the control. At
desktop size, short fixed-rule guidance sits beside the directory rather than
becoming counters inside it.

### E: Bank folders

This direction treats a provider as the browsing unit. Search opens only
matching provider folders and clearing it restores the person's disclosure
state. It does not show numerical permission counters. The desktop form adds a
quiet provider index and selected content; smaller layouts keep native
disclosures. Each row retains the same direct permission control and neutral
availability note as D.

### F: Allowed list and account editor

This direction makes the saved allowance legible first, including accounts
that are allowed but cannot spare money at present. `Edit account permissions`
opens a real `SheetFrame` with a searchable all-account list. Controls take
effect in fixture state immediately; `Done` simply closes the sheet rather
than pretending there is a second submit operation.

All directions use in-flow preview controls so they never obscure the accounts
or the sheet footer. The default is D. A to C and the shipped comparison stay
available as earlier references.

## Six-block direction contract

**THESIS:** Make the saved permission legible without confusing it with
today's availability or a transfer.

**OWN-WORLD:** Preserve the Calm Cockpit canvas, Figtree body, mono/tabular
money, slate surfaces, neutral bank identity and indigo actions. Use shared
`Toggle`, `BankBadge` and `SheetFrame` primitives.

**STORY:** Choose which accounts may appear in cover suggestions, understand
the fixed ordering and buffer, then follow today's suggestion in Upcoming.

**FIRST VIEWPORT:** D leads with purpose and the account directory; E leads
with provider browsing; F leads with the saved allowed list and its editor.
This changes local composition only, not global product identity.

**FORM:** Keep the permission control available for every account, including
an allowed account that cannot spare money today. Availability is neutral; only
the genuine no-permitted-source case receives risk treatment.

**FINISH:** Scoped fixes are shipped at prototype scope after root's recorded
desktop/browser verification. This does not claim a user pick or production
fold-in.

## Plain-language copy baseline

- Label: `Cover-plan safeguards`
- Primary heading: `Choose accounts for cover`
- Ledger heading: `Accounts allowed for cover`
- Fixed-rule summary: `Current accounts first. Savings only if needed. Suggestions leave a £10 buffer after the account’s own bills and plans.`
- Present availability: `Cannot spare anything today` or `Empty today`
- Genuine risk: `No accounts are allowed to cover a future gap.`
- Cross-surface route: `See today's suggestion in Upcoming`
