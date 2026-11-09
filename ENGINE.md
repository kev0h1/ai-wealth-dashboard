# Engine

> Emma gives you a ledger and tidy-up tools and asks you to keep it neat. Sorted classifies your money for you, shows its working, and asks only when it is genuinely stuck.

---

## Register

engine

## Platform

backend (Python) + every surface that renders a category

---

## The Position

Every UK money app makes the same contract: *here is your ledger and here are the category tools — you keep it tidy.* That contract makes the user a data-entry clerk for their own bank feed. Sorted's contract is the inverse.

**The Engine Owns It Rule.** Categorisation is the engine's job, for everyone, always. Categories are infrastructure — the engine's internal vocabulary for producing verdicts (Left to spend, pace, bills, the payday plan) — not an interface the user maintains. Users see categories everywhere, as labels on views; they never manage them, never tune detection, never keep a taxonomy tidy.

This is only honest if the engine is right, learns when it is wrong, and can prove any verdict. Those three obligations — classify, learn, trace — are the whole doctrine.

---

## The Three Roles

**The Engine** classifies every transaction, consistently, for everyone, and learns from every correction. It is deterministic first and pays for intelligence only where intelligence is needed.

**The Surfaces** show verdicts with evidence. Every verdict is traceable to the exact transactions that produced it, honestly scoped. A surface never invents a number and never asks the user to do the engine's job.

**The User** does exactly two things, and no more:

**The Two Inputs Rule.** The user only ever (1) NAMES things they care about — "this is Padel", "this is my House Fund" — and (2) CORRECTS the engine when its story is wrong — "that's not spending, that's my house fund". They never maintain a ledger, never configure a heuristic, never curate a trust list. Naming and correcting are the only inputs the product accepts, because in an engine-owned model intervention *is* the user's contribution — and an engine that cannot learn from it is not calm, it is gaslighting.

---

## The Input Contract

The Two Inputs Rule says what the user does; this says exactly what the engine needs and where the product takes it. The engine needs precisely **six signals** from the user — no more — and it collects every one **in-flow**, on a real transaction or a real card, never on a settings page.

| Signal | What it teaches | Where it is collected |
| --- | --- | --- |
| **Correction** — "this is Padel, not Shopping" | merchant→category mapping, then propagation | the transaction sheet, one tap (`PATCH /transactions/{id}`, `transactions.py:211`) |
| **Naming** — a new word for something in the user's life | spend vocabulary (movement resolutions link a destination instead, per the Destination Rule) | INSIDE the correction picker ("Something else…"), not a settings page |
| **Kind confirm** — spend / commitment / movement | how money counts | one tap at naming, inferred first (kinds in `backend/app/services/categories.py`) |
| **Intent** — one-off vs new normal | baseline adjustment | the intent pair on notable cards |
| **Ask answer** — ≤50 chars on an unresolvable merchant | identity facts | the ask card, tier 4 |
| **Bill confirm / dismiss** | recurring-detection trust | the existing prediction flow in Planning (`dismiss_recurring`, `analytics.py:1045`) |

Then three rules that make those six buildable.

**The Born-in-Context Rule.** Categories are created where they are used, never in settings. The birthplace of "Padel" is the correction picker on a real transaction — type the name, confirm the inferred kind, done. A category the user has to go somewhere to create is overhead; a category that appears mid-correction is vocabulary — spend vocabulary only, since a movement resolution links a destination instead of naming a category (the Destination Rule). The standalone add-category flow in Spend settings (`add_category`, `categories.py:65`) is deprecated by this rule.

**The Retirement Rule.** Categories are never deleted, they retire. A category no transaction carries simply disappears from every view on its own; if the word comes back into use, it returns. "Stop using the word" replaces "manage the list" — no delete button (`delete_category`, `categories.py:108`), no orphaned-tag problem, no maintenance surface.

**The One Stream Rule.** All six signals land as one uniform teaching-event stream the engine consumes — not six bespoke endpoints with six bespoke behaviours. Every tier of the ladder reads the same feedback regardless of how it arrived — a correction, an ask answer, an intent tap. This is what makes the engine buildable by agents: one funnel in, one learning loop behind it.

---

## What counts as spending

> Canonical (G268, Kevin 2026-10-14). One definition, implemented once in `backend/app/services/spending.py` and read by every surface. A surface that tests "is this spending" any other way is a defect.

**The One Out Rule.** Spend's Out figure, the jump-strip chip, the notables, the pace line and its difference from usual, the three charts (category breakdown, spending pace, period comparison), money shape's Fixed plus Free, Left to spend's spending pace, Penny's category tools (G252 charts, G265 multi-month aggregates, `get_category_spend`, account activity) and the MCP connector's read tools all reconcile to the same number for the same period.

| | Counts as spending? |
| --- | --- |
| Everyday purchases (shopping, eating out, groceries, travel) | Yes |
| Bills and subscriptions | Yes |
| Mortgage or rent | Yes, the whole payment, as housing. Rent is its own built-in category (G280), Fixed, and a rent payment is never filed under Transfer |
| Loan repayments (car finance, a personal or student loan filed under Debt) | Yes |
| Fees, interest, gifts and family | Yes |
| Transfers between the user's own accounts | No |
| Savings, investment and pension contributions | No |
| Credit card repayments | No (the purchases were already counted, so the repayment would count them twice). A Debt debit is a card repayment only on evidence: a credit of the same amount landing on one of the user's credit card accounts, or text naming one of those cards (last four digits, a distinctive word of its name, or its provider beside a card word). Without evidence it counts as a loan repayment, until the user links it. |
| Refunds | No, and not income either: a credit in a spend category nets off that category's spending |
| Income | No |
| A Business payment to the user's OWN account (for example "AURIQ AURIQ TIDE" to the user's Tide business account) | No, it is a movement |
| A Business payment to a third party | Yes |

