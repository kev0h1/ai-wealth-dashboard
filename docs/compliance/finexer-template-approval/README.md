# Finexer consent page templates: approval pack (A151)

Status: NOT synced to Finexer. Kevin approves the wording first, then the templates are synced, then Finexer's written approval is requested under Client Terms clause 7.6.

## What the templates are

Two Finexer consent-page templates on app `acc_DqPCRpHskkjNy7uYa1wv7mSv`, set through Finexer's Templates API (name, app_name, css, header_html; no logo file yet, no footer_html):

| Mode | Template name | Template id |
| --- | --- | --- |
| Light | Sorted light | aYiuDETVBXPq |
| Dark | Sorted dark | 8pq22L45Lf9L |

`app_name` is `AURIQ LTD` in both. Finexer substitutes it into its own headline ("AURIQ LTD is requesting permission to read:") and its regulated footer ("AURIQ LTD acts as Finexer Ltd's registered agent. Finexer Ltd is authorised ... 925695 ..."). AURIQ LTD is the registered agent on the FCA register, so the name Finexer shows is the legal entity. The Sorted identity appears only in our header block (and the logo slot once a logo file is supplied). We send no `footer_html`: Finexer's own footer is the only footer.

## Header block (header_html, identical in both templates)

```html
<div class="si-a"><b>Sorted</b><p>Sorted is asking for <strong>read-only</strong> access to your accounts, so it can show your money in one place.</p><p>Provided by Finexer Ltd, authorised by the FCA (firm reference 925695). AURIQ LTD, trading as Sorted, acts as its agent.</p></div>
```

Copy: line one names the app and states the access is read-only. Line two, in full ink at 12px, names Finexer Ltd as the provider, states its FCA authorisation and firm reference, and says AURIQ LTD, trading as Sorted, acts as its agent. Nothing says or implies that Sorted or AURIQ LTD is authorised itself.

## CSS (minified, as sent; limit 2000 characters)

Light, 1986 characters (`sorted-light.min.css`):

```css
:root{--s-primary:#4f46e5;--s-primary-hover:#4338ca;--s-link:#4f46e5;--s-link-hover:#4338ca;--s-canvas:#f0f2f7;--s-card:#ffffff;--s-border:#e2e8f0;--s-ink:#0f172a;--s-muted:#475569;color-scheme:light dark}@media (prefers-color-scheme:dark){:root{--s-primary:#4f46e5;--s-primary-hover:#4338ca;--s-link:#818cf8;--s-link-hover:#a5b4fc;--s-canvas:#0f172a;--s-card:#1e293b;--s-border:#334155;--s-ink:#f1f5f9;--s-muted:#cbd5e1}}html,body{background:var(--s-canvas);color:var(--s-ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}h1,h2,h3,h4{color:var(--s-ink);font-weight:700;line-height:1.3;letter-spacing:-0.01em}a{color:var(--s-link)}a:hover{color:var(--s-link-hover)}button,.btn,a.btn,input[type="submit"],input[type="button"]{border-radius:12px;font-family:inherit;font-weight:600;box-shadow:none}button:not([disabled]):not(.btn-secondary):not(.btn-light):not(.btn-outline),.btn-primary,input[type="submit"]{background:var(--s-primary);border-color:var(--s-primary);color:#ffffff}button:not([disabled]):not(.btn-secondary):not(.btn-light):not(.btn-outline):hover,.btn-primary:hover,input[type="submit"]:hover{background:var(--s-primary-hover);border-color:var(--s-primary-hover)}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--s-link);outline-offset:2px}input,select,textarea{border-radius:12px;background:var(--s-card);color:var(--s-ink);border:1px solid var(--s-border);font-family:inherit}label,.label,.eyebrow,th{color:var(--s-muted)}h1,h2,h3,h4,h5,h6,summary,dt,legend,strong,[class*="title"],[class*="heading"]{color:var(--s-ink)}footer,footer *,[class*="footer"]{color:var(--s-ink)}.si-a{margin:16px 16px 12px;padding:0 0 12px;border-bottom:1px solid var(--s-border)}.si-a b{display:block;margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--s-muted)}.si-a p{margin:0;font-size:14px;line-height:1.5;color:var(--s-ink)}.si-a p + p{margin-top:6px;font-size:12px}
```

