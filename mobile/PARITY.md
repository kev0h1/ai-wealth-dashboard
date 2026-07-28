# Tailwind → React Native Parity Reference

## Purpose

`lib/tw.ts` is the mandatory translation map for all numeric style literals in this app.
Screen code MUST import type sizes, spacing, radii, and colours from `tw` — no raw numeric
literals for those values in StyleSheet calls. Every `<Text>` component MUST have an explicit
`lineHeight` set; use `...tw.text.*` which provides both `fontSize` and `lineHeight` together.

## RN-vs-web gotchas

- **No default line-height in RN** — always pair fontSize with lineHeight. `tw.text.*` gives both as a spread: `...tw.text.sm`.
- **letterSpacing is in POINTS not em** — use `tw.tracking(tw.trackingEm.wide, fontSize)`. Never copy em values directly.
- **fontWeight is a STRING** — `"600"` not `600`. Use `tw.weight.semibold` etc.
- **flexDirection defaults to `column`** in RN (vs block/row-ish on web) — set it explicitly whenever you need a row.
- **`gap` IS supported in RN 0.71+** (this app is on a newer RN) — use it freely, but for web `mb-*`/`mt-*` sequences prefer explicit margins so vertical rhythm matches exactly. A single container `gap` collapses distinct web margins and can inflate layout.
- **`%` heights are unreliable** — avoid; size cards by content + padding, not fixed heights, unless the web source sets a fixed `h-*`.
- **Shadows**: web `shadow-sm` → RN iOS `shadow*` props + Android `elevation`; one shadow per surface (One-Shadow rule); dark mode sets `shadowOpacity: 0`.
- **`bg-gradient-*`** → `expo-linear-gradient` `<LinearGradient>`.
- **`<Image>` needs explicit width/height** — no intrinsic sizing in RN.
- **No hover** — use `Pressable ({ pressed }) =>` press states instead.
- **1px borders** → `HAIRLINE` (`StyleSheet.hairlineWidth`), imported from `@/lib/tw`.

## Primitive mapping

| Web | Native |
|-----|--------|
| `div` | `View` |
| `button` / `a[role=button]` | `Pressable` |
| `img` | `Image` (explicit width + height required) |
| `p` / `span` / `h1` (text) | `Text` |
| `lucide-react` icon | `lucide-react-native` (same icon name; `color` + `size` props) |
| `next/link` or `router.push` | `expo-router` `router.navigate` / `useRouter().push` |
| `bg-gradient-*` | `<LinearGradient>` from `expo-linear-gradient` |
| `className` utilities | `tw.*` + `StyleSheet` |
| `:hover` | `Pressable` `pressed` state |
| `overflow-hidden` | `overflow: "hidden"` (needed to clip gradient corners) |

## When porting a new screen

- Open the web component and identify every `className` string.
- Transcribe each class via `tw.ts`: spacing → `tw.space[N]`, type → `...tw.text.*`, radius → `tw.radius.*`, colour → `tw.color.*`.
- Set `lineHeight` on every `<Text>` — use the spread `...tw.text.*` which includes it.
- Replace all web margin sequences literally (do NOT collapse multiple `mb-*`/`mt-*` into a single `gap`).
- Verify with `npx tsc --noEmit` (must be clean) and `npx expo export --platform android` (must complete without errors).

## Session gotchas

- **CSS grid vs RN flex-wrap cell heights**: CSS `grid-cols-2` stretches every cell in a row to equal height; RN `flex-wrap` does NOT — wrapped cells keep their own content height. To match, give sibling cards the same `minHeight` (e.g. a shared `CARD_MIN`) and pad shorter cards deliberately. Also: RN `gap` between wrapped cells is reserved space, so a plain `width: "50%"` overflows — compute cell width from window width minus page gutters minus the gap, divided by columns (`cellW = (winW - gutterL - gutterR - gap) / 2`) for an exact 2-up grid that never overflows.

- **LinearGradient must BE the painted surface itself**: Any `backgroundColor` set on the `<LinearGradient>` element, or an opaque `View` overlaying it, hides the gradient and the card renders flat. Equally important: resolve gradient colours in the SAME priority order as web (curated brand map first, dynamic `bg_colors` second) — a flat-looking card is often correct code painting a flatter colour source, not a broken gradient. Add `overflow: "hidden"` so the gradient clips to rounded corners on Android. Device screenshots are the acceptance test — never close a gradient bug from code-reading alone.
