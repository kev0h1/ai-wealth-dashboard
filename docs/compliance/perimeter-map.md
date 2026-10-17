# Perimeter map: Sorted features that suggest, compare or explain money decisions

Status: DRAFT fact map for a qualified reviewer (board item A165, feeds A166). Written 2026-10-17 against `main` at commit 70aedcf8 unless a reference starts with `G283:`, which means the local branch `feature-G283-no-savings-claims` (in progress, not merged, not on origin at the time of writing).

## How to read this document

- It records wording, behaviour, safeguards and open questions. It states no legal conclusions. It does not say that any feature is, or is not, regulated, authorised, exempt or compliant. Every "regime" entry is a question for the specialist.
- Every wording sample is quoted from the code or a repository document with a `path:line` reference. Line numbers are for commit 70aedcf8. Where a sample is a code template, the "Example output" line shows what the template renders to with the stated inputs; those rendered examples are illustrations built from the template, not captures of real user data. No real user data was read.
- "Does" uses a fixed vocabulary: inform (shows a fact), compare (sets a figure beside another), wording that points at a choice (used instead of "recommend", which this document does not use as a defined term), propose an action (a card or Penny proposal the user may accept), execute nothing (Sorted never moves money; see AIS-only boundary below).
- Regime questions use these shorthand names: RAO (the FCA Regulated Activities Order activities, for example debt counselling, credit broking, advising on regulated mortgage contracts, advising on investments); FSMA s21 (the financial promotions restriction); Consumer Duty (reached through Finexer, the principal, and the Finexer Client Terms 5.9 and 5.10); CMA/ASA/DMCC (misleading-claims rules and the Digital Markets, Competition and Consumers Act 2024); targeted support (the FCA targeted-support regime, asked only as a status question).
- Finexer Client Terms clause 5.9 is not in this repository. Only a summary of 5.10 is (TODO.md:521, "5.10 (Consumer Duty: Finexer may ask for consent completion and abandonment rates and reasons"). Clause text is therefore unverified here and Kevin or the specialist must supply it.

## AIS-only boundary (applies to every row)

- TERMS.md:84: "Sorted provides **information and general guidance only**. It does **not** provide regulated financial advice, investment advice, tax advice, or debt counselling, and nothing in the app should be treated as a personal recommendation."
- PRIVACY.md:21: "**We never initiate payments and we never move your money.** We only read data from accounts you choose to connect."
- frontend/components/Onboarding.tsx:632: "Link your account in seconds via secure open banking. Wealth can only read data, it can never move your money." (note: uses the old product name "Wealth", see copy observations)
- Penny is propose-only: PENNY_TOOLS.md:81 "Write tools (propose-only)": "She still never executes anything herself." (PENNY_TOOLS.md:89). Consent gate: PENNY_TOOLS.md:94 (`penny_agent_consent`, `POST /penny/agent-consent`).
- Where the "general information, not regulated financial advice" line actually appears in the product (verified by grep across frontend, backend and content): `frontend/components/PennyComposer.tsx:103` ("General information, not regulated financial advice."), `frontend/app/design/marketing-kit/content.json:15` (store description, a design preview file), `TERMS.md:84`. The component `frontend/components/AdviceDisclaimer.tsx:8-11` holds the same sentence ("Figures and suggestions here are for general information only and are not regulated financial advice.") but nothing imports it (grep for `AdviceDisclaimer` finds only its own file). Other disclaimers use different words and are listed per row.

## Feature rows

### 1. Debt plan and card splits (/cards, debt_plan.py, scenario B)

- Surface and route: `/cards` (`frontend/app/cards/CardsPage.tsx`), Planning's debt buckets (`frontend/app/planning/LongTermPlanningPage.tsx`), Home cards, Penny read tool `get_debt_position` (`backend/app/services/penny_tools.py:3470-3531`, which carries scenario B, extra-to-clear and transfer routes).
- Engine: `backend/app/services/debt_plan.py`, deterministic, no model (module docstring lines 1-30). Scenario B "same total movement, avalanche (highest rate first)" at `debt_plan.py:631-636`; extra-to-clear at `debt_plan.py:954`.
- Wording samples:
  - `frontend/app/cards/CardsPage.tsx:200`: "At your pace every carried card would clear by {month}."
  - `frontend/app/cards/CardsPage.tsx:201`: "{amount} more a month would clear every carried card by {month}."
  - `frontend/app/cards/CardsPage.tsx:75`: "clears in full each month".
  - `backend/app/services/penny_tools.py:4651`: "Debt tracking now lives on Cards. It separates what you carry from month to month from spending you clear in full, and tracks the pace you're clearing the carried balance at."
- Example output: with a demo carried balance and a monthly movement of £0 extra, "At your pace every carried card would clear by Mar 2028." (template at CardsPage.tsx:200). Penny tool output carries `scenario_b.interest_saved` and `months_sooner` fields (penny_tools.py:3505-3513) which Penny may quote.
- What it does: informs and compares. The extra-to-clear line states what an additional monthly sum would do to the clear date (a projection). Scenario B compares the user's current pattern with a re-ordered one (dearest card first); the frontend does not render scenario B (grep of `frontend/app`, `frontend/components`, `frontend/lib` for `scenario_b` finds nothing), so it reaches users only through Penny's tool output. Executes nothing.
- Regime questions: Does stating a clear date for "£X more a month", or comparing "dearest card first" against the user's own order, amount to debt counselling or debt adjusting, or does it stay general information? Does Penny quoting `scenario_b.interest_saved` change that answer? Do the figures amount to a personal recommendation? Consumer Duty via Finexer: is a debt projection within what Finexer expects of an AIS-only agent?
- Safeguards: projection wording "would clear" not a promise (comment at CardsPage.tsx:193-196); every assumption surfaced in an `assumptions` list (debt_plan.py:8-9); rates never guessed, unknown rate stops interest accruing and says so (debt_plan.py:8-9); Penny rule 3 "Facts, never advice. Never say 'you should', never recommend a financial product or provider (FCA rule)." (`backend/app/services/penny_agent.py:382-383`); Penny rule 8 (penny_agent.py:415-422) answers advice-shaped questions with facts and "Never suggest a specific action"; TERMS.md:84 and TERMS.md:90 ("such as taking on or restructuring debt ... you should seek independent, regulated financial advice").
- Open questions: no "not advice" line sits on `/cards` itself (grep of CardsPage.tsx finds none). Scenario B is exposed over MCP if `get_debt_position` is exposed there (not verified in this pass; check `backend/app/routers/mcp.py`). TODO.md:612 records that production release of the debt-plan suggestions is held pending A166.

### 2. 0% promotions and balance-transfer (refinance) routes

- Surface and route: card terms entered by the user (`frontend/components/CardTermsSheet.tsx`), "Next 0% offer ends" on Planning, Home promo-cliff cards (`backend/app/services/companion.py:5621`), Penny `get_debt_position.transfer_routes`.
- Wording samples:
  - `frontend/components/CardTermsSheet.tsx:473`: "Balance transfers you've already made count here, add each one and when it ends."
  - `frontend/components/CardTermsSheet.tsx:597`: "Any 0% offers you haven't used yet?"
  - `frontend/app/planning/LongTermPlanningPage.tsx:139`: "Next 0% offer ends {date}".
  - `backend/app/services/companion.py:5621`: "{rate} on balance transfers at {card} ends {when}, {balance} is on it."
