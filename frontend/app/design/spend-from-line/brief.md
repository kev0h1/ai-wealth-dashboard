# G320: taste-led third round

## Design read and audit

Reading this as: a mobile money-card redesign for UK consumers, with a calm, trust-first language, using Sorted's existing design system.

Skill: `.claude/skills/design-taste-frontend/SKILL.md`, requested by Kevin and loaded from the shared checkout (the skill directory is not tracked into worktrees). Mode: redesign, preserve. DESIGN_VARIANCE 4, MOTION_INTENSITY 2, VISUAL_DENSITY 5: distinct information structures, quiet native interactions and a compact financial instrument. The skill is chiefly for site/marketing redesigns; its contextual audit, composition, density and pre-flight principles apply here. PRODUCT.md and DESIGN.md control product truth, accessible type, colours and legal copy. No marketing images, scroll effects, new fonts or design-system packages belong in this money card.

Audit: A-F change account placement inside the same long production card. The cash figure has space beside it, while the separate card panel, repeated contextual copy and footer still make the card tall. The first two rounds did not explore the relationship between the cash instrument and card activity. Preserve the 30px ink cash figure, current status semantics, G322 counts/disclaimer, lower account limits, signed calculations, card reserves, real routes, masking and keyboard controls. Retire the single fixed anatomy as a constraint on this proposal round.

The existing palette is slate-50/900 canvas, white/slate-800 surfaces, restrained indigo controls and semantic status badges. Figtree and JetBrains Mono, 16px corners and the existing page rhythm remain. No Penny gradient, new red, decorative images or motion. Route and navigation remain unchanged; previews are noindex and nofollow.

## Direction contract

THESIS: Give cash, account limits and card activity deliberate relationships, rather than another arrangement of bank icons.

OWN-WORLD: Sorted's Calm Cockpit and its named type, money, colour and accessibility rules. The 30px cash figure leads; a secondary card figure is 19px or smaller. Legal counts and disclaimer remain verbatim.

STORY: Read the cash estimate, identify where it can be held, distinguish purchases from cash and understand any unconfirmed reserve before taking the existing next action.

FIRST VIEWPORT: G pairs the main cash figure with a smaller card readout, H uses period context beside cash and a compact expandable card-activity row, I separates the cash instrument and card activity into sibling surfaces. Controls are compact and the same fictional case is compared across all proposals.

FORM: G Cash and card summary; H Compact statement; I Separate instruments. These are new preview components, not production patches. Existing A-F and current remain available for comparison. Native disclosures carry secondary detail; a repayment warning and safety shortfall are always visible. Long figures stack safely on a 320px phone.

FINISH: screenshot and inspect mobile and desktop in both themes; run the taste pre-flight and web guidelines, independent financial/UX review, required repository checks, then publish with `session.sh finish G320 --uat-review`. The user chooses on UAT before a production fold-in.

## Financial and implementation boundaries

The new renderers use the same fixed `fixtureHero` and `displayModel` snapshots as A-F. Reuse `deriveSafeToSpendHeadline`, `homeForecastPresentation` and `ForecastStatusBadge`; do not invent another verdict or cap calculation. No production component, API or saved preference changes. Custom markup is a coded proposal for a new anatomy, not evidence that production has shipped it.

One pooled cash estimate, never repeated as a separate allowance at each bank. Retain genuinely lower named account limits with held wording and an explicit non-additive caption. The three-account renderer example is a fixed array; Home currently selects two entries. A fold-in needs an explicit source-data decision.

Card purchases are a separate flow, not another deduction from cash. A learned repayment is already in dated bills. The £252 cash and £325 unconfirmed fallback leave a signed −£73 safety position, while the available headline stays £0. Keep that warning visible without requiring disclosure. Genuine dated payment risk alone is red. A pending move is already reflected in both cash and account snapshots, never subtracted again.

The new layouts preserve exact G322 counts/disclaimer and the substance of every card explanation. They may move approved sentences into progressively disclosed detail, but cash/card separation, confirmed due date and any unconfirmed reserve/shortfall stay visible. The native calculation retains distinct cash and card-safety arithmetic.

Previous A-F still render the real SafeToSpendCard. Their CSS-module exception restores CardBalanceFact on design routes where the global nav-exempt aside rule otherwise hides it. No global CSS changes. URL-selected theme restores the previous document state, and every dynamic amount, including case captions and ARIA, masks without changing saved preferences. The fixed £0 floor in explanatory copy is not a private balance.

## Review and lifecycle

Use fictional purchase, learned repayment, unconfirmed reserve, payment-risk, move, shared-cap, lower-limit, same-bank, missing-logo, no-activity and large-figure examples. Check 320/390/1280px, keyboard disclosures, actual rendered visibility, signs, footer actions, no API requests and no private figures under Hide balances.

Keep DESIGN.md unchanged: this round proposes layouts, not a durable system decision. When Kevin chooses and the winner is folded in, delete this preview directory, its registry entry and the optional G320 browser scripts unless another open item, compliance pack or marketing use needs them. A preview is evidence of itself only.

The fixture preview is rendered at request time so its initial content does not wait for client hydration. Only its query-selected fixed data is used. Comparison controls do not prefetch every variant/scenario. This affects the preview route only; no production service or dependency changes. Lighthouse is run from a temporary cache outside project dependencies.
