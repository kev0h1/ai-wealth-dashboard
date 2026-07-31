---
name: Wealth Dashboard
description: The money app that tells you what to do next — calm-cockpit UI over live bank data.
colors:
  primary: "#4f46e5"
  primary-deep: "#7c3aed"
  canvas: "#f0f2f7"
  canvas-dark: "#0f172a"
  surface: "#ffffff"
  surface-dark: "#1e293b"
  border: "#f1f5f9"
  border-dark: "#334155"
  ink: "#0f172a"
  ink-dark: "#f1f5f9"
  muted: "#94a3b8"
  muted-deep: "#64748b"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"
  cat-groceries: "#34d399"
  cat-eating-out: "#fb923c"
  cat-transport: "#60a5fa"
  cat-entertainment: "#c084fc"
  cat-shopping: "#f472b6"
  cat-bills: "#fb7185"
  cat-subscriptions: "#22d3ee"
  cat-health: "#2dd4bf"
  cat-beauty: "#e879f9"
  cat-travel: "#818cf8"
  cat-software: "#a3e635"
  cat-savings: "#fbbf24"
  cat-debt: "#f87171"
  cat-transfer: "#cbd5e1"
  cat-income: "#4ade80"
  cat-cash: "#facc15"
  cat-charity: "#f9a8d4"
  cat-other: "#94a3b8"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.05em"
rounded:
  chip: "8px"
  control: "12px"
  card: "16px"
  hero: "24px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    typography: "{typography.title}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
  chip-category:
    rounded: "{rounded.chip}"
    size: "32px"
  badge-pill:
    backgroundColor: "{colors.border}"
    textColor: "{colors.muted-deep}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
    typography: "{typography.label}"
---

# Design System: Wealth Dashboard

## 1. Overview

**Creative North Star: "The Calm Cockpit"**

Everything important at a glance, nothing screaming. The interface reads like an instrument panel wrapped in soft, friendly surfaces: a muted slate canvas, white (or dark-slate) cards with generous 16px radii, and one steady indigo voice for the brand. Verdicts lead — big bold figures, tiny uppercase labels — and colour is information, never decoration: every spending category owns a hue from one tonal family, status colours mean exactly one thing each, and the indigo→violet gradient is reserved for Penny, the AI adviser, so its glow always means "advice lives here".

This system explicitly rejects legacy bank portals (dense grey tables, enterprise chrome), crypto-bro dashboards (neon-on-black, hype gradients), and the generic default-shadcn AI-template look. It is closer to a UK neobank — Monzo/Emma polish — but calmer, because the product's job is reassurance under stress.

