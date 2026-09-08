# Sorted: unit economics, tier revision and MCP connector design (draft 2026-09-06)

Status: proposal for Kevin's review. Nothing here is built except where marked SHIPPED. Currency: GBP, with $1.28 = £1 for AI prices. All AI prices are list prices on 2026-09-06 (Anthropic first-party rates for Haiku 4.5: $1 per million input tokens, $5 per million output, cache reads about a tenth of input; Gemini 2.5 Flash via OpenRouter: $0.30 in, $2.50 out). OpenRouter adds roughly 5.5% on credit purchases.

## 1. What the AI actually costs today

Measured from the codebase (20 OpenRouter call sites, all Haiku 4.5 except PDF and receipt parsing on Gemini 2.5 Flash):

| Pipeline | Trigger | Approx cost per event | Per active user per month |
|---|---|---|---|
| Categorisation (merchant judgement) | Only for merchants not in the shared cache; about 40 on first connect, then a few a month | £0.0006 | £0.03 first month, then under £0.01 |
| Savings insights, recurring judge, cycle story, money shape, memory | Weekly refresh after sync | £0.005 to £0.01 each | £0.03 to £0.05 |
| Statement PDF parsing (Gemini) | Per uploaded statement | £0.01 text, up to £0.03 with page images | £0.02 to £0.10 depending on uploads |
| Receipt scanning (Gemini vision) | Per receipt | £0.01 | small |
| **Everything except Penny** | | | **about £0.05 to £0.10** |

Penny is different. Each message runs a tool loop (system prompt about 1,500 tokens, read-tool schemas about 4,500 tokens, propose-tool schemas about 2,500 tokens, plus thread history and tool results), re-sent on every loop round, temperature 0, 500 output tokens per round, typically 2 to 3 rounds.

| Penny cost per message | Input tokens | Cost |
|---|---|---|
| Today, no prompt caching | about 36,000 across 3 rounds | **£0.033** |
| With prompt caching on the static prefix (system + tools) | about 13,000 billable-equivalent | **£0.015** |

So a user sending 30 Penny messages a month costs £1.00 today and £0.45 with caching. A heavy user at 200 messages costs £6.60 today, which is most of a £9.99 subscription. Two facts drive the whole plan:

1. `ai_chat_messages_per_month` exists in `core/subscription.py` but is enforced nowhere. There is no per-user usage metering of any kind. Caps cannot be applied until metering exists.
2. Prompt caching is not enabled on the Penny request. It is a request-shape change, not a product change, and roughly halves Penny's cost.

## 2. Fixed and variable costs at launch

Fixed, per month (ex VAT where recoverable):

| Item | Monthly |
|---|---|
| Finexer AIS subscription | £450 (+£90 VAT, recoverable only if VAT registered) |
| MongoDB Atlas M10 (M0 free tier is not viable past a few hundred users: 512 MB, no backups, 500 connections) | about £45 |
| Railway (web + worker + Redis; Hobby $5 plus usage, Pro $20 seat when replicas are needed) | about £60 at 500 users |
| Vercel Pro (already on Pro) | £16 |
| Apple developer programme | £8 |
| Cloudflare R2, Codemagic, domains | about £5 |
| **Total fixed** | **about £585 ex VAT, £675 if VAT is not recoverable** |

Variable, per paying user per month:

| Item | Cost |
|---|---|
| Finexer per connected account, 10p per connected account per month, confirmed by Finexer; average 3 accounts | £0.30 |
| Non-Penny AI | £0.07 |
| Penny at 60 messages, cached | £0.90 |
| Payment processing on £9.99 (ex VAT £8.33): Apple or Google in-app purchase at 15% small business rate | £1.25 |
| Same via Stripe on the web (1.5% + 20p) | £0.33 |

Contribution per Standard (£9.99) user: **£5.81 via app store billing, £6.73 via Stripe.**

## 3. Break-even

| Scenario | Paying users needed |
|---|---|
| Fixed £585, app store billing | about 100 |
| Fixed £585, Stripe | about 87 |
| Fixed £675 (VAT not recoverable), app store | about 116 |

