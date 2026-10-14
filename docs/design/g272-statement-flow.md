# G272 statement-flow graphic, second design round

Mode: Operate with a short Read explanation. Scope: the optional explainer below the investment-statement file picker, not a new upload journey or visual identity.

Kevin requested more options after rejecting the first graphics. Preserve the Calm Cockpit surfaces, Lucide family, indigo actions, existing providers, upload controls and sticky footer. Use repo-native HTML/CSS rather than a raster illustration: the small diagram needs selectable text, first-class dark mode and no image-loading cost.

## Options

- C, Paper to portfolio: a statement and contract note combine into a holding, beside the daily price check. Three short steps remain readable without interaction.
- D, The account view: a worked unit ledger makes the relationship concrete. Twelve units plus two bought gives fourteen units; daily prices change their value, not the unit count.
- E, One step at a time: labelled tabs reveal one stage, using keyboard arrows, Home and End. No autoplay or decorative looping motion.

Examples are fictional and labelled illustrative. A/B stay available as earlier references. Default preview is C. Each is shown in the real `InvestmentUpload` through the existing optional explainer prop; no option is enabled on the product page by this round.

## Product truth

Shared copy stays in `lib/investmentFlow.ts`, also used on the investment account card. The user supplies contract notes after trading. A new statement supersedes notes it already includes. Daily prices may be delayed. No live trading feed, profit forecast or investment recommendation is implied.

`backend/app/routers/investments.py` extracts provider, account type/reference, currency, value, statement date and holdings. `backend/app/services/pdf.py` removes its temporary file after text extraction. Existing shared privacy text is retained, including saved account details and the fact the file itself is not kept. Legal-document and LLM-attribution follow-ups are separate tickets, not silently changed here.

## Safety and verification

The preview injects a local uploader into the real sheet. Files are never sent, even when Import Statement is pressed. Production retains its default real API operation. Browser checks additionally abort unexpected API requests.

Acceptance: C/D/E distinguish statement, notes and price checks; import remains primary; both themes at 390px; no clipping at 320px or short viewports; sticky action visible; E keyboard tabs, file/password controls, local success/loading/error and close/reopen work. Run `frontend/app/design/statement-flow/check_preview.py` against a local production build.

Skills: Impeccable, manual workflow because its launcher was unavailable, followed by Web Design Guidelines and independent review. No global token or identity changes.

Evidence and review results are recorded in the preview README after verification. Real iOS keyboard and device gestures remain device-QA limitations, not proven by desktop emulation.
