# C13: store billing (iOS StoreKit + Android Play billing-choice)

Status: implementation spec, not yet built. Decisions below are Kevin's
(2026-09-12/13, TODO.md C13 and the coordinator notes on B25/B26/B29/B31);
this document works them into the codebase as it stands after B25, B27,
B33 and B36 (2026-09-13). Currency: GBP throughout.

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
- **Android**: does not use Play Billing. Since 2026-06-30 Play's
  billing-choice programme covers the UK, so the app enrols and links out
  to the existing Stripe flow (roughly 10% service fee on that revenue,
  no separate 5% billing fee for the external link).
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

## 3. Product catalogue

Twelve auto-renewable subscriptions (four paid tiers × three durations —
`monthly`, `six_months`, `annual`, matching
`app.core.subscription.SUBSCRIPTION_PERIODS_ENABLED` after B27 dropped
`three_months`) in **one subscription group**, ranked by tier so Apple
handles upgrade proration and defers downgrades itself, plus four
consumables mapping to `PENNY_TOPUP_PACKS` and `MCP_CALL_PACKS`. Sixteen
products total, matching C13's own title.

Bundle id (`capacitor-spike/capacitor.config.json`): `co.uk.auriqltd.sorted`.
Proposed product id namespace: `co.uk.auriqltd.sorted.<kind>.<id>`.

Subscription group: one group,
`co.uk.auriqltd.sorted.subscriptions`, ranked highest tier first
(Max above Connect above Standard above Lite), so moving to a higher tier
is an Apple-handled upgrade (immediate, prorated credit for the unused
portion of the current period) and moving to a lower tier is an
Apple-handled downgrade (deferred to the next renewal, no credit) —
exactly the behaviour Stripe's own subscription-item swap gives today,
done by Apple instead. **Not independently confirmed in this session**
(see section 10): how Apple's ranking model treats a *same-tier,
different-duration* change (e.g. Lite monthly to Lite annual) — whether
that is a crossgrade, an upgrade, or requires the two durations to be
modelled as separate ranks — needs verifying against Apple's own
Subscriptions documentation or a sandbox test before the group is built
in App Store Connect. The default proposed here, absent that
confirmation, is to rank all three durations of a tier adjacently with
the longer commitment ranked above the shorter one within that tier
(annual above six-monthly above monthly), so that moving to a longer
commitment at the same or higher tier is never treated as a downgrade.

Prices below are read from `TIER_BILLING_PRICES_GBP`
(`backend/app/core/subscription.py:70`) and `PENNY_TOPUP_PACKS` /
`MCP_CALL_PACKS` (`backend/app/core/subscription.py:136` and `:159`), not
retyped by hand.

| # | Product id | Type | Tier | Period | GBP price (web, incl. VAT) |
|---|---|---|---|---|---|
| 1 | `co.uk.auriqltd.sorted.sub.lite.monthly` | Auto-renewable | Lite | Monthly | £5.99 |
| 2 | `co.uk.auriqltd.sorted.sub.lite.six_months` | Auto-renewable | Lite | Every 6 months | £31.99 |
| 3 | `co.uk.auriqltd.sorted.sub.lite.annual` | Auto-renewable | Lite | Yearly | £59.99 |
| 4 | `co.uk.auriqltd.sorted.sub.standard.monthly` | Auto-renewable | Standard | Monthly | £9.99 |
| 5 | `co.uk.auriqltd.sorted.sub.standard.six_months` | Auto-renewable | Standard | Every 6 months | £53.99 |
| 6 | `co.uk.auriqltd.sorted.sub.standard.annual` | Auto-renewable | Standard | Yearly | £99.99 |
| 7 | `co.uk.auriqltd.sorted.sub.connect.monthly` | Auto-renewable | Connect | Monthly | £12.99 |
| 8 | `co.uk.auriqltd.sorted.sub.connect.six_months` | Auto-renewable | Connect | Every 6 months | £69.99 |
| 9 | `co.uk.auriqltd.sorted.sub.connect.annual` | Auto-renewable | Connect | Yearly | £129.99 |
| 10 | `co.uk.auriqltd.sorted.sub.max.monthly` | Auto-renewable | Max | Monthly | £16.99 |
| 11 | `co.uk.auriqltd.sorted.sub.max.six_months` | Auto-renewable | Max | Every 6 months | £91.99 |
| 12 | `co.uk.auriqltd.sorted.sub.max.annual` | Auto-renewable | Max | Yearly | £169.99 |
| 13 | `co.uk.auriqltd.sorted.pack.penny.small` | Consumable | — (Penny top-up) | 20 messages | £0.99 |
| 14 | `co.uk.auriqltd.sorted.pack.penny.medium` | Consumable | — (Penny top-up, "Most popular") | 100 messages | £2.99 |
| 15 | `co.uk.auriqltd.sorted.pack.penny.large` | Consumable | — (Penny top-up, "Best value") | 200 messages | £4.99 |
| 16 | `co.uk.auriqltd.sorted.pack.mcp.1000` | Consumable | — (MCP call pack) | 1,000 calls | £2.99 |

