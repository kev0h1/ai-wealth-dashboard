# G320 direction contract

## Direction contract

THESIS: Use the space beside the cash figure for readable account choices while retaining the complete card-activity story. Mode: Operate, a local extension to the existing card. Round two responds to Kevin's UAT screenshot and omitted card fixtures in round one.

OWN-WORLD: Inherit Sorted's Calm Cockpit, slate-50 light ground and slate-900 dark ground, white/slate-800 card surfaces, restrained indigo controls, existing sans UI face and Mono figures. Preserve G314's 11px label, 30px hero, 13px supporting copy and 12px metadata. No new visual identity or material treatment.

STORY: Read the cash estimate, identify an account beside it, then distinguish purchases on cards, a confirmed repayment and an unconfirmed reserve. Compare the same full-card fictional data across three new layouts.

FIRST VIEWPORT: On a 390px phone, compact comparison controls precede one production card. On desktop, controls sit to its left. D/E/F place account identities beside the 30px cash figure through the existing heroAside preview slot. The approved G322 scope, counts line and disclaimer, the actual card-activity panel, calculation and footer actions remain. Large amounts use a full-width account layout to protect the hero's readability.

FORM: D named account rail, E paired bank columns, F lead account with alternatives folded beside the figure. A/B/C remain available as the previous round. No concept seed applies: new-work.md excludes local extensions from the roll. The signature interaction is F's native keyboard disclosure; no new animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This extends the existing system; DESIGN.md remains the authority and no new raster assets are introduced. The incumbent SafeToSpendCard is the quality reference, not a new world or an approved image comp.

The problem is the account guidance, not the hero's name. Bank marks should identify an account group rather than interrupt a sentence. One shared spending limit must never look like a separate allowance at every bank.

A, Bank row: the smallest open treatment. A separate shared limit precedes a wrapping row of bank identities. Genuinely lower limits sit with their bank; a move note is its own sentence below the row.

B, Account list: account identities form a single aligned list below the shared limit. Lower amounts align right. A held-back move amount sits under its actual source account.

C, Folded accounts: one account stays visible with other options behind a native, keyboard-accessible disclosure. The shared limit stays visible even while alternatives are closed. The move context remains on the example move above the hero. This saves space but makes the alternatives less immediately visible.

All six proposals use the production SafeToSpendCard through its existing preview slots. This round changes no production component. It inherits the previous preview force-hide flag without changing saved preferences. No source model, cap, reservation or API is changed. G300/G303's invariant remains: one shared pool, with genuinely lower named account limits retained and explicitly non-additive. The current-layout comparison reuses the existing combined rule. The pooled limit is never repeated at every bank.

Fixtures are fixed, fictional snapshots shaped like already-capped SpendFromAccount records. They cover one account, two or three accounts sharing a cap, differing limits that fit inside the pool, a lower account within a shared cap, two lower limits that overlap, a pending cover move from a spend-from account, same-bank disambiguation and a missing bank logo. Three-account examples exercise the renderer with an explicit array; the current Home selector normally surfaces two ranked entries. A fold-in must deliberately connect any chosen three-account presentation to the source data rather than invent another limit calculation. The pending-move context above the card is illustrative and has no action or server operation.

Round two adds seven full-card fixtures: the £242 / £96 / £54 example with £1,947 purchases, a confirmed clear-monthly bill, an unconfirmed £325 reserve against £252 cash leaving −£73, card activity alongside a pending move, three shared accounts, a long cash figure and zero activity. Cash steps reconcile before the separate fallback reserve. Confirmed card repayments are inside dated bills; ordinary card purchases are not subtracted again. The reserve state offers no spend-from account. New proposals inherit the real CardBalanceFact rather than replacing or hiding it. In the right-side rail full-cap account amounts are omitted, so a shared estimate cannot appear as a separate allowance at every bank.

The route's CSS module restores the real CardBalanceFact's display inside this preview only: the shared nav-exempt rule otherwise hides every aside on design routes. Browser verification checks actual panel visibility as well as its DOM content. No global CSS or production component is changed.

G322 has now implemented Kevin's G321 wording choice. All six proposals inherit Estimated left to spend, Held in, the counts line and the revised disclaimer. Earlier A/B/C account captions now also use held wording. This layout round makes no further wording/legal decision. Currency in the example captions masks with the card.

The preview temporarily applies its URL-selected theme to the document and restores the previous class and colour scheme on unmount. It does not write the user's saved theme or balance preference.

Verification: true 390px light/dark captures, narrower and desktop checks, shared-cap and lower-limit checks, same-bank naming, all amounts masked under Hide balances, native disclosure, restored URL state, no live API requests, Web Interface Guidelines audit and independent review. Production layout remains unchanged pending Kevin's choice. Publish with session.sh finish G320 --uat-review, then retire this directory and both optional G320 browser scripts when the chosen layout is folded in, unless another open item or approval pack still needs them.
