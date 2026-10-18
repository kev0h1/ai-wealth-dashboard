# C24: Google Play Billing internal-track test script

Companion to docs/pricing/store-billing-c13.md section 9. Run it on the
internal testing track with a licence tester after Kevin's setup list (section
9.6) is done. Nothing here is automated: the unit tests cover the server with a
faked Developer API, and this script is the equivalent of C13 section 11's
"exercise it against the real thing", which is the pass that found B33 and B36
for Stripe.

## 0. Before you start

- Backend host under test has `PLAY_IAP_ENABLED=1`, `PLAY_ACCOUNT_ID_SALT`, the
  service account, the push subscription's `PLAY_RTDN_OIDC_*` (or
  `PLAY_RTDN_SHARED_SECRET`), and, if it is the production host,
  `PLAY_ALLOW_TEST_PURCHASES=1` for the duration of the test only.
- A licence tester Google account on a real Android device with the internal-track
  build installed, signed in to Sorted as a test user with no Stripe
  subscription. Licence testers renew accelerated: a monthly plan renews about
  every 5 minutes and stops renewing after six renewals; annual about every 30
  minutes; a 14-day trial lasts about 3 minutes.
- Watch the receiver with `journalctl -u wealth-api -f | grep "play billing"`
  (log lines carry product ids and states, never tokens or user ids), and
  inspect state with the board's usual read-only tools: the user's
  `subscriptions` document (`provider: "google"`), `play_purchases` and the
  `billing_events` ledger (`google:<messageId>`). Scope every query by the test
  user.
- First send a **test notification** from Play Console (Monetisation setup,
  Real-time developer notifications). Expected: 200 in the push subscription's
  delivery log and a `billing_events` row of type `testNotification`. A 401
  means the OIDC audience or email does not match the subscription; a 503 means
  `PLAY_IAP_ENABLED` or the receiver auth is not set.

Each step lists what to do and what must be true afterwards. A failed
expectation is a defect: record the step, the `billing_events` result and the
`subscriptionState` Google returned, and stop.

## 1. Trial start

1. Open Settings, Your plan, choose Standard, monthly.
2. Expected: the picker shows the store's own price and a free-trial line
   whose length comes from Play (a few minutes for a licence tester, 14 days
   for a real user), not text from the app. The button says it starts a trial.
3. Buy it. Expected: the Play sheet shows the trial and "test card".
4. Expected after: `subscriptions.provider = "google"`, `status = "trialing"`,
   `tier = "standard"`, `billing_period = "monthly"`, `trial_ends_at` set,
   `play_purchases` has one row with `acknowledged_at` set, the Play order is
   acknowledged (Play Console, Order management, no "acknowledge by" warning), and
   Your plan shows Standard with the trial ending date.
5. Negative checks: the same Google account on a second Sorted user must be
   refused when it restores (`account_mismatch`), and a second trial on the
   same Google account is not offered by Play.

## 2. Accelerated renewal

1. Wait for the trial to end. Expected: `status` moves to `active`,
   `expires_at` advances by the accelerated period, a notification arrives
   (`SUBSCRIPTION_RENEWED`) and `play_purchases` still has ONE row for the token.
2. Repeat for two or three renewals. Expected: no duplicate documents, no second
   acknowledge call (`play billing` log shows no repeat), tier unchanged.

## 3. Cancel

1. Settings, Your plan, Manage in Google Play (opens the Play subscriptions
   page), cancel.
2. Expected: `cancel_at_period_end = true`, `status` stays `active`, access
   continues, Your plan says it will not renew. After the period ends:
   `status = "expired"` and the user lands on the Statements plan.

## 4. Restore

1. Clear the app's data (or reinstall), sign in as the same user.
2. Expected: Settings, Your plan, Restore purchases brings back the plan
   (`restored >= 1`), and pressing it again changes nothing (one
   `play_purchases` row, one `subscriptions` document).
3. Sign in as a different Sorted user on the same device and press Restore.
   Expected: nothing is attached to that user and no error detail is shown.

## 5. Upgrade and downgrade

As built (C13 section 9.5), the app does not buy a second subscription over a live
one.

1. With a live Standard plan, open the picker and choose Plus. Expected: the
   buy button is replaced by a pointer to Google Play; no Play sheet opens.
