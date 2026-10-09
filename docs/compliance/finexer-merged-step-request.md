# Draft request to Finexer: merged consent step (A159)

For Kevin to review and send. Not sent. The change is built behind a flag that stays off until Finexer replies.

**To:** Finexer LTD compliance contact
**Subject:** AURIQ LTD: change to our pre-consent screen, written view needed (Client Terms A4.2, 7.5, A6.2)

## 1. The change

Today a user who adds a bank in Sorted taps a bank, then reaches a Sorted screen titled "Review your connection" that shows the A4.1 agency sentence in full and a "Continue to Finexer" button. After that they see Finexer's hosted permissions page and End User Terms.

We propose to remove Sorted's own review screen. Instead:

- The bank list shows one summary line: "Read-only access, no payments. Tap a bank to review permissions and terms with Finexer, then approve with your bank."
- Under it sits one pinned line, "AURIQ LTD acts as an agent of Finexer LTD, FCA authorised". Tapping it expands it in place (it is a real button with a 44px target) to the A4.1 sentence, verbatim and in full: "AURIQ LTD is acting as an agent of Finexer LTD, which is authorised by the Financial Conduct Authority under the Payment Services Regulations 2017, firm reference number 925695, as an Authorised Payment Institution to provide account information services and payment initiation services."
- Tapping a bank hands the user straight to Finexer.
- Finexer's hosted permissions page and End User Terms are unchanged. Nothing in the hosted pages is skipped or altered.

The user therefore has three taps before their bank's own page instead of four. The A4.1 sentence is also unchanged in our Terms, on our website, and on the page users return to.

## 2. The questions

1. Clause A4.2 requires the A4.1 disclosure "in the consent journey". Does a collapsed line that the user can expand in place to the verbatim A4.1 sentence satisfy A4.2, given that the full sentence is not displayed by default? If not, what would you accept (for example, the full sentence shown by default under the list)?
2. Does this change to our pre-consent screen need your written approval under clause 7.5 or A6.2 before it goes live?

## 3. Screenshots (390 by 844, production component, flag forced on for the capture)

Folder: `docs/compliance/finexer-merged-step-request/`

- `light-collapsed.png`, `light-expanded.png`
- `dark-collapsed.png`, `dark-expanded.png`

## 4. Rollout control

The merged step is behind the build-time flag `NEXT_PUBLIC_CONSENT_MERGED_STEP` (read in `frontend/lib/featureFlags.ts` as `CONSENT_MERGED_STEP`). It is off by default, in production and on UAT, so the current four-tap flow with the full sentence on Sorted's review screen stays live. We will not turn it on until you have replied in writing. We will say AURIQ LTD is an agent of Finexer LTD and never describe AURIQ LTD as an appointed representative or tied agent, or as FCA authorised itself.

Kind regards,
Kevin Maingi
AURIQ LTD
info@auriqltd.co.uk
