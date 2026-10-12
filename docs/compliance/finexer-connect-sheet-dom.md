# Finexer "Connect" confirmation sheet: DOM evidence (A160)

Captured 2026-10-12 from Finexer's hosted consent page in headless Chrome, iPhone user agent, 390px viewport, with a synthetic customer and a Monzo consent that was never completed (no bank authentication). Finexer serves a different layout by user agent: a desktop UA gets a two-column page with the Connect text inline (`body#desktop-view`); a phone UA gets `body#mobile-view` and, after tapping NEXT (`#button-continue`), the bottom sheet below. Ids, tokens and the logo URL are removed.

## Sheet container and structure

```html
<div class="consent-connect-state" id="mobile-modal">      <!-- position: fixed, transparent -->
  <div class="form-control-inner">                         <!-- the white sheet (background #fff) -->
    <div class="consent-connect-metadata">
      <div class="consent-details">
        <div class="provider-item">
          <div class="bank-logo"><img class="_bank-logo" alt="" src="[bank logo]"></div>
          <span class="_bank-name consent-bank-name">Monzo</span>
        </div>
        <div class="provider-cancel"><a id="connect-state-cancel" href="javascript:;">Cancel</a></div>
      </div>
    </div>
    <div class="consent-term">                             <!-- regulated sentence and links -->
      <span>By clicking "<span class="consent-term-button">Connect</span>" you are permitting Finexer to access account information from your bank</span>
      <span>and share it with AURIQ LTD,</span>
      <span>on a recurring basis.</span>
      <span>You also agree to our <a href="/legal/end-user-terms">End User Terms</a> and <a href="/legal/privacy">Privacy Policy</a>.</span>
    </div>
    <div class="consent-control"><a id="button-mobile-modal" class="button-continue" href="javascript:void(0)">Connect</a></div>
  </div>
</div>
```

## Computed colours before the fix (Sorted dark template)

| Element | Selector | Text colour | Background | Contrast on the white sheet |
| --- | --- | --- | --- | --- |
| Sheet | `.form-control-inner` | n/a | `#ffffff` (Finexer) | n/a |
| Bank name | `.consent-bank-name` | `#f1f5f9` (inherited from our `body`) | white | about 1.1:1, unreadable |
| Terms sentence | `.consent-term` | `#788290` (Finexer) | white | about 3.9:1 |
| Terms links | `.consent-term a` | `#93a0b3` (Finexer) | white | about 2.6:1 |
| Cancel | `#connect-state-cancel` | `#818cf8` (our `a` rule) | white | about 3.0:1 |
| CONNECT | `.button-continue` | `#ffffff` | `#4265ed` (Finexer) | unchanged |

Light template: the sheet is white and our light ink and link already read well, so only the sentence and link greys were low (kept consistent by the same rules).

## Selectors used by the fix (colour and background only)

- `.form-control-inner` background `var(--s-card)` with `!important` (Finexer's own rule outranks a plain class), text `var(--s-ink)`.
- `.consent-term` colour `inherit !important`, so the sentence takes the sheet ink.
- `.consent-term a, #connect-state-cancel` colour `var(--s-link) !important`.
- The CONNECT button (`.button-continue`) keeps Finexer's blue and white text.

Nothing sets size, case, display, opacity, visibility or content on the regulated sentence or links (Client Terms 7.4).
