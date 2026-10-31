# G382 transfer review decisions

Impeccable design round at `/design/transfer-review-decisions`:

- A, Decide as you go: four clear choices for the payment; a separate confirmation before pairing both account entries.
- B, Check the match: show the possible pair first, with an explicit option to review separately.

Both group by account, count unresolved reviews, and collapse other payments until selected. Query controls: `variant=a|b`, `mode=light|dark`, `state=ready|loading|empty|error`, `hidden=1`. All preview decisions are local fixtures. Card repayment handling remains G381; this preview does not claim it is implemented.

## Persistence repair

Confirmed pairs remain tied to their exact transaction IDs and source fingerprints, including when older than the 90-day automatic discovery window. Structural and ordinary rule passes preserve them. Changed bank facts or a newer explicit correction invalidate obsolete evidence. Read-time review queries resolve saved evidence while provider refreshes have temporarily reset automatic categories.

An explicit spending category or dismissed spending series is not proposed again as a transfer. A rejected pair remains rejected; saying two entries are not the same transfer does not decide what the individual debit was. Failed saves restore their rows and expose a retry instead of looking successful until refresh. No merchant descriptions are hardcoded and no generic rail is turned into a global category rule.

Targeted tests cover old confirmations, manual movement anchors, changed evidence, rule passes, review reads during refresh, explicit spending, dismissals and focused counterpart queries. `node frontend/scripts/verify-g382-review-decisions.mjs` (after a frontend build) exercises the real component against synthetic rejected/successful saves in Chrome.
