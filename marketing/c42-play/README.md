# C42 Google Play promo pack

Creative review hand-off, refreshed 12 November 2026. This is an ordinary
extension of the approved C22 campaign, not a new visual identity, a store
submission, or publication approval. It contains a 30-second 1920 x 1080
film in light and dark themes, three 1920 x 1080 RGB promotional images per
theme, English VTT captions, and one ZIP hand-off per theme.

The film edits approved C22 beats into this story: spend insight, the
expenses behind it, Penny's chart, a payday plan, confirmation, cover from
two sources, and the user's decision to make any transfer in their bank. It
uses the original C22 Penny and movement instrumental clips. Every shot shows
actual production UI rendered with fictional fixtures. The promotional images
are text-free excerpts from the production `PennyChartPlot`: launch template,
Penny charts, and payday plans. They contain no generated visual, added text,
wordmark, outer frame, or rounded external corner.

## Direction contract

**THESIS:** the interface is the evidence. A concise film makes a recognisable
money question legible, then shows the real interaction and its consequence.
The three promotional images are visual templates for a confirmed in-app
launch or major update, not announcements of an invented event.

**OWN-WORLD:** retain C22's Figtree, JetBrains Mono money figures, Mist and
Midnight grounds, generous spacing, restrained borders, and semantic product
colour. Penny keeps the indigo-to-violet treatment reserved for advice. Both
themes receive the same care.

**STORY:** spend to expenses to Penny chart to plan proposal to confirmation
to cover sources to the user's own bank decision. A plan is not a bank
transfer, and Sorted does not move money.

**FIRST VIEWPORT:** the review page opens with the film and theme controls.
The responsive artwork review is available at `/design/play-extras?art=charts&mode=dark&safe=1`.
The exact export query is `/design/play-extras?art=charts&export=1&mode=light`.

**FORM:** ordinary C22 extension. The gallery recedes behind the film and
artwork, keeps URL state, keyboard focus, native controls, captions, and
44-pixel targets, and does not introduce a new campaign shell.

**FINISH:** real assets, source provenance, safe-area evidence, browser review,
and the final hand-off remain part of the work. Unreviewed media is not
finished media.

## Google Play boundaries

Google's official requirements were checked on 12 November 2026:

- [Preview video requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
- [Promotional content requirements](https://support.google.com/googleplay/android-developer/answer/12929944?hl=en)

The preview hand-off uses one YouTube video URL only. Kevin must select the
Sorted channel video and make it public or unlisted, embeddable, without ads,
age restriction, or monetisation claims. The film should be concise at 30
seconds, with early UI and roughly 80% of runtime showing actual product UX.
Upload `promo.en-GB.vtt` as the video's English captions. The review pack
does not upload or publish a video.

Promotional content is subject to Play Console eligibility for non-game apps.
The three artworks are examples for a genuine, discoverable in-app launch or
major-update event with a matching destination. Kevin must decide the event,
audience, dates, scope, and final console copy. No discount, offer, or launch
date is invented here. Spotlight taglines are capped at 48 characters; the
general promotional tagline may use the wider 80-character limit where
applicable. Final console crop review remains required.

Each promotional PNG is 1920 x 1080 RGB. The crop-safe guide is 10% left and
right, 15% top, and 20% bottom: x=192..1728 and y=162..864. The guide is a
review overlay only and is excluded from the exported PNG.

## Inventory and provenance

- Two 30-second H.264 MP4s, light and dark, with original C22 instrumental
  audio and the shared English `promo.en-GB.vtt` captions.
- Two 1920 x 1080 poster PNGs.
- Six text-free 1920 x 1080 RGB PNGs: launch, charts, and plans in both themes.
- Two ZIPs, each containing its theme's MP4, poster, VTT, three PNGs,
  `play-copy.json`, and `manifest.json`.

The export reuses C22 capture choreography and original sound files without
overwriting C22 output. Source hashes and PNG metadata record the production
components, fixture boundary, source artwork, and fictional-data status. No
external API request is part of the export.

## Reproduction

Run from the worktree root with a local Next preview on port 3152. The export
uses system `python3` with Playwright and Pillow, not the backend virtual
environment:

```sh
python3 marketing/c42-play/export_assets.py --base http://127.0.0.1:3152
python3 marketing/c42-play/export_assets.py --base http://127.0.0.1:3152 --proofs-only
python3 marketing/c42-play/export_assets.py --base http://127.0.0.1:3152 --skip-proofs
python3 marketing/c42-play/export_assets.py --base http://127.0.0.1:3152 --index-only
python3 marketing/c42-play/validate_assets.py
python3 marketing/c42-play/verify_gallery.py --base http://127.0.0.1:3152
```

`--proofs-only` captures the reused production proof states. `--skip-proofs`
reuses existing proofs for the full film/art export. `--index-only` rebuilds
the manifest and ZIP indexes from existing media. The full export writes only
to `frontend/public/design-media/c42` and the C42 review directory.

## Verification state

The production build, TypeScript, scoped ESLint, exact media validation and
production-browser review passed. All 49 asset hashes and 76 source hashes
match; both 900-frame films decode completely, with original audio and seven
caption cues. All six layout/playback cases passed at 320, 390 and 1440 pixels
in both themes, including keyboard play, captions, seeking, URL state, guides,
download responses and mono/tabular currency. No unexpected API call occurred.

Independent review returned **ship** after the gallery currency treatment was
corrected. A fresh standard reviewer and documenter substituted for specialist
roles unavailable in the harness. The context launcher was unavailable, so
project context and guidelines were read directly. See [review.json](review.json).

The mandatory backend and frontend finish-gate outcome is recorded on C42's
board entry through `scripts/session.sh finish C42 --uat-review`. The
coordinator publishes the review route. Native parity, Play Console eligibility,
final upload and publication remain Kevin's review and submission steps.

