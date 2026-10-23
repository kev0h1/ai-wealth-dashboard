# Data protection impact assessment: DRAFT for Kevin and the specialist

Status: DRAFT (board item A165, feeds A166). Written 2026-10-17 against `main` at commit 70aedcf8; `G283:` references are to the local branch `feature-G283-no-savings-claims` (not merged at the time of writing). It records facts, risks, safeguards and gaps. It reaches no conclusion on lawful basis, whether a DPIA is required, whether any data is special category data, or whether any processing is acceptable. Kevin and the specialist own those conclusions. Companion document: `docs/compliance/perimeter-map.md`.

Conventions: every code claim carries `path:line` (commit 70aedcf8). "Unverified" means I could not confirm it in the code or a repository document in this pass. No real user data was read. Sources: `PRIVACY.md` (version 1.1, 2026-09-23), `SECURITY.md`, `TERMS.md`, `ENGINE.md`, `BEHAVIOURS.md`, `PENNY_TOOLS.md`, `docs/ops/OBSERVABILITY.md`, `docs/pricing/store-billing-c13.md`.

## 1. The controller, scope and data flow

- Controller: AURIQ LTD, company number 16813875, ICO registration ZC214737, trading as "Sorted" (PRIVACY.md:17-19, section 1). Contact info@auriqltd.co.uk.
- Service: an account information service (AIS) dashboard; bank data is read through Finexer LTD (FCA firm reference 925695), with AURIQ LTD as its registered agent (PRIVACY.md section 4). Sorted never initiates payments (PRIVACY.md:21).
- Users: UK residents aged 18 or over (PRIVACY.md section 14).
- Data flow in one line: bank data (via Finexer) and user uploads and entries go to MongoDB Atlas (EU, Frankfurt); the Railway API (EU West) computes deterministic figures; a small set of fields goes to OpenRouter (and on to a model provider) for categorisation, tip wording, Penny chat and statement parsing; Tavily and shared research receive no user data by design (see 2.4); Sentry receives scrubbed error events only when a DSN is set.
- Existing documents: PRIVACY.md lists the sub-processors at section 7 and retention at section 9; SECURITY.md section 6 holds the retention table (marked DRAFT with `[CONFIRM]` periods, SECURITY.md:381) and section 7 the UK GDPR principles. SECURITY.md also says the customer-facing privacy notice "is NOT yet published as a customer-facing page" (SECURITY.md:424), but the app has a `/privacy` route (`frontend/app/privacy`) and PRIVACY.md is dated 2026-09-23; the SECURITY.md statement looks stale (unverified which is current).

## 2. Processing activities assessed

For each activity: purpose; data; lawful-basis OPTIONS (not a choice; the specialist chooses and documents); necessity and proportionality; risks; mitigations with path:line; retention; recipients; residual risk and gaps.

### 2.1 Behaviour profiling: Mirror traits, aims and paradox lines

