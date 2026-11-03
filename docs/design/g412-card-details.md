# G412: card details design round

Status: Kevin chose A, Payment first, and it shipped in production Account details (`components/CardDetailsSections.tsx`, edited through `components/CardTermsSheet.tsx`). The `/design/card-details` preview was deleted at fold-in (H113). The record below is the design round as proposed: A, Payment first, and B, One tidy record. Both consolidate payment settings, rates, recorded deals and connection management in one full-height Account details sheet. They inherit the current Figtree/JetBrains Mono scale, neutral surfaces, shared SheetFrame, bank identities and solid indigo actions. The production hero, card holds and engine are unchanged pending Kevin's selection.

## Latest product decision

Statement dates are optional. Without complete dates, retain the existing learned-repayment fallback and the existing Home hold wording. Do not introduce a missing-dates prompt, name a card to ask for dates, or otherwise add Home copy. Dates are discoverable only in card details.

## What the comparison demonstrates

- The closed statement bill and spending after that close are different amounts. Each has its own label. An estimated bill is not a verified statement balance.
- Payment method records in-full Direct Debit, minimum, fixed amount or manual payment. It replaces the separate clear-monthly question. Fixed payment and statement total never share a label.
- Due dates support a day of the month or days after closing. Paying account is explicit, including a business charge card paid from a personal current account.
- Unknown payment amounts do not become zero or an invented minimum. Editing dates invalidates the displayed illustrative estimate until refreshed evidence is available.
- APR, active 0% deals and unused offers have separate meanings. Active deals retain the existing purchase, balance-transfer or combined coverage, rather than being recast as one kind. A charge card does not get a fabricated purchase APR.
- Current, savings and offline examples share row alignment and spacing. Eligibility and locked-inclusion reasons remain visible. Offline accounts have no empty connection block.
- A proposed earmarked-move line appears inside calculation evidence, as information only. Moving cash between counted accounts does not reduce the pooled total twice.

All preview data is synthetic. The snapshot date is 3 November 2026 and the next payday is 27 November. Controls change only the preview session. No bank payment, connection refresh, account mutation or external request is performed.

## Implementation contract after selection

Persist optional close day, due-date rule, payment method, explicit fixed amount where relevant and paying account through the existing card terms/account API. Preserve authenticated ownership checks, validation and propose-only Penny approval. Existing card-terms links need a backwards-compatible route into the consolidated sheet.

Create one canonical dated payment due in shared window inputs, not independent frontend totals. Its amount depends on payment method: an in-full Direct Debit uses the estimated statement bill, a fixed payment uses the recorded fixed amount, and a minimum payment needs a verified minimum. A manual method does not itself create a cash debit. Keep statement liability separate from that payment amount. Home, Upcoming, payday plan, cover plan, debt plan and Penny must consume the same result, with one compute-on-change invalidation path. A learned repayment and the statement-derived payment for the same card must not both count. Business classification alone must not suppress a personal cash liability.

The statement period excludes spending after its close. A closed bill counts in the current cash window only when its due date falls before the next payday and the paying account is within scope. Before production, define day 29 to 31 clamping, leap years, offsets across months, exact payday boundary and timezone, refunds/credits, fees/interest, existing carried balances, payment already observed, incomplete transaction coverage, source changes and partial configuration. Transaction spending alone must remain labelled estimated rather than presented as an exact bank statement bill. Minimum and manual payments require genuine payment evidence; no guessed cash debit or false coverage.

Retain connection/reconfirmation, refresh, pin/remove, account-specific actions, masks including negative signs, and the server's counted-account eligibility/refusal. Remove the temporary comparison and index on approved fold-in under H113.

## Verification

The root agent runs fixture tests, TypeScript, design index/no-live-data/stale checks, true phone and desktop browser checks in both themes, signed DOM/ARIA masking and sheet/form keyboard/touch checks. An independent source/visual review is required before the design round is handed to the coordinator. Mandatory session-finish checks remain the final handoff gate.
