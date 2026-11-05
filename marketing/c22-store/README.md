# C22: final UI and store image pack

Kevin confirmed the existing product-led campaign style on 5 November 2026 and asked for a gallery refresh, App Store and Google Play pictures, and assets for Instagram. This round extends the agreed visual system with current production-component captures and fictional data. No store listing or social post is published by these scripts.

## Direction contract

THESIS: the interface is the evidence. Large, plain language introduces one real product capability per image, without generated scenery or recreated interface lettering.

OWN-WORLD: retain C22's Figtree display, JetBrains Mono currency, Mist and Midnight slate grounds, generous space and restrained borders. Semantic colour belongs to product information, with Penny's gradient reserved for Penny. Both themes receive the same care.

STORY: first show the estimated amount left to spend, then the paying account and spending context. The remaining sequence explains the month, the 50/30/20 reference, suggested movements, Penny's confirmation and setting money aside. Bank transfers remain with the customer.

FIRST VIEWPORT: the review gallery opens with the existing campaign heading and theme controls, followed by a store screenshot sequence with a device-size control and downloads. Instagram images and actual MP4 films follow in separate sections. The store images themselves put a short headline above a large, uncropped production capture.

FORM: ordinary extension of the approved C22 artwork and gallery. Code-led export canvases inherit the established system; no new visual identity or concept selection is required. Gallery controls retain URL state, keyboard focus and 44-pixel targets. The existing frame-driven edits and original instrumental sound are retained, with Coming soon on social film endings.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Platform specifications

Checked against primary sources on 5 November 2026. Apple's current required phone category is iPhone with Dynamic Island, medium display. The pack includes that category at 1206 × 2622, plus a large-display set at 1320 × 2868 and a classic large-display set at 1242 × 2688. Each is an eight-image sequence in light and dark. The phone sets are export artwork using the shared product UI; they are not a claim that a native simulator was used. An iPad set is needed if the submitted build supports iPadOS; it is outside this phone pack. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

Google Play receives eight 1080 × 1920 screenshots per theme and a 1024 × 500 feature graphic. PNG exports are RGB without alpha. The interface leads the first three images, extra text remains restrained, and there are no installation badges, ranking claims or download calls to action. [Google Play preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).

## Sources and boundaries

The original and feature capture scripts render imported production components with local fixtures, block unexpected API requests and record source hashes. The store exports consume those exact captured pixels. An image's `Source` metadata and the manifests identify its source artwork, fixture status, size and theme. Old campaign rounds remain explicitly archived and are not represented as refreshed output.

The fictional calculation is £610 cash less £188 expected bills and £110 buffer, leaving £312 estimated. The Bills account separately holds £68 against a £188 payment, a £120 gap. September's £2,400 income reconciles to £1,800 spending, £400 moved and £200 left. The adapted 50/30/20 reference is a comparison, not a budget or grade. Penny and set-aside actions create plans after local confirmation; no funds move.

Capture time is pinned to the fictional 8 October scenario while UI timers remain live. Browser-only proof hosts avoid a server-time hydration mismatch. The latest Spend pay-split instrument describes the last full pay period, so its September evidence is kept distinct from October's £860 current spending pace. Export assertions reject the settings-button crop that an older positional selector would have produced.

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
node marketing/c22-next/validate_assets.mjs
python3 marketing/c22-features/validate_assets.py
python3 marketing/c22-store/validate_assets.py
python3 marketing/c22-features/verify_gallery.py
python3 marketing/c22-store/verify_gallery.py
```

The final gallery is `/design/marketing-kit#stores`. Store upload and submission remain C5's console step. The shared UI artwork must be checked against the submitted native build before upload. Social films are Instagram assets, not an Apple app-preview submission.

## Finish review

This is an ordinary extension of the approved C22 campaign, not a new visual identity. The comparison below records the built gallery and store canvas against `DESIGN.md` and `.impeccable/design.json`; those governing files remain unchanged.

| Area | Before this extension | After this extension | Why |
| --- | --- | --- | --- |
| Gallery entry point | Existing campaign gallery with theme and feed/story controls | Same heading and controls, with store screenshots first, device-size selection, exact downloads, then Instagram stills and films | Makes final UI evidence the first reviewable material while preserving URL state, focus treatment and 44px controls |
| Store artwork | No current store pack in the gallery | Eight-story sequence in light and dark across Apple medium, Apple large, Apple classic and Google Play, plus two Play feature graphics | Covers the agreed phone formats without implying native simulator capture |
| Store canvas | Product capture framed as a campaign image | Short headline above a large uncropped production capture, with restrained borders and slate grounds | Extends the typography-led C22 form and keeps the interface as evidence |
| Set-aside story | Saved short aside row | Full actual review form showing amount, source and tracking before saving | Makes the decision surface legible and honest about what the user confirms |
| Feature graphic | Text and artwork could compete at the overlap | Text placement corrected so the feature graphic remains readable | Resolves the material overlap found in creative review |
| Social output | Existing C22 stills and films | 36 refreshed Instagram stills and 16 films in both themes, using real production components and fictional 8 October 2026 data | Extends the approved world without generic AI scenery, bank writes or generated interface lettering |

The independent `store_creative_review` verdict is **ship**, after the two material fixes: the saved short aside row was replaced with the full actual review form, and the feature-graphic text overlap was corrected. The reported missing “Save” label was a media-viewer artefact, not a product defect; identical 817-white-pixel crops in both themes proved the label is visible in the artwork.

## Pack inventory and provenance

- 66 new RGB PNGs: eight stories × two themes × four phone formats (Apple 1206 × 2622, 1320 × 2868 and 1242 × 2688; Google Play 1080 × 1920), plus two Google Play feature graphics at 1024 × 500.
- 10 ZIPs with ordered files and alt text for the store hand-off.
- 36 refreshed Instagram stills and 16 films across both themes. The films retain the original frame-driven edits and instrumental sound, with “Coming soon” endings for social.
- Captures use real production components with fictional date context pinned to 8 October 2026. They do not write to a bank and do not use image generation.

## Verification state

The completed checks are recorded in [`review.json`](./review.json). Local asset validation found 66 exact-size RGB PNGs, source hashes, proof manifests and valid ZIP integrity. The original four films fully decoded at 450 frames with H.264/AAC. Scoped ESLint, TypeScript, design-index (63) and design-stale checks passed. The development gallery controls were exercised with eight actual ZIPs at 320, 390 and 1440px in both themes.

The production build and TypeScript passed. All 12 feature films fully decoded, with measured non-silent AAC audio. The production browser played, paused and sought all 16 films, decoded non-blank pictures, loaded five caption cues per film and verified Coming soon endings. Store controls, eight real ZIP downloads, theme/format state, feature filters, archive routes and decoded gallery layouts passed at 320, 390 and 1440 pixels in both themes. All 58 tracked production proof dependencies matched the current shared app source at the freshness check.

The independent reviewer also inspected all six feature-film contact sheets in both themes and found no material regression in UI framing or financial meaning. This is held-frame evidence, not continuous viewing. The Impeccable detector returned no findings. The specialised Impeccable agent roles were not exposed by this harness; normal independent reviewer and documentation agents provided the hand-offs. The governing design-system files remain unchanged.

The required repository hand-off runs through `scripts/session.sh finish C22 --uat-review`; the backend, TypeScript and frontend gate outcome is recorded on the C22 board. Store screenshots are preview/media evidence, not native simulator captures; native parity and store-console submission remain C5 steps before publication.
