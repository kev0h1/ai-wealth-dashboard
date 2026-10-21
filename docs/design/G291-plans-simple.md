# G291 approved plan journey

Kevin approved A Small steps on 21 October 2026. This fold-in replaces create, edit, tracking and View plan sheets. Upcoming set-aside cards and Goals page cards retain their existing markup and styling. G274 remains cancelled; its keep-here intent is included here, not shipped separately.

## Approved interaction

New goal starts with a name, then target amount and month, paying account, savings pots, tracking and review. New Upcoming set-aside starts directly with its purpose, then amount and recurrence, paying account, optional receiving account, tracking and review. There is no redundant goal-versus-set-aside question on either explicit entry.

Tracking is offered before the final Save for both kinds. A payment, a category and Not now are distinct choices. Categories use the canonical built-in/custom category list, icons and colours in labelled radio rows, not the operating system's select popup. Only the final review saves. Review navigation cancels the click default so its newly rendered Save button cannot submit in the same tap.

Existing goals and set-asides open on the approved balanced View plan. Contribution and target or cadence share the width, progress spans the goal sheet, and account identities align in a consistent value column. Edit fills the footer; Pause or Resume and Delete share equal secondary tracks. Delete has explicit confirmation. Back from editing discards the draft and returns to the saved record inside the same physical sheet.

Impeccable harden/polish informed the fold-in, using PRODUCT.md and DESIGN.md directly because the context launcher was unavailable. The Web Interface Guidelines gate supplements independent source review. No new aesthetic direction or raster asset is introduced.

## Financial contract

- The live goal preview uses the user's actual pay calendar and the shared pot ledger. A date-only edit preserves the stored pot baselines and manual contributions. Unchanged pot links are omitted from PATCH.
- Include existing pot money is explicit. Existing oldest-first shared claims and the target cap remain authoritative; a raw account balance is never credited to two goals.
- Category metadata is persisted for both kinds. Read-only activity uses the effective category, selected paying account, actual period and effective-date bounds. Refunds retain their sign. Own moves and card repayments do not become category spending. For a goal or a receiving-account set-aside, only corroborated source-to-destination transfers are evidence. Same-value transfer pairing is conservative, not proof of bank-level transfer identity.
- Saved View activity derives route, category and window from the owned saved record. Editing explicitly requests draft evidence while preserving its own claim rank and fixed once-only window. Stale responses are discarded when the draft scope changes.
- Category evidence does not independently release a reserve or credit goal progress. Existing payment fulfilment and the shared pot ledger remain the financial authorities.
- An optional receiving account is persisted separately from payment matching, including when tracking is Not now. Source-only reserves have no fictitious destination; manual reserves remain fully held back. Category and intended-route destinations must agree.
- Goal Pause is a real paused flag, not cancellation. It stops new contributions while keeping the goal active in the pot ledger so saved claims stay protected. Resume restores the contribution. Existing terminal-status guards remain intact.
- Save, Pause and Delete never move bank money or cancel standing orders. Unknown affordability stays unknown; Upcoming remains the place to check whether a set-aside fits.

## Verification

Production regression coverage replaces the preview-only fixture tests. It covers baseline preservation, pause/resume and terminal guards, category scope/refunds/deduplication/rival claims, saved-versus-draft evidence, optional receiving-account validation and the final-review boundary.

The optional browser harness mounts the actual production components with synthetic operations on a temporary local auth-exempt route. That route is removed before commit. Its screenshots verify those real components under fixture data, not authenticated customer pages or physical software keyboards.

The production-mode confirmation passed 18 browser checks with no page exceptions: 320px, 390px and desktop View plan layouts in both themes; same-frame browser Back; both complete create journeys; failed-save retry retaining the draft; an invalid payment choice blocked before review; and a separate Review then Save tap. Root inspected the captures at original detail under /tmp/g291-production-qa. The production build, targeted lint, 13 production render contracts, source/ownership regressions and independent final source audit passed. Session finish runs the complete backend and frontend gate before the branch is offered to the coordinator.

The complete plans-simple preview and design-index entry are retired in this fold-in under H113. Historical preview screenshots remain scratch evidence only; they are not evidence of the production implementation. Final checks and coordinator delivery status are recorded on the G291 board item.
