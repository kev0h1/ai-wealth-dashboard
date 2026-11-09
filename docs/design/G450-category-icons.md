# G450 category icons

Status: design round for Kevin's choice. The production replacement and
account-saved icon choices follow approval. Mode: Operate. Skills: impeccable
extract, Better Icons, web-design-guidelines. The Impeccable context launcher
was not executable, so PRODUCT.md and DESIGN.md were read directly.

The brief fixes the icon family, regular weight, existing tile dimensions and
colours. This round resolves how a person changes a custom category's icon.
Both proposals use the same 53 original Phosphor vectors, 22 built-in mappings
and shared preview renderer. Energy, Mobile and Business are custom examples,
not new built-in categories. Golf and Padel receive specific sporting icons.

## Direction contract

THESIS: a category has one recognisable identity wherever it appears. An
automatic icon needs no work; changing it remains a small optional task.

OWN-WORLD: inherit the Calm Cockpit, existing category tints and sizes, neutral
ink, Figtree, mono money and the shared solid SheetFrame. Category colour
communicates identity. There is no new visual world or Penny gradient.

STORY: recognise a category, open it, see its suggested or chosen icon, change
it if needed, then explicitly save. Cancelling discards the draft. A chosen
icon survives rename; an automatic one follows the new name.

FIRST VIEWPORT: a plain review toolbar precedes a compact category directory.
Custom categories lead with an Add category action; the full built-in set and
context examples remain available below. Desktop uses columns with a bounded
reading width. Sheets keep their title and actions fixed while content scrolls.

FORM: A Suggested icons offers matching choices within the category editor;
B Browse icons has a separate searchable icon sheet and a cancellable draft.
This is a local extension of the existing interface, so no visual-world seed
applies. Preview URLs accept variant, mode and state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance. DESIGN.md remains the existing authority; this round ships vectors
and makes no production design-system change.

## Preview boundary

`/design/category-icons` uses fictional records and an isolated, versioned
preview storage key. A local save demonstrates retention on this device only.
It does not claim to save to a user account. No category API, model, production
preference or live financial data is called or changed. Source provenance and
the complete MIT notice live beside the bundled vectors.

The examples demonstrate intended shared identity across Spend, Biggest
impact, Upcoming, its account sheet, transactions/search, category selection,
teaching, Penny, tutorial category references and Planning. They are evidence
of the proposal, not of a completed production migration.

## Production fold-in contract

- Replace `frontend/lib/categoryIcons.ts` with the approved shared Phosphor
  regular catalogue. Preserve or translate legacy local icon keys explicitly.
  Keep category tints and existing contextual glyph/tile sizes. Audit every
  consumer, including separate insight and tutorial mappings, hardcoded
  category glyphs, and financial event identities in Upcoming.
- Keep built-in taxonomy and financial kinds unchanged. Icon assignment never
  changes whether money is spending, movement, income or not counted.
- Add `icon_key` and `icon_source: auto | user` to each custom category record.
  Extend both `parse_stored_categories` and the router's `_cas_update`
  serialiser, which otherwise discard new fields during any category write.
  Group edits, resets, repeated creates and unrelated deletes preserve them.
- Extend `/categories` additively with saved icon metadata; keep its existing
  name arrays and kind map compatible. Authenticate and allowlist icon writes
  per user. User-selected icons take precedence over automatic choices.
- Match deterministic keywords first. Only an unmatched name/kind can invoke
  the existing low-cost model gateway with a finite bundled-key allowlist and
  a bounded timeout. Reject unknown results; persist the neutral tag on
  unavailable, invalid or failed inference. Never fetch icons at runtime.
- Backfill legacy custom records idempotently with an explicit migration and
  raw-array CAS, preserving concurrent changes. GET must remain read-only.
  Do not run migrations from an unmerged worktree against live data.
- There is no category rename endpoint today. Add an explicit supported rename
  path with ownership, collision validation and propagation to existing
  category references. Preserve a user-chosen icon; recompute an automatic
  one. Do not simulate rename as create-and-delete or relabel only metadata.
- Keep icon-only changes out of the category-group revision, whose job is to
  guard kind changes. Reconcile account metadata with existing device-local
  `cat_icons` choices without allowing stale local values to mask saved data.
- Cover every built-in mapping, custom Golf/Padel creation and saved reuse,
  user-choice retention on rename, malformed model/client keys, legacy
  backfill, concurrent icon/group updates and user isolation with tests.

## Delivery checks

Before submission: inspect captures at 390px and desktop in both themes,
exercise create/rename/manual choice/cancel/reload and recovery, verify every
built-in and bundled source, run an independent review against DESIGN.md and
the Web Interface Guidelines, and complete the repository finish gates with
`--uat-review`. The coordinator publishes the preview to UAT for Kevin's
choice. Production component integration occurs on a fresh approved session.

Verified in this round: every backend built-in maps to a bundled key; all 53
vector path sets and source hashes match the original Better Icons payloads.
The phone and desktop matrix covers both variants and themes, with an extra
320px long-name case. All 16 captures were inspected at original detail by
the root and independent reviewer. Behaviour checks cover automatic and manual
choices, return to suggestion, rename, reload, cancellation, child-sheet
drafts, Tab containment, browser Back and focus return, collisions, recovery
from failed reads/writes, explicit reset confirmation, hidden money and
unavailable lists. No live API or external requests or page errors occurred.

The independent finish review's final disposition is ship, including the
extra save-failure and 320px captures. Its initial dark-button observation was
withdrawn after the same original images were re-opened; no product change was
made for that capture-reading error. A separate documentation check preserves
the incumbent DESIGN.md. Fresh [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)
review, TypeScript, scoped ESLint, design index/stale checks and one Impeccable
detector run pass. Dedicated skill agent roles were unavailable, so fresh
generic reviewer and documenter agents used their supplied role contracts.
The full repository finish gate remains the delivery requirement.