Statements (free tier) never checks out, matching
`_price_id_for`'s existing `target == "statements"` exclusion for Stripe.

Config: mirror `STRIPE_PRICE_IDS`' `_parse_stripe_price_ids`
(`backend/app/core/config.py:365`) with an `APPLE_PRODUCT_IDS`
env-parsed table of the same 16 keys used across both providers (e.g.
`lite`, `lite_six_months`, `lite_annual`, ... `penny_small`, `mcp_1000`),
mapping each to its App Store Connect product id — this keeps the
existing `_STRIPE_REQUIRED_PRICE_KEYS` tuple's 16 keys as the shared
vocabulary between the two providers rather than inventing a second
naming scheme.

### 3.1 iOS SKU pricing (Kevin, 2026-09-14)

Kevin decided against pricing for full recovery of Apple's cut. The iOS
SKUs (products 1-12 above) carry an uplift of roughly 18% over the web
price, not the roughly 37% that would be needed to make the iOS net
match the web net exactly.

Two reasons, both recorded here:

- The App Store listing shows the price publicly, so the iOS number is
  what the app is judged on against competitors, not a blended figure
  only this codebase can see.
- The gap that full compensation is trying to close narrows sharply once
  the business registers for VAT above the £90k threshold. At today's
  £16.99 Max price charged on both channels, the web net is about £16.54
  (unregistered) against an iOS net of about £12.03, a gap of £4.51.
  Once VAT-registered, the web net for Max falls to about £13.71 (VAT
  now comes off the web side too) against the same £12.03 on iOS, a gap
  of £1.68. A 37% uplift fixed today, sized against the wider gap, would
  become a large overcharge on iOS customers exactly as the business
  grows into VAT registration and the gap it was set to close shrinks
  under it.

Set against that: in-app purchase converts better than sending someone
to a website to check out, so a thinner per-subscriber margin on iOS can
still yield more total revenue than the web channel would at a matching
price. Pricing for full cost recovery risks giving away that conversion
advantage, which is the reason store billing was worth building in the
first place (section 0).

