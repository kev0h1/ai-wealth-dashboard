# Shared savings-tip research (B48)

A savings tip has two layers.

- **Research layer (shared, not personal).** Market knowledge about one provider at one price level: typical monthly prices, a few alternatives, a deal and its deadline, sources, and the date it was checked. It lives once in the `tip_research` collection and is fetched once, then read by every user who matches the key. Code: `backend/app/services/tip_research.py` (store, key, TTL, in-flight guard) and `_fetch_market_findings` in `backend/app/routers/savings_insights.py` (the only Tavily search and OpenRouter call a tip makes).
- **Personal layer.** The tip a user sees, composed deterministically by `_compose_tip_content` from the shared findings plus that user's own figures ("You pay EE £56 a month. Similar SIM-only plans typically cost £8 to £25 a month. Market check 12 Oct."). No external call. The per-user states verified, substituted and retired are untouched: they are computed from the user's own transactions exactly as before.

## The key

`(insight_category, provider_key, price_band, region "UK", prompt_version)`, stored as the document `_id` `category|provider_key|price_band|UK|vN`.

- `provider_key`: the category's own curated trigger phrase that the merchant matched (the `triggers` lists in `INSIGHT_CATEGORIES`), lowercased, punctuation and legal suffixes removed: `ee`, `british gas`, `disney plus`. A merchant outside that list (for example one a user labelled) becomes `other`, so an arbitrary merchant string can never become a key. Groceries and eating out are shared by behaviour profile instead: `profile_front_loader`, `profile_eating_out_signature` or `profile_general`, from the Mirror trait ids only.
- `price_band`: five coarse monthly buckets per category, defined once in `PRICE_BANDS` (upper edges in pounds a month; the label is `under_E0`, `E0_E1`, `E1_E2`, `E2_E3`, `over_E3`, or `unknown` when there is no spend, or `all` for profile-shared categories):

| Category | Edges |
|---|---|
| mobile | 10, 20, 40, 60 |
| broadband | 20, 30, 45, 70 |
| energy | 60, 100, 150, 250 |
| car_insurance | 30, 60, 100, 150 |
| car_finance | 150, 250, 400, 600 |
| mortgage | 500, 1000, 1500, 2500 |
| gym | 20, 40, 60, 100 |
| subscriptions | 10, 25, 50, 100 |

- `prompt_version`: `RESEARCH_PROMPT_VERSION` in `tip_research.py`. Bump it to force every key to be fetched again. It is separate from the per-user tip `PROMPT_VERSION` (now 7, so every stored tip is recomposed once into the new shape).

## TTL and failure rules

- A key is fetched at most once per **7 days** across all users (`content_valid_until` is the sooner of a deal's own deadline and fetched_at plus 7 days, the same rule as a tip). Two users in the same pass share one fetch (in-process in-flight guard plus a 5 minute database lease for a second process).
- A failed fetch keeps the last good findings, marks the document `stale` (or `failed` if there never were any), records only a static failure code, and is not retried for 6 hours by anyone. Quota, auth and rate failures also stop the rest of the pass and use the existing 24 hour backoff and admin status line (B44, `tips_research_health`). Users' existing tips stay visible with the out-of-date note.
- A deal past its deadline is never shown: it is dropped when findings are built, again when a tip is composed, and the tip's `content_valid_until` (and the existing per-tip state gate) still applies per user.
- A user who has switched tips off (G189) triggers no research and is never counted; no per-user count is stored anywhere.
- The per-pass cap `MAX_RESEARCHED_PER_PASS` (5) now counts shared fetches a user's pass triggers. Composing from fresh stored findings is free and not capped.

## Privacy rule

A `tip_research` document holds no user id, amount, transaction id, name or per-user count, and the Tavily query and the research prompt carry only the category, the curated provider name and the price band. `tip_research.assert_no_user_data` runs on every write and fails closed (the document is not written). `tests/test_tip_research_b48.py` scans every written document for forbidden keys and for any value matching the fixture users' exact amounts, emails and merchants. The collection is in `ERASURE_MANIFEST` with a comment that the per-user erasure sweep deliberately matches nothing in it, same as `instrument_prices`. The optional LLM phrasing step (`TIP_LLM_PHRASING`, off by default) sends one user's own composed tip to OpenRouter, an existing sub-processor, with no search and no other user's data.

## Cost measurement (method, not a result)

Every OpenRouter call is recorded in `llm_usage` by pipeline, and every Tavily request is recorded in the same collection with `model: "tavily"`, zero tokens and zero cost, no user id for the shared layer (`record_tavily_call` in `app/core/llm.py`). `GET /admin/llm-usage?month=YYYY-MM` returns `by_pipeline` (calls, tokens, cost) and `weekly_calls`: calls per ISO week and pipeline for the last 8 weeks.

Pipelines: before B48, `savings_insights` (OpenRouter write-up, one per user per category per pass). After: `tip_research` (OpenRouter, one per shared key per TTL), `tip_research_tavily` (Tavily, one per shared key per TTL), and `tip_phrasing` only if the flag is on. `savings_insights_tavily` is the legacy generic one-shot path, which production no longer calls.

To read the before and after: take `weekly_calls` for the last full week before the release for `savings_insights`, and for the first full week after it for `tip_research` plus `tip_research_tavily`. Tavily calls before B48 were never counted, so the Tavily "before" is the number of OpenRouter `savings_insights` calls minus retries, because each write-up was preceded by one search. Expect the after count to track distinct keys (roughly categories times providers times bands in use), not users. No measurement was taken against real UAT data in this work.

## Backfill

`backend/scripts/backfill_tip_research.py` (dry-run by default, `--apply` writes, idempotent, counts only). It seeds a key from an existing tip only with body sentences that mention nothing of the user (no second person, none of their amounts or their yearly and monthly equivalents, none of their merchant names or workflow answers, no dated promotion); titles and estimates are never copied. A seed lasts until the tip it came from would have expired, only tips still in date are used, and the first real fetch replaces it. Its realistic value is a head start in the first week after release; do not expect it to carry history.

## Proposed PRIVACY.md wording (for Kevin to approve; PRIVACY.md is not edited by this work)

Replace the Tavily row of the sub-processor table in section 7 with:

> | Tavily | Web search for market research on provider prices and deals. Receives only a product category and a provider name, never customer data |

The research is not personal data: a stored finding is keyed by category, provider and a coarse price band and holds no user identifier, amount or transaction, so it is not erased with an account (there is nothing of the user's in it). In practice Tavily never received customer data before either (the query was the category alone); what changed is that the OpenRouter write-up no longer receives a user's spend figures for tips, unless the optional phrasing flag is switched on, in which case the user's own composed tip goes to OpenRouter, an existing listed sub-processor.

**DPA:** no change needed. No new sub-processor is added, no new category of personal data is shared, and the volume of third-party calls falls.
