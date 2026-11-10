# G450 category icons

Kevin approved A Suggested icons in chat on 2026-11-10. This production fold-in
uses impeccable extract, Better Icons and web-design-guidelines in Operate mode.
The original preview round is recorded in the board and git history. The
approved preview is retired under H113 after integration into production code.

## Direction contract

THESIS: a category has one recognisable identity wherever it appears. An
automatic icon needs no work; changing it remains a small optional task.

OWN-WORLD: inherit the Calm Cockpit, existing category tints and contextual
glyph/tile sizes, neutral ink, Figtree, mono money and the shared solid
SheetFrame. Category colour communicates identity. The Penny gradient and
navigation appearance remain their own systems.

STORY: recognise a category, open Change icon, see its suggested or chosen
icon, change it if needed, then explicitly save. Cancel, Escape and Back
discard the draft. Creating a category uses the same picker. Editing its draft
name updates an automatic suggestion and preserves a manual choice.

FIRST VIEWPORT: the category evidence keeps its existing header and figures.
A custom category adds one Change icon action. Its editor leads with the
current icon and relevant choices, with Save icon and Cancel in the fixed
footer. The body scrolls independently on phones and desktop.

FORM: approved A keeps suggestions and searchable browsing in one editor.
There is no separate icon-browser sheet. This extends the existing interface,
so no replacement visual world, seed roll or raster comp applies.

FINISH: production source, captured production-component fixtures, independent
review, DESIGN.md, original vector provenance and the repository finish gates
are the delivery evidence. A preview capture is never evidence of production.

## Shared identity

`shared/category-icons.json` is the frontend/backend contract: 53 finite keys,
all 22 built-in categories, semantic aliases, keyword rules, related choices
and explicit legacy-key translations. Energy, Mobile and Business are semantic
examples, not additional built-ins. Golf uses golf; Padel uses racquet.

`frontend/lib/categoryIcons.ts` renders original Phosphor regular contours
through the existing component API. Original vectors, hashes, source URLs and
the MIT notice live in `frontend/lib/category-icons/`. Geometry is bundled,
with no runtime icon dependency or fetch. All shared category consumers inherit
the replacement; separate insight, tutorial, teaching and movement references
use the same resolver. Operational icons and account-type identities retain
their existing meaning.

## Saved choices and assignment

Each custom record stores `icon_key` and `icon_source: auto | user`.
`GET /categories` adds `icons` and `icon_sources` while retaining the original
name arrays and kind map. POST optionally accepts a manual bundled key.
Authenticated PATCH `/categories/icon` requires an explicit key or null to
restore automatic selection. Built-ins and another user's categories cannot
be edited through this endpoint. Invalid keys are rejected.

Automatic assignment matches deterministic keywords first. Only an unmatched
creation or explicit automatic reset can call the existing low-cost gateway,
with the finite key allowlist, a four-second HTTP timeout and a 4.5-second
overall deadline. Missing configuration, invalid output, failure or timeout
persists a neutral tag. Rendering and GET never call the model.

The startup kind migration precedes icon backfill. Backfill preserves raw
records and unrelated metadata, translates valid legacy keys, uses raw-array
CAS retries and keeps concurrent manual choices. Historical unmatched names
share one six-second model budget for the whole backfill; later names receive
the neutral tag. It is idempotent. Worktree verification never runs it on UAT.

The category serializer retains icon metadata through kind edits, reset,
repeated creation and unrelated deletion. Icon-only writes leave financial
cache invalidation and the category-group revision unchanged. A slow automatic
reset returns 409 if the target kind or icon changed meanwhile, preserving
the newer choice. An explicit manual choice remains authoritative.

The client serialises category writes, rejects stale reads, isolates provider
state by signed-in account and prevents queued writes after account unmount.
Server-saved custom metadata wins over the old unscoped device-local store.
Valid built-in device choices are translated and retained; unattributable
custom device values are neither uploaded nor applied to another account.

## Scope

The app has no existing used-category rename feature. G450 implements icon
customisation and the name-edit behaviour of an unsaved creation draft.
General renaming would require a separate supported migration of transaction,
plan and other references; this change does not simulate it with create/delete
or introduce a partial rename endpoint. This scope was raised in chat and
recorded on the board while proceeding with the approved icon work.

## Verification

Focused backend coverage checks all built-ins, keyword and model choices,
malformed metadata, authenticated API validation and isolation, persistence,
kind-edit retention, idempotent raw-record backfill, CAS races and both delayed
automatic-reset conflict cases. The frontend gate renders all 53 regular
vectors, checks canonical and legacy resolution, saved overrides and explicit
manual/reset API payloads.

Production-component browser checks use a temporary auth-exempt route with
fictional fixtures and intercepted API responses. The route is removed before
submission. Phone and desktop, both themes, 320px long names, signed masking,
search, keyboard focus, cancel/save/reload, name edits, unavailable categories
and read/write recovery passed 17 browser interaction checks. All 15 captures
were read at original detail. The reload sequence also exposed a shared sheet
history ID collision; a per-module random prefix now prevents old entries
matching new sheets. Negative totals use the currency minus before the symbol
so Hide balances masks their absolute value while retaining the sign. Full finish results
and the final review disposition are recorded on the board.

The Impeccable context launcher ran successfully for this fold-in. Dedicated
skill agent roles are unavailable in this harness; fresh generic reviewer and
documenter agents receive their supplied contracts. The coordinator owns main
integration and UAT deployment.
