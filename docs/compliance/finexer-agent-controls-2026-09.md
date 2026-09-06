# Finexer Agent Management and Controls Compliance, draft answers

Drafted 2026-09-06 from the codebase, SECURITY.md, PRIVACY.md and TERMS.md. Items marked [KEVIN] need a decision or a fact only the directors hold. Each answer block must stay under 2000 characters. Answers that say "production" are only true once the current branch is deployed to Vercel and Railway; see "Prerequisites" at the end.

## Q1 Start date

```text
2026-10-01
```

## Q2 Material changes since onboarding

```text
There have been no changes to the business model, ownership, management, target customer base or the AIS-only use of Finexer since onboarding due diligence and the FCA agent application. AURIQ LTD remains founder-operated with the same director(s), serving UK consumers with a personal money management service, with Finexer as the sole open banking provider for UK accounts.

Developments since onboarding:
1. Distribution: the web application at wealth.auriqltd.co.uk is also packaged as iOS and Android apps (identifier co.uk.auriqltd.sorted), calling the same production backend. No new callback or webhook endpoints.
2. Sign in with Apple added alongside Google sign-in, as Apple requires for App Store distribution. Identity only; no additional personal data is collected.
3. Subscription tiers are defined in the product but no payment processing is enabled. Bank connection and the account information service remain free of charge.
4. Planned, not live: a "connected assistant" feature (an MCP connector, which we discussed with Finexer, who indicated they were open to it). A customer may authorise their own AI assistant, for example Claude or ChatGPT, to read their Sorted data. It is read-only, granted by the customer through an explicit OAuth consent with named scopes, revocable at any time from Settings, and every request is logged and visible to the customer. Responses never include account numbers, sort codes, IBANs, card numbers or provider identifiers. No payment, transfer or data-changing capability is exposed. The AIS arrangement is unchanged: Sorted retrieves account information under Finexer's authorisation and displays or passes it only to the customer or to a recipient the customer nominates. Target: after production approval; we will provide the final design and the privacy policy wording to Finexer before launch.
[KEVIN: add the date of the MCP discussion with Finexer; confirm Penny agent mode will not be live before 1 October.]
```

## Q3 AIS only

```text
Confirmed. Auriq Ltd's use of Finexer is limited exclusively to Account Information Services. No payment initiation functionality has been introduced, and none will be introduced without Finexer's prior written approval. The application holds no client money, initiates no payments, and provides no funds-transfer capability. Our contracted product under Schedule B is AIS only at £450/month.
```

## Q4 Production website and app details, callback and webhook URLs

```text
Production service name: Sorted (by AURIQ LTD).

Web application (production): https://wealth.auriqltd.co.uk
API: https://wealth.auriqltd.co.uk/api (reverse-proxied to our hosted backend)

Mobile applications: the iOS and Android apps are the same production web application packaged in a native shell and call the same production API above. No separate backend, callback or webhook endpoints exist for mobile.
- iOS: App Store Connect record "Sorted by Auriq", bundle ID co.uk.auriqltd.sorted, Apple ID 6809018846, store URL https://apps.apple.com/gb/app/id6809018846
- Android: Google Play package co.uk.auriqltd.sorted, store URL https://play.google.com/store/apps/details?id=co.uk.auriqltd.sorted
Initial mobile distribution is to an invited audience via TestFlight and Google Play closed testing before public listing.

Finexer production URLs (final):
- Consent return URL: https://wealth.auriqltd.co.uk/auth/finexer/callback
- Webhook receiver: https://wealth.auriqltd.co.uk/api/webhooks/finexer/<secret path segment as registered in the Finexer dashboard>

We confirm these URLs are final, are used solely by the Sorted service operated by AURIQ LTD, and that no other application, brand or third party uses our Finexer credentials. Our UAT environment at uat.wealth.auriqltd.co.uk uses sandbox credentials only and has no production access.
```

