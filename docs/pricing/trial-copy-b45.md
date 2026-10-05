# B45 trial and plan-ending copy: DRAFT for Kevin's approval

Status: draft, nothing here is live in TERMS.md or frontend/content/terms.md. Those files are untouched in this branch because the `check:legal-pdfs-fresh` gate fails if the markdown changes without regenerating the PDFs. On approval, a follow-up applies the wording to `TERMS.md`, `frontend/content/terms.md` and the PDFs together.

Copy rules applied: British English, no em dashes, no exclamation marks, the currency minus sign untouched, amber (never red) for a failed payment.

The in-app strings below already exist in `frontend/lib/billingCopy.ts` and the backend notification copy in `backend/app/services/billing_lifecycle.py`. They are the same words, so approving this page and changing those two files is the whole copy change.

## 1. TERMS.md change proposal

Replace the **Introductory trials** paragraph (currently line 112) with:

> **Introductory trials.** Every paid plan starts with a 14-day free trial. A card is required to start the trial, and we do not charge it during the trial. If you do not cancel before the trial ends, the trial converts automatically into the paid plan and billing period you chose, and we take the first payment on the date shown to you when you started. We will send you a reminder about three days before. If you cancel during the trial, you keep your plan until the 14 days end and are not charged. Each person can have one free trial.

Add after **Auto-renewal**:

> **If a payment fails.** If a renewal or first payment does not go through, we tell you and keep your plan active while our payment provider tries your card again. If the payment still cannot be taken, your paid plan ends and your account moves to the free Statements plan.

> **When a paid plan ends.** When a paid plan is cancelled, lapses, or a trial ends without converting, your account moves to the free Statements plan. Bank connections stop updating. Your existing accounts, transactions and history stay in your account for you to read, and you can resubscribe at any time to start syncing again. [Open decision for Kevin: whether we also withdraw your bank consent at that point. The build keeps the consent by default, so resubscribing needs no new bank authorisation, and withdrawing it is a single setting, `REVOKE_CONSENT_ON_DOWNGRADE`.]

Leave **Your right to cancel (cooling-off period)** as it is; the trial copy above is consistent with it.

## 2. B22 disclosure next to the trial control (plan picker)

Shown on the plan picker whenever a paid plan and period carry a trial the user is eligible for. It is a statement, not a switch.

- Heading: `14-day free trial`
- Terms line: `Then £9.99 every month. Card required, cancel any time.`
- Disclosure: `14 days free, then £9.99 on 19 Oct 2026, then £9.99 every month unless you cancel.`
- Cancel line: `Cancel any time before 19 Oct 2026 from Settings, Your plan, and you will not be charged. You keep your plan until the free days end.`
- Button: `Start 14-day free trial`

(Amount, date and renewal words come from the selected plan and period; the examples use Standard monthly.)

## 3. Notifications

- Trial ending (about three days before): title `Your free trial ends soon`, body `Your free trial ends on 19 October 2026. £9.99 will be charged then unless you cancel from Settings, Your plan.` Not sent if the user has already cancelled.
- Failed payment (once per episode): title `Payment didn't go through`, body `We couldn't take your latest payment. Update your card in Settings, Your plan, to keep your plan. You keep access for the next 7 days while we try again.` (the 7 comes from `BILLING_PAST_DUE_GRACE_DAYS`)

## 4. Settings, Your plan

- Trialing: `Standard trial, free until 19 Oct 2026`
- Cancelled, still inside the paid or trial period: `Standard plan. Ends on 19 Oct 2026`
- Past due notice (amber dot, ink text): `Payment didn't go through` / `We couldn't take your latest payment. Update your card to keep your plan. You keep access for the next 7 days while we try again.` Button: `Fix payment` (opens the Stripe customer portal).
- After a paid plan has ended: `Statements plan, free. Your paid plan has ended`

## 5. Paused accounts (Accounts screen)

Neutral strip with a pause glyph, not amber or red, because it is a plan state the user can fix and not a financial risk.

- Title: `Bank sync is paused`
- Body (one account): `Your connected account is no longer updating on the Statements plan. Everything already synced stays here to read. Resubscribe to start syncing again.`
- Body (several): `Your 3 connected accounts are no longer updating on the Statements plan. Everything already synced stays here to read. Resubscribe to start syncing again.`
- Action: `Resubscribe` (opens the plan picker in Settings)

## 6. Behaviour decisions this copy relies on

- Failed-payment grace is 7 days from the first failed payment (`BILLING_PAST_DUE_GRACE_DAYS`), bounded by Stripe's own retry schedule. The copy states the number, derived from that setting in the backend and from `grace_days` on `GET /subscription` in the app, so it cannot drift.
- Consent revocation default: off (consent kept). The TERMS bracket above must be resolved either way.
