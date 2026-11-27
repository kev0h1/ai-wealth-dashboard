# G484 Phosphor icon migration

G484 replaces the remaining app-level Lucide imports with the shared
[`phosphorIcons.tsx`](../../frontend/lib/phosphorIcons.tsx) registry. The
registry bundles original Phosphor Thin, Light, Regular and Bold SVG paths
from Iconify's `ph` collection, the source documented by Better Icons,
retrieved on 27 November 2026. The paths are not redrawn or normalised. They
retain the 256px viewBox, `currentColor`, forwarded refs and SVG props.
The vectors remain available under the existing [Phosphor MIT notice](../../frontend/lib/category-icons/PHOSPHOR-LICENSE.txt).

The existing navigation and category registries remain the authority for their
special cases: navigation continues to use regular, fill or duotone according
to the approved appearance, and category identities retain their own original
regular geometry. G484 covers general operational icons, whose prior Lucide
calls were outline-like, so Regular is the default Phosphor weight. The
original-size default deliberately matches the established regular-weight
navigation geometry.

## Compatibility policy

Every export is an individual pure component closure over its own geometry.
This avoids a dynamic, monolithic icon lookup retaining every vector in a
route bundle: an unused named export can be removed by the normal ESM tree
shaker. The SVG renders caller children before its React path children, so a
labelled use such as `<Icon><title>…</title></Icon>` remains
valid and does not conflict with injected markup. Ordinary icons remain
decorative with `aria-hidden="true"`. A non-empty direct `<title>`,
`aria-label` or `aria-labelledby` instead makes the SVG labelled with the
default `role="img"`; explicit `aria-hidden` and `role` values always win.

The source had several intentional Lucide `strokeWidth` calls. G484 does not
draw an artificial stroke over filled Phosphor paths. It selects source-native
geometry instead: 1.5px or below is Thin, 1.51-1.9px is Light, 1.91-2.49px is
Regular, and 2.5px or above is Bold. This keeps the existing 1.75px quiet
icons light and the 2.5px, 2.75px and 3px confirmation marks bold. An
`absoluteStrokeWidth` prop is retained as an SVG data marker and uses the same
fixed native-contour tier at every rendered size. It intentionally does not
simulate Lucide's pixel-stroke scaling on a filled contour.

## Mapping

The exported aliases preserve call sites while selecting the closest Phosphor
meaning. The registry is the exact one-to-one mapping and has `data-phosphor-icon`
on every rendered SVG for review.

| Prior family | Phosphor geometry |
| --- | --- |
| Chevron directions | Caret directions |
| Warning, alert and triangle alert | Warning Circle or Warning |
| Refresh, rotate and undo | Arrows Clockwise, Arrow Counter Clockwise or Arrow U Up Left |
| Landmark, Building, Wallet Cards | Bank, Buildings, Cards |
| Calendar Days, Clock, Calendar Clock | Calendar, Clock, Calendar Dots |
| Eye Off, Circle Help, Circle Check | Eye Slash, Question, Check Circle |
| Settings and Settings 2 | Gear and Sliders Horizontal |
| Bar, line and pie chart | Chart Bar, Chart Line and Chart Pie |
| Taxi, EV charge and parking | Taxi, Plug Charging and Letter Circle P |

`SquareParking` uses the genuine Phosphor Letter Circle P, preserving parking
identity rather than collapsing it into a car. `BookmarkCheck` uses the genuine
Phosphor Bookmark Fill, retaining the pinned-state distinction rather than
collapsing it into the unpinned outline. `CalendarArrowUp` maps to Calendar
Dots for a future scheduled date, rather than Calendar Check's completed-state
meaning. These are the three visual-review exceptions.

## Review evidence

Root QA owns two deliberately separate evidence streams after the final
reserved files land:

- Actual production-component runtime coverage exercises C50, F30, F32 and
  G497 on the established host. Marketing captures use production screen
  renderers.
- Nine true-390px before/after glyph review sheets cover Home, Spend,
  Upcoming, Planning, Accounts, Penny, Settings, sheets and operations. They
  use the same alias exports, sizes and weight requests as the source, and are
  explicitly labelled as icon comparisons rather than authenticated-product
  screenshots.

The source audit is the layout guard: G484 changes SVG content only, with no
intentional wrapper, margin, copy, figure or interaction changes. Review both
themes for centring and baseline alignment; separately measure that existing
divider clearance is unchanged.


## Captured comparison set

The delivered [nine-area icon comparison set](../../frontend/public/design-media/g484-icons/index.html) contains 36 before/after PNGs at a true 390px width, with 123 distinct glyphs used by product source. On UAT it is available at `/design-media/g484-icons/index.html`. These are explicitly glyph comparison sheets, not screenshots of authenticated product pages. The source catalogue records each original caller and the reviewed source revision.

The compatibility check covers direct SVG title children, explicit ARIA overrides, native Phosphor weight selection, dimensions and distinct pinned bookmark meaning. A one-icon ESM bundle retains 1,730 bytes (954 gzip) and removes unused bookmark geometry. The no-Lucide guard rejects direct/type/dynamic imports and the documented static CommonJS aliases; it is a regression gate, not a runtime-obfuscation security boundary.