- Purpose: show the user a portrait of their own money behaviour, offer to coach on traits they choose to change, and run aims (pace checks) on categories. Deterministic, no model call found: `backend/app/services/behaviour.py` and `backend/app/routers/behaviour.py` contain no openrouter, llm or narration call (grep), and the trait narrative is a fixed template string (`behaviour.py:263`, `:295`).
- Data used: the user's transactions and account types over the history window; outputs stored in `behaviour_portraits` (`backend/app/routers/behaviour.py:52`, one document per user, cached up to 7 days, `behaviour.py` router lines 24-36) with the user's "keep" or "change" choice per trait (`/mirror/choice`, router lines 61-76); aims in `checkpoints` and `category_intents` (`backend/app/services/checkpoints.py:1-45`).
- Traits computed (BEHAVIOURS.md:29-47): payday-cliff or front-loader concentration, credit-switch timing, saving habit, orchestration, signature "pleasure" category, payment hygiene including BNPL, gambling and returned-payment counts.
- Lawful-basis options for the specialist: contract (the Mirror as part of the service, UK GDPR Art 6(1)(b)), legitimate interests (Art 6(1)(f), needs a balancing test), consent (Art 6(1)(a), the app already asks the user to keep or change each trait). Question: is profiling of this kind for the user's own benefit, shown only to the user, treated differently from profiling for third parties? Question: is any of it "solely automated decision-making with legal or similarly significant effects" (Art 22)? The portrait makes no decision about the user; nothing in the code I read blocks or grants a service from a trait (unverified for every consumer of `behaviour_portrait_col`; the checkpoints and paradox code read `traits` choices, `checkpoints.py:361-416`).
- Necessity and proportionality: the traits are derived from data the user already connected; every trait carries its own evidence lines shown with it (`behaviour.py:258-262`, evidence lists); traits are suppressed when data is thin (BEHAVIOURS.md:144); doc-versus-code note: BEHAVIOURS.md:45 says "AI narrates the portrait from computed facts", but the code uses fixed template narratives and no model call was found.
- Risks: (a) a profile the user did not expect or may find intrusive; (b) a profile that is wrong (misclassified transactions) shown as "who you are"; (c) the hygiene trait counts "gambling transaction(s)" and BNPL (`behaviour.py:484-485`), see 2.2; (d) the stored portrait is more sensitive than the underlying transactions because it is a judgement.
- Mitigations: the Consent Rule, Redirect Rule, One Paradox Rule and "The Mirror Is Not A Score" (BEHAVIOURS.md:98-110); "keep" is honoured and never nagged (`frontend/app/mirror/MirrorPage.tsx:42`); the paradox line shows only for a user who chose "change" and only for single periods (`frontend/components/PaySplitBeyond.tsx:77-79`); aims "never block and never judge" (`checkpoints.py` comment, lines 70-72); user can delete the account, which erases the portrait (portrait and checkpoints are in `ERASURE_MANIFEST`, `backend/app/db/collections.py:547-551`; erase loop `backend/app/services/retention.py:132-134`).
- Retention: no TTL on `behaviour_portraits` (the TTL index list in `backend/app/main.py:400-564` has no entry for it); it lives until account erasure or dormant-account deletion after 12 months (`retention.py:40`, `_DORMANT_AFTER`). PRIVACY.md section 9 has no row for the portrait, aims or Mirror choices (gap).
- Recipients: none beyond MongoDB Atlas and Railway; no model call found.
- Residual risk and gaps: PRIVACY.md does not describe Mirror profiling, aims or the keep/change choices (gap); retention for them is implicit (account lifetime). A DPIA outcome on whether the Mirror needs explicit notice is for the specialist.

### 2.2 Inferences that may reveal special-category or sensitive data

- Purpose of the data point: categorisation of spending and the hygiene trait.
- What the code infers or stores:
  - Gambling: a regex of named bookmakers and a reserved category name, `backend/app/services/behaviour.py:28-43` (`_GAMBLING_CATEGORIES`, `_GAMBLING_RE`), producing the visible evidence line "{n} gambling transaction(s) in the window" on the Mirror's hygiene trait (`behaviour.py:485`). "Gambling" is a reserved category name (`backend/app/services/categories.py:171`), so it matches mainly legacy data and the description regex.
  - BNPL and returned payments: `behaviour.py:25-26`, `:463-464`, `:483-486`.
  - Health: built-in "Health" category covers pharmacies, gyms, dentists, "nhs", "doctor", "hospi..." (`backend/app/services/categorisation.py:139`, and the LLM instruction "Health: hospitals, pharmacies, gyms, dentists, medical services" at `categorisation.py:1584`).
  - Charity: built-in category "Charity" (`categorisation.py:41`) classed Free (G280, `categories.py:121`); donation destinations can therefore appear as merchant names in the user's data and in the category. Religion and trade-union categories: none built in (grep of `categorisation.py` and `categories.py` finds no church, mosque, union or party rules). A user could still create a custom category with any name (custom categories exist; `categories.py` comments on custom names).
  - The LLM categoriser receives merchant name, a truncated description, amount, direction and the user's name (PRIVACY.md section 5, bullet "What we send"), so a merchant that reveals religion, health or union membership could pass to the model provider (inference by merchant name, not by a dedicated label).