Dark, 1763 characters (`sorted-dark.min.css`):

```css
:root{--s-primary:#4f46e5;--s-primary-hover:#4338ca;--s-link:#818cf8;--s-link-hover:#a5b4fc;--s-canvas:#0f172a;--s-card:#1e293b;--s-border:#334155;--s-ink:#f1f5f9;--s-muted:#cbd5e1;color-scheme:dark}html,body{background:var(--s-canvas);color:var(--s-ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}h1,h2,h3,h4{color:var(--s-ink);font-weight:700;line-height:1.3;letter-spacing:-0.01em}a{color:var(--s-link)}a:hover{color:var(--s-link-hover)}button,.btn,a.btn,input[type="submit"],input[type="button"]{border-radius:12px;font-family:inherit;font-weight:600;box-shadow:none}button:not([disabled]):not(.btn-secondary):not(.btn-light):not(.btn-outline),.btn-primary,input[type="submit"]{background:var(--s-primary);border-color:var(--s-primary);color:#ffffff}button:not([disabled]):not(.btn-secondary):not(.btn-light):not(.btn-outline):hover,.btn-primary:hover,input[type="submit"]:hover{background:var(--s-primary-hover);border-color:var(--s-primary-hover)}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--s-link);outline-offset:2px}input,select,textarea{border-radius:12px;background:var(--s-card);color:var(--s-ink);border:1px solid var(--s-border);font-family:inherit}label,.label,.eyebrow,th{color:var(--s-muted)}h1,h2,h3,h4,h5,h6,summary,dt,legend,strong,[class*="title"],[class*="heading"]{color:var(--s-ink)}footer,footer *,[class*="footer"]{color:var(--s-ink)}.si-a{margin:16px 16px 12px;padding:0 0 12px;border-bottom:1px solid var(--s-border)}.si-a b{display:block;margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--s-muted)}.si-a p{margin:0;font-size:14px;line-height:1.5;color:var(--s-ink)}.si-a p + p{margin-top:6px;font-size:12px}
```

The CSS changes colours, button and input radius, and our own header block only. It sets no font-size, opacity, display or visibility on the permission list or the footer, and no root font-size. The only rule touching the footer sets its colour to full ink: 15.9:1 (light, on #f0f2f7) and 16.3:1 (dark, on #0f172a), both above 7:1.

## What is unchanged

- The permission list (End User Statement): Your Accounts, Your Transactions, Your Account Balance, with Finexer's wording. Not hidden, resized or dimmed.
- The End User Terms and Privacy Policy links.
- Finexer's regulated footer, verbatim apart from Finexer substituting `AURIQ LTD` for the app name.
- Finexer's buttons and flow (we change colour and radius only).

## Screenshots

`light.png` and `dark.png` at 390px width. Caption: these are OUR MOCK of Finexer's hosted page, rebuilt from production screenshots, with our real header.html, CSS and app_name applied. They are not Finexer's page. The authoritative render is the dashboard preview of the saved templates (Finexer dashboard, template preview) once synced. The mock lives at `/design/finexer-consent-intro` and reads the same files as the sync script.

## Request for written approval (clause 7.6), for Kevin to paste

> Hello, we are AURIQ LTD, trading as Sorted, a registered agent of Finexer Ltd. Under clause 7.6 of the Client Terms we ask for your written approval of the co-branded consent page templates on our app acc_DqPCRpHskkjNy7uYa1wv7mSv (light aYiuDETVBXPq, dark 8pq22L45Lf9L). We set the template name to AURIQ LTD, so your headline and regulated footer name the registered agent, and we add a short header above your page that names Finexer Ltd as the provider, states your FCA authorisation and firm reference 925695, and says AURIQ LTD, trading as Sorted, acts as your agent. We have not changed, hidden, resized or dimmed the permission list, the End User Terms, the Privacy Policy links or your regulated footer, and the footer text is set in full ink for legibility. The header HTML, the exact minified CSS for both templates and mock screenshots at 390px are attached. Please confirm in writing that this presentation is approved, or tell us what to change before we make it live.
