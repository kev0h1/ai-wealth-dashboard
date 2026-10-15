# G272 investment statement graphic, approved C

Mode: Operate with a short Read explanation. Scope: the explainer below the investment-statement file picker, not a new upload journey or visual identity. Kevin chose C, Paper to portfolio, on 15 October 2026.

Kevin requested more options after rejecting the first graphics. Preserve the Calm Cockpit surfaces, Lucide family, indigo actions, existing providers, upload controls and sticky footer. Use repo-native HTML/CSS rather than a raster illustration: the small diagram needs selectable text, first-class dark mode and no image-loading cost.

## Approved production contract

- `InvestmentUpload` renders `InvestmentFlow` by default below the file picker, through the unchanged `SheetFrame`. The Accounts page needs no preview prop or query parameter to enable it.
- The exact approved C layout is moved into `components/InvestmentFlow.tsx` and its scoped CSS: two paper documents, one holding of 14 units and the daily price-check icon, followed by the three readable steps.
- The graphic is decorative to assistive technology. The adjacent sentence contains the complete, explicitly illustrative calculation: 12 units + 2 bought = 14 units. The ordered steps retain list semantics in Safari.
- Keep the new-statement disclosure and the shared privacy line beneath it. Keep the existing providers, password and file controls, import action, loading/error/success handling and dismissal behaviour.
- Both themes and the approved narrow-screen adjustment are retained. No autoplay, external image request, global token change, new status colour or Penny gradient. The unit-count typography is copied from the approved illustration, not a new app-wide number style.

The other options and temporary preview are removed at fold-in under H113. Their history remains in design-round commit `05ce610e`. No production code, marketing output, compliance pack or other open item imports the preview.

## Product truth

Shared copy stays in `lib/investmentFlow.ts`, also used on the investment account card. The user supplies contract notes after trading. A new statement supersedes notes it already includes. Daily prices may be delayed. No live trading feed, profit forecast or investment recommendation is implied.

`backend/app/routers/investments.py` extracts provider, account type/reference, currency, value, statement date and holdings. `backend/app/services/pdf.py` removes its temporary file after text extraction. Existing shared privacy text is retained, including saved account details and the fact the file itself is not kept. Legal-document and LLM-attribution follow-ups are separate tickets, not silently changed here.

## Safety and verification

Local browser verification uses the actual production-default `InvestmentUpload`, with only its uploader replaced by an inert fixture. It also compares that render with the approved C markup before the temporary route is removed. The default production operation remains `api.uploadInvestmentStatement`. All unexpected API requests are aborted during browser verification, so no selected test PDF is sent.

Acceptance: exact C parity; import remains primary; both themes at 320px, 390px, short phone and desktop viewports; no clipping or horizontal overflow; sticky action visible; keyboard disclosure, file/password controls, local success/loading/error and close/reopen work. `npm run check:g272-investment-flow` pins the production default, canonical copy, accessible calculation and list, plus theme and focus rules without depending on a preview directory.

Skills: Impeccable, manual workflow because its launcher was unavailable, followed by Web Design Guidelines and independent review. No global token or identity changes.

Local verification evidence is stored in the ignored `frontend/.impeccable/review/g272-fold/` directory and summarised on the board after checks complete. Real iOS keyboard and device gestures remain device-QA limitations, not proven by desktop emulation.
