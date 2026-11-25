# C22 phone marketing round

Revised store artwork for Kevin's 24 and 25 November feedback. Review at
`/design/marketing-phones`. This is a design round for choosing a composition,
with downloadable assets, not permission to publish to either store.

The latest content revision shows two genuine current-account Available figures
under Home's Spend from. It gives Upcoming's payment and account groupings their
own images, rather than inventing a new product tab control. Give your money a
purpose now shows Penny reviewing a new one-off, with its amount, date, source
account and confirmation actions. All three changes use existing product
renderers and one reconciled fictional household.

The 25 November fidelity correction restores Spend's production period controls,
pace hero, Changes/Spending/Charts navigation, pay-arrived event and continuous
journey rail. Its example shows one real pace chart, using the same authoritative
pace series as the hero. Optional transfer reviews remain absent because this
fictional example has none. The app's own financial typography and components
are retained.

The handset status area has no clock, signal or battery glyphs. The light safe
strip extends below the whole camera cutout: its top inset is 48 pixels on the
iPhones and 36 pixels on Pixel, including clearance below the Pixel camera ring.
The dark version uses the corresponding dark screen fill. The physical camera
cutout, bottom safe area and app navigation retain their existing geometry. Upcoming now leads
with “See what’s coming up and what needs attention.” The named Monzo current
account makes the source of the planned car-service payment explicit.

The handset now has an in-flow navigation footer, so the complete goal proposal,
Create goal, Cancel and Edit schedule remain visible at the initial position.
The model body and its display have separate fixed proportions; the app is laid
out at canonical logical widths of 402, 440, 414 and 412 pixels and uniformly
scaled into the display. Content cannot widen a short handset stage. Both A
and B retain the complete phone, including its navigation and gesture area.

The continuous lines in the earlier images came from a one-pixel border around
the whole captured product image in `marketing-kit/store/store.module.css`.
That rectangle continued through the gaps between the product's own cards.
This round renders production components directly inside a handset. There is
no captured-image wrapper around the groups of cards. The cards retain their
own production borders and dividers.

## Review directions and exports

- A, Full phone: a compact headline and the complete handset.
- B, Close view: a smaller heading and a closer view of the complete handset.

Each direction has one ordered set per format and theme. Themes never alternate
within a set. The eight stories are Left to spend, Upcoming payments, Upcoming
by account, Cover the gap, Spending changes, Plan a one-off, Plan with Penny and
Change a planned payment. The Penny chart story is omitted. The stable `aside`
story URL now opens the one-off creation story.

The gallery contains 144 RGB PNGs: 128 core images and 16 additional 50/30/20
images. The 16 ZIPs still contain the eight ordered core images each. The
additional comparison is downloaded separately and can replace another image
when selecting a final eight-image store set. Individual files and the selected
ZIP are linked from the gallery.
The manifest and assets live at `/design-media/c22/phones/`.

| Format | Pixels | Illustrative model |
| --- | --- | --- |
| iPhone with Dynamic Island, medium | 1206 × 2622 | iPhone 16 Pro |
| iPhone with Dynamic Island, large | 1320 × 2868 | iPhone 16 Pro Max |
| iPhone with Face ID, large | 1242 × 2688 | iPhone 11 Pro Max |
| Android phone, 20:9 | 1080 × 2400 | Pixel 9 Pro XL |

The surrounds are coded hardware illustrations with model-specific cutouts and
proportions. They are not simulator captures or photographs of physical devices.
The Android composition uses a taller 20:9 export canvas. Its illustrated Pixel
display keeps the model's own resolution ratio; that display is distinct from
the physical chassis ratio.

