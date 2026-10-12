# Finexer template update returns HTTP 500 (2026-10-12)

## Incident note

- Date: 2026-10-12. Item: A160 (Connect sheet styling in the Sorted templates).
- Attempted: four `POST /apps/{app_id}/templates/aYiuDETVBXPq` updates (Sorted light) between 16:40Z and about 17:00Z, form-encoded `name`, `app_name`, `css`, `header_html`. CSS sizes sent: 1846 characters (the new build), 1663 (the new build without the sheet rules) and 1862 (the template's own live CSS sent back unchanged, so a byte-identical no-op).
- Result: every attempt returned HTTP 500, `server_error` / `internal_error`, with the generic "try again later or contact us" body. The no-op failing rules out our CSS as the cause.
- The dark template (8pq22L45Lf9L) was not attempted.
- `GET /apps/{app_id}/templates` (list) and `GET .../templates/{id}` (show) work normally.
- Each failed POST still moved the template's `updated_at` forward, so the handler appears to fail after touching the record. The live content (CSS, header) was unchanged afterwards.
- The live consent page is unaffected: it still renders the previous template.
- Fix prepared and waiting on branch `feature-A160-connect-sheet-dark` (quoted attribute selectors restored, dead hover rule dropped, light 1846 and dark 1892 characters). Resume once Finexer confirms updates work: sync both templates, verify on the real page, replace the approval-pack screenshots, finish.

## Support email for Kevin to send

Subject: Template update endpoint returning HTTP 500 (app acc_DqPCRpHskkjNy7uYa1wv7mSv)

Hello,

We are AURIQ LTD, trading as Sorted, a registered agent of Finexer Ltd. Since about 16:40 UTC on 12 October 2026, every update to one of our consent page templates fails with an HTTP 500.

- App: acc_DqPCRpHskkjNy7uYa1wv7mSv
- Template: aYiuDETVBXPq ("Sorted light")
- Request: POST /apps/acc_DqPCRpHskkjNy7uYa1wv7mSv/templates/aYiuDETVBXPq, form-encoded fields name, app_name, css and header_html
- Attempts: four, between 16:40 UTC and about 17:00 UTC on 12 October 2026. The CSS lengths were 1846, 1663 and 1862 characters. The last of these was the template's own current CSS sent back unchanged, so the failure does not depend on our content.
- Response each time: HTTP 500, error type server_error, code internal_error, with the message asking us to try again later or contact you. Exact body:

```json
{"error":{"type":"server_error","code":"internal_error","message":"The server encountered an internal error and was unable to complete your request. Please try again later or contact us at https://finexer.com/contact."}}
```

- Reads work: GET on the template list and on the single template both return 200.
- Each failed update still changed the template's updated_at timestamp, although the css and header were not changed, so the handler seems to fail after touching the record.
- Our live consent page is unaffected. We have not attempted updates to our dark template (8pq22L45Lf9L) to avoid further changes.

Could you tell us whether the template update endpoint has changed or whether there is a new validation step we should be meeting, and whether anything on your side is currently failing for our app? Please also confirm when it is safe for us to retry. We are waiting on this to improve the readability of the Connect confirmation sheet on dark mode, and we will keep any retries to a minimum until we hear from you.

Kind regards,
Kevin Maingi
AURIQ LTD, trading as Sorted