## Q5 Customer journey evidence

```text
Attached: screen recording "sorted-finexer-journey.mp4" and numbered screenshots 01 to 09, captured on the production web application at https://wealth.auriqltd.co.uk. [KEVIN: capture after the production deploy; frames listed below.]

01 Sign-in screen (Google or Apple), with links to Terms and Privacy Policy.
02 Settings, "Where money can come from": the Connect a bank action.
03 Bank picker.
04 Finexer hosted consent page (AIS consent, scope and duration shown to the customer).
05 Bank's own authentication and account selection (customer authorises directly with the bank; Sorted never sees credentials).
06 Return to Sorted: "Bank connected" confirmation, transactions syncing.
07 Accounts and transactions as displayed in Sorted (Home safe-to-spend figure, Accounts list, Transactions list with categories).
08 Settings: Disconnect a bank. Disconnecting revokes the consent with Finexer via the API and deletes that connection's accounts and transactions.
09 Settings: Delete account and all data, with the confirmation dialog, which erases all records and revokes all consents.

Consent withdrawal initiated at the bank or via Finexer is received by our webhook receiver; the connection is marked revoked, no further data is retrieved, and the customer is prompted to reconnect or disconnect.
```

## Q6 Regulatory disclosures

```text
Attached screenshots:
A. Terms and Conditions, section 2 "Regulatory status" at https://wealth.auriqltd.co.uk/terms: states that AURIQ LTD is not authorised by the FCA in its own right, that account information services are provided through Finexer LTD, an FCA-authorised firm, and that AURIQ LTD acts as a registered agent of Finexer LTD, with a pointer to the FCA Financial Services Register.
B. Privacy Policy, section 1 "Our regulated status" at https://wealth.auriqltd.co.uk/privacy: same disclosure, and section 4 describing the open banking consent through Finexer.
C. In-app bank connection step: the disclosure line shown immediately before the customer is sent to the Finexer consent page. [KEVIN: this line does not exist in the app yet; approve adding "Account information is provided by Finexer LTD, authorised by the FCA. AURIQ LTD acts as Finexer's agent." to the connect-bank sheet and the sign-in footer, then capture it.]

[KEVIN: the FRN field on this form is blank. The published wording says "registered agent" in the present tense. Confirm with Finexer that the agent registration will appear on the register before go-live, or agree interim wording such as "AURIQ LTD has applied to be registered as an agent of Finexer LTD; the account information service is provided under Finexer LTD's authorisation."]
```

## Q7 Terms and Privacy Policy

```text
Final published versions:
- Terms and Conditions: https://wealth.auriqltd.co.uk/terms
- Privacy Policy: https://wealth.auriqltd.co.uk/privacy
PDF copies attached. [KEVIN: export from the site after deploy.]

We confirm they accurately reflect the Sorted service:
- Finexer's role and the AIS arrangement: Terms sections 2 and 5; Privacy sections 1, 4 and 6 (Finexer listed as the open banking sub-processor).
- AI and sub-processor processing: Privacy section 5 (what is sent to the AI gateway, what is never sent, no training on customer data) and section 6 (full sub-processor table: MongoDB Atlas, Railway, Vercel, Cloudflare R2, GitHub, OpenRouter and its underlying model providers, Google, Apple).
- International transfers: Privacy section 7 (EU hosting under UK adequacy; US AI processing under the UK IDTA or Addendum).
- Retention and deletion: Privacy sections 8 and 9 (30-day deletion after closure, withdrawal or disconnection; 12-month dormant account deletion; 7-day chat retention; 30-day caches, webhook logs and encrypted backups), mirrored in our Security and Incident Response Policy section 6.
- Complaints: Terms section 16.

Two updates are being made before submission: the Privacy Policy's account-details paragraph will name Sign in with Apple alongside Google, and Apple will be listed as an identity provider in the sub-processor table. [KEVIN: confirm and deploy.]
```