Apple currently requires the medium Dynamic Island category and disallows alpha
channels. The two larger iPhone options are supplied as well.
[Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
Google Play's current standard screenshot limit permits an aspect ratio up to
2.3:1, which includes this 1080 × 2400 RGB artwork without transparency. Its
separate recommendation surfaces still request 9:16 portrait screenshots; this
20:9 phone set does not claim eligibility for every recommendation placement.
[Google Play preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).
Device proportions were checked against Apple's
[iPhone 16 Pro](https://support.apple.com/en-us/121031),
[iPhone 16 Pro Max](https://support.apple.com/en-us/121032) and
[iPhone 11 Pro Max](https://support.apple.com/en-us/111878) specifications,
and [Google's Pixel specifications](https://support.google.com/pixelphone/answer/7158570).

## One fictional example

Alex Taylor's current pay period is 30 October to 29 November 2026, following
the same monthly payday rhythm as the pure-engine goal preview. The capture date
is 17 November, day 19, with 13 days until payday. All figures are invented and
local to the preview.

| Figure | Reconciliation |
| --- | --- |
| Current accounts | Monzo current account £555 + Starling Spending £150 + Bills £68 = £773 |
| Upcoming payments | Energy £188 on 20 Nov + Broadband £38 on 23 Nov + Boiler service £95 on 26 Nov = £321 |
| Accounts after those payments | £773 − £321 = £452 |
| Groceries still reserved | £250 period target − £220 already matched = £30 |
| Left to spend, estimated | £452 − £30 reserved − £110 buffer = £312 |
| Suggested cover move | £120 from Monzo current account to Bills; £68 + £120 − £188 = £0 on Bills |
| Monzo Available before that move | £555 − £133 own bills − £30 reserve = £392 |
| Monzo Available after that suggested move | £392 − £120 = £272 |
| Starling Available | £150, with no payments or plans leaving it this period |
| Bills Available after that suggested move | £68 − £188 + £120 = £0 |
| Global buffer stays global | £272 + £150 + £0 − £110 = £312 pooled Left to spend |
| Spend this period | £860 Out, including £240 Eating Out and £620 in the other categories |
| Usual by day 19 | £740, including £120 Eating Out; the £120 difference is entirely Eating Out |
| Cash history | Monzo opening £15 + £1,800 income − £860 Out − £400 moved to savings = £555; Starling stays at its opening £150 |
| Savings, excluded from Left to spend | Opening £100 + £400 moved in = £500 |

Only the unfilled grocery remainder is reserved from current cash. An earlier
draft wrongly treated a completed £250 set-aside as another £250 reservation;
that draft was corrected before export. This follows the production allocation
contract, which reserves `max(0, amount_per_period - filled_this_period)`.

Spend from and By account use the same production Available reading. An account
figure is its own balance after payments, plans and suggested moves. The £110
buffer is deducted once from the pooled headline, never allocated across the
account rows. Home keeps its existing scope sentence and visible How we got
£312 disclosure. Opening that disclosure shows £452 after payments, less £30
set-aside and £110 buffer. Its meaning is not changed for a neater screenshot.
Suggested cover is a recommendation: November's Energy payment still needs
£120 moved in, and the account row explicitly says Move suggested.

The car-insurance goal is a prospective plan: three £200 contributions on
30 November, 30 December and 30 January, with nothing reserved in this current
period. Its schedule preview uses the existing pure-engine fixture. The Boiler
service conversation demonstrates reviewing a change from £90 on 24 November
to £95 on 26 November. The Upcoming story shows the resulting £95 plan. Neither
confirmation nor the cover suggestion moves money in a bank.

Give your money a purpose shows a pending, unsaved Car service one-off for £120
on 12 December 2026, paid from Monzo current account. This uses Penny's existing `add_planned`
contract and real confirmation card. It does not show a manual set-aside feature
that Penny cannot currently create. The future payment is absent from November's
£321 due and £30 reserve, so the current £312 estimate is unchanged. Its real
Confirm and Cancel actions remain wholly above the navigation.

The additional 50/30/20 image uses the production SpendShapeCard and its compact comparison with
a separate, completed pay period, 30 September to 29 October 2026. Its £1,800
income funded Fixed £900, Moved £300 and Free £450, leaving £150. The example
amounts are £900, £360 and £540 respectively, so the signed differences are
£0, −£60 and −£90. This neutral reference is not a target or the current £312
left-to-spend forecast. There is one completed period and no invented average
or trend. Each image records its own period in the provenance manifest.

## Rendering and validation

The source is `frontend/app/design/marketing-phones/`. Real production renderers
supply the financial UI. The small page headers and fixture host provide context;
the phone hardware belongs only to the marketing composition. There is no
authenticated account data and no feature API call.

Run from the worktree root with a local preview on port 3158:

```sh
python3 marketing/c22-phones/export_assets.py
python3 marketing/c22-phones/validate_assets.py
python3 marketing/c22-phones/verify_gallery.py
```

The exporter captures the final CSS artboard at device scale factor 3. There is
no screenshot intermediate and no raster enlargement. It checks artboard size,
visible screen height, excluded Penny-chart and obsolete payday copy, and unexpected
network requests. Every PNG has source metadata and a checksum. The manifest
records the checked-in component and formatter source hashes; each ZIP records
its exact sequence and provenance.

Browser review covers phone and desktop galleries, both themes, all handset
formats, controls, downloads, readable content, model cutouts and balanced
divider clearance. The independent review and export measurements are recorded
beside this brief. A preview capture proves the marketing composition only.
The focused `layout_checks.py` acceptance gate additionally checks body/display
ratios, uniform scaling, camera clearance, the absence of a handset clock,
the visible Spend hero/navigation/rail, and the full
goal card plus action text ranges above the actual navigation. Document-level
scroll metrics alone are insufficient evidence for action visibility.
The gallery verifier writes its captures to the ignored
`frontend/.screens/c22-phones/` directory.

The earlier social images and films remain at `/design/marketing-kit`. C41's
separate App Store Header and Search Results artwork remains at
`/design/app-store-creative`. Those are earlier deliverables and are not this
revised phone screenshot pack.
