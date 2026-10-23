# Safe to Spend: wording review (G321)

Status: review document only, prepared 2026-10-23 for Kevin to choose from. No production copy has been changed. Nothing here is a legal conclusion: legal points are framed as questions for the A166 specialist (final section). Companion to `docs/compliance/perimeter-map.md` (A165), row 12 and the trade mark section.

Method note. Every `path:line` below was read in the G321 worktree at the commit the branch was cut from (origin/main at 28ee452c). Legal and regulator sources were opened on 2026-10-23 and the sentence relied on is quoted. Where a page could not be opened it is marked unverified and is not relied on.

## 1. Inventory

Each row quotes the string exactly as it appears in the code. IDs (S1, S2 and so on) are referred to again in section 3. Strings assembled from fragments are quoted as the assembled English with the fragment lines cited.

### 1.1 Home hero (`frontend/components/SafeToSpendCard.tsx`)

| ID | path:line | String |
|---|---|---|
| S1 | SafeToSpendCard.tsx:770 with `lib/pennyScreenViews.ts:94,99,100,104,105` | Label (eyebrow): "Safe to Spend" in the normal and tight states; "Cash before payday" (signed negative cash); "Shortfall before payday"; "Short after plans"; "Below your buffer" |
| S2 | `lib/pennyScreenViews.ts:93,99,100,104-107` | Status word chip: "On track", "Tight", "No headroom", "Plans gap", "Below buffer", "Check card bill", "Short", "Check forecast" |
| S3 | SafeToSpendCard.tsx:681-686 | Caption: "Available in cash until {payday}"; "short before payday"; "short after plans and envelopes"; "Last known cash figure until {payday}"; (buffer case, pennyScreenViews.ts:105) "below your safety buffer" |
| S4 | SafeToSpendCard.tsx:699-710 | Hero sentence: "{caption}, after {upcoming bills, plans, envelopes, your £N buffer}." (e.g. "Available in cash until 30 Oct, after upcoming bills, plans and your £110 buffer."); "After {...}, this is below your £N safety buffer."; "Short after {...}."; "After {...}, you are short before payday."; "{caption}. The cash forecast found £X, then held back £Y for an unconfirmed card repayment." |
| S5 | SafeToSpendCard.tsx:796 | " · estimated" (appended only when `data.estimated`, which is true only when fewer than 2 months of history exist, analytics.py:5295) |
| S6 | SafeToSpendCard.tsx:881 | "An estimate from your bank data, not financial advice." |
| S7 | SafeToSpendCard.tsx:734-735, 832-833 | Ledger disclosure on Home is "How we got £X" (or "How we got £X short"), then "Cash calculation" and "Exact steps". (The label "Full calculation" named in CLAUDE.md is Upcoming's, S19.) |
| S8 | SafeToSpendCard.tsx:689-690, 736, 837-841 | Ledger rows: "Cash available now" (detail "Across counted current accounts."), "Bills before payday", "Income before payday", "Lowest cash before payday", "Safety buffer", "Plans reserved", "Envelopes reserved", total "Cash available until payday" or "Cash position before payday" |
| S9 | `components/PooledLedgerExplainer.tsx:14,46,53`, rendered at SafeToSpendCard.tsx:846 (G304) | "This figure is shared by all your accounts. Spend it from one of them, not from each."; "Your envelopes hold back £X until payday." then "Edit them" "on Upcoming if you need some of that now."; "Your plan holds back £X." then "Edit it" "on Planning if it can wait." |
| S10 | SafeToSpendCard.tsx:488-508, 855-871 | Card block: "Repayment not confirmed"; "£X of this is held back because its repayment has not been identified."; "Purchases only. Balance transfers and repayments are not counted here."; "Card safety check"; "Unconfirmed card reserve" with "Held back because no repayment forecast has been learned."; "Safety position"; "The amount available above cannot fall below £0, so the shortfall stays visible here."; "The £X spent on cards is shown above for context. It is not part of this cash calculation."; "Transfers between your own included accounts do not change the total, so they are left out of this calculation." |
| S11 | SafeToSpendCard.tsx:613-614 | Error: "Your Safe to Spend figure is unavailable" / "Your accounts may still be visible, but we can't safely calculate what is free until payday." (button "Try again") |
| S12 | SafeToSpendCard.tsx:624-625 | Not enough history: "Your figure isn’t ready yet" / "We need a little more account history to map bills and work out what is safe until payday." (button "Check again") |
| S13 | SafeToSpendCard.tsx:637-638 | First sync: "Your figure is on its way" / "We are still fetching your transactions, so there is no verdict yet." |
| S14 | SafeToSpendCard.tsx:647-648 | Degraded: "We couldn't verify every set-aside" / "We're withholding the figure rather than risk showing more money as available than is actually safe." (button "Try again") |
| S15 | SafeToSpendCard.tsx:780, 791, 601 | "Couldn't refresh. Showing your last figure."; "Last known amount · as of {time}"; aria-label "Loading Safe to Spend" |
| S16 | SafeToSpendCard.tsx:33, 879 | "Not counting N account(s)"; "£X/day until {payday}" or "Pay period ends {payday}" |

### 1.2 Spend from line (`frontend/lib/spendFromAccount.ts` and the card)

| ID | path:line | String |
|---|---|---|
| F1 | spendFromAccount.ts:316-317 | "Spend up to £X from" {banks} (or "Spend up to £X in total from") |
| F2 | spendFromAccount.ts:319 | "{bank} can cover up to £Y." |
| F3 | spendFromAccount.ts:384-385 | "In {account} ({bank}): up to £X right now, the most your Safe to Spend allows." / "In {account} ({bank}): £X spare right now, within your Safe to Spend." |
| F4 | spendFromAccount.ts:407-408 | "Next best: {account}, up to £X, the most your Safe to Spend allows." / "Next best: {account}, £X spare in that account." |
| F5 | spendFromAccount.ts:375; SafeToSpendCard.tsx:352-353 | "No single account has spare to spend from right now."; "No current account has room to spend from right now." plus " Use the move above first." or " Checked account by account." |
| F6 | SafeToSpendCard.tsx:105, 189-190, 197 | "Each figure is what that account can cover, never more than your Safe to Spend."; rail heading "Spend from"; aria "Accounts with room to spend from"; "{name} at {bank}, £X spare" |
| F7 | spendFromAccount.ts:490, 506 | "Spend from: we could not check your accounts just now."; "Spend from: not available right now." |

### 1.3 Upcoming runway card (`frontend/components/upcoming/UpcomingHeroCard.tsx`)

| ID | path:line | String |
|---|---|---|
| S19 | UpcomingHeroCard.tsx:77, 112, 117, 124, 131, 138, 147-151, 164, 184-189, 194 | "Projected at payday" / "Projected at month end"; disclosure "Full calculation"; rows "Available now", "Income before payday", "Bills before payday", "Still to set aside", "Plans this period" ("Goal contributions could not be loaded, so this figure may be too high."), "Projected balance"; "Savings backup ... not included"; footer "Payments can take a day or two to appear, so a very recent one may not be counted yet." |

This card does not use the words "Safe to Spend". It does carry the only "may not be counted yet" caveat in the app; Home does not repeat it.

### 1.4 Home brief, first sync, account settings

| ID | path:line | String |
|---|---|---|
| B1 | `components/HomeBrief.tsx:2253-2275` | "Your first sync is still running. I will have a read on your money once it lands."; "Your Safe to Spend figure isn't ready yet. I'm still mapping the bills, so check back later."; "Nothing needs you today. Your pay period ends in a couple of days. The first week's bills are already mapped, so just cruise."; "Nothing needs you today. Cash is tight for the rest of this pay period, but the bills are mapped. I'll flag anything that needs you."; "Nothing new needs you. A card repayment still needs confirming in Safe to Spend below."; "Nothing new needs you. Your bills are covered, you're only short after the plans and envelopes you set aside, shown in Safe to Spend below."; "Nothing new needs you. You're short this pay period, the gap is shown in Safe to Spend below."; "Nothing needs you today. You've got headroom, and I'm watching the bills, enjoy it." |
| B2 | `components/FirstSyncCard.tsx:89, 97` | "Safe to Spend"; "No figure yet" (line 93 region); "We will show your Safe to Spend once {bank} has synced" |
| B3 | `components/CountTowardsSafeToSpendRow.tsx:11-12`; `components/AccountLedgerRow.tsx:206` | "Count towards Safe to Spend"; "Turn off for accounts you do not spend from, like a joint bills account."; aria ", not counted towards Safe to Spend" |

### 1.5 Penny answers, chips and model instructions

| ID | path:line | String |
|---|---|---|
| P1 | `backend/app/services/penny_chips.py:260-262` | "You're on track: about £X safe to spend, with N days to payday on {date}." and "You're tight: about £X safe to spend, ..." |
| P2 | penny_chips.py:264, 272-277 | "Bills are covered, but a card repayment still needs confirming..."; "You're about £X short after plans and envelopes... Your bills are covered; it's only the money you've set aside."; "You're about £X short of covering this pay period..." |
| P3 | penny_chips.py:282, 284 | "Part of this figure couldn't be worked out just now, so treat it as a cautious estimate."; "Your balance is projected to dip to about £X before then." |
| P4 | `backend/app/services/affordability.py:77-80, 197-198` | "Nothing spare until {payday} once your set-asides are counted; your bills are covered"; "Nothing spare until {payday}. A card repayment still needs confirming"; "Nothing spare until {payday}, bills come first"; "£X leaves £Y free" / "£X would take you −£Y" |
| P5 | `backend/app/services/penny_tools.py:4558-4561` (Home explainer) | "This is your Home brief. It leads with your Safe to Spend verdict, worked out from your live account balances and what's still due before payday. The figure updates as new transactions come in, so it reflects where things stand right now, not a forecast." |
| P6 | penny_tools.py:4738-4745, 4796-4799 | "Reserved money is notional, not physically moved. Two things get reserved before your Safe to Spend figure is worked out ..."; buffer explainer "... the smaller day-to-day buffer used inside Safe to Spend, which is a flat number you set yourself ..." |
| P7 | penny_tools.py:4852-4862, 4870 | "Safe to Spend's FREE figure is the money that's genuinely yours to spend before payday. It starts from the lowest point your spendable balance is projected to hit between now and payday ..."; Planning runway explainer "It differs from Safe to Spend's FREE figure only in that it ends at payday ..." |
| P8 | penny_tools.py:300-306 (tool description read by the model) | "The user's current safe-to-spend figure: the money that is genuinely free to spend before their next payday, already net of upcoming bills and set-asides. ... Use this for ANY question about how much the user can afford, has spare, or has left until payday. Figures are authoritative: quote them verbatim ..." |
| P9 | `backend/app/services/penny_agent.py:369-380` | Rule 2: a "safe-to-spend state of 'comfortable'/'tight'/'short'" is "ALREADY been decided by the backend ... Reproduce it faithfully, never paraphrase it into a different judgement, and never contradict or soften it."; rule 2a "Safe to Spend is a cash figure ... never turn a positive cash figure into a refusal unless the backend verdict says so."; rule 3 "Facts, never advice. Never say 'you should' ..."; rule 4 hedging of future events |
| P10 | penny_tools.py:5836, 6073-6086, 6114, 6183 | Proposal consequence lines: "Reduces safe to spend by about £X this period, less anything already paid in."; "Frees up its unfilled remainder in safe to spend until you resume it."; "Reserves its unfilled remainder from safe to spend again." |
| P11 | `frontend/lib/pennyScreenConfig.tsx:119-128`; `lib/pennyScreenViews.ts:134-136` | Chips "How am I doing until payday?" and "What's still due before payday?"; the figure label Penny quotes: "Safe to spend", "Short before payday", "Below your safety buffer", "Short after plans and envelopes" |
| P12 | `frontend/components/ConnectedAssistantsCard.tsx:187` | Connected-assistant tool label "safe to spend figure" (MCP `get_safe_to_spend`) |

### 1.6 Push notifications (`backend/app/services/notifications.py`)

No push names or quotes the figure. Adjacent strings that act on it: "Move £{amount} to {dest}" with body "Covers an expected bill before it's due." (notifications.py:600-603); "Short for plans" (notifications.py:607) with body "{who} looks about £X short of what its plans need after its payments through {date}. Review it on Upcoming." (notifications.py:421-424). Both are cross-referenced to perimeter-map row 13 and are out of scope here other than noting they do not name Safe to Spend.

### 1.7 Onboarding and tour (`frontend/components/TutorialContext.tsx`)

| ID | path:line | String |
|---|---|---|
| T1 | TutorialContext.tsx:57-60 | Title "What is safe to spend"; "Home leads with one number: what is genuinely yours to spend, after the bills still to leave and what is sitting on your cards." |
| T2 | TutorialContext.tsx:305 | "An envelope holds back money for a category in this pay period, so the runway does not treat it as free to spend." |

### 1.8 Settings, plan-tier and legal copy

No Settings or plan-tier string names the figure (grep of `frontend/app/settings` found none). One legal string does: `TERMS.md:86` "Figures shown in the app (including forecasts, "safe to spend" amounts, budget projections, and any other calculated figures) are **estimates** based on the transaction data available to us at the time. This data may be incomplete, delayed, or inaccurate (for example, due to a delay in your bank reporting a transaction, or a gap in your connected accounts), and these estimates may therefore be wrong." (M-L1)

### 1.9 Marketing kit (C22, G222 to G224) and store listings

Paths are under `frontend/` unless stated. Grep also covered `docs/` (only design notes and the perimeter map mention the figure, nothing user-facing), `frontend/remotion` and `frontend/public`. There is no `docs/store*` directory and `capacitor-spike` holds only privacy manifests and assets, so the store listing text lives in the two JSON files below.

| ID | path:line | String |
|---|---|---|
| M1 | app/design/marketing-kit/content.json:4 | "Know your room" / "An estimated Safe to Spend, with bills, plans and your buffer in view." |
| M2 | content.json:9 | Feature entry: name "Safe to Spend"; "See your room until payday."; "What can I spend before payday?"; "An estimate after upcoming bills, plans and your buffer. Open the calculation to see the working."; legal "Fictional example. Safe to Spend is an estimate, not financial advice."; "Start with the figure. See the working."; "See an estimated amount available until payday, then open the calculation to understand what is included. Bills, plans and your chosen buffer remain distinct." |
| M3 | content.json:29-32 and public/design-media/c22/listing-copy.json:4,5,7 (store listing) | Promotional text "See your estimated Safe to Spend, upcoming payments and the accounts that need attention. ..."; short description "See estimated Safe to Spend, upcoming bills and plans in one calmer money view."; description "SEE YOUR ROOM UNTIL PAYDAY / See an estimated Safe to Spend after upcoming bills, plans and your buffer. Open the calculation to understand the working. Estimates depend on the bank data and information available."; and "Example images use fictional data. Forecasts and suggestions are estimates, not guarantees." |
| M4 | app/design/marketing-kit/CampaignWorlds.tsx:12, 41 | "Life happens." "See what fits." "Meet your Safe to Spend."; legal "Fictional example. Safe to Spend is an estimate, not financial advice."; card label "Safe to Spend" with "Estimated · until 30 Oct" |
| M5 | app/design/ad-safe-to-spend/AdSafeToSpendClient.tsx:111-118, 139-140, 171, 175 (G222 static ads) | "Payday's {N} days away. What can you actually spend?" with "Sorted works out what's left after your bills."; "{£figure} is safe to spend until payday, by our estimate." with "Worked out from your bank, after bills and plans."; sum label "left to spend"; "Or one number, already worked out." |
| M6 | app/design/ad-safe-to-spend/fixtures.ts:68; remotion/End.tsx:6 | "Example figures. Safe to Spend is an estimate." |
| M7 | remotion/marketing-kit/MarketingFilm.tsx:15 | "What can I spend?" / "Estimated Safe to Spend, after bills, plans and your buffer." |
| M8 | remotion/c22-next/BalanceStory.tsx:21, 42; public/design-media/c22/next/balance.vtt (cue 00:00 and 00:07) | "Safe to Spend"; "Your Safe to Spend."; "But what is yours to spend?"; captions "£610 in the bank. But what is yours to spend?" and "Estimated Safe to Spend, until 30 October 2026." |
| M9 | public/design-media/c22/crafted/friday.vtt:10; receipt.vtt:10 | "Start with your number. Estimated Safe to Spend: £312. Fictional example."; "£312 estimated Safe to Spend until payday. Fictional example." |
| M10 | app/design/marketing-kit/next/CampaignGallery.tsx:15; next/PosterCanvas.tsx:12; fixtures.ts:150 | "£312 estimated Safe to Spend until 30 October 2026, with the current app view."; poster header "Safe to Spend"; "This plan would leave £272 Safe to Spend this period, £40 less than now. It does not move money." |

### 1.10 Count

Distinct inventory rows: 16 (Home) + 7 (Spend from) + 1 (Upcoming) + 3 (brief, first sync, settings row) + 12 (Penny) + 2 (tour) + 1 (legal terms) + 10 (marketing and store) = 52, plus the push-notification adjacency note. Rows S17 and S18 are intentionally unused (kept so the IDs match the working notes); S19 is Upcoming.

## 2. What the figure actually is, and when it can be wrong

Source: `backend/app/routers/analytics.py` `compute_safe_to_spend` (analytics.py:4929) and the hardening notes in CLAUDE.md (surface map, "Backend Safe-to-Spend hardening").

### 2.1 The calculation

1. Window. Today up to the next payday: the confirmed income schedule if present, else a calculated payday (analytics.py:4990-4993).
2. Starting cash. Live balances of the user's spendable current accounts, pooled into one number (analytics.py:5019 via `_live_pool_balances`, which calls `_split_balances`). Pool membership is `_account_pool_kind`: accounts the user switched off, non-GBP accounts and credit accounts are out, and a subtype containing "saving" goes to the savings bucket, not the spendable one; `_split_balances` also drops any account with a negative balance from both buckets.
3. Consent filter. A Yapily account counts only while its own consent is AUTHORIZED (analytics.py:2072-2090, docstring: "stale records from a revoked consent must never become phantom cash here", analytics.py:4938-4940).
4. User exclusions (G231). Accounts the user switched off "Count towards Safe to Spend" are dropped from the balance (`_account_pool_kind`) and from the bill and income lists (analytics.py:5026-5040).
5. Bills. Upcoming bills falling before payday from the learned recurring series (`upcoming_bills`), with own-account transfers into the pool removed (`pooled_transfers_excluded`, analytics.py:5053-5075) and credit-card charges kept out of the cash walk (`_touches_pooled_cash`, analytics.py:5065-5068).
6. Income. Pre-payday expected income from the cashflow cache (analytics.py:5086-5090). This is an expectation, not a received payment.
7. Walk. Bills and income are applied in date order. On the same day debits come before income (analytics.py:1980-1995), the conservative ordering. The lowest running balance in the window is the "safe floor" (analytics.py:5099-5101; algorithm steps at analytics.py:4955-4961).
8. Deductions. Figure = lowest balance minus the safety buffer (a flat number the user sets, analytics.py:5104-5105) minus commitments (plans) reserved minus allocations (envelopes) reserved (analytics.py:4955-4958).
9. Card repayments. Card balance growth is shown as a separate fact; only growth on a card whose repayment has not been identified is held back as a cautious reserve (analytics.py:4959-4961).
10. State. "short" if the figure is at or below zero; "tight" if below the larger of £100 and 10% of average monthly spend; otherwise "comfortable" (analytics.py:5270-5277). The Home status words are derived from these (pennyScreenViews.ts:89-109).

### 2.2 Fail-closed behaviour

If a reserve lookup (plans, envelopes, card growth) fails, the result carries `unavailable_components`, `calculation_status` becomes "degraded" (analytics.py:5335-5340) and the figure is clamped to at most zero (analytics.py:5253-5259). The card then withholds the figure (S14). A first sync still running reports "syncing" and the card shows no verdict (S13). An absent cashflow cache returns "insufficient_data" (analytics.py:4996-4998, S12).

### 2.3 What is not counted, and when it can be wrong

Each point is a property of the code above, not a measured error rate.

| Case | Why the figure can be wrong | Evidence |
|---|---|---|
| Accounts not connected, switched off, or in another currency | They add no cash and their bills and income are not walked, so the figure can be too low or too high | analytics.py `_account_pool_kind` (G231 switch, GBP-only, credit exclusion), 5026-5040 |
| Savings accounts | Deliberately excluded; money there is not "spendable" in this figure | analytics.py `_account_pool_kind` ("saving" in subtype) |
| Bills Sorted has not learned | Only the learned recurring series enter the walk, so a new, irregular or first-time bill is invisible and the figure is too high | analytics.py `upcoming_bills` (5000-5003, 5053-5059) |
| Income estimates | Expected pre-payday income is counted before it arrives; if it is late or smaller the figure is too high | analytics.py:5086-5090 |
| Thin history | `estimated` is true when under 2 months of history; the hero adds " · estimated" only then (S5) | analytics.py:5295 |
| Payments that post late | The walk starts from the last synced balance; whether a bank's balance already reflects a pending item is bank-dependent and was not verified in this review. Upcoming warns "Payments can take a day or two to appear" (S19); Home does not | UpcomingHeroCard.tsx:194; SafeToSpendCard.tsx (no equivalent) |
| Pending card transactions and credit cards | Card accounts are not in the cash pool; card growth is shown as a separate fact (S10) and is only reserved when no repayment series is learned | analytics.py:4959-4961 |
| Sync age | Balances are the last synced values; the card shows "Synced N hours ago" via `syncAgeLabel` but only as small text | SafeToSpendCard.tsx:372-381 region |
| Planned set-asides are notional | Plans and envelopes reduce the figure but nothing moves money; if the user spends the pooled cash anyway the plan is simply underfunded | PooledLedgerExplainer.tsx:46-53 |
| Buffer is a user setting | A zero buffer removes the safety margin the word "safe" may imply | analytics.py:5104 |
| Per-account headroom | The Spend from line is capped at the pooled figure but is computed per account, with its own bills and a flat buffer, so it can differ from the pooled walk | spendFromAccount.ts header comments; companion.py `_account_headroom` |

Notes. Pending bank-side debits matched to a learned bill are tracked as `observed_pending_bills` and are not double counted (analytics.py:4308-4316, 4676-4682); that is a protection for known bills only.

## 3. Assessment of each string

### 3.1 Sources read for this section (verified 2026-10-23)

| Source | URL | Sentence relied on | Status |
|---|---|---|---|
| PRIN 2A.5.3R | https://www.handbook.fca.org.uk/handbook/PRIN/2A/5.html | "(1) A firm must support retail customer understanding so that its communications: (a) meet the information needs of retail customers; (b) are likely to be understood by retail customers; and (c) equip retail customers to make decisions that are effective, timely and properly informed. (2) A firm must communicate information to retail customers in a way which is clear, fair and not misleading." | Verified (raw page text) |
| PRIN 2A.5.7G | same page | "(2) use plain and intelligible language ... (3) make key information prominent and easy to identify ... (4) avoid unnecessary disclaimers" | Verified |
| PRIN 2A.5.8R | same page | "the firm must tailor communications ... taking into account: (1) the characteristics of retail customers, including any characteristics of vulnerability; (2) the complexity of the product ... (4) the role of the firm, including whether the firm is providing regulated advice or information only." | Verified |
| PRIN 2A.2.8R and 2A.2.9R | https://www.handbook.fca.org.uk/handbook/PRIN/2A/2.html | "A firm must avoid causing foreseeable harm to retail customers." and "Foreseeable harm may be caused by both act and omission, in a firm's direct relationship with a retail customer or through its role in the distribution chain ..." | Verified |
| PRIN 2A.1.3G | https://www.handbook.fca.org.uk/handbook/PRIN/2A/1.html | "The Consumer Duty applies in relation to a firm's retail market business or where the firm communicates or approves financial promotions which are addressed to, or disseminated in such a way that they are likely to be received by, a retail customer." | Verified (page marked last updated 26/06/2026) |
| FG22/5 chapter 8 | https://fca.org.uk/publication/finalised-guidance/fg22-5.pdf (the FCA landing page URL returned "Page not found", so only the PDF is cited) | Para 8.1 "Consumers can only be expected to take responsibility where firms' communications enable them to understand their products and services, their features and risks, and the implications of any decisions they must make."; poor-practice example (a funeral plan sector example, not about budgeting apps) "did not give a balanced picture of plan limitations ... We expect firms to act in good faith and produce communications that provide a fair summary of the risks and benefits"; "Firms should avoid unnecessary disclaimers. Key information can be overlooked if detail is provided that is unnecessary for a particular communication" | Verified (PDF text, chapter 8) |
| DMCC Act 2024 s.225(1) | https://www.legislation.gov.uk/ukpga/2024/13/section/225 | "Unfair commercial practices are prohibited." | Verified; in force 6.4.2025 (S.I. 2025/272, reg. 2(1)) |
| DMCC Act 2024 s.226 | https://www.legislation.gov.uk/ukpga/2024/13/section/226 | s.226(1)(a) "the provision of false or misleading information relating to a product, a trader or any other matter relevant to a transactional decision"; (1)(b) "an overall presentation which is likely to deceive the average consumer"; (2) "information which, although true, is presented in a misleading way"; (3) "an overall presentation may be deceiving even if the information it contains is true." | Verified |
| DMCC Act 2024 s.227 | https://www.legislation.gov.uk/ukpga/2024/13/section/227 | s.227(1)(a) "omits material information"; (2) "'material information' means information that the average consumer needs to take an informed transactional decision."; (4) "references to omitting information include providing information (a) in a way that is unclear or untimely, or (b) in such a way that the consumer is unlikely to see it." | Verified |
| DMCC Act 2024 s.245, s.246 | https://www.legislation.gov.uk/ukpga/2024/13/section/245 and /section/246 | s.245 "transactional decision" includes decisions "relating to ... (a) the purchase or supply of a product ... (b) the retention, disposal or withdrawal of a product"; s.246(2) the average consumer "is (a) reasonably well informed, (b) reasonably observant, and (c) reasonably circumspect", (4) for a practice directed at a group, "an average member of that group" | Verified |
| CPRs 2008 regs 5 and 6 | https://www.legislation.gov.uk/uksi/2008/1277/regulation/5 (and /regulation/6) | The page now reads "Regulations revoked (6.4.2025 ...) by Digital Markets, Competition and Consumers Act 2024 (c. 13), ss. 251(1), 339(1)". The text of regs 5 and 6 is therefore no longer on the site for the current version, so the CPRs are mentioned only as the predecessor and are not quoted | Verified as revoked; text not relied on |
| RAO article 53 | https://www.legislation.gov.uk/uksi/2001/544/article/53 | "Advising a person is a specified kind of activity if the advice is (a) given to the person in his capacity as an investor or potential investor ... and (b) advice on the merits of his ... buying, selling, subscribing for, exchanging, redeeming, holding or underwriting a particular investment which is a security, structured deposit or a relevant investment" | Verified |
| PERG 8.24.1G | https://www.handbook.fca.org.uk/handbook/PERG/8/24.html | Restates article 53(1) as above, and 8.24.1A that a person authorised for other activities "only advises on investments ... if it is providing a personal recommendation" | Verified |
| PERG 8.28.1G and 8.28.2G | https://www.handbook.fca.org.uk/handbook/PERG/8/28.html | "advice requires an element of opinion on the part of the adviser. In effect, it is a recommendation as to a course of action. Information, on the other hand, involves statements of fact or figures."; "(3) Regulated advice includes any communication with the customer which, in the particular context in which it is given, goes beyond the mere provision of information and is objectively likely to influence the customer's decision whether or not to buy or sell." | Verified |

Two framing points taken from these sources, not conclusions. First, the unfair practices regime now sits in DMCC Act 2024 Part 4, Chapter 1 (ss.224 to 252); the CPRs 2008 are revoked. Second, article 53 and PERG 8.24 concern advice on investments (securities and relevant investments). Safe to Spend is a cash-flow figure, so the article 53 question arises mainly for Penny answers that could drift into investment-related suggestions (perimeter-map rows 1 to 8), not for the figure itself. PERG 8.28 is cited only for the information versus advice line.

### 3.2 Per-string assessment

Key: **fine**, **needs a qualifier**, **misleading as written**. These are drafting judgements against the sources above and the app's own rules, for the specialist to confirm or overrule.

| ID | Verdict | One-sentence reason |
|---|---|---|
| S1 label "Safe to Spend" | needs a qualifier | "Safe" is the one word that asserts a property the figure cannot guarantee (section 2.3), and the qualifier "estimated" appears only on the rare thin-history path (S5) and in the 11px disclaimer (S6). |
| S1 other eyebrows ("Cash before payday", "Shortfall before payday", "Short after plans", "Below your buffer") | fine | They describe the cash position in plain terms and carry no safety claim. |
| S2 "On track", "Tight", "No headroom", "Plans gap", "Below buffer", "Check card bill", "Short", "Check forecast" | needs a qualifier | "On track" is a verdict that reads as reassurance without saying what it rests on; the other words are factual states, and "Check forecast" is the honest fallback. |
| S3 "Available in cash until {payday}" | needs a qualifier | "Available" in cash echoes a bank "available balance" and omits that it is a forecast net of learned bills only; "Last known cash figure until {payday}" and "short before payday" are fine. |
| S4 hero sentence | needs a qualifier | It names what is subtracted (bills, plans, buffer) but not what is not counted, so the reader may assume it is complete (cf. s.227(1)(a) and PRIN 2A.5.3R(1)(c), questions Q2 and Q3). |
| S5 " · estimated" (thin history only) | needs a qualifier | Honest where it shows, but it is absent in the normal case, so the figure usually appears without the word. |
| S6 "An estimate from your bank data, not financial advice." | needs a qualifier | It is the right instinct, but it does not say the figure can be wrong, and at 11px in muted ink it may not be "prominent" (PRIN 2A.5.7G(3)); also PRIN 2A.5.7G(4) and FG22/5 warn against unnecessary disclaimers, so the fix is one useful line, not more small print (Q4). |
| S7 "How we got £X", "Cash calculation", "Exact steps" | fine | Shows the working and reconciles to the total; "Exact steps" sits beside a forecast, which is acceptable because the rows are labelled as before-payday projections. |
| S8 ledger rows | fine | Row labels are factual; "Cash available now" with "Across counted current accounts." correctly signals that only counted accounts are included. |
| S9 pooled sentence "Spend it from one of them, not from each." | needs a qualifier | It is an instruction to the user about how to act on the figure ("Spend it"), which edges from information toward a recommended course of action (PERG 8.28.1G is about investments, so this is a drafting point and a Q5 question, not a perimeter finding). |
| S9 "Edit them on Upcoming if you need some of that now." / "on Planning if it can wait." | needs a qualifier | Suggests releasing money held back for plans; matches the "recommendation, not a button" doctrine but is a nudge to reduce a saving, so it should be neutral ("You can edit ...") (Q5). |
| S10 card block | fine | Accurately states that card spend is not in the cash figure and that repayment reserve is a cautious fallback. |
| S11 "we can't safely calculate what is free until payday" | fine | A fail-closed message; "safely" here describes the calculation, not the user's money. |
| S12 "work out what is safe until payday" | needs a qualifier | Same "safe" claim as the label, in a message about the figure not existing yet. |
| S13 "there is no verdict yet" | fine | Clear and shows no figure. |
| S14 "rather than risk showing more money as available than is actually safe" | needs a qualifier | The behaviour is right (fail closed); the wording implies the app can know what is "actually safe", and does not tell the user what to do next (check their bank). |
| S15 "Showing your last figure." | fine | Says it is stale; pair with the sync age text. |
| S16 "Not counting N accounts" | fine | A useful partial "what this counts" signal, but it appears only when the user has excluded accounts. |
| F1 "Spend up to £X from {bank}" | needs a qualifier | An imperative on a specific bank account is the closest string in the app to a personal recommendation of a course of action (PERG 8.28.1G describes advice as "a recommendation as to a course of action", stated there for investments); reword as a statement of where the money is (Q5). |
| F2 "{bank} can cover up to £Y." | fine | Factual. |
| F3 "£X spare right now, within your Safe to Spend" / "up to £X ... the most your Safe to Spend allows" | needs a qualifier | "Spare" and "allows" read as permission; factual statements of balance would be safer. |
| F4 "Next best: ..." | needs a qualifier | "Next best" ranks accounts, an implicit recommendation; the brief's own doctrine says the app states a source as a sentence, not a ranking (memory: moves are recommendations, not buttons). |
| F5, F7 "No single account has spare to spend from right now." | fine | A neutral negative statement. |
| F6 "Each figure is what that account can cover, never more than your Safe to Spend." | fine | Explains scope; the word "never" is a statement about the cap, which the backend enforces (spendFromAccount.ts:123-127, G234). |
| S19 Upcoming runway | fine | Labelled "Projected", "estimated" where plans are missing, and it carries the late-posting caveat; this is the model for Home. |
| B1 "just cruise" and "You've got headroom, and I'm watching the bills, enjoy it." | misleading as written | The tone invites the user to relax and spend on the strength of an estimate that can be wrong and says "I'm watching the bills", which overstates what the app monitors (bills it has learned only); also conflicts with "no conviction on predictions" and the Calm Cockpit rule that predictions are hedged. |
| B1 other lines | fine | Describe the state without a safety promise; "Cash is tight ... but the bills are mapped" slightly overstates "mapped" and could add "that I know about". |
| B2 "We will show your Safe to Spend once {bank} has synced" | fine | Honest about timing. |
| B3 "Count towards Safe to Spend" / helper | fine | Gives users control and an honest account-scope signal. |
| P1 "You're on track: about £X safe to spend, with N days to payday" | needs a qualifier | "About" hedges the amount, but "safe to spend" is stated flatly and the sentence has no "estimated"; this is the string most likely to be read out of context in a chat bubble or notification preview. |
| P2 "Bills are covered, but ..." / "Your bills are covered; it's only the money you've set aside." | needs a qualifier | "Your bills are covered" is a categorical statement about all bills, true only of bills the engine knows (section 2.3, "Bills Sorted has not learned"). |
| P3 "treat it as a cautious estimate" | fine | Appropriate hedge on the degraded path; could say "check your bank". |
| P4 "Nothing spare until payday, bills come first" | needs a qualifier | "Bills come first" is advice-shaped; "Nothing spare" is stated as fact though it depends on what is counted. "leaves £Y free" is a calculation and fine. |
| P5 "it reflects where things stand right now, not a forecast" | misleading as written | The figure is the lowest point of a forward walk of expected bills and income to payday (analytics.py:5099-5101), which is a forecast; this sentence tells the user the opposite. |
| P6 | fine | Explanatory, and notes reservations are notional. |
| P7 "the money that's genuinely yours to spend" | misleading as written | "Genuinely" asserts certainty the engine does not have; it is the strongest claim in the app and is repeated in P8 and T1. |
| P8 "genuinely free to spend ... Use this for ANY question about how much the user can afford" | needs a qualifier | Model-facing text, but it shapes every Penny answer; "afford" invites a yes/no on spending and should be framed as "the estimate shows". |
| P9 rules 2, 2a, 3, 4 | needs a qualifier | The facts-not-advice and hedging rules are good safeguards (cross-reference A165 row 4 and row 12), but rule 2 ("never contradict or soften it") means Penny cannot add a caveat the backend did not supply, so any wording fix must be made in the backend string. |
| P10 "Reduces safe to spend by about £X" | fine | Factual consequence of a proposal; "about" is present. |
| P11 chip and figure labels | fine | Chips are neutral questions; the quoted label inherits the S1 point. |
| P12 "safe to spend figure" | fine | Label only. |
| T1 "what is genuinely yours to spend" | misleading as written | First-run explainer; same "genuinely" certainty, shown to a user who has not yet seen any caveat. |
| T2 "does not treat it as free to spend" | fine | Describes how a feature works. |
| M-L1 TERMS.md:86 | fine | Says plainly that "safe to spend" amounts "may therefore be wrong". It is the best caveat in the product and is not visible where the figure is read. |
| M1 to M4, M7, M10 "estimated Safe to Spend" | needs a qualifier | "Estimated" is present, which helps, but "Know your room" and "See your room until payday" are softer than the figure deserves and the legal line is small. |
| M5 "{£figure} is safe to spend until payday, by our estimate." | needs a qualifier | "By our estimate" hedges well; the ad headline "What can you actually spend?" and "Or one number, already worked out." promise more than "an estimate" delivers (Q2, and the ASA/CMA question in Q6). |
| M6, M2 legal lines | needs a qualifier | "Safe to Spend is an estimate" is honest, but "not financial advice" does not say it can be wrong. |
| M8 captions "£610 cash, less £188 expected bills, less £110 buffer. £312 estimated." | fine | Shows the arithmetic and says "estimated". |
| M3 store listing | needs a qualifier | "Estimates depend on the bank data and information available." is a good caveat; it could add what is not counted. |

Summary of the assessment. The engine is conservative (debit-first walk, buffer, fail closed). The wording risk is concentrated in three places: the word "safe" used without a persistent "what this counts" line on Home; three certainty phrases ("genuinely yours to spend" at P7, P8 and T1, "not a forecast" at P5, "enjoy it" and "just cruise" at B1); and the imperative Spend-from wording (F1, F3, F4, S9). None of these needs a design change to the hero; all are copy.

### 3.3 App rules check

| Rule | Where it holds | Where it does not |
|---|---|---|
| G283 and "no savings claims" (memory) | No string claims money saved | P10 "Frees up its unfilled remainder in safe to spend" is a consequence, not a savings claim |
| Hedged predictions (memory "no conviction on predictions"; PRODUCT.md principle 4 "honest estimates labelled as estimates") | S4 names what is netted; M2 to M10 say "estimated" | B1 "enjoy it", P5 "not a forecast", P2 "Your bills are covered" |
| Red is risk only (DESIGN.md Red Is Risk Rule) | S2 "Short" is the only risk tone; amber for the rest | Not at issue for wording |
| Fail closed when degraded (CLAUDE.md) | S14 and analytics.py:5253-5259 | S14 does not tell the user to check their bank |
| Facts, not "you should" (penny_agent.py rule 3) | Penny prompts | F1, S9 imperatives sit outside Penny, in the hero |
| Copy rules (British English, no em dashes) | The strings above | The section 5 proposed strings were checked against the copy rules (British English, no em dashes, no exclamation marks); existing code strings were not re-audited |

## 4. Comparable UK apps

All pages were opened on 2026-10-23. Where the page is third party or a community post, that is stated. "No equivalent found on the page" means the page opened but named no such figure, not that the product has none.

| App | Name of the equivalent figure | Page and date read | Caveats and quotes | Status |
|---|---|---|---|---|
| Monzo | "Left to spend" | https://community.monzo.com/t/what-does-left-to-spend-mean-in-the-app/107654 (community thread, read 2026-10-23; posts dated 21 October 2020) | Community member: "It's your current balance, minus any spend that Monzo knows will happen in the future." and an example "Left To Spend should show as £70 left to spend until {next pay day}". The thread has no Monzo staff reply, and says nothing on pots or pending items. A second thread (https://community.monzo.com/t/safe-to-spend-feature/84396, read 2026-10-23) has a poster guessing, and saying he is unsure, that Monzo uses "Left to Spend" not "Safe to Spend" and says other products use "Safe-to-Spend" (attributed in the thread to Simple, "trademark"), "Safe balance" (PocketSmith) and "Balance After Bills" (HSBC); these are community claims, not verified; the posts in that thread date from October 2019. Official Monzo help page: https://monzo.com/help/budgeting/left-to-spend/ returned 404 | Name verified via community only; official page unverified |
| Starling | No equivalent figure found | https://www.starlingbank.com/features/spending-insights/ (read 2026-10-23) | The page names no "left to spend", "safe to spend", "available" or "disposable" figure; it describes category and merchant breakdowns | Verified as absent on this page |
| Emma | "Left to spend" for a budget, and "left of" in the help centre | https://help.emma-app.com/en/category/budgeting-1s6usi4/ (read 2026-10-23); also https://emma-app.com/blog/how-budgeting-works-emma/ (read 2026-10-23, page dated 24 November 2019, modified 14 March 2025, which does not itself define the term) | Help article quoted on the category page: "'left of' is what's remaining from the total budget you have set in Emma; this is computed by taking your total budget and subtracting both committed and past spending" and "Your 'left of' from your total budget is always different from your available balance from your primary bank account", "two completely different concepts". A "Committed Spending" article says it "is used to calculate how much you have left to spend for the month". This is a budget remainder, not a cash-until-payday figure | Verified (help centre category page, summarised by the fetch tool, quotes as returned) |
| Snoop | No "left to spend" or "safe to spend" wording on the page read | https://apps.apple.com/gb/app/budget-planner-l-snoop-money/id1495077102 (App Store, read 2026-10-23) | "Snoop will warn you if we think you might not have enough money" and "warn you if we think any bills might not be covered"; accuracy depends on the user "Confirm[ing] your bills" and "Confirm[ing] your income - So we don't warn about bills unnecessarily". Hedged as "we think". Third-party reviews describe an overall budget "left to spend" but those pages were not opened | Verified for the quoted wording; the "left to spend" label itself unverified |
| Plum | "True Balance" | https://blog.withplum.com/true-balance/ (blog post dated 1 June 2020, read 2026-10-23) | "subtracting any regular payments from your available bank balance, to give an adjusted 'True Balance'" up to the next payday; users "can even edit the regular payments that Plum finds to fine-tune your balance further". No explicit accuracy disclaimer on the page | Verified |
| Chip | Not found | Search only; no Chip page was opened | Search results describe automated saving ("how much you can afford to transfer"), not a spend figure | Unverified |
| Moneyhub | Not found | https://finder.com/uk/budgeting/moneyhub-app-review returned 404 and https://moneyhub.com/features/budgeting returned 404 | None obtained | Unverified |
| Cleo | Not found | https://www.thepennyhoarder.com/budgeting/cleo-app-review/ returned 403 and https://web.meetcleo.com/ returned 403 | None obtained | Unverified |
| HyperJar | Jar balances; no "left to spend" wording found | https://hyperjar.com/ and https://apps.apple.com/GB/app/id1224672532 (read 2026-10-23) | Neither page names a remaining-to-spend figure; the product splits money into "jars" and spends from each jar | Verified as absent on these pages |

Observations, kept to what the pages show. The two names with a documented definition (Monzo "Left to spend", Plum "True Balance") are described by their own users or author as a balance net of known regular payments, and neither page opened uses the word "safe". Emma goes out of its way to say its figure is not the available balance. Snoop hedges as "if we think". No page opened attaches an explicit "this can be wrong" caveat to the figure itself, so there is no peer wording to copy and the caveats proposed below are Sorted's own.

## 5. Options

Common to every option (these fix the misleading-as-written rows in section 3, and the specialist should see them whichever label is chosen):

- Replace T1, P7, P8 "genuinely yours to spend" with "the estimate of what is left to spend".
- Replace P5 "not a forecast" with an accurate sentence (strings below).
- Replace B1 "just cruise" and "enjoy it" with a neutral line.
- Replace the Spend-from imperatives (F1, F3, F4, S9) with statements of where the money is.
- Add one always-visible "what this counts" line to the Home hero (new copy, below), mirroring Upcoming's late-posting line (UpcomingHeroCard.tsx:194).
- Keep the existing disclaimer slot (S6) but make it say the figure can be wrong.
- Degraded copy (S14) states the fail-closed behaviour and what to do next.

Strings are proposed copy only. They follow the app's rules (British English, no em dashes, no exclamation marks, currency minus kept) and are hedged. {payday} and £ values are placeholders.

### Option A: keep "Safe to Spend", add stronger qualifiers and an always-visible "what this counts" line

| Element | Replacement |
|---|---|
| Label (S1) | "Estimated Safe to Spend" |
| Status word "On track" (S2) | "Looks on track" (other words unchanged) |
| Caption (S3) | "About {£X} in cash until {payday}" |
| Hero sentence (S4) | "Estimated cash available until {payday}, after upcoming bills, plans and your {£110} buffer." |
| What this counts (new, under the hero, 12px, ink) | "Counts the current accounts you have connected and the bills Sorted has learned. Does not count other accounts, pending payments or bills it has not spotted." |
| Disclaimer (S6) | "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice." |
| Pooled sentence (S9) | "This figure is shared by all your accounts. It is not a separate amount for each one." |
| Spend-from lead (F1) | "Up to {£X} of this is in {bank}." (combined: "Up to {£X} of this is across {bank} and {bank}.") |
| Spend-from per-account (F3) | "In {account} ({bank}): {£X} of your estimate is in this account right now." |
| Spend-from (F4) | "Also in {account}: {£X}." |
| Plans and envelopes (S9) | "You can edit them on Upcoming." / "You can edit it on Planning." |
| Penny sentence (P1) | "Your estimated Safe to Spend is about {£X} until payday on {date}, with {N} days to go." plus "It does not count unconnected accounts, pending payments or bills I have not spotted." |
| Penny "not a forecast" (P5) | "It is an estimate worked out from your account balances and the bills and income Sorted expects before payday, so it can be wrong." |
| Penny P7 | "Safe to Spend is an estimate of what is left before payday. It starts from the lowest point your balance is projected to reach ..." |
| Tour (T1) | "What is Safe to Spend" / "Home leads with one estimate: what is left after the bills Sorted knows about, your plans and your buffer." |
| Brief (B1 last line) | "Nothing needs you today. Your estimate has headroom, and I am keeping an eye on the bills I know about." |
| Degraded (S14) | "We could not check everything" / "We are not showing a figure because part of the calculation could not be checked and it might be too high. Try again in a moment, or check your bank." |

Trade-offs. Keeps the brand term, the C22 assets and listing (which already say "estimated Safe to Spend") and the trade mark position as it stands. Does not remove the word "safe", so the residual question for the specialist is whether a qualified "safe" is acceptable (Q1). Adds one line of text to the hero, which is a design change to a production component and so needs a design round under CLAUDE.md before it is built; the specialist's view on PRIN 2A.5.7G(4) (avoid unnecessary disclaimers) bears on whether the line is wanted at all.

### Option B: rename to "Left to spend", same qualifiers

| Element | Replacement |
|---|---|
| Label (S1) | "Estimated left to spend" |
| Status word "On track" (S2) | "Looks on track" |
| Caption (S3) | "About {£X} left until {payday}" |
| Hero sentence (S4) | "Estimated cash left until {payday}, after upcoming bills, plans and your {£110} buffer." |
| What this counts (new) | "Counts your connected current accounts and the bills Sorted has learned. Not other accounts, pending payments or bills it has not seen yet." |
| Disclaimer (S6) | "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice." |
| Pooled sentence (S9) | "This figure is shared by all your accounts. It is not a separate amount for each one." |
| Spend-from lead (F1) | "Up to {£X} of this is in {bank}." |
| Spend-from per-account (F3) | "In {account} ({bank}): {£X} of your estimate is in this account right now." |
| Penny sentence (P1) | "You have an estimated {£X} left to spend until payday on {date}, with {N} days to go." plus "It does not count unconnected accounts, pending payments or bills I have not spotted." |
| Penny "not a forecast" (P5) | "It is an estimate worked out from your account balances and the bills and income Sorted expects before payday, so it can be wrong." |
| Tour (T1) | "What is left to spend" / "Home leads with one estimate: what is left after the bills Sorted knows about, your plans and your buffer." |
| Settings toggle (B3) | "Count towards Left to spend" |
| First sync (B2) | "We will show your estimated left to spend once {bank} has synced" |
| Degraded (S14) | "We could not check everything" / "We are not showing a figure because part of the calculation could not be checked and it might be too high. Try again in a moment, or check your bank." |

Trade-offs. Drops the word "safe", which is the only word asserting a property the figure cannot guarantee, and matches the plain name Monzo's users use (community-attested only, section 4). Costs: "Safe to Spend" is a named feature across the app, tour, Penny prompts, MCP tool label, design docs, ads, voice-over captions and the store listing, so this is the largest rewrite (file list in section 6); "left" implies a budget remainder to some users (Emma defines "left" against a budget, section 4), so the always-visible line matters; and Kevin loses a distinctive brand term whose trade mark status was never searched (perimeter map, "NOT SEARCHED"), which is a benefit and a cost at once.

### Option C: rename to "Available until payday" (or "Cash until payday")

| Element | Replacement |
|---|---|
| Label (S1) | "Estimated cash until payday" |
| Status word "On track" (S2) | "Looks covered" (other words unchanged) |
| Caption (S3) | "About {£X} free until {payday}" |
| Hero sentence (S4) | "Estimated cash free until {payday}, after upcoming bills, plans and your {£110} buffer." |
| What this counts (new) | "Counts the current accounts you have connected and the bills Sorted has learned. Does not count other accounts, pending payments or bills it has not spotted." |
| Disclaimer (S6) | "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice." |
| Spend-from lead (F1) | "Up to {£X} of this is in {bank}." |
| Penny sentence (P1) | "About {£X} of your cash looks free until payday on {date}, with {N} days to go." plus "It does not count unconnected accounts, pending payments or bills I have not spotted." |
| Penny "not a forecast" (P5) | "It is an estimate worked out from your account balances and the bills and income Sorted expects before payday, so it can be wrong." |
| Tour (T1) | "What is cash until payday" / "Home leads with one estimate: the cash left after the bills Sorted knows about, your plans and your buffer." |
| Settings toggle (B3) | "Count towards cash until payday" |
| Degraded (S14) | "We could not check everything" / "We are not showing a figure because part of the calculation could not be checked and it might be too high. Try again in a moment, or check your bank." |

Trade-offs. The most neutral and descriptive wording: it describes a cash position, not permission, and removes both "safe" and "spend". Costs: it is the longest label for an 11px eyebrow and the weakest brand handle; "available" and "free" invite confusion with a bank's available balance (Emma's help page explicitly warns against that confusion, section 4); the same rewrite footprint as B; and the app's existing hero sentence already says "Available in cash until", so the label and caption would repeat each other.

