# MCP connector evidence pack for Finexer (F27, Finexer Q5)

Prepared 2026-11-26. This pack shows the journey a Sorted customer follows to connect an AI assistant, in order, and says which frames are captured here and which still need Kevin's phone captures. Companion documents:

- Proposed Privacy Policy and Terms wording (F25): [finexer-mcp-policy-wording-2026-11.md](../finexer-mcp-policy-wording-2026-11.md)
- Security retest report (F26): [report-for-finexer.md](../../security/pentest-runs/F26-2026-11-26/report-for-finexer.md)

## Important: what these frames are

- The connector is not live in production. Production hides the connector sections while the flag is off.
- Frames 1 to 4 are the real production components (`OAuthConsentCard`, `ConnectedAssistantsCard`, `McpActivityPage`) rendered from a throwaway fixture page with fictional data (assistants Claude and ChatGPT, fictional dates and tool calls). No user was signed in, no token was minted, no real API was called, and no real data is shown. Real screens will list the real tool names and dates.
- Frames 5 and 6 are the real Privacy and Terms pages rendered from this branch's build with the connector flag on. They are builds of the branch, not production renders.
- All frames: 390 px wide phone viewport, 2x pixel density, headless Chrome. The fixture page and capture script are kept in `capture/` as `.txt` files so the method can be repeated (the fixture was deleted from the code base after capture).

## The journey, in order

| # | Step | Frame | Status |
|---|------|-------|--------|
| A | Customer adds Sorted as a connector in Claude or ChatGPT (pastes the Sorted connector address) | none | Kevin must capture |
| B | The assistant opens Sorted's consent screen. Sorted shows the verified redirect host and assistant name, a per-scope list the customer can untick, the provider warning, and Allow selected data / Deny | [frames/01-consent-card.png](frames/01-consent-card.png) (fixture render) | Captured as fixture; real capture also needed |
| C | The assistant is connected and answers a question using Sorted data | none | Kevin must capture |
| D | Settings, Connected assistants: each assistant listed with what it can read, last used, connected date, and Disconnect | [frames/02-settings-connected-assistants.png](frames/02-settings-connected-assistants.png) (fixture render) | Captured as fixture; real capture also needed |
| E | Disconnect confirmation: "It will lose access straight away" | [frames/03-settings-disconnect-confirm.png](frames/03-settings-disconnect-confirm.png) (fixture render) | Captured as fixture |
| F | Activity log (View full log): every request, which assistant, when, read-only; kept 90 days | [frames/04-activity-log.png](frames/04-activity-log.png) (fixture render) | Captured as fixture; real capture also needed |
| G | Privacy Policy, section 6 "AI assistants you connect" | [frames/05-privacy-ai-assistants.png](frames/05-privacy-ai-assistants.png) | Captured (branch build, flag on) |
| H | Terms, "Connecting an AI assistant" | [frames/06-terms-connecting-an-ai-assistant.png](frames/06-terms-connecting-an-ai-assistant.png) | Captured (branch build, flag on) |

What the frames show: frame 1 lists the three scope groups (account information and balances; upcoming bills, plans and tax figures; spending analysis by category and merchant), all ticked by default, each with a plain disclosure that raw transaction rows are not included. Frames 5 and 6 match the wording in the F25 file above.

## Frames Kevin must capture on his phone (real sessions)

Use a real device, a test account Kevin is happy to show, with the connector flag on (UAT). Crop out anything personal (email, real balances) or capture on a test user. Name files as below and drop them in `frames/real/`.

1. `A-add-in-claude.png` and `A-add-in-chatgpt.png`: the assistant's "add custom connector" screen with the Sorted connector address entered, before connecting. One for each of Claude and ChatGPT.
2. `B-consent-real.png`: the real consent screen reached from the assistant, authenticated, showing the real per-scope list, the redirect host (`claude.ai` or `chatgpt.com`) and the assistant name taken from Sorted's allowlist. Scroll if needed so the full list, the "Before you share" paragraph and both buttons are shown (two screenshots if it does not fit). If possible, one more with one box unticked.
3. `C-connected-answering-claude.png` and `C-connected-answering-chatgpt.png`: each assistant, after connecting, answering a simple question that uses Sorted data (for example "what is my left to spend"), with the connector name visible. Redact figures if wished.
4. `D-settings-connected-assistants.png`: Settings, Connected assistants, with at least one connected assistant, its read summary, last used and connected dates, and the Disconnect button visible.
5. `E-disconnect-confirm.png` and `E-disconnected.png`: the Disconnect confirmation, then the list after disconnecting showing the "disconnected" line (it appears for only about 5 seconds, so capture it straight away).
6. `F-activity-log.png`: the Activity log opened from "View full log" with real rows from step 3, showing assistant name, tool, date and time, and the 90 day note.
7. Optional: `G-denied-or-unlisted.png`: an assistant that is not on the allowlist being refused, if Kevin wants to evidence that unknown assistants cannot connect.

## Copy and design notes

Copy follows the project rules (British English, no em dashes). The consent card is the approved F23 variant A as built in F28.
