# G267 plan editor preview

This is a code-led design round for the goal and set-aside editor. It is a
fictional, auth-exempt preview: production editors and financial engines keep
their current behaviour until Kevin chooses a direction.

## Variants and launch parameters

- **A, Editable summary:** contribution, affordability reading, details, money
  route and transfer recognition are visible in one sheet. Each section opens
  an in-sheet editor and returns focus to the changed row.
- **B, Three short steps:** details, accounts, then tracking, with a persistent
  footer and a final confirmation. The draft remains in the same sheet.

The preview reads these URL parameters (and the launcher writes them):

| Parameter | Values | Meaning |
| --- | --- | --- |
| `variant` | `a` or `b` | Art direction, default `a` |
| `kind` | `goal` or `set-aside` | Editor example, default `goal` |
| `state` | `suggested`, `tight`, `no-match`, `unassigned`, `partial` | Fixture situation; `fixture` is accepted as a legacy alias |
| `mode` | `light` or `dark` | Theme, default `light` |
| `open` | `0` or any other value | `0` leaves the sheet closed; other values open it |

Example: `/design/plan-editor?variant=b&kind=set-aside&state=partial&mode=dark&open=1`.

## Incumbent primitives and preview-only work

The preview composes these production primitives and helpers: `SheetFrame`,
`AccountRadioPicker`, `BankBadge` and `accountBrand`, `DateField`,
`RhythmToggle`, `tidyAccountText`, and the shared `Account` type. The slate
surface, Figtree/mono money treatment, indigo controls, bank badges, account
picker, rhythm toggle, date field, focus handling and sheet navigation therefore
follow the incumbent system described in `DESIGN.md`.

New code is limited to preview orchestration and fixture presentation:
`PlanEditorPreview.tsx` owns draft state, variant navigation, validation,
scenario states, confirmation-only saving, and the local editor views;
`editor.module.css` supplies the preview layout; `fixtures.ts` supplies
fictional data and a deliberately small transfer-ranking example. No live API
or bank call is made, and the apparent save changes only preview state.

## Fixture and money semantics

The fixture contains six bank accounts, five receiving pots, and exactly forty
synthetic transactions. It includes recurring and one-off transfers, purchases,
income, an adjustment, an excluded source account, and a manual savings pot so
the picker and density states are credible without using user data.

The proposal distinguishes two routes:

- A **goal** has a target and pot. Its recognition example follows the current
  goal convention: match the outgoing debit from the paying account.
- A **set-aside** has no target or progress and may stay in its paying account.
  Its optional receiving-account recognition illustrates the current allocation
  convention: match the inbound credit. A source-only, sink-less set-aside is
  proposed as a tracking framework, not shipped fulfilment behaviour.

`rankedTransfers` is preview-only, filters selected sinks to amounts within 15%
and ranks by distance, occurrence count, then date. It is not the production
matcher or an engine, and suggestions require explicit confirmation. The UI
never claims to schedule or move money; one matching transfer is counted once.

## H113 and review hand-off

Keep this preview while the design choice is under review. After the approved
variant is folded into production, delete this directory and its design index
entry under H113, unless an active item, approval/compliance pack, or marketing
output still references it.

## Verification status

Current browser confirmation passed: all 15 valid combinations produced
captures at 390px in both themes, 320x740, 390x500, and 1440px. The interaction
checks passed for editing name/target, changing source and resetting its
candidate, hiding cards and excluded sources, purchase filtering/search,
explicit local save, the real nested `DatePicker`, goal versus no-target
set-aside, missing-rule/unassigned validation focus, partial-period choice,
Tab/Escape, and the API guard.

Scoped ESLint, TypeScript, `check:design-index`, strict `check:design-stale`,
and the production build passed. The full production browser matrix also
passed, including explicit focus assertions for details, source, destination,
and tracking. Variant A's focus return now uses semantic return keys and fresh
queries for the mounted control, avoiding stale references when the summary
unmounts. The earlier independent review accepted the visual and financial
boundaries; the focused verdict scored the focus-return correction resolved.
That final verdict covers the named focus issue only.

Still untested are physical-device keyboard behaviour, swipe gestures, and
back navigation. The contribution and affordability figures are fixture-only
estimators, not a replacement financial engine. The Impeccable launcher and
detector were unavailable because permission was denied. Specialised skill
roles were unavailable, so a fresh implementation reviewer is the substitute
hand-off. `DESIGN.md` and `.impeccable/design.json` remain unchanged and
authoritative.