2. Change the plan in Google Play if the page offers it (or cancel and wait for
   expiry, then buy Plus). Expected: the new token names the old one in
   `linkedPurchaseToken`, the old `play_purchases` row gets `superseded_at`, the
   `subscriptions` document now shows Plus, and a late event for the old token
   changes nothing.
3. Record in the item note whether Play let the user switch products from its
   own page. If it did not, in-app upgrade needs the native follow-up in section 9.5.

## 6. Refund and revocation

1. In Play Console, Order management, refund and revoke the test subscription.
2. Expected: a `voidedPurchaseNotification` arrives, `status = "expired"`,
   `revoked = true`, `play_purchases.voided_at` set, the user is on Statements,
   and a later read of the order does not bring it back.
3. Buy a Penny pack (section 8 below), then refund it. Expected: the pack gets
   `refunded_at`; with `IAP_REFUND_CLAWBACK` off its `remaining` is unchanged,
   with it on `remaining = 0`; the `billing_events` row for the refund carries
   the user, pack and order, so "how many refunds has this user made" is a
   query.

## 7. Account hold and grace

Play lets a tester simulate a declined payment: in Play Console licence testing
set the test card response to "Test card, always declines", or use "Slow test
card, declines" for the next renewal.

1. Let a renewal decline. Expected: `status = "past_due"`, `grace_until` set,
   access continues, exactly one push ("Payment didn't go through", naming
   Google Play), and Your plan says the payment needs attention.
2. Let the grace period lapse (accelerated). Expected: `SUBSCRIPTION_ON_HOLD`,
   `status = "expired"`, user on Statements.
3. Fix the payment method in Google Play. Expected: `SUBSCRIPTION_RECOVERED`,
   `status = "active"`, access restored without re-buying.

## 8. Penny packs

1. Buy the 100-message pack. Expected: one `penny_topups` document with
   `messages = 100`, `provider = "google"`, `play_purchases` row with
   `granted_at` and `consumed_at`, and the same Play sheet can buy another
   pack straight away (a consumed token is reusable only as a new purchase).
2. Kill the app mid-purchase (after paying, before the verify call returns).
   Expected: reopening and pressing Restore grants the pack exactly once.

## 9. Stripe is unreachable

1. On the device, with billing live on the server, confirm there is no button
   or link to Stripe anywhere (picker, Penny packs, Your plan).
2. `curl` the checkout route with `X-Client-Platform: android`: expected 403
   `BILLING_NATIVE_BLOCKED` (B31 backstop).
3. With a live Stripe subscription on the account, expected: the picker says to
   manage the existing subscription and offers no Play purchase.

## 10. Result

Record pass or fail per step in the C24 board note, the Play order ids are not
needed. Disable `PLAY_ALLOW_TEST_PURCHASES` on production afterwards.

---

# Proposal for PRIVACY.md (for Kevin's approval, not applied)

PRIVACY.md has not been edited. Proposed changes, British English, no dashes:

**1. Sub-processor table (Section 7), replace the Google row:**

| Google | Sign-in, push notification delivery on Android, and processing of payments for subscriptions and Penny message packs bought in the Android app through Google Play |

**2. New paragraph under the table (or in Section 3, "What we collect"), as a payments note:**

> **Payments.** If you buy a plan or a Penny message pack in our Android app, Google Play takes the payment and is the seller of record. We never see your card or other payment details. Google tells us that a purchase happened, which product it was, its dates and whether it renewed, was cancelled or was refunded, together with a one-way identifier that links the purchase to your Sorted account (it is not your email address). We use this only to give you the plan or messages you bought and to keep your plan accurate. Google handles your payment details under its own privacy policy. If you buy on the web, Stripe takes the payment in the same way.

**3. Cross-checks for Kevin:** PRIVACY.md does not currently name Stripe as a payment processor at all, so the web sentence above would be new and should be agreed too. Apple's equivalent (App Store purchases, with `appAccountToken`) belongs in the same paragraph once C21 ships. The Data safety form in Play Console (C5) must declare "Purchase history" collected and shared with Google for the same purposes, and the legal PDFs must be regenerated after any change (`check:legal-pdfs-fresh`).
