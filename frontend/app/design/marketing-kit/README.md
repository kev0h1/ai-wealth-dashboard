# C22 marketing-kit gallery

This private review gallery packages seven fictional Sorted stories as campaign artwork. It continues the G222/G223 campaign world rather than introducing a new brand: Figtree for interface copy, JetBrains Mono for money, slate grounds, solid indigo actions, semantic risk colours, and Penny's gradient only. The gallery is not authorisation to publish, submit to a store, or change a production interaction.

## What is implemented

The story gallery covers Safe to Spend, bank connection, upcoming payments, suggestions and cover plan, payday plan, investment tracking, and Penny. It provides:

- Campaign A, **Answer first**: a short answer with broad, centred production proof.
- Campaign B, **The question**: the customer's question with proof beside it on wide canvases; tall canvases retain a vertical reading order.
- Authored light and dark output, exact-size still artboards, inert production-proof plates, store-listing copy, and opt-in playback of the exported MP4 files. Browser playback uses no external font requests and stays within the application's content security policy.

The underlying proof is assembled from production components in `ProductionProof.tsx`, not dashboard lookalikes. Its controls use no-op handlers and `inert`, so a gallery visit cannot connect a bank, grant consent, transfer money, or mutate product state.

## Fictional financial example

All names, balances and transactions are fictional. Alex Taylor's 8–30 October 2026 example reconciles as follows: Everyday £542 plus Bills £68 gives £610; £188 of bills leaves £422; the £110 buffer leaves an estimated £312 Safe to Spend. The separate £120 recommendation moves £120 from Everyday to the Bills account, covering that account's £120 shortfall. The £2,400 payday plan is a future preview for 30 October, not a completed transfer. Investment values are fictional, can fall as well as rise, and are tracking rather than investment advice.

Feature claims, legal copy, store copy, review checks, formats, and the primary Apple and Google platform sources live in [`content.json`](./content.json). Treat that file as the content source of truth; it records the platform guidance checked on 8 October 2026.

## Outputs and provenance

Stills are written to `frontend/public/design-media/c22/` with `manifest.json` and `listing-copy.json`. Every PNG receives embedded `Source` provenance including feature, theme, kind, status, component source, fixture path where applicable, and `synthetic: true`; the manifest adds dimensions, byte size, SHA-256, source references, and review checks.

The completed still export contains **216 PNGs**: `196 campaign PNGs + 14 proof plates + 6 expanded detail plates`. The campaign total is seven stories × seven formats × two directions × two themes. The seven campaign dimensions are:

| Format | Pixels |
| --- | --- |
| iPhone 6.9-inch | 1320 × 2868 |
| iPhone 6.5-inch | 1242 × 2688 |
| iPhone medium display | 1206 × 2622 |
| Android phone | 1080 × 1920 |
| Social feed | 1080 × 1350 |
| Social story | 1080 × 1920 |
| Landing section | 1600 × 1200 |

Film output is also written to `frontend/public/design-media/c22/`: ten silent MP4 review drafts, one light and one dark render for each of three 15-second feature films, the 30-second overview, and the 30-second App Store editorial preview. Feature, overview, and App Store preview dimensions are respectively 1080 × 1920, 1080 × 1920, and 886 × 1920, all at 30 fps. Film manifest records include SHA-256, H.264 codec, duration, `audio: "silent"`, the Remotion source, and `synthetic: true`.

No AI-generated imagery, generated audio, paid API, or new external spend is used by this kit.

## Exact export commands

Start the local preview server separately, then run the still exporter from `frontend`:

```bash
/usr/bin/python3 app/design/marketing-kit/export_stills.py --base-url http://127.0.0.1:3132
```

The exporter permits only `127.0.0.1` or `localhost`. It stubs only the shared design-shell `GET` reads for `/api/cashflow/at-risk-count`, `/api/categories`, and `/api/preferences`; it aborts other API requests, and the proof components themselves must make no calls. This is fixture-rendered review artwork, not proof of live-product API behaviour.

After the still manifest exists, render films from `frontend`:

```bash
node app/design/marketing-kit/export_films.mjs
```

On time-limited runners, render bounded batches instead:

```bash
/usr/bin/python3 app/design/marketing-kit/export_stills.py --features safe-to-spend connect
node app/design/marketing-kit/export_films.mjs upcoming@light
node app/design/marketing-kit/export_films.mjs --index-only
node --no-warnings --experimental-strip-types app/design/marketing-kit/check_assets.mjs
```

Repeat the feature and film selections until every story and theme is covered. Index-only mode verifies existing films without rendering again. The final checker requires exactly 216 PNGs and ten films, verifies dimensions, RGB images without alpha, hashes, copy limits and fixture arithmetic, and independently probes every video.

The film exporter invokes local Remotion with `--no-install`, H.264, a requested 10 Mbps variable bitrate, Chrome, and no audio. Static artwork can encode below that target. It checks actual H.264 encoding, 30 fps, 8-bit 4:2:0 pixel format, absence of audio streams, dimensions, duration and App Store preview profile level before adding a file to the manifest. The existing Remotion font loader may download Google Fonts on a cold cache; no paid generation service is called.

## Incumbent-design comparison

**Verdict: faithful extension, not a parallel visual system.** `ProductionProof.tsx` imports the actual Safe to Spend, bank connection, upcoming-payment, Home Brief, cover-plan, payday-plan, investment, and Penny components. `Artboard.tsx` supplies destination proportions and scales the same 390px proof rather than recreating its internal UI. The campaign wrapper uses the incumbent slate canvases and light/dark treatment, while the direction contract reserves the only gradient for Penny. The gallery adds review controls and export framing, but it does not rewrite design tokens or `DESIGN.md`.

There is a pre-existing documentation discrepancy to resolve separately: the `DESIGN.md` frontmatter declares a system-ui display stack, while the C22 direction contract and film source use Figtree. This README records the discrepancy only; it does not repair or redefine the incumbent design system.

## Verification on 8 October 2026

The final asset checker passed all 226 files. The production build passed, as did scoped ESLint and the design index. Browser checks against the production build covered 1440px light, 390px light/dark and 320px dark, including control round-trips, URL state, malformed-filter fallback, keyboard focus, horizontal overflow, paused initial video state and actual playback. Shared shell reads were stubbed; unexpected API calls were blocked.

Production testing caught the existing Remotion Google Fonts loader conflicting with the application's restrictive content security policy. The gallery now plays its exported MP4s directly, without weakening that policy or changing other film previews. An independent reviewer approved that bounded change, the component reuse, reconciled figures, visual captures and the strengthened video validation. Documentation received a separate accuracy audit. Publication and native-build parity remain separate approvals below.

## Limitations and approvals

- Output is `review-draft`, not publication-ready. Kevin must select direction A or B and approve copy and disclosure placement.
- Compliance must review financial-promotion status, claims, provider disclosure, audience, and channels. No pricing, availability, savings result, return, or FCA-authorisation claim is approved here.
- C5 remains responsible for uploader work and must check each pictured feature against submitted iOS and Android builds, supported banks, permissions, subscription entitlements, and current store device classes.
- The component-rendered App Store editorial preview requires C5's native-build parity review, then an editorial/native-parity review before any App Store submission. Correct encoding does not equal store approval.
- Paid-social placements require a fresh check of the relevant TikTok, Meta, and Instagram financial-services and safe-zone requirements.
- There is no audio. Existing G224 AI footage is neither reused nor newly commissioned.
