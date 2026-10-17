# B51: removing the Connect plan from production

Status: proposal for Kevin's approval. Nothing here changes TERMS.md, the
pricing docs or the legal PDFs; those need his sign-off first.

## What the code now does

- `CONNECT_TIER_ENABLED` (backend, default OFF). Production leaves it unset.
  UAT sets `CONNECT_TIER_ENABLED=true` in `backend/.env`.
- Off: `GET /subscription` omits Connect from `available_tiers`,
  `prices_gbp`, `billing_prices_gbp` and `billing_periods`, so the plan
  picker, onboarding and Settings render four plans. `POST /billing/checkout`
  refuses a Connect target with a 400 and the static reason "The Connect plan
  is not available." even when Connect price ids are configured. A Connect
  Stripe subscription event for a user who has no Connect plan is recorded
  and logged, never granted, never an error. `BILLING_ENABLED` no longer needs
  Connect price ids, so production can go live with no Connect Stripe price.
- Penny's connector explainer and the MCP "not included" error name only Max
  while the flag is off.
- Existing Connect subscribers are untouched in both policies: they keep
  their entitlements while active and still see Connect as their current plan.
- No App Store or Play product for Connect: C21 builds four tiers only
  (Statements, Lite, Standard, Max). The Connect rows (7 to 9) in
  `docs/pricing/store-billing-c13.md` section 3 should be treated as
  withdrawn.

## Decision for Kevin: existing Connect subscribers

`CONNECT_SUBSCRIBER_POLICY` (default `keep_until_renewal`):

1. `keep_until_renewal`: nothing changes. They stay on Connect at 12.99 a
   month until they cancel or lapse, and cannot buy Connect again afterwards.
2. `move_to_max`: they are moved to Max (16.99) at the price they pay now.
   Only the dry run exists today
   (`backend/scripts/count_connect_subscribers.py --dry-run-move`, counts
   only, writes nothing). Nothing in the API or webhook moves anyone until
   this is chosen and the move is built and reviewed.

## Proposed wording (for approval, not applied)

Pricing doc (`tiering-unit-economics-mcp-2026-09.md`, tier table): mark the
Connect row "Not offered. Existing subscribers only, until renewal."

TERMS.md: it does not list Connect as a plan. The one related line is the
connector sentence ("You may connect your own AI assistant, such as Claude
or ChatGPT, to read your Sorted data through our connector."). Production
ships with the connector off (A17/A18), so no change is needed now. When the
connector goes live, proposed addition: "The connector is available on
selected plans." Regenerating `TERMS.pdf` follows only after approval.

Release: `scripts/release.py check` now reports `connect_tier_flag`, green
when `CONNECT_TIER_ENABLED` is absent from both Railway services, red if set.
