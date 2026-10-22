# C22: a new campaign round

Creative review drafts, 22 October 2026. No advert has been published.

Kevin’s brief is to move away from generic AI marketing and make another round of videos and stills. The supplied training-plan and Robinhood adverts are reference evidence, not source imagery to reproduce. The recurring device to avoid is a broadly interchangeable promise above a phone, with a pale backdrop doing most of the art direction. The Robinhood reference also demonstrates a more deliberate relationship between type, a physical subject and a clear offer. Neither reference is evidence of how its artwork was produced.

This is a **Persuade** campaign inside Sorted’s established identity. PRODUCT.md and DESIGN.md remain authoritative. Production app behaviour and the existing store kit are unchanged. We are proposing three campaign executions, not a replacement product design system.

## The creative contract

The audience is a UK adult checking money between paydays. The campaign should make a concrete question recognisable, then earn its answer with real product evidence. There are no fabricated testimonials, performance statistics, savings guarantees or automatic transfers.

| Direction | The idea | Visual material | Film action |
| --- | --- | --- | --- |
| The receipt | Make the estimate and its working tangible | Original Blender receipt, slate desk, real app evidence | Reveal the printed working and resolve to the product |
| Friday? | A familiar decision before a familiar evening | Figtree lettering, controlled scale and spacing, real Safe to Spend | A question changes rhythm, then holds on the estimate |
| The month, laid out | Turn expected payments into dates you can see | An October calendar, dated energy payment, real Upcoming evidence | Dates appear before the account detail is shown |

Figtree carries prose and JetBrains Mono carries money. Palette: mist `#f0f2f7`, midnight `#0f172a`, slate card `#1e293b`, ink `#0f172a` / `#f1f5f9`, adviser indigo `#4f46e5`. Status colour remains semantic. The receipt is a photographed-material style authored in Blender, not a claim of documentary photography. Its physical stock and lighting are an advertising material treatment. App evidence retains the real component styling.

The round contains 12 stills (three directions × two paired light/dark themes × feed and story), four current production proof captures (Safe to Spend and Upcoming in both themes), and six silent 12-second vertical H.264 films (three directions × two themes). Stills and films are 1080×1350 and 1080×1920 respectively, at 30 fps for film. Films convey their message visually, ship with English WebVTT caption tracks, and use user-controlled playback. These are social creative drafts, not new native App Store previews or a complete replacement for C22’s earlier seven-feature library.

The financial fixture is fictional Alex Taylor, 8–30 October 2026: £610 cash, £188 expected bills, £110 buffer, £312 estimated Safe to Spend. The Upcoming view separately shows a £120 shortfall in the Bills account, which holds £68 against a £188 energy payment on 18 October. A positive pooled forecast is not evidence that every paying account is funded. Friday is a hook, not an affordability recommendation for a particular purchase.

## Skills and tool research

Reviewed on 22 October 2026:

| Source | Useful contribution | Decision |
| --- | --- | --- |
| [Official Remotion skills](https://www.remotion.dev/docs/ai/skills) and [source](https://github.com/remotion-dev/skills) | Frame-driven animation, explicit composition dimensions, reusable React artwork | Use the existing Remotion installation. Share the campaign canvas between review stills and film rendering. Load fonts locally. |
| [ad-creative by Corey Haines](https://github.com/coreyhaines31/marketingskills/tree/main/skills/ad-creative) | Separate audience, hook, proof and format; trace claims to evidence | Apply the grounding principle to PRODUCT.md, the actual fixtures and Kevin’s brief. Do not adopt its scaled production workflow, which requires customer/review and performance inputs we do not have. No performance claims. |
| [Blender command-line rendering](https://docs.blender.org/manual/en/4.5/advanced/command_line/render.html) and [Python API](https://docs.blender.org/api/4.5/) | Editable geometry, real lighting, camera control and repeatable renders | Use official portable Blender 4.5.3 LTS and a Python-authored Cycles scene for the receipt. Save the packed editable scene. No third-party Blender agent or MCP server is required for this bounded scene. |
| Local Impeccable and frontend-design skills | Deliberate direction, hierarchy, craft checks and screenshot review | Use within the Calm Cockpit rules. The context launcher could not execute, so PRODUCT.md, DESIGN.md and the relevant references were read directly. |
| [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) | Responsive fit, keyboard access, media control and semantics | Apply to the review gallery, alongside an independent creative/code review. |

No external skill was installed globally. Public skill documents were inspected as references. Blender’s first Python-module installation attempt found no matching distribution; the official portable release was used successfully instead. A rendering tool does not itself make a campaign distinctive. The durable improvement is the brief, specific hook, meaningful material and proof, followed by a real review.

For a later photography-led round, commission or supply real, licensed everyday footage. Do not invent a customer story or present synthetic people as customers. Paid music, live-action production and campaign performance research are outside this round.

## Review and reproduction

The current gallery is `/design/marketing-kit`, defaulting to the crafted receipt direction in the light feed theme. Use `direction=receipt|friday|calendar`, `mode=light|dark` and `format=feed|story`; `art=1` shows an exact-size canvas. The archived C/D/E concepts remain available through their old links and `?round=worlds`; `?library=1` preserves the existing copy, store assets and films.

Start an isolated local Next preview in the worktree. Never restart UAT from it.

```sh
# From the repository root, with Blender 4.5 installed:
blender -b -t 4 --python marketing/c22-crafted/render_receipt.py -- \
  --out frontend/public/design-media/c22/crafted \
  --font frontend/public/design-media/c22/crafted/fonts/Figtree.ttf \
  --mono frontend/public/design-media/c22/crafted/fonts/JetBrainsMono.ttf

/usr/bin/python3 marketing/c22-crafted/export_round.py --base http://127.0.0.1:3146
node marketing/c22-crafted/render_films.mjs
node marketing/c22-crafted/validate_assets.mjs
/usr/bin/python3 marketing/c22-crafted/verify_playback.py --base http://127.0.0.1:3146
```

`render_films.mjs --prepare` writes the three English WebVTT caption files before the six Remotion renders; the exporter also invokes that preparation step. The browser exporter accepts localhost only and intercepts API requests with fictional shell responses. Any unexpected API call fails it. The proof PNGs are freshly captured from the current production components, not copied from the older marketing exports. The packed Blender source is `marketing/c22-crafted/receipt-scene.blend`, outside the frontend public bundle. The bundled source fonts are `frontend/public/design-media/c22/crafted/fonts/Figtree.ttf` and `JetBrainsMono.ttf`, with their licence files. Public files and their dimensions, themes, source paths, status and SHA-256 hashes are recorded in `frontend/public/design-media/c22/crafted/manifest.json`.

Before publication, Kevin chooses a direction and checks the final placement and copy. Compliance approval and the broader existing C22/C5 store checks still apply. The independent reviewer’s final verdict is **ship for creative review**, after the dark receipt still and film were recaptured. Production build, TypeScript, ESLint and asset validation pass. All six films passed actual playback, seeking and caption checks under the local production server’s CSP; keyboard focus, 44px gallery controls and absence of autoplay also passed. The asset validator verified 30 hashed resources and fully decoded all six films. Browser evidence is under `.impeccable/review/c22-crafted/`, including `browser-result.json` and `playback-result.json`. The required backend suite and repository gates run through `scripts/session.sh finish C22 --uat-review`. The coordinator must integrate this branch before the UAT link shows the new round.
