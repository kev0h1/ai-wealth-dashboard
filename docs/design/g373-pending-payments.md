# G373: pending payments and bank posting dates

## Direction

Extend the familiar transaction lists on Home, Transactions and account pages.
Keep merchant identity, signed amounts and the existing row spacing. Pending is
a neutral bank status, not a financial warning. No new hero, warning banner or
money total is needed.

Design skill: impeccable. The context launcher was unavailable, so PRODUCT.md
and DESIGN.md were read directly. This is an Operate surface in the existing
Calm Cockpit system.

## Review round

`/design/pending-payments` contains two synthetic, local-only proposals:

- **A: In the list.** Pending leads the existing list, followed by dated booked
  activity. Recommended for the smallest change to the familiar layout.
- **B: Separate group.** A compact pending group sits immediately above booked
  activity. A count distinguishes it without adding a provisional total.

Both cover Home, Transactions and account contexts, masking, light/dark themes,
long names, currencies, loading, retry, empty and pending-only states. A local
handover control demonstrates a pending row becoming booked exactly once.

The examples use Saturday 31 October 2026. A payment carrying the bank posting
date Monday 2 November is shown with the activity seen on Saturday and the
short explanation **Posts Mon 2 Nov**. The original bank date is retained.
The prototype is evidence for the proposals only, not the shipped lists.

## Data boundaries

Pending rows stay in their own collection and their own response field. They
must not join booked pagination totals, chart inputs, category totals or edit
flows. Provider pending snapshots remain authoritative; matching amounts alone
are not proof that two transactions are the same payment.

The paginated list endpoints expose provisional rows separately. Activity-date
ordering is opt-in until the selected frontend is implemented, preserving
existing consumers during this review round. The bank date is never rewritten
to make a list look right. Activity dates use first-seen evidence where present;
legacy rows without that evidence cannot establish an exact first-seen time.

## Fold-in acceptance criteria

1. Use the approved grouping on all three production surfaces.
2. Display pending merchant, signed amount and Pending status without exposing
   booked-only editing actions.
3. Apply account, text, date and direction filters consistently; do not present
   uncategorised pending payments as confirmed category spending.
4. Opt into activity-date ordering before pagination. Use that same date for
   the visible date groups and keep the bank-date explanation available.
5. Respect the global hide-balances readiness guard, including foreign currency
   and accessible names. Never flash amounts before preferences load.
6. Keep pending-only, failed-load and no-results states distinct. Clear stale
   results when changing accounts or filters.
7. Verify provider snapshot replacement and pending-to-booked handover, including
   two genuinely separate payments with the same merchant and amount.
8. Review production code independently, then remove this preview and its index
   entry under H113 once the approved treatment is implemented.

No real payments, balances, bank dates or preferences are changed by the preview.

## API contract for the selected implementation

Both paginated list endpoints return `pending_items`, `pending_total`,
`pending_page` and `pending_pages` on booked page 1. Pending pages are capped at
200 rows; `pending_page=2` retrieves the next set without altering booked
pagination. The count is calculated after exact-identity handover exclusion.
Category-filtered lists exclude provisional, uncategorised payments.

Pass `activity_order=true` to apply activity-date ordering and date filtering
before pagination. Keep `date` for the bank posting explanation. Pending IDs
are scoped to user, account and provider; source IDs are retained for exact
handover matching. Existing bulk transaction/chart consumers stay booked-only.

## Verification

- Targeted backend regression run: 89 passed, including provider snapshots,
  ownership isolation, stale pending, currencies, pagination, handover and
  weekend-date ordering across all three booked sources.
- Browser checks cover both proposals at 320/390px and desktop, light/dark,
  hidden amounts, retained merchant identity, handover and loading/error states.
- Independent code and screenshot review covers data boundaries, accessibility
  and DESIGN.md. Final repository gates run through `session.sh finish`.

This round prepares the backend and proposals. Production list consumers do
not yet opt into activity ordering or render pending groups; those changes
follow Kevin's design selection.
