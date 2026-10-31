# G377: own-account transfer reconciliation

Own-account receipts were being classified as income when the two banks used different descriptions. Matching also missed newly connected counterpart accounts, and a confirmed pair could leave an old custom Income choice in place.

## Result

- Full structural classification revisits the last 90 days. The first TrueLayer connection sync also reconciles after storing the new rows.
- Automatic matching requires booked rows on two owned accounts, the same positive amount and currency, at most five calendar days apart, and evidence beyond amount/date. Only mutually unique pairs qualify.
- Evidence includes a specific other account number, owner identity and transfer wording on both sides, a previously confirmed private description pair, or a user-selected movement category with a transfer narrative on the other side. Shared sort codes and bare amount/date coincidences do not qualify.
- Existing transfer review handles weaker evidence, including abbreviated source-bank narratives. An explicit confirmation can correct a previous Income choice. Automatic matching still respects every custom non-movement choice.
- Pair-specific confirmation survives subsequent syncs without making generic bank descriptions into reusable category rules. Source and counterpart fingerprints are checked again before reuse.
- Reclassification invalidates the derived cashflow cache. Cashflow reads validate persisted matching evidence before excluding internal receipts from income. Changes to a counterpart, user category, ownership, currency or amount invalidate that evidence.
- Outgoing transfers remain in source-account recurring-payment projections. Savings and card destinations retain the existing Savings/Debt refinement. No bank amount, date or balance is changed.
- Income detection considers the latest user correction across the whole account-specific payer series before filtering Income rows. A Transfer correction therefore removes the old series immediately, including its confirmed-schedule fallback. A later Income correction can restore it.
- Historical corrections remain context after the transaction leaves the 180-day window. Confirmed forecasts also revalidate historical transfer pairs against their actual counterpart. Those older amounts never become new forecast occurrences.
- Legacy confirmations with conflicting evidence across same-named accounts cannot apply their schedule to another account. Stored preferences remain intact; independent eligible income still detects on its own cadence. Missing history or a provider category of Other alone does not cancel a confirmed salary.
- Automatic reward rules, learned suggestions and the background classifier no longer categorise debits as Income. Explicit user Income choices and income reversals remain supported. Existing stored debit categories are not mass-rewritten; the reported historical Perks row can be corrected through its transaction category.
- The direction invariant is shared across machine rules, cached suggestions, the owner-name model pass, on-demand categorisation and cached/fresh vendor decisions. It depends on the bank transaction direction, never on a particular description. User-authored rules and direct category corrections are deliberate instructions, including Income reversal choices, rather than machine guesses.
- A saved user correction outranks newer automatic history. Its persisted correction timestamp remains authoritative after the teaching-event log expires. Automatic writes recheck that the row has no user correction, so an in-flight result cannot overwrite a later choice.

## Verification

Focused tests cover the reported joined-initials narrative, account-number evidence, five-day posting delays, ambiguity, same-account refunds, currency mismatches, invalid amounts, manual overrides, late connections, the 90-day boundary, user isolation, idempotence, stale evidence and first-connection ordering. Cashflow input tests exercise the real query projections and keep the source debit while excluding only a valid matched receipt. Existing transfer-review, cache-staleness and refresh tests are included.

Follow-up regressions run the real category PATCH, dirty-cache marking and immediate read-side recompute, retaining genuine salary and outgoing payments while dropping the corrected payer and confirmed fallback. They cover corrections older than the forecast window, account-specific and legacy confirmations, orphaned historical pairs, both provider ingestion paths and preservation of explicit Income debits.

Generic regressions repeat those flows with unrelated payer names and a custom movement category, inject incorrect Income model responses for debits in every model path, exercise cached vendor and merchant decisions, and correct a row while an AI request is in flight. No production condition recognises the reported example descriptions specially.

No live account data was modified during development. Existing data is revisited by the normal sync/classification path after integration; this branch does not run a production migration or restart services.