**Key Characteristics:**
- Soft, tactile, confident surfaces: 16-24px radii, chunky touch targets, `active:scale-95` press feedback
- Numbers lead, labels whisper: bold 20-30px figures over 10-11px uppercase tracking-wide muted labels
- One brand voice (indigo #4f46e5), a semantic category palette, and status colours used sparingly
- Dark mode is a first-class twin, built on slate-800/900 surfaces with border-based separation
- Mobile-first (430px shell) with a deliberate desktop layout, never a stretched phone screen

## 2. Colors

A muted slate stage where one indigo voice and a single-saturation category palette carry all the meaning.

### Primary
- **Adviser Indigo** (#4f46e5): The brand. Primary buttons, active nav states, links, selected states, the actual-spend line in charts. Deepens into **Penny Violet** (#7c3aed) only as the 135° gradient on AI surfaces (chat FAB, chat headers) — the gradient is Penny's signature and appears nowhere else.

### Neutral
- **Mist Canvas** (#f0f2f7) / **Midnight Canvas** (#0f172a): The page background in light/dark. Cards float on it; it is never pure white or pure black.
- **Card White** (#ffffff) / **Slate Card** (#1e293b): Every card and sheet surface.
- **Hairline** (#f1f5f9) / **Dark Hairline** (#334155): Borders and dividers; in dark mode borders do the separating work that shadows do in light.
- **Ink** (#0f172a) / **Paper Ink** (#f1f5f9): Primary text.
- **Whisper** (#94a3b8) and **Slate Voice** (#64748b): Secondary text, labels, icons at rest.

### Tertiary
- **Verified Emerald** (#10b981): Positive money — income, under-budget, verified savings, "connected".
- **Watch Amber** (#f59e0b): Pace warnings, target lines, "due tomorrow" — attention without alarm.
- **Risk Red** (#ef4444): Genuine liability only — debt, over-budget, at-risk bills, destructive actions.
- **Category Palette** (18 hues, Tailwind 400-row saturation): each spending category owns one hue — Groceries emerald (#34d399), Eating Out orange (#fb923c), Transport blue (#60a5fa), Bills rose (#fb7185), Savings amber (#fbbf24), Debt red (#f87171), and so on per the frontmatter. One tonal family so charts read as a blended set, not a fight. Users can override any of these; treat overrides as canonical.

### Named Rules
**The Category Voice Rule.** A category's colour appears as a ~15% tinted chip background (`${colour}26`) with the icon at full strength, as bar/dot accents, and in charts — never as a flooded surface or full-bleed background.

**The Red Is Risk Rule.** Red and rose mean money is genuinely at risk. Never use red for emphasis, decoration, or non-financial errors; if everything is fine, a screen may contain no red at all.

**The Penny Gradient Rule.** The indigo→violet gradient belongs to the AI adviser alone. Any surface wearing it must be a place the user can get advice.

**Flows vs Positions.** Home speaks only in flows (what's moving: in hand, due, movement since payday). Position totals (net worth, total across cards) live in the estate — the Accounts page — visited by choice, never greeting the user.

## 3. Typography

**Display Font:** system-ui (SF Pro / Segoe UI / Roboto native stacks)
**Body Font:** system-ui (same stack)

**Character:** Native and invisible — the platform's own sans renders numbers crisply and loads instantly. Hierarchy comes entirely from weight, size, and colour, never from a second family.

### Hierarchy
- **Display** (700, 30px, tight −0.025em): The one hero figure per screen — net worth, total debt, monthly surplus.
- **Headline** (700, 20px): Page titles ("Spending", "Budgets", account names).
- **Card/section title** (700, 16px, `text-base font-bold`): Card headers, section titles, verdict lines within content cards. The standard chosen for Savings and Tax tab content.
- **Title** (600, 14px): Row primaries, button labels.
- **Body** (400-500, 13-14px): Descriptions, chat text, explanatory copy.
- **Label** (600, 10-11px, +0.05em, UPPERCASE): Section markers ("PAY PERIOD", "YOUR GOALS"), metric captions. Always muted (#94a3b8), never ink.

### Named Rules
**The Numbers Lead Rule.** On any card the money figure is the visually heaviest element; its label sits above or beside it in whisper-label style. If a label outweighs its number, the hierarchy is wrong.

## 4. Elevation

Flat plus one soft shadow. Light mode separates cards from the canvas with a single ambient `shadow-sm` (0 1px 2px rgba(0,0,0,0.05)) — dark mode drops shadows entirely and separates with tone (#1e293b on #0f172a) and hairline borders. Depth beyond that is expressed by layering surfaces (sheets and modals over a black/40-60 backdrop), never by stacking heavier shadows. Floating elements (Penny FAB, toasts) may use one larger soft shadow (`shadow-xl`) because they genuinely float above the page.

### Named Rules
**The One Shadow Rule.** Resting cards get `shadow-sm` or nothing. If a design needs a heavier shadow to feel separated, fix the tone contrast instead.

### Liquid Glass surfaces
Four glass tiers, implemented in `frontend/app/globals.css`: `.glass-hero` (screen anchor), `.glass-card` (standard panel), `.glass-tile` (nested stat — translucent fill only), `.glass-sheet` (bottom sheets and modals — solid, no blur). Blur lives on the page layer (`#app-shell.sheet-open`) not the sheet. Every other tier flattens to solid surfaces under `prefers-reduced-transparency` or when `backdrop-filter` is unsupported.

**The Glass Sheet.** When a sheet or modal opens, the page behind it blurs (8px + slight dim) — the world becomes atmosphere. The sheet itself is a SOLID surface (white / #0f172a) with a top hairline: paper floating over blurred glass. Sheets never use backdrop-filter; readability is absolute. Native OS pickers never appear; selection lists render as in-sheet rows.

## 5. Components

Soft, tactile, confident: generous radii, thumb-sized targets, immediate press feedback.

### Buttons
- **Shape:** Softly rounded (12px); pill (9999px) for compact chip-actions.
- **Primary:** Adviser Indigo (#4f46e5) fill, white 14px/600 text, 10px×16px padding; hover deepens to indigo-700, press `active:scale-95`.
- **Destructive:** Risk Red fill (or `red-500/20` tint on dark hero cards) — reserved for remove/delete.
- **Secondary / Ghost:** Hairline border, slate text, transparent fill; on colourful hero headers use `bg-white/20` frosted chips.
- **Hover / Focus:** Colour shift + visible focus ring (`focus:ring-2 focus:ring-indigo-500`); every press animates scale.

### Chips (category identity)
- **Style:** 32-36px square, 8-12px radius, category colour at ~15% alpha as background, category icon (Lucide, 15-16px) at full colour strength.
- **State:** The chip is identity, not a control; selected/filter states add a border in the category colour.

### Cards / Containers
- **Corner Style:** 16px (`rounded-2xl`) standard; 24px (`rounded-3xl`) for page-header heroes and bottom sheets.
- **Background:** Card White / Slate Card; hero headers may carry a provider-brand gradient with white text.
- **Shadow Strategy:** One Shadow Rule (above).
- **Border:** Hairline in light mode where shadow needs help; always in dark mode.
- **Internal Padding:** 16px (p-4); dense list rows 12px vertical.

### Inputs / Fields
- **Style:** Slate-50 (dark: slate-700) fill, hairline border, 12px radius, 14px text, 10px vertical padding.
- **Focus:** 2px indigo ring, no border-colour tricks.
- **Error:** Message in Risk Red 12px below the field; the field itself stays calm.

### Navigation
- **Mobile:** Fixed bottom bar, five icon+label items (10-11px labels); active item in Adviser Indigo with a soft indigo-50 pill. Respects `safe-area-inset-bottom`.
- **Desktop:** Fixed 256px left sidebar, white/slate-900, icon+label rows with indigo-50 active pill and a trailing indigo dot.

### Bottom Sheets (signature)
Mobile-first detail surfaces (transactions, categories, pay-period settings): full-width, `rounded-t-3xl`, slide up in 280ms with `cubic-bezier(0.32, 0.72, 0, 1)` over a fading black/40 backdrop; on ≥sm they become centred `rounded-3xl` modals. Body scroll locks while open.

### Progress Bars (signature)
The app's verdict instrument: 4-10px tracks in slate-100/slate-700 with a rounded fill in the semantically correct colour (category colour, emerald when on-pace, amber when above pace, red when over). Pace markers are 2px slate ticks. Every budget, goal, and plan renders one.

## 6. Do's and Don'ts

### Do:
- **Do** lead every card with the verdict: the money figure in Display/Headline weight, the label in whisper caps above it.
- **Do** use `active:scale-95` (or `active:opacity-70`) on every tappable element — feedback is part of the calm.
- **Do** pair every state with a next action (Reconnect, Re-baseline, Update your details, Ask Penny) styled as a real button or link.
- **Do** keep both themes first-class: every new surface ships with `dark:` variants built on slate-800/900 + hairlines.
- **Do** label estimates honestly (" · estimated", "Up to £X/yr") in muted italic or whisper text — trust is a visual property here.
- **Do** respect `prefers-reduced-motion` and keep all animation under 300ms with soft easing.

### Don't:
- **Don't** build anything that feels like a legacy bank portal — no dense grey data tables, no jargon labels, no 2010s enterprise chrome.
- **Don't** drift toward crypto-bro dashboards: no neon-on-black, no hype gradients beyond Penny's single signature, no casino energy.
- **Don't** ship the generic AI-template look — default-shadcn grey cards with no category colour language is off-brand even when it's "clean".
- **Don't** use red outside genuine financial risk (The Red Is Risk Rule) or the Penny gradient outside AI surfaces (The Penny Gradient Rule).
- **Don't** flood surfaces with a category colour; tint at ~15% and let the icon carry the hue (The Category Voice Rule).
- **Don't** stack shadows for depth — if separation fails, fix tone or borders (The One Shadow Rule).
- **Don't** stretch the mobile column on desktop; wide screens get real multi-column layouts (as Home, Spend, Budget, Insights already do).
