# Instrument price sources (G270)

Evaluated 2026-10-14 for end-of-day prices of LSE-listed ETFs (by ticker) and OEIC fund NAVs (by ISIN). Nothing was signed up for and no paid call was made. Public documents were read with WebFetch only. "Verified" means the terms were read on 2026-10-14; "unverified" means the page could not be fetched (blocked, 403, 404 or empty), so the row rests on general knowledge and must be checked before any use.

## Options

| Source | Coverage | Identifier | Cost | Terms | Rate limits | Verdict |
|---|---|---|---|---|---|---|
| Stooq CSV (`stooq.com/q/d/l/?s=<sym>.uk&i=d`) | LSE ETFs by ticker, end of day. No OEIC NAVs. | Ticker | Free, no key | Unverified: the site and `/db/h/` returned no readable content. No published licence for programmatic reuse found. | Undocumented; informal throttling | Not adopted: no clear permission. Needs a ticker, which holdings from statements rarely carry. |
| Yahoo Finance chart endpoint | LSE ETFs by ticker; some OEICs by ISIN-derived symbol, patchy | Ticker | Free, no key (unofficial endpoint) | Verified (Yahoo API terms): no selling or deriving income from the APIs, no competing products, retained data must be removed within 24 hours, rate limits at Yahoo's sole discretion | Undocumented, discretionary | Rejected: the terms conflict with a commercial app that stores prices. |
| FT Markets fund pages (`markets.ft.com`) | Broad UK OEIC and ETF coverage by ISIN | ISIN | Free to read, no API | Unverified: ft.com blocked the fetch. Public pages are normally covered by terms that bar automated scraping and reuse. | n/a | Not adopted: scraping, and terms unread. |
| Morningstar UK | Broadest OEIC NAV coverage by ISIN | ISIN | Page free, data licence paid | Unverified: terms URL returned 403 | n/a | Not adopted. Paid data licence is Kevin's decision. |
| Investment Association | Industry statistics only | n/a | Members and data products | Verified: no daily fund price service described | n/a | Not a price source. |
| Provider NAV pages (Vanguard UK, others) | Their own funds, exact NAV, authoritative | ISIN | Free to view | Unverified: Vanguard terms page not located from the public site. Scraping is typically not permitted without agreement. | n/a | Not adopted. One adapter per provider is also high maintenance. |
| Alpha Vantage | Global equities and ETFs; LSE and fund NAV coverage not confirmed from public pages | Ticker | Free key, 25 requests a day; paid from USD 49.99 a month | Verified: tiers and limits only. Requires signing up for a key. | 25 a day free | Needs a key and sign-up, so not implemented. 25 a day is too low for a shared table of any size. |

## Recommendation

1. Ship now with the existing Tavily plus LLM path as the only source, marked confidence "low", behind the `PriceSource` interface (`app/services/investment_prices.py`). No free keyless source has terms that clearly allow this use, so no adapter was implemented.
2. The shared table already removes the main cost: one fetch per instrument per day instead of one per user per holding.
3. For a reliable feed, Kevin should decide on a licensed source. The shortlist to price and read the terms for: a market data vendor with UK fund NAV coverage by ISIN (Morningstar data licence, or a reseller such as FE fundinfo or Financial Times data licensing) and, for ETFs only, a keyed end-of-day API with a commercial plan. Any such adapter slots in at the top of `default_sources()` with confidence "high" and the web-search path stays as the fallback.
4. Holdings from statements carry an ISIN far more often than a ticker, so an ISIN-keyed source is the better fit.

## Behaviour notes

- Refresh: each instrument is attempted at most once per London day, shared across users. A failed attempt keeps the last price and its date and also stamps the attempt, so a failing instrument is not retried until the next day.
- `history` holds one point per price date, bounded to 400 entries, for G271.
- The collection holds no user data. Its `_id` is the ISIN, else `TICKER:<ticker>`, else `NAME:<normalised name>` for holdings carrying neither.

## Known limits

- The same fund can exist twice, once keyed by ISIN and once as a ticker-only (`TICKER:`) document, and the two are priced separately. No code links them.
- The `NAME:` fallback is a normalised name, so two different funds with near-identical names collide, and one fund spelled two ways splits. It is a last resort for holdings with neither ISIN nor ticker.
- A bare ticker does not say which exchange it is for, so the same ticker on two exchanges collides.
- The first uploader's fund name seeds the instrument document for everyone. It is sanitised before use in the search prompt, the ISIN or ticker is the primary search term, and a price more than 40 percent from the last known one is rejected.
