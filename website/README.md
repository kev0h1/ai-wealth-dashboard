# Sorted marketing site, design round

This independent static package is a first homepage design round, not the final public site. `npm run build` generates A, B and C in both light and dark themes under `dist/`; `scripts/preview-export.mjs` copies that result to the app-owned preview directory when the root agent runs it.

Directions: A is product-first, B is an editorial everyday-money story, and C is a typographic question-led perspective. The visual dials are variance 5, motion 2 and density 4. It uses self-hosted Figtree and JetBrains Mono from `public/assets` and intentionally has no runtime dependencies, API calls, tracking, forms, external JavaScript, external fonts, or environment variables.

`src/product-facts.json` is root-owned and read-only. `scripts/check-sources.py` is the source-drift gate. Store links are currently unknown, so this preview uses neutral availability text and the functional web Sign in link. Assets are root-owned; their provenance is recorded in `asset-provenance.json` and `editorial-morning.prompt.txt` without serving those internal records publicly. See `DESIGN-ROUND.md` for the direction contracts, dials and post-choice lifecycle.

No final canonical URL, sitemap, indexing configuration or Vercel project is included until a direction and domain are chosen. Preview pages deliberately use `noindex,nofollow`.
