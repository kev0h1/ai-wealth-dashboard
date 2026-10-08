# Penny question matrix (G241)

Grounded in `docs/penny/question-inventory/*.md` (section refs in the last
column), `frontend/lib/pennyScreenConfig.tsx` (screen keys: home, planning,
upcoming, spend, tax, insights, grow, debt, accounts, other) and the 20 read
tools in `PENNY_TOOLS.md` (get_safe_to_spend, get_upcoming_bills,
search_transactions, get_accounts, get_spend_verdict, get_savings_position,
get_debt_position, get_goals, check_affordability, get_category_spend,
get_insights, explain, get_tax_position, get_today_brief,
get_recurring_payments, get_account_activity, get_mirror, calculate,
get_fill_candidates, preview_trend_intent) plus representative propose tools.

Result codes: A answered, R wrongly refused, W wrong or unsafe, M right
figure but not through the calculator (rule 1 breach), P gap (no data or
tool exists), D correctly declined.

Basis, stated honestly: **L** = run live against OpenRouter on 2026-10-08
with synthetic fixtures (`scripts/penny_live_eval.py`); **G** = tool selection
pinned by the B38 golden eval (catalog level, not a live model); **C** =
read from the catalogue and code, not run (a "today" of A or W there is a
prediction, not a measurement). The "after" column is the post-fix result on
the same basis.

Target is A everywhere except the three P rows, which need data the app does
not hold (see follow-ups in the audit).

## Tally (85 rows)

| result | today (before the fix) | after |
|---|---|---|
| A answered | 66 | 78 |
| R wrongly refused | 7 | 0 |
| W wrong or unsafe | 5 | 1 |
| M right figure, no calculator | 2 | 0 |
| P gap (no data or tool) | 3 | 4 |
| D correctly declined | 2 | 2 |

Split by basis. Measured live (19 rows, basis L): before 7 A, 7 R, 2 M,
1 W, 2 D; after 16 A, 1 W, 2 D. Not run live (66 rows, basis G or C): before
59 A, 4 W, 3 P; after 62 A, 4 P. The four static W rows were predicted from
the code (search_transactions returned at most 20 rows with no total, so a
merchant total or count was a sum of a truncated list; and two projection
rows that need the calculator), and their "after" is a prediction too, so
treat the 66 as an audit, not a measurement. The one remaining live W is
row 68 (see the audit, "Residual").