## Q8 Scope of AI functionality

```text
Confirmed. The AI-assisted coaching, budgeting, debt-payoff and savings functionality remains as described at onboarding and has not expanded into personalised recommendations for specific investments, financial products, lenders, debt solutions or any other regulated products or services.

How this is enforced in the product:
- The assistant ("Penny") operates under a hard rule that it never names or recommends a specific financial product or provider. Verdicts such as "can I afford this" are computed deterministically from the customer's own data; the model only phrases the explanation.
- Savings insights are generated under fixed rules: no suggestion to move card debt, third-party predictions always hedged, all savings figures presented as estimates. A post-processing guard rejects any output that breaches them.
- Debt payoff shows the customer's own repayment order and timelines from their existing accounts; it does not propose consolidation, balance transfers, lenders or debt solutions.
- Investment holdings can be tracked as a category; the product offers no investment recommendations, comparisons or execution.
- Tax content is limited to general explanation of UK rules; no product or scheme is recommended. [KEVIN: we intend to tighten the tax explainer's prompt before go-live so it cannot discuss specific investment schemes; confirm.]
```

## Q9 AI and third-party processing

```text
Confirmed; the arrangements are as described at onboarding, with the additions below.

Data shared with the AI gateway (OpenRouter, routing to Amazon Bedrock, Google, Anthropic or Microsoft Azure): merchant name, a truncated transaction description, amount and direction, and the customer's first name (only to recognise their own name in transfer descriptions). For the in-app assistant: the customer's question plus the derived figures needed to answer it.

Never shared with AI providers: account numbers, sort codes, IBANs, card numbers, bank access or refresh tokens, Finexer consent or customer identifiers, credentials, email addresses, dates of birth or addresses.

No training: every request carries a routing preference of "data collection: deny", restricting routing to providers whose terms exclude retention and training on submitted content.

International transfers: hosting is in the EU (Railway EU West, MongoDB Atlas Frankfurt) under UK adequacy; US processing by AI providers is under the UK IDTA or Addendum, as stated in Privacy Policy section 7.

Changes since onboarding: (1) Sign in with Apple; Apple receives only the sign-in event and we receive a verified email or Apple relay address. (2) Apple and Google push services carry only a device token and notification text, never transaction data. (3) Planned, not live: the connected assistant feature described in Q2. The customer's chosen AI provider then receives account information at the customer's own instruction, under the customer's contract with that provider; it is not a sub-processor of ours. Sharing is limited to what the assistant requests through named read-only scopes, identifiers are masked, calls are rate-limited and logged, and access can be revoked at any time. The Privacy Policy will gain a section "AI assistants you connect" before launch.
[KEVIN: confirm nothing else changed in the list given at onboarding.]
```

## Q10 Retention, deletion and consent withdrawal

```text
Confirmed; the following controls are implemented and operational in production. [KEVIN: true only after the production deploy.]

Customer deletion: "Delete account and all data" in Settings erases the customer's records across every data store in one operation (accounts, transactions, consents, preferences, plans, insights, push tokens, linked sign-in identities) and revokes all open banking consents with Finexer.

Bank disconnection: removes that connection's accounts and transactions and revokes the consent with Finexer through the API.

Consent withdrawal at the bank or via Finexer: received by our signed webhook receiver; the connection is marked revoked, no further data is retrieved, and the customer is informed in-app.

Retention: account and transaction data deleted within 30 days of closure, withdrawal or disconnection; encrypted bank tokens deleted immediately on disconnect; AI chat sessions 7 days; insight caches and webhook logs 30 days (automatic TTL); encrypted nightly database backups on a 30-day rolling window; dormant accounts deleted after 12 months. [KEVIN: the automated purge for dormant accounts and the 30-day post-closure sweep is still listed as "to be implemented" in our policy; either ship it before go-live or change this sentence to say the sweep is performed manually on a monthly cycle.]
```