At 500 total users: 30% paying (150) gives roughly £250 a month profit; 20% paying (100) is break-even; below that it loses money. The target of "break even at 500 users or fewer" therefore means **at least 20 to 25% of users on a paid tier**, or fewer total users if conversion is higher. Free users cost about £0.05 to £0.10 each with the statements-only design, which is why the free tier must not include an open banking connection (that adds Finexer's per-account fee and 4-hourly sync load for someone paying nothing).

## 4. Proposed tiers

Users understand "messages", not tokens. Sell Penny in messages, meter tokens internally, and size each cap so the worst case still leaves margin.

| Tier | Price | Bank connections | Refresh | Penny messages / month | MCP connector | History | Notes |
|---|---|---|---|---|---|---|---|
| Statements (free) | £0 | none; statement upload only | on upload | 10 | no | 90 days | 3 uploads a month; no Finexer cost |
| Lite | £5.99 | up to 3 connected banks | daily | 40 | no | 6 months | |
| Standard | £9.99 | up to 20 accounts | 4-hourly plus manual | 150 | no | full | insights, debt plan, allocations |
| Connect | £12.99 | up to 20 accounts | 4-hourly plus manual | 150 | yes, 2,000 tool calls | full | Standard plus MCP |
| Max | £16.99 | unlimited (fair use 40 accounts) | priority | 400 | yes, 5,000 tool calls | full | |
| Top-up | £2.99 | | | +100 messages | | | cost about £1.50 cached; expires with the billing month |

Worst-case Penny cost at the cap (cached): Lite £0.60, Standard £2.25, Max £6.00. Contribution at the cap with app store billing: Lite about £2.80, Standard about £4.50, Max about £5.70. Every tier stays positive at its cap, which is the point of the caps.

Account limits are not the margin lever. Each account costs about 10p a month, so a user with 17 accounts costs £1.70, well inside a £9.99 subscription, and competitors such as Emma offer unlimited connections at a similar price. Worst case on Standard, 20 accounts and all 150 Penny messages, still contributes about £2.75 after store fees; the 20-account cap costs at most £2 a month in Finexer fees and gives Max a reason to exist beyond Penny volume. Lite keeps a low cap because at £5.99 the per-account fee adds up faster and it gives Standard a clear reason to exist beyond Penny. The difference between Lite and Standard is refresh cadence, history depth and Penny allowance.

Why the MCP tiers are the best margin in the table: an external assistant (Claude, ChatGPT) does the reasoning on the user's own subscription. Sorted only answers deterministic tool calls, so the cost is API compute, not model tokens. The £3 uplift on Connect is almost entirely margin, bounded only by rate limits.

Billing channel: digital subscriptions bought inside the iOS or Android app must use Apple or Google billing (15% at this size). Web checkout via Stripe avoids that. Recommendation: Stripe on the website as the primary checkout, in-app purchase offered at the same price for people who buy inside the app, and no mention of web pricing inside the app.

Migration from the current code: replace the four existing tiers (free, pro, premium, family) and `TIER_LIMITS` with the five above; `check_connection_limit` already exists and is wired on connect; `require_tier` gates exist on categories and investments. New work is the metering and the caps.

## 5. Build order (proposal)

1. **Usage metering (first, before any cap).** New `llm_usage` collection: user_id, pipeline, model, input tokens, cached input tokens, output tokens, cost in USD, timestamp, from every OpenRouter response's `usage` object. Monthly rollup per user and per pipeline. This also answers "what does AI cost us" with real numbers instead of this estimate.

   **Cost dashboard.** `GET /admin/llm-usage?month=YYYY-MM` (bot or owner session only) reads that same `llm_usage` collection and returns totals, a per-pipeline breakdown, a per-user breakdown with tier and top pipeline, and mean/median/p90 cost per user, for one calendar month at a time. Call it with the bot token: `curl -H "Authorization: Bearer $BOT_SECRET" "$API/admin/llm-usage?month=2026-09"`. Its per-user cost, call and token figures supersede the estimates in this section, so treat this endpoint as the source of truth for real AI cost per user from here on.
2. **Prompt caching on Penny.** Mark the system prompt and tool schemas with cache control in the OpenRouter request (Anthropic models honour it through OpenRouter). Only offer the propose-tool schemas once agent-mode consent exists, which removes 2,500 tokens per round for everyone else.
3. **Caps.** Penny messages per month by tier, checked before the call; Settings shows "Penny messages used 37 of 150"; a friendly stop message at the cap with the top-up route.
4. **Tier model swap** and the free statements-only path (upload already exists via the Gemini PDF parser).
5. **Billing:** Stripe subscriptions on the web, then App Store and Play subscription products, then top-ups as consumable in-app purchases.
6. **OpenRouter account:** move from Kevin's personal account to an AURIQ LTD organisation account with per-environment keys and spend limits, privacy setting "deny data collection" at account level (already sent per request), and their data processing terms on file for the sub-processor record. Revisit direct Anthropic and Google contracts when monthly spend passes a few hundred pounds, to remove the 5.5% gateway fee.

## 6. Does Railway scale to 10,000 users?

The architecture (stateless API, arq worker, Redis, Mongo) scales; the current sizing does not.

| Concern | 500 users | 10,000 users |
|---|---|---|
| Database | Atlas M10 | M20 or M30; data is about 0.3 MB per user plus indexes, so roughly 5 to 8 GB |
| API | one Railway web instance | 2 to 3 replicas behind Railway's load balancer; needs Railway Pro |
| State that assumes one process | fine | `_pending` mobile-login dict in `routers/auth.py` and the in-memory rate limiter must move to Redis before running replicas |
| Sync load | 4-hourly reconcile of all connections, trivial | 10,000 connections every 4 hours is about 42 syncs a minute; spread syncs across the window, check Finexer's rate limits, and run 2 worker replicas |
| Response cache | Mongo-backed, versioned (shipped 2026-09-05) | fine |
| Monthly infra cost | about £120 | about £400 to £600 excluding AI |

## 7. MCP connector: design and what changes for Finexer

What it is: a remote MCP server that lets a user's own AI assistant (Claude, ChatGPT, others) read their Sorted data through the same deterministic tools Penny uses. Read-only in v1.

Design:
- Transport: Streamable HTTP MCP endpoint on the existing backend, for example `/mcp`, so it inherits the same data layer and deployment.
- Authorisation: OAuth 2.1 with PKCE and dynamic client registration, which is what the Claude and ChatGPT connectors expect. Sorted becomes an authorisation server: the user signs in with Google or Apple on our consent page, sees the scopes, approves, and receives a short-lived access token with a refresh token. Tokens are revocable from Settings, listed under "Connected assistants", with the client name and last-used time.
- Tools: v1 exposes the read tools from `services/penny_tools.py` (`TOOL_SCHEMAS`) through `execute_tool` with the token's user, never the propose tools. Owner decision 2026-09-08: no raw transactions over the connector in v1. `search_transactions` is excluded, `get_account_activity` is served without its per-transaction rows, and every other tool's output is audited for merchant, date and amount rows before it is exposed. Assistants get aggregates, verdicts and figures. `explain(topic)` stays included so assistants can use the same explanations Penny does.
- Data minimisation: tool outputs never include account numbers, sort codes, IBANs, card numbers, provider consent ids or tokens. Accounts are identified by Sorted's own ids and display names. In v1 no transaction-level rows are returned at all; a later version may add an explicit `transactions:read` scope with its own consent line.
- Scopes: `accounts:read`, `plans:read`, `insights:read` in v1. `transactions:read` is deferred. Assistants request what they need; the consent page shows it in plain language.
- Limits: per-user rate limit and the tier's monthly tool-call allowance; per-token audit log of every call (tool name, timestamp, client) visible to the user.
- Prompt-injection posture: the assistant is outside our trust boundary, so tools are read-only, inputs are validated exactly as Penny's are, and nothing an assistant sends can change data in v1.
- Tiering: included in Connect (£12.99) and Max (£16.99).

What this changes for Finexer and the legal pages (this is the "material change" noted at onboarding):
- The user's chosen AI provider becomes a recipient of account information, at the user's own instruction and under the user's own contract with that provider. This is a user-directed disclosure, not a Sorted sub-processor, and the policy should say so.
- Privacy Policy: new section "AI assistants you connect", listing what the assistant can read, that banking identifiers are never included, that Sorted keeps an audit log, and how to revoke. Terms: a clause that the user is responsible for the assistant they connect.
- Finexer questionnaire Q2 and Q9: disclose the connector as a change to data sharing, describe the read-only scope, the masking, the revocation path, and that no payment or write capability is exposed. Q8 is unaffected: the assistant may give its own advice, but Sorted's tools only return the user's data and Sorted's own deterministic figures.
- FCA framing: Sorted still only displays and passes on account information to the user or their nominee; nothing about the agent arrangement changes. Worth confirming with Finexer in writing since they were open to it.

Engineering estimate: the tool layer is already shaped for this (see the "Not-MCP decision" note in PENNY_TOOLS.md). The real work is the OAuth 2.1 authorisation server, the consent page, token storage and revocation, the audit log and the rate limits, then the two policy updates. Roughly two to three weeks of agent work with review, best started after the Finexer production approval so it does not land inside the due diligence window.

F3 status (2026-09-08): the read-only `/mcp` endpoint itself shipped to UAT. Tool exposure, masking, scopes, the per-user rate limit, the tier allowance and the audit log are all live, authenticated with the app's own session bearer. F2 (the OAuth 2.1 authorisation server above) is still not started, so there is no consent page or per-token revocation yet; see DEPLOY.md's "MCP connector" section for how to point a connector at it in the meantime.

## 8. Retention jobs still missing

Both PRIVACY.md section 8 and SECURITY.md section 6 promise two automated sweeps that do not exist in code:
1. Dormant accounts deleted after 12 months of inactivity.
2. Account and transaction data deleted within 30 days of consent withdrawal or expiry even if the customer never presses Disconnect.
Account deletion and bank disconnection already cascade immediately, so those promises are met. The two sweeps are a nightly arq cron job of modest size: find users whose last activity is older than 12 months and run the existing account-deletion routine; find connections whose consent has been revoked or expired for more than 30 days and run the existing disconnect routine. Recommended before go-live so Q10 can be answered without a caveat.


## 9. Penny top-up packs (proposal 2026-09-07)

Real metering from `GET /admin/llm-usage?month=2026-09` on UAT (5 Penny calls, 3 messages, 27k of 38k prompt tokens served from cache) puts a cached Penny message at roughly £0.004 to £0.006. That is a tiny sample, so this section sizes margins on the conservative £0.015 planning figure from section 1 and treats the measured figure as upside.

Design rules for the packs:

1. Three packs, good / better / best. The middle pack is the target and is labelled "Most popular"; the largest carries "Best value". A single £2.99 row gives the user nothing to compare against.
2. The smallest pack is an impulse price. It exists to remove friction at the moment the cap is hit, and to give free-tier users a first purchase.
3. Per-message price falls with pack size, but the largest pack must stay close to the marginal price of moving up a tier so that repeat buyers are nudged to a subscription rather than living on packs. Marginal tier rates today: Lite to Standard is £4 for 110 messages (3.6p each); Standard to Max is £7 for 250 messages (2.8p each).
4. Prices use standard App Store and Play price points so the same SKU prices work in-app and on Stripe.

| Pack | Messages | Price | Per message | Net to us (UK VAT out, 15% store fee) | Worst-case AI cost at £0.015 | Margin worst case | Margin at measured £0.005 |
|---|---|---|---|---|---|---|---|
| Small | 20 | £0.99 | 5.0p | £0.70 | £0.30 | £0.40 | £0.60 |
| Medium ("Most popular") | 100 | £2.99 | 3.0p | £2.12 | £1.50 | £0.62 | £1.62 |
| Large ("Best value") | 200 | £4.99 | 2.5p | £3.53 | £3.00 | £0.53 | £2.53 |

Via Stripe on the web the net is about £0.62 / £2.25 / £3.80 respectively (ex VAT, less 1.5% + 20p).

The large pack sits about 10% under the Standard to Max marginal rate. That is deliberate: rounder numbers convert better than 175 for £4.99, and the sheet handles the cannibalisation risk in software instead:

- The "Move to Max, 400 a month" row stays on the sheet as the anchor under the packs.
- After a user's second pack purchase in one calendar month, the sheet leads with Move to Max and shows the packs below it.
- Pack messages are consumed only after the monthly allowance is used up, and they no longer expire at month end. They last 90 days from purchase. "This month only" makes the large pack a bad buy in the last week of a month and suppresses exactly the purchase we most want. This changes `penny_topups` from a `year_month` keyed record to a purchase record with `expires_at` and `remaining`, and `penny_allowance` in `core/subscription.py` draws down the oldest unexpired pack first.
- Packs are available on every tier including Statements (free). The free tier's 10 messages plus a £0.99 pack is the cheapest possible first transaction.

Copy on the sheet (no em dashes): "20 messages, £0.99", "100 messages, £2.99, Most popular", "200 messages, £4.99, Best value", footnote "Packs last 90 days and are used after your monthly allowance. Quick questions from the chips are always free."

Implementation touch points: `PENNY_TOPUP` in `backend/app/core/subscription.py` becomes a list of packs served as `topups` from `GET /subscription`; `components/MoreMessagesSheet.tsx` renders the three rows plus the Max row; the design preview at `app/design/penny-usage-ring/MoreMessagesSheet.tsx` gets the same three rows; billing wiring is item B5.
