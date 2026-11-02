# Shared savings-tip research (B48)

A savings tip has two layers.

- **Research layer (shared, not personal).** Market knowledge about one provider at one price level: typical monthly prices, a few alternatives, a deal and its deadline, sources, and the date it was checked. It lives once in the `tip_research` collection and is fetched once, then read by every user who matches the key. Code: `backend/app/services/tip_research.py` (store, key, TTL, in-flight guard) and `_fetch_market_findings` in `backend/app/routers/savings_insights.py` (the only Tavily search and OpenRouter call a tip makes).
- **Personal layer.** The tip a user sees, composed deterministically by `_compose_tip_content` from the shared findings plus that user's own figures ("You pay EE £56 a month. SIM-only plans are listed at £8 to £25 a month. Checked 12 Oct, source uswitch.com."). G283: facts only, with a source and a date; no saving is claimed or estimated, the model's free-text headline is not kept, and every string passes the banned-phrase list in `app/services/tip_copy.py`. No external call. The per-user states verified, substituted and retired are untouched: they are computed from the user's own transactions exactly as before.

## The key

`(insight_category, provider_key, price_band, region "UK", prompt_version)`, stored as the document `_id` `category|provider_key|price_band|UK|vN`.

- `provider_key`: the category's own curated trigger phrase that the merchant matched (the `triggers` lists in `INSIGHT_CATEGORIES`), lowercased, punctuation and legal suffixes removed: `ee`, `british gas`, `disney plus`. A merchant outside that list (for example one a user labelled) becomes `other`, so an arbitrary merchant string can never become a key. Groceries and eating out are shared by behaviour profile instead. Behind `TIP_RESEARCH_PROFILE_KEYS` (default off) every user shares `profile_general` and no portrait is read; switched on, the key is `profile_front_loader`, `profile_eating_out_signature` or `profile_general`, from the Mirror trait ids only. A behavioural key is marginal at small scale, so turn it on only once a profile key is a crowd rather than a person.
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

A `tip_research` document holds no user id, amount, transaction id, name or per-user count, and the Tavily query and the research prompt carry only the category, the curated provider name and the price band. `tip_research.assert_no_user_data` runs on every write and fails closed (the document is not written). It rejects forbidden keys, any email-like string, any "£" or decimal figure inside a text value (figures live only in `typical_low`, `typical_high`, `alternatives[].price` and `deal.price`, as grounded numbers), any plain number elsewhere in `findings`, and first or second person words (you, your, I, my, me, we, our) in text fields. Findings text that fails is dropped when findings are built. `tests/test_tip_research_b48.py` scans every written document for forbidden keys and for any value matching the fixture users' exact amounts, emails and merchants. The collection is in `ERASURE_MANIFEST` with a comment that the per-user erasure sweep deliberately matches nothing in it, same as `instrument_prices`. The optional LLM phrasing step (`TIP_LLM_PHRASING`, off by default) sends one user's own composed tip to OpenRouter, an existing sub-processor, with no search and no other user's data.

## Cost measurement (method, not a result)

Every OpenRouter call is recorded in `llm_usage` by pipeline, and every Tavily request is recorded in the same collection with `model: "tavily"`, zero tokens and zero cost, no user id for the shared layer (`record_tavily_call` in `app/core/llm.py`). `GET /admin/llm-usage?month=YYYY-MM` returns `by_pipeline` (calls, tokens, cost) and `weekly_calls`: calls per ISO week and pipeline for the last 8 weeks.

Pipelines: before B48, `savings_insights` (OpenRouter write-up, one per user per category per pass). After: `tip_research` (OpenRouter, one per shared key per TTL), `tip_research_tavily` (Tavily, one per shared key per TTL), and `tip_phrasing` only if the flag is on. `savings_insights_tavily` is the legacy generic one-shot path, which production no longer calls.

To read the before and after: take `weekly_calls` for the last full week before the release for `savings_insights`, and for the first full week after it for `tip_research` plus `tip_research_tavily`. Tavily calls before B48 were never counted, so the Tavily "before" is the number of OpenRouter `savings_insights` calls minus retries, because each write-up was preceded by one search. Expect the after count to track distinct keys (roughly categories times providers times bands in use), not users. No measurement was taken against real UAT data in this work.

## Backfill

