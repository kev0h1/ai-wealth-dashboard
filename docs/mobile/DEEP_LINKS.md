# Native deep links (A68)

Every provider callback that hands control back to the native app uses one scheme, `wealthdash`, defined once in `shared/deep-links.json`. The backend mirrors it in `backend/app/core/deep_links.py` (`signin_return_url()`, `bank_return_url()`) and the frontend in `frontend/lib/deepLinks.ts`.

There are two paths: `auth-done` (sign-in) and `auth-complete` (bank connected). Both are frozen, because installed app binaries bundle older client code whose `appUrlOpen` regex matches `/auth-(done|complete)/`. New information goes in query parameters only: bank returns carry `provider`, `connection` and `status` (`ok` or `error`).

Google, Finexer and TrueLayer callbacks all render the shared hand-off template (`shared/signin-handoff/template.html`, via `signin_handoff_html` and `bank_handoff_html`) under a route-specific CSP. The return URL is emitted into the script as a JSON string literal through the `{{return_url_json}}` raw slot, which is validated and never HTML-escaped.

On the client, `components/DeepLinkHandler.tsx` registers one global `appUrlOpen` listener (and handles a cold-start launch URL). It closes the in-app browser and dispatches a `wd:deeplink` window event whose detail is `{ kind, provider?, connection?, status? }`. The sign-in loop keeps its own listener because it owns the login promise; closing the browser twice is harmless. The native shells register the scheme in `capacitor-spike/scripts/ensure-wealthdash-manifest.py` (Android) and `codemagic.yaml` (iOS), and `backend/tests/test_deep_links.py` guards both.
