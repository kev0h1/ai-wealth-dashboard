# G288: one disclosure indicator

This is a direct consistency fix, not a new design round. Existing content,
financial calculations, forms and native disclosure behaviour stay unchanged.

- Native disclosures use `DisclosureSummary` from `components/Disclosure.tsx`.
  It renders a real summary, forwards its ref and native attributes, suppresses
  the browser marker in both marker implementations and adds one Lucide icon.
- Controlled inline disclosures use `DisclosureChevron` with their own open
  state. It does not own or change their button semantics or handlers.
- Both use a 16px ChevronDown, slate-500 in light mode and slate-400 in dark
  mode, and a 150ms transform transition disabled for reduced motion. The
  explicit `inverse` prop uses white on an inverted action surface. Callers
  cannot override size, colour or rotation with local classes without failing
  the regression check.
- Native rotation is scoped to `details[open] > .disclosure-summary >
  .disclosure-chevron`. An open ancestor never rotates a closed child's icon.
- Navigation, select controls, date-view selectors and chart ordering are not
  inline disclosures and retain their existing affordances.
- `check:disclosure-consistency` parses all app and component JSX, including
  design previews. The shared helper is the sole native-summary owner. Tests
  also exercise parser edge cases, native attributes and controlled rotation.

The already reviewed G286 and G287 preview commits are feature-branch merge
prerequisites so this app-wide guard covers them too. Their design rounds still
require Kevin's choices. No production choice from either ticket is folded in.

Verification uses the real Upcoming edit form, Upcoming hero calculation and
Spend hero calculation through existing fixture previews, with API writes
blocked. Browser evidence is preview evidence, not authenticated product
screenshots. An independent source review checks the production diff as well.

This extends the incumbent Calm Cockpit component system. It does not replace
the design system or introduce new colour, typography or layout tokens.

## Review record

The production build, disclosure parser/render checks and existing G176,
G187 and G281 regression tests passed. The app-wide guard checks 421 source
files. Lint comparison against the feature baseline found 48 existing findings
across the 64 changed TSX files and no new findings; unrelated lint debt is not
repaired by this item.

Seventeen browser captures cover the real Edit prediction form, Upcoming
calculation and Spend calculation open/closed at 390px in both themes, plus
320px, desktop and a test-only nested clone of real helper markup. Computed
icons are 16 by 16 pixels. Enter/Space, native marker suppression, independent
nested rotation and effectively zero reduced-motion duration passed. There
were no browser page errors or preview API writes. This is Chromium fixture
evidence, not a claim of authenticated-page or Safari/device testing.

An independent source review caught and then verified the removal of old
preview size overrides. A fresh manual finish reviewer returned
`disposition: ship`, and the documentation audit recommended no system
changes. The automated style detector was unavailable and supplied no verdict.
PRODUCT.md and DESIGN.md are preserved.
