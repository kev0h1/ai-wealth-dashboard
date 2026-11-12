# C41 App Store creative options

Creative review, 12 November 2026. This extends Kevin's approved C22 style with separate Header and Search Results artwork. Kevin chooses one option and theme for each slot. It does not upload, submit or publish anything.

Review at `/design/app-store-creative`, registered in the design index. The coordinator publishes this route to UAT after the normal `--uat-review` hand-off.

## Direction contract

THESIS: let plain typography introduce the product, then use the real interface as evidence. The two placements are composed independently around Apple's different safe areas.

OWN-WORLD: C22's Figtree, JetBrains Mono currency, Mist and Midnight slate grounds, generous space and restrained borders. No generated imagery, photographic scenes, device mock-ups, decorative gradients or glows.

STORY: A introduces Left to spend through its estimate and account context. B introduces Penny with a typographic Header and the actual spending-comparison module in Search Results. The fixtures remain explicitly dated separate examples.

FIRST VIEWPORT: the review gallery immediately offers placement, theme and viewing-size controls, followed by the two options side by side on desktop or stacked on mobile. Safe-area close-ups support comparison; full-artwork and 390-pixel views reveal the exact exported composition.

FORM: a code-led extension of the approved campaign. Live production components supply the proof pixels; hand-set type supplies the campaign composition. URL-backed controls support refresh, history and direct links. Downloads name their slot, option and theme.

FINISH: exact RGB exports, source and fixture provenance, official template measurements, browser and visual evidence, an independent finish review, and the repository finish gates precede the UAT review hand-off. The existing design-system files stay unchanged.

## Apple specifications

Checked against [Apple's creative-asset specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/) and [asset guidance](https://developer.apple.com/app-store/asset-best-practices/) on **12 November 2026**.

| Placement | This pack | Art safe area at full size |
| --- | --- | --- |
| Header | 3840 × 1646 PNG | x 1097, y 493, width 1646, height 661 |
| Search Results | 3840 × 2560 PNG | x 836, y 765, width 2168, height 1030 |
| Search Results alternative | 1920 × 1280 PNG | Exactly half the full-size coordinates |

The rectangles were measured directly from the **Art Safe Area** layers in Apple's official Photoshop templates, rather than inferred from third-party guidance. [`specs.json`](./specs.json) records the official links and downloaded template hashes. The read-only `verify_apple_templates.py` reproduces the measurement. Apple's PSDs are not redistributed.

Apple also accepts a 5244 × 2950 universal PNG. Separate compositions preserve more room for each placement here. Every file is opaque RGB, without an alpha channel. Essential copy and complete product evidence stay inside the measured safe rectangle. The gallery's close-up is a review crop; the download remains the full image. Its 390-pixel view is a size check, not a claim to reproduce App Store Connect's device preview.

Apple recommends short complementary text, a clear focal point, current interface imagery and no specific prices, discounts, website addresses, unsupported recognition or other-marketplace branding. The images follow those constraints. Currency inside the product UI is example financial data, not a subscription price.

## Sources and financial examples

`CreativeProof.tsx` imports the current `SafeToSpendCard` and `PennyChart` components with the approved fictional C22 fixtures. No production component changes, customer records, bank operations or live API data are needed.

- **Left to spend, October 2026:** £610 pooled cash, less £188 of bills and a £110 buffer, gives £312. The estimate retains its date, early-estimate qualification, account context and calculation disclosures.
- **Penny comparison, November 2026:** £860 spent versus £740 usual through day 10. Eating Out is £240 against £120 usual; the other four categories total £620 in both series. This is a same-period comparison, not a forecast or savings promise. The complete production chart includes its summary, labelled axes, legend, table control and comparison note.
- **Header B:** hand-set typography only. It does not depict an invented product interface.

Open banking is provided by Finexer Ltd, with AURIQ LTD acting as its agent. No asset claims that Sorted or AURIQ is FCA-authorised. The pack makes no promised savings or financial outcome claims.

## Reproduction

Run an isolated local Next preview on port 3151, then from the worktree root:

```sh
python3 marketing/c41-app-store/export_assets.py --base http://127.0.0.1:3151
python3 marketing/c41-app-store/validate_assets.py
python3 marketing/c41-app-store/verify_gallery.py --base http://127.0.0.1:3151
```

The exporter first captures both current production modules in both themes, then renders eight full-size artboards and four smaller Search Results alternatives. It blocks unexpected API and external requests. PNG metadata and the manifest identify the fictional scenario, source dependencies and exact hashes. The option ZIP contains the 12 deliverable images and descriptive slot/alt-text information.

Downloads live under `frontend/public/design-media/c41-app-store/`. The four proof captures are supporting source pixels, not additional upload choices. Source freshness is checked before treating an old export as current.

## Review and delivery

Browser checks cover both themes at 320, 390 and 1440 pixels, URL state, keyboard focus, downloads, safe-area containment and the complete product evidence. Visual captures are reviewed together, with material fixes batched. Verification and the independent review outcome are recorded in `review.json` when complete.

Finish with `scripts/session.sh finish C41 --uat-review`. The coordinator integrates and rebuilds UAT so Kevin can choose at `https://uat.wealth.auriqltd.co.uk/design/app-store-creative`. Before upload, Kevin checks the selected artwork in App Store Connect's Preview tool against the submitted app build. No store access is performed by this session.
