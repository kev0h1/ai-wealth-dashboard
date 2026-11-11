# C22 App Store and Google Play pack

Creative review draft, refreshed 11 November 2026. This pack uses current production UI, fictional data and the approved typography-led style. It is not a store submission or publication approval.

The eight stories are `amount`, `account`, `spend`, `movement`, `penny`, `plans`, `aside` and `schedule`. Month and Split remain in the Instagram gallery. There are 64 phone PNGs, two Play feature graphics, 66 PNGs total and 10 ordered ZIPs across light and dark themes.

See [the capability brief](../c22-capabilities/README.md) for the current examples: Penny's £860 versus £740 chart, Eating Out £240 versus £120 usual, a £600 goal across three £200 paydays, the £90 to £95 Boiler edit, a £250 grocery set-aside and £80 + £40 multi-account cover.

## Direction contract

THESIS: the interface is the evidence. Large, plain language introduces one real product capability per image, without generated scenery or recreated interface lettering.

OWN-WORLD: retain C22's Figtree display, JetBrains Mono currency, Mist and Midnight slate grounds, generous space and restrained borders. Semantic colour belongs to product information, with Penny's gradient reserved for Penny. Both themes receive the same care.

STORY: first show the estimated amount left to spend, then upcoming payments, spending context, multi-account cover, Penny's chart and plans, and a grocery set-aside. Bank transfers remain with the customer.

FIRST VIEWPORT: the review gallery opens with the existing campaign heading and theme controls, followed by a store screenshot sequence with a device-size control and downloads. Instagram images and actual MP4 films follow in separate sections. The store images themselves put a short headline above a large, uncropped production capture.

FORM: ordinary extension of the approved C22 artwork and gallery. Code-led export canvases inherit the established system; no new visual identity or concept selection is required. Gallery controls retain URL state, keyboard focus and 44-pixel targets. The existing frame-driven edits and original instrumental sound are retained, with Coming soon on social film endings.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Platform specifications

Rechecked against primary sources on 11 November 2026. Apple's current required phone category is iPhone with Dynamic Island, medium display. The pack includes that category at 1206 × 2622, plus a large-display set at 1320 × 2868 and a classic large-display set at 1242 × 2688. Each is an eight-image sequence in light and dark. The phone sets are export artwork using the shared product UI; they are not a claim that a native simulator was used. An iPad set is needed if the submitted build supports iPadOS; it is outside this phone pack. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

Google Play receives eight 1080 × 1920 screenshots per theme and a 1024 × 500 feature graphic. PNG exports are RGB without alpha. The interface leads the first three images, extra text remains restrained, and there are no installation badges, ranking claims or download calls to action. [Google Play preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

## Sources and boundaries

The original and feature capture scripts render imported production components with local fixtures, block unexpected API requests and record source hashes. The store exports consume those exact captured pixels. An image's `Source` metadata and the manifests identify its source artwork, fixture status, size and theme. Old campaign rounds remain explicitly archived and are not represented as refreshed output.

The older £610 cash, £188 bills and £110 buffer calculation remains a separately dated historical example. Current capability examples are documented in the capability brief; Penny and set-aside actions create plans after local confirmation, while no funds move.

Capture time is pinned per fixture scenario while UI timers remain live. Browser-only proof hosts avoid server-time hydration mismatch. Export assertions keep the production UI readable and reject cropped controls.

## Reproduction

From the worktree root, with a local Next preview on port 3146:

```sh
python3 marketing/c22-next/export_round.py --proofs-only
python3 marketing/c22-features/export_round.py --proofs-only
python3 marketing/c22-next/export_round.py --stills-only
python3 marketing/c22-features/export_round.py --stills-only
node marketing/c22-next/render_films.mjs
node marketing/c22-features/render_films.mjs
python3 marketing/c22-store/export_store.py
python3 marketing/c22-capabilities/finalise_provenance.py
node marketing/c22-next/render_films.mjs --index-only
node marketing/c22-features/render_films.mjs --index-only
node marketing/c22-next/validate_assets.mjs
python3 marketing/c22-features/validate_assets.py
python3 marketing/c22-store/validate_assets.py
python3 marketing/c22-features/verify_gallery.py
python3 marketing/c22-store/verify_gallery.py
```

`finalise_provenance.py` runs after every capture, including the store export. It embeds capture-origin metadata without changing PNG pixels and reindexes the store ZIPs. The final gallery is `/design/marketing-kit#stores`. Store upload and submission remain C5's console step. The shared UI artwork must be checked against the submitted native build before upload. Social films are Instagram assets, not an Apple app-preview submission.

## Current round review

This is an ordinary extension of the approved C22 campaign, not a new visual identity. Current evidence will be recorded in [`../c22-capabilities/review.json`](../c22-capabilities/review.json) after the complete export and finish checks. The older [`review.json`](./review.json) belongs to the 5 November round and is historical.

| Area | Before this extension | After this extension | Why |
| --- | --- | --- | --- |
| Gallery entry point | Existing campaign gallery with theme and feed/story controls | Same heading and controls, with store screenshots first, device-size selection, exact downloads, then Instagram stills and films | Makes final UI evidence the first reviewable material while preserving URL state, focus treatment and 44px controls |
| Store artwork | No current store pack in the gallery | Eight-story sequence in light and dark across Apple medium, Apple large, Apple classic and Google Play, plus two Play feature graphics | Covers the agreed phone formats without implying native simulator capture |
| Store canvas | Product capture framed as a campaign image | Short headline above a large uncropped production capture, with restrained borders and slate grounds | Extends the typography-led C22 form and keeps the interface as evidence |
| Set-aside story | Saved short aside row | Full actual review form showing amount, source and tracking before saving | Makes the decision surface legible and honest about what the user confirms |
| Feature graphic | Text and artwork could compete at the overlap | Text placement corrected so the feature graphic remains readable | Resolves the material overlap found in creative review |
| Social output | Earlier C22 stills and films | 48 Instagram stills and 22 films, including nine current feature stories and four original stories | Extends the approved world without generic AI imagery, bank writes or generated interface lettering |

The current round remains under review until the root hand-off records its evidence. Native parity and platform submission remain C5 responsibilities.

## Pack inventory and provenance

- 66 new RGB PNGs: eight stories × two themes × four phone formats (Apple 1206 × 2622, 1320 × 2868 and 1242 × 2688; Google Play 1080 × 1920), plus two Google Play feature graphics at 1024 × 500.
- 10 ZIPs with ordered files and alt text for the store hand-off.
- 48 Instagram stills and 22 films across both themes. New feature films use five three-second held shots rendered once per shot and assembled to 450 frames; the original four retain their existing edits. All social films end with “Coming soon”.
- There are 66 feature UI captures: 54 full interaction states, including real save and confirmation transitions, plus 12 complete module excerpts. Ten original captures remain in the prior pack.
- Captures use real production components and fictional scenarios. They do not write to a bank and do not use generic AI imagery.

## Verification state

Do not treat the historical `c22-store/review.json` as current-round evidence. Root will record current asset validation, media decoding, browser playback, source freshness and visual review in [`../c22-capabilities/review.json`](../c22-capabilities/review.json) only after all captures and reindexing complete. The governing design-system files remain unchanged.

The required repository hand-off runs through `scripts/session.sh finish C22 --uat-review`; the backend, TypeScript and frontend gate outcome is recorded on the C22 board. Store screenshots are preview/media evidence, not native simulator captures; native parity and store-console submission remain C5 steps before publication.