### Degraded and error states, all options

The degraded card (S14) should say three things in plain words: no figure is shown, why (a part could not be checked and the number might be too high), and what to do (try again, or check the bank). The error card (S11) and not-enough-history card (S12) should drop "safely" and "safe" in Options B and C, and in Option A may keep them only with "estimate" nearby. In all options keep the figure clamped at zero and never red unless a dated payment gap is genuine (DESIGN.md Red Is Risk Rule).

## 6. Recommendation and files that would change

Recommendation (a drafting view for Kevin to choose from, not legal advice): prefer Option B with the common fixes, because it removes the one word that asserts safety while keeping the cash-until-payday meaning and a name users already know from Monzo's community explanation. Option A is the lower-churn fallback if Kevin wants to keep the brand term, since the marketing kit and store listing already say "estimated Safe to Spend". Option C is not recommended because "available" collides with a bank's available balance. Whichever is chosen, the common fixes (the "genuinely", "not a forecast", "enjoy it" and Spend-from wording, and the always-visible counts line) should ship, and the label decision is best confirmed with the A166 specialist first.

Files that would change. No edits have been made. Each design-affecting change (the new hero line, the label) needs a design round first under CLAUDE.md.

Common to all options:
- `frontend/components/SafeToSpendCard.tsx` (S3 to S6, S9 wiring, S12, S14, new counts line)
- `frontend/components/PooledLedgerExplainer.tsx` (S9)
- `frontend/lib/spendFromAccount.ts` (F1 to F4)
- `frontend/components/HomeBrief.tsx` (B1)
- `frontend/components/TutorialContext.tsx` (T1)
- `backend/app/services/penny_chips.py` (P1 to P3)
- `backend/app/services/penny_tools.py` (P5 to P8, P10)
- `backend/app/services/affordability.py` (P4)
- `backend/app/services/penny_agent.py` (rules 2 and 2a so a backend caveat is allowed)
- `frontend/components/upcoming/UpcomingHeroCard.tsx` (only if the late-posting line is to be shared with Home)
- Tests that pin strings: `frontend/scripts/g304-ledger-explainer.test.mjs`, `g218-figure-tone.test.mjs`, `spend-from-account.test.mjs`, `spend-from-render.test.mjs`, `first-sync-card.test.mjs`, `g221-home-cleanup.test.mjs`, `penny-screen-views.test.mjs`, and the backend tests for `penny_chips.py` and `affordability.py` (names to be confirmed at build time)
- `DESIGN.md` (hero section, if the label changes) and `perimeter-map.md` row 12 (refresh wording samples)