- Statement in PRIVACY.md:35 (section 2, last paragraph): "We do not collect special category data (such as health or biometric data) as part of the service." Question for the specialist: is that statement accurate given the inferences above, and does gambling, health or charity merchant data, or a Mirror trait derived from them, need to be treated as special category data or as sensitive for another reason (financial vulnerability)? If treated as special category, which Art 9 condition (for example explicit consent, Art 9(2)(a)) would apply, and what would the user see? I record the question; I do not answer it.
- Necessity and proportionality: categories exist so the user can see where money goes (the core service); the gambling and BNPL counts are shown only to the user as hygiene evidence. Question: is displaying a gambling count necessary for the service, or should the hygiene trait drop it?
- Risks: disclosure to someone with access to the user's phone or app; incorrect inference (a merchant name resembling a bookmaker, mitigated by word boundaries, `behaviour.py:38-43`); model provider sees merchant names (sub-processor); Mirror evidence is more prominent than a raw transaction row; Penny can speak any of this in chat.
- Mitigations: word-boundary gambling regex (`behaviour.py:38-43`); hide-balances preference masks amounts (CLAUDE.md surface map; privacy lock in native apps, pentest items A121); data stays in the EU database; account deletion erases; no sale or advertising use (PRIVACY.md section 7).
- Retention: transactions per PRIVACY.md section 9 (deleted within 30 days of account closure, consent withdrawal or disconnection; dormant after 12 months).
- Residual risk and gaps: the "no special category data" statement may need review; no feature to switch off the hygiene trait or the gambling line (unverified: not found in `behaviour.py` or the Mirror page). Penny (the chat) can answer questions about categories and merchants without a sensitive-category filter (unverified; PENNY_TOOLS.md describes tool scopes).

### 2.3 Penny conversations stored (G248)

- Purpose: let the user resume a chat; keep up to the last 10 conversations, each capped at 30 turns (one turn is one message, so 15 question and answer pairs), each turn text capped at 2,000 characters (`backend/app/services/penny_conversations.py:34-38`).
- Data: conversation text and references to the transactions each answer showed (PRIVACY.md section 5 and 9 rows).
- Lawful-basis options: contract (the assistant is part of the service), legitimate interests, consent (the user starts the chat). Question: is a user-visible delete control and the 7-day period sufficient for transparency and minimisation?
- Retention: 7 days after the last message, by TTL index `PENNY_CONVERSATION_RETENTION_SECONDS = 7 * 24 * 3600` (`penny_conversations.py:39-41`; index created at `backend/app/main.py:436-440`); the user can delete a chat or all history in the app; the collection is in the erasure manifest (`db/collections.py:551`). Kevin approved the PRIVACY.md wording and the 7-day period (G248 note, TODO.md, 2026-10-09). The older `chat_sessions` collection also has a 7-day TTL (`main.py:400`).
- Risks: free text may include anything the user types (including special-category content); the conversation is also sent to the model provider to generate each reply; retained text is a copy of financial discussion for 7 days.
- Mitigations: TTL, caps, user deletion, `data_collection: deny` routing preference (`backend/app/core/config.py:34`).
- Recipients: OpenRouter and the underlying model provider (PRIVACY.md section 5 and 7); MCP clients only if the user connects one (a separate flow, PRIVACY.md section 6).
- Residual risk and gaps: PRIVACY.md section 5 lists what is sent for categorisation but does not enumerate what Penny's tool results and conversation context send to the model (balances, transaction details, account names; the tool catalogue is in PENNY_TOOLS.md); the policy says only "the content of your conversation is processed to generate a response". Gap to confirm against `penny_agent.py` and `penny_tools.py` (not enumerated in this pass).

### 2.4 Shared tip research (B48)

