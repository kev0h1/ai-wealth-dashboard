# G382 transfer review decisions

Kevin approved B, Check the match, on 1 November 2026. The production transfer review now groups by account, shows both sides before confirmation, and offers Review separately. Other payments expand into clear choices. The retired preview has been removed.

Separate review is a durable queue, not a category decision. Both payments stay independently reviewable after reopening or refreshing; an explicit correction resolves only its own entry. Counts use disjoint review cards, excluding pair legs from grouped series. Loading, failed saves and failed reloads never look like an all-clear.

Savings and spending reuse the teaching flow. Paying off a card confirms a Debt category on that payment only; automatic card-side matching remains G381. Amounts respect the Hide balances preference, retaining incoming/outgoing signs. The nested teaching sheet uses the shared nested-sheet contract.

## Persistence repair

Confirmed pairs remain tied to their exact transaction IDs and source fingerprints, including when older than the 90-day automatic discovery window. Structural and ordinary rule passes preserve them. Changed bank facts or a newer explicit correction invalidate obsolete evidence. Read-time review queries resolve saved evidence while provider refreshes have temporarily reset automatic categories.

An explicit spending category or dismissed spending series is not proposed again as a transfer. A rejected pair remains rejected while its source facts are unchanged; saying two entries are not the same transfer does not decide what the individual debit was. Failed saves keep their rows visible and expose a retry instead of looking successful until refresh. No merchant descriptions are hardcoded and no generic rail is turned into a global category rule.

Targeted tests cover old confirmations, manual movement anchors, changed evidence, rule passes, review reads during refresh, explicit spending, dismissals and focused counterpart queries. `node frontend/scripts/verify-g382-review-decisions.mjs` (after a frontend build) exercises the real component against synthetic rejected/successful saves in Chrome.

Every review write now awaits the shared cache-version bump before returning, so an immediate read from another API process cannot restore a stale review. Focused coverage includes alternate candidates, missing transaction currency and changed bank facts.