Option A additionally: `frontend/lib/pennyScreenViews.ts` (eyebrow strings, S1 and S2 status words); marketing strings only where "estimated" is absent (`frontend/app/design/ad-safe-to-spend/AdSafeToSpendClient.tsx`, `frontend/app/design/marketing-kit/content.json`).

Options B and C additionally (the rename footprint): `frontend/lib/pennyScreenViews.ts`, `frontend/components/FirstSyncCard.tsx`, `frontend/components/CountTowardsSafeToSpendRow.tsx`, `frontend/components/AccountLedgerRow.tsx`, `frontend/components/ConnectedAssistantsCard.tsx`, `frontend/app/components/AccountsPage.tsx` (labels only), `TERMS.md` line 86, marketing and store text (`frontend/app/design/marketing-kit/content.json`, `frontend/public/design-media/c22/listing-copy.json`, `CampaignWorlds.tsx`, `next/CampaignGallery.tsx`, `next/PosterCanvas.tsx`, `frontend/app/design/ad-safe-to-spend/*`, `frontend/remotion/End.tsx`, `frontend/remotion/marketing-kit/MarketingFilm.tsx`, `frontend/remotion/c22-next/BalanceStory.tsx`, the `.vtt` caption files under `frontend/public/design-media/c22/`), which are finished assets and would need re-rendering and a fresh compliance read.

