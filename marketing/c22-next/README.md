# C22: product film rework

Creative review draft. No advert has been approved or published.

This round responds directly to the rejection of the previous campaign round: its static poster reveals were too weak to carry the idea. The new proposal uses two edited 15-second product films, one about the balance and one about the account, plus three independently designed still directions: amount, account and working. This is a campaign extension inside Sorted's established identity. PRODUCT.md and DESIGN.md remain authoritative, and production app behaviour and the existing store kit remain unchanged.

## Deliverables and evidence

There are two 15-second films in paired light and dark treatments. They use original sound design, with no synthetic voice, paid music or stock photography. The still set has three separate art directions, each delivered as a light and dark feed image at 1080×1350 and a light and dark story image at 1080×1920: 12 PNGs in total. The directions are deliberately distinct: the amount makes the number the subject, the account grounds the number in the paying account, and the working shows how the estimate is formed.

Current production UI captures are fully loaded and include the Spend from account context. The fixture is fictional Alex Taylor, 8–30 October 2026: £610 cash − £188 expected bills − £110 buffer = £312 estimated Safe to Spend. The Bills account separately holds £68 against a £188 energy payment, showing a £120 gap. A pooled forecast does not prove that every paying account is funded.

All files are review drafts. They are not evidence of user approval, compliance approval or advertising approval. `frontend/public/design-media/c22/next/manifest.json` records the source dependency hashes and hashes of every deliverable. The validator refuses a capture when its production component source has changed.

## Before, after, why

| Before | After | Why |
| --- | --- | --- |
| Silent static reveal | Purposeful cuts, number movement and original sound design | Give the financial question a readable sequence and a reason to keep watching. |
| One art selected | Clearly separate amount, account and working images and films | Let each execution carry one idea instead of asking one poster to do every job. |
| Partial or loading proof | Ready, fully loaded production state with Spend from account context | Make the product evidence complete enough to inspect and financially truthful. |

## Skills and tool research

This round reuses the verified research from the prior campaign README: [official Remotion skills](https://www.remotion.dev/docs/ai/skills) and [source](https://github.com/remotion-dev/skills), the [Blender command-line rendering documentation](https://docs.blender.org/manual/en/4.5/advanced/command_line/render.html), and the local Impeccable, frontend-design and Emil motion skills. Remotion supplies deterministic frame-driven rendering, Blender remains useful for authored source material where needed, and the design skills support hierarchy, craft and motion review. A tool alone cannot repair a weak creative direction, so the acceptance test is the sequence, proof and edit, not the presence of a named tool.

## Review and reproduction

Run the commands from the repository root with a local Next preview. The scripts are deliberately local and bounded. `export_round.py --proofs-only` captures the current production proof set; the final export captures the stills and records their source metadata and hashes. `render_films.mjs` renders the two 15-second films and prepares their sound and caption assets where configured. `validate_assets.mjs` checks dimensions, hashes, film properties and manifest completeness.

```sh
/usr/bin/python3 marketing/c22-next/export_round.py --base http://127.0.0.1:3146 --proofs-only
/usr/bin/python3 marketing/c22-next/export_round.py --base http://127.0.0.1:3146
python3 marketing/c22-next/sound_design.py
node marketing/c22-next/render_films.mjs
node marketing/c22-next/validate_assets.mjs
/usr/bin/python3 marketing/c22-next/verify_gallery.py --base http://127.0.0.1:3146
```

The implementation's source dependency hash and manifest files are the record of which production captures, fonts, sound assets and renders were used. Before publication, Kevin must review the final placement and copy, and the normal compliance and C22/C5 store checks still apply. The coordinator must integrate the branch before any UAT route can show this round.

The independent review inspected the final stills, film contact sheets and frame timings, and found no clipping, readability or financial-truth blocker. It did not watch continuous playback. The separate browser check plays, pauses and seeks all four actual MP4s, loads all five caption cues, checks the gallery at 320, 390 and 1440 pixels, and checks the preserved archive routes. It makes no judgement about campaign performance. The gallery also passed a review against the [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md), after URL state, focus states and tap targets were addressed.

## Balance film revision, 23 October 2026

Kevin requested a softer calculation panel and a prelaunch closing frame. Both light and dark `Balance, in view` films now use the following treatment:

| Before | After | Why |
| --- | --- | --- |
| Calculation capture against a square edge | 36 pixels of internal space, 32 pixel corners and a subtle border | Keep the full capture, operators and figures away from the panel edge. |
| Explore Sorted and an outbound arrow | Coming soon, with the matching final caption | Describe the product as coming soon rather than inviting immediate use. |

The five-shot edit, 15 second duration, sound, financial figures and production UI capture are retained. Re-export just these two films with `node marketing/c22-next/render_films.mjs balance-light balance-dark`, then refresh the manifest with `node marketing/c22-next/render_films.mjs --index-only`. The browser verifier captures the calculation and closing frames at phone size in both themes, and checks actual picture content, playback and the new closing caption. Other campaign films and image designs are outside this revision.

Revision verification passed: TypeScript, scoped ESLint, source/asset hashes, full decoding of the four original films, and real browser playback/seek/non-blank-picture/caption checks. The new final caption says Coming soon. Calculation and closing frames were inspected at phone size in both themes, with gallery layouts checked at 320, 390 and 1440 pixels. All other campaign media and all production components remain unchanged. The repository delivery gate runs separately through `scripts/session.sh finish`.
