# C41 App Store creative: system fit

## Handoff

This is an ordinary code-led extension of Kevin's approved C22 campaign, not
a new visual world or a product redesign. The specialist Impeccable
documenter was unavailable, so this note is the normal-agent independent
substitute. It records checked evidence and review boundaries. It does not
repair governing-file drift.

## Reused system rules

| Area | Evidence in C41 | System fit |
| --- | --- | --- |
| Palette and surfaces | `creative.module.css` and the exported canvases use Mist `#f0f2f7`, Midnight `#0f172a`, slate ink, muted slate and restrained hairlines; light and dark themes remain URL-selectable in the gallery. | Preserves C22's Mist/Midnight grounds and the product's calm, layered surface language. No new campaign palette is introduced. |
| Typography | The gallery and artboards use `var(--font-figtree)`/Figtree. Product currency remains supplied by the production proof components' Money Is Mono treatment with JetBrains Mono and tabular figures. | Preserves the Figtree-led hierarchy and the named Money Is Mono rule. Copy uses British English and keeps the currency minus/sign conventions. |
| Colour meaning | C41 does not add decorative gradients or glows. Penny's chart remains the production chart, while the campaign copy is typographic. | Keeps the indigo-to-violet treatment reserved for Penny and leaves category colour semantics to the existing chart. |
| Named rules | The composition leads with plain-language verdicts, keeps the proof secondary, and labels examples as fictional and dated. | Fits Answer First, evidence second; calm under bad news; and Earn trust like a bank, feel like a friend. |

## Production provenance and fixture boundary

`frontend/app/design/app-store-creative/CreativeProof.tsx` imports the
production `SafeToSpendCard` and `PennyChart` directly. The proof hosts pass
the approved local C22 fixtures from `marketing-kit/fixtures` and
`marketing-kit/capabilities/penny-fixtures`; they do not call the API, connect
an account, or move money. The two examples remain separate and explicitly
dated: Left to spend is £312 until 30 October 2026 after bills and a £110
buffer, while Penny compares £860 with £740 usual through day 10, including
Eating Out at £240 versus £120 usual. The hand-set Header B is typography only
and does not invent a product screen.

## Extension-specific scale

The Apple artboards are export compositions, not product UI breakpoints. The
pack uses Header `3840 × 1646` with a measured safe area of `1646 × 661`, and
Search Results `3840 × 2560` with a measured safe area of `2168 × 1030`.
Search Results also has the accepted half-size alternative `1920 × 1280`.
Those large type sizes and safe-area coordinates belong to Apple artwork; the
embedded proof hosts use 390px for the amount card and 480px for the chart,
while the product's normal responsive scale remains owned by its production
components and global tokens.

## Boundary and review status

- No production component, product token, `PRODUCT.md`, `DESIGN.md`, or design
  sidecar was changed for C41.
- The supplied independent review returned **ship**; all eight safe-area crops
  and 12 light/dark gallery captures at 320, 390 and 1440px were available.
  The independent reviewer inspected samples across themes and device widths.
- This design-system review does not certify repository finish checks. See
  C41's board notes for their recorded outcome.

The Impeccable launcher could not execute on this host (permission denied).
Project context was read directly; no automated Impeccable detector verdict is
claimed. The fresh independent review and Web Interface Guidelines audit cover
the completed artifact.

## Existing drift not canonised

`DESIGN.md` frontmatter still describes the typography as a system-ui stack,
while the verified live foundation uses self-hosted Figtree through
`--font-figtree` (and JetBrains Mono for currency). This pre-existing drift is
recorded only; it is intentionally not fixed in C41.
