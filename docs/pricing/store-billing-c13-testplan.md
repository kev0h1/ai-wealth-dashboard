# C21: iOS in-app purchase, TestFlight and sandbox test plan (for Kevin)

Companion to `store-billing-c13.md`. The unit tests prove the server logic
against a test certificate authority; they cannot prove that Apple's real
payloads, Apple's real signing chain and the StoreKit plugin on a real device
behave the same. This plan is that pass. It is yours because it needs your App
Store Connect login, your sandbox tester and a TestFlight build.

Nothing here asks you to buy anything real. Everything runs against the
sandbox environment, which charges nothing.

Items marked **(unverified)** are from general StoreKit knowledge, not a live
Apple page (the build session had no network access to Apple). If one is wrong,
say so on the board so the doc is corrected.

## 0. Two decisions this plan does not need

Prices are decided (store equals web, C24, 2026-10-17). The refunded-consumable
clawback is still open; the server runs with it off (`IAP_REFUND_CLAWBACK`
unset) until you decide. Nothing below depends on it, and the Penny pack buy
button is not wired in the app yet, so there is nothing consumable to test
end to end.

## 1. One-off setup

### 1.1 Create the products in App Store Connect

One subscription group, ranked highest first, with these 9 subscriptions and 3
consumables. **Use these exact product ids**, so no configuration is needed. If
you must use different ids, set `APPLE_PRODUCT_IDS` (see `docs/ops/ENV.md`).

Group reference name: `Sorted subscriptions`. Ranking (level 1 is highest):

| Level | Product id | Duration | GBP price |
|---|---|---|---|
| 1 | `sorted.plus.annual` | 1 year | £129.99 |
| 2 | `sorted.plus.six_months` | 6 months | £69.99 |
| 3 | `sorted.plus.monthly` | 1 month | £12.99 |
| 4 | `sorted.standard.annual` | 1 year | £99.99 |
| 5 | `sorted.standard.six_months` | 6 months | £53.99 |
| 6 | `sorted.standard.monthly` | 1 month | £9.99 |
| 7 | `sorted.lite.annual` | 1 year | £59.99 |
| 8 | `sorted.lite.six_months` | 6 months | £31.99 |
| 9 | `sorted.lite.monthly` | 1 month | £5.99 |

(How Apple treats a same-tier change of duration is unconfirmed, see section 10
of the main doc. This ordering is the proposed default.)

On **every** one of the nine subscriptions add an **introductory offer**: type
Free, duration 2 weeks, eligible to new subscribers, in every territory you
sell in. Set the display name to the tier name (for example "Lite") and the
description to one plain sentence.

Three consumables (no offer):

| Product id | Display name | GBP price |
|---|---|---|
| `sorted.penny.20` | 20 Penny messages | £0.99 |
| `sorted.penny.100` | 100 Penny messages | £2.99 |
| `sorted.penny.200` | 200 Penny messages | £4.99 |

Each price must exist on Apple's price-point grid. If one does not, stop and
tell the board which, rather than picking a neighbour. There is no Connect
product and no MCP pack.

### 1.2 Notifications URLs

App Store Connect, the app, App Information, App Store Server Notifications,
**Version 2** for both:

- Production URL: `https://wealth.auriqltd.co.uk/api/webhooks/apple`
- Sandbox URL: `https://uat.wealth.auriqltd.co.uk/api/webhooks/apple`

UAT is the sandbox target. (If `https://uat.wealth.auriqltd.co.uk/api/health`
works and `/api/webhooks/stripe` is how Stripe is registered there, the same
`/api` prefix is right for Apple.)

### 1.3 Pin Apple's root certificate (this cannot be skipped)

The repository ships none. Download **Apple Root CA - G3** from
https://www.apple.com/certificateauthority/, check its SHA-256 fingerprint
against the value shown on that page, and add it to
`backend/app/certs/apple_roots/` (see the README there) on the branch that
ships this. Until it is there every Apple payload is rejected and the receiver
answers 503. The security review of the verification code should confirm the
fingerprint of the committed file too.

### 1.4 Turn it on in UAT

In UAT's `backend/.env` set `APPLE_IAP_ENABLED=true`. Do not set
`APPLE_ALLOWED_ENVIRONMENTS` on UAT: its default there is Sandbox only, which
is what you want. Restart the API after the integrate pass (never from a
worktree).