| # | screen | question | tool(s) | type | today (basis) | after | target | inventory ref |
|---|---|---|---|---|---|---|---|---|
| 1 | home | How much can I safely spend before payday? | get_safe_to_spend | lookup | A (G) | A | A | home A7 |
| 2 | home | What is Penny suggesting I do today? | get_today_brief | lookup | A (G) | A | A | home A3 |
| 3 | home | What is my payday plan for this pay period? | get_today_brief | lookup | A (G) | A | A | home A4 |
| 4 | home | If I spend £40 today what is left? | get_safe_to_spend, calculate | what-if | A (L) | A | A | home A7 |
| 5 | home | How many days until payday? | get_safe_to_spend | arithmetic | A (L) | A | A | home A7.5 |
| 6 | home | What is 1,250 minus 380? | calculate | arithmetic | R (L) | A | A | (Kevin 2026-10-08) |
| 7 | home | What is 15% of £2,400? | calculate | arithmetic | R (L) | A | A | (Kevin 2026-10-08) |
| 8 | home | Take £1,250.00 away from £4,310.50 | calculate | arithmetic | A (L) | A | A | (Kevin 2026-10-08) |
| 9 | home | Why is Safe to Spend lower than my balance? | explain, get_safe_to_spend | explanation | A (C) | A | A | home A7.3 |
| 10 | home | What does Safe to Spend include and leave out? | explain | explanation | A (C) | A | A | home A7 |
| 11 | home | How do I hide my balances? | explain | how-do-I | A (C) | A | A | home A0 |
| 12 | home | How fresh is my bank data? | get_accounts | lookup | A (C) | A | A | home A7.7 |
| 13 | home | How much could I save from the insights? | get_insights | lookup | A (C) | A | A | home A8 |
| 14 | other | Can I afford a £2,000 holiday next August? | check_affordability | what-if | A (G) | A | A | penny sheet |
| 15 | other | Split a £132.60 bill four ways | calculate | arithmetic | R (L) | A | A | (arithmetic) |
| 16 | other | What is 20% off £86.50? | calculate | arithmetic | R (L) | A | A | (arithmetic) |
| 17 | other | What is the weather like in London tomorrow? | none | control | D (L) | D | D | rule 5 |
| 18 | other | Which ISA provider should I open an account with? | none | control | D (L) | D | D | rule 3 / FCA |
| 19 | other | Stop setting things up | deterministic revoke | how-do-I | A (C) | A | A | B13 |
| 20 | other | Set up £50 a month for holidays | propose_create_allocation | propose | A (C) | A | A | action-inv |
| 21 | other | Which payment fills my holiday envelope? | get_fill_candidates | lookup | A (C) | A | A | action-inv |
| 22 | upcoming | What bills are left this pay period? | get_upcoming_bills | lookup | A (G) | A | A | planning A9 |
| 23 | upcoming | Add up all my bills this pay period | get_upcoming_bills, calculate | arithmetic | A (L) | A | A | planning A2 |
| 24 | upcoming | When is my next salary expected? | get_upcoming_bills | lookup | A (C) | A | A | planning A9 |
| 25 | upcoming | How much will I have at payday after bills? | get_safe_to_spend, get_upcoming_bills, calculate | what-if | A (C) | A | A | planning A2 |
| 26 | upcoming | Why does my Netflix bill look different this month? | get_recurring_payments | explanation | A (C) | A | A | planning A9 |
| 27 | upcoming | How do I stop a bill being predicted? | explain | how-do-I | A (G) | A | A | planning A9 |
| 28 | upcoming | Skip my next gym payment | propose_skip_occurrence | propose | A (C) | A | A | action-inv |
| 29 | upcoming | What is the difference between my busiest and quietest week of bills? | get_upcoming_bills, calculate | comparison | A (C) | A | A | planning A7 |
| 30 | spend | Where did my money go this month? | get_spend_verdict | lookup | A (G) | A | A | spend 1.5 |
| 31 | spend | Am I spending more than usual? | get_spend_verdict | comparison | A (G) | A | A | spend 2.4 |
| 32 | spend | What did I spend on groceries this period versus last? | get_spend_verdict x2 | comparison | A (L) | A | A | spend 2.12 |
| 33 | spend | What is my average weekly grocery spend over the last 3 months? | get_category_spend, calculate | arithmetic | W (L) | A | A | spend 2.12 |
| 34 | spend | How much have I spent at Tesco in total over 6 months? | search_transactions | arithmetic | W (C) | A | A | spend 0 |
| 35 | spend | How many payments did I make to Amazon this year? | search_transactions | lookup | W (C) | A | A | spend 0 |
| 36 | spend | Who are my biggest eating-out merchants? | get_category_spend | lookup | A (C) | A | A | spend 2.6 |
| 37 | spend | Why is Out different from my bank's spent figure? | explain | explanation | A (G) | A | A | spend 1.5 |
| 38 | spend | What does Moved mean? | explain | explanation | A (G) | A | A | spend 1.7 |
| 39 | spend | What would filing Eating out as my new normal change? | preview_trend_intent | what-if | A (C) | A | A | spend 4.1 |
| 40 | spend | File Eating out as my new normal | propose_record_trend_intent | propose | A (C) | A | A | spend 2.8 |
| 41 | spend | Recategorise this Uber payment as Transport | propose_recategorise_transaction | propose | A (C) | A | A | spend 4.3 |
| 42 | spend | How much would I save over a year if I cut £12 a week from takeaways? | calculate | what-if | A (L) | A | A | (what-if) |
| 43 | spend | What share of my Out is groceries? | get_category_spend, get_spend_verdict, calculate | arithmetic | A (C) | A | A | spend 2.13 |
| 44 | spend | Which category has risen most against my usual? | get_spend_verdict | comparison | A (C) | A | A | spend 2.2 |
| 45 | spend | What is my average spend per day this period? | get_spend_verdict, calculate | arithmetic | A (C) | A | A | spend 1.2 |
| 46 | planning | How much more do I need to reach my Japan goal? | get_goals, calculate | arithmetic | M (L) | A | A | planning C2 |
| 47 | planning | When will I reach my £2,000 Japan goal at my current rate? | get_goals, calculate | projection | M (L) | A | A | planning C2 |
| 48 | planning | Am I on track for my goals? | get_goals | lookup | A (C) | A | A | planning C2 |
| 49 | planning | What is a Lifetime ISA? | explain | explanation | A (G) | A | A | planning chips |
| 50 | planning | Saving vs investing, how does it work? | explain | explanation | A (G) | A | A | planning chips |
| 51 | planning | Plan a £3,000 expense for next June | propose_create_commitment | propose | A (C) | A | A | planning C1 |
| 52 | planning | How do I change my pay period? | explain | how-do-I | A (C) | A | A | planning D5 |
| 53 | planning | Which rung of my priority plan am I on? | none (ladder only via explain) | lookup | P (C) | P | P | planning E2 |
| 54 | planning | If I add £100 a month to Japan, when do I finish? | get_goals, calculate | projection | W (C) | A | A | planning C2 |
| 55 | tax | How does pension carry-forward work? | explain / general knowledge | explanation | A (G) | A | A | tax chips |
| 56 | tax | How much personal allowance do I have left? | get_tax_position | lookup | A (G) | A | A | tax |
| 57 | tax | What counts as salary sacrifice? | general knowledge | explanation | A (C) | A | A | tax chips |
| 58 | tax | Do I need to register for self-assessment? | general knowledge | explanation | A (C) | A | A | tax chips |
| 59 | tax | If I put £2,000 into my pension, how far does my adjusted net income drop? | get_tax_position, calculate | what-if | A (C) | A | A | tax |
| 60 | tax | How far am I from the £100,000 allowance taper? | get_tax_position, calculate | comparison | A (C) | A | A | tax |
| 61 | insights | What is the single best saving Penny has found? | get_insights | lookup | A (C) | A | A | insights 1.4 |
| 62 | insights | How much have I saved so far by acting on insights? | get_insights | lookup | A (C) | A | A | insights 1.24 |
| 63 | insights | If I switched broadband and saved £10 a month, what is that over a year? | calculate | what-if | R (L) | A | A | insights 1.4 |
| 64 | insights | Pin the broadband insight | propose_pin_insight | propose | A (C) | A | A | action-inv |
| 65 | insights | What does my Mirror say about me? | get_mirror | lookup | A (G) | A | A | mirror |
| 66 | insights | How is my food aim going? | get_mirror | lookup | A (C) | A | A | mirror |
| 67 | grow | Am I saving enough? | get_savings_position | lookup | A (G) | A | A | grow E1 |
| 68 | grow | If I save £200 a month, how much will my savings be in 6 months? | get_savings_position, calculate | what-if | R (L) | W | A | grow E4 |
| 69 | grow | What is the difference between a cash ISA and a stocks and shares ISA? | explain | explanation | A (C) | A | A | grow chips |
| 70 | grow | How many months of spending does my savings cover? | get_savings_position, get_spend_verdict, calculate | arithmetic | A (C) | A | A | grow E6 |
| 71 | debt | How am I doing on my debt? | get_debt_position | lookup | A (G) | A | A | debt chips |
| 72 | debt | When will my card be clear? | get_debt_position | projection | A (G) | A | A | debt chips |
| 73 | debt | What is a year of interest on £380 at 24.9% APR? | calculate | arithmetic | R (L) | A | A | (arithmetic) |
| 74 | debt | How much interest are my cards costing me a month? | get_debt_position | lookup | A (C) | A | A | debt |
| 75 | debt | If I pay £300 a month, when is my Visa cleared? | get_debt_position, calculate | projection | W (C) | P | A | debt |
| 76 | debt | Set my Amex APR to 22.9% | propose_set_card_apr | propose | A (C) | A | A | action-inv |
| 77 | accounts | What is my total across all accounts, counting the card as debt? | get_accounts, calculate | arithmetic | A (L) | A | A | accounts 2.1 |
| 78 | accounts | Why did my ISA balance change this week? | get_account_activity | lookup | A (G) | A | A | accounts |
| 79 | accounts | How much came into and went out of my current account in 30 days? | get_account_activity | lookup | A (C) | A | A | accounts |
| 80 | accounts | How do I add an ISA? | explain | how-do-I | A (G) | A | A | accounts chips |
| 81 | accounts | What share of my card limit am I using? | none (limit not stored) | lookup | P (C) | P | P | accounts 2.10 |
| 82 | accounts | Which accounts need reconnecting? | get_accounts | lookup | A (C) | A | A | accounts 2.4 |
| 83 | accounts | Hide my balances | propose_set_hide_balances | propose | A (C) | A | A | action-inv |
| 84 | accounts | What do my subscriptions add up to each month? | get_recurring_payments, calculate | arithmetic | A (C) | A | A | insights 4 |
| 85 | accounts | Which recurring payments have gone up in price? | none (no price history) | comparison | P (C) | P | P | insights 4 |