- Engine: `backend/app/services/debt_plan.py:796-885` `_compute_refinance_options` "BT refinance options from the user's own captured bt_offers only", emitted only when interest saved exceeds the fee (docstring lines 797-803). It computes `net_saving` and `break_even_weeks` between the user's own cards. Surfaced only via Penny tool output `transfer_routes` (`penny_tools.py:3521-3534`); the frontend does not render it.
- What it does: informs about the user's own recorded terms; the refinance engine compares the user's own cards on a stated-assumption basis (`assumptions_opt`: "if the limit allows", "assumes the balance holds across the window", debt_plan.py:857-866). The tip pipeline is the opposite: it is barred from suggesting transfers (next bullet).
- Safeguards: tips ban card balance transfers: `backend/app/routers/savings_insights.py:1607-1610` ("Balance transfers and moving credit card debt are NEVER advice in this product.") and `savings_insights.py:2162`; regex backstop `_CARD_DEBT_MOVE_RE` at `savings_insights.py:177-190` drops an insight that drifts into this (one regeneration attempt, then dropped, comment at lines 168-176). Terms are ASKED not guessed (`backend/app/services/card_rates.py:4`). Memory fact (project_debt_planner): "BT notice-and-ask".
- Regime questions: Is the notice-and-ask treatment of balance transfers (no tip, only the user's own recorded offers) outside credit broking, or does the Penny-only `transfer_routes` output (a computed net saving between two of the user's own cards) raise a credit-broking or debt-advice question? Does an entered 0% end date shown back as "Next 0% offer ends" need any wording?
- Open questions: the tool output name `transfer_routes` and fields `interest_saved` and `net_saving` are savings-claim shaped, which G283 removed from tips but did not touch here (G283 scope is tips, Home and Penny `get_insights`). Which of these Penny may speak is governed only by Penny rules 3 and 8.

### 3. Mortgage and car-finance tips