**Kinds after the G280 reclassification (Kevin, 2026-10-17).** This is a note under the G268 definition and the table above is unchanged: the same debits count as spending. What moved is which spending job a category belongs to. The G268 definition stands as written; Kevin reclassified these built-ins on 2026-10-17, so Fixed, Free and Moved read from one list everywhere (`BUILTIN_CATEGORY_KINDS` in `backend/app/services/categories.py`, read through `kind_of`, `is_commitment`, `is_discretionary`, `is_non_spend`):

| Job | Kind | Built-in categories |
| --- | --- | --- |
| Fixed | `commitment` | Bills, Mortgage, Rent (new), Car finance, Groceries, Transport, Software, plus any detected loan repayment (a Debt debit with no card evidence) |
| Free | `discretionary` | Eating Out, Entertainment, Shopping, Subscriptions, Health, Beauty, Travel, Cash, Charity, Other |
| Moved | `movement` | Savings, Investment, Debt, Transfer |
| Income | `income` | Income (a direction, never a job) |

Cash, Charity and Other moved from Fixed to Free; Subscriptions was already Free. Because both are spending kinds, no total changes (Out, pace, Left to spend, cashflow all ask only "is this spending"); only the Fixed and Free split and the Mirror's signature pleasure (which now may anchor on Subscriptions, Cash, Charity or Other, all Free) read the difference. An unknown or custom category with no declared kind is Free. A built-in's kind is fixed by this table; a same-named stored custom entry never overrides it. Rent is recognised by word-boundary triggers (rent, letting and lettings agents, landlord, housing association and council housing, and named agents and associations) ahead of every Transfer rule, so a rent standing order is spending, never a transfer. Car or van hire, Rentokil, parental and own-account pots are not rent. A user's correction sticks through the existing learned-merchant path. A credit matching a rent trigger (a landlord's incoming rent) is Income, never a Rent refund, on ingest and on bulk re-run alike (`rule_categorise_directed`).

**Card repayment link (G403).** A bank debit and a credit on one of the user's credit cards of the same amount, within three days, become ONE repayment when they name the same card on file, found by `own_account_transfers.card_repayment_issuer` with no model call. The card is identified by one of: (1) a 12 to 19 digit fragment in either narrative (hyphens and spaces removed) that ends in the card's stored last four, with the issuer named on either leg; (2) the card credit carries its own four digit tail and the bank debit names that card's issuer; (3) the bank debit names an issuer the user holds exactly one card with, the card credit has payment-received wording ("payment received", "payment by direct debit", "direct debit payment", "thank you"), and no other debit or credit of that amount sits in the window. Ambiguity means no match, so two cards from one issuer with no tail never link. Issuer forms live in one table, `CARD_ISSUERS`, keyed by provider code (American Express/Amex, Barclaycard/B/CARD, NatWest/NW World Mastercar, HSBC credit card, Chase). The credit must land on a credit card and the debit must leave a non-card account, so a balance transfer to a current account, or between two of the user's own cards, is never a repayment (a card to card balance transfer stays a Transfer pair, debt moving, never spend). Effects: the bank debit becomes Debt against the card, the card credit stays Transfer, both legs carry the `own_transfer_match` stamp (with a `card_repayment` issuer and card account id) so the review never asks and the pair survives a re-pull, and the recurring series key for a linked repayment is issuer plus card account id (`own_account_transfers.series_key`), never the issuer alone, so two cards of one issuer are two series. The per-card key is read by the recurring detector, the observed-debit index that closes a paid bill (which projects the stamp, and registers an unstamped pending row under the per-card key it resolves to) and the debt plan's bill to card mapping; the key stays the identity for dismiss, edit and skip, while the bill's `display_name` is the issuer plus the card's name and never carries the account id. Notifications, Penny's bill tools and focus labels, the plan card and spend-impact copy read `display_name` before `name`. Rows between 90 and 180 days old keep the issuer-only key until they age out, so that history forms a transient separate series. For a 15 digit fragment (an Amex PAN) the stored digits may match as the first four or the last four, or by visible prefix and suffix when masked, and only when exactly one of the issuer's cards matches; 16 digit fragments are suffix-only. A recurring-judge veto stored under the old issuer-only key no longer matches the new key; stored veto records are left in place. The guards are the matcher's own: one user, no pending rows, no custom non-movement category, never a shared merchant rule. Privacy: the route reads narratives in memory only; no narrative, fragment or card digit is logged, stored or sent anywhere, and the stamp holds ids only. The old hardcoded "American Express to Transfer" rule is gone; an unheld card's repayment is Debt by narrow rules (American Express, Amex or B/CARD followed by a 12+ digit PAN-shaped fragment, or B/CARD followed by direct debit wording), never the bare issuer name, debit-only (`DEBIT_ONLY_PATTERNS`, so a credit with the same words is never Debt), and Amex direct debit wording stays the existing Transfer rule, and a credit is the mirror (`CREDIT_ONLY_PATTERNS`, checked first in `rule_categorise` on a credit): an issuer printed form (the same `card_issuers.CARD_ISSUERS` table) followed by a 12+ digit PAN-shaped fragment, or a card-specific issuer form (American Express, Amex, B/CARD, Barclaycard, NW World Mastercar, HSBC credit card; never bare Chase or NatWest) with UNP, unpaid, returned, reversal or reversed wording and direct debit context (direct debit, DDR, D/D or DD) in the same text (an unpaid direct debit coming back; a bare refund is not a trigger, so merchant and fee refunds keep netting against spend), files as Transfer and never reaches the bulk pass's Income default, while debits are unaffected, and the Savings rule's "isa" now needs word boundaries so "B/CARD PLAT VISA" is not Savings.

