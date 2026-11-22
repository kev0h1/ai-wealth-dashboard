# G491: Home header controls

Temporary design round. This directory owns the fixtures, both proposed headers and their Home context. It does not import G490's card previews or change G484's icon catalogue, production components, preferences, API calls or calculations. All financial examples are fictional. The greeting uses Alex Morgan, never a real user's identity.

## Direction contract

**Thesis:** make the two Home shortcuts recognisable, equally weighted navigation, with the greeting leading. Mode: Operate. This is a narrow extension of the Calm Cockpit, with no new visual world or concept seed.

**Own-world:** inherit Figtree, JetBrains Mono currency, slate surfaces, 12px controls and restrained indigo focus. Both controls use neutral high-contrast ink. Additional Phosphor regular geometry is local to this round, alongside the existing MIT notice.

**Story:** recognise your greeting, see Settings and Accounts as two clear destinations, then read the unchanged example of what is left to spend. The same Home context appears under both options.

**First viewport:** A has a deliberately two-line mobile greeting and two compact labelled shortcuts at the right. B gives the greeting full width, with two matching labelled navigation controls below. Desktop has the existing side-navigation footprint and a two-column Home context. Neither option shrinks the greeting or its controls at narrow widths.

**Form:** two code-led header variants, as requested by G491. Shared local fixture state covers loaded, loading, hidden balances, a long name and a settled nameless profile. Motion is limited to immediate press feedback; real content is visible by default.

**Finish:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. This ordinary extension preserves DESIGN.md. No rasters ship with the preview.

## Review routes

`/design/home-header-controls?variant=a|b&state=ready|loading|hidden|long|unnamed&mode=light|dark`

The review controls stay outside the Home composition. `chrome=0` hides them for screenshots. Settings and Accounts are real navigation links to `/settings` and `/accounts`; balance visibility changes only local example state. Nothing reads or writes real preferences.

## Verification

- Independent finish review: **ship**, no material findings. Web Interface Guidelines checked alongside PRODUCT.md and DESIGN.md.
- Root and reviewer inspected 18 final full-page Chrome captures: both variants at 390px and 1440px in both themes, both long-name variants at 320px in both themes, loading names, hidden balances, and the review controls. This proves the temporary preview only.
- No horizontal overflow at any measured width. A has matching 56 × 64px targets. B has matching 175 × 48px targets at 390px, 140 × 48px at 320px and 148 × 48px on desktop.
- Each closed disclosure is 48px high with 14px above and 14px below the complete content block, one owned separator and no following gap. Bounded account identities measure 18.5/18.5px or 19/18px, including the owned 1px separator. Both themes and all three widths pass the 1px tolerance.
- Native keyboard links, skip focus, variant/theme deep links, disclosure keyboard operation and local balance visibility passed. Expanded disclosures and accessible labels reveal no hidden currency figure; negative masks retain `−`. No console errors or `/api/` requests were observed. Reduced motion resolves to the existing global 0.01ms rule in both themes.
- Impeccable detector: no findings. Design index and strict stale-preview checks pass. TypeScript passed; the delivery command reruns the complete required gates before pushing.
- Capture evidence is local and ignored under `.impeccable/review/`. The Puppeteer viewport override gives a real 320px/390px viewport. Chrome's command-line virtual-time flag exited the automated browser on this host, so captures use the equivalent 4,000ms DevTools virtual-time budget after hydration.

This ordinary extension inherits the existing design system. Keep DESIGN.md and its sidecar unchanged. Retire this preview and index entry when Kevin's chosen header is folded in, subject to the repository's H113 retention rules.