Figures below: web price is read from `TIER_BILLING_PRICES_GBP`
(`backend/app/core/subscription.py:70`) as it stands, not retyped by
hand; iOS price is the agreed price point; uplift is `(iOS − web) /
web`; iOS net is `price / 1.2 × 0.85` (VAT removed at the 20% assumption
below, then Apple's 15% Small Business Program commission); web net is
the price less Stripe's fee (1.5% + 20p).

| Tier | Period | Web price | iOS price | Uplift | iOS net | Web net |
|---|---|---|---|---|---|---|
| Lite | Monthly | £5.99 | £6.99 | 16.7% | £4.95 | £5.70 |
| Lite | Every 6 months | £31.99 | £37.99 | 18.8% | £26.91 | £31.31 |
| Lite | Yearly | £59.99 | £69.99 | 16.7% | £49.58 | £58.89 |
| Standard | Monthly | £9.99 | £11.99 | 20.0% | £8.49 | £9.64 |
| Standard | Every 6 months | £53.99 | £63.99 | 18.5% | £45.33 | £52.98 |
| Standard | Yearly | £99.99 | £119.99 | 20.0% | £84.99 | £98.29 |
| Connect | Monthly | £12.99 | £14.99 | 15.4% | £10.62 | £12.60 |
| Connect | Every 6 months | £69.99 | £82.99 | 18.6% | £58.78 | £68.74 |
| Connect | Yearly | £129.99 | £154.99 | 19.2% | £109.78 | £127.84 |
| Max | Monthly | £16.99 | £19.99 | 17.7% | £14.16 | £16.54 |
| Max | Every 6 months | £91.99 | £108.99 | 18.5% | £77.20 | £90.41 |
| Max | Yearly | £169.99 | £199.99 | 17.7% | £141.66 | £167.24 |

Because iOS prices are rounded to `.99` price points rather than
computed to a clean 18%, the real per-SKU uplift ranges from about 15.4%
(Connect monthly, the low end) to about 20.0% (Standard monthly and
Standard annual, the high end), not a flat 18% across all twelve.

**Caveat, not a fact about Apple**: these twelve prices are a decision
about market positioning, not a confirmed fact about what Apple offers.
They must be checked against Apple's actual price point grid when the
SKUs are created in App Store Connect — Apple sells in fixed price
tiers, and a requested price may not exist at that exact point.
`WebFetch` against `developer.apple.com` failed in this session the same
way it did elsewhere in this document (section 10), so none of the
twelve prices above has been checked against the live grid; this is
flagged here rather than silently assumed correct. The VAT assumption
behind the iOS-net and web-net figures (unregistered today, 20% once the
business crosses the £90k threshold) is the largest single term in this
comparison and should be confirmed with Kevin's accountant before it is
relied on.

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
| Android native | Stripe Checkout, opened via an external browser link (billing-choice) |

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
  all; Android opens the existing Stripe Checkout URL via
  `Browser.open` (the same Capacitor Browser plugin pattern already used
  in `nativeGoogleLogin`, `frontend/lib/nativeAuth.ts:206`), and per
  Play's billing-choice programme requirements should show a disclosure
  that the purchase completes outside the app before handing off — the
  exact wording/UI Play requires for this disclosure is not confirmed in
  this session and should be checked against Play Console's
  billing-choice documentation once A9 exists.
- **`MoreMessagesSheet.tsx`** and **`ConnectedAssistantsCard.tsx`**
  (Penny and MCP pack purchases) — same three-way split, for the four
  consumable products instead of the twelve subscriptions.
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
Android still may never show a plain external Stripe Checkout button
without the billing-choice disclosure, and iOS must never fall back to
Stripe under any condition.

**B31** (no server-side backstop on the native purchase gate, currently
open, `TODO.md`) should be closed as part of this item rather than left
open again: once real StoreKit purchases exist, `/billing/checkout` and
`/billing/portal` genuinely must never be reachable in a way that lets a
native iOS client buy through Stripe, and the Apple verification endpoint
must independently verify the JWS rather than trust a client-asserted
platform — this is a natural side effect of building the Apple-side
verification path properly, not extra scope.

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

## 8. Refunds and revocation

`REFUND` and `REVOKE` (section 5) strip entitlement immediately,
regardless of `expires_at` — this mirrors the fail-closed doctrine this
codebase already applies elsewhere (Safe-to-Spend hardening clamping to
`<= 0` on any lookup failure, referenced in `CLAUDE.md`'s surface map).

**Decided (Kevin, 2026-09-14): no clawback.** If a user refunds a Penny
or MCP pack (section 3, products 13-16) after spending some or all of
the messages or calls, this app does not reclaim them. `grant_pack`'s
`remaining` field is left untouched by a consumable `REFUND` — no
zeroing, no negative balance, nothing for `_settle_packs`
(`backend/app/core/subscription.py`) to special-case. The refund simply
stands as a loss on this app's side. Two reasons: consumables are
consumed at the moment of use, so there is nothing to "revoke" about
Penny replies already generated or MCP calls already served; and this
matches Apple's own model, which treats a consumable as spent once
delivered and does not ask this app's permission before refunding it
anyway.

This is a known abuse vector: someone can buy a pack, spend it in full,
then get Apple to refund the purchase, and nothing in this design stops
them doing it again. Because no clawback happens, that pattern is
otherwise invisible — so the ASSN v2 `REFUND` notification for a
consumable product must still be **recorded** against the purchasing
user even though it grants nothing back. It is written to
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

## 9. Android: Play billing-choice

Enrolling in Play's billing-choice programme (covering the UK since
2026-06-30, per C13's own board text) is a Play Console configuration
step, not something built in this codebase — the app declares which
billing systems it offers and links its external payment flow, subject
to Play's disclosure requirements (see section 6's note on the
in-app disclosure Play expects before an external link).

**This is gated on A9** (`TODO.md`, owner: kevin, priority p1): "Play
Console record" — the Organisation account, app record, package
`co.uk.auriqltd.sorted`, Finance category and financial-features
declaration. A9 does not exist yet. Nothing Android-side in this item
can proceed — not the billing-choice enrolment, not an Android build to
test it in — until A9 is done.

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
- The exact UI/disclosure Play's billing-choice programme requires before
  an external link (section 6, section 9) — described in general terms
  only; check Play Console's own billing-choice documentation once A9
  exists.

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

## 12. Dependencies and sequencing

- **A9** (Play Console record, owner: kevin, p1) blocks all of section 9
  — nothing Android-side can be enrolled, tested, or even built for,
  until this exists.
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
- **Store-side pricing** (section 3.1, decided) blocks nothing technical
  — the product catalogue (section 3) can be built and tested with
  placeholder prices — but blocks going live, since App Store Connect
  needs the section 3.1 prices entered, and checked against Apple's own
  price point grid, before products can be submitted for review.

## 13. OPEN — needs Kevin

One thing remains open. Two things that were open when this document was
first written have since been decided by Kevin and moved into the body
of the spec, not left sitting here marked resolved.

1. **A9, Play Console record** (section 9, section 12) — does not exist
   yet; owned by Kevin, not something this item or a Claude session can
   create. This is the only thing in this document still waiting on
   Kevin; it blocks all of section 9 (Android's billing-choice
   enrolment) and nothing else.

**Resolved, Kevin, 2026-09-14:**

- **Store-side pricing** — decided: the iOS SKUs carry an uplift of
  roughly 18% over the web price, not full compensation for Apple's cut
  (which would need roughly +37%). See section 3.1 for the full price
  table, the arithmetic and the reasoning Kevin gave for stopping short
  of full recovery.
- **Refunded-consumable clawback** — decided: no clawback. A refunded
  Penny or MCP pack does not claw back already-spent messages or calls;
  the refund notification is still recorded against the user so a repeat
  pattern is visible. See section 8 for the reasoning, the abuse-vector
  consequence and where that record lives.

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
£9.99 Standard tier). Section 3.1's price table uses this £12.03 figure
as the iOS net at the pre-uplift £16.99 price point; the board note's
£14.44 should be treated as superseded now that Kevin has reviewed this
doc.