**Card repayment rule (G381, Kevin 2026-10-31).** One module, `services/card_repayment.py`, holds every way a payment to a card is recognised, in one decision order: G403 routes 1 and 2 (PAN fragment, the card's own tail), route 3 with A194's bank-coded direct debit, G443's same-bank rule, then the card account type route (both legs visible: a card credit with payment wording, one non-card debit of the amount within three days, no competing debit or card credit, no other issuer named; with two cards from one issuer the credit prints this card's tail). The debit is Debt and the card credit Transfer everywhere (both movement kinds, so neither is spending and purchases are never counted twice). When ONLY the current account side is visible, `debit_only_repayment` files a debit as Debt without asking when its narrative is nothing but a card issuer's name plus filler (direct debit, payment, card, bank), the user holds a card from that issuer, and it is not loan-shaped (loan, mortgage, fee, interest, insurance and similar words never file; a card spend bank code never files). With no card from that issuer nothing is filed. With two cards from one issuer it files only when the narrative prints exactly one card's tail. If the user also holds a loan or mortgage account with the issuer, a BARE issuer name is asked; a card-specific form (NW WORLD MASTERCAR, B/CARD) or the card's tail still files. The row carries `card_repayment_rule` (issuer, card account id, previous category), not an own-transfer stamp, and Spend reads it as a card repayment. The teaching sheet's "Paying off one of my cards" (`resolve-movement` `mine-card`) sets Debt, marks the row `card_repayment_taught` and, through the key-level memory, later Debt debits from that payee count as card repayments whether or not Sorted can see the card. The structural pass re-runs the rule over `HISTORY_DAYS` on every sync, idempotently, and unwinds a filing that stops qualifying; a user's own category always wins.

