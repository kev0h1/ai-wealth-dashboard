# G320 direction contract

## Direction contract

THESIS: Make the accounts a readable group with one shared limit, rather than interrupting a sentence with bank marks. Mode: Operate, a local extension to the existing card.

OWN-WORLD: Inherit Sorted's Calm Cockpit, slate-50 light ground and slate-900 dark ground, white/slate-800 card surfaces, restrained indigo controls, existing sans UI face and Mono figures. Preserve G314's 11px label, 30px hero, 13px supporting copy and 12px metadata. No new visual identity or material treatment.

STORY: Read the total, identify an account, and see any genuinely lower limit or money already held back for a move. Compare three layouts with the same fictional data.

FIRST VIEWPORT: On a 390px phone, comparison controls precede one full-width production card. On desktop, controls sit to its left. Inside the card, keep the existing hero and supporting copy, then a separate Spend from group. The Accounts action stays in its existing footer.

FORM: A wrapping bank row, B aligned account list, C one visible account plus native disclosure. These are the three local proposals in that order. No concept seed applies: new-work.md explicitly excludes local extensions from the roll. The signature interaction is C's keyboard-operable disclosure; motion follows the existing control press response with no new animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This extends the existing system; DESIGN.md remains the authority and no new raster assets are introduced. The incumbent SafeToSpendCard is the quality reference, not a new world or an approved image comp.

The problem is the account guidance, not the hero's name. Bank marks should identify an account group rather than interrupt a sentence. One shared spending limit must never look like a separate allowance at every bank.

A, Bank row: the smallest open treatment. A separate shared limit precedes a wrapping row of bank identities. Genuinely lower limits sit with their bank; a move note is its own sentence below the row.

B, Account list: account identities form a single aligned list below the shared limit. Lower amounts align right. A held-back move amount sits under its actual source account.

C, Folded accounts: one account stays visible with other options behind a native, keyboard-accessible disclosure. The shared limit stays visible even while alternatives are closed. The move context remains on the example move above the hero. This saves space but makes the alternatives less immediately visible.

All three use the production SafeToSpendCard through its existing preview body slot. The hero label, G314 type roles, forecast semantics, buffer, calculation, disclaimer and Accounts route remain the incumbent implementation. The only production-code extension is a force-hide flag on that existing preview slot: it can redact fictional figures without changing saved preferences; absent, the shipped masking path is unchanged. No source model, cap, reservation or API is changed. The proposals preserve G300/G303's invariant: one shared pool, with genuinely lower named account limits retained and explicitly non-additive. The current-layout comparison reuses the existing combined rule. The pooled limit is never repeated at every bank.

Fixtures are fixed, fictional snapshots shaped like already-capped SpendFromAccount records. They cover one account, two or three accounts sharing a cap, differing limits that fit inside the pool, a lower account within a shared cap, two lower limits that overlap, a pending cover move from a spend-from account, same-bank disambiguation and a missing bank logo. Three-account examples exercise the renderer with an explicit array; the current Home selector normally surfaces two ranked entries. A fold-in must deliberately connect any chosen three-account presentation to the source data rather than invent another limit calculation. The pending-move context above the card is illustrative and has no action or server operation.

G321 owns the separate wording/legal review. This round does not rename Safe to Spend, change its hero sentence, claim that money is guaranteed, or decide any legal question. The prototype's shared-limit phrases are layout content for Kevin's choice, not an approval of revised product wording.

The preview temporarily applies its URL-selected theme to the document and restores the previous class and colour scheme on unmount. It does not write the user's saved theme or balance preference.

Verification: true 390px light/dark captures, narrower and desktop checks, shared-cap and lower-limit checks, same-bank naming, all amounts masked under Hide balances, native disclosure, restored URL state, no live API requests, Web Interface Guidelines audit and independent review. Production layout remains unchanged pending Kevin's choice. Publish with session.sh finish G320 --uat-review, then retire this directory and optional G320 browser script when the chosen layout is folded in, unless another open item or approval pack still needs them.