`backend/scripts/backfill_tip_research.py` (dry-run by default, `--apply` writes, idempotent, counts only). It copies nothing from any tip, because a stored tip mixes market facts with the user's own figures and no filter can be trusted to separate them. For tips still in date it derives the shared key in memory and, if the key has no document, creates an empty `pending` stub (key fields and the lease only: no findings, no timestamps). The shared layer therefore fills from fresh fetches in the first week after release, one per key. The backfill is optional; the first pass creates the same keys itself.

## Proposed PRIVACY.md wording (for Kevin to approve; PRIVACY.md is not edited by this work)

Make the Tavily row of the sub-processor table in section 7 additive, keeping the existing disclosure:

> | Tavily | Web search, used for merchant and product identification (merchant names only) and for market research on provider prices and deals (product category and provider name only) |

Tavily still receives merchant names for categorisation, card rates and prices; the research addition is only a category and a provider name. The research is not personal data: a stored finding is keyed by category, provider and a coarse price band and holds no user identifier, amount or transaction, so it is not erased with an account (there is nothing of the user's in it). In practice Tavily never received customer data before either (the query was the category alone); what changed is that the OpenRouter write-up no longer receives a user's spend figures for tips, unless the optional phrasing flag is switched on, in which case the user's own composed tip goes to OpenRouter, an existing listed sub-processor.

**DPA:** no change needed. No new sub-processor is added, no new category of personal data is shared, and the volume of third-party calls falls.

## G315: factual tip rules and cache invalidation (2026-10-21)

- Rules live in `backend/app/services/tip_facts.py`: regulated categories (mortgage, car finance and loans, credit cards and balance transfers, insurance, pensions, investments, and any unknown category whose key or label names one) are never researched and carry only the user's own fact; "Also listed" passes `is_like_for_like` (same product type, stated monthly price, allowlisted named source) or is dropped; one headline sentence per card (`headline_for`) shared with the lead line; merchant names cleaned and merged (`present_triggers`); sources shown by name from an allowlist, SEO price sites refused; one freshness line.
- Every serialized card runs `tip_facts.card_violations` on top of the `tip_copy` banned-phrase list; a card that breaks a rule is hidden, never edited.
- Cache: `PROMPT_VERSION` is 9 and `MIN_SERVE_PROMPT_VERSION` is 9. A stored tip below that version is never served (it reads as no tip) and the weekly pass regenerates it (`_regen_reason` returns `prompt_upgraded`). Shared research documents are NOT refetched (`RESEARCH_PROMPT_VERSION` stays 1, Tavily spend is Kevin's call). Instead only findings written by the G315 `_build_findings` carry `findings_schema: "g315-2"`; without that marker no range, deal or alternative is ever composed from them (fail closed), so old shared findings contribute nothing until their key is refetched on its normal 7 day TTL. Each alternative's price must also be derivable from the snippet of the host it cites. Subscriptions have no like-for-like product type (tiers and audio versus video cannot be told from a bank row), so they never show a market line.
- Review document with before and after for every category: `docs/copy/tips-review-2026-10.md` (renderer: `backend/tests/g315_review_render.py`).

### One-off regeneration after merge

`backend/scripts/regen_tips.py` (ops only). Dry run by default: it reads and prints counts of users and stored tips below the served version. `--apply` enqueues the existing `task_refresh_savings_insights` job once per such user using the weekly job id (so nobody is queued twice in a week, and the job's own research caps and guards still apply). Counts only, no ids printed. Run from `backend/` with `.venv/bin/python scripts/regen_tips.py [--env-file .env] [--apply]`.

## G405: page text and regulator figures (2026-11-02, Kevin chose option A)

Why: a search snippet is 250 characters and rarely holds a provider's name and its monthly price together, so the G315 gate dropped nearly every listing and Energy and Mobile tips said only what the user pays.

**Page fetch** (`backend/app/services/tip_pages.py`, called from `_fetch_market_findings` after the Tavily search). For each returned URL whose host `tip_facts.allowed_source_name` accepts (a provider's own site only for that provider), at most 3 pages per research:
- URL safety (review B1): `tip_pages.safe_https_host` parses with `httpx.URL` and requires scheme https, no userinfo and port 443 or none, then compares the lower-case host with `www.` removed. It runs before the allowlist, on every redirect hop, and when admitting Tavily URLs and stored sources. `tip_facts.host_of` itself returns "" for any netloc containing "@" (so `https://ofgem.gov.uk:x@evil.com/` is never on the allowlist).
- One https GET per hop, 10 s timeout, a 15 s deadline across all hops, User-Agent `SortedTipResearch/1.0`, `Accept-Encoding: identity`; a response with any other content-encoding is refused and bytes are read raw, capped at 400 KB, so a decompression bomb cannot expand. Redirects are followed by hand, same host only, at most 3. `text/*` or xhtml only.
- Text: tags, scripts and styles stripped, whitespace collapsed, then prefiltered by `price_sentences`: only sentences with a pound figure, each with the sentence before it as a lead-in, in page order, at most 2500 characters per host (a long menu with no full stop is cut to the stretch around its first figure). The G315 rules and the model see the same text and page chrome cannot crowd out prices. It is added beside the snippets as `Page <host>: ...` and is never stored.
- The G315 rules are unchanged except one tightening: the provider must be the only one named in the 80 character window before the price, so a list ("Octopus, EDF, British Gas deals from £146 a month", or names joined by "and", "or", "&", "/") yields no listing.
- A failed fetch (status, type, encoding, timeout, off-host or userinfo redirect) degrades to the snippet path and is counted; nothing raises. Non-allowlisted hosts are never requested.

**Counters.** Each research stores `fetch_stats` on its shared document and appends to `fetch_history`, counts only: `pages_fetched`, `pages_failed`, `listings_from_pages`, `listings_from_snippets`, `regulator_read`, `regulator_failed`, plus `has_listing` and `has_regulator`. `HISTORY_KEEP` is 60: a healthy key runs once per 7 day TTL, but a failing key is retried every 6 hours (4 a day), so 14 days is at most 56 runs. `tip_research.fetch_summary(14)` sums the last 14 days and is served in `GET /admin/sync-stats` under `tips_research.fetch_counts` (runs, runs_with_listing, runs_with_regulator and the totals).

**Regulator "Typical" line** (`backend/app/services/tip_regulators.py`). One row today: energy, Ofgem. Ofgem's stable pages carry no figure; only the quarterly price cap press release does. So each energy research runs ONE extra Tavily search (`site:ofgem.gov.uk "price cap" "typical household"`, pipeline `tip_research_tavily`, so it is counted and subject to the same backoff), then fetches up to 2 of the ofgem.gov.uk URLs returned, in result order (results carry no date; the first page that yields a figure wins). Extraction is period-aware and uses no model:
- Ofgem caps run in calendar quarters (1 Jan, 1 Apr, 1 Jul, 1 Oct). `current_period(user-day date)` gives the current one. A page is accepted only if its text or `<title>` (the title leads the extracted text) names that period: the start month with the year ("October 2026") or the "1 October" and "31 December" pair. Otherwise None: it is a stale or future release (an August release read in September, or a July release read in November, yields nothing).
- On an accepted page, a sentence with a change word (rise, rises, rising, fall, falls, falling, increase, decrease, go up, go down, change, changes; with or without "will", so "is set to rise" counts) followed by "to £Y", with "price cap", "direct debit" and "typical household" (or "typical domestic household") in the 350 characters before Y, gives Y (the level for the named period). The "is £X" figure (the three phrases within the 200 characters before it, the window never reaching back past an earlier pound figure of any size) is taken ONLY from a page with no rise/fall "... to £" sentence at all: a page that announces a change but yields no readable new level gives None, never the outgoing cap. Example: "the price cap will rise by £60 per year (or £5 per month) to £1,723" read in the October 2026 quarter gives £1,723 a year, shown as £144 a month.
- Bounds £600 to £4,000; exactly one distinct qualifying figure, else None. A hardcoded figure is never shown.
- Stored as `findings.typical_regulated {figure_annual, period_start, source_host, source_name, source_url, read_on}` only on success (`period_start` is the ISO first day of the cap period; the source URL is scheme, host and path only). At compose time the value is re-validated (own regulator host and URL, name, dates, bounds) and must still be for the CURRENT period, so the line disappears when the quarter rolls over until the key is refetched.
- The card line is exactly `Typical: £144 a month (Ofgem price cap £1,723 a year from 1 October 2026, read 2 Nov 2026).`, the monthly figure being the annual figure divided by 12, rounded half up to the pound. `tip_facts.card_violations` polices the shape (`typical_not_allowed`). A category with no regulator, or any regulated product, gets no line.

**Ofcom (mobile, broadband) removed:** ofcom.org.uk returns 403 to generic clients and its figures live in PDFs, and the guessed URL was never verified. The table is extensible; whether to add a source for mobile and broadband is Kevin's choice.