**How it is decided.** A debit counts when its category kind is `discretionary` or `commitment`; kinds `movement` and `income` never count (this is what removes transfers, savings, investment, pension and card repayments, `categories.is_card_repayment` naming the card case). A credit in a spend category is a refund and subtracts. On top of the kind, a debit in a spend category is still a movement when it goes to the user's OWN account. That is own-account detection, never a blanket category kind, so Business keeps its kind for third-party payments. The evidence, strongest first: the row is linked to an offline account or goal; its counterparty fields, or its text, carry the sort code AND account number of another of the user's accounts (G438: a bare number or bare sort code is not enough). Those two are decided outright (Kevin's rule, 2026-11-07). A matched pair is decided too when it is NAMED and close in time (G438, timing by G440, Kevin 2026-11-08): a credit and a debit of the same amount (within 2p) on different accounts of the user's, where either leg carries the user's own name in any form (the full name, a bank truncation of at least four letters of a name token such as "MAIN" or "KEVI", or the surname with initials in any order, drawn from the profile tokens, never a common word or a repeated letter) or the name of another of the user's accounts or pots. Within 24 hours by timestamp it is an automatic own move; when the bank sends only a date (midnight timestamps) the same or the next calendar day counts as within 24 hours. More than 24 hours and up to three days apart, the same pair is only a QUESTION; beyond three days nothing is offered. When either leg is date-only, two calendar days apart is a question and three or more gets no offer. A pair with no name, a name with no pair, and a lone name credit are questions for the transfers review too, never decided by the engine. A question is a pending pair (`find_pending_transfer_ids`): Spend leaves it out exactly as it did before, so totals do not move, but it is never an own move for any money-engine purpose (`SpendingContext.confirmed_own_move_ids` is the own set), and the review's evidence gate accepts every pair that is left out so nothing is unaskable. Card repayment links keep their own three day rule (G403). A pair never forms on amount and date alone, so a payment to a supplier and an unrelated credit of the same amount stay spending. The user's own name on the debit alone never flags a row. Wording alone (Transfer or Savings words, a raw provider TRANSFER tag) no longer files a row as own money either, except the card repayment links (G403/G413); the user's own answer or rule overrides every automatic reading, both ways. A payee that merely shares a provider's name (a "TIDE PLATFORM LIMI" fee) is not evidence. An own-account debit is shown as moved money ("Between your accounts"), never as Out. If the receiving account is neither connected nor named by the user, the engine cannot see the pair, and the row stays spending until the user says it is theirs (the resolve-movement answer).

**Where it lives.** `classify_flow` (pure, over the kind map), `find_own_move_ids` and `SpendingContext` (own-account detection), `txn_flow`, `is_spending`, `spend_amount` and the bulk variants. `GET /transactions` stamps each row with `spend_amount` (+payment, -refund, 0 otherwise) and the Spend charts sum that field, so the charts need no copy of the rule. Deliberately outside the definition: runway (`SKIP_BURN_CATS` in `analytics.py`) and the payday plan's per-account move targets, which ask what leaves an account, not what was spent.

---

## The Ladder

Four tiers, cost-ordered, escalated only when the tier above gives up. Every answer feeds back DOWN the ladder so it is never paid for twice.

1. **Deterministic** — merchant identity (`merchant_key`), the learned cache, user rules. Free, instant. Absorbs the vast majority. (Today: `MERCHANT_PATTERNS` + Passes 0–3.5 in `backend/app/services/categorisation.py`.)
2. **LLM judgement** — the existing name-check / classify pass on the Haiku tier (`llm_name_check`, `categorise_others_bg` in `categorisation.py`, `anthropic/claude-haiku-4-5`). Cheap, for routine ambiguity. Direction (debit/credit) is part of the signal handed to the model on every line, not just the text: amounts are absolute and `transaction_type` carries direction, so a description alone can't tell the model which way money moved. A debit can never be Income, whatever the text says.
3. **Web search + reasoning** — for merchants that survive tiers 1–2, one Tavily search ("What is Playtomic?" — the key already exists, `TAVILY_API_KEY` at `backend/app/core/config.py:22`) synthesised by a Sonnet-tier call. **Since G316 (2026-10-22) this tier runs at sync time and writes a description, not a category**: see "The Vendor Directory" below.
4. **Ask the user** — last resort. ≤50 characters, in Penny's voice. Precedent: the debt page's `ask_card` ("tell me how you use it and the picture sharpens", `backend/app/services/debt_narration.py:100`).

**The One-Way Ladder Rule.** Escalation is one-way and paid once. A merchant only reaches tier 3 after tiers 1–2 fail; model tiering follows the deciding-vs-formatting split — pay for reasoning exactly where reasoning happens (tier 3), never blanket-upgrade the routine tiers. A tier-3 web answer becomes a cached tier-1 fact, so the fifth Playtomic row costs nothing.

**The own-transfer judge (G442, Kevin 2026-11-08): tier 2 applied to transfer pairs.** Deterministic tools first, the model only judges. `own_account_transfers.ai_candidate_pairs` builds the candidates with the same pair builder the automatic matcher uses (same amount, opposite direction, two different accounts on file, within the three day ask window), then removes every pair a rule already decides: a sort code and account number, a card repayment link, a direct debit, a pair the user answered or the engine learned, and a sort code or counterparty match. The G440 named-within-24-hours rule does not pre-empt the model (Kevin's G442 note): named pairs are candidates like any other. A leg that sits in more than one candidate is ambiguous and is never sent. What is left goes to the Haiku tier (`own_transfer_judge.py`, the shared `openrouter_chat` metering, pipeline `own_transfer_judge`) in batches of twelve, and each pair comes back as `same_transfer`, `not_transfer` or `unclear` with a one-line reason. The payload is only the user's own transaction fields (both descriptions, dates, directions, account display names and bank names, and the Finexer metadata `party_name`, `party_sort_code`, `party_number`, `merchant`, `reference`, `bank_code`). This is a deliberate, narrower-than-categorisation exemption from the privacy exclusions below, because Kevin's G442 spec lists these fields: the transfer judge DOES send the user's own descriptions with their name forms, references, account display names and the counterparty sort code and account number the bank supplied, since the judgement is impossible without them. It never sends balances, email, an IBAN or card number the user did not already see on the row, or anything of another user; the payload is limited to the fixed field set `ALLOWED_PAIR_FIELDS` and `ALLOWED_LEG_FIELDS` (a test pins it), and every pair field is treated as untrusted data in the prompt, never as an instruction. It is capped per user per month (`OWN_TRANSFER_JUDGE_MONTHLY_PAIR_CAP`, default 300 pairs) and retried at most three times per pair. The prompt carries Kevin's rule that the user's own name alone in a reference never makes a pair `same_transfer`; the validator is strict (anything malformed becomes `unclear`, and a `same_transfer` that names no evidence becomes `unclear`).

**Bank facts prune the pairs first (G443, Kevin 2026-11-09).** Before the model and before the review asks, `transfer_pruning.pair_pruned_reason` rules out a pair on bank facts: a CARD PURCHASE (a debit on a credit card account, a card purchase marker as a whole token of the narrative, `CPM`, `CLP`, `BCC`, `CNP`, "card purchase", or a card spend bank code `POS`/`DEB`), a debit to a BUSINESS (the bank named a merchant, or the machine category is a spending kind from `BUILTIN_CATEGORY_KINDS`, never on a transfer rail `STO`/`FT` and never with counterparty account details), or a credit that names a THIRD institution (neither leg's bank: "Sent from Revolut" between a NatWest debit and a Barclays credit). Naming the receiving bank, the sending bank or nobody never prunes. The user's links and custom categories always win. The one pair builder, the review gate and the Spend scan all apply it, so a pruned pair is neither asked nor hidden from Spend (G438). The prompt no longer treats a credit naming its own bank as doubtful, and a reason that plainly says the payments are unrelated is a `not_transfer` (the validator downgrades an `unclear` whose reason says so); an `unclear` always carries a reason ("Sorted could not decide." when the model gave none). Card repayments get one narrow extra rule (`same_bank_card_repayment`, absorbed by G381 into `services/card_repayment.py`): a debit naming the card's bank and a credit on that card with its payment wording, with G403's ambiguity doctrine kept. A single leg at the START of history whose counterpart falls before the import is filed from an already filed series (`series_single_legs`: same account, direction, amount and normalised description, counterpart expected before the other account's earliest row plus three days), never in the middle of history. Every window now spans the whole imported history (`HISTORY_DAYS`, was 90 days for reconcile and the judge). Every verdict carries a `prompt_version`; a verdict from an older prompt (except a `same_transfer` and any user answer) is judged once more, counted against the monthly cap, and each run stores counts only (candidates, judged, skipped by cap, attempts and run limit, errors) for `/ops/health`.

It runs where models run: the arq worker, never a screen load (H145). At sync the pipeline calls `own_transfer_judge.after_sync`; the API process forbids model calls, so there it only enqueues `task_judge_transfer_pairs` through the queue choke point. The first pass for a user is a paced, capped backfill over the last 90 days, recorded so it runs once. Every verdict is stored once in `own_transfer_judgements`, keyed by both transaction ids plus a signature of exactly what was sent, so a pair is never sent twice unless the bank amends a row. A model error or the monthly call ceiling leaves a pair unjudged, which falls back to the G438/G440 rules (the review asks).

**Precedence.** Once a verdict exists it decides, in reconcile, in Spend and in the review alike; the G440 named-within-24-hours rule is only the fallback while a pair has no verdict (not yet run, a model error, the budget). A standing `not_transfer` or `unclear` verdict switches that fallback off for the pair, and the user's undo of a series switches it off for the whole series (a user answer: it neither falls back nor is judged again), so an undone series is asked, not re-filed.

What a verdict does. `same_transfer`: both legs are filed as an own-account transfer through the ordinary reconcile (the stamp carries `source: "ai"`) and the pair is learned by its normalised descriptions (`own_account_transfers.transfer_text_key`, which strips a time after a date and then applies `canonical_merchant_key`; `canonical_merchant_key` itself is unchanged, and a user's learned pairs keep their plain keys while the model's are held under their own normaliser, so every past and future occurrence matches with no further call; the learned document carries `source: "ai"`). `not_transfer`: the pair leaves the transfers review and stays in Spend (Spend and the review gate both read the verdict, so G438's invariant, that anything left out of Spend is askable, still holds). `unclear`: the pair is asked in the transfers review, with the model's reason, grouped with its recurring series so one answer covers the series. The user always wins: a user confirmation removes the AI mark from the pair and its learned document, a user link beats a `not_transfer`, and an undo of an auto-filed series (the review's "Filed automatically" list) unlearns the pair, overrides the stored verdicts and stops the model judging that series again, after which today's rules apply.

---

## Learning & Scope

**What a category is.** A category is a word for a kind of spending, whose job is to let the engine compare the user with their own usual — in their language. It exists so a verdict can be spoken: "Padel is running above usual" is only possible because the word Padel exists. No comparison to make, no sentence to say → no reason for a category.

The ontology, then — what is a category, and what only looks like one:

- **Groceries, Eating Out, Transport, Bills, Mortgage, Rent, Car finance, Subscriptions, Health, Beauty, Travel, Software, Entertainment, Shopping, Cash, Charity** — the **shared spend vocabulary**: the baseline words every user starts with, and what the global merchant catalog maps to as world-fact defaults. Rent (G280, 2026-10-17) is a Fixed built-in like Mortgage. Mortgage and Car finance (G39, 2026-09-11) split out of Bills/Other once the engine could reliably tell the two apart by lender — before that, "no reliable category" meant the mortgage/car_finance savings insights had nowhere honest to send the user.
- **Padel, Golf** (user-created) — the **personal spend vocabulary**: the user's words layered on top. The catalog's default might say leisure; the user's mapping says Padel, and their word wins for them (user-scoped, per the Firewall Rule). Functionally identical to the built-ins — baselines, multiples, verdicts — the only difference is who coined the word.
- **Transfer, Savings, Investment, Debt** — **not categories: movement** (see the Destination Rule below). They survive only as internal kinds so the arithmetic knows "not spend"; nothing is ever filed there again.
- **Income** — **not a category: a direction.** An internal kind.
- **Other** — **not a category: the engine's unresolved state.** A queue position awaiting the ladder or an ask. Never a baseline, never a multiple, never a peer tile.

A category earns comparison-unit status through history and materiality: the engine needs it *counted* from day one, but it becomes a unit of verdict only when it can hold a baseline and matters in pounds. Words the user stops using retire on their own (the Retirement Rule).

Two kinds of fact, and they must never be confused:

- Facts about **the world** — "Playtomic is a padel court booking platform" — go to a **global catalog**. They benefit every user and compound into a proprietary UK merchant catalog. That catalog is the moat.
- Facts about **the user** — "Kevin files padel under his custom Padel category" — are **user-scoped**. They are one person's preference, valuable to no one else.

**The Firewall Rule.** User-provided text is NEVER promoted to the global catalog on the AI's judgement alone. A 50-character answer can be "my mum's rent" — personal by construction. The default scope for anything learned from a user is user-scoped. Promotion to global requires the fact to be merchant-identity shaped AND corroborated by web evidence or by convergence across multiple users. This is the same principle as `data_collection: deny` provider routing (`config.py:19`): the user's data does not leak outward — including into our own shared catalog.

The engine already scopes name-based decisions per user (`cache_merchant(..., uid=uid)`, `categorisation.py:274`); the Firewall Rule generalises that discipline to every learned fact and makes global promotion the deliberate, corroborated exception.

A built-in category name is not, by itself, proof a merchant key is safe to share: the 2026-08-17 incident cached "MAINGI KM" globally under Income because Income is a built-in, and the account owner's own standing-order text then stood ready to poison categorisation for anyone else's colliding bank narrative. `cache_merchant` now gates every global write behind kind (spend-kind built-ins only, movement and income always stay per-user) and shape (a key that names or addresses a person, by owner-name match or payment-reference pattern, stays per-user regardless of category).

**Cache source precedence and re-stamp (G404, 2026-11-02).** The merchant cache (`cache_merchant`) ranks its sources: **user (3) > rule (2) > llm (1)**; any other automated source ranks as llm. A write replaces an existing doc only when it outranks it, except that user replaces user and rule replaces rule. An llm judgement therefore never overwrites an existing doc of any source: the first judgement for a key stands, so identical rows stop drifting between two categories (prod, 2026-11-02: one lender's direct debits read Bills, Transfer, Transfer, Bills after a later llm write replaced an earlier one). `cache_merchant` returns False on a refusal (and logs at DEBUG with the key only); a caller whose llm write is refused applies the standing category to its rows. The KIND and PERSON/REFERENCE gates are unchanged. When a write does change the stored category (or is the first write for the key), the calling user's rows with that `merchant_key` and a null `custom_category` get their engine `category` field re-stamped (transactions and statement transactions, one `update_many` each, nothing else written) and `mark_stale(uid, reason="merchant_category_restamp")` runs once if any row moved. A user or rule write re-stamps every such row except detected Transfers (a merchant correction does not flip an own transfer); an automatic (llm or rule) write never files Income on a debit row, the same direction rule every automatic path applies; an llm write is insert-only and atomic (`$setOnInsert` upsert), so two concurrent llm writes cannot both land; a first llm judgement only fills rows still `None` or `Other`, so it cannot overwrite what own-transfer detection or a rule already settled. Statement rows carry no `merchant_key` today (finexer_sync writes it on bank transactions; routers/statements.py does not), so the statement-collection re-stamp currently matches nothing; only bank transactions are re-stamped. A global cache write still re-stamps only the caller's rows: one user's decision never rewrites another user's transactions.

Older user corrections keyed with a card number no longer resolve, because `canonical_merchant_key` now strips references. They are not migrated automatically. `backend/scripts/merchant_key_migration_report.py <uid>` (needs `MONGO_DB`, read-only, counts only) shows how many exist. The repayment link (G403) is expected to make those keys redundant; whether to migrate them is Kevin's decision.

**The Destination Rule.** Spending gets vocabulary; movement gets destinations. Categories answer "what did you consume?" — and consumption has no account on the other end. Moved money always has an other end, and the engine can usually see it: own-transfer detection identifies the counterparty (`is_own_transfer`, `categorisation.py:149`), and the pot ledger knows which goal that account funds (`compute_pot_ledger`, `backend/app/routers/commitments.py`). So movement is never explained by a category — "£1,020 to WISE" does not become a House Fund *category*; it resolves to a destination: an existing pot/goal, a newly linked offline pot for accounts the engine cannot see (supported since goals v2, `manual_accounts_col`), or at minimum "an account of mine elsewhere" with no goal attached. The teaching flow forks on kind: a spend correction opens the naming picker; a movement resolution asks "is this account yours?" and links into the goal/pot system that already owns verification, payday legs and progress. Two parallel systems describing moved money — movement categories and the pot ledger — was the borrowed core leaking through; the ledger is canonical.

---

## The Vendor Directory (G316, Kevin 2026-10-22)

Tier 3 moved from a manual endpoint to the sync-time ladder, and its output changed shape. A new merchant is looked up on the web ONCE, by anyone; a reasoning-tier model writes a plain one or two sentence description of what it is into a shared table; and each user's own categories are then matched to that description. Code: `backend/app/services/vendor_directory.py`.

**What is global and what is not (the Firewall Rule, applied).** `vendors_col` is keyed by the shared `merchant_key` and holds facts about the world only: `display_name`, `description` ("Members golf club and course in Solihull"), `type_tags`, `domain`, `sources`, `looked_up_at`, `confidence`, `status` (`found` | `not_found` | `not_a_business`). It never holds a category, a user id, an amount or a transaction; `assert_directory_doc` enforces the field list on every write and fails closed. Every category choice is per user, in `user_vendor_categories_col` under `uid::merchant_key`, with the reason and when it was decided. Two users with the same merchant and different categories never see each other's answer.

**The ladder at sync** (`run_vendor_ladder`, called from `categorise_others_bg`, which every sync path already calls; stored decisions are also applied by `apply_rules_bulk` as Pass 3.45, cache-only):

1. Structural passes stay deterministic and first: own transfers, card payments, income, and lender, landlord and rent matches (Mortgage, Rent, Car finance) are final and never reach the ladder. Only debit rows whose category is unset, raw, Other or a spend category are open to it.
2. A merchant the user has corrected (any row with a `custom_category`) or that one of their rules covers is skipped entirely. Corrections and rules always win, including at write time (`custom_category: None` is part of every update filter).
3. Per merchant: the user's stored decision, then the directory description, then a lookup if the directory has nothing fresh. The description is matched to the user's categories (built-in plus custom) by the cheap model, with the broad `MERCHANT_PATTERNS` keyword result passed as a **hint**, not an answer.
4. A user with NO custom categories is never touched: their categorisation is exactly what it was before G316.

**Looked up once.** Tavily search (basic, three results) then the reasoning model writes the entry. Refreshed after 12 months (`VENDOR_REFRESH_DAYS`); `not_found` and `not_a_business` are cached for the same period so they are not retried every sync. A provider failure is never cached as `not_found`, and a failed write-up rests the merchant for an hour.

**Privacy exclusions** (`privacy_exclusion`), applied before anything leaves the user's scope to Tavily, a model or the directory: person-to-person payment wording and shapes (`to <name>`, `via mobile`, `FP <digits>`, faster payment, bank transfer), text carrying the user's own name tokens (the `llm_name_check` prefilter, including a standalone initial), account or sort-code digit patterns (and IBAN, email or phone shapes), and transfers. A hit on any sample excludes the whole merchant. Only the normalised merchant key is searched, never the raw descriptor, and the matcher is shown the description, never raw bank text. **Exemption (G442):** the own-transfer judge (see "The own-transfer judge" above) is the one tier that deliberately sends name forms, references and counterparty account details, to a model only, never to Tavily or the shared directory, under the limits stated there.

**Cost guards.** Caps per sync and per UTC day, a Mongo claim document per merchant (TTL'd, taken over atomically once expired) so two users hitting the same new merchant trigger one lookup, and a quota backoff: Tavily HTTP 432, auth and rate failures stop lookups for `VENDOR_BACKOFF_HOURS` (24), and the tips research backoff is honoured too because it is the same Tavily key. State shows on `/ops/health` as the `vendor_lookups` block inside the `llm_tavily` collector (lookups today, cap, `backoff_until`, queue depth, directory size). Model tiering: reasoning model only at the lookup write-up (`VENDOR_REASONING_MODEL`), cheap model for every per-user match (`VENDOR_MATCH_MODEL`). Config keys are in `docs/ops/ENV.md`.

**Display names.** `vendor_display_name(merchant_key)` returns the directory's clean name for a later G282 or G315 to read. Nothing consumes it yet.

**Backfill and report.** `backend/scripts/backfill_vendor_categories.py` (dry run by default, counts only) and `backend/scripts/vendor_directory_report.py` (read-only before and after for the account owner): see `docs/ops/VENDOR_DIRECTORY.md` and `docs/engine/vendor-directory-report.md`. Kevin confirms categorisation rule changes, so the report is the gate before the ladder is released.

---

## The Ask Budget

**The Ask Budget Rule.** The user's attention is the most expensive resource in the ladder — more expensive than any model call. Ask only when a merchant is genuinely unresolved after web search AND the answer will be reused: a recurring merchant, or a material amount. A £2.50 one-off never earns a question. Asks are batched, frequency-capped, and skippable; an unanswered ask means the transaction sits quietly in "Other" until more evidence arrives. Never a blocking prompt, never a badged inbox, never a nag.

---

## Traceability

**The Show Your Working Rule.** Silent classification is only tolerable when every verdict can show its evidence. "Health: £228, 2.0× usual" must open onto the exact transactions that produced it, honestly scoped, with the scope stated. Overspend attribution ("mostly the £117 David Lloyd charge plus that weekend") is computed deterministically in Python — the LLM never does arithmetic (the house rule already enforced in `backend/app/routers/can_i.py:254`, "LLM never does arithmetic", and lines 316–318, "NEVER compute, derive or invent a figure"). The model narrates; Python counts. This is the categorisation-side application of BEHAVIOURS' **Facts / Voice Split**.

---

## Tips state facts only (G283, Kevin 2026-10-17)

A tip never claims or estimates a saving. It states what the user pays, to whom and how often, from their own transactions, and what comparable options are listed at, with a source and a date: "You pay EE £56 a month." and "SIM-only plans are listed at £5 to £14 a month. Also listed: Asda Mobile £5 a month, Lebara £6 a month. Checked 14 Oct, source uswitch.com." No "could save", "cut", "cheaper for you", no recommendation, and no product is ever named as the user's best option. A deal is a dated fact ("Offer listed until 31 Oct"), never a call to action.

- **The money fields are gone.** `savings_estimate` is not computed, stored or served. The stored `verified_savings` amount is internal lifecycle state (verified, substituted, retired) and is never serialised, narrated by Penny or the MCP connector, or shown as pounds saved. `GET /value-delivered`, the Home "saved" stat and the `insight_win` celebration are removed. A verified tip states only that payments stopped.
- **The banned-phrase gate** (`app/services/tip_copy.py`) fails closed on every tip output path: the shared findings builder (promo wording is dropped, the model's free-text headline is no longer kept), the personal composition and the optional LLM phrasing step (`_tip_content_for` drops a tip that trips the list with the static code `banned_phrase`), the serializer (a stored tip that trips it is withheld until the next pass rewrites it) and so Penny's `get_insights`. List: save, saves, saved, saving, savings (except the category name "Savings" and the account type), cut, cheaper, could, should, recommend, best, worth switching, switch to. Frontend twin: `npm run check:g283-no-savings-claims`.
- **Why.** A figure of money saved is a consumer-protection claim we cannot prove, and the £1,931/mo "saved" stat showed how it goes wrong. This feeds A165.

---

## What Dies / What Survives

Deletion, not relocation. These surfaces contradict the doctrine and go away:

- **The recurring-category trust grid.** A hand-maintained list of categories that widen recurring detection (`RECURRING_CATEGORY_OPTIONS`, 16 built-in chips plus customs, `frontend/components/CategoryManagerSheet.tsx:302`; default set `DEFAULT_RECURRING_CATEGORIES`, `backend/app/routers/analytics.py:431`). Regularity is the engine's job, not a checklist the user tends. Recurrence is defined internally — same merchant identity, amount tolerance, cadence tolerance, confidence tiers (`_detect_recurring`, `analytics.py:472`) — and the trust signal is the user's existing confirm/dismiss behaviour on bill predictions, learned, not configured.
- **The colour customiser as an advertised surface.** Colour becomes engine-assigned and deterministic from the category name — stable across devices, no `localStorage` (today's overrides live in `frontend/lib/colourStore.ts` via `localStorage`, `ColourProvider.tsx`). Colour is information (DESIGN's Category Voice Rule), so the engine owns it.
- **The typed natural-language rule builder.** (`/rules/parse` + `/rules`, `backend/app/routers/categories.py:225`.) Rules become engine-PROPOSED, not user-authored: "New Playtomic variant noticed — always file as Padel?", one tap to accept, shown with its blast radius, never auto-applied.
- **The standalone add-category flow and category deletion** (`add_category`, `categories.py:65`; `delete_category`, `categories.py:108`). Deprecated by the Born-in-Context Rule and the Retirement Rule: categories are born mid-correction and retire when unused, so a create button and a delete button have nowhere left to live. Together with the trust grid and the colour customiser above, this EMPTIES the Manage sheet (`CategoryManagerSheet.tsx`) — it is not simplified, it is left with nothing to hold and goes away.
- **Movement categories as user-facing vocabulary.** Under the Destination Rule, moved money resolves to a destination in the pot ledger, not a category — so Transfer, Savings, Investment and Debt stop being words the user files into or browses. The internal kinds remain (the arithmetic still needs "not spend"); what dies is the pretence that movement is a category to be named.

What survives, because each embodies the model rather than fighting it:

- **The category-kind chooser** (kinds in `backend/app/services/categories.py`). This is the naming/teaching moment — inferred, with one-tap confirm. It survives, but per the Born-in-Context Rule it now lives inside the correction picker on a real transaction, not on a standalone creation sheet. Keep it, move it.
- **The miscategorised guardrail card** (`miscategorised_count` / `miscategorised_list`, `transactions.py:252`). It IS the doctrine in miniature: the engine states a belief, the user confirms or corrects, the engine learns. Conditional, quiet, absent at zero, never an inbox.

---

## Current State (honest)

The doctrine is mostly aspiration today; the pipeline works but its learning loop is broken in three verifiable ways.

**No shared identity.** At least four code paths compute a *different* merchant identity for the same row, so five differently-formatted Playtomic lines are five different merchants to the engine:

- the similar-endpoint stem — `_description_stem`, `backend/app/routers/transactions.py:27`
- the cache key — `normalise_merchant`, `categorisation.py:247`
- the recurrence-series key — `series_key`, `categorisation.py:227`
- Pass 2.5's override key — the raw lowercased description, `categorisation.py:420` (no date stripping at all)

`merchant_key` is not stored on transactions at sync — it exists only inside `savings_insights.py` for a different feature. One shared identity function, written on every transaction at sync and indexed, is the prerequisite for the whole ladder: you cannot ask "what is Playtomic" or cache the answer if you cannot tell the five rows are one merchant.

**The cache gate throws away custom-category corrections.** `cache_merchant` returns early unless the category is in `VALID_CATEGORIES` (`categorisation.py:279`), and the correction endpoint gates its cache write on the same check (`transactions.py:232`). A user who recategorises to a custom category (Padel, Golf) has their correction saved on the row but NOT learned — so the same merchant is misfiled again on the next sync. The Two Inputs Rule is silently discarded for exactly the categories the user cared enough to create. The Haiku prompts are also built from `VALID_CATEGORIES` only (`categorise_others_bg`, `categorisation.py:677`), so the model is never even told a user's custom categories exist.

**Poisoned cache keys.** Keys built from raw descriptions can embed dates and reference numbers that never recur (the mechanism: `normalise_merchant` retains `A/C 76526682`-style numeric identity; several call sites cache from truncated raw labels, e.g. `categorise_others_bg` caches `normalise_merchant("", label)` at `categorisation.py:757`). Such a key can never match a future row, so the write is dead on arrival. *(The doctrine's "roughly a third poisoned" figure is a data claim, not verifiable from code alone — but the mechanism that produces poisoned keys is present and confirmed.)*

**Tier 3 exists but is bolted to the wrong place.** *(Superseded by G316, 2026-10-22: see "The Vendor Directory". The manual endpoint remains.)* `tavily_lookup_merchants` (`categorisation.py:296`, `search_depth: "basic"`, one result) is wired only into the manual `/transactions/auto-categorise` endpoint (`transactions.py:369`), not into the sync-time ladder, and there is no reasoning tier on top of the search. Tier 4 (ask the user) does not exist for categorisation at all.

*Prompt cross-check: the recurring trusted-tier thresholds cited as "~line 532" are actually the acceptance logic at `analytics.py:537–550` (line 532 is a comment); everything else in the brief verified at the lines given.*

---

## Build Order

Each stage ships value on its own.

1. **Identity.** `merchant_key` — one shared identity function, stored at sync, indexed — plus the cache-gate fix (learn custom categories) and custom categories injected into the LLM prompt. Fixes the broken loop; unblocks everything below.
2. **The ladder + scoped learning + the teaching-event stream.** *(Tier 3 at sync time shipped as the vendor directory, G316.)* Tiers 1–3 in sequence at sync time, with the global/user split and the Firewall Rule enforced on every write — all reading from one uniform teaching-event stream (the One Stream Rule) so every signal feeds the ladder the same way.
3. **The ask tier.** Tier 4, governed by the Ask Budget Rule — batched, capped, skippable.
4. **Internalised recurrence + granular attribution.** Retire the trust grid; define regularity from `merchant_key` + cadence; compute overspend attribution deterministically in Python for the Show Your Working Rule.

### Category grouping choice (G347, Kevin 2026-10-27)

The approved searchable pay-split editor lets users declare the meaning of an existing custom category as Fixed (`commitment`), Free (`discretionary`), Moved (`movement`) or Not counted (`excluded`). This is the same stored per-user kind used by Spend and Penny, not a separate chart mapping. Built-in categories and internal Income remain protected. The editor creates no categories, edits no payment labels, moves no funds and grants no coaching consent; destination evidence still overrides a declared spend or exclusion kind.

Not counted is an explicit choice, never an inferred default. It removes the category from spending comparisons while retaining its signed cash outflow separately in the pay split, so exclusion cannot increase Left. Refunds reduce that outflow. Card repayment exclusions are different: they prevent counting a purchase twice and do not create a second cash charge in the split. Declared custom movements and their matching savings credits count once. Group changes apply to the historical and future periods computed from the canonical kind. Reset restores the original recorded kind; for legacy entries without original metadata, the pre-edit kind is captured at the first edit rather than guessed as Free.

G347 consistency correction: Not counted contributes neither to Spend Out/category rows nor its daily pace line, and is never relabelled as a transfer or a payday destination. The existing group editor/pay split explains the exclusion; Spend does not gain a duplicate cash-flow line. Penny excludes it from spending history and correction targets, explains the choice on direct category questions, and reports excluded account debits separately while preserving total cash out. Cards retain excluded debit/credit totals separately from new spend and transfers; full balance change and payments still count every transaction.