- Purpose: fetch market information once per key rather than once per user.
- Design: one document per key (insight category, normalised provider, coarse price band, region "UK", prompt version) with no user id, amount, transaction, name or per-user count; a guard `assert_no_user_data` fails closed before any write (`backend/app/services/tip_research.py:17-19`; module docstring lines 1-31); source URLs stored as scheme, host and path only (B48 note, 2026-10-16: "sources stored as scheme+host+path only, guard rejects ?, #, %40, pound sign"); the personal layer is composed deterministically from these findings with no external call (`tip_research.py:5-7`). The erasure sweep deliberately matches nothing in this collection (`tip_research.py:20`).
- Tavily receives query strings built from the category and the year (for example `backend/app/routers/savings_insights.py:43`), not user data, by construction.
- Lawful basis: the shared documents hold no user identifiers by construction; whether they are personal data is for the specialist, and lawful-basis options for the personal layer are in 2.5. Question: can a price band plus normalised provider key identify a person?
- Risks: re-identification through a rare provider and band combination (likelihood and severity for the specialist); the shared layer could carry third-party claims (not a data-protection issue; see perimeter map row 4).
- Retention: 7-day TTL on a key (`tip_research.py:34`).
- Mitigations: above; B48 privacy review and re-check recorded as PASS (B48 notes, 2026-10-16). Kevin to approve the proposed PRIVACY.md Tavily wording (B48 coordinator note, 2026-10-16; the live table already lists Tavily as "Web search, used for merchant and product identification", PRIVACY.md section 7).
- Residual gaps: PRIVACY.md still describes Tavily as used for "merchant and product identification" only (PRIVACY.md section 7 row); whether that covers tip research is for the specialist.

### 2.5 Personal savings-tip layer (per-user figures)

- Purpose: show a user what they pay a provider and what comparable options are listed at. After G283: facts only, with no estimate of saving (`G283:ENGINE.md:154-160`).
- Data: the user's own recurring payments by category (`savings_insights.py` composes "You pay {provider} {amount} a month").
- Lawful-basis options: contract, legitimate interests, consent (the user can turn tips off with the `show_tips` preference, `backend/app/routers/preferences.py:64, 149-150`; the B48 coordinator note says opt-out skips research).
- Risks: before G283, outcome claims ("could save ~£52/month"); data-protection-wise the tip is a profile of the user's bills and provider choices.
- Mitigations: G283 banned-phrase gate (`G283:backend/app/services/tip_copy.py:25-45`), removal of the verified-saving stat and its endpoint (G283 ENGINE section); tips cache 30 days (PRIVACY.md section 9, "Insight caches 30 days"; TTL on `savings_insights` via `expires_at`, `main.py:404`).
- Gaps: a tip on a provider can reveal a household characteristic (for example a mortgage or a loan). Question for the specialist: does such a tip reveal anything that is special category or otherwise sensitive?
- Retention: tips are cached 30 days (`backend/app/main.py:404`, `expires_at` TTL; PRIVACY.md section 9 "Insight caches"); a verified-tip state is stored without a money figure after G283 (`G283:ENGINE.md:158`).
- Recipients: MongoDB Atlas and Railway; the optional LLM phrasing step sends the composed facts to OpenRouter (G283 ENGINE section: "the optional LLM phrasing step"); the push path sends a tip title to Google, Apple or Expo (PRIVACY.md section 7).

### 2.6 Sentry error monitoring (E6)

