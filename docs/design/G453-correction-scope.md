# G453 correction scope

Impeccable, Operate mode. PRODUCT.md and DESIGN.md remain the visual authority. This design round extends the existing TeachingSheet and shared SheetFrame. It changes no production component or API and never sends a real correction.

## Two coded flows

A, Separate scope step, gives the correction a dedicated Which payments should change? screen after the classification is known. B, Inline review, keeps the teaching title and reviews classification, immediate impact and scope together. Both use the same three choices and the same fictional evidence model.

The default is This payment only. The usual fixture has one selected outgoing payment, 23 eligible earlier payments and three manual choices that stay protected. This and earlier updates 24 now without creating a future rule. Earlier and future updates matching booked history and saves a removable future rule. The older-payment fixture makes that interpretation explicit: 24 eligible payments on or before the selection, 26 across recorded history. Currency, direction, pending status, payee identity and user ownership stay distinct in the fixture model.

Savings and investments reach scope directly, without a naming input. Goal selection and the visible offline-account name retain their separate purpose. Every correction path reaches the shared scope question once. The confirmation reports the committed fixture count, protected choices and whether a future rule was saved. Undo restores the fixture snapshot and any previous rule. Removing the future rule leaves updated payments alone and offers Undo removal.

## States and verification

The previews include ordinary and protected histories, no eligible earlier payments, unknown counts, a known save failure, a saved correction whose figure refresh failed, hidden monetary values, long payee copy and an older selection. Unknown counts disable the wider options rather than fabricating zero. A saved correction retries its refresh rather than submitting the correction again.

Verified both flows with real browser input: 92 assertions cover all seven classification paths, one-off defaults, exact confirmation counts, manual protection, unknown-count recovery, save retry, refresh-only recovery, rule removal and Undo, native radio keyboard input, dismissal, signed hidden money and horizontal overflow. Fourteen final fixture captures cover 390px and 1440px in both themes, signed privacy masks and a long payee at 320px. The root agent inspected every capture. B retains the shared sheet's vertical body scrolling at narrower or shorter viewports, with the action footer fixed.

The actual Next.js preview and gallery routes return HTTP 200. Both variants hydrated without browser exceptions or API requests, with two additional actual-route captures inspected. The model contract test passes for counts, immutability and exclusion of protected, pending, foreign-user, other-payee, other-direction and other-currency rows. TypeScript, scoped ESLint, design-index and strict design-stale checks pass.

An independent agent accepted the final diff and evidence against PRODUCT.md, DESIGN.md and the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). The offline-account input has a meaningful name and label. Explicit Back revises the local draft; Escape and browser Back retain the established teaching-sheet dismissal path. This is preview verification, not evidence of production mutation safety.

## Production fold-in contract

The current PATCH and spending resolution paths write the learned merchant cache. Independently, categorisation Pass 2.5 and Pass 4 treat manual categories as future-propagation inputs. Simply hiding the existing rule prompt would therefore make This payment only false after a sync. The first two scopes need explicit non-learning provenance and must suppress both immediate cache learning and later propagation, without deleting a pre-existing future rule.

Use one authenticated, server-owned preview/apply contract. Derive eligible booked records from persisted identity and time scope; do not trust client-provided sibling IDs or the capped similar-transactions endpoint. Recheck manual-category protection in the mutation itself and return actual changed IDs/counts. Preserve direction, currency, provider identity and destination ownership. Use an operation identity so a lost response cannot duplicate an apply.

Future rules need typed resolution semantics. A category-only rule cannot faithfully preserve goal/offline links or the taught-card-repayment flag. Keep debit-only movement validation, existing goal ownership, offline-name normalisation/reuse and destination-link cleanup. Rule removal stops future application without recategorising history. Undo must remove a newly created rule before restoring records and must not use an executor that re-learns that rule.

After durable correction, invalidate and recompute through H145. A saved-but-refresh-failed response must remain saved and support a refresh-only retry. No current preview proves those production mutations; implementation and backend scope/protection tests follow the approved design.

## Policy questions before production writes

Two clarifications have been requested: whether an explicitly selected previously categorised payment may be replaced while protecting all other manual choices, and whether Earlier and future includes already-booked payments later than an older selection. These previews preserve all manual categories and explicitly propose all booked matches for the latter option. Goal/offline/card rules must carry the selected resolution's actual semantics rather than silently becoming a category-only shortcut.
