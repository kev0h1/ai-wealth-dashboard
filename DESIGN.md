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

**Figures Are Ink; Amber Lives In The Signifier.** Watch Amber marks a caution condition through a small signifier only, a badge, chip, dot, icon, or bar, never through the colour of a money figure, headline, section label, or full sentence of prose. When a sentence carries a caution and no other signifier is present, prepend a small leading amber dot rather than colouring the text.

**The Penny Gradient Rule.** The indigo→violet gradient belongs to the AI adviser alone. Any surface wearing it must be a place the user can get advice.

**Flows vs Positions.** Home speaks only in flows (what's moving: in hand, due, movement since payday). Position totals (net worth, total across cards) live in the estate — the Accounts page — visited by choice, never greeting the user.

## 3. Typography

**Display Font:** Figtree, self-hosted via next/font (replaces the raw system-ui stack, 2026-08-18)
**Body Font:** Figtree (same family)
**Figure Font:** JetBrains Mono, for any currency figure regardless of symbol (£, KES/KSh, etc., see The Money Is Mono Rule below)

**Character:** A rounded, humanist sans with a warmer, more considered voice than the raw platform default, self-hosted so it loads instantly with no layout shift. Hierarchy still comes entirely from weight, size, and colour, never from a second family for prose, currency figures are the one deliberate exception.

### Hierarchy
- **Display** (700, 30px, tight −0.025em): The one hero figure per screen — net worth, total debt, monthly surplus.
- **Headline** (700, 20px): Page titles ("Spending", "Upcoming", account names).
- **Amount-on-card** (700, 19px): A card-level money figure, one step below Headline/Display. The Spend notable card's spend amount is the named example, heavy enough to lead the card without competing with a page's actual Display/Headline figure.
- **Card/section title** (700, 16px, `text-base font-bold`): Card headers, section titles, verdict lines within content cards. The standard chosen for Savings and Tax tab content.
- **Title** (600, 14px): Row primaries, button labels.
- **Body** (400-500, 13-14px): Descriptions, chat text, explanatory copy. The Spend instrument header's reading sits at Body 14px/400, a caption under the gauge rather than its own hero line.
- **Caption** (400, 12px): The quiet step below Body, supporting text directly under a card's main line (pace sentences, consequence lines, cause lines on Spend notable cards). Not a Label, it is sentence case, not uppercase, and it is not tracked wide.
- **Label** (600, 10-11px, +0.05em, UPPERCASE): Section markers ("PAY PERIOD", "YOUR GOALS"), metric captions. Always muted (#94a3b8), never ink.

### Named Rules
**The Numbers Lead Rule.** On any card the money figure is the visually heaviest element; its label sits above or beside it in whisper-label style. If a label outweighs its number, the hierarchy is wrong.

**The Money Is Mono Rule (2026-08-18).** Any currency figure, in any currency (£, KES/KSh, including −£, ~£, and equivalent negated/approximate forms in other currencies), is set in JetBrains Mono with tabular-nums, all other numerals (dates, counts, percentages) stay in Figtree. A KES balance next to a £ balance must not differ in font. Chosen by Kevin from the /design/type variant comparison (variant D).

- **No justified text (2026-08-18).** Justification was trialled on hero prose and reverted: on narrow phone columns it produced uneven word gaps. All prose is left-aligned with `text-pretty`.

## 4. Elevation

Flat plus one soft shadow. Light mode separates cards from the canvas with a single ambient `shadow-sm` (0 1px 2px rgba(0,0,0,0.05)) — dark mode drops shadows entirely and separates with tone (#1e293b on #0f172a) and hairline borders. Depth beyond that is expressed by layering surfaces (sheets and modals over a black/40-60 backdrop), never by stacking heavier shadows. Floating elements (Penny FAB, toasts) may use one larger soft shadow (`shadow-xl`) because they genuinely float above the page.

### Named Rules
**The One Shadow Rule.** Resting cards get `shadow-sm` or nothing. If a design needs a heavier shadow to feel separated, fix the tone contrast instead.

### Liquid Glass surfaces
Four glass tiers, implemented in `frontend/app/globals.css`: `.glass-hero` (screen anchor), `.glass-card` (standard panel), `.glass-tile` (nested stat — translucent fill only), `.glass-sheet` (bottom sheets and modals — solid, no blur). Blur lives on the page layer (`#app-shell.sheet-open`) not the sheet. Every other tier flattens to solid surfaces under `prefers-reduced-transparency` or when `backdrop-filter` is unsupported.

**The Glass Sheet.** When a sheet or modal opens, the page behind it blurs (8px + slight dim) — the world becomes atmosphere. The sheet itself is a SOLID surface (white / #0f172a) with a top hairline: paper floating over blurred glass. Sheets never use backdrop-filter; readability is absolute. Native OS pickers never appear; selection lists render as in-sheet rows. The Penny popover (components/PennySheet.tsx) is a deliberate exception: a floating window anchored to its trigger rather than a takeover sheet, it never blurs or dims the page behind it.

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
- **Mobile:** Fixed bottom bar, five icon+label items (10-11px labels): Home, Spend, a raised centre Penny button, Upcoming, Planning. Active tabs sit in Adviser Indigo with a soft indigo-50 pill; the centre Penny button is the only surface in the bar allowed the indigo→violet gradient (The Penny Gradient Rule). Insights is retired from the bar entirely, and Settings is not a tab, it lives behind the top-left avatar on Home (44px tap target). Respects `safe-area-inset-bottom`.
- **Desktop:** Fixed 256px left sidebar, white/slate-900, icon+label rows with indigo-50 active pill and a trailing indigo dot: Home, Spend, Upcoming, Planning, Settings. The Penny door is a separate bordered footer row below that list, carrying the same gradient mark, not a sixth tab.

### Bottom Sheets (signature)
Mobile-first detail surfaces (transactions, categories, pay-period settings): full-width, `rounded-t-3xl`, slide up in 280ms with `cubic-bezier(0.32, 0.72, 0, 1)` over a fading black/40 backdrop; on ≥sm they become centred `rounded-3xl` modals. Body scroll locks while open.

### Progress Bars (signature)
The verdict instrument for budgets, goals, and plans: 4-10px tracks in slate-100/slate-700 with a rounded fill in the semantically correct colour (category colour, emerald when on-pace, amber when above pace, red when over). Pace markers are 2px slate ticks. Every budget, goal, and plan renders one.

**Retired on Spend.** The per-card pace bar that used to sit on each Spend notable card is retired, and so is its short-lived successor, the header Pace Strip (retired 2026-08-27 with variant B "weighted instrument", see The Instrument Header below). Spend's pace now reads entirely in words: each notable's own amber "N× usual" badge and the reading state the same fact prose already carries elsewhere, with no bar or sparkline standing in for it. Progress bars remain the correct instrument everywhere else; Spend is the one page whose pace lives in prose, not on a bar or in its header.

### The Safe-to-Spend hero (Home)
Home opens on one hero instrument, not a three-tile summary: a single Display-weight figure with its own status word in a pill chip directly above it, On track, Tight, Cards used the spare, or Short, so the figure never appears without its verdict attached. Balances stay masked (`£••••`) until server preferences resolve (`PreferencesContext.preferencesReady`), so returning users never see a real number flash before their own hide-balances choice is known.
- A collapsible "Full calculation" ledger sits under the hero, three ordered stages: cash forecast (bills and income applied in date order, down to the lowest projected balance), set-asides (buffer, plans, and allocations reserved), and card position (unpaid card balance growth). Each stage explains itself in a sentence before any figure.
- Every non-happy outcome, a hard error, insufficient account history, an unsupported account or currency setup, or a degraded calculation that could not verify every set-aside, gets its own heading, sentence, and a retry action where one applies. The card never renders null or an empty shell.
- The Red Is Risk Rule applies at its most literal here: the figure and its status pill turn red only in the genuine Short state; Tight stays amber in its chip alone, and the error, insufficient-history, unsupported, and degraded states stay neutral ink with no colour signal at all.

### The Instrument Header (Spend)
Spend's glass-hero opens on a weighted instrument, not three equal cells: Out leads as the hero figure (Display/30, tight −0.025em, tabular-nums), because Spend is a page about spending, so the figure that answers "how much has gone out" carries the weight. In and Moved drop to a secondary tier below it (Title/14, tabular-nums), each still topped by its own whisper label (uppercase, tracking-wide, muted). Out and In read in ink; Moved also reads in neutral ink now, not Verified Emerald, because the Moved bucket includes plain account-to-account shuffling (`own_accounts`) alongside genuine destinations, and shuffling has not earned Verified Emerald (in the owner's own data, about £6,075 of an £8,087 Moved total was own-account shuffling) — claiming it as "money already put to work" was misleading as well as inconsistent with the Red Is Risk Rule's colour-is-information sibling for green. Moved only renders when the payload has a moved total; older payloads fall back to a two-cell Out | In row rather than showing a false zero. The quiet Out-vs-In gap line that used to sit under the cells was removed (2026-09-04 Codex design round); nothing sits under the cells now but the reading caption below.

The Pace Strip that used to sit nested in a `glass-tile` inset below the cells is retired (owner review, 2026-08-27, variant B "weighted instrument"): an axis-less sparkline nobody could act on, when the same "running ahead of usual" fact is already stated in words, by the category rows' own amber pace chip and by the reading underneath. The Instrument Glow Rule that conditioned `.needs-you` on the strip's own over-pace state retires with it — this bordered inset never wears `.needs-you`, full stop, the same glow-as-attention discipline as ever (a card glows because it needs the user, or it doesn't glow at all), just with nothing left inside this instrument that could trigger it.

The reading itself sits under the instrument as a caption, not a hero line: Body 14px/400, slate voice, not the bold ink Numbers Lead Rule treatment. The instrument's figures carry the weight; the reading explains them.

### Card resolve lifecycle (Spend notables)
Notables are ranked, not listed flat: the single highest-`multiple` notable renders as the full card described below; every other notable collapses into one "Also running warm" tile of compact mini-rows (icon, category, figure, badge) directly beneath it. A mini-row is not a dead end, tapping it expands the row in place to reveal the exact same content the hero card shows, pace line, consequence line, biggest-causes line, "See the N payments", the intent pair, and the aim block, via the shared `grid-template-rows` collapse convention below (`inert` on the collapsed region, `aria-expanded` on the toggle). The one-off/new-normal question lives only on this ranked-notable surface (it does not live on `CategorySheet` any more, see the `AimBlock` doctrine), so collapsing a category into the grouped tile must never make that question unreachable.

The pace badge itself is amber only at `multiple >= 2.0`; below that threshold it renders as the same neutral slate chip a resolved card crossfades to. Colour marks genuine pace concern, not every notable equally. Answering One-off or New normal resolves a card in place (hero or an expanded mini-row alike); it never disappears or gets replaced by a different component. The badge crossfades (200ms, opacity only) to a neutral slate chip reading "noted · one-off" or "usual updating". The question and its pace/consequence prose collapse together via a `grid-template-rows` 1fr→0fr transition (200ms, ease-out), never a hard cut. The compressed card keeps its chip, category name, amount, and "See the N payments" link, so Show Your Working survives resolution, the evidence stays one tap away even after the card goes quiet.

Resolving fires a single toast with one Undo action, live for 5 seconds, matching the established toast-with-undo pattern (TeachingSheet.tsx). Undo restores the card to its open, asking state.

New normal is never filed directly from the card. It always opens the Intent Consent Sheet first, which prices the change in plain language before saving, "here's what that changes" narration fetched fresh per category, with filing gated behind an explicit second confirmation ("File it"). The sheet follows the standard solid-surface sheet contract: bottom sheet with a top hairline on mobile, centred modal at the `lg:` breakpoint (the app's standard sheet breakpoint, not `sm:`), never backdrop-filter on the sheet itself.

### Upcoming and Planning (2026-09-04 split)
The 2026-09-04 Codex round split what used to be one Planning surface into two: `/upcoming` (`PlanningPage.tsx`) is this pay period only, a runway hero ("Projected at payday / month end") with its own "Full calculation" ledger, bills, allocations as envelope rows, and one-offs; `/planning` (`LongTermPlanningPage.tsx`) is the long horizon only, the priority ladder described below, debt position buckets, and long-term goals. See "The folded ladder and the jump strip" below for the ladder itself; the current pay period's shortfall, when the period gate is short, is spoken by Planning's own hero line, not by a rung in that ladder.

### The folded ladder and the jump strip (Planning, 2026-09-04)
Planning's priority ladder folds to what is live: completed rungs collapse into one "N done · names" row and locked rungs into one "N more after this · names" row, each expandable in place with the grid-template-rows convention; only the active rung renders in full. The hero is the only place the current pay period's shortfall is spoken, so the ladder carries no period rung. Directly under the hero a three-chip jump strip (Buffer, Debt, Goals) shows one small figure each and scrolls to its section on tap. A chip wears a 6px Watch Amber dot only when its section needs a look: a 0% offer ending this month or within 30 days on a balance of at least £250, or a goal that is behind its pace. Buffer never dots. The dot says look, the section says why. The buffer and the cash-versus-invested split share one card, Cash and investments, directly after the ladder, so Planning carries its position figures in exactly one place.

### Tips on Spend and the transactions page (2026-09-05)
Savings tips never add rows to the Spend category list. A category that has open tips says so in its own subline, count first and a figure only for the tips that carry one ("2 tips · ~£52/mo from 1"), muted like the rest of the subline. The tip itself waits on the transactions page: when a single category filter is active, one collapsed line sits under the filter chips, above the payments, and unfolds in place to the tip detail, fact line first, then the researched body, the estimate and the research age. Single-tip categories unfold straight to the detail. Nothing about tips is attributed to Penny; they are research, labelled as tips, with their age visible.

### The shape card and Your money's shape (2026-09-05)
The money shape leaves Spend's Patterns view. The period view ends on one instrument card, How your pay was split, with the four-segment bar and four figures, Fixed, Moved, Free and Left (Beyond take-home when spend went over), and opens Your money's shape, a drill-in page holding the shape hero with its period and averages control, what works for you, and the reference shapes. It holds nothing else. Tips live in category sublines and on the transactions page. The Insights page is retired.

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
- **Don't** stretch the mobile column on desktop; wide screens get real multi-column layouts (as Home, Spend, Upcoming already do).
