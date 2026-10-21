# C13: store billing (iOS StoreKit + Android Google Play Billing)

Status: iOS half BUILT by C21 (2026-10-17), on branch feature-C21-ios-storekit,
awaiting independent review, a security review of the JWS verification and
Kevin's TestFlight pass (docs/pricing/store-billing-c13-testplan.md). The
Android half (Google Play Billing, section 9) was BUILT by C24 (2026-10-17) on
branch feature-C24-play-billing, awaiting independent review and a security
review of the purchase verification; Kevin's internal-track pass is
docs/pricing/store-billing-c24-testplan.md. Decisions below are
Kevin's (2026-09-12/13, TODO.md C13 and the coordinator notes on
B25/B26/B29/B31; pricing 2026-10-17, C24); this document works them into the
codebase as it stands after B25, B27, B33 and B36 (2026-09-13). Section
"What C21 built" at the end of each numbered section says what exists and
where. Currency: GBP throughout.

## 0. The decisions (already made, not reopened here)

- **iOS**: sells through StoreKit in-app purchase, 15% under the Small
  Business Program. Apple's external-link allowance (guideline 3.1.3(b))
  is US-storefront only, and Sorted fits neither of the exceptions that
  would let a non-US build point at Stripe instead: it is not a reader
  app (3.1.3(a), which covers apps for already-purchased content like
  magazines or music, not a finance tool), and the multiplatform
  exception (3.1.3(e)) requires the same subscription to also be sold as
  an IAP, which is the thing being built here, not an alternative to it.
  This guideline-subsection reasoning is this document's own analysis,
  not independently confirmed against Apple's current guidelines text in
  this session (see section 10) — the decision to use StoreKit itself is
  Kevin's, already made, and is not reopened by that caveat; only this
  document's supporting reasoning about which subsections apply is
  unconfirmed. So UK iOS must use IAP.
- **Android**: sells through Google Play Billing (Kevin, 2026-10-17, C24,
  replacing the earlier decision to enrol in Play's billing-choice programme
  and link out to Stripe). Subscriptions and Penny packs are bought in the
  Play purchase sheet, verified server-side with the Google Play Developer
  API, and written through the same provider-neutral seam as StoreKit. Section 9
  is the design as built.
- **Web**: unchanged. Stripe, already live in test mode (B25).
- **Tooling**: direct integration (App Store Server API + App Store
  Server Notifications V2), not RevenueCat. Only one store is being
  integrated; the server already owns entitlement truth via
  `subscriptions_col` and `grant_pack`; RevenueCat would add a second
  source of that truth plus roughly 1% of revenue for no benefit this
  codebase doesn't already have. RevenueCat is recorded here as the named
  fallback if JWS verification proves too painful to get right in-house.

## 1. The existing seam (B5)

Two things B5 deliberately built generically enough to reuse for a second
payment provider:

- `app.core.subscription.grant_pack(email, kind, pack_id, *, source="purchase")`
  (`backend/app/core/subscription.py:608`) — inserts one top-up pack doc
  for Penny message packs (`kind="penny"`, `penny_topups_col`) or MCP call
  packs (`kind="mcp"`, `mcp_call_packs_col`). It doesn't know or care who
  called it; Stripe's `checkout.session.completed` handler
  (`_handle_checkout_completed` in `backend/app/services/billing.py`)
  is one caller, POST `/subscription/admin/topup` (`source="admin"`) is
  the other. An Apple consumable purchase becomes a third caller with
  the same signature.
- `subscriptions_col`, written today only by
  `app.services.billing._handle_subscription_upsert`
  (`backend/app/services/billing.py:483`), one document per user:

  ```
  {
    user_id, tier, status, stripe_subscription_id, billing_period,
    expires_at, trial_ends_at, cancel_at_period_end, updated_at,
    source: "stripe",
  }
  ```

  Read back by `app.core.subscription.get_subscription(email)`
  (`backend/app/core/subscription.py:258`, whose body was written by
  `_handle_subscription_upsert` at `backend/app/services/billing.py:484`),
  which does a single `subscriptions_col.find_one({"user_id": email})`.

## 2. The schema problem (the core of this item)

`get_subscription` assumes one subscription document per user, with no
provider dimension. A user can legitimately hold a Stripe web
subscription (started before ever installing the app) and an App Store
subscription (started later on iOS) at the same time — nothing today
stops that, and nothing today can represent it: the second
`subscriptions_col.update_one({"user_id": email}, {"$set": ...}, upsert=True)`
that runs would silently overwrite the first provider's document.

### 2.1 Schema change

Add two fields to `subscriptions_col` and split the id field by provider:

```
{
  user_id,
  provider: "stripe" | "apple",
  tier, status, billing_period, expires_at, trial_ends_at,
  cancel_at_period_end, updated_at,
  provider_subscription_id,   # was stripe_subscription_id
  source: "stripe" | "apple",
}
```

