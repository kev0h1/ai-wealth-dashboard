# C22 phone marketing round

Revised store artwork for Kevin's 24 and 25 November feedback. Review at
`/design/marketing-phones`. This is a design round for choosing a composition,
with downloadable assets, not permission to publish to either store.

The continuous lines in the earlier images came from a one-pixel border around
the whole captured product image in `marketing-kit/store/store.module.css`.
That rectangle continued through the gaps between the product's own cards.
This round renders production components directly inside a handset. There is
no captured-image wrapper around the groups of cards. The cards retain their
own production borders and dividers.

## Review directions and exports

- A, Full phone: a compact headline and the complete handset.
- B, Close view: a smaller heading and a closer crop of the handset.

Each direction has one ordered set per format and theme. Themes never alternate
within a set. The seven stories are Left to spend, Upcoming payments, Cover the
gap, Spending changes, Set money aside, Plan with Penny and Change a planned
payment. The Penny chart story is omitted.

The pack contains 112 RGB PNGs and 16 ZIPs, with seven ordered images in each
ZIP. Individual files and the selected ZIP are linked from the gallery.
The manifest and assets live at `/design-media/c22/phones/`.

| Format | Pixels | Illustrative model |
| --- | --- | --- |
| iPhone with Dynamic Island, medium | 1206 × 2622 | iPhone 16 Pro |
| iPhone with Dynamic Island, large | 1320 × 2868 | iPhone 16 Pro Max |
| iPhone with Face ID, large | 1242 × 2688 | iPhone 11 Pro Max |
| Google Play phone | 1080 × 1920 | Pixel 9 Pro XL |

The surrounds are coded hardware illustrations with model-specific cutouts and
proportions. They are not simulator captures or photographs of physical devices.
The Google Play composition has its own export size; the Pixel's display ratio
describes the illustrated screen inside that composition.

Apple currently requires the medium Dynamic Island category and disallows alpha
channels. The two larger iPhone options are supplied as well.
[Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
Google Play's permitted dimensions and aspect ratio include 1080 × 1920, with
RGB artwork and no transparency.
[Google Play preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).
Device proportions were checked against
[Apple's iPhone 16 Pro Max specification](https://support.apple.com/en-us/121032)
and [Google's Pixel specifications](https://support.google.com/pixelphone/answer/7158570).

## One fictional example

Alex Taylor's current pay period is 30 October to 29 November 2026, following
the same monthly payday rhythm as the pure-engine goal preview. The capture date
is 17 November, day 19, with 13 days until payday. All figures are invented and
local to the preview.

| Figure | Reconciliation |
| --- | --- |
| Current accounts | Everyday £705 + Bills £68 = £773 |
| Upcoming payments | Energy £188 on 20 Nov + Broadband £38 on 23 Nov + Boiler service £95 on 26 Nov = £321 |
| Accounts after those payments | £773 − £321 = £452 |
| Groceries still reserved | £250 period target − £220 already matched = £30 |
| Left to spend, estimated | £452 − £30 reserved − £110 buffer = £312 |
| Suggested cover move | £120 from Everyday to Bills; £68 + £120 − £188 = £0 on Bills |
| Everyday before that move | £705 − £133 own bills − £30 reserve − £110 buffer = £432 |
| Everyday after that move | £432 − £120 = £312 |
| Spend this period | £860 Out, including £240 Eating Out and £620 in the other categories |
| Usual by day 19 | £740, including £120 Eating Out; the £120 difference is entirely Eating Out |
| Cash history | Everyday opening £165 + £1,800 income − £860 Out − £400 moved to savings = £705 |
| Savings, excluded from Left to spend | Opening £100 + £400 moved in = £500 |

Only the unfilled grocery remainder is reserved from current cash. An earlier
draft wrongly treated a completed £250 set-aside as another £250 reservation;
that draft was corrected before export. This follows the production allocation
contract, which reserves `max(0, amount_per_period - filled_this_period)`.

The car-insurance goal is a prospective plan: three £200 contributions on
30 November, 30 December and 30 January, with nothing reserved in this current
period. Its schedule preview uses the existing pure-engine fixture. The Boiler
service conversation demonstrates reviewing a change from £90 on 24 November
to £95 on 26 November. The Upcoming story shows the resulting £95 plan. Neither
confirmation nor the cover suggestion moves money in a bank.

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
The gallery verifier writes its captures to the ignored
`frontend/.screens/c22-phones/` directory.

The earlier social images and films remain at `/design/marketing-kit`. C41's
separate App Store Header and Search Results artwork remains at
`/design/app-store-creative`. Those are earlier deliverables and are not this
revised phone screenshot pack.