Optional, once: normalise old subscription documents. Dry run first, then apply
if the counts look right (counts only, no user data is printed):

```
cd /root/ai-wealth-dashboard/backend
.venv/bin/python scripts/migrate_subscriptions_provider.py --env-file .env
.venv/bin/python scripts/migrate_subscriptions_provider.py --env-file .env --apply
```

It is not needed for correctness.

### 1.5 Get a TestFlight build

The StoreKit plugin (`@capgo/native-purchases` 8.9.6) is in `capacitor-spike`,
so a Codemagic `ios-capacitor` build (the UAT-pointing workflow, item C1) picks
it up. Install it from TestFlight on a real iPhone (iOS 15 or later).
The first build is where to check whether Xcode needs the "In-App Purchase"
capability added **(unverified)**; if the purchase sheet never appears, that is
the first thing to look at.

### 1.6 Sandbox Apple ID on the phone

Use your existing sandbox tester. On iOS 18 and later it is chosen in Settings,
App Store, Sandbox Account **(unverified)**; on earlier versions the purchase
sheet asks you to sign in. Use a UAT Sorted account that has **no** active
Stripe subscription, and write down which one: that is your test user.

### 1.7 Sandbox clock

Sandbox speeds renewals up. The commonly quoted mapping **(unverified)**:
3 days is 2 minutes, 1 week 3 minutes, 2 weeks 5 minutes, 1 month 5 minutes, 2
months 10, 3 months 15, 6 months 30, 1 year 1 hour. A sandbox subscription
renews only a handful of times (commonly six) and then stops. So the 2-week
trial should convert in about 5 minutes and a monthly plan renew every 5
minutes after that.

## 2. How to look at what happened (read only)

Everything below is a read. None of it changes data.

- In the app: Settings, Your plan.
- The subscription document for your test user (replace the address):

```
mongosh wealth --quiet --eval 'db.subscriptions.find({user_id:"YOUR-TEST-USER@example.com"}).forEach(d=>printjson({provider:d.provider,tier:d.tier,status:d.status,billing_period:d.billing_period,expires_at:d.expires_at,trial_ends_at:d.trial_ends_at,cancel_at_period_end:d.cancel_at_period_end,env:d.apple_environment,last_signed_at:d.last_signed_at}))'
```

- The last notifications Apple sent, newest first (no user data in these rows
  except `result.uid`):

```
mongosh wealth --quiet --eval 'db.billing_events.find({provider:"apple"}).sort({received_at:-1}).limit(10).forEach(d=>printjson({type:d.type,subtype:d.subtype,received_at:d.received_at,handled:d.result&&d.result.handled,reason:d.result&&d.result.reason}))'
```

