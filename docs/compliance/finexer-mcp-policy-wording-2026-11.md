# Proposed Privacy Policy and Terms wording for the AI assistant connector (F25, Finexer Q5)

Prepared 2026-11-26 for Finexer review before the connector is enabled. This is the wording as it stands in `PRIVACY.md` and `TERMS.md` (and the published copies in `frontend/content/`). The connector sections stay hidden in production while `MCP_CONNECTOR_ENABLED` and `NEXT_PUBLIC_MCP_CONNECTOR` are unset, so none of this is live. Legal version numbers and last-updated dates are unchanged; Kevin decides whether to bump them at launch.

Note on assistants: the allowlist (`backend/app/data/mcp_client_allowlist.json`) contains Claude and ChatGPT only. Perplexity is not named because it is not on the allowlist (it publishes no redirect URI); the wording says other assistants are refused and may be added after review, so adding Perplexity later needs no wording change beyond naming it.

## Privacy Policy, Section 6 (and the related notes in Sections 7 and 9)

## 6. AI assistants you connect

You can also connect your own AI assistant to read your Sorted data through a connector. This is separate from the in-app Penny assistant described in Section 5, and only happens on your instruction.

- **Which assistants can connect.** Only assistants that Sorted has reviewed can connect. At present these are Claude (from Anthropic) and ChatGPT (from OpenAI). Any other assistant is refused, even if you try to connect it. We add an assistant only after reviewing its published privacy and data terms, and we may add or remove assistants over time. Our review is of the assistant's published terms; it is not an audit of how its provider handles data, and neither Sorted nor Finexer has assessed that.
- **Where the data comes from.** The data is what Sorted already holds from the bank accounts you have connected through Finexer LTD, our regulated account information provider (see Section 7). The assistant never connects to your bank and never receives your bank sign-in details.
- **You choose what it can read.** When you connect an assistant, Sorted shows you its verified name and the address it will return to, and lists what it asks to read in up to three groups: balances and account names; bills, plans, goals and your tax position figures; and spending verdicts and insights. You can tick only some of them, and the assistant is given only the groups you tick. If you deny the request, nothing is shared.
- **What it cannot read.** It cannot read your individual transactions, account numbers, sort codes, IBANs, card numbers or bank consent identifiers. These are removed before anything leaves Sorted.
- **What it cannot do.** The connector is read-only. It cannot move money, change your settings or make any changes in Sorted.
- **Who receives the data.** Your chosen assistant provider, for example Anthropic or OpenAI, receives it, at your instruction, under your own agreement with them. They are not our sub-processor, and we do not control what they do with it once they have it. Their retention, training and international processing rules may differ from ours, may involve processing outside the UK, and are outside our control. Please check their own privacy terms before you connect.
- **Data already shared cannot be recalled.** Disconnecting stops any further access, but it cannot remove information the assistant has already received or that its provider has kept.
- **Assistants can make mistakes.** What an assistant tells you, including anything based on your Sorted data, may be wrong, and it is not advice from Sorted (see Section 6 of our Terms).
- **Activity log.** We keep a record of every connector request, including which tool was used, when, and by which assistant, and this is visible to you in Settings under Connected assistants. We keep this log for 90 days, after which each request record is deleted automatically; it does not affect your monthly usage count, which we keep separately for billing purposes.
- **How to stop.** You can disconnect an assistant at any time in Settings under Connected assistants, which ends its access straight away. We can also revoke a connection if we believe it is being misused, or if an assistant is removed from our reviewed list.

Our lawful basis for this processing is your explicit instruction, in the same way as the explicit consent basis described in Section 3: you choose to connect an assistant and which groups of information it may read, and you can withdraw that at any time by disconnecting it.

Section 7 addition (unchanged): "If you connect an AI assistant (see Section 6), your chosen assistant provider becomes a recipient of the data you allow it to read, at your own instruction and under your own agreement with them. This is different from the sub-processors listed above: it is not something we control, and that provider is not our sub-processor."

Section 9 table row (unchanged): "Connector audit log (Section 6) | 90 days".

## Terms, Section 5, "Connecting an AI assistant"

### Connecting an AI assistant

You may connect your own AI assistant to read your Sorted data through our connector. Only assistants that Sorted has reviewed can connect: at present Claude (from Anthropic) and ChatGPT (from OpenAI). Any other assistant is refused, and we may add or remove assistants over time. The assistant acts on your instructions, and you are responsible for the assistant you choose, for its provider's own terms, and for anything you do on the basis of what it tells you.

The data is what Sorted already holds from the bank accounts you have connected through Finexer LTD. When you connect an assistant you choose which groups of information it may read, and it is given only those. Neither Sorted nor Finexer has assessed how an assistant's provider handles data: its retention, training and international processing rules may differ from ours and are outside our control. Information an assistant has received cannot be recalled, although you can stop further access at any time in Settings under Connected assistants.

We provide the connector with only your own data and our own deterministic figures, on a read-only basis; it cannot move money, change your settings, or make any changes in Sorted. Connector use counts against your plan's monthly allowance and is available on the plans that include it. We may suspend a connection that breaches Section 8.

AI assistants can make mistakes. The disclaimer in Section 6 (information, not financial advice) applies equally to anything an AI assistant tells you based on your Sorted data, which is not advice from Sorted.

## Claims and the behaviour that backs them

| Claim | Where it is built |
|---|---|
| Only reviewed assistants (Claude, ChatGPT) can connect; others refused | `backend/app/data/mcp_client_allowlist.json`; checked in `backend/app/routers/oauth.py` (register, authorize, decision, token, refresh) and on every call in `backend/app/routers/mcp.py` |
| Each entry has a documented review | `review` record required per entry; `DEPLOY.md` "MCP client allowlist" |
| Verified name and address shown at consent | `backend/app/routers/oauth.py` `get_oauth_request_details`; `frontend/app/oauth/consent/OAuthConsentCard.tsx` |
| Choose groups of information, only those granted | `POST /oauth/decision` `granted_scopes`; `SCOPE_DESCRIPTIONS` in `oauth.py`; `_mcp_tool_list` in `mcp.py` |
| Read-only, no raw transactions | `V1_SCOPES`, `_EXCLUDED_TOOLS` in `mcp.py` |
| Provider not assessed, rules outside our control, cannot be recalled | consent card "Before you share" text in `OAuthConsentCard.tsx` |
| Activity log, 90 days | `_write_audit` in `mcp.py`; `MCP_AUDIT_TTL_DAYS` in `backend/app/core/config.py`; TTL index in `backend/app/main.py` |
| Disconnect in Settings ends access | `DELETE /oauth/connections/{client_id}` in `oauth.py`; Settings "Connected assistants" card |
