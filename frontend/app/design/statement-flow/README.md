# G272 preview options

New options: `?variant=c`, `?variant=d`, `?variant=e`; add `&mode=dark`. Earlier `a` and `b` are reference-only. Close the sheet to change variant, theme or local import outcome. All imports are mocked and all data is fictional.

Design contract: `docs/design/g272-statement-flow.md`.

Local browser verification: `python3 frontend/app/design/statement-flow/check_preview.py --base-url http://127.0.0.1:3142` (system Playwright). Screenshots go to the gitignored `frontend/.impeccable/review/g272` directory. These show the preview only, not a production graphic enabled on the product page.

Verified 2026-10-14: production build, TypeScript, scoped ESLint, design index and strict stale check pass. Browser matrix passes C/D/E in light/dark at 390px, 320px, desktop and short viewport, producing 18 captures. Root inspected the phone/theme and narrow-layout captures in the bounded review. Tabs support arrows/Home/End, the privacy disclosure expands, local import loading/success/error, password visibility and close/reopen work. Unexpected API writes are blocked by the test.

Independent review accepted the design/financial/privacy boundaries after correcting C's accessible illustrative sentence to include the full result, 14 units. The first test run exposed history contamination when moving between still-open sheets; the matrix now closes each sheet before navigating. A separate fresh-page mock import confirmed Done closes correctly. These are preview-only fixtures, not evidence of enabled production graphics.

Physical-device keyboard/swipe/Back are not covered by headless Chrome. Existing shared upload-control styling was not redesigned. Impeccable's launcher was unavailable; manual context, browser checks and a fresh independent review were used instead. DESIGN.md remains unchanged because this round extends the incumbent identity, not its tokens.