- The API log for rejections: `journalctl -u wealth-api -n 100 | grep "apple "`.
  A rejection names the stage that failed ("leaf certificate lacks the App Store
  marker", "chain does not lead to a pinned root", "environment not accepted
  by this deployment"), never payload contents.

## 3. The script

For each step: do it, then check the "expect" line. Stop at the first failure,
copy the matching log line and the document, and put both on the board.

**T0. Receiver wiring.** Before touching the phone, in App Store Connect send a
test notification (the App Store Server API "Request a Test Notification"
endpoint, or the button where Apple offers one). Expect: an `apple` row of type
`TEST` appears in `billing_events` within a minute, `handled: false`, reason
"test notification". This proves the root pin, the chain and the URL. If
nothing arrives, check the URL; if the log says "no pinned root" or "does not
lead to a pinned root", section 1.3 is not done.

**T1. The picker.** Settings, Your plan, See plans, choose Lite, then Monthly.
Expect: prices read from the App Store (£5.99), a line saying "2 weeks free"
(the length comes from the store, not the app), a "Start 2 weeks free trial"
button, a "Restore purchases" button, and no sentence saying paid plans are
unavailable. If you see "Loading plans" for more than a few seconds or "Paid
plans are not available yet", the products are not loading: check the product
ids and that the products are "Ready to Submit".

**T2. Trial start.** Tap Start. Complete the system purchase sheet with the
sandbox account. Expect: the picker closes; Your plan reads "Lite trial, free
until ..."; the subscription document has `provider: apple`, `status:
trialing`, `trial_ends_at` about 5 minutes ahead, `env: Sandbox`; a `SUBSCRIBED`
(or `OFFER_REDEEMED`) row in `billing_events`. Home should no longer treat the
account as the free plan (bank sync allowed, if you have a bank connected).

**T3. Conversion and renewal.** Leave the app alone for 6 minutes, then reopen
Your plan. Expect: status `active` (a `DID_RENEW` row, `trial_ends_at` empty),
`expires_at` moved forward by about 5 minutes; a further `DID_RENEW` about 5
minutes later.

**T4. Cancel.** From the app, Your plan, See plans, "Manage plan and renewal"
(opens iOS's subscription sheet), cancel. Expect: a `DID_CHANGE_RENEWAL_STATUS`
row; `cancel_at_period_end: true`; Your plan reads "Ends on ...". You keep the
plan until `expires_at`. After it passes, expect an `EXPIRED` row, status
`expired`, Your plan reading free, "Your paid plan has ended", and bank sync
paused. No push about "Settings, Your plan" should have been sent.

**T5. Resubscribe.** Choose Lite again. Expect: **no** free-trial line this
time (the store no longer offers this Apple ID the introductory offer), the
price line reads "£5.99 every month unless you cancel", and the button reads
"Choose Lite". If it still promises a free trial, that is a defect: note
`introEligibility` from the plugin if you can.

**T6. Restore.** Delete the app and reinstall from TestFlight, sign in as the
same Sorted user, open Your plan, tap Restore purchases. Expect: "Your plan has
been restored" (or "no purchases to restore" if the plan had lapsed) and the
right status; tapping it again changes nothing. Then sign in as a **different**
Sorted user on the same phone and tap Restore. Expect: "There were no purchases
to restore", and that other user has no `apple` document.

**T7. Change plan.** With an active plan, Manage plan and renewal, switch to a
higher tier in the system sheet. Expect (upgrade): a `DID_CHANGE_RENEWAL_PREF`
row with subtype `UPGRADE`, the document's `tier` changes straight away. Switch
down: no change until the next renewal, then a `DID_RENEW` with the lower tier.
Also try a same-tier change of duration and write down what Apple did (upgrade,
downgrade or crossgrade): the main doc needs that answer (section 3).

**T8. Failed renewal (if you can force one).** Sandbox testers cannot easily
fail a payment. Skip if so, and say so: the unit tests cover it.

**T9. Refund.** Apple does not obviously offer a way to refund a sandbox
purchase **(unverified)**. Try reportaproblem.apple.com with the sandbox
account against the sandbox purchase. If a refund goes through, expect a
`REFUND` row, status `expired` at once (even though `expires_at` is in the
future), and Your plan reading free. If Apple offers no way, record that: the
`REFUND` and `REVOKE` paths are then covered by the unit tests only, and a first
real refund in production is the first live exercise. Do not refund a real
purchase to test this.

**T10. Never pay twice.** On a different test user, start a web Stripe test
subscription first (UAT test mode, card 4242 4242 4242 4242), then open the
iOS app as that user. Expect: no StoreKit buy button for them; the picker shows
the browser pointer for managing the web plan. (The server also reports
`purchase_allowed: false`.)

**T11. Forgeries.** From any machine:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://uat.wealth.auriqltd.co.uk/api/webhooks/apple -H 'content-type: application/json' -d '{"signedPayload":"not-a-jws"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://uat.wealth.auriqltd.co.uk/api/webhooks/apple -d 'garbage'
```

Expect `400` for both with the receiver switched on and the root pinned, and
`503` with it off. Never `500`.

**T12. The offer comes from the store.** Optional. In App Store Connect change
the introductory offer on one product to 1 week, wait for it to propagate, and
open the picker on a fresh sandbox account. Expect the line to say "1 week free"
with no code change.

## 4. What to report back

For each of T0 to T12: pass, fail, or not possible, plus for any failure the
log line and the document. Also report: what Apple did on the same-tier
duration change (T7), whether Xcode needed the In-App Purchase capability
(1.5), whether the marker-OID check ever fired (it names itself in the log),
and the iOS version and sandbox mapping you actually saw (1.7). Those settle
the **(unverified)** items in the main doc's section 10.

## 5. Open after this

- The Penny pack buy buttons (More messages, connected assistants) still read
  "Not available in this app" on iOS. The server side is ready.
- The refunded-consumable clawback is Kevin's decision (`IAP_REFUND_CLAWBACK`).
- Android is C24.