- Surface and route: tip cards on Spend and Home, `InsightCard` (`frontend/components/InsightCard.tsx`), generated by `backend/app/routers/savings_insights.py`; category configs `savings_insights.py:41-50`; user-entered situation workflow `savings_insights.py:763-783` ("Add your mortgage details": type, rate, "Amount outstanding", "When does your deal end?"; "Add your finance details").
- Research query (sent to Tavily): `savings_insights.py:43` "best mortgage remortgage deals UK {year} lowest fixed rate switch lender" and `savings_insights.py:48` "refinance car loan UK {year} best rate save money PCP HP alternatives".
- Outbound links on the tip card: `frontend/components/InsightCard.tsx:33` mortgage: "Habito" (https://www.habito.com) and "MSE Mortgages"; `InsightCard.tsx:34` car finance: "MoneySuperMarket" and "MSE Car Finance". No affiliate or referral parameter appears in these URLs, and a grep for "affiliate", "referral fee" and "commission" across backend, frontend and root documents finds none (commercial arrangements, if any, are unverified: nothing in the repository).
- Wording on main (before G283): the model prompt asks for a "HIGHLY PERSONALISED savings insight ... Give concrete next steps they should take right now." (`savings_insights.py:1671-1672`, the "Give concrete next steps" sentence) and says switching a mortgage or car-finance deal to a new lender "is NOT covered by this ban and is exactly what this insight should help with." (`savings_insights.py:1609-1611`; retry text at `savings_insights.py:1716-1722`: "You may still suggest switching a mortgage or car finance deal to a new lender; that is fine.").
- Example output on main (illustrative of the style the prompt asks for, from the G283 "Before" column, docs/copy/tips-facts-samples.md on the G283 branch, section 4): Title "Car insurance renews soon, worth switching?" Body "Comparing quotes could cut your premium. We recommend checking three comparison sites at least 21 days before renewal." (That sample is car insurance, shown here because it is the only "Before" example in the G283 document that uses the recommend-style wording; mortgage and car-finance outputs use the same prompt.)
- What it does on main: compares (what the market lists) and uses wording that points at a choice (switching a mortgage or car-finance deal to a new lender is an explicitly desired output; outbound link to a mortgage broker). After G283: states facts only (see row 4).
- Regime questions: Does a tip that points a user at "switching" a mortgage or car-finance agreement, with a link to a named broker, amount to advising on a regulated mortgage contract or credit broking? Does the answer differ before and after G283, and for the outbound link alone? Is the named link (Habito) a financial promotion by Sorted? Is any consideration received for the links (Kevin to confirm)?
- Safeguards: hedging rules (`savings_insights.py:1612-1618`: forward-looking statements hedged; no alarm framing); `_NON_UK_RE` UK-only filter (`savings_insights.py:163`); card-debt regex (row 2); G283 banned-phrase gate and facts-only composition (row 4). TODO.md:741 (B48 note): "production release of this guidance feature is held pending the regulatory perimeter review (A166). It may stay live on UAT." The G39 note (savings_insights.py:133-137) records mortgage and car finance became their own categories on 2026-09-11.
- Open questions: should the mortgage and car-finance categories keep a tip at all until A166 answers, or show only the user's own figure? The research query strings still contain "best", "cheapest", "switch lender", "save money" (savings_insights.py:43, 48, 63, 83); G283's gate filters output, not the query.

### 4. Other bill tips and savings tips (energy, broadband, mobile, insurance, groceries; facts-only after G283)

- Surface and route: Spend tips subline and card, Home spotlight, push notification "New money insight" (`backend/app/services/notifications.py:192-199`, sends the top tip's title to `/spend`), Penny `get_insights`.
- Wording on main (before G283), from the code and the G283 sample document:
  - `savings_insights.py:1661`: model told to write e.g. "You pay EE £46/mo, SIM-only could cut that to ~£12".
  - `savings_insights.py:2304`: composed sentence "That could save about {amount} a month against the top of that range."
  - `savings_insights.py:2293`: "Offer ends {day} {month}." (a dated offer, appended when valid).
  - `frontend/components/InsightCard.tsx:168`: "~£{total}/mo · {n} place(s)"; Onboarding.tsx:352: "Get AI-powered insights to save more money".
  - G283 "Before" samples (docs/copy/tips-facts-samples.md on the G283 branch): "You pay EE £57/mo, SIM-only could cut that sharply"; "which could save you ~£52/month compared to your current EE spend."; Home stat "£X/mo saved".
- Wording after G283 (the safeguard, on the branch, not yet on main): "You pay EE £57 a month" and "SIM-only plans are listed at £5 to £6 a month. Also listed: iD Mobile £6 a month, Asda Mobile £5 a month, Lebara £5 a month. Checked 14 Oct, source uswitch.com." (G283:docs/copy/tips-facts-samples.md section 1 "After"). Resolved tips: "Payments to Nandos stopped." with no figure (same file, "Resolved tips").
- What it does: before G283, estimates and states potential savings and (in the prompt) gives "concrete next steps"; after G283, informs (user's own payments, dated and sourced listings) and executes nothing. B48 splits research into a shared non-personal layer and a personal layer (`backend/app/services/tip_research.py:1-31`).
- Regime questions: Does a "listed at" comparison naming providers and prices, with source host and date, remain information, or does naming providers make it a personal recommendation or a promotion? Is the "Offer listed until D" dated-deal line a financial promotion by Sorted? CMA/ASA/DMCC: were the earlier "~£X/mo saved" statistic and "could save" estimates, now removed on the branch, capable of being a misleading claim, and is anything already live in production (release state unverified here; Kevin to confirm the production release tag) that needs correction?
- Safeguards in place (existing safeguard recorded per Kevin 2026-10-17): G283 facts-only doctrine, `G283:ENGINE.md:154-160` ("A tip never claims or estimates a saving ... No 'could save', 'cut', 'cheaper for you', no recommendation, and no product is ever named as the user's best option."); fail-closed banned-phrase gate `G283:backend/app/services/tip_copy.py:25-45` (list: save, saves, saved, saving, savings, cut, cheaper, cheapest, could, should, recommend, best, worth switching, switch to; category name "Savings" and account types allowed), applied to the shared findings, personal composition, optional LLM phrasing, serializer and Penny `get_insights` (ENGINE.md:159 on the branch); frontend twin check `npm run check:g283-no-savings-claims`; removal of `GET /value-delivered`, the Home saved stat and the `insight_win` celebration; `verified_savings` never serialised (ENGINE.md:158 on the branch). Shared research holds no user data: `tip_research.py:17-19` ("a document holds NO user id, amount, transaction, name or per-user count"; `assert_no_user_data` fails closed). Before G283 the prompt rules at `savings_insights.py:1616-1617` (rule 4, hedge any savings figure) and `:1618-1632` (rules 5 and 6, derived-only monthly estimates) required hedging, which are weaker than a ban.
- Open questions: G283 is not merged; until it is, main still carries the estimates and the push title can carry a savings-claim tip title (notifications.py:199). The G283 wording is awaiting Kevin's approval (its sample document says so, including whether provider names with prices are acceptable). Onboarding.tsx:352 ("save more money") is outside G283's scope and still on main.

### 5. Investment growth (G271, G277, G278): growth card, provider anchor, Penny `get_investment_growth`

- Surface and route: Accounts, under an expanded investment account (`frontend/components/InvestmentGrowthSection.tsx`, `PortfolioGrowthCard.tsx`, drill-in `PortfolioGrowthDetail.tsx`, anchor sheet `frontend/components/portfolio-growth/AnchorSheet.tsx`); Penny read tool `get_investment_growth` (`backend/app/services/penny_tools.py:3620-3710`; exposed over MCP as `accounts:read`, PENNY_TOOLS.md:66); engine `backend/app/services/investment_growth.py`.
- Wording samples:
  - `frontend/lib/investmentGrowth.ts:125-129` (shown verbatim on every growth surface): "Capital at risk." / "Past performance is not a guide to future returns." / "Prices are end of day and may be delayed."
  - `frontend/lib/investmentGrowth.ts:131`: "Growth is simple: what each holding is worth now minus what you paid for it. ... A holding with no known cost adds nothing to the gain."
  - `frontend/lib/investmentGrowth.ts:136`: "Anchor from your provider to see lifetime growth"; `:139`: "Money-weighted, as shown by your provider. Sorted does not recompute it."
  - `frontend/components/PortfolioGrowthDetail.tsx:67`: "Simple gain, not a time-weighted return. This is not advice."
  - Penny: `penny_tools.py:3614-3617`: "Capital at risk. Past performance is not a guide to future returns. Prices are end of day and may be delayed." returned as `capital_at_risk` and the tool description tells Penny to always carry it (`penny_tools.py:496`).
- Example output (Penny tool shape, PENNY_TOOLS.md:66): per account value, paid_in, growth and growth_pct as `{raw, formatted}`, `method` "simple gain, not time-weighted", `basis: "anchor"` when the user anchored, plus `capital_at_risk`. A user-facing example in the G278 note (TODO.md, item G278): header "+£5,308.98 since 4 Sept statement" was replaced after review because it showed contributions, not growth.
- What it does: informs and compares the user's own recorded investments (value now against cost and payments in). The card contains no wording that points at a choice, and prices are end of day. The provider anchor is user-entered (value, return and date as the provider showed them) and never recomputed (investmentGrowth.ts:139).
- Regime questions: Does tracking and showing growth, gain and a provider-quoted rate of return on holdings the user uploaded fall outside advising on investments, and does "paid in versus growth" presentation raise any FSMA s21 or Consumer Duty question? Is the "Capital at risk" line adequate and is it needed where the card is a record of past value? Is the user-entered anchor (an unverified third-party figure displayed back) a data-accuracy question under Consumer Duty?
- Safeguards: the three risk lines on every surface; method note and "Simple gain" label; cost never estimated ("Cost not known", investmentGrowth.ts:134, G277 note "cost is never estimated"); user can edit or clear the anchor ("Entered by you. You can edit or clear it at any time.", investmentGrowth.ts:138); Penny rule 13 forbids "invest in this" (penny_agent.py:488); the tool is read only and user scoped (G271 coordinator note). Prices come from a daily price feed (`backend/app/services/investment_prices.py`; provider not recorded here, unverified).
- Open questions: the growth card says "This is not advice" in the drill-in only (PortfolioGrowthDetail.tsx:67), not on the summary card (grep of PortfolioGrowthCard.tsx finds no such sentence). MCP exposes `get_investment_growth` to a user-connected assistant whose answers are outside Sorted's wording controls (PRIVACY.md section 6; TERMS.md:79 says the Section 6 disclaimer applies equally).

### 6. Penny: calculate, future_value and what-if answers

- Surface and route: Penny sheet and `/penny`; tools `calculate` with `growth` branch (`penny_tools.py:5252-5278`, using `safe_calc.future_value`), what-if on cash via `calculate` over live figures; G246 removed the life simulator (PENNY_TOOLS.md:582-603, memory fact project_life_simulator).
- Wording samples:
  - `backend/app/services/penny_tools.py:5272-5273`: hedge returned by the tool: "At a constant {rate}% a year, not guaranteed. Returns vary and capital is at risk for investments."
  - `backend/app/services/penny_agent.py:472-488` (rule 13): quote the hedge verbatim; "A regular contribution is money put aside, never a cost." and "Factual information and calculations only: never say 'invest in this' or 'do this', never name or rank a product, provider or action."
  - `backend/app/services/penny_agent.py:425-442` (rule 9, tax): "Never suggest, name or recommend a specific product, provider, scheme or investment, including EIS/SEIS opportunities, to obtain a relief; explain the mechanics only, and point to a regulated financial adviser for anything recommendation-shaped."
- Example output: Penny for "what if I contribute £300 a month at 6.5%": a future value, total paid in, growth, then "At a constant 6.5% a year, not guaranteed. Returns vary and capital is at risk for investments." (shape fixed by penny_tools.py:5272 and agent rule 13).
- What it does: informs by arithmetic on user-supplied or live figures; executes nothing.
- Regime questions: Does an illustrative compound-growth figure at a user-chosen rate raise an FSMA s21 or advising-on-investments question, and is the fixed hedge sufficient? Does the "what-if" on the user's own cash cross into advice?
- Safeguards: rules 3, 8, 9 and 13 (above); arithmetic only through `calculate` (penny_agent.py:360-368, rule 1, "Penny never does arithmetic herself"); a hedged date projection ("at the same rate, roughly"); a model-agnostic validator test over tool descriptions (PENNY_TOOLS.md acceptance corpus section).
- Open questions: the guardrails are prompt-level instructions to a model, not output filters like G283's gate; there is no code-level banned-phrase check on Penny's free-text replies (verify with a grep of `penny_agent.py` for a post-generation filter; none found in this pass for "invest in this" or "you should"). The specialist may want a code-level gate, which would be new work.

### 7. Penny: can_i affordability verdicts

- Surface and route: `/can-i` flow and Penny chips; `backend/app/services/affordability.py`, `backend/app/routers/can_i.py`.
- Wording samples:
  - `backend/app/services/affordability.py:195-199` `_whatif_delta_line`: "£{amount} leaves {free} free" or "£{amount} would take you {free}".
  - `affordability.py:202-208` `_multimonth_fit_headline`: "That fits" or "That doesn't fit".
  - Design record, `affordability.py:185-194`: owner decision 2026-08-25 that "Yes" / "Yes, but it'll be tight" / "Not this one" read as a recommendation, so "the delta arithmetic below IS the verdict shown to the user, never a translated verdict word."
- Example output: "£120 leaves £84 free" (template at affordability.py:195).
- What it does: informs and compares the amount asked with Safe to Spend; the internal `verdict_word` ("yes", "tight", "no") is kept for the model and is never shown as the headline (affordability.py:189-193). On "no" the tool adds `nearest_yes_amount` (affordability.py:332-335), a largest round-£5 amount that fits.
- Regime questions: Does `nearest_yes_amount` (a suggested alternative spend) or the "That fits / doesn't fit" line read as a recommendation about spending, and is that relevant to any RAO activity? Are consumer-credit affordability questions (for example "can I afford this loan") in scope, and does Penny's answer to one raise a credit-broking or advice question?
- Safeguards: verdict word hidden from the headline (above); facts-only rules 3 and 8; hedged future events (rule 4, penny_agent.py:384); Safe to Spend itself fails closed when degraded (CLAUDE.md surface map, `backend/app/routers/analytics.py`).
- Open questions: none beyond those above.

### 8. Penny: explain tool and money-basics explainers (including tax mechanics)

- Surface and route: Penny `explain` tool; copy `backend/app/content/money_basics.py` (19 curated cards, now served via Penny, `penny_tools.py:5081-5097`); the API route `GET /money-basics` and `/money-basics/daily` still exist (`backend/app/routers/money_basics.py:11-25`) with no frontend consumer found (grep of `frontend` finds none).
- Wording samples (each card is delivered by Penny with the suffix `(UK 2026/27 figures, general information, not financial advice.)`, `penny_tools.py:5090-5092`):
  - `money_basics.py:57-59`: "Clear pricey debt before you invest" / "Paying off a 20% card beats almost any investment."
  - `money_basics.py:49-51`: "Aim for 3-6 months of essential spending" / "Build the buffer before you invest or overpay debt."
  - `money_basics.py:65-67`: "An employer pension match is free money" / "Always pay in enough to capture the full employer match."
  - `money_basics.py:25-27`: "Cash ISA vs Stocks & Shares ISA" / "Cash ISA for short-term safety; S&S ISA for long-term growth."
  - `penny_tools.py:4684-4692` `_SAVE_INVEST_REPLY`: "This is general information, not a personal recommendation. ... the right balance is a personal decision, not one I'll make for you."
- What it does: explains, and in several cards ("Always pay in enough", "Build the buffer before you invest or overpay debt", "Paying off a 20% card beats almost any investment") uses imperative or comparative wording; no personal figures.
- Regime questions: Do the imperative or comparative takeaways above (a 20% card beats almost any investment; always capture the employer match; build the buffer before investing) read as a general explanation or as a recommendation, and does the delivery by Penny alongside the suffix affect that? Does the unused `GET /money-basics` route matter?
- Safeguards: general-information suffix on every card (penny_tools.py:5090-5092); module docstring `money_basics.py:1-6` ("General educational information, not financial advice"); rule 9 for tax questions (penny_agent.py:425-442); the cards are hand curated, not model generated (money_basics.py:5-6); `_SAVE_INVEST_REPLY` is verbatim fixed copy.
- Open questions: card wording was written as education and was not reviewed against a perimeter question; the specialist may want the three takeaways softened or removed. The tax-year figures are hand maintained "review each April" (money_basics.py:5), so stale figures are a standing risk (unverified process).

### 9. Planning priority ladder (/planning, /grow)

- Surface and route: `/planning` (`frontend/app/planning/GrowPanel.tsx`), data from `GET /grow` (`backend/app/routers/grow.py`).
- Wording samples:
  - `grow.py:486-487`: "Overpaying debt is a guaranteed return equal to the rate, investing may return more or less and your capital is at risk" and "Some people keep a small cash buffer alongside expensive debt rather than putting every spare pound towards it".
  - `grow.py:511-512`: "Some people prioritise ISA or pension contributions once debt and buffer are sorted; others keep building cash" and "Investing can lose money as well as gain it, and past performance isn't a guide to future returns".
  - `penny_tools.py:4644-4650`: "It's a general order to consider, not a fixed instruction."
- What it does: compares options and orders them as a "general order to consider" (essentials, buffer, pension, investing, debt ahead of all of it per the Penny explainer); states each rung done, active or locked.
- Regime questions: Does ordering savings, debt repayment and investing as a priority ladder amount to a personal recommendation about how to use spare money, given the ladder is driven by the user's own data? Does the "guaranteed return equal to the rate" phrase need any qualification?
- Safeguards: "Some people ..." framing and the capital-at-risk line (grow.py:486, 512); "general order to consider, not a fixed instruction" (penny_tools.py:4644-4650); no product named.
- Open questions: the ladder is data-driven per user, so "some people" framing sits beside a personalised "active" rung.

### 10. Pay split versus reference shapes (/spend/shape, G279 "Compare with", 50/30/20, Conscious Spending Plan, Pay yourself first)

- Surface and route: Spend card and `/spend/shape` (`frontend/components/PaySplitComparison.tsx`, `frontend/lib/paySplitReference.ts`, `frontend/app/spend/shape/ReferenceShapesRow.tsx`, `WhatWorksCard.tsx`, `frontend/components/PaySplitBeyond.tsx`); preference `pay_split_reference` (authenticated preference; G279 notes).
- Wording samples:
  - `frontend/lib/paySplitReference.ts:14`: name "50/30/20 · adapted"; description "A common income guide: 50% needs, 30% wants, 20% savings and debt payments. Here it is roughly mapped to Fixed, Free and Moved, not a needs-and-wants assessment."
  - `paySplitReference.ts:15`: name "Conscious Spending Plan · 60/20/20 example"; description "An alternative to 50/30/20: 60% Fixed, 20% Free and 20% Moved (10% investment plus 10% savings). The wider framework uses ranges: Fixed 50–60%, discretionary 20–35%, investment 10%, savings 5–10%. A difference from this example is not a breach of those ranges."
  - `paySplitReference.ts:16`: name "Pay yourself first · principle"; "This principle does not prescribe a universal percentage, so it has no numeric comparison here."
  - `paySplitReference.ts:87-92` row readings: "Above this reference", "Below this reference", "More moved than this reference", "Less moved than this reference", "Matches this reference".
  - `PaySplitComparison.tsx:133`: "50/30/20 is the default. Choosing an alternative changes only this comparison, not a budget or bank payment."
  - `PaySplitComparison.tsx:44`: "This is an adapted illustration, not an assessment of what you need or should spend."
  - `PaySplitComparison.tsx:49`: "A section above a reference is not necessarily responsible for money going beyond income. Money moved above a reference is not labelled overspending. Nothing here sets a budget, moves money or asks you to change a habit."
  - `PaySplitComparison.tsx:126`: "Fixed roughly maps to needs, Free to wants, and Moved to savings. These are not exact matches; Moved can include your own transfers. This is general information, not advice."
  - `frontend/app/spend/shape/ReferenceShapesRow.tsx:35`: "Opens an explainer in Penny. Choose the comparison above separately. No budget or target is set."
  - `frontend/app/spend/shape/WhatWorksCard.tsx:119`: "Describes your own history. Not advice."
  - `frontend/components/PaySplitBeyond.tsx:67`: "You spent {amount} more than came in." and `PaySplitBeyond.tsx:81`: "You moved {amount} while your cards grew by {amount}. Point that at the card and the gap closes itself." (the second line is shown only to a user who chose "change" on the saving habit in the Mirror, PaySplitBeyond.tsx:77-79 and `frontend/app/spend/shape/MoneyShapeHero.tsx:381`).
- Example output (using the G279 note's figures, TODO.md G279): with Fixed 53%, Moved 18%, Free 29% against 50/30/20 and £4,844 income, the Fixed row reads "Above this reference" with a signed difference, and the Beyond-income block shows "Beyond income" with the reference differences listed.
- What it does: compares the user's own pay split with a reference, flags a cost group above the reference with an amber marker (`aboveCost`, paySplitReference.ts:45-46, 80) and states a difference. It does not set a budget. One line (PaySplitBeyond.tsx:81) points the user at a structural redirect.
- Regime questions: Does comparing a user's split with named budgeting references and flagging "above this reference" amount to general information or a recommendation about spending? Is "Point that at the card and the gap closes itself" (a redirect suggestion, paradox line) a recommendation? Is the "50/30/20 · adapted" mapping misleading given Fixed includes loan repayments and Moved can include own-account transfers (G279 note and PaySplitComparison.tsx:45)? CMA/ASA/DMCC: any issue in presenting a "60/20/20 example" under the Conscious Spending Plan name?
- Safeguards: "not advice", "not a budget" and "adapted" labels (lines above); a section above a reference is not labelled overspending (PaySplitComparison.tsx:49); paradox line gated on consent ("change" in the Mirror) and for single periods only (`PaySplitBeyond.tsx:77-79`); default 50/30/20 with the alternative selected by the user only; authenticated preference with save-error handling; DESIGN.md "Mirror is not a score" (BEHAVIOURS.md rules).
- Open questions: attribution and IP are in the next section. The summary card on Spend carries no "not advice" line (the line sits in the detail "How the groups compare" disclosure, PaySplitComparison.tsx:126).

### 11. Aims and Mirror coaching (checkpoints, paradox lines, BEHAVIOURS.md Layer 3)

- Surface and route: `/mirror` (`frontend/app/mirror/MirrorPage.tsx`), aim sheet (`frontend/components/AimSheet.tsx`), aim nudge cards (`AimNudgeCard.tsx`), Spend rows, Penny; engine `backend/app/services/behaviour.py` (deterministic signatures; no model call found in `behaviour.py` or `routers/behaviour.py` by grep for openrouter, llm and narrat), `backend/app/services/checkpoints.py`.
- Wording samples:
  - `behaviour.py:263`: trait narrative "You tend to spend heavily in the first week of each month, with {pct}% of monthly outgoings landing there."; title "The Front-Loader".
  - `behaviour.py:295`: title "Runs on Plastic Mid-Month"; narrative "Your credit card use ramps up through the month as cash flow tightens after payday."
  - `behaviour.py:485`: evidence line "{n} gambling transaction(s) in the window"; `behaviour.py:505`: title "A Few Things to Note", narrative "A few patterns worth keeping an eye on: described above, without judgement."
  - `frontend/app/mirror/MirrorPage.tsx:113` ("This isn't me, change it") and `:102` ("This is me, keep it"); `MirrorPage.tsx:42`: "That is part of how you do things, so it stays as it is and I will not nag you about it."
  - `frontend/components/AimSheet.tsx:182`: "A pace check, not a limit. Spending past it is fine, you will just see where you are."
  - `backend/app/services/checkpoints.py:84-85`: pace phrases "likely to pass your aim", "past your aim".
  - `PaySplitBeyond.tsx:88`: "You moved {amount} to savings in a period that went past what came in. The habit is yours to keep."
  - BEHAVIOURS.md Layer 3 (line 58 onward): paradox example "You saved £257 last month while your credit cards grew by £430." and redirect "Point the daily transfer at the Amex instead of the pot and the paradox closes itself."
- What it does: profiles behaviour from transactions (see DPIA), labels traits, and for a trait the user marks "change" offers an aim (a pace check) or a single structural redirect line. Executes nothing; aims never block.
- Regime questions: Does a "change this" coaching path with redirect suggestions about where to point a savings habit (for example towards a card) stay within general information? Is the aim "pace check" a budget service in any regulated sense? Does the hygiene trait (gambling, BNPL, returned payments) raise consumer-protection or vulnerable-customer questions (Consumer Duty) beyond the data-protection questions in the DPIA?
- Safeguards: BEHAVIOURS.md named rules (lines 98-110): Consent Rule (no coaching on a trait not marked "change"), Redirect Rule, Verified Checkpoint Rule, One Paradox Rule, Facts/Voice Split, "The Mirror Is Not A Score"; keep-choice honoured (MirrorPage.tsx:42); paradox needs the "change" consent flag (PaySplitBeyond.tsx:78); an aim "is a pace check, not a budget: it never blocks and never judges" (`checkpoints.py:69-72`); traits suppressed when data is thin (BEHAVIOURS.md:144); doc-versus-code note: BEHAVIOURS.md:45 says "AI narrates the portrait from computed facts", but the narrative in code is a fixed template string (`behaviour.py:263`, `:295`) and no model call was found in `behaviour.py` or `routers/behaviour.py`. `ChallengesPanel.tsx` (weekly "cut back" challenges, `backend/app/routers/challenges.py:18`) is defined but not imported anywhere in production code (grep), so its wording is not reachable by users from the frontend; the API routes are still mounted (`backend/app/main.py:48,98`).
- Open questions: the Mirror portrait can display a gambling evidence line (behaviour.py:485); see DPIA section on sensitive inferences. Hygiene wording "without judgement" sits beside a count of gambling transactions.

### 12. Safe to Spend (verdict and calculation)

- Surface and route: Home hero `frontend/components/SafeToSpendCard.tsx`, backend `backend/app/routers/analytics.py` (state "comfortable", "tight" or "short", analytics.py:5274-5276 region).
- Wording samples:
  - `SafeToSpendCard.tsx:822`: "An estimate from your bank data, not financial advice." (element `data-sts-disclaimer`).
  - `SafeToSpendCard.tsx:632-639` captions: "available in cash until {payday}", "short before payday", "short after plans and envelopes", "last known cash figure until {payday}".
  - `SafeToSpendCard.tsx:463`: "Purchases only. Balance transfers and repayments are not counted here."
  - `SafeToSpendCard.tsx:676-677`: "How we got {amount}" and "How we got {amount} short".
- What it does: informs (a cash figure with a status word); fails closed to at most zero when a reserve lookup fails (CLAUDE.md surface map, `analytics.py`). Executes nothing.
- Regime questions: Does a status word ("comfortable", "tight", "short") read as an assessment of affordability of credit or as a recommendation? Is the disclaimer on the hero adequate?
- Safeguards: disclaimer line on the hero (above); "Full calculation" ledger showing the working; degraded and error states shown, never hidden; TERMS.md:86 states figures "are estimates".
- Open questions: none beyond the above.

### 13. Move suggestions, cover plan and Payday Plan

- Surface and route: Home brief cards (`frontend/components/HomeBrief.tsx`, `PaydayPlanCard.tsx`, `CoverPlanSourcesCard.tsx`), Penny; engine `backend/app/services/companion.py`; push notifications (`backend/app/services/notifications.py:421-423`).
- Wording samples:
  - `companion.py:4614`: headline "Move £{total} to {destination}"; `companion.py:4579`: "Move £{amount} from {source}".
  - `HomeBrief.tsx:995`: "Put this move in place"; `HomeBrief.tsx:1002`: "moving now"; `HomeBrief.tsx:1052`: "The source still covers its own bills."
  - `PaydayPlanCard.tsx:161`: "Here’s one way to split your next pay."; `PaydayPlanCard.tsx:394`: "£{amount} stays with you in {account}."
  - `companion.py:3772`: persisted headline "Payday plan: split £{total} across {n} accounts".
  - `notifications.py:421-423`: push title "Move £{amount} to {account}", body "Covers an expected bill before it's due."; `notifications.py:410`: "Bill may not clear".
- Example output: Home card "Move £120 to Barclays Bills" with sources listed, as the C22 kit mock (CampaignWorlds.tsx:14, fictional data) shows.
- What it does: uses wording that points at a choice (an own-account move) and proposes how to split a salary across the user's own accounts; Sorted never moves the money (AIS-only, row boundary above). Memory facts: "Moves are recommendations, not buttons" (Kevin rejected a Move button 2026-10-06); Payday Plan is "a distribution recommendation ... with no lifecycle at all" (CLAUDE.md surface map, G172).
- Regime questions: Do imperative headlines ("Move £120 to ...", "Put this move in place") on an AIS-only app suggest something beyond account information, including for Finexer's AIS-only agent terms (AIS-only commitment, docs/compliance/finexer-agent-controls-2026-09.md Q3)? Does a suggested salary split across accounts amount to advice about the use of money? 
- Safeguards: Sorted does not make the transfer; marketing states it (CampaignWorlds.tsx:14, content.json:12); cover plans only use the user's own accounts and exclude user-excluded accounts (`companion.py:2274`, `cover_plan_excluded_accounts`); hedged language for future events (memory fact "No conviction on predictions"; `PaydayPlanCard.tsx:161` "one way to"); the Payday Plan is dismissible (G172).
- Open questions: headlines use imperative verbs ("Move", "Put this move in place") while the memory rule says moves are recommendation sentences with the source stated as a sentence; the specialist may prefer wording like "A move of £120 would cover ...". The "Payday plan: split £X across N accounts" string is persisted verbatim and read by Penny and MCP (companion.py:3764-3772 comment).

### 14. Marketing claims (C22 kit, store listing copy)

- Surface and route: private preview `/design/marketing-kit` (`frontend/app/design/marketing-kit/`, auth-exempt `/design/*` pages are reachable by link), store copy `content.json`, campaign worlds `CampaignWorlds.tsx`; assets under `frontend/public/design-media/c22/`. README states nothing is approved for publication (`marketing-kit/README.md`, "Limitations and approvals").
- Wording samples:
  - `content.json:2`: positioning "A clearer view of your money until payday."
  - `content.json:32` (store description, one string): "See an estimated Safe to Spend after upcoming bills, plans and your buffer." ... "Sorted does not make the bank transfer." ... "Capital at risk. Tracking is not investment advice." ... "General information, not regulated financial advice." ... "Example images use fictional data. Forecasts and suggestions are estimates, not guarantees."
  - `CampaignWorlds.tsx:14` (campaign E): "Sorted suggests the move. You transfer with your bank." and legal "Fictional suggestion. Sorted does not move money. You make the transfer with your bank."
  - `CampaignWorlds.tsx:13` (campaign D): legal "Fictional forecast. Payments can take a day or two to appear. Account information via Finexer Ltd. AURIQ LTD is its agent."
- What it does: promotes the app. It makes no savings, return, price or FCA-authorisation claim (README, "Limitations and approvals"; content.json reviewChecks last line: "No pricing, download availability, savings result, return or FCA authorisation claim is approved by this kit.").
- Regime questions: Is any piece of this kit a financial promotion under FSMA s21 and, if so, who communicates it and on what basis? Do the "estimated" and "fictional data" labels satisfy CMA/ASA/DMCC expectations for the channels planned (TikTok, Instagram, Facebook; content.json reviewChecks)? Is the use of real bank names and logos (Monzo, Barclays) in advert fixtures acceptable (see IP section, `frontend/public/banks/NOTICE.md`, which relies on nominative use for linked-account display, not for advertising)? Is the "AURIQ LTD acts as Finexer's registered agent" disclosure in the right place and form for each channel?
- Safeguards: README limitations and `reviewChecks` list (above); "Sorted does not make the bank transfer" disclosed on the move concept; "Capital at risk" and "not investment advice" in the store text; no savings figure in the kit (the old "£X/mo saved" Home stat is not used in the kit text I checked; verify against the PNG assets, unverified in this pass because images were not inspected).
- Open questions: the store listing text and campaign copy have not been reviewed by the specialist; `/design/*` previews are public-by-link on UAT.

### 15. Onboarding and plan picker

- Surface and route: `frontend/components/Onboarding.tsx` (welcome, income, plan), `frontend/components/PlanPicker.tsx`, `frontend/lib/billingCopy.ts`; B45 trial copy draft `docs/pricing/trial-copy-b45.md`.
- Wording samples:
  - `Onboarding.tsx:352`: "Get AI-powered insights to save more money".
  - `Onboarding.tsx:351`: "Track spending and set budgets that actually stick".
  - `Onboarding.tsx:523`: "Optional, this just helps Penny personalise your insights."
  - `PlanPicker.tsx:36`: "Keep up with day-to-day money across your main banks."; `PlanPicker.tsx:43`: "Your full money picture, kept up to date through the day."
  - `frontend/lib/billingCopy.ts:18`: "Then {amount} {renewal}. Card required, cancel any time."; `billingCopy.ts:22-24`: "{days} days free, then {amount} {charge timing}, then {amount} {renewal} unless you cancel."
  - `PlanPicker.tsx:480`: "You can compare every plan now. Paid checkout will open when billing is live."
- What it does: describes product benefits and subscription terms; it does not present itself as advice.
- Regime questions: CMA/ASA/DMCC: is "to save more money" a claim of an outcome that needs substantiation (the G283 reasoning applies to tips; this line was not in G283's scope)? Do the trial and auto-renewal disclosures meet subscription-contract rules (a DMCC Act area; the specialist to confirm applicability and timing)? 
- Safeguards: B22 disclosure beside the trial control, charge date named (PlanPicker.tsx:442-445); trial and cancellation copy in a draft for Kevin's approval, nothing live in TERMS (docs/pricing/trial-copy-b45.md, header lines 3-5).
- Open questions: "Wealth" appears as the product name at Onboarding.tsx:632 (old name; copy observation); store prices match web (TODO.md C21/C24 notes, 2026-10-17); C21 and C24 are in progress.

### 16. Notifications and push copy

- Surface and route: `backend/app/services/notifications.py` (push through FCM/APNs/Expo).
- Wording samples: `notifications.py:192`: titles "New money insight" and "{n} new money insights", body is the top tip's title (`notifications.py:199`); `notifications.py:500`: "{category} is running hot" (category pace); `notifications.py:410`: "Bill may not clear"; `notifications.py:421-423`: "Move £{amount} to {account}" and "Covers an expected bill before it's due."; billing: "Your free trial ends soon" (`docs/pricing/trial-copy-b45.md:37`, a draft for Kevin's approval) and "Payment didn't go through" (`frontend/lib/billingCopy.ts:34`, `PAYMENT_FAILED_TITLE`).
- What it does: informs; the "New money insight" push carries a tip title and so inherits row 4's wording (savings-claim style on main until G283 merges; facts-only after).
- Regime questions: Does a push notification that carries a tip title or a move headline create a separate communication to be assessed under FSMA s21 or Consumer Duty? Is "is running hot" appropriate for a vulnerable-customer reading? 
- Safeguards: preference-gated sends (`notifications.py:100` "Run every preference-gated check"); G283 gate on tip titles covers the push path (the push reads the serialized tip title, ENGINE.md:159 on the G283 branch; verify the push path specifically, unverified).
- Open questions: push copy is not covered by the `check:g283-no-savings-claims` frontend twin (it is backend text).

### 17. Grocery basket comparison ("Cheaper elsewhere")

- Surface and route: `frontend/components/GroceryBasketCard.tsx`, rendered on Home when pinned (`frontend/app/components/HomePage.tsx:1125`) and inside the category sheet (`frontend/components/CategorySheet.tsx:329`); the receipts route reuses its scan flow (`frontend/app/receipts/ReceiptsPage.tsx:15, 94`, comments; no import of the card was found there). Backend `backend/app/routers/baskets.py` ("Grocery receipt scanning to itemised shopping baskets", sends receipt images to a model via `openrouter_chat`, `baskets.py:19`).
- Wording samples: `GroceryBasketCard.tsx:192`: "time and which shop is cheapest for what you buy." `GroceryBasketCard.tsx:242`: "Cheaper elsewhere". `GroceryBasketCard.tsx:256`: "{price} at {store} · {price} at {store}". `GroceryBasketCard.tsx:259-260`: "save {amount}".
- Example output: an item line "Milk 2L" with "£1.45 at Aldi · £1.65 at Tesco" and "save £0.20" (template; amounts illustrative).
- What it does: compares the user's own scanned item prices across stores and states a saving per item. Executes nothing.
- Regime questions: Is a per-item "save {amount}" figure a claim that needs substantiation (CMA/ASA/DMCC)? Does naming stores raise any promotion question?
- Safeguards: figures derive from the user's own receipts; no recommendation sentence in the samples above. No facts-only gate applies to this card (the G283 gate covers tips only).
- Open question for Kevin (not a conclusion): "save {amount}" is the same class of claim that G283 removed from tips ("£X/mo saved", "could save"). Should this card be brought under the same facts-only rule?

### 18. Fuel price card ("Find cheaper fuel near you")

- Surface and route: `frontend/components/FuelSavingsCard.tsx`, on Home when pinned (`HomePage.tsx:1124`), in the category sheet (`CategorySheet.tsx:329`, Transport) and in `TransportInsights.tsx:135` (that component is not imported anywhere, see row 19). Backend `backend/app/routers/fuel.py` (cached UK Fuel Finder snapshot, docstring lines 1-6; ranks same-grade stations near the user's location).
- Wording samples: `FuelSavingsCard.tsx:149`: "Find cheaper fuel near you" (also "Add your location to find cheaper fuel nearby"). `FuelSavingsCard.tsx:217-218`: "Cheapest {grade} nearby is {ppl}p/l." `FuelSavingsCard.tsx:231`: badge "CHEAPEST". `FuelSavingsCard.tsx:106`: "Cheapest {grade} nearby: {ppl}p/l".
- Example output: "Cheapest unleaded nearby is 139.9p/l." with a "CHEAPEST" badge on the matching station row (template; figure illustrative).
- What it does: compares station prices near the user's location; the card title uses "cheaper". Executes nothing.
- Regime questions: Do "cheaper" and "CHEAPEST" labels need dated sourcing (as G283 now requires for tips: source and date), and is the snapshot's date shown (not checked in this pass)? Location is used (see DPIA for location handling, not separately assessed).
- Safeguards: prices come from a public snapshot, not a model; no saving figure is stated in the samples above.
- Open question for Kevin: should station price labels carry a source and date, as tips now do?

### 19. Admin offer broadcasts (OfferCard)

- Surface and route: `frontend/components/OfferCard.tsx`, rendered on Home (`HomePage.tsx:1120`), fed by `GET /offers` (`backend/app/routers/broadcast.py:128`), the in-app half of admin-composed offer broadcasts (B20, module docstring `broadcast.py:1-15`). A marketing and promotion surface: the title and body are composed by an administrator, not by the product.
- Wording sample: label "For you" (`OfferCard.tsx:62`), then the broadcast `title` and `body` verbatim (`OfferCard.tsx:64-65`); tapping navigates to the offer URL (`OfferCard.tsx:50`). No fixed wording exists in code, so no example can be given beyond the template.
- What it does: shows an admin-written message as a card; may promote a product or plan.
- Regime questions: Is a broadcast offer a financial promotion or marketing communication (FSMA s21, CMA/ASA/DMCC, direct marketing consent under the data-protection and e-privacy rules)? Who approves broadcast copy, and is any copy review step recorded? (PRIVACY.md:3 states "We do not use your data for marketing purposes"; the specialist should reconcile that with offer broadcasts.)
- Safeguards: user can dismiss (`OfferCard.tsx:36-47`); broadcasts are admin-only (docstring `broadcast.py:1-15`); receipts and broadcasts have TTLs (`main.py:522, 531`, 365 days).
- Open questions: no copy-review gate or banned-phrase check on broadcast text was found in this pass (unverified).

### 20. Transport insights (dead code) and routes examined

- `frontend/components/TransportInsights.tsx:42`: "{amount}/mo on rideshare. Could a monthly travelcard work out cheaper?" is unreachable: no file imports `TransportInsights` (grep of `frontend/app` and `frontend/components`, excluding `/design/`). Recorded because it would be a "cheaper" suggestion if wired in.
- Routes examined for this map: `/tax` (`frontend/app/tax/TaxPage.tsx`, `TaxCanvas.tsx`) was examined at file level only; its wording was not sampled, and tax answers in Penny are covered by Penny rule 9 (row 6). `/receipts` (`frontend/app/receipts/ReceiptsPage.tsx`) examined at file level only; its wording was not sampled, and its model-parsing path is `backend/app/routers/baskets.py` (see row 17 and the DPIA section on AI processing). Both are open items for a wording pass if the specialist wants them in scope.

## Intellectual property: reference-shape names and third-party material

### Names shipped, with exact labels

- `frontend/lib/paySplitReference.ts:14`: "50/30/20 · adapted" (shortName "50/30/20").
- `frontend/lib/paySplitReference.ts:15`: "Conscious Spending Plan · 60/20/20 example" (shortName "60/20/20 example"). This is the currently shipped label. It carries no attribution to Ramit Sethi in the label. Kevin's interim default (TODO.md A165 note 2026-10-16): show "Conscious Spending Plan (Ramit Sethi)", never implying endorsement; generic fallback "Fixed / Invest / Save / Spend split". Neither is implemented.
- `frontend/lib/paySplitReference.ts:16`: "Pay yourself first · principle".
- `frontend/app/spend/shape/ReferenceShapesRow.tsx:12-14`: link labels "Conscious Spending Plan", "50/30/20", "Pay yourself first", each opening a Penny explainer turn ("Explain the conscious spending plan").
- Penny explainer ids and copy: `backend/app/content/money_basics.py:142-163` (ids `conscious-spending-plan`, `fifty-thirty-twenty`, `pay-yourself-first`), listed to Penny at `penny_tools.py:219-220`.

### Where Ramit Sethi, Elizabeth Warren or their works are named in app text

Grep (case-insensitive) for "ramit", "sethi", "i will teach", "iwillteach", "guilt-free", "conscious spending", "elizabeth warren", "all your worth", "pay yourself first" across `backend`, `frontend/app`, `frontend/components`, `frontend/lib`, `frontend/scripts`, `docs`, and root `*.md` found only the following in shipped app text or Penny content:

- `backend/app/content/money_basics.py:146`: body "The idea comes from Ramit Sethi's book I Will Teach You To Be Rich, written for a US reader; a UK workplace pension and ISA cover the same ground here, and the percentages are starting points, not fixed rules everyone should hit." The same body uses "guilt-free spending on whatever you enjoy". Four buckets and the ranges (50-60%, 10%, 5-10%, 20-35%).
- `backend/app/content/money_basics.py:154`: "It was popularised by US senator Elizabeth Warren in the book All Your Worth."
- `frontend/components/PaySplitComparison.tsx:50-51`: two outbound links, "CFPB spending rule worksheet" (files.consumerfinance.gov) and "Conscious Spending Basics" (https://www.iwillteachyoutoberich.com/conscious-spending-basics/), both rendered as links in the "How comparison works" sheet.
- `frontend/lib/paySplitReference.ts:15`: the ranges "Fixed 50–60%, discretionary 20–35%, investment 10%, savings 5–10%".
- The G279 design document (`docs/design/G279-pay-split-compare.md:34`) records the source page for those ranges.

Finding on copying: the grep found no verbatim passages, worksheets, diagrams, bucket names with his wording, or imagery taken from his books or website in app text or Penny content; the Conscious Spending Plan explainer paraphrases the four-bucket idea and ranges in Sorted's own words. Two items the specialist may wish to check against the source text, which I did not fetch or compare line by line (only the public page URL is cited): the phrase "guilt-free spending" (money_basics.py:146) and the bucket labels. This is a grep and a reading of our own text, not a comparison against his published text, so it cannot establish that nothing is similar.

Facts recorded from Kevin (TODO.md A165 note 2026-10-16): copyright covers his wording, worksheets and diagrams, not the idea or the percentage ranges. Question for the specialist: is attribution enough, or should a generic name be used? Is linking to his site (PaySplitComparison.tsx:51) acceptable?

### Trade mark register check: "Conscious Spending Plan"

Date of attempt: 2026-10-17. Method: read-only fetches of the public search pages. No register returned a usable result, so no result is recorded for this name and nothing is reported as clear.

| Register | URL tried | Outcome |
|---|---|---|
| UK IPO (trademarks.ipo.gov.uk) | https://trademarks.ipo.gov.uk/ipo-tmtext | HTTP 403 Forbidden, no body retrieved |
| UK IPO (legacy) | https://www.ipo.gov.uk/t-tmtext/search?q=conscious+spending+plan | HTTP 403 Forbidden |
| USPTO | https://tmsearch.uspto.gov/search/search-results?query=%22conscious%20spending%20plan%22 | JavaScript shell, no results populated |
| TMview (EU and UK offices) | https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=F&basicSearch=conscious%20spending%20plan | page did not load results |
| WIPO Global Brand Database | https://branddb.wipo.int/en/quicksearch?by=brandName&v=conscious%20spending%20plan&rows=30&sort=score%20desc&start=0 | CAPTCHA gateway, no results |
| EUIPO eSearch | https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/conscious%20spending%20plan | returned the homepage only, no search results |

A person with a browser needs to run these searches. Suggested exact searches: UK IPO "Search for a trade mark" word search "Conscious Spending Plan", exact and "contains", all classes (and Nice classes 9, 16, 35, 36, 41 for books, courses and money-guidance services); USPTO Trademark Search, same terms.

## Trade marks for Sorted's own names

Names: "Sorted" (app name, store name "Sorted: Money until payday", content.json:32 region), "Safe to Spend", "Payday Plan", "Penny" (assistant), "Sorted by Auriq". Intended Nice classes per Kevin: 9 (software), 36 (financial services), 42 (software as a service).

Result: not retrieved. The same registers and URL patterns recorded in the table above returned a 403, a JavaScript shell, a CAPTCHA gateway or a homepage for the one name tried, so the five Sorted names were not searched individually in this pass (the endpoints cannot return data to a read-only fetch). The table below is therefore a search plan, with every cell for identical or similar marks, owner, classes and status marked NOT SEARCHED. I have not recorded any mark from memory.

| Name | UK IPO | USPTO | EUIPO | Identical or similar marks found, owner, classes, status |
|---|---|---|---|---|
| Sorted | not searched | not searched | not searched | NOT SEARCHED. Kevin's note: a common word, likeliest to clash in classes 9, 36, 42. |
| Safe to Spend | not searched | not searched | not searched | NOT SEARCHED. Descriptive-leaning phrase; ask whether distinctiveness is a question. |
| Payday Plan | not searched | not searched | not searched | NOT SEARCHED. Descriptive-leaning phrase. |
| Penny | not searched | not searched | not searched | NOT SEARCHED. Common given name; also check assistants and money apps in classes 9, 36, 42. |
| Sorted by Auriq | not searched | not searched | not searched | NOT SEARCHED. Check "Auriq" alone as well. |

Questions for the specialist and Kevin: (1) who runs the register searches and a clearance opinion; (2) whether Kevin wants to register any name himself at the UK IPO (his decision and cost; nothing has been filed, as far as this repository shows: no trade-mark filing document exists in the repo, unverified outside it); (3) whether store listings reaching the US and EU make USPTO and EUIPO searches necessary (the iOS and Android apps are listed for the UK per CLAUDE.md; store territories not recorded in the repository, unverified).

### Generic feature wording and competitor-like material

- Facts: Kevin's note says "Upcoming payments" (a Snoop-like phrase) is descriptive generic wording. The product uses "Upcoming" as a primary nav tab (`frontend/components/BottomNav.tsx`, per CLAUDE.md surface map). Question for the specialist: confirm that generic feature wording is not a concern provided no competitor's specific artwork, icons or copy is copied.
- Spot-check of the marketing kit (C22) for competitor names: grep across `frontend/app/design/marketing-kit` for Snoop, Emma, Moneyhub, Cleo, Plum, PocketSmith, YNAB, Monarch and Yolt found none. Competitor names do appear in internal strategy documents only: `ENGINE.md:3` ("Emma gives you a ledger and tidy-up tools..."), `DESIGN.md:108` (a description comparing the look to "Monzo/Emma polish"). Whether any marketing image resembles a competitor was not checked: the PNG and video assets were not inspected in this pass (unverified).
- Real bank names and logos appear in the marketing fixtures (Monzo and Barclays, `CampaignWorlds.tsx:13-14`, `campaign-data.json`) and in the product (`frontend/public/banks/`). `frontend/public/banks/NOTICE.md` records a nominative-use rationale for showing a bank logo beside the user's own linked account ("account-aggregator products ... all do the same"). That rationale is written for in-product display; its extension to advertising is a question for the specialist.

## Cross-cutting safeguards found

1. Penny rules 3, 8, 9, 13 (`penny_agent.py:382, 415, 425, 472`). Prompt-level only.
2. G283 facts-only tips and the fail-closed banned-phrase gate (`G283:` references above). Branch only.
3. Propose-only writes and a one-time consent gate (PENNY_TOOLS.md:81-94).
4. Moves are recommendations; Sorted never moves money (TERMS.md:84, PRIVACY.md:21, marketing kit).
5. Hedged wording for future events (rule 4, `penny_agent.py:384`; CardsPage.tsx:193-196).
6. Disclaimers in the product use six different formulations (PennyComposer.tsx:103, SafeToSpendCard.tsx:822, PortfolioGrowthDetail.tsx:67, PaySplitComparison.tsx:126, WhatWorksCard.tsx:119, penny_tools.py:5091). Only PennyComposer uses the phrase "regulated financial advice" in the live product.
7. The card-debt guardrail in tips (row 2).
8. Production release of tips and debt-plan suggestions held pending A166 (TODO.md:612, 741).

## Copy-rule observations (noted, not fixed)

- `frontend/components/Onboarding.tsx:632` uses "Wealth" instead of the product name.
- `backend/app/routers/savings_insights.py` prompt text contains em dashes (for example in the HARD RULES heading, line 1606); these are model instructions, not user-facing strings, and the model is told to avoid dashes (rule 7, line 1633). Listed for completeness.
- `frontend/lib/paySplitReference.ts:15` uses en dashes in "50–60%" and "20–35%" and "5–10%" (not em dashes).
- `PaydayPlanCard.tsx:161` uses a curly apostrophe; fine under the copy rules.
- `frontend/components/Onboarding.tsx:352` makes an outcome claim ("save more money").
- No exclamation marks were found in the samples quoted above.

## What the specialist needs to decide

1. Which features, if any, need FCA permission, an exemption position, or a wording or behaviour change, with the first priorities: debt-plan and card projections (row 1), Penny-only refinance routes (row 2), mortgage and car-finance tips with broker links (row 3), and the Penny explainers with imperative takeaways (row 8).
2. Whether the FCA targeted-support regime is relevant, what its current status is, and whether any Sorted feature would be in scope.
3. Whether G283's facts-only tips (named providers, prices, source and date, "Offer listed until D") are acceptable, or whether provider names and prices should go too (G283's sample document question 1).
4. Whether the move-suggestion and Payday Plan wording ("Move £X to ...", "Put this move in place") is acceptable for an AIS-only agent of Finexer, and what Finexer expects under Client Terms 5.9 and 5.10 (clause text to be supplied).
5. Whether Penny needs a code-level output gate, as tips now have, rather than prompt rules alone.
6. Which disclaimer wording to standardise, and where it must appear (Cards, growth summary card, pay-split summary, push notifications, store listing).
7. Whether marketing and store copy are financial promotions, who the communicator is, and what each channel needs (including use of real bank names and logos in adverts).
8. Whether the "Conscious Spending Plan" label needs attribution, a generic name, or removal, and whether the outbound link and the paraphrased explainer are acceptable; run the register searches for it.
9. Run the UK IPO, USPTO and EUIPO searches for "Sorted", "Safe to Spend", "Payday Plan", "Penny" and "Sorted by Auriq", and advise on conflicts and whether Kevin should file.
10. Whether "to save more money" (onboarding) and any other outcome claim needs substantiation or removal, and whether the subscription trial wording meets applicable consumer-contract rules.
11. Whether the grocery "save {amount}" figure, the fuel "cheaper" labels and admin offer broadcasts (rows 17 to 19) are in scope, and whether they should follow the G283 facts-only rule.
12. Whether tips and debt features should stay live on production until the review completes (TODO.md:612 holds release; confirm the production state, unverified here).