## Questions for the specialist

These are questions, not conclusions. They are also appended as a note on A166.

1. Q1. Is the word "safe" in a label ("Safe to Spend") capable of being a misleading action under DMCC Act 2024 s.226(1)(a) or (b), or a misleading omission under s.227(1)(a), when the figure is an estimate that can be wrong and is shown with an estimate qualifier? Does an "estimated" prefix change the answer?
2. Q2. Is a financial-guidance cash-flow figure shown in an app to a consumer a commercial practice relating to a "transactional decision" (s.245) in the way the Act requires, given that the user's decision is about spending their own money rather than buying a product? If it is relevant, is the average consumer (s.246) a person who knows the figure ignores bills the engine has not learned?
3. Q3. Does PRIN 2A apply to Sorted at all, given the firm acts as an agent of an authorised principal (PRIN 2A.1.3G refers to a firm's retail market business or financial promotions), and if so is a persistent "what this counts" line needed to meet PRIN 2A.5.3R(1)(c), or does the guidance against unnecessary disclaimers (PRIN 2A.5.7G(4), FG22/5 chapter 8) point the other way?
4. Q4. Is the current 11px muted disclaimer ("An estimate from your bank data, not financial advice.") adequate, or must the "can be wrong" point be more prominent (PRIN 2A.5.7G(3))? How should it be tested (PRIN 2A.5.10R)?
5. Q5. Do the Spend-from imperatives ("Spend up to £X from {bank}", "Spend it from one of them", "Next best") and the "Edit them ... if you need some of that now" nudge amount to a recommendation of a course of action in any regulated sense, bearing in mind that article 53 and PERG 8.24 concern investments and that PERG 8.28.1G draws the information versus advice line there? Is neutral statement of balances sufficient for the app's own "recommendation not button" rule?
6. Q6. For the marketing kit (headlines "What can you actually spend?", "Or one number, already worked out.", "is safe to spend until payday, by our estimate."), is the CMA/DMCC regime or the ASA/CAP code the primary lens, and are the legal lines ("Safe to Spend is an estimate, not financial advice") enough?
7. Q7. Is the "genuinely yours to spend" wording (Penny explainer, tour) and the "your bills are covered" wording defensible given that only learned bills are counted, and should Penny be allowed to add a caveat the backend has not supplied?
8. Q8. Trade mark and distinctiveness: A165 left "Safe to Spend" NOT SEARCHED. A community post claims another product used "Safe-to-Spend" as a trade mark (unverified). Should the name be searched and cleared before any decision to keep it (Option A)?
9. Q9. Vulnerable customers (PRIN 2A.5.8R(1)): does a reassuring status word ("On track", "You've got headroom ... enjoy it") create foreseeable harm (PRIN 2A.2.8R) for users in financial difficulty, and should the tone differ when the figure is near zero?

## Appendix: citation register

All opened 2026-10-23 unless noted. Verified means the quoted sentence was read in the page or PDF text.

| Citation | URL | Status |
|---|---|---|
| PRIN 2A.5.3R, 2A.5.7G, 2A.5.8R | https://www.handbook.fca.org.uk/handbook/PRIN/2A/5.html | Verified |
| PRIN 2A.2.8R, 2A.2.9R | https://www.handbook.fca.org.uk/handbook/PRIN/2A/2.html | Verified |
| PRIN 2A.1.3G | https://www.handbook.fca.org.uk/handbook/PRIN/2A/1.html | Verified |
| FG22/5 chapter 8 | https://fca.org.uk/publication/finalised-guidance/fg22-5.pdf | Verified (PDF); FCA landing page URL returned "Page not found" |
| DMCC Act 2024 ss.225, 226, 227, 245, 246 | https://www.legislation.gov.uk/ukpga/2024/13/section/225 (and /226, /227, /245, /246) | Verified |
| CPRs 2008 regs 5, 6 | https://www.legislation.gov.uk/uksi/2008/1277/regulation/5 | Verified as revoked 6.4.2025; text not relied on |
| RAO 2001 article 53 | https://www.legislation.gov.uk/uksi/2001/544/article/53 | Verified |
| PERG 8.24.1G | https://www.handbook.fca.org.uk/handbook/PERG/8/24.html | Verified |
| PERG 8.28.1G, 8.28.2G | https://www.handbook.fca.org.uk/handbook/PERG/8/28.html | Verified |
| Monzo community, what does left to spend mean | https://community.monzo.com/t/what-does-left-to-spend-mean-in-the-app/107654 | Verified (community post, not official) |
| Monzo community, safe-to-spend feature | https://community.monzo.com/t/safe-to-spend-feature/84396 | Verified (community post; claims inside it unverified) |
| Monzo help page | https://monzo.com/help/budgeting/left-to-spend/ | Unverified (404) |
| Starling Spending Insights | https://www.starlingbank.com/features/spending-insights/ | Verified (no such figure on page) |
| Emma help centre budgeting | https://help.emma-app.com/en/category/budgeting-1s6usi4/ | Verified |
| Emma blog | https://emma-app.com/blog/how-budgeting-works-emma/ | Verified (does not define the term) |
| Snoop App Store listing | https://apps.apple.com/gb/app/budget-planner-l-snoop-money/id1495077102 | Verified |
| Plum True Balance | https://blog.withplum.com/true-balance/ | Verified |
| Chip | no page opened | Unverified |
| Moneyhub | finder.com review and moneyhub.com features page both 404 | Unverified |
| Cleo | thepennyhoarder.com review and web.meetcleo.com both 403 | Unverified |
| HyperJar | https://hyperjar.com/ and https://apps.apple.com/GB/app/id1224672532 | Verified (no such wording on pages) |
