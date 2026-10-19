# G292: one signal, one reading column

Historical design round and approved fold-in record, Operate mode. This inherits Home's Calm Cockpit, not a new visual identity. The audience is checking a phone quickly, in daylight or at night; both existing themes are required. Kevin chose A on 19 October 2026. The temporary preview is retired in the fold-in described below; the original design-round evidence remains a record of that preview only.

## Direction contract

THESIS: a resolved Home card needs one success signifier and a stable reading edge, not two ticks and an icon-shaped hole.

OWN-WORLD: existing Figtree and mono money, slate/white glass cards, 16px padding, small semantic marks, the actual V2 DismissChip. No extra hero, gradient or new palette.

STORY: read which account is covered, the amount and date, then the hedged explanation. Inspect sibling move and tip cards without relearning their anatomy.

FIRST VIEWPORT: a full real Covered card leads. A removes the large tile and keeps the inline tick; B retains the tile, removes the inline tick and aligns all evidence in its text column; C removes both icons and lets Covered be the single word-based signal. Dismiss stays top-right with its clear target.

FORM: code-led layout variants over unchanged production cards, using synthetic typed props and preview-scoped CSS. This is a local extension, so no new-world seed or comp is applicable. A mixed family view proves the same reading edge on move/cover/tip siblings; it does not replace their content.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Acceptance and verification

- Exact existing card copy, hedges, meaningful signs, evidence, routes and dismissal behaviour. Covered never means paid. Tip claims stay facts-only. Money masking includes accessible text.
- Actual exported HomeBrief cards and HomeInsightSpotlight via preview props; no copied production card or new production API/prop. Preview navigation and dismissal are local only.
- 390px light/dark, narrow 320px and desktop; long account names, long evidence, masked and missing optional body. Native focus and 44px targets. No overlay collision with the dismiss chip.
- Root owns index, board, Git, builds, browser captures and final review. Impeccable layout assessment is independent from mechanical checks. Launcher/detector are unavailable (permission denied), so source-backed and manual checks are disclosed instead of claiming a detector pass.
- Publish with `finish G292 --uat-review`, not blocked on an unpublished choice. Preserve DESIGN.md until approval; remove the temporary round at approved fold-in under H113.

## Review verdict, 19 October 2026

PASS. Independent implementation-agent finish review examined all ten first-batch captures, the direction contract, project design rules, actual component contracts, source and browser results. No required changes remained. A separate documentation audit confirmed no new durable rule or generated asset: preserve DESIGN.md and the design sidecar until the approved fold-in. Specialised Impeccable reviewer/documenter roles are not available in this session; fresh independent agents used the documented fallback contracts instead.

The production-mode confirmation passed 43 layouts across 390px light/dark, 320px long text, 1280px family and an independently masked family case. It verified a single signal, aligned Covered text/evidence/body, unchanged 44px dismiss hit areas, local touch/keyboard navigation, both dismiss paths, Reset, masking, no horizontal overflow, no exceptions and no customer API attempts. Root inspected the confirmation captures. Fixture/component rendering tests, TypeScript, lint and a production build passed. This proves the preview only; production is unchanged. Final backend/frontend workflow gates run again at session finish.

Evidence remains local under `frontend/.impeccable/review/g292-final/`; `browser.test.mjs` and `fixtures.test.mjs` reproduce the synthetic checks. The manual CDP workflow overrides the phone viewport and waits for hydration and fonts explicitly, rather than relying on Chrome's clamped command-line window size. The first sandboxed Chrome launch was denied; verification ran with approved local-browser access. No generated imagery ships in this round.

Web Interface Guidelines were checked alongside the repository rules: native labelled controls, focus visibility, a skip target, large tap targets, reduced-motion support, responsive wrapping and both colour schemes. Existing project sentence-case and financial-colour rules take precedence over generic style preferences.

## Approved A fold-in, 19 October 2026

Kevin chose A in chat: inline Covered tick, no large decorative tile and one full-width reading column. `CelebrationCard`, both `MoveCard` branches and both `UnfundedMoveCard` branches now implement that anatomy directly, without preview CSS. Their labels, wording, financial logic, meaningful signs, bank identities, evidence, actions and V2 dismiss controls are unchanged. `HomeInsightSpotlight` drops the redundant outer horizontal inset in both its loading and loaded paths; the inner 16px inset remains. The approved rule is recorded in DESIGN.md.

Before retirement, the temporary round rendered these changed production components with all A anatomy overrides removed. Its production-mode browser check passed 15 layouts across 390px light/dark, 320px long text, 1280px family and masked compact-family examples, plus native touch/keyboard opening, both local dismiss paths, Reset, no overflow, no exceptions and no customer API attempts. Root inspected all six captures at `frontend/.impeccable/review/g292-a-foldin/`. These are synthetic component checks, not authenticated Home screenshots or evidence of deployment.

The permanent `check:g292-home-anatomy` gate renders 14 production card cases, including both compact and fallback move paths, dismiss semantics, semantic marks, hedged Covered wording, existing routes, financial fixture reconciliation and supported money masking. Raw props exposed a pre-existing masking gap in the legacy move fallback's headline and no-destination body. That is recorded separately as B54; no pre-masked fixture hides it and this layout change does not claim to fix it.

H113 retirement: the complete `app/design/home-covered-anatomy/` directory and its index entry are deleted. No production, Remotion, script, compliance or approval-pack dependency needs the round. Synthetic regression data moved to `frontend/scripts/fixtures/g292-home-anatomy.ts`; the permanent test imports components directly, not a retained preview. Previous preview URLs and round-only test paths above are historical and no longer served. No new raster assets ship. The coordinator owns merge and publication after normal session finish, not a further design-choice round.

Final independent source and visual audit: PASS, with no required changes. A separate documentation audit also passed. Both confirmed approved-A parity, preview retirement and the explicitly recorded B54 limitation. Web Interface Guidelines review found no new accessibility issue in the changed layout; existing keyboard activation, focus treatment, native dismiss controls and semantic colour marks are preserved.
