# Card repayment-plan figures (G492)

A card plan has three different quantities: its scheduled payment, payments
seen on the card, and the unpaid amount still reserved in its nominated paying
account. They are not interchangeable.

## The reported future-start case

On 23 November 2026, a last-Friday pay period runs from 30 October to
26 November. A plan beginning on 27 November has £0 due in the current period.
That does not make its recurring payment £0.

The regression fixtures reproduce both reported examples:

| Scheduled payment | First payment | Offer end | Future schedule before expiry | Recorded balance | Projected remainder |
| --- | --- | --- | --- | --- | --- |
| £30.71 | 27 Nov 2026 | 31 May 2027 | £214.97 | £3,024 | £2,809.03 |
| £62.70 | 27 Nov 2026 | 31 Aug 2027 | £627 | £7,402 | £6,775 |

`this_period_planned` retains the current-period fact. The caption reads
`display_period_planned`, `schedule_state` and `starts_on`, preserves pence,
and names the future start. A paused plan has no planned contribution or
reservation, while its observed historical repayments remain available.

## One payment schedule

`card_repayment_plans.remaining_plan_events` is shared by the offer comparison
and debt forecast. Current-period payments consume that period's events in
order. An unpaid nominal date before today remains due in the current period
and is projected from today. Older pay periods do not roll over.

Current reserve replacement continues to use `active_card_plans`.
`forecast_card_plans` also includes future plans: the normal dated payment is
retained before the first plan pay period, then the plan takes over. Whole
months before a distant start retain the previous usual-payment forecast.
The transition month uses dated bill occurrences, avoiding a whole old month
being added on top of the new plan. There is no usual-payment fallback after
the plan's schedule runs out, preserving G475's existing forecast contract.

## Matched repayments and source reservations

The paying debit counts once. Explicit reconciled card identity outranks a
shared bank narrative, and a link to another card cannot fulfil this plan.
Dates are London calendar days, including BST boundaries and the full final
microsecond of a day. G465's plan-start boundary applies to all public paid
figures. Pre-start payments can reconcile a dated starting balance but never
become payments made towards the plan.

`paid_this_period` and `paid_since_start` include explicit card-linked debits
from all owned source accounts. A nominated-source text rule is applied only
to that source. Its ambiguous historical overlap with another saved plan
withholds cumulative offer progress.

`paid_from_source_this_period` and `reserved_from_source_this_period` retain
the nominated account's own fulfilment/reservation. Their current values come
from the same `_pot_progress_and_slice` reader used by Available and Upcoming.
A voluntary payment from another account is real card history, but is not
mislabelled as money that left the nominated source.

## Offer progress evidence

The bar represents an **inferred single-offer repayment target**, not an
issuer-provided allocation ledger. Its prerequisites are:

- Confirmed terms, one recorded 0% offer and a known GBP balance.
- Dated starting evidence or a valid retained positive starting target.
- No same-day ambiguity between a day-only statement balance and a payment.
- Exact penny reconciliation between the starting target minus matched card
  repayments and the bank's signed balance, using the shared balance-field
  precedence.
- No other unreconciled card activity that could invalidate that inference.

Multiple offers, nonzero or unknown rates, missing balances, ambiguous
payments, refunds/adjustments that break reconciliation, and unsupported
currencies do not receive invented percentages or an on-track claim.

A future dated balance may support a `not_started` view. Its target is
provisional and recalculated on each input change; it is never sealed as a
future starting balance. An undated future offer may still support an
explicitly hedged schedule comparison against its recorded balance, but
progress stays unavailable.

The expected marker follows the clearing target over calendar days from plan
start to the exact expiry. It does not follow an inadequate payment schedule
and therefore cannot make that schedule appear on track. Payment slots must
fall strictly before expiry, matching G471. The backend stores the marker,
percentages, future scheduled amount and residual. The browser formats them.

## Stored read boundary

`card_plan_progress.compute_progress` runs on the change/worker path.
`card_plan_store.read` performs stored reads only and never calls it.

One `card_plan_progress` document per user contains the payload, retained
baselines, result shape, input version, London day and UTC build stamp.
Writes are fenced by input version, London day and build-start sequence so a
slower or older success/error cannot replace a later result. Missing, stale,
invalid or failed records expose readiness with no numerical facts. Queueing
on a read has a 200ms deadline.

Existing successful input invalidations enqueue the worker warm. The progress
step runs after the warm's initial version bump and before other responses.
Dedicated worker jobs also refresh on missing/stale reads. London rollover
and worker startup enqueue every user with an active card plan or an existing
snapshot, including users outside the recent-activity warm window.

Pending/unavailable card facts are not held in the six-hour commitments
response cache. Old pre-G492 cached facts are rejected. The new collection is
in the account-erasure manifest. No source plan, goal, offer or transaction is
rewritten by this calculation.

## Daily Challenge provenance

The two reported totals correspond to different schedule inputs. A 65-day
schedule beginning on 13 November at £12.12, rising 4p per day, totals £871
and ends on 16 January; its first five payments total £61. G357 records an
earlier confirmed £812.80 schedule ending on 31 December. The regression
keeps those inputs distinct. Correcting a saved schedule remains an explicit
user edit; a read does not silently substitute one for the other.

## Verification

`test_g492_card_plan_figures.py` covers the reported figures, real debt-engine
future adoption, unpaid events, source/card identity, London boundaries,
cross-account payments, paused plans and missing/ambiguous offer evidence.
`test_g492_card_plan_store.py` covers stored-only reads, malformed metadata,
queue deadlines, version/day/build races, and worker rollover/startup paths.
G465/G475/G476 and warmup/cache checks remain part of the delivery gate.
