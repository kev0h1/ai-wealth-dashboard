# G254 diagnosis: Kevin's DigitalOcean thread (2026-10-10, UAT)

Evidence is read-only and scoped to Kevin's own conversation, `wealth-api` journal and `llm_usage` rows. Times below are UTC (the journal is BST, one hour ahead).

## The two failing turns

| Turn (journal, BST) | Question | `llm_usage` rows |
|---|---|---|
| 15:53:50 | "yeah thats the one do they have fx rates on all these transactions" | 1 round, `tools_called: []`, 79 completion tokens, 2541 ms, Haiku 4.5 |
| 15:54:22 | "DIGITALOCEAN.COM is there an fx rate on these transactions" | 1 round, `tools_called: []`, 62 completion tokens, 2678 ms, Haiku 4.5 |

Journal line for both: `penny_agent: unparseable/empty final answer for <user> after 1 rounds, ~2.6s`. Both stored replies are the canned refusal ("I answer from your live numbers ...").

What that tells us:

- **Not empty and not out of tokens.** 79 and 62 completion tokens against `_MAX_TOKENS = 500`, and an empty message would not have spent that many.
- **No tool was called in round 1.** With no tool grounding, `_parse_headline_reply_or_none` takes its strict path and rejects any answer without `HEADLINE:` and `REPLY:` lines. The model returned a short unlabelled prose answer (the size fits a one or two sentence clarification or a plain statement). It was not the `OUT_OF_SCOPE` sentinel, which logs a different line ("declined off-topic").
- **Not a markdown table.** A table is several hundred tokens (the 15:55 tabulate turn was 320 completion tokens).
- **"these" was inside the 6-turn window.** The previous answer (the 15:53:18 turn naming DIGITALOCEAN.COM on 1 June) was the immediately preceding message. The window is not the cause for these two turns, but it is fragile: each history entry is cut to 300 characters, and no transaction ids survive in text, so a longer thread loses the referent.
- **The raw model text is not persisted** (B38 stores tool names and token counts only, never content), so the exact words cannot be quoted. The shape above is inferred from the token counts, the missing tool call and the parser's path.
- **The refusal copy was the second bug.** `can_i.py` treated every `None` from the loop (unparseable, round cap, timeout, exception) as out of scope and printed the canned refusal.

## The earlier turns in the same thread (same session, wrong answers)

- "what about the receipts of digital ocean" -> `search_transactions`, no rows; "DigitalOcean LLC is the company" -> no rows; "$14.40 for the first of june" -> no rows. Each ran 1 search round.
- Cause: `_search_query` matched the typed text as a case-insensitive substring of description / merchant name / merchant key. The stored text is `DIGITALOCEAN.COM ...`, so "Digital Ocean" (a space) and "DigitalOcean LLC" (a suffix) are not substrings. A `$14.40` text matched nothing because the figure lives in the description as `AMOUNT IN USD 14.40` and `q` is a name match.

## Shape of the stored rows (no amounts quoted)

Synced rows carry `amount`, `currency` (the account's, GBP), `description`, `merchant_key`, `merchant_name` (often null) and no `fx_rate`, `fee` or `original_amount` field. The foreign-currency detail, when the bank supplies it, is written into the description text: `<MERCHANT> AMOUNT IN <CCY> <n.nn> ON <dd MON> VISA <rate> ... TRANS FEE £<n.nn>`. So "is there an fx rate" has a real answer for some rows (read it from the description) and an honest "the data does not include a rate" for rows without it. G254 now reports a rate or fee only where the row states one.