`provider_subscription_id` replaces `stripe_subscription_id` as the
canonical field name; `stripe_subscription_id` stays as a read-compatible
alias on existing Stripe documents rather than being renamed in place (see
migration below), the same "don't break an existing reader" caution this
codebase already takes with `PENNY_TOPUP` in `subscription.py` (kept
"for one release so any code/tests still reading the single-pack shape
keep working").

Index: `_ensure_index` currently gives `subscriptions_col` a **unique**
index on `user_id` alone (`backend/app/main.py:340`,
`await _ensure_index(subscriptions_col, "user_id", unique=True)`). That
line has to change to a **compound unique index on `(user_id, provider)`**
before a second document per user can exist at all — left as-is, Mongo
will reject the second provider's upsert with a duplicate-key error the
moment Apple's webhook tries to write a Stripe user's second document.

### 2.2 Migration

Every existing `subscriptions_col` document was written by Stripe code and
has no `provider` field. A migration script sets `provider: "stripe"` and
copies `stripe_subscription_id` into `provider_subscription_id` on every
document missing `provider`, then the new unique index is created (an
index create on a collection with duplicate `(user_id, provider)` pairs
would fail outright, but there can't be any yet — one document per
`user_id` exists today by construction of the current unique index). This
is an additive, backwards-compatible migration: it runs once, before
`_create_indexes` swaps the index definition, and every existing reader
of `stripe_subscription_id` keeps working because that field is kept, not
dropped.

### 2.3 Precedence rule

**Highest active tier wins**, and **the server refuses to start an
in-app purchase while an active Stripe subscription exists**, so nobody
pays twice for the same entitlement:

- `get_subscription(email)` changes from `find_one` to reading every
  document for that `user_id` (at most two: one per provider), filtering
  to those not expired/not status `"expired"`, and returning the
  `Subscription` built from whichever remaining document has the higher
  `Tier`. A tie (same tier from both providers, which the precondition
  below should make rare but not impossible mid-migration) breaks toward
  whichever has the later `expires_at`, then arbitrarily but
  deterministically toward `"stripe"` (existing, presumably
  longer-standing) over `"apple"`.
- The existing Stripe-side guard,
  `billing._validate_subscription_checkout` (`backend/app/services/billing.py:208`),
  already refuses a new Stripe subscription while one
  is active — its docstring's reasoning ("Active Stripe subscriptions are
  changed or cancelled through Stripe's customer portal") extends
  directly: a new function on the Apple side (`_validate_apple_purchase`
  or similar, in the new `apple_billing.py` service module, section 5)
  must run the mirror-image check before StoreKit purchase verification
  is allowed to grant anything — read `subscriptions_col` for
  `{"user_id": email, "provider": "stripe"}`, and if it's active,
  trialing or past_due, reject with a clear reason
  ("Manage your existing subscription in Settings, Your plan" or
  similar) rather than granting a second, redundant entitlement. Since
  Apple purchases are consumed client-side first (StoreKit shows the
  system purchase sheet before the app ever hears about it), this
  can't stop the App Store transaction itself the way `/billing/checkout`
  stops a Stripe session before money moves — so the practical
  enforcement point is **before** the client starts the purchase, in the
  same purchasingAllowed gate described in section 6: a native iOS
  client that GET `/billing/status` and sees an active Stripe-sourced
  subscription should show "manage in Settings" rather than a StoreKit
  buy button at all. If a StoreKit purchase completes anyway (e.g. a
  stale client state), the receiver should still grant it — Apple's
  proceeds have already been taken, refusing to grant would just cost
  the user the tier they paid for — and log/flag the double-subscription
  for a human to resolve (a refund is initiated through Apple, not this
  codebase).

### 2.4 Functions that change

- `app.core.subscription.get_subscription` — query and precedence logic
  as above.
- `app.main._create_indexes` (`backend/app/main.py:340`) — unique index
  becomes `(user_id, provider)`.
- `app.services.billing._handle_subscription_upsert`,
  `_handle_subscription_deleted`, `_handle_payment_failed` — each of
  these `subscriptions_col.update_one({"user_id": uid}, ...)` calls must
  add `"provider": "stripe"` to both the filter and the `$set`, so a
  Stripe event can never accidentally match or overwrite an Apple
  document for the same user.
- `app.services.billing._validate_subscription_checkout` — filter becomes
  `{"user_id": uid, "provider": "stripe"}`.
- `app/routers/billing.py`'s `billing_status` endpoint — reads
  `subscriptions_col.find_one({"user_id": ...})` today; needs either to
  become provider-aware (return both, or the one `get_subscription`
  picked) so the frontend can distinguish "you have a Stripe subscription"
  from "you have an Apple subscription" for the manage/cancel copy in
  section 6.
- New, on the Apple side: `_handle_apple_subscription_upsert`,
  `_handle_apple_subscription_deleted`-equivalent, mirroring the Stripe
  handlers but keyed on `{"user_id": uid, "provider": "apple"}`.

### What C21 built (section 2)

- **Shared seam**, provider-neutral so the Google item reuses it: the
  `provider` field takes `stripe | apple | google`
  (`app.core.subscription.SUBSCRIPTION_PROVIDERS`); the precedence rule is
  `pick_subscription_doc` / `get_subscription_doc` / `get_subscription` in
  `backend/app/core/subscription.py` (highest live tier wins; a tie breaks to
  the later `expires_at`, then Stripe over Apple over Google; nothing live
  lands a store-backed user on Statements, never the pre-launch default);
  `backend/app/services/store_subscriptions.py` is the only writer of store
  subscription documents, the event ledger claim (`claim_event`, keyed
  `"<provider>:<id>"` so ids cannot collide) and consumable grants. Commits
  `1300922c` (schema, precedence, migration) and `328c1308` (seam,
  catalogue, config).
- `app.main._ensure_subscriptions_provider_index` creates the compound
  unique index on `(user_id, provider)` first, then drops the old unique
  `user_id_1`. It is safe before the migration has run (a missing provider
  indexes as null, one document per user, as before).
- Every Stripe handler and `_validate_subscription_checkout` filters on
  `{"provider": {"$in": ["stripe", None]}}` and writes `provider: "stripe"`
  plus `provider_subscription_id`, so a Stripe event can never read or
  overwrite an Apple or Google document. `/subscription/select-free` and the
  admin set-tier route use the same Stripe slot; select-free refuses while a
  store subscription is live.
- `GET /billing/status` and `GET /subscription` report the document in force
  and a new `billing_provider` field.
- Migration: `backend/scripts/migrate_subscriptions_provider.py`, dry-run by
  default, `--apply` writes, idempotent, counts only. Not required for
  correctness; it normalises old documents.
- The daily trial reminder skips Apple trials (its copy quotes the web price
- Design note (section 2.4): the server does NOT refuse Stripe checkout while
  an Apple subscription is live. The guard is one-way by design: the
  `purchase_allowed` check stops the StoreKit buy button when Stripe is live,
  and a Stripe checkout from the web while Apple is live is allowed (the
  precedence rule then picks the higher tier). Only the native iOS app is
  barred from Stripe (B31).
- Security review fixes: pack grants are insert-first behind a unique
  partial index on `(provider, store_transaction_id)` in both pack
  collections; restore never replaces a live subscription with an older or
  lapsed one (different `originalTransactionId` included); the receiver
  checks `Content-Length` before reading the body.
  and "Settings, Your plan"; Apple sends its own notice).

## 3. Product catalogue

Nine auto-renewable subscriptions (three paid tiers × three durations,
`monthly`, `six_months`, `annual`, matching
`app.core.subscription.SUBSCRIPTION_PERIODS_ENABLED` after B27 dropped
`three_months`) in **one subscription group**, ranked by tier so Apple
handles upgrade proration and defers downgrades itself, plus three
consumables mapping to `PENNY_TOPUP_PACKS`. Twelve products in all.

Four tiers exist (Statements, Lite, Standard, Plus); Statements is free and
never sold. There is **no Connect product** (B51 hides the tier) and **no
MCP call pack** in the stores. An earlier draft of this section listed
sixteen products including Connect and `mcp_1000`; both are out.

Every subscription carries a **2-week free introductory offer** (Kevin,
2026-10-05, C21). It is configured on each subscription in App Store Connect;
the app never writes the trial length, it describes whatever offer the store
reports for the signed-in Apple ID (and promises nothing when the store says
the user is not eligible).

Bundle id (`capacitor-spike/capacitor.config.json`): `co.uk.auriqltd.sorted`.

Product ids follow a deterministic scheme, implemented in
`backend/app/core/store_catalogue.py` (shared with Google, C24):

- subscriptions: `sorted.<tier>.<period>`
- one-time packs: `sorted.penny.<n>`, `n` being the number of messages

Subscription group: one group, ranked highest first (Plus above Standard
above Lite), so moving to a higher tier is an Apple-handled upgrade
(immediate, prorated credit for the unused portion of the current period)
and moving to a lower tier is an Apple-handled downgrade (deferred to the
next renewal, no credit), exactly the behaviour Stripe's subscription-item
swap gives today, done by Apple instead. **Not independently confirmed**
(see section 10): how Apple's ranking model treats a *same-tier,
different-duration* change (for example Lite monthly to Lite annual), whether
a crossgrade, an upgrade, or requiring the durations to be modelled as
separate ranks, needs verifying against Apple's own Subscriptions
documentation or a sandbox test before the group is built in App Store
Connect. The default proposed, absent that confirmation, is to rank all
three durations of a tier adjacently with the longer commitment ranked above
the shorter one within that tier (annual above six-monthly above monthly),
so that moving to a longer commitment at the same or higher tier is never
treated as a downgrade.

Prices are read from `TIER_BILLING_PRICES_GBP`
(`backend/app/core/subscription.py`) and `PENNY_TOPUP_PACKS`, not retyped
here by hand. **Store prices match web exactly** (section 3.1).

| # | Product id | Type | Tier | Period | GBP price (store = web, incl. VAT) |
|---|---|---|---|---|---|
| 1 | `sorted.lite.monthly` | Auto-renewable, 2-week free intro offer | Lite | Monthly | £5.99 |
| 2 | `sorted.lite.six_months` | Auto-renewable, 2-week free intro offer | Lite | Every 6 months | £31.99 |
| 3 | `sorted.lite.annual` | Auto-renewable, 2-week free intro offer | Lite | Yearly | £59.99 |
| 4 | `sorted.standard.monthly` | Auto-renewable, 2-week free intro offer | Standard | Monthly | £9.99 |
| 5 | `sorted.standard.six_months` | Auto-renewable, 2-week free intro offer | Standard | Every 6 months | £53.99 |
| 6 | `sorted.standard.annual` | Auto-renewable, 2-week free intro offer | Standard | Yearly | £99.99 |
| 7 | `sorted.plus.monthly` | Auto-renewable, 2-week free intro offer | Plus | Monthly | £12.99 |
| 8 | `sorted.plus.six_months` | Auto-renewable, 2-week free intro offer | Plus | Every 6 months | £69.99 |
| 9 | `sorted.plus.annual` | Auto-renewable, 2-week free intro offer | Plus | Yearly | £129.99 |
| 10 | `sorted.penny.20` | Consumable | Penny top-up (small) | 20 messages | £0.99 |
| 11 | `sorted.penny.100` | Consumable | Penny top-up (medium, "Most popular") | 100 messages | £2.99 |
| 12 | `sorted.penny.200` | Consumable | Penny top-up (large, "Best value") | 200 messages | £4.99 |

Statements (free tier) never checks out, matching `_price_id_for`'s existing
`target == "statements"` exclusion for Stripe.

Config: the ids above are the defaults. `APPLE_PRODUCT_IDS` (env, comma
separated `key=product_id`, the same key vocabulary as `STRIPE_PRICE_IDS`:
`lite`, `lite_six_months`, `lite_annual`, ..., `penny_small`, `penny_medium`,
`penny_large`) overrides individual entries if a product was created under a
different id. `APPLE_IAP_ENABLED` is an explicit switch, default off.

### 3.1 iOS pricing (decided)

**Decided: store prices match web exactly, no iOS uplift** (Kevin, 2026-10-17,
board item C24). `TIER_BILLING_PRICES_GBP` and `PENNY_TOPUP_PACKS` are the
single source for both channels, so no iOS price table lives anywhere in the
code. The earlier proposal of roughly +18% (and the full-recovery figure of
+37%) is withdrawn.

What the decision costs, for the record. Apple's 15% Small Business Program
commission comes off VAT-exclusive revenue, so the iOS net is lower than the
web net at the same price: at Plus monthly £12.99, about £9.20 on iOS against
about £12.60 on web (Stripe's 1.5% + 20p; VAT assumed 20% once registered,
unregistered today, to be confirmed with the accountant). Kevin accepted that
in exchange for a single public price across channels and the better
conversion of in-app purchase.

Still open on this subject, and technical rather than a decision: every price
above must exist on Apple's fixed price-point grid when the products are
created in App Store Connect. `WebFetch` against `developer.apple.com` failed
when this document was written (section 10), so none has been checked against
the live grid. If one is missing, say so to Kevin before choosing a neighbour;
do not pick one silently.

The client never shows these numbers. It shows the store's own price string
for the signed-in storefront, which Apple requires and which cannot drift from
what is charged.

### 3.2 B53 update (2026-10-18): Plus replaces Connect and Max

Kevin's B53 decision changes the catalogue above: the paid tiers are Lite, Standard and **Plus**; Connect and Max are retired. Nine auto-renewable subscriptions (three tiers by three periods) plus three Penny packs replace the sixteen products in the table above. There is no Connect product and no MCP pack in the stores.

Product ids follow the scheme C21 and C24 implemented in `backend/app/core/store_catalogue.py` (`sorted.<tier>.<period>` and `sorted.penny.<n>`), which supersedes the longer `co.uk.auriqltd.sorted.sub...` namespace used earlier in this section, so the spec and the code agree. Kevin decided on 2026-10-17 (C24) that store prices match web exactly, with no uplift, so the iOS and Play prices equal `TIER_BILLING_PRICES_GBP`, and the uplift proposal in 3.1 is superseded for every tier.

| Product id | Tier | Period | Store price (same as web) |
|---|---|---|---|
| `sorted.lite.monthly` | Lite | Monthly | £5.99 |
| `sorted.lite.six_months` | Lite | Every 6 months | £31.99 |
| `sorted.lite.annual` | Lite | Yearly | £59.99 |
| `sorted.standard.monthly` | Standard | Monthly | £9.99 |
| `sorted.standard.six_months` | Standard | Every 6 months | £53.99 |
| `sorted.standard.annual` | Standard | Yearly | £99.99 |
| `sorted.plus.monthly` | Plus | Monthly | £12.99 |
| `sorted.plus.six_months` | Plus | Every 6 months | £69.99 |
| `sorted.plus.annual` | Plus | Yearly | £129.99 |
| `sorted.penny.20`, `sorted.penny.100`, `sorted.penny.200` | Penny packs | 20, 100, 200 messages | £0.99, £2.99, £4.99 |

Subscription group ranking becomes Plus above Standard above Lite. Config keys for both providers are `plus`, `plus_six_months` and `plus_annual` in place of the `connect*` and `max*` keys; the shared required-key vocabulary for Stripe is now 13 keys (`app.core.config._STRIPE_REQUIRED_PRICE_KEYS`). Server limits: Lite 10 accounts and 40 Penny, Standard 25 and 150, Plus unlimited and 300, every paid tier with every feature. Existing Stripe subscriptions on the retired Max and Connect prices keep working: the webhook reads those legacy price ids only to resolve them to Plus.

C21 has renamed `max` to `plus` in `STORE_PAID_TIERS` and the catalogue (product ids `sorted.plus.<period>`). A transaction that carried a legacy `sorted.max.<period>` id resolves to the Plus product via the same legacy map (never offered to the client).

## 4. `appAccountToken`

An Apple transaction belongs to an Apple ID, not to this app's account —
without an explicit link at purchase time, a receipt arrives
unattributable, and StoreKit gives no way to retrofit that link
afterwards (there is no "look up this Apple ID's purchases by email"
API; Apple deliberately doesn't expose that).

`Product.PurchaseOption.appAccountToken(_:)` is a client-supplied UUID
attached to the purchase request; it's echoed back on the resulting
`Transaction` and inside the App Store Server Notification/API payloads
for that transaction, so the webhook receiver can resolve
token → `user_id` without ever seeing an Apple ID or email.

Proposed storage, mirroring `billing_customers_col`'s existing
`{user_id, stripe_customer_id}` mapping shape
(`backend/app/db/collections.py:110`): a new collection,
`apple_account_tokens_col`, `{user_id, app_account_token, created_at}`,
unique index on both `user_id` and `app_account_token`. The token is
generated **once per user**, lazily on first use (mirroring
`_get_or_create_customer`'s lazy-create pattern in `billing.py`) —
Apple's own guidance is to reuse the same token for every purchase by a
given user rather than minting one per transaction, so every future
purchase and every renewal notification for that user resolves through
the same value. A new endpoint, something like
`GET /billing/apple/account-token`, returns (creating if absent) the
current user's token for the client to pass into every
`Product.purchase(options:)` call.

### What C21 built (section 4)

`apple_account_tokens_col` (`{user_id, app_account_token, created_at}`, both
unique, in `ERASURE_MANIFEST`), minted lazily by
`apple_billing.get_or_create_account_token` as a random `uuid4`, never derived
from the email. `GET /billing/apple/account-token` returns the token, the
store product ids (`products`, key to id, from the catalogue and
`APPLE_PRODUCT_IDS`), `trial_days`, and `purchase_allowed` (false with
`blocked_reason: "stripe_subscription_active"` while an active Stripe
subscription exists, which is the section 2.3 gate before the buy button).
While `APPLE_IAP_ENABLED` is off nothing is minted.


## 5. The receiver

`POST /webhooks/apple` for App Store Server Notifications V2, alongside
the existing `POST /webhooks/stripe` in `backend/app/routers/billing.py`
(same file, for the same reason that route's own docstring gives —
"this whole feature ships and is reasoned about together"). Given the
amount of Apple-specific crypto and payload handling, the service logic
belongs in a new `backend/app/services/apple_billing.py` module mirroring
`billing.py`'s structure (lazy-imported crypto deps, `handle_event`
dispatch table, idempotency ledger), not inside `billing.py` itself.

Public path: `app.core.auth`'s middleware already exempts any path
starting with `/webhooks/` (`backend/app/core/auth.py:77`), so
`/webhooks/apple` is auth-exempt for free, matching the Stripe, TrueLayer
and Finexer receivers.

**Verification**: the notification body is a JWS (`signedPayload`); the
x5c certificate chain in the JWS header must be validated up to Apple's
published root CA before the payload is trusted, the same shape as
Stripe's `Webhook.construct_event` signature check but with a
certificate-chain walk instead of an HMAC. **Not independently confirmed
in this session** — see section 10 — exactly which library call this
codebase should use (Apple publishes a `app-store-server-library-python`
SDK that wraps this verification; whether to take that dependency versus
hand-rolling the x5c chain walk with `cryptography`/`pyjwt` is an
implementation choice, not specified here).

**Notification types handled**, and their effect on `subscriptions_col`
(`provider="apple"`):

| Type | Effect |
|---|---|
| `SUBSCRIBED` | Upsert active, tier/period from the product id, `expires_at` from the transaction's `expiresDate` |
| `DID_RENEW` | Same upsert, refreshed `expires_at` |
| `DID_CHANGE_RENEWAL_STATUS` | Update `cancel_at_period_end` from the renewal info's `autoRenewStatus` |
| `EXPIRED` | Status → `"expired"` |
| `DID_FAIL_TO_RENEW` | Status → `"past_due"` (Apple's own billing-retry grace period, the entitlement equivalent of Stripe's `past_due` handling in `_handle_payment_failed`) |
| `GRACE_PERIOD_EXPIRED` | Status → `"expired"` (Apple's retry window ran out with no successful payment) |
| `REFUND` | Strip entitlement — status → `"expired"` regardless of `expires_at`; see section 8 for the consumable question |
| `REVOKE` | Same as `REFUND` — immediate entitlement removal (family sharing revocation or similar) |

**Idempotency**: `billing_events_col` already exists for exactly this
(`{event_id, type, received_at, processed_at, result}`,
`backend/app/db/collections.py:110`). One refinement found while writing
this section: the task brief for this item says to key idempotency on
"Apple's transactionId", mirroring Stripe's `event.id`. On checking the
ASSN v2 payload shape, the closer analogue to Stripe's `event.id` (a
per-delivery id, not a per-business-object id) is the notification's own
top-level `notificationUUID`, not `transactionId` — a renewal creates a
*new* `transactionId` each period (linked to the original via
`originalTransactionId`), so `transactionId` identifies a purchase event,
not a delivery. Recommendation: use `notificationUUID` as the
`billing_events_col` idempotency key (add `provider: "apple"` to that
collection's documents so Stripe and Apple event ids can never collide),
and record `transactionId`/`originalTransactionId` in the stored
`result` for correlation and audit, the same way Stripe's event result
already carries the resolved `uid`/`tier`/`status`.

### What C21 built (section 5)

Files: `backend/app/services/apple_jws.py` (verification),
`apple_billing.py` (Apple mapping), `store_subscriptions.py` (seam). Routes in
`backend/app/routers/billing.py`: `POST /webhooks/apple`,
`POST /billing/apple/verify`, `GET /billing/apple/account-token`.

**Verification** uses `cryptography` and `PyJWT`, both already in the venv; no
dependency was added (Apple's `app-store-server-library-python` was not
taken, resolving that question in section 10). Per signed payload: the JWS
header must say `ES256` and carry an `x5c` chain of 2 to 4 certificates; the
chain must anchor in a certificate **pinned from files in
`backend/app/certs/apple_roots/`** (either the last certificate byte-equals a
pinned root or is directly issued by one; a root the payload merely asserts
anchors nothing); every link is signature-checked
(`verify_directly_issued_by`), inside its validity window and (for issuers)
a CA; the leaf and intermediate must carry Apple's App Store marker OIDs
`1.2.840.113635.100.6.11.1` and `1.2.840.113635.100.6.2.1`; the leaf key must
be P-256; and only then is the ES256 signature verified with the leaf key and
the payload read. The two nested JWS (`signedTransactionInfo`,
`signedRenewalInfo`) are verified the same way. Then `data.bundleId` must equal
`APPLE_BUNDLE_ID`, `data.environment` must be in
`APPLE_ALLOWED_ENVIRONMENTS` (default derived from `APP_URL`: UAT and local
accept Sandbox only, production accepts Production only; `Xcode` is never
accepted), and the transaction's own bundle id and environment must agree.
Only after all of that is the `notificationUUID` claimed in
`billing_events_col` (`apple:<uuid>`), so a forged payload cannot burn a
UUID, and a replay answers 200 with the stored result and changes nothing.

**Pinning the real root is a human step.** No Apple certificate is in the
repository (there is no network access from the build session, and a root is
not something to type from memory). Download Apple Root CA - G3 from
https://www.apple.com/certificateauthority/, check its SHA-256 against that
page, and place it in `backend/app/certs/apple_roots/`. Until then every
payload is rejected and the receiver answers 503. The tests build their own
test CA of the same shape and pin it in Apple's place.

**Status codes.** Malformed body, oversized body, missing `signedPayload`,
bad chain or signature, wrong bundle id or environment: 400 with a generic
body (`Invalid request` / `Invalid notification`), never naming the check.
Receiver switched off or no root pinned: 503. A genuine processing fault: a
bare 500 (`Error`) so Apple retries, with only the exception class name in
the log. Nothing logs an email, user id or token.

**Mapping built** (beyond the section 5 table):

| Notification | Effect |
|---|---|
| `SUBSCRIBED`, `OFFER_REDEEMED`, `DID_RENEW`, `REFUND_REVERSED`, `RENEWAL_EXTENDED`, `DID_CHANGE_RENEWAL_PREF` with subtype `UPGRADE` | upsert from the signed transaction; `trialing` while the introductory free-trial offer runs (`offerType` 1 with `offerDiscountType` `FREE_TRIAL`, or price zero on older payloads), else `active`; a revoked or lapsed transaction lands `expired` |
| `DID_CHANGE_RENEWAL_PREF` other subtypes | acknowledged, nothing changes (a downgrade takes effect at renewal, which arrives as its own `DID_RENEW`) |
| `DID_CHANGE_RENEWAL_STATUS` | `cancel_at_period_end` from the subtype (or `autoRenewStatus`) |
| `DID_FAIL_TO_RENEW` | `past_due`; access to `gracePeriodExpiresDate` for subtype `GRACE_PERIOD`, otherwise access ends at once; one push per episode naming the Apple ID |
| `EXPIRED`, `GRACE_PERIOD_EXPIRED` | `expired` |
| `REFUND`, `REVOKE` | subscription: `expired` at once whatever `expires_at` says, `refunded_at` / `revoked_at` stamped; consumable: section 8 |
| `ONE_TIME_CHARGE` | grants the Penny pack once per `transactionId` |
| `TEST` and anything else | acknowledged, nothing changes |

An event for a product not in the catalogue, or for a transaction that
resolves to no user (unknown `appAccountToken`), changes nothing and says so
in the ledger result (fail closed). Notifications are unordered, so every
state change carries Apple's `signedDate` and is ignored if older than the
newest applied to that document (`last_signed_at`); an end for a superseded
`originalTransactionId` never touches the live subscription. A store
subscription granted while a Stripe subscription is live is still granted
(Apple has the money) and flagged `double_subscription: true`.

Notifications URL to set in App Store Connect (App Information, App Store
Server Notifications, **Version 2**): production
`https://wealth.auriqltd.co.uk/api/webhooks/apple`, sandbox
`https://uat.wealth.auriqltd.co.uk/api/webhooks/apple`. (Confirm the `/api`
prefix against how each host proxies the backend, as the Stripe webhook URL is
registered.)


## 6. Client side

`capacitor-spike/` is a Capacitor 8 web wrap (bundle `co.uk.auriqltd.sorted`,
confirmed in `capacitor-spike/capacitor.config.json`) with no IAP plugin
today. `frontend/lib/nativeAuth.ts` currently exports a single gate,
`canPurchaseInApp()` (`return !Capacitor.isNativePlatform()`), built for
B26 specifically to **block every native purchase**, because at the time
neither iOS StoreKit nor Android billing-choice existed — its own comment
says so ("this app has no in-app-purchase integration on either
platform"). C13 is the inverse of that: iOS gets a real in-app purchase
path, so `canPurchaseInApp()` as a single boolean stops being
sufficient — the answer needs to distinguish three cases, not two:

| Platform | Purchase mechanism |
|---|---|
| Web | Stripe Checkout in-app (unchanged, existing `/billing/checkout` flow) |
| iOS native | StoreKit in-app purchase (new) |
| Android native | Google Play Billing in-app purchase (C24, section 9); Stripe is never reachable |

Proposed shape: replace the single boolean with something like
`purchaseChannel(): "stripe_web" | "storekit" | "stripe_external"`, and
keep `canPurchaseInApp()` (or a renamed equivalent, e.g.
`canPurchaseWithoutLeavingApp()`) as a derived boolean for call sites that
only care whether the flow stays inside the app.
`PURCHASE_UNAVAILABLE_SENTENCE` / `PURCHASE_UNAVAILABLE_LABEL` stop being
universal native-blocking copy — they still apply if a given surface
hasn't been wired for StoreKit yet (e.g. if subscriptions ship before
consumable packs do), but they must not be shown on iOS once StoreKit
purchase is live there.

Purchase UI options for iOS StoreKit, to weigh during implementation
(not decided here): (a) Apple's `StoreKit` SwiftUI views aren't reachable
from a Capacitor webview without a native bridge; realistically this
needs a Capacitor community StoreKit 2 plugin (several exist,
unverified which is best-maintained as of this session — check before
committing to one) exposing `products()`, `purchase()` and the
`Transaction.updates` listener to JS, with the actual purchase sheet
still rendered natively by iOS (StoreKit purchase UI is never custom —
Apple owns that surface regardless of plugin choice). The JS side then
looks close to today's Stripe flow: pick a plan, call a JS `purchase()`
wrapper, get back a signed transaction, POST it to a new backend
verification endpoint (which independently verifies the JWS server-side
rather than trusting the client, the same "server is the source of
truth" doctrine `billing.py`'s webhook-driven grants already follow for
Stripe).

Components B26 gated, and what changes:

- **`PlanPicker.tsx`** (`frontend/components/PlanPicker.tsx`) — `purchasingAllowed`
  (currently `canPurchaseInApp()` at line 213) becomes a three-way branch:
  web keeps the existing `/billing/checkout` call; iOS calls the new
  StoreKit purchase wrapper instead of hitting `/billing/checkout` at
  all; Android calls the Play Billing wrapper (`lib/playBilling.ts`, section
  9.4) and never Stripe (C24 replaced the earlier plan to open Stripe Checkout
  through `Browser.open` under billing-choice).
- **`MoreMessagesSheet.tsx`** and **`ConnectedAssistantsCard.tsx`**
  (Penny and MCP pack purchases) — same three-way split, for the four
  consumable products (three Penny packs, the only consumables in the stores) instead of the nine subscriptions.
- **`YourPlanCard.tsx`** — the manage/cancel surface. Today (post-B29) a
  native user with an active subscription gets plain text pointing them
  to a browser (`NATIVE_MANAGE_SUBSCRIPTION_LINE`,
  `frontend/components/PlanPicker.tsx:101`, rendered inside the sheet
  `YourPlanCard.tsx` opens), because no in-app management existed. Under
  C13 that splits by provider, not just by platform: a Stripe-sourced
  subscription (any provider `"stripe"` document, regardless of which
  platform the user is currently on) still points at the Stripe customer
  portal (browser on Android, and — this needs Kevin's copy sign-off,
  flagged rather than assumed — either a browser link or nothing at all
  on iOS, since Apple does not allow linking to an external subscription
  manager from inside the app either); an Apple-sourced subscription
  should call StoreKit's own manage-subscriptions surface
  (`AppStore.showManageSubscriptions()`, or a link to
  `https://apps.apple.com/account/subscriptions`, which Apple explicitly
  permits and expects apps to use instead of building custom
  cancellation flows) rather than being told to open a browser.

None of B26/B29's existing copy or gate should simply be deleted — the
task brief is explicit about this, and the code review in section 9
should confirm nothing here reopens the guideline-3.1.1 hole B26 closed:
neither Android nor iOS may ever reach Stripe Checkout or the portal
(`stripe_web` is the only channel that does, and the B31 backstop refuses a
native client's request regardless).

**B31** (no server-side backstop on the native purchase gate, currently
open, `TODO.md`) should be closed as part of this item rather than left
open again: once real StoreKit purchases exist, `/billing/checkout` and
`/billing/portal` genuinely must never be reachable in a way that lets a
native iOS client buy through Stripe, and the Apple verification endpoint
must independently verify the JWS rather than trust a client-asserted
platform — this is a natural side effect of building the Apple-side
verification path properly, not extra scope.

### What C21 built (section 6)

- `frontend/lib/purchaseChannel.ts` (pure) and `purchaseChannel()` /
  `usePurchaseChannel()` in `lib/nativeAuth.ts` replace the boolean with
  `stripe_web | storekit | none`; `canPurchaseInApp()` is unchanged and still
  false on every native build. `storekit` needs a real iOS binary with the
  plugin in `Capacitor.PluginHeaders`; Android and any uncertain platform get
  `none`, so Stripe is reachable from `stripe_web` only (B31: the server
  backstop on `/billing/checkout` and `/billing/portal` is untouched and
  tested).
- Plugin: `@capgo/native-purchases` 8.9.6 (StoreKit 2, Capacitor 8, peer
  `@capacitor/core >= 8`, licence MPL-2.0), pinned exactly in
  `frontend/package.json` and `capacitor-spike/package.json` with lockfile
  entries. It is imported dynamically so web bundles never load it, and the
  plugin proxy never leaves `withStoreKit()` (a registerPlugin proxy is not
  thenable).
- `frontend/lib/storekit.ts`: loads the config from
  `GET /billing/apple/account-token`, loads products by the ids in it, buys
  with `appAccountToken`, sends the `jwsRepresentation` to
  `POST /billing/apple/verify`, and only then finishes the transaction
  (`autoFinishTransactions: false`, so a dropped connection leaves it queued;
  `syncUnfinishedTransactions` re-sends it on the next picker open).
- `PlanPicker.tsx`: on the iOS channel the period buttons and disclosure use
  the store's own price strings; the free trial is described only when the
  store reports an introductory free-trial offer and says this user is
  eligible (so the length is whatever the store says, "2 weeks" today, never
  written in code); Restore purchases is offered; an Apple-sourced plan
  shows "Change or cancel it in iOS Settings, under Subscriptions" and a
  Manage button that opens the system subscription sheet, never the Stripe
  portal, on every platform. This is the B29 change. A **Stripe-sourced** plan
  on iOS still gets B29's plain-text browser pointer; whether that wording is
  acceptable on iOS is Kevin's copy call, flagged as section 6 already says.
- `YourPlanCard.tsx` and `lib/billingCopy.ts`: failed-payment and manage copy
  for an Apple plan name the Apple ID, not Stripe.
- **Not done:** the consumable packs (`MoreMessagesSheet`) and the connected
  assistants card still read "Not available in this app" on iOS. The server
  already grants consumables (`ONE_TIME_CHARGE`, `/billing/apple/verify`); only
  the buy button is unwired. Android is C24's.
- `npm run check:c21-iap` asserts no Stripe call is reachable on native and
  that no product id, price or trial length is written in client code.


## 7. Restore purchases

StoreKit has no concept of "log in" — entitlement lives with the Apple
ID, and a fresh install or a new device has no local memory of a prior
purchase. Two paths need to exist:

- **Explicit restore**: a "Restore purchases" action (StoreKit's
  `AppStore.sync()` / the transaction-restore API) re-surfaces the
  user's past transactions to the app, which then re-submits them to the
  same verification endpoint as a normal purchase. Idempotent by
  construction, since `billing_events_col`/the transaction-grant path
  already dedupes on the transaction/notification id.
- **appAccountToken continuity**: because the token is looked up per
  user (section 4) rather than minted per purchase, a restore only
  reconnects correctly if the *same* `user_id` is signed in when it
  happens — restoring on a fresh install before signing in has nothing
  to attach to yet. The natural place for a restore prompt is after
  sign-in, on Settings' subscription surface, not before.

### What C21 built (section 7)

Restore is `restorePurchases()` in `lib/storekit.ts`: StoreKit's
`restorePurchases()`, then `getPurchases` filtered to this user's
`appAccountToken` and to current entitlements, each verified by
`POST /billing/apple/verify`. The server accepts a transaction only if its
`appAccountToken` resolves to the signed-in user (or, for a token-less one, it
belongs to an Apple subscription that user already holds), else 403, so a
restore on a device signed in as someone else cannot attach another
account's purchase. Restoring an older period never moves state backwards,
and restoring twice changes nothing.


## 8. Refunds and revocation

`REFUND` and `REVOKE` (section 5) strip entitlement immediately,
regardless of `expires_at` — this mirrors the fail-closed doctrine this
codebase already applies elsewhere (Safe-to-Spend hardening clamping to
`<= 0` on any lookup failure, referenced in `CLAUDE.md`'s surface map).

**Proposed here for Kevin's sign-off, not a decision he has recorded: no
clawback.** The only record
of this in the repository is a same-day board note (TODO.md C13,
2026-09-14) restating this document's own conclusion, which is not
evidence that Kevin reviewed or confirmed it. Until he does, this is a
proposal: if a user refunds a Penny or MCP pack (section 3, products
13-16) after spending some or all of the messages or calls, this app
would not reclaim them. `grant_pack`'s `remaining` field would be left
untouched by a consumable `REFUND` — no zeroing, no negative balance,
nothing for `_settle_packs` (`backend/app/core/subscription.py`) to
special-case. The refund would simply stand as a loss on this app's
side. Two reasons are offered in support: consumables are consumed at
the moment of use, so there is nothing to "revoke" about Penny replies
already generated or MCP calls already served; and this matches Apple's
own model, which treats a consumable as spent once delivered and does
not ask this app's permission before refunding it anyway.

This is a known abuse vector: someone can buy a pack, spend it in full,
then get Apple to refund the purchase, and nothing in this design stops
them doing it again. The exposure is bounded per abuse cycle by the
price of the largest consumable a refund can target: £4.99 for the large
Penny pack (200 messages), per `PENNY_TOPUP_PACKS`
(`backend/app/core/subscription.py`) as it stands today (the MCP call pack
is not sold in the stores). Because no
clawback happens, that pattern is otherwise invisible — so the ASSN v2
`REFUND` notification for a consumable product must still be
**recorded** against the purchasing user even though it grants nothing
back. It is written to
`billing_events_col` (`backend/app/db/collections.py:122`), the same
collection and the same shape every other Apple and Stripe event is
already recorded in (section 5): keyed on the notification's
`notificationUUID` with `provider: "apple"` and `type: "REFUND"`, with
the resolved user's `uid` and the consumable's `pack_id`/`kind` and
`originalTransactionId` carried in the stored `result`, the same
correlation shape Stripe's event results already use. That makes "how
many times has this user done this" a query against `billing_events_col`
rather than something this codebase cannot answer at all. Deciding what
to do about a repeat pattern (throttling, a manual flag, revoking future
pack purchases) is not decided here and is not required to build the
refund handler.

### What C21 built (section 8)

`REFUND` and `REVOKE` strip a subscription at once (and entitlement is
recomputed by the precedence rule, so a live Stripe subscription takes over
if there is one). For a refunded Penny pack, the behaviour sits behind
**`IAP_REFUND_CLAWBACK`** (env, default **off**): off, `remaining` is left
untouched; on, `remaining` is set to zero and `clawed_back_at` stamped. Either
way the pack document gets `refunded_at` and the ledger row
(`billing_events_col`, type `REFUND`) records the user, `pack_id`, `kind`,
`transactionId` and `originalTransactionId`, so "how many times has this user
done this" is a ledger query. Both paths are tested. The flag is the
isolation for the one decision still open (section 13); the subscription
refund path never reads it.


## 9. Android: Google Play Billing (C24, as built)

Kevin decided on 2026-10-17 that Android sells through Play Billing, not a
billing-choice link-out to Stripe, and that **store prices match web exactly**
(no uplift for Google's fee): `TIER_BILLING_PRICES_GBP` and
`PENNY_TOPUP_PACKS` stay the single price source, and the app shows the price
string the store itself returns. This section replaces the earlier
billing-choice text, which is withdrawn. It builds on C21's provider-neutral
seam (`app/services/store_subscriptions.py`, `app/core/store_catalogue.py`,
merged at C21 commit 328c1308): section 2's per-provider documents and
precedence rule apply to `provider: "google"` unchanged.

### 9.1 Catalogue

Nine subscription products and three one-time products, ids from
`app.core.store_catalogue` (`sorted.<tier>.<period>`, `sorted.penny.<n>`), each
overridable with `PLAY_PRODUCT_IDS`. Tiers are Lite, Standard and Plus (B53: Plus replaced Max); there is no Connect (B51) and no MCP pack on Play. A purchase made under a legacy `sorted.max.<period>` product id resolves to Plus through the catalogue's `_LEGACY_TIER_MAP` alias.

| Product id | Type | Price (web price) |
|---|---|---|
| `sorted.lite.monthly` / `.six_months` / `.annual` | Subscription | £5.99 / £31.99 / £59.99 |
| `sorted.standard.monthly` / `.six_months` / `.annual` | Subscription | £9.99 / £53.99 / £99.99 |
| `sorted.plus.monthly` / `.six_months` / `.annual` | Subscription | £12.99 / £69.99 / £129.99 |
| `sorted.penny.20` / `.100` / `.200` | One-time (consumable) | £0.99 / £2.99 / £4.99 |

Every subscription carries a 14-day free-trial offer (Play Console, section
9.6). The app never says "14 days free" itself: the picker describes a trial
only when the store returns a free introductory phase for that user (Play
lists only the offers the user is eligible for), and uses the store's own
period text. The server recognises the trial from `offerDetails.offerId`
equal to `PLAY_TRIAL_OFFER_ID` (default `free-trial`), or `offerDetails.offerTags`
carrying it, and stores it as `trialing` with `trial_ends_at` set to the line
item's `expiryTime`, for the first billing cycle only: a latest order id with a
`..N` renewal suffix maps to `active` even if the offer is still present (C34:
the trial length is no longer checked).

### 9.2 Receiver and verification

`POST /webhooks/google-play` (`app/routers/play_billing.py`,
`app/services/play_billing.py`): the target of a Pub/Sub push subscription on
the Real-time Developer Notifications topic. The path is auth-exempt and
rate-limited like the other `/webhooks/` receivers.

1. **Authenticate the push.** OIDC when `PLAY_RTDN_OIDC_AUDIENCE` and
   `PLAY_RTDN_OIDC_EMAIL` are set: the `Authorization: Bearer` JWT is checked
   (RS256 against Google's published keys, issuer accounts.google.com,
   audience, expiry, verified email equal to the push service account).
   Otherwise a shared secret (`PLAY_RTDN_SHARED_SECRET`, in the push URL's
   `?token=`), compared in constant time. Neither configured, or OIDC half
   configured: 503. Bad or missing credentials: 401. Nothing is read from the
   body before this passes.
2. **Decode.** The Pub/Sub envelope's base64 `message.data` must be a JSON
   `DeveloperNotification` for `PLAY_PACKAGE_NAME`; anything else is 400.
3. **Dedupe the message** in `billing_events_col` (`google:<messageId>`, the
   seam's `claim_event`): a redelivery answers from the stored result.
4. **Verify the purchase with the Developer API.** The notification is only a
   hint and its type never decides the outcome. For every
   `subscriptionNotification` the server calls `purchases.subscriptionsv2.get`,
   for a `oneTimeProductNotification` (purchased) `purchases.products.get`, and
   applies the state that comes back. Re-reading current state on every event
   makes ordering irrelevant. The seam's `signed_at` is the instant before the
   fetch, so of two racing fetches the later one wins.
5. **Map the account** from `externalAccountIdentifiers.obfuscatedExternalAccountId`
   through `play_account_ids_col` (section 9.3). Unmapped or missing: refused and
   not acknowledged, so Google refunds it after three days. A test purchase
   (`testPurchase`, or `purchaseType` 0 for one-time products) is refused when
   `PLAY_ALLOW_TEST_PURCHASES` is off, which is the production default.
6. **Apply through the seam** (`provider: "google"`):

| `subscriptionState` | Effect |
|---|---|
| `ACTIVE` | active, or `trialing` on the free-trial offer; `expires_at` from `lineItems[].expiryTime` |
| `CANCELED`, not yet expired | still entitled, `cancel_at_period_end: true`; expired once past `expiryTime` |
| `IN_GRACE_PERIOD` | `past_due`, `grace_until` = `expiryTime`, one failed-renewal push naming Google Play |
| `ON_HOLD`, `PAUSED`, `EXPIRED` | `expired`, entitlement removed; a later `ACTIVE` (recovered, restarted) re-grants |
| `PENDING`, `PENDING_PURCHASE_CANCELED` | nothing granted, nothing acknowledged |
| anything unrecognised | fails closed to `expired` |

7. **Acknowledge** a purchase on its first verified receipt, once: skipped when
   Google or `play_purchases_col` already says acknowledged, and a failed call
   is re-read before it counts as failed (Google rejects a second
   acknowledge). **Consumables** are granted once (deduplicated on the order
   id through the seam's `grant_store_pack`) and only then consumed; consuming
   also acknowledges. A grant whose consume failed is retried by the next
   redelivery or client sync, which finds `granted_at` set and only consumes.
8. **Voided purchases.** A `voidedPurchaseNotification` revokes through a token
   this server has already verified and stored (a token it never saw is ignored,
   so a message cannot target an arbitrary account): a subscription loses
   entitlement at once and stays revoked whatever a later read says; a
   consumable is recorded against the user and, only with `IAP_REFUND_CLAWBACK`
   on, has its remaining balance zeroed (section 8's open decision, default
   off, both paths tested). `play_billing.reconcile_voided(since=...)` sweeps the
   Voided Purchases API as a safety net for a missed notification; it is
   idempotent and not scheduled by default.
9. **Failure shape.** A permanent refusal (unknown product, unmapped account)
   is recorded in the ledger and answered 200 so Pub/Sub stops. A transient
   failure (Google or the database) is a 503 with a generic body so Pub/Sub
   redelivers. Never a 500 with detail. Log lines carry product ids, states and
   status codes, never a purchase token, user id or response body.

The same purchase usually reaches the server twice within milliseconds (the
notification and the client's own verify call), so work is serialised per token
inside the process (the API runs one uvicorn worker today). Across replicas the
guarantees are the idempotent ones: the subscription upsert, the acknowledge
re-check and the seam's pack dedupe on the order id. That pack dedupe is a
find-then-insert, so a unique partial index on `(provider, store_transaction_id)`
is the recommended hardening once replicas arrive (E2); it belongs to the seam,
not to this section.

Purchase tokens are stored raw only in `play_purchases_col` (unique on the
token, the dedupe key); the subscription document carries `sha256(token)` as
`provider_subscription_id`. Every token and product id is validated against a
strict pattern before use and percent-encoded into the API path.

All Google network calls (`HttpPlayApi`, `GoogleOidcVerifier`) sit behind the
`PlayApi` and `OidcVerifier` interfaces in `app/services/google_play.py`; the
tests replace them and never touch the network. The HTTP client is covered
separately with `httpx.MockTransport`. The service-account key is read from
`PLAY_SERVICE_ACCOUNT_FILE` or `PLAY_SERVICE_ACCOUNT_JSON` and used to sign an
RS256 JWT bearer assertion with PyJWT and `cryptography`, both already
installed; no package was added to the backend.

### 9.3 obfuscatedAccountId

`GET /billing/play/config` returns the user's account id, minted lazily into
`play_account_ids_col`: a salted sha256 (`PLAY_ACCOUNT_ID_SALT`, 64 hex
characters, the most Play accepts), never the email. The client sets it as the
purchase's `obfuscatedAccountId`. The server maps back through the stored
table, so a purchase belongs to an account only if it carries that id, and a
client verifying its own purchase must match its own id (`account_mismatch`
otherwise). E6's Sentry hash was not reused: it is 16 characters and returns
nothing without its own salt, so Play has its own helper and salt.

### 9.4 Client

- `lib/purchaseChannel.ts` returns `"play"` on an Android build whose binary
  really contains the plugin, replacing "Paid plans are not available in this
  app". Stripe Checkout and the portal are reachable only from `"stripe_web"`;
  the B31 server backstop is unchanged and still refuses a native client's
  checkout.
- Plugin: `@capgo/native-purchases` 8.9.6 (the same package and pin as C21, one
  plugin for both stores, MPL-2.0; `capacitor-spike/package-lock.json` lists 8.9.6, matching `package.json`). `lib/playBilling.ts` reaches it only through
  `withPlay()`, which never returns the plugin proxy (it is not thenable and
  would hang the call), and checks `Capacitor.PluginHeaders` first (a call with
  no native implementation also hangs). `capacitor.config.json` sets
  `autoFinishTransactions: false` so the plugin's launch-time recovery cannot
  acknowledge a purchase the server has not verified. Purchases are made with
  `autoAcknowledgePurchases: false` and no client-side consume.
- Product ids, the account id and any block reason come from
  `GET /billing/play/config`; nothing is hard-coded in the app.
- After a purchase the client sends only the purchase token and product id to
  `POST /billing/play/purchase`. The server verifies with the Developer API and
  acknowledges or consumes; the client never grants entitlement.
- **Restore** (`restorePlayPurchases`): `getPurchases` for subscriptions and
  one-time products, filtered to this account's id, each sent to the same
  verify endpoint. Idempotent (dedupe on the token). It is also the recovery
  path for a purchase whose verification never completed.
- **Cancellation** points at Google Play (`manageSubscriptions` opens the
  Play subscriptions page for the package). Account hold and grace are shown
  from the server's `past_due`/`expired` status.
- **Stripe and Play together**: the server refuses to offer a Play purchase
  while a Stripe subscription is live (`purchase_blocked`, section 2.3), and a
  purchase that completes anyway is granted and flagged `double_subscription`.

### 9.5 Upgrade and downgrade

Policy, matching StoreKit's behaviour: an **upgrade** (higher tier, or the same
tier on a longer period) takes effect at once with Play's
`CHARGE_PRORATED_PRICE` replacement mode, a **downgrade** is deferred to the
next renewal (`DEFERRED`), and the new purchase names the old one in
`linkedPurchaseToken`, which the server records (`superseded_at`) so a late
event for the old token cannot expire the new plan. The server side of this is
built and tested. **The client side is not**: plugin 8.9.6's `purchaseProduct`
cannot send a replacement mode or the old purchase token, so buying a second
subscription on top would charge twice. As built, while a live Play subscription
exists (`subscription_managed_in_play`) the picker does not offer another
subscription purchase; it points at Google Play to change or cancel, and a new
plan is bought once the old one has lapsed. In-app upgrade and downgrade needs a
small native change (a `SubscriptionUpdateParams` call with the replacement mode
above, behind a new plugin method) or an upstream plugin change: recorded as
follow-up on C24, not a blocker for the internal track.

### 9.5a Purchase failure copy (both stores)

After the store's own purchase call resolves the user HAS been charged, so a
failing server verification must never say "You have not been charged." Both
stores now keep two copies: before the purchase completes, "The purchase did
not go through. You have not been charged."; after, "Your purchase is recorded
with Apple|Google Play and will show here shortly" (Google's adds "Tap Restore
if it does not."). On Android only the plugin's `USER_CANCELED` code counts as
a user cancellation; an error whose text merely contains "cancel" does not.
`ITEM_ALREADY_OWNED` reads as already paid. A second live Play subscription
bought without naming the first (the plugin cannot send the replacement mode)
is granted, flagged `double_subscription` and reported to the client as
`double_play_subscription`, and Your plan then shows the Google Play manage
line. The client's `product_id` must equal the purchased product or the call is
refused.

### 9.6 Kevin's Play Console and Google Cloud setup list

Nothing here can be done by an agent. Do them in this order; the app stays
switched off (`PLAY_IAP_ENABLED` unset) until the last step.

0. **Wait for B52 and B53 first.** They reshape the tiers (Lite features, Plus replacing Max) and
   descriptions (not the catalogue shape). Do not type any product title or
   description into Play Console until B52's Lite description is final (and B53's Plus description).
1. **Play Console record (A9)**: organisation account, app
   `co.uk.auriqltd.sorted`, Finance category, financial features declaration,
   payments profile and merchant account. The Board flavour has a different
   application id; its purchases will not verify against this package and
   Board does not sell.
2. **Subscription products** (Monetise, Subscriptions): create nine, with the
   ids in section 9.1. Give each one base plan (auto-renewing: P1M, P6M or P1Y
   to match its period), priced in GBP at the web price from section 9.1, and
   one offer on that base plan: a free trial of 14 days, **offer id
   `free-trial`** (or set `PLAY_TRIAL_OFFER_ID` to what you typed), eligibility
   "new customer acquisition" so each Google account gets it once. Set the
   grace period (7 days) and account hold under Subscriptions, Settings. Leave
   resubscribe allowed.
3. **One-time products** (Monetise, In-app products): create three consumables,
   `sorted.penny.20` £0.99, `sorted.penny.100` £2.99, `sorted.penny.200` £4.99,
   one buy option each.
4. **Pub/Sub**: create a Pub/Sub topic in the Google Cloud project linked to
   Play, give `google-play-developer-notifications@system.gserviceaccount.com`
   the Pub/Sub Publisher role on it, and set it in Play Console (Monetisation
   setup, Real-time developer notifications, topic name, notification content
   "Subscriptions, voided purchases and one-time products"; send a test
   notification). Create a **push subscription** on the topic with endpoint
   `https://<api host>/webhooks/google-play`, authentication enabled with a
   dedicated service account (for example `play-rtdn-push@<project>.iam`), and
   audience equal to the endpoint URL. Set `PLAY_RTDN_OIDC_AUDIENCE` to that
   audience and `PLAY_RTDN_OIDC_EMAIL` to that service account's email. (If
   OIDC is not wanted, use `PLAY_RTDN_SHARED_SECRET` and append `?token=` to the
   endpoint instead; OIDC is preferred because a query token appears in any
   proxy access log.)
5. **API access**: enable the Google Play Android Developer API in the Cloud
   project, create a service account, download its JSON key, and in Play
   Console (Users and permissions) invite its email with "View financial data"
   and "Manage orders and subscriptions". Store the key outside the repo
   (`PLAY_SERVICE_ACCOUNT_FILE`, mode 600) or as `PLAY_SERVICE_ACCOUNT_JSON`.
   It can take up to 24 hours for the permission to work.
6. **Secrets and switch**: generate `PLAY_ACCOUNT_ID_SALT` (`openssl rand -hex 32`),
   then set `PLAY_IAP_ENABLED=1` on the host under test (docs/ops/ENV.md lists
   every variable).
7. **Licence testers**: Play Console, Settings, License testing: add Kevin's
   Google account, and add the same account to the internal testing track's
   testers. Licence testers see test payment methods and accelerated renewals.
8. **Internal track build**: ship an Android build that includes the plugin
   (C11 and C23 pipeline), then run docs/pricing/store-billing-c24-testplan.md.

### 9.7 What this section did not or could not confirm

Written without access to Google's documentation or a Play Console, from
general knowledge of the Play Developer API, so each item below must be
checked against the first real test notification and purchase: the exact
`subscriptionsv2` field names the mapper reads (`subscriptionState`,
`lineItems[].expiryTime`, `lineItems[].offerDetails.offerId`,
`externalAccountIdentifiers.obfuscatedExternalAccountId`, `linkedPurchaseToken`,
`acknowledgementState`, `testPurchase`); that `expiryTime` marks the end of the
grace period during `IN_GRACE_PERIOD`; that Play lists only
eligible offers to `getProducts`; the `purchases.products.get` fields
(`purchaseState`, `consumptionState`, `orderId`, `purchaseType`,
`obfuscatedExternalAccountId`). Checked in the plugin's source (8.9.6) rather
than assumed: `purchaseProduct` maps `appAccountToken` to
`BillingFlowParams.setObfuscatedAccountId` on Android, and the purchases it
returns carry `getObfuscatedAccountId()` back as `appAccountToken`, so the
restore filter and the server's mapping use the same value.

Trial detection (C34): this assumption, that the free-trial offer is
recognisable by `lineItems[].offerDetails.offerId` (there is no "is trial"
field), is now confirmed by Kevin's 2026-10-21 tester purchase: the Play sheet
showed the offer, the state was `SUBSCRIPTION_STATE_ACTIVE`, and the mapper did
not mark the purchase `trialing`. The old window check (start plus 15 days) could
not have rejected a 3-minute accelerated phase, so the mapper's offer id test did
not match what Google returned; the exact `offerId` seen is not yet known. The fix
makes `trialing` depend on the offer alone (offer id equal to
`PLAY_TRIAL_OFFER_ID`, or the same value in `offerTags`), sets `trial_ends_at`
from `expiryTime`, downgrades the length check to a logged warning, and logs one
INFO line per verified purchase (`play billing: verified subscription
product=... state=... base_plan=... offer_id=... offer_tags=... trial_reason=...
expiry=...`, never the token, account id or order id). Read the offer id from
that line on the next tester purchase and set `PLAY_TRIAL_OFFER_ID` to match what
Play Console actually holds. A renewal (order id with a `..N` suffix, since Google keeps the
offer on the line item and does not expose the pricing phase) or a read with
no matching offer maps to `active` and clears `trial_ends_at`. With no order id
the mapper fails open to the offer (`offer_id_match_no_order_id`).

## 10. Apple details not independently confirmed in this session

Flagged explicitly per this doc's own instructions rather than written
as confident guesses:

- Which Apple guideline subsections apply to Sorted, and why (section 0)
  — the reasoning that Sorted fits neither the reader-app exception
  (3.1.3(a)) nor the multiplatform exception (3.1.3(e)), and so must sell
  through StoreKit rather than an external link, is this document's own
  analysis from general guideline knowledge, not independently confirmed
  against Apple's current guidelines text; `WebFetch` against
  `developer.apple.com` failed in this session, the same way it did for
  the two entries below. The decision to use StoreKit itself is Kevin's,
  already made (TODO.md C13), and this caveat does not reopen it — only
  this document's own supporting reasoning about which subsections apply
  is unconfirmed.
- Exact behaviour of subscription-group ranking for same-tier,
  different-duration products (section 3) — whether Apple treats a
  duration-only change as upgrade, downgrade or crossgrade, and whether
  it needs a distinct rank per duration or can share one.
  `WebFetch` against `developer.apple.com`'s Subscription Groups page
  404'd in this session; the ranking description in section 3 is from
  general StoreKit knowledge, not a freshly confirmed source.
- The precise field-level shape of the ASSN v2 decoded payload and the
  exact x5c verification procedure (section 5) — `WebFetch` against
  `developer.apple.com/documentation/appstoreservernotifications/...`
  returned a plausible-looking structure but the tool itself could not
  confirm it was reading live page content rather than reconstructing
  from prior knowledge; before building the receiver, re-check this
  directly against Apple's current documentation and, ideally, real
  sandbox payloads (see section 11).
- Whether to take Apple's official `app-store-server-library-python` SDK
  as a dependency for JWS/x5c verification versus implementing the chain
  walk directly (section 5) — not resolved here, an implementation
  choice for whoever builds this.
- Whether any of the nine subscription and three pack prices (section
  3.1) land on an actual point on Apple's price-point grid — App Store
  Connect only accepts prices from that fixed grid, and none of them
  has been checked against it in this session; `WebFetch` against
  `developer.apple.com` failed the same way it did for the entries
  above, so this must be confirmed before the SKUs are created in App
  Store Connect.

C21 resolved the SDK question (verification is implemented with
`cryptography` and `PyJWT`, no new dependency) and added these unconfirmed
items, all of which the sandbox pass in `store-billing-c13-testplan.md` is
meant to settle:

- Apple's marker OIDs on the leaf (`1.2.840.113635.100.6.11.1`) and
  intermediate (`1.2.840.113635.100.6.2.1`) are enforced from the shape
  Apple's own library uses, from memory. If a real sandbox payload is rejected
  with "leaf certificate lacks the App Store marker", this is the first
  suspect (`apple_jws.REQUIRE_APPLE_MARKER_OIDS`).
- The exact decoded field names used (`notificationType`, `subtype`,
  `notificationUUID`, `data.signedTransactionInfo`, `signedRenewalInfo`,
  `offerType`, `offerDiscountType`, `autoRenewStatus`,
  `gracePeriodExpiresDate`, `revocationDate`, millisecond timestamps) are from
  general ASSN v2 knowledge, not a live payload.
- How `@capgo/native-purchases` 8.9.6 behaves on a real device
  (`jwsRepresentation` present on `purchaseProduct`, `getPurchases` honouring
  `appAccountToken` and `onlyCurrentEntitlements`, `introEligibility` set).
- The `/api` prefix of the notifications URL on each host.
- Whether any plugin or App Store Connect step needs the "In-App Purchase"
  capability added to the generated Xcode project (the plugin README says to
  add it; `codemagic.yaml` does not today). It is an App ID capability and
  needs no entitlements key as far as is known; verify on the first TestFlight
  build.

## 11. Testing

This gets its own section with real weight, because the closest possible
precedent inside this codebase is a direct warning. On 2026-09-13, the
Stripe sandbox pass against real Stripe test-mode traffic found **three**
bugs that 2,296 passing tests had missed entirely — all three because
`tests/test_billing.py`'s fake returned a plain `dict` where Stripe
actually returns a `StripeObject`:

- **B33**: the webhook parse returned the raw `stripe.Event` (a
  `StripeObject`) instead of a plain dict, so `.get(...)` calls
  downstream raised `AttributeError` on *every real delivery* — nothing
  was ever granted, and the receiver 500'd, in production shape, while
  every test using a dict-returning fake passed.
- **B36**: `status_map` (now in `_handle_subscription_upsert`, section 1)
  had no `"incomplete"` entry and defaulted any unrecognised status to
  `"active"` — granting the paid tier to someone who abandoned 3D Secure
  and never actually paid. Fixed by making the map exhaustive and the
  fallback fail closed to `"expired"` (see the current code's own
  comment on this, quoted in section 1's citation).
- **B36** (same pass): `current_period_end` moved from the `Subscription`
  object onto each `Subscription Item` in Stripe API version
  `2026-08-26.dahlia`, so `expires_at` was silently never written under
  the new shape until the code was changed to read the item-level field
  first with a subscription-level fallback.

**The ASSN v2 receiver has exactly the same failure mode available to
it**: Apple's SDK objects (however verification ends up being
implemented, section 10) are not guaranteed to behave like plain dicts
either, and a fake built for unit tests that quietly returns a plain
dict "close enough" will hide the same class of bug that hid B33/B36
from 2,296 passing tests for as long as it did. Two concrete
requirements follow directly from that incident, not general good
practice:

1. **The receiver must be exercised against Apple's sandbox with real
   signed payloads before it is believed** — not just unit-tested against
   a hand-built fake. Apple's App Store Server sandbox environment can
   generate real, correctly-signed test notifications; this is the
   direct equivalent of the Stripe test-mode sandbox pass that actually
   found B33/B36, and unit tests alone did not.
2. **Any fake used in `tests/test_apple_billing.py` must be as
   unhelpful as the real thing.** `tests/test_billing.py`'s
   `_FakeStripeObject` (`backend/tests/test_billing.py:144`) is the
   pattern to copy directly: it deliberately blocks `.get`/`.keys`/
   `.values`/`.items` with a pointed `AttributeError`
   ("'{key}' is a dict method, but a Event is not a dict. Use .to_dict()
   to convert it."), wraps nested dicts/lists the same way recursively,
   and only unwraps everything on an explicit `.to_dict()` call — built
   specifically so that writing code against the fake the "convenient"
   way (treating it like a dict) fails the same way it would against the
   real SDK object, rather than passing quietly. Whatever fake stands in
   for Apple's verified-payload object in tests should be built to the
   same principle: if the real object doesn't support an access pattern,
   the fake must not either.

### What C21 built (section 11)

`backend/tests/test_apple_billing.py` mints a test CA (root, intermediate and
leaf with the same marker extensions), signs real ES256 JWS with it through
PyJWT, pins the test root in Apple's place and drives the real verification
code, so the objects the code reads are exactly what `jwt.decode` returns in
production (plain dicts); there is no convenient fake to hide a dict-versus-
object bug behind, which is the B33/B36 lesson. It covers: a valid chain, bad
signature, tampering, an unpinned CA, expired and unmarked certificates,
non-ES256 algorithms, garbage tokens, wrong bundle id, wrong environment,
replayed `notificationUUID`, every notification type, restore, refund with and
without clawback, and that malformed input never produces a 500.
`test_store_subscriptions.py` and `test_subscription_provider_precedence.py`
cover the shared seam, precedence and migration. What none of it can prove is
that real Apple payloads match: the TestFlight pass (Kevin's, with his sandbox
tester) is `docs/pricing/store-billing-c13-testplan.md`.

## 12. Dependencies and sequencing

- **A9** (Play Console record, owner: kevin, p1) blocks all of section 9
  — no Android product, notification topic or internal-track test can exist
  until it does (the code is built and tested without it).
- **C5** (store listings, owner: claude, p2) needs the finished product
  catalogue (section 3) for App Store Connect's screenshots/description
  work and Play's Data safety form, so it sits after this item's product
  ids are settled, not before.
- **C1** (iOS rebuild, owner: kevin, p2) — the Codemagic rebuild that
  picks up Apple linking — should happen after the StoreKit plugin
  (section 6) is integrated, so it ships in the same rebuild rather than
  needing a second one immediately after.
- **B31** (server-side purchase-gate backstop, currently open) should be
  closed as part of this item's backend work (section 6), not
  separately.
- **Store-side pricing** (section 3.1, decided: store = web) blocks nothing
  technical; it needs the nine subscription prices and three pack prices
  entered in App Store Connect, each checked against Apple's own price-point
  grid, before products can be submitted for review.

## 13. OPEN — needs Kevin

Two things remain open.

1. **A9, Play Console record** (section 9, section 12) — does not exist
   yet; owned by Kevin, not something this item or a Claude session can
   create. It blocks the Play Console steps in section 9.6 (products, the
   notification topic, licence testers) and nothing else. Kevin's setup list
   is section 9.6.
2. **Refunded-consumable clawback** — proposed: no clawback. Under this
   proposal, a refunded Penny pack would not claw back already-spent
   messages; the refund notification would still be recorded against the
   user so a repeat pattern is visible. See section 8 for the reasoning, the
   abuse-vector consequence, its monetary bound and where that record lives.
   Not a decision Kevin has recorded, so it stays a proposal. Built so that
   either answer is a one-line switch: `IAP_REFUND_CLAWBACK` (default off =
   the proposal), both paths tested.

Resolved since the previous version of this section: **store pricing**.
Kevin decided on 2026-10-17 (board item C24) that store prices match web
exactly with no uplift, 14-day free introductory offer on every subscription;
see section 3.1.

**Discrepancy found while writing the original version of this
document**: C13's own board text (`TODO.md`) said a £16.99 tier "nets
about £14.44" under Apple's cut — that's the naive `16.99 × 0.85`
calculation, which doesn't account for Apple also remitting UK VAT as
merchant of record on iOS. The correct figure, using the same
ex-VAT-then-commission method the existing unit-economics doc already
applies to Stripe/app-store proceeds elsewhere, is **£12.03**, not
£14.44 (ex-VAT £16.99 / 1.2 = £14.16, 15% of that is £2.12, proceeds
£14.16 − £2.12 = £12.03; this matches the worked example in
`docs/pricing/tiering-unit-economics-mcp-2026-09.md` section 2 for the
£9.99 Standard tier). The board note's £14.44 should be treated as superseded now that Kevin
has reviewed this doc. (£16.99 was the retired Max price; Section 3.1 now
uses Plus at £12.99.)