- Purpose: collect errors without slowing the app (E6 item).
- Data: events with the user replaced by `{"id": sha256(uid)[:16]}`, a salted pseudonymous id; mandatory salt, otherwise no user id is sent (`backend/app/core/observability.py:8, 159-162, 389-390`); `send_default_pii=False` (`observability.py:398`); request bodies, cookies and non-allowlisted headers dropped; keys that name personal or financial data replaced; strings pattern-scrubbed for emails, tokens, card numbers, IBANs, sort codes, account numbers and currency amounts (`observability.py:6-20`); no frame locals (`observability.py:14-15`); `before_send` scrubber (`observability.py:298, 406-407`); events go directly to Sentry's EU ingest (`docs/ops/OBSERVABILITY.md:27`).
- Lawful-basis options: legitimate interests (PRIVACY.md section 3 already relies on it for security and "improving the service"), consent, contract. The specialist chooses.
- Necessity and proportionality: error diagnosis needs a stack and an issue grouping; the user id is replaced by a salted hash and bodies, headers and locals are dropped (`observability.py:6-20`). Whether error monitoring can be done with less is for the specialist.
- Retention: not recorded in the repository (Sentry's own retention setting is unverified; gap).
- Recipients: Sentry, EU ingest region (`docs/ops/OBSERVABILITY.md:27`), only when a DSN is set.
- Risks: residual exposure stated by the code itself: "exception messages are scrubbed by pattern only. A merchant name interpolated into an exception message is not detectable by regex" (`observability.py:22-26`); E6 rejection fixes removed upstream and database error text from exceptions (E6 notes, 2026-10-16).
- Status: inert until DSNs and `SENTRY_USER_HASH_SALT` are set (E6 coordinator note); PRIVACY.md already lists "Sentry | Error monitoring (only if enabled)" (section 7) but retention and the proposed fuller wording await Kevin's approval (`docs/ops/OBSERVABILITY.md:11`; E6 coordinator note). Retention at Sentry is not recorded in the repository (gap, unverified).
- Native layer can send crash stack, device, OS, app version, release (E6 note 2026-10-16, recorded as "Native layer can send: ...", full list not read here).

### 2.7 AI processing via OpenRouter

- Purpose: categorisation, tip phrasing, Penny chat, recurring-series judging, statement and receipt parsing.
- Routing: gateway OpenRouter; request preference `{"data_collection": "deny"}` (`backend/app/core/config.py:32-34`); PRIVACY.md section 5: "neither our gateway nor the underlying providers train their models on your inputs or outputs"; model providers named as Amazon Bedrock, Google, Anthropic or Microsoft Azure; some process in the United States, with the IDTA or EU SCCs with the UK Addendum (PRIVACY.md section 8). Whether OpenRouter's "deny" preference is honoured by every upstream is a provider claim and is not verified in this repository.
- Data sent for categorisation: merchant name, truncated description, amount and direction, user's name (PRIVACY.md section 5). Account numbers, sort codes, IBANs and card numbers are not sent (PRIVACY.md section 5; unverified against every call site, only the categorisation path was described in the policy).
- Lawful-basis options: contract, legitimate interests, consent. Question: is the user's name necessary to send, given its stated purpose (own-account transfers)?
- Risks: third-party model providers see merchant text, which may be sensitive (2.2); US transfers; prompt injection from merchant strings (a security matter, SECURITY.md).
- Mitigations: deny-training preference; no account identifiers; truncated description; scrubbed logs (`pdf.py:156-160` comment: the upstream error body may echo statement content so it goes to a debug log that Sentry never captures).
- Receipt photos: `backend/app/routers/baskets.py:19` imports `openrouter_chat` for receipt scanning (grocery baskets); what image content is sent and kept was not audited in this pass (gap).
- Retention: not controlled by Sorted at the provider; `data_collection: deny` is the control (provider retention periods are not recorded here, gap).

### 2.8 Investment statements and contract notes (AI parse, G272, A164)

- Purpose: set holdings from an uploaded statement, add trades from contract notes, then track growth.
- Data: the first 15,000 characters of extracted statement text are sent to the model (`backend/app/services/pdf.py:145`; contract notes 12,000 characters, `pdf.py:199`), model `google/gemini-2.5-flash` via OpenRouter (`pdf.py:150-151`). The statement text can carry the account holder's name, address, account reference and holdings; the prompt asks the model to extract provider, account type, account reference, statement date, value, holdings, payments, withdrawals, fees, interest and purchases (`pdf.py:99-140`).
- Storage: parsed fields only; the route reads the file into memory and keeps `parsed` (`backend/app/routers/investments.py:98-160`; the raw text variable is discarded as `_raw_text`, `investments.py:270, 369`). No write of the file or the raw text was found in `investments.py` (grep); framework or proxy temporary storage of the upload is not verified. The PDF itself is therefore not kept by the application code found. A164 (todo) asks PRIVACY.md to say PDFs are deleted after extraction and which fields are kept; PRIVACY.md does not yet say so (section 2 item 4 mentions uploaded statements only).
- Fields kept (from the schema and collections): investment accounts, holdings (name, units, value, cost where printed), notes (contract notes), daily valuations (`investment_valuations`, `backend/app/db/collections.py:88`), anchor and anchor history (user-entered provider value, return and date, G278), all in the erasure manifest (`backend/app/db/collections.py:574` lists `investment_valuations_col`, verified; `investment_accounts_col`, `investment_holdings_col` and `investment_notes_col` are in the same manifest).
- Lawful-basis options: contract, consent (the user chooses to upload), legitimate interests. Question: does the full statement text, which can include direct identifiers beyond what categorisation needs, require a statement in the privacy policy that it is sent to a model provider? PRIVACY.md section 5 describes the categorisation payload only (gap, see below).
- Risks: more identifiers sent to the model than categorisation sends (name, address, reference); password-protected PDFs are decrypted server-side with a user-supplied password (`investments.py:105-106`, `password` form field); the provider anchor is a user-entered figure shown back as growth context.
- Mitigations: no statement text stored; `uid` and pipeline tag on the call (`pdf.py:151`); the "what happens to your file" note planned in G272 (G272 title); user can delete an account, a note, or an anchor (`investments.py:515, 588, 654`).
- Retention: while the investment account exists; deleted with the account or on user deletion; daily valuation rows are kept for the life of the account (retention period not stated, gap).
- Recipients: OpenRouter and the underlying model provider (Google `gemini-2.5-flash` is the requested model, `pdf.py:150`); MongoDB Atlas and Railway for the parsed fields.
- Residual gaps: PRIVACY.md lacks (a) the statement-parse flow and what is sent, (b) fields kept, (c) valuation snapshots and anchors. A164 is open.

### 2.9 Provider anchor (user-entered)

- Data: provider, value and return on a date, as the user enters them (`frontend/lib/investmentGrowth.ts:136-139`; `investments.py:654` deletes the anchor). Display only; not recomputed (investmentGrowth.ts:139).
- Lawful-basis options: contract, consent. Risk: the figure is unverified third-party data supplied by the user; any further risk beyond 2.8 is for the specialist to assess.
- Purpose: let the user record what their provider shows (value, return, date) so lifetime growth can be tracked from that point, display only.
- Necessity and proportionality: three user-entered figures and a date; the alternative is no lifetime growth (`frontend/lib/investmentGrowth.ts:163`: growth shows once cost is known or an anchor is entered). Whether that is necessary is for the specialist.
- Mitigations: the user can edit or clear it at any time (investmentGrowth.ts:138); masked when balances are hidden (G278 review notes); deletable via `DELETE /investment/accounts/{id}/anchor` (`backend/app/routers/investments.py:654`).
- Retention: stored on the investment account document with an `anchor_history` (G278 note); kept until edited, cleared or the account is deleted; the history retention period is not stated (gap).
- Recipients: MongoDB Atlas and Railway; not part of the statement-parse prompt. Penny's `get_investment_growth` can return the anchor to the Penny model and to an MCP client the user connects (PENNY_TOOLS.md:66).

### 2.10 App Store and Play billing identifiers (C21, C24, in progress)

- Purpose: link a store subscription to the Sorted account.
- Data planned: an Apple `appAccountToken` UUID generated once per user and stored with `user_id` in a new collection (`docs/pricing/store-billing-c13.md:337-362`: the receiver resolves token to `user_id` "without ever seeing an Apple ID or email"), Apple `transactionId` and `originalTransactionId` (c13 lines 416-420), and the Google purchase token and obfuscated account identifier for Play (C24; the C24 design is on its branch, not read in this pass: unverified). Stripe customer ids already exist (`billing_customers_col`, c13 line 349-353 reference).
- Lawful-basis options: contract (taking and managing a subscription); legal obligation for financial records (specialist).
- Risks: new identifiers linking users to store accounts; new sub-processors (Apple, Google, Stripe) not listed as billing processors in PRIVACY.md section 7 (the table lists Apple for sign-in and push, Google for sign-in and push; Stripe is absent) (gap).
- Status: C21 and C24 in progress (board). Not live; nothing here is verified against shipped code because the code is not on main.
- Necessity and proportionality: a stable per-user token is needed to attribute a store purchase to an account without receiving an Apple ID or email (`docs/pricing/store-billing-c13.md:337-349`); the Play equivalent is unverified. Whether a less identifying design exists is for the specialist.
- Mitigations: token generated once per user and looked up server-side (c13 lines 351-362); `billing_customers_col` and `billing_events_col` are in the erasure manifest (`backend/app/db/collections.py:528-560`). The design is a proposal and is not on main.
- Recipients: Apple (App Store Server Notifications) and Google (Play Developer API) as platform operators, Stripe for web billing; AURIQ LTD stores the mappings in MongoDB Atlas.
- Retention: not defined in repository documents for billing events (`billing_events_col` is in the erasure manifest; the period for statutory financial records is a question).

## 3. Sub-processors and recipients (from PRIVACY.md section 7)

Finexer LTD (open banking); MongoDB Atlas (database, EU Frankfurt); Railway (application hosting, EU West); Vercel (web hosting); Cloudflare R2 (encrypted backups); GitHub (runs the nightly backup job); OpenRouter (AI gateway to Amazon Bedrock, Google, Anthropic or Microsoft Azure); Tavily (web search); Logo.dev (brand logos, receives brand domain names only); postcodes.io (postcode to approximate location); Google (sign-in, Android push); Apple (Sign in with Apple, iOS push); Expo (push relay); Sentry (error monitoring, only if enabled).

Not listed in PRIVACY.md section 7 but present or planned (gaps for the specialist): Stripe (a Stripe customer mapping exists in code and docs; billing is not live per PlanPicker.tsx:480, `Paid checkout will open when billing is live`); Apple App Store and Google Play as billing platforms (C21, C24); statement-parsing model path (covered only under general AI wording, `gemini-2.5-flash` via OpenRouter, `pdf.py:150`). Also user-connected AI assistants are recipients at the user's instruction (PRIVACY.md section 6).

## 4. Retention summary (PRIVACY.md section 9 and code)

| Data | PRIVACY.md | Code evidence |
|---|---|---|
| Account and transaction data | Deleted within 30 days of account closure, consent withdrawal or bank disconnection | `backend/app/services/retention.py:40-41` (`_DORMANT_AFTER` 365 days, `_CONNECTION_GRACE` 30 days) |
| Dormant accounts | 12 months of inactivity | `retention.py:40` |
| Chat sessions | 7 days | `backend/app/main.py:400` (TTL 604800 s) |
| Penny conversations | 7 days after last message | `main.py:436-440`, `penny_conversations.py:39-41` |
| Insight caches | 30 days | `main.py:404` (`expires_at`), SECURITY.md section 6 |
| Webhook logs | 30 days | `main.py:419` |
| Connector audit log | 90 days | `main.py:463` (`MCP_AUDIT_TTL_DAYS`) |
| Mirror portrait, aims, keep/change choices | not stated | no TTL; erased on account erasure (`db/collections.py:547-551`) |
| Investment holdings, notes, valuations, anchors | not stated | erased with the account; no TTL found |
| Shared tip research | not stated | 7-day key TTL (`tip_research.py:34`); no user data |
| Sentry events | not stated | not recorded in the repository |
| Consent records | 12 months after the connection ends, for audit (PRIVACY.md section 9) | SECURITY.md section 6 "Open-banking consent records": life of the connection plus `[CONFIRM: 12]` months; code not traced in this pass (unverified) |
| Encrypted bank access tokens | not in PRIVACY.md section 9 | SECURITY.md section 6: deleted immediately on bank disconnect or account deletion, overwritten on consent renewal (cascade on disconnect); code not traced (unverified) |
| Backups | rolling 30 days | SECURITY.md section 6 |

Note: SECURITY.md section 6 has no Penny conversations row (it lists only "AI chat sessions: 7 days") and no connector audit row (90 days appears only in PRIVACY.md section 9). SECURITY.md section 6 marks these periods DRAFT with `[CONFIRM]` while PRIVACY.md states them as fixed; confirm which is authoritative.

## 5. Risk register (summary)

| # | Risk | Likelihood and severity (blank for the specialist) | Mitigation in place | Residual |
|---|---|---|---|---|
| R1 | Profile shown to the user is wrong or intrusive (2.1) | for the specialist to rate | Consent Rule, keep honoured, evidence shown with each trait, suppressed when thin | no notice of Mirror in PRIVACY.md |
| R2 | Gambling, health or charity inferences reveal sensitive information (2.2) | for the specialist | word-boundary regex, user-only display, hide-balances | policy says no special category data; model provider sees merchant text |
| R3 | Chat text contains sensitive content and is stored 7 days (2.3) | for the specialist | TTL, caps, deletion, deny-training | tool-result data not enumerated in PRIVACY.md |
| R4 | Statement text with identifiers goes to a model provider (2.8) | for the specialist | no text stored, field-only storage | policy silent; full 15,000-character text sent |
| R5 | Re-identification from shared research (2.4) | for the specialist | no-user-data guard, fail closed | band and provider rarity |
| R6 | Sentry events leak merchant text through exception strings (2.6) | for the specialist | scrubbers, no locals, hashed id | pattern-only scrub, stated in code |
| R7 | New billing identifiers and processors not in the policy (2.10) | for the specialist | none yet (not live) | the specialist to decide whether PRIVACY.md section 7 needs updating before launch |
| R8 | US transfers via model providers (2.7) | for the specialist | IDTA or SCCs per PRIVACY.md section 8 | transfer risk assessment not found in repo (unverified) |
| R9 | Behaviour traits and Penny speak to a vulnerable customer (gambling, debt) | for the specialist | tone rules ("without judgement"), no scoring | no vulnerable-customer procedure found in the repo |

I have not scored likelihood or severity; that belongs to the assessor.

## 6. Claims I could not verify in code

- That every OpenRouter upstream honours `data_collection: deny` (provider claim).
- That no AI call sends account numbers, sort codes, IBANs or card numbers (PRIVACY.md says so; checked only for the statement-parse prompt schema, which asks for an account reference, not sort code or IBAN; categorisation call sites were not audited line by line).
- Retention of data at OpenRouter, model providers, Tavily, Expo and Sentry.
- That the PDF upload is not written to disk by the web framework or proxy (the application code found keeps no file).
- Whether the privacy notice is published (SECURITY.md says not; the `/privacy` route exists).
- The C24 Google Play billing data design (branch not read).
- Whether any Mirror, aims or portrait data reaches MCP clients: the PRIVACY.md section 6 list of readable data names "your spending verdicts and insights", not traits (unverified for `get_mirror`-type tools; check `backend/app/routers/mcp.py`).

## 7. What the specialist needs to decide

1. Whether a DPIA is required for each activity, and for the combined profiling, and score likelihood and severity (left blank in this draft).
2. The lawful basis (or bases) for each activity in section 2, and whether the Mirror needs explicit consent or a notice (options are listed, none chosen here).
3. Whether any inferred data (gambling, health, charity, BNPL, Mirror traits) is special category or otherwise sensitive, which Art 9 condition would apply, and whether PRIVACY.md section 2's statement "We do not collect special category data" must change.
4. Whether the gambling count in the hygiene trait should be kept, hidden, or made opt-in.
5. Whether PRIVACY.md must be updated for: Mirror profiling and retention, aims, statement parsing (what is sent to the model, fields kept, PDF not kept: A164), investment valuations and anchors, Penny context sent to the model, Sentry (E6 wording), Tavily and shared research (B48 wording), and billing identifiers and processors (C21, C24, Stripe).
6. Whether sending the user's name and full statement text (up to 15,000 characters) to a model provider is necessary and proportionate, and whether a transfer risk assessment for US processing is needed.
7. Retention periods for portraits, aims, investment valuations, Sentry events and billing records, and which of SECURITY.md section 6 (DRAFT) or PRIVACY.md section 9 is authoritative.
8. Whether a vulnerable-customer approach is needed for hygiene and debt content.
9. Whether Art 22 is engaged by any status word or verdict (Left to spend, aims, Mirror) and what to record.
10. Whether to publish or retain this DPIA and who signs it.