## Q11 Security and incident controls, testing

```text
Confirmed; the controls in our Security and Incident Response Policy are implemented in production: bank tokens encrypted at rest (AES via Fernet) with the key held only in platform secrets; all secrets outside source control; signed, time-limited session tokens verified on every request; sign-in only via verified Google or Apple identities, with registration restricted to an allow list until launch; TLS in transit; restricted CORS; rate limiting on authentication and webhook routes; HMAC signature verification on Finexer webhooks; API documentation and introspection disabled in production; MongoDB Atlas with network access controls; encrypted nightly backups with 30-day retention; platform logging on Vercel, Railway and Atlas.

Testing completed prior to launch:
- Automated backend test suite of over 1,150 tests run on every change, including tests for the webhook signature verification, sign-in gating and safe-to-spend hardening.
- Internal security review of authentication, session handling, data hygiene on logout, and the webhook receiver (August and September 2026).
- Dependency vulnerability audit of backend and frontend packages. [KEVIN: to be run and dated before submission.]
- No independent penetration test has been commissioned at this stage. [KEVIN: decide whether to commission one; Finexer may expect it.]

Outstanding findings: none rated Critical or High. Two Medium items identified in internal review were closed before submission: a client-side cache holding account details after logout, and a legacy login path removed from the codebase. [KEVIN: both must actually be closed first; the legacy PIN login and the localStorage account-number item are still open as of 2026-09-06.]
```

## Q12 Insurance

```text
[KEVIN: attach the policy schedules and complete.]
Professional Indemnity: insurer ____, policy number ____, period ____ to ____, limit of indemnity £____ per claim.
Cyber: insurer ____, policy number ____, period ____ to ____, limit £____, including privacy and data-breach cover (notification costs, regulatory defence, third-party liability) and business interruption.
```

## Q13 Complaints, continuity, incident reporting

```text
Confirmed.

Complaints: published in Terms section 16. Complaints to kevin.maingi@auriqltd.co.uk are acknowledged within 3 business days and resolved within 8 weeks, with a written final response; complaints relating to the account information service are also notified to Finexer. [KEVIN: confirm the Finexer notification step and whether FOS signposting applies.]

Business continuity and disaster recovery: the service runs on managed platforms (Vercel, Railway, MongoDB Atlas) with provider-level redundancy; encrypted database backups are taken nightly to Cloudflare R2 and retained for 30 days; the application is redeployable from source control in under one hour; restore has been tested on ____. [KEVIN: date of the last restore test, or run one.] Loss of the token-encryption key is treated as a Critical incident and would require customers to reconnect their banks.

Regulatory incident reporting: our policy requires that any breach of our systems, non-compliance, suspected money-laundering or other relevant incident is reported to Finexer as soon as practicable and within 24 hours of becoming aware, with ICO notification within 72 hours where a personal-data breach meets the threshold, and affected customers notified without undue delay where high risk exists. The Information Security Manager (Kevin Maingi) owns this process.

There are no other material regulatory, security or operational matters to bring to Finexer's attention. [KEVIN: if the FRN is still pending, or if any earlier issue was disclosed to Finexer, mention it here.]
```

## Prerequisites before submitting

1. Deploy the current branch to production (Vercel frontend and both Railway services). Production today returns 404 for /terms and /privacy, still serves the API docs, and has no Finexer webhook receiver.
2. Close the two open security items (legacy PIN login in source; account number and sort code held in localStorage) and run a dependency audit.
3. Decide the FRN wording and add the in-app agent disclosure line.
4. Update the Privacy Policy for Sign in with Apple, and TERMS.md/PRIVACY.md at the repo root must stay in sync with frontend/content.
5. Create the Play Console record so the Q4 Play URL exists.
6. Capture the Q5 recording and Q6 screenshots on production.
7. Insurance documents (Q12), restore test date and complaints details (Q13).
