# C22 marketing-kit campaign worlds

This private review surface contains the current C22 creative-direction round. Kevin rejected the earlier gallery-led campaign treatment and asked for advertising that makes the money question tangible: 3D-style phones, physical objects and app elements appearing to come out of the screen.

The default route, `/design/marketing-kit`, presents three still concepts:

- **C · Real life**: coffee, groceries and plans around Safe to Spend.
- **D · Payday path**: a sculpted calendar route to an upcoming-payment view.
- **E · Ask Penny**: pearlescent speech forms around Penny's proposal.

The former A/B work remains available only as the product-proof and copy library at `/design/marketing-kit?library=1`. It is supporting material, not the current campaign choice and not approved campaign creative.

## What is real, what is generated

Each concept combines two deliberately separate layers:

- The scene asset is generated 3D-style advertising artwork with a blank phone screen. Its checked-in prompt sidecar records the tool, prompt, synthetic status and review status in `frontend/public/design-media/c22/worlds/*.prompt.json`.
- The visible phone screen is composed in the browser from the actual fixture-driven production components in `ProductionProof.tsx`. It is not generated interface lettering or a dashboard lookalike. Controls are inert: no bank connects, no money moves and no consent is given.

The generated scene assets are synthetic and unapproved creative-direction material. They do not alter the Sorted app identity or `DESIGN.md`. Figtree, JetBrains Mono for money, slate grounds, solid indigo actions and Penny's reserved indigo-to-violet treatment remain the governing visual system.

## Current status and provenance

This new round contains three generated blank-screen scene assets and six campaign exports: feed and story artwork for C, D and E. Responsive browser checks and the six-file asset validator passed on 8 October 2026. Creative selection is still pending. Each exported RGB PNG carries embedded `Source` provenance for the ticket, concept, canvas, browser composition, real production props, separately generated scene and synthetic/draft status. Its `exports.json` record adds dimensions, byte size and SHA-256. Generated source PNGs also carry their exact prompt-sidecar data in `Source` metadata, inserted without changing their pixel data.

The 216 PNGs and ten silent MP4s in `frontend/public/design-media/c22/` belong to the **previous A/B product-proof library**. Those earlier assets passed their recorded asset checks and browser QA on 8 October 2026. They are not verification evidence for C, D or E, and the new round has no finished 3D films. The motion descriptions in the concepts are direction notes only.

## Review and export commands

Start a local preview from `frontend`, then run the bounded worlds check against that local server:

```bash
npm run dev -- --port 3134
/usr/bin/python3 app/design/marketing-kit/check_worlds.py --base-url http://127.0.0.1:3134
node app/design/marketing-kit/check_worlds.mjs
```

The Python check is restricted to `localhost` or `127.0.0.1`. It captures the six exact-size exports, writes their browser-PNG `Source` metadata and manifest, and checks responsive C/D/E views, controls, invalid-query fallback, keyboard focus, no horizontal overflow and blocked unexpected API calls. Shared design-shell reads are stubbed. Use `--captures-only` only when interaction assertions are intentionally out of scope for a capture pass.

The final checker validates that all six expected feed/story exports exist, have their required dimensions, are RGB without alpha, and match their manifest hashes and provenance fields. Do not use the older `export_stills.py`, `check_assets.mjs` or `export_films.mjs` results as a pass for this campaign-world round: they verify the previous library.

## Incumbent-design comparison and review evidence

**Verdict: ordinary campaign extension, not an identity redesign.** The C/D/E artboards retain the incumbent Figtree display and body treatment, JetBrains Mono for the Safe to Spend figure, Mist and Midnight canvases, solid indigo controls and Penny's exclusive indigo-to-violet treatment. The money evidence is the actual fixture-driven production proof, not generated or recreated interface copy. C's grocery teal and coffee orange belong to physical campaign objects; D's dark, solid footer backing keeps its disclosure readable. No token, production interaction or global `DESIGN.md` rule changes with this round.

The production build, final production-content-security-policy browser/export check and six-file validator passed on 8 October 2026. Checks covered desktop, mobile and narrow layouts, controls, fallback queries, keyboard focus and unexpected API requests. The retained A/B library also passed its control and video-playback regression checks. The specialised skill launcher and role were unavailable for this round; a fresh independent substitute reviewer completed the manual audit over the final capture matrix, including D's footer backing, and returned **ship for creative review** with no material findings in scope. This evidence is not an approval to publish.

## Limitations and approvals

- These are fictional examples and private review drafts, not publication-ready advertisements.
- Kevin must choose C, D or E before a wider seven-story rollout, light/dark executions, social films or landing-page artwork is made. No current A/B choice is requested.
- No new 3D film has been produced. Motion concepts must be separately designed, rendered, reviewed and approved.
- Compliance must review financial-promotion status, claims, provider disclosure, audience and channels before publication. The stills make no approved savings, availability, investment-return or FCA-authorisation claim.
- Store screenshots and the existing App Store editorial preview remain a separate, literal product treatment. They still require native-build parity and platform review before any submission.
- Generated artwork is advertising illustration, not a photograph of a device. Prompt sidecars and exported browser-PNG metadata provide provenance, but do not replace creative, legal, accessibility or platform approval.
