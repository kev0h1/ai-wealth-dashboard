# G302 Mirror card reading edge design round

Two proposals refine the existing Mirror cards without changing G286's choice, aim or completed-feedback behaviour. Both remove the empty icon column, put evidence inside the card and explain coaching once beside Other patterns. Production components and saved choices are unchanged during this round.

## The choice

- **A Quiet link** keeps View evidence as a small, inset action below the choices.
- **B Evidence row** gives View evidence a full-width, 44px tappable row, separated by a hairline. It is easier to find without making evidence the primary action.

Both use a 16px reading edge for titles, narratives, observations and controls. Eating Out has a transparent 16px trailing glyph rather than a tile. Existing keep-specific confirmation and live feedback remain visible; only the repeated idle coaching explanation is replaced by one shared explanation.

The preview opens Other patterns initially so the differences are visible together. This is a review convenience, not a proposed change to the production collapsed default.

## Preview and production boundary

`/design/mirror-reading-edge` renders the actual `MirrorFeedbackCard`, `MirrorNextStep`, `AimSheet` and `MirrorEvidence` with synthetic props and local callbacks. A preview-only wrapper and CSS adapter demonstrate the proposed card boundary and spacing. They do not alter the shared components or their defaults.

Choosing change does not open the editor automatically. Evidence selection promotes and focuses the primary trait, preserving G286. The editor receives a baseline and local submit callback; evidence has no checkpoint ID, and payment-record loading is intercepted. Local edits recalculate pace against the new target without changing recorded spending. Current and completed checks remain separate from portrait observations.

## Copy and data contracts for the later fold in

The six stable trait IDs, kinds and Eating Out category reference are retained. Display copy uses Regular saving, Moving money between accounts, Eating out is a regular spend, Returned payments or late fees, More spending in the first week and More card spending after week one. The payment-description match is not presented as proof of a missed payment.

Use a display mapping rather than blindly rewriting API strings: companion code still parses some legacy evidence and the signature category title fallback. Preserve that contract or update its consumers and tests explicitly. No detector thresholds change in this design round.

The Eating Out example's 154 payments over 179 days is about 26 times a month on a 30-day normalisation. The transfer figure is monthly absolute transfer volume, not net spending, savings or a balance. Early-month spending remains a share of monthly spending; card-share comparisons retain both time windows. Saving deposits do not imply net savings after withdrawals. Counts use proper singular or plural wording, not fee(s).

## Verification

The final browser run passed 35 layout and contrast checks at 320, 390, 768 and 1280px. Both variants were checked at 390px in light and dark themes. The scenarios cover current and completed aims, kept traits, hidden figures, loading and failures, long text, one trait, no payment-description matches, empty results and insufficient history. The interaction checks cover keep, change, local aim creation, stop confirmation, completed-pace continuation, failure retry, evidence focus and keyboard activation. No customer API requests, browser exceptions or customer-preference writes occurred. The harness permits the app shell's session scroll-position keys.

Original-detail preview captures were inspected in `/tmp/g302-review-confirm`. These are browser previews, not authenticated product or native-device evidence. The preview contract tests, unchanged G286 regression gate, scoped ESLint, TypeScript and design index and stale checks passed before delivery. The independent source review returned Ship. Impeccable's launcher and detector were unavailable on this host; manual guideline review, browser measurements and an independent reviewer supplied the substitute, not a claimed detector pass.

## Delivery and approval

The round uses Impeccable in Operate mode, preserving Sorted's Calm Cockpit identity and the G292/G295 card anatomy. Web Interface Guidelines are the final accessibility check. The branch is handed over through `scripts/session.sh finish G302 --uat-review`; the coordinator publishes the preview before Kevin chooses A or B.

After that choice, start a fresh fold-in session, implement the selected anatomy in the production components and audit the diff independently. Delete this round's preview directory and index entry in that same session, subject to the repository's shared-reference checks. Do not retain a preview as proof of the shipped component.
