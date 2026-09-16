# Bank logo provenance and licence basis (G107)

This directory bundles brand marks for banks curated in `BANK_META`
(`components/AccountMiniCard.tsx`) so a linked account can show its bank's
own logo instead of an initials chip. Every file here is served locally
under `/banks/*` — the browser never fetches a third-party host to render
one (see the `bankLogoSrc()` comment in `AccountMiniCard.tsx` for why that
matters: A34/A27).

## Legal basis (applies to every logo below)

These are trademarked bank marks, not original artwork of ours. Displaying
one next to an account the user has themselves linked, purely to say "this
is your Barclays account", is nominative fair use: standard practice for
account-aggregator products (Plaid, TrueLayer, Yolt, Monzo's own linked-
accounts view all do the same). We do not claim ownership of any mark
here, do not use any mark to suggest endorsement by the bank, and only
ever pair a mark with the corresponding provider's own linked account
data.

Trademark and copyright are separate questions. A plain wordmark (e.g.
"HALIFAX" in a fixed typeface) is likely below the originality threshold
for copyright; a graphic device mark (the HSBC hexagon, the NatWest
knot, the Halifax "X") is typically not, and is used here on the
nominative-fair-use trademark basis above, not on any copyright licence.

## Files sourced via Logo.dev (9 files, added 2026-09-16)

Sourced through the backend's existing `/logo/{domain}` proxy
(`backend/app/routers/logos.py`), which already calls the Logo.dev API
using the `LOGODEV_TOKEN` configured in production — this is not a new
integration, it already runs live for merchant logos and is already
disclosed as a data processor in `PRIVACY.md` ("Logo.dev — Provides brand
logos; receives brand domain names only, never customer data"). For this
ticket the proxy was used once, offline, to fetch each bank's mark by its
own official domain; the result was downloaded, resized, and committed as
a static file. No live call to Logo.dev happens when a user opens the
app — the files below are what shipped.

Logo.dev's own terms (`logo.dev/legal/terms`, `logo.dev/docs/platform/fair-use`,
checked 2026-09-16) grant no licence over the underlying third-party marks
— they say plainly that Logo.dev merely provides access to third-party IP
and the customer is solely responsible for how it's used — and prohibit
*bulk scraping for redistribution* or *building a logo directory as the
primary product*. Nine bank logos, each paired with the user's own linked
account inside a finance app that does far more than show logos, is the
compliant case Logo.dev's own guidance describes ("use Logo.dev to
enhance an existing product that provides value beyond just logos"), not
the prohibited one. The operative legal basis is still the nominative
fair use above, not any licence from Logo.dev — Logo.dev was the sourcing
route, not the rights grant.

| File | Bank | Source domain | Fetched |
|---|---|---|---|
| `hsbc.png` | HSBC | hsbc.co.uk | 2026-09-16 |
| `monzo.png` | Monzo | monzo.com | 2026-09-16 |
| `revolut.png` | Revolut | revolut.com | 2026-09-16 |
| `santander.png` | Santander | santander.co.uk | 2026-09-16 |
| `halifax.png` | Halifax | halifax.co.uk | 2026-09-16 |
| `nationwide.png` | Nationwide | nationwide.co.uk | 2026-09-16 |
| `chase.png` | Chase (UK) | chase.co.uk | 2026-09-16 |
| `first_direct.png` | first direct | firstdirect.com | 2026-09-16 |
| `tsb.png` | TSB | tsb.co.uk | 2026-09-16 |

Each was verified before shipping: real PNG content type (not an HTML
redirect page — the Halifax failure mode A34 hit), 256×256 source
dimensions, and a visual check against the bank's known current mark
(done via direct image review, not assumed from the filename).
Downscaled to 120px max dimension and palette-quantised for the icon
chip's actual display size (36px, up to ~108px at 3x); see byte sizes
below.

## Files with no recorded prior provenance (5 files, predate G107)

`amex.png`, `barclays.png`, `lloyds.png`, `natwest.png`, `starling.png`
were already in this directory before this ticket. Git history for this
directory records only "add NatWest bank logo" style commit messages —
no source URL or licence note was ever captured for any of the five. As
part of G107 each was opened and visually verified against the bank's
current official mark (all five are correct, current marks — no stale or
wrong logos found). `natwest.png` and `lloyds.png` were re-encoded at
G107 (same visual content, downscaled from an oversized 3840×2160 and
460×460 source respectively and palette-quantised) purely to fix their
page-weight cost; `amex.png`, `barclays.png`, `starling.png` were left
untouched because re-encoding them made the file larger, not smaller
(they were already efficiently palette/RGBA-encoded at their original
size). Basis for continuing to ship them is the same nominative-fair-use
rule above. If their original source is ever identified, add it here.

## Deliberately not bundled

Every other `BANK_META` entry without a `logoFile` (Kenyan statement-import
banks, M-Pesa, Mono, Offline, and any UK provider not listed above) stays
on the initials chip. That chip is the honest fallback, not a failure
state — see `BankBadge` in `AccountMiniCard.tsx`. Nothing was shipped
without being able to record where it came from and on what basis; where
that wasn't possible, the initials chip stands.

## Byte cost (G107, 2026-09-16)

Old total (5 files): 163,307 bytes.
New total (14 files): 39,822 bytes.
Net change: **-123,485 bytes** (page weight went down even after adding 9
new logos, because `natwest.png`/`lloyds.png` were badly oversized
before this change).

| File | Bytes |
|---|---|
| amex.png | 3,673 |
| barclays.png | 6,581 |
| chase.png | 1,026 |
| first_direct.png | 4,034 |
| halifax.png | 2,512 |
| hsbc.png | 2,204 |
| lloyds.png | 4,042 |
| monzo.png | 1,563 |
| nationwide.png | 1,293 |
| natwest.png | 1,882 |
| revolut.png | 1,294 |
| santander.png | 3,555 |
| starling.png | 3,408 |
| tsb.png | 2,755 |
