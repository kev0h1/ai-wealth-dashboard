# Vendor directory report (G316)

Generated 2026-10-22 by `backend/scripts/vendor_directory_report.py`. Read-only: nothing was written to transactions, rules, decisions or the directory. The owner of the primary account is the subject; no identifiers appear here.

## How this was produced

- **Simulation. No web search and no model call was made.** The Tavily quota has been exhausted since 16 Oct (HTTP 432, the B44 backoff was live) and the OpenRouter key on this host is currently rejected (HTTP 401, the account is not found), so neither the live lookup nor the model could run. A fixed word list stands in for the directory description (a name with golf in it is described as a golf club, and so on) and a word match stands in for the matcher (it picks your category named in the description). This shows the plumbing only: which rows the ladder is allowed to touch, and which would move IF the directory describes the merchant that way. It says nothing about how well the real reasoning model or matcher will do.
- Merchants given a stand-in description: **5**.
- The owner's custom categories offered to the matcher: Golf, Padel, Business, Family.

## What the ladder looked at

- Open debit rows (no hand correction): **777** across **267** merchants.
- Left alone because the owner already corrected the merchant: **21** merchants.
- Left alone because a user rule covers them: **0** merchants.
- Never sent anywhere (privacy exclusions, not named here): 15 account digits, 1 contact detail, 3 own name, 101 person payment.
- Merchants that would need a directory lookup in a real run: **126**; looked up for this report: **5**.
- Lookups not made, by reason: 121 no simulated entry.
- Rows the proposals below would move: **2**.

## Before and after, by category (open debit rows)

| Category | Before | After (looked-up merchants only) |
|---|---:|---:|
| Eating Out | 169 | 169 |
| Bills | 136 | 136 |
| Transport | 85 | 85 |
| Groceries | 79 | 79 |
| Shopping | 67 | 67 |
| Subscriptions | 67 | 67 |
| Entertainment | 52 | 52 |
| Uncategorised | 31 | 31 |
| Health | 28 | 26 (changed) |
| Golf | 21 | 23 (changed) |
| Travel | 11 | 11 |
| Padel | 7 | 7 |
| Software | 6 | 6 |
| Cash | 5 | 5 |
| Charity | 5 | 5 |
| Business | 3 | 3 |
| Family | 3 | 3 |
| Beauty | 1 | 1 |
| Other | 1 | 1 |

## Golf and sport merchants today

Every golf, sport and leisure merchant, hand-corrected rows included. A corrected row keeps the category you gave it and is never touched. `Proposed` is for the rows still open to the ladder.

| Merchant | Rows now | Hand-corrected | Category now | Proposed for open rows |
|---|---:|---:|---|---|
| West Midlands Golf Club | 17 | 17 | Golf 17 | none open |
| Playtomic | 15 | 8 | Padel 14, Golf 1 | no change proposed |
| West Midlands Golf | 9 | 5 | Golf 9 | no change proposed |
| The Gym Ltd | 7 | 0 | Health 7 | no change proposed |
| Midlands Golf | 6 | 4 | Golf 6 | no change proposed |
| The Belfry Golf Sutton Coldfiel | 5 | 1 | Golf 5 | no change proposed |
| Stonebridge Golf Centr | 3 | 3 | Golf 3 | none open |
| Midlands Golf Meriden | 2 | 2 | Golf 2 | none open |
| Midlands Golf Stonebri | 2 | 2 | Golf 2 | none open |
| Widney Manor Golf | 2 | 0 | Health 2 | Golf |
| Midlands Golf Ston | 1 | 1 | Golf 1 | none open |
| More Club Lda | 1 | 0 | Entertainment 1 | no change proposed |
| Rocky Sporting Club Lt | 1 | 0 | Entertainment 1 | no change proposed |
| Sport Centre Ecomm | 1 | 0 | Health 1 | no change proposed |
| The Gym Ltd Initial Payment | 1 | 0 | Health 1 | no change proposed |
| West Midlands Golf Club Solihull | 1 | 1 | Golf 1 | none open |

1 further sport-worded row(s) were excluded by the privacy rules (for example a person-to-person payment with golf in the reference) and are not named.

## Merchant by merchant (looked-up merchants)

| Merchant (directory name) | Rows | Current category | Proposed category | Reason |
|---|---:|---|---|---|
| Widney Manor Golf | 2 | Health | Golf | Simulated: the description names this category. |

## Looked up, no category change

| Merchant | Directory result |
|---|---|
| Rocky Sporting Club Lt | found: Gym, leisure or sports centre. |
| Sport Centre Ecomm | found: Gym, leisure or sports centre. |
| The Gym Ltd | found: Gym, leisure or sports centre. |
| The Gym Ltd Initial Payment | found: Gym, leisure or sports centre. |

## Descriptions written

| Merchant | Description | Tags | Confidence |
|---|---|---|---|
| Rocky Sporting Club Lt | Gym, leisure or sports centre. |  | low |
| Sport Centre Ecomm | Gym, leisure or sports centre. |  | low |
| The Gym Ltd | Gym, leisure or sports centre. |  | low |
| The Gym Ltd Initial Payment | Gym, leisure or sports centre. |  | low |
| Widney Manor Golf | Golf club or golf course. |  | low |

## For Kevin to check

Kevin confirms categorisation changes, so this report is the gate. Check that the golf rows (West Midlands Golf Club, Stonebridge, Widney Manor and any other golf merchant) land in Golf in the table above, that nothing you corrected by hand appears as a proposal, and that no proposal files a business in a custom category it does not belong in. Reasons come from the matcher, not from rules.
