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
- The canvas carries orientation and explanation; cards are earned containers for instruments, actions and evidence
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

**Figures Are Ink; Amber Lives In The Signifier.** Watch Amber marks a caution condition through a small signifier only, a badge, chip, dot, icon, or bar, never through the colour of a money figure, headline, section label, or full sentence of prose. When a sentence carries a caution and no other signifier is present, prepend a small leading amber dot rather than colouring the text. The one documented exception is the Safe-to-Spend hero figure, which carries emerald, red or amber by the rule in the hero section below (G218).

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

**Platform exception — form fields on touch (G81, 2026-09-14).** Any focusable `input`, `textarea` or `select` renders at 16px minimum on coarse-pointer (touch) devices, overriding whatever step its own class would otherwise put it on. This is not a hierarchy choice: iOS Safari auto-zooms the page on focus for any field below 16px and never restores the previous scale, and disabling that behaviour via the viewport meta (`maximum-scale`/`user-scalable`) is a banned WCAG anti-pattern (see `app/layout.tsx`'s viewport export). The rule lives in `frontend/app/globals.css` scoped to `@media (pointer: coarse)`, so desktop/mouse pointers keep each field's documented type-scale step unchanged. If an audit finds a form field below 16px on a phone, this is why, and the fix is not to shrink it back down.

### Named Rules
**The Numbers Lead Rule.** On any card the money figure is the visually heaviest element; its label sits above or beside it in whisper-label style. If a label outweighs its number, the hierarchy is wrong.

**The Money Is Mono Rule (2026-08-18).** Any currency figure, in any currency (£, KES/KSh, including −£, ~£, and equivalent negated/approximate forms in other currencies), is set in JetBrains Mono with tabular-nums, all other numerals (dates, counts, percentages) stay in Figtree. A KES balance next to a £ balance must not differ in font. Chosen by Kevin from the /design/type variant comparison (variant D).

- **No justified text (2026-08-18).** Justification was trialled on hero prose and reverted: on narrow phone columns it produced uneven word gaps. All prose is left-aligned with `text-pretty`.

**Icons Align, Figures Right-Align (G165, 2026-09-25).** In any list that pairs an icon or bank badge with a figure, the icons sit in one fixed column and the figures right-align in a tabular-nums column; never let a figure's width push its icon sideways. A column label above such a list left-aligns to the icon column's edge, not to the figure column (G171, 2026-09-26): put the label and the rows in one grid so the label's left edge is the icon column's left edge by construction, rather than a separately-aligned line that drifts back over the figures.

## 4. Elevation

Flat plus one soft shadow. Light mode separates cards from the canvas with a single ambient `shadow-sm` (0 1px 2px rgba(0,0,0,0.05)) — dark mode drops shadows entirely and separates with tone (#1e293b on #0f172a) and hairline borders. Depth beyond that is expressed by layering surfaces (sheets and modals over a black/40-60 backdrop), never by stacking heavier shadows. Floating elements (Penny FAB, toasts) may use one larger soft shadow (`shadow-xl`) because they genuinely float above the page.

### Named Rules
**The One Shadow Rule.** Resting cards get `shadow-sm` or nothing. If a design needs a heavier shadow to feel separated, fix the tone contrast instead.

### Liquid Glass surfaces
Four glass tiers, implemented in `frontend/app/globals.css`: `.glass-hero` (screen anchor), `.glass-card` (standard panel), `.glass-tile` (nested stat — translucent fill only), `.glass-sheet` (bottom sheets and modals — solid, no blur). Blur lives on the page layer (`#app-shell.sheet-open`) not the sheet. Every other tier flattens to solid surfaces under `prefers-reduced-transparency` or when `backdrop-filter` is unsupported.

**The Glass Sheet.** When a sheet or modal opens, the page behind it blurs (8px + slight dim) — the world becomes atmosphere. The sheet itself is a SOLID surface (white / #0f172a) with a top hairline: paper floating over blurred glass. Sheets never use backdrop-filter; readability is absolute. Native OS pickers never appear; selection lists render as in-sheet rows and dates and months go through `components/DatePicker` (see Inputs / Fields). The Penny sheet (components/PennySheet.tsx) is the exception: a floating window on desktop that never blurs or dims the page behind it, and a full-screen takeover on phones (see the Penny full screen note below).

- **Penny full screen, G240 (approved A, Clear runway, Kevin 2026-10-08).** Below `lg` the Penny sheet is a full-screen takeover: top safe-area inset to bottom safe-area inset (or the measured keyboard edge while typing), on an opaque canvas-coloured underlay, with square edges and no radius, so no page shows above or around it in light or dark. Desktop keeps the floating window. The keyboard strategy (G191, G197) and the page scroll lock (G211) are unchanged. An empty thread shows the heading "What would you like to check?", the line "Ask about your money, or start with one of these." and the screen's own starter chips (44px, wrapping, the same list as the chip row, which steps aside on phones while this shows); tapping one fills the composer without focusing it or opening the keyboard (the top row's rule), the block stays until the thread has a message, and it hides while the keyboard is up. `/design/penny-fullscreen` is the gate preview: it renders the production panel, header, composer, empty-state layout and chip, with fixture chip labels and local replies because the live conversation fetches its own data.

**Penny typing, G197, approved variant B restored (Kevin 2026-10-02; reverses G196's fill-once layout and restores Codex's approved G191 conversation-first design as folded in at 02c22ef4, keeping G196's keyboard mechanics).** Touch-down and focus alone change nothing, so the input stays under the finger until the tap completes, and a hardware keyboard changes nothing at all. Once a software keyboard is measured, the Penny window takes over the visible area exactly once, full width, from 8px inside the top of the visible area (safe-area aware) down to the keyboard edge (on phones G240 supersedes the 8px gap and the radius: the sheet runs from the top inset, square). The header compacts to the avatar, title and close button, with the links row ("Your plan and updates") and the question chips hidden so the conversation fills the space, and the line under the header keeps a clear gap below the close button rather than touching it. The composer and its general-information note sit fully above the keyboard. After that move nothing changes: page scroll, visual-viewport panning and URL-bar changes never move or resize it, and it re-fits only for a genuine keyboard height change. The page behind cannot scroll while the window is open (a fixed body with the scroll offset restored on close), and the conversation area inside still scrolls. The keyboard edge is measured, not tuned: `interactive-widget=resizes-content` makes Chrome on Android shrink the layout viewport so a fixed bottom edge is the keyboard top (the same as the app shells); where the layout viewport did not shrink (iOS Safari) the gap is read from the visual viewport (height plus offset, counted once). The mobile navigation and the raised Penny button hide while typing, and the bottom navigation also steps aside whenever a software keyboard is up (approved 2026-10-02; G198 keys this on the measured keyboard, never on focus alone, so a hardware keyboard or a dismissed keyboard with retained focus never leaves a gap where the navigation should be). Dismissing the keyboard returns the window to its resting position in one frame, links and chips back, even if the input retains focus, with the draft kept. Nothing animates. The full-page `/penny` composer docks the same way. Sending keeps the keyboard and the takeover in place, like any chat app: the input is never disabled or read-only while a reply is pending and the send button never takes focus, so the reply streams into the thread above while the caret stays in the input. The thread follows the latest turn only when the reader was already there. Desktop keeps the floating window. The preview shares the live frame, header, composer and thread-anchoring hook; its replies are local fixtures, not live advice.

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

**The Canvas Before Cards Rule (2026-09-15).** The page canvas is the default surface for orientation and explanation. Page titles, answer-first verdicts, short supporting readings, reconciliations, section introductions and cross-links sit directly on the canvas unless a visual boundary materially helps the user understand or act on them.

A page may use at most one `.glass-hero`, and only when it contains the page's primary financial instrument or a high-stakes decision whose boundary improves comprehension. A standard card must earn its boundary by containing at least one discrete action, bounded object, comparison, ledger, chart, input or form, expandable evidence group, or genuine risk state. Never add a card solely to create a background, spacing or a heading. Never wrap each paragraph or section by habit, and avoid nesting cards inside cards. Use typography, spacing, landmarks, hairlines and progressive disclosure to establish the rest of the hierarchy.

This is a shared surface hierarchy, not a universal page template. Spend's chronological journey, timeline and sticky desktop rail remain specific to its pay-period story. Home, Spend, Upcoming and Planning may retain one hero when it is their primary financial instrument. Settings, forms, grouped account records and dense ledgers may be more container-led because their boundaries carry interaction or grouping meaning, but every surface must still have a job. Plain-canvas content must preserve a readable measure, clear section landmarks, WCAG AA contrast and equivalent separation in light and dark themes.

### Inputs / Fields
- **Style:** Slate-50 (dark: slate-700) fill, hairline border, 12px radius, 14px text, 10px vertical padding.
- **Focus:** 2px indigo ring, no border-colour tricks.
- **Error:** Message in Risk Red 12px below the field; the field itself stays calm.
- **Date and month pickers (G136, approved A, 2026-10-05).** Every date or month the user picks renders through `components/DatePicker` (`DateField` plus `DatePickerSheet`) on the glass sheet grammar, never through the browser's own control. The field is a 44px-minimum slate-50 (dark: slate-700) button with a calendar icon, the formatted value ("16 Oct 2026", "October 2026") or a "Choose a date" / "Choose a month" placeholder, and a chevron. It opens a nested `SheetFrame` above the host, so the top layer alone owns Escape, Back and the focus trap and focus returns to the field. The picker is a calendar grid with 44px cells: the selected day is a solid indigo pill, today is ringed, and past or out-of-range days are muted ink and never red. The month name and the year in the header are selectors, not static text: tap the month name for a 3x4 month grid, tap the year for a page of 12 years with previous and next page, alongside the previous and next month chevrons (a stepper of chevrons alone is not enough). Month-only inputs use the same component in month mode, a year header over the month grid with the same year selector. A Today (or This month) chip and a Cancel / Done footer finish it. Keyboard and screen-reader semantics are part of the component: `role="grid"` and `gridcell`, `aria-selected`, `aria-current="date"` on today, a roving tabindex with Arrow, Home, End, PageUp and PageDown, an `aria-live` heading. Native `type="date"`, `type="month"` and `type="datetime-local"` inputs never ship; `check:no-native-date-inputs` fails the build on one. The D8 payday picker builds on this component. Values keep the ISO shape the native inputs used ("YYYY-MM-DD", "YYYY-MM"), and a host validates a required date in its own submit path because there is no native validation. `/design/date-picker` renders the production component.

### Navigation
- **Mobile:** Fixed bottom bar, five icon+label items (10-11px labels): Home, Spend, a raised centre Penny button, Upcoming, Planning. Active tabs sit in Adviser Indigo with a soft indigo-50 pill; the centre Penny button is the only surface in the bar allowed the indigo→violet gradient (The Penny Gradient Rule). Insights is retired from the bar entirely, and Settings is not a tab, it lives behind the top-left avatar on Home (44px tap target). Respects `safe-area-inset-bottom`.
- **Desktop:** Fixed 256px left sidebar, white/slate-900, icon+label rows with indigo-50 active pill and a trailing indigo dot: Home, Spend, Upcoming, Planning, Settings. The Penny door is a separate bordered footer row below that list, carrying the same gradient mark, not a sixth tab.

### Bottom Sheets (signature)
**Shared anatomy, G192 variant B, approved 2026-10-02.** Customer task and detail sheets use `SheetFrame`: a near-full-height solid surface on mobile, portalled to `document.body` above navigation, with a persistent title and plain 44px close control, an independently scrolling body, and a persistent primary-action footer padded for the device safe area. At `lg` they become centred `rounded-3xl` dialogs, no wider than 500px. One visual viewport bounds the sheet when a keyboard opens; never add a second keyboard-height margin. The backdrop, close control, Escape and Back share the dismissal path, restore focus and unlock the page. Only the top sheet handles keyboard dismissal. Multi-step Upcoming editors retain their own Back stack inside the same frame. Every button in a sheet gets a 44px minimum height; a genuinely inline control opts out with `data-compact`. Phones keep the 0.28s slide-up entrance, `lg` dialogs do not slide. Phones show a 36x4 grab bar above the sheet header and the sheet swipes down to dismiss, through the same close path as the X, the backdrop, Escape and Back; desktop dialogs have no handle and no swipe. `/design/sheet-anatomy` imports the real goal and filter sheets with fixture operations, so the approved B layout cannot drift from production. Penny remains the separate G191, G196 and G240 workstream (floating window on desktop, full-screen takeover on phones, keyboard strategy); centred confirmation dialogs, the privacy lock and private operations-board dialogs are not task sheets.

### Progress Bars (signature)
The verdict instrument for budgets, goals, and plans: 4-10px tracks in slate-100/slate-700 with a rounded fill in the semantically correct colour (category colour, emerald when on-pace, amber when above pace, red when over). Pace markers are 2px slate ticks. Every budget, goal, and plan renders one.

**Retired on Spend.** The per-card pace bar that used to sit on each Spend notable card is retired, and so is its short-lived successor, the header Pace Strip. Pace in the decision journey reads in words: each notable's own amber "N× usual" badge, the reading and the reconciliation state the fact without an axis-less sparkline standing in for it. A labelled Spending pace chart may still appear in the configurable evidence collection at the end of the journey, where axes and comparison context make it a real chart rather than header decoration.

### Ledgers (show your working)

A ledger is the arithmetic behind a figure the user has already been given: operand rows, each a label and an amount in mono tabular figures, closing on one derived total. Six ship today: Safe to Spend's "How we got £X" and its Card safety check, Upcoming's "Full calculation", Planning's "How we calculated this", Spend's "How £X out adds up", and Spend's pace reconciliation. They are the same object, and the rule below governs all of them, but almost everything else about them is local and should stay that way. Signs are not shared: Safe to Spend gives each row an 18px operator column, Upcoming and Planning glue the sign to the amount at the end of the row (Upcoming's opening operand carries no sign at all), and Spend's "How £X out adds up" is two or three unsigned addends. Neither is the wrapper: most ledgers sit behind a disclosure, indigo on Safe to Spend, Upcoming and Planning but slate on Spend, and the pace reconciliation is not disclosed at all. Only Safe to Spend's rows carry an operator column and an optional wrapped detail caption; everywhere else a row is a single-line label-and-figure pair.

**One Separator Per Ledger Boundary (G154, 2026-09-23).** Any two adjacent ledger rows are separated by exactly one device, and the derived total is marked by exactly one device no operand row wears. Which device is a local choice, and the shipped ledgers legitimately differ: Safe to Spend's rows wrap and carry captions, so a hairline between rows earns its place and the total takes that same hairline drawn heavier; the rows elsewhere are one line each, so spacing or a `divide-y` separates them and the total takes a rule (Upcoming, Spend's "How £X out adds up"), a tinted status row (Planning), or weight alone (Spend's pace reconciliation). The count is not a local choice. Two devices at one boundary read as an accountancy double underline that nobody chose.

The fault to avoid is a total that carries its own rule while the operand above it also carries a bottom rule. Where the total wears a rule, draw the operand separators on the top edge of every row after the first (`first:`), never on the bottom edge with a `last:` escape: a total is a sibling of the operands, so the last operand is never `:last-child` and the escape never fires. `divide-y` fails the same way for the same reason, because Tailwind v4 compiles it to `:where(.divide-y > :not(:last-child))`, a bottom rule on the row before the total. Where the total wears weight or a fill instead of a rule, `divide-y` is correct and Spend's pace reconciliation uses it. Drawn on the top edge, the total's heavier rule *is* the rule at its own boundary rather than a second line under the one above it, and a row-level `first:` escape on both branches keeps a ledger whose operands are all absent from ruling off against nothing.

### The Safe-to-Spend hero (Home)
Home opens on one hero instrument, not a three-tile summary: a single Display-weight cash figure with its own status word in a pill chip directly above it, On track, Tight, Check card bill, or Short, so the figure never appears without its verdict attached. Balances stay masked (`£••••`) until server preferences resolve (`PreferencesContext.preferencesReady`), so returning users never see a real number flash before their own hide-balances choice is known.
- The hero is cash-led. It walks bills and expected income to payday, then subtracts the buffer, plans, and envelopes. Card balance growth is a separate stock fact because the purchase has not left cash yet. It is not normally subtracted from the hero or treated as a cash shortfall.
- Card activity sits in a quiet secondary panel below the hero: the net balance change this pay period, then either the user-provided clear-monthly due context or neutral carried-balance wording. Amber marks only an unconfirmed repayment. Growth on a card with no learned repayment series is held back as a fail-closed fallback until that bill is identified.
- A collapsible "How we got £X" ledger sits inline with the rest of the card. It shows the date-ordered cash forecast and each set-aside as distinct arithmetic rows, with derived totals separated by a rule. Any fallback card reserve gets its own second calculation, never mixed into the cash steps.
- Every non-happy outcome, a hard error, insufficient account history, an unsupported account or currency setup, or a degraded calculation that could not verify every set-aside, gets its own heading, sentence, and a retry action where one applies. The card never renders null or an empty shell.
- The Red Is Risk Rule applies at its most literal here: the figure turns red only for a genuine cash shortfall. Tight and an unconfirmed card repayment use amber only in their small status signifiers, while ordinary figures and prose stay ink. Error, insufficient-history, unsupported, and degraded states stay neutral ink with no colour signal at all.
- **Hero figure colour (G218, approved B, 2026-10-06).** The figure is tinted emerald when On track and red only for a genuine cash shortfall; a shortfall that exists only because of set-asides and plans (the cash forecast is not below the buffer) is amber in the figure, chip and caption, since a plan the user chose is not a payment at risk; dark red uses red-500 for legibility; Tight and card checks keep amber in the chip only; error, degraded and syncing stay ink. The plans-only rule is computed once on the server (`plans_only_short`), and Penny's chip, Penny's published view and the Home brief speak the same calm reading, "short after plans and envelopes". Wherever a figure renders (On track, Tight, card checks, Short, plans-only and a stale figure while syncing) the footer ends with one quiet 11px line in secondary ink, "An estimate from your bank data, not financial advice.", added at Kevin's request on 2026-10-06; it carries no colour, icon or link and is absent from the loading, error, degraded and first-sync states, which show no figure.
- **Hero route to Accounts (G219, approved B, 2026-10-06).** The hero keeps one primary action, and the quiet "Your accounts" text link is the only route from the hero to Accounts (the Spend from rows and the bank rail stay plain, not links). It is secondary slate ink with a 15px Whisper arrow, a 44px target, no fill, no colour and no gradient. It sits in the action row, right-aligned beside the primary action when there is one and alone when there is none, wrapping under it on narrow widths. That action row renders after the footer block, so it sits below the disclaimer line: the footer still ends with the disclaimer, and the action row is a separate row after the footer, not part of it. It shows wherever a figure renders, including a stale figure while syncing, and never on the loading, error, degraded or first-sync states. It complements Home's "Your estate" block, whose single footer row also opens Accounts (G221).
- **Home rhythm and estate (G221, approved C, 2026-10-06).** One rhythm runs down the whole Home stack: 12px between cards in a group (`space-y-3`), 20px between sections (`mt-5`, with `pt-5` at the top of the page), and 8px under a section label (`mb-2`), with no other gap between Home blocks. The pinned cards (fuel, groceries, the chart widget) live inside the Your money group rather than starting a block of their own. The Your estate block keeps its account rows and ends in one footer row, "All N accounts" ("See your account" when there is only one), in slate ink (`text-slate-600`, `dark:text-slate-300`) with a 13px chevron and a 44px target, topped by a hairline when rows precede it; the Manage header link and the "+N more accounts" row are gone, and the tutorial's accounts step highlights that footer. Home account rows use the brand-aware tidy name (`lib/accountName.ts`: shouting bank strings become sentence case, while brands and acronyms such as NatWest, HSBC and ISA keep their casing); the Accounts page rows are unchanged. A fresh user's route to Accounts stays on the connect card ("Other ways to add accounts").
- **Counted accounts (G231, 2026-10-07).** A bank current or savings account can be left out of Safe to Spend with the "Count towards Safe to Spend" switch on its account sheet (default on, 44px, helper "Turn off for accounts you do not spend from, like a joint bills account."); cards, offline accounts and statements have no switch. When the server refuses because the account pays something this pay period, the reason shows inline under the helper with a small leading slate dot and ink text ("This account pays 2 upcoming items this period, so it has to count"), and the switch stays on. The hero says "Not counting N accounts" (singular "1 account") in secondary ink, underlined, linking to /accounts, under the Spend from scope note, and nowhere when every account counts; the Full calculation ledger gains no line and its "Cash available now" detail reads "Across counted current accounts.". Balances still show everywhere (Accounts, Home estate, net worth): an excluded row carries only a quiet slate "Not counted" caption, never a colour. Upcoming's By account list, the Spend from line, move and cover suggestions and move and cover suggestions leave the account out, as a source and as a destination, and Penny flags the account as not counted.
- **Plan source account (G230, 2026-10-07).** A goal plan can record which current account its contribution leaves each period. Edit plan gets a quiet "Paid from" field below the savings pots: counted current accounts only (cards, savings and accounts left out of Safe to Spend are never offered), an explicit "Not set" that keeps the plan pooled-only, and a caption "Based on recent transfers" when the prefilled account is a guess from transfers into the plan's pot. An inferred account is read-only: nothing is saved unless the user picks one. Plans saved before this change, with no account or an old null, are inferred like new ones; only a deliberate "Not set" (stored with a `source_unset` marker) is never inferred, and picking an account clears it. The pooled Safe to Spend and Upcoming payday figures are unchanged, because the plans line already counts every plan whatever its source. The By account view now includes the plans paid from that account (inferred ones flagged estimated, using the same hedge as set-asides), and its footnote reads "Goal contributions count in the payday figure above. This account view includes the plans paid from this account." Plans with no source stay under "Unassigned". An inferred goal source counts in the account arithmetic but is never offered for easing (G228), which writes to the plan. `/design/plan-source-account` renders the production Edit plan sheet.
- **Sync loading (G214, approved B, 2026-10-06).** While a bank sync runs for a user who already has a figure, the hero keeps that figure but steps it down to secondary ink, with "Last known amount · as of HH:MM" beneath it and a ring inside the status chip ("Updating"). Verdict colour, the last-synced line and the recovery CTA are hidden for the duration, because a figure that is being refreshed is neither a verdict nor a risk. A stalled or failed sync ends in plain words and a Try again, never an endless ring, and the figure stays. A first sign-up has no figure yet, so the hero is the same card in the same grammar: the chip with the ring, "No figure yet" in secondary ink, "We will show your Safe to Spend once <bank> has synced", then the G202 ledger rows. On Accounts, a syncing bank's rows carry the ring beside the balance with "As of HH:MM · Updating", a bank that has never synced reads "Pending" in Figtree (never £0), and a quiet banner at the top says "Updating bank data" with Try again once a sync stalls or fails. A paused bank (B45) never shows as syncing.
- **Set-aside shortfall card (G217, approved A, revised 2026-10-06).** When a set-aside leaves an account short while its payments clear, Home shows a card with the same anatomy as the payment move card but lighter: a small ink figure in mono, a neutral icon, no shadow, no Penny gradient, and never red or amber, because a plan the user chose is not a payment at risk. The move is a recommendation sentence in the body, "You could move £X from <account>, which looks able to spare it", never a button, because the app does not move money; when no account can safely spare it the card says so instead, and an inferred paying account is hedged "based on recent transfers". One action remains, full width: Adjust set-aside, which opens the this-period sheet, with Change every period leading to the full editor. The card ranks below any payment shortfall card and does not appear for a gap under £5 (the account sheet line still shows it). `/design/allocation-shortfall` renders the production card.
- **Plan easing card (G228, approved A, 2026-10-07).** When cash is short this period and no safe move covers it, a goal plan can be eased for that one period. Home shows its own "Goal plan" card below the set-aside card, lighter than the payment card: neutral icon, no shadow, no Penny gradient, never red or amber. It leads with "Cash looks short this period" and offers one action, "Ease <plan> this period", opening a compact sheet with a £5 stepper and slider (£0 up to the whole contribution), a "Skip this period" chip, a two-option choice (keep the date: later periods rise; keep the amount: the date moves), the working ledger with one rule above its total, the limits line and a note of what will be written on the plan. Every figure is the engine's own, rounded up to £5, never computed in the sheet. There is no undo: editing the plan on Planning is the way back, and that edit ends the easing. Set-asides and plans never trade cash, and the card never moves money. Caps, enforced server-side: later periods at most 125% of the usual slice, the date moves at most two periods, at most two eased periods per plan in a rolling 12 months and never two in a row, offered only for a gap of £5 or more that no safe source covers. A capped plan shows the reason and no action; an eased plan shows one quiet line with the new figures and an "Edit plan" link. `/design/plan-deferral` renders the production card and sheet.

### The pay-period journey (Spend, G57 approved 2026-09-14)
Spend is one continuous account of the selected pay period, not a hero followed by competing Breakdown and Patterns modes. A full-width control row carries the page title, day, period navigation and a Search action, laid out to stay on one line at the 390px iPhone width and 375px (G82, 2026-09-16): the row does not rely on wrapping to fit there, it is a deliberate single line, the period-label pill's truncation width tightens below `sm` and the title has no competing fourth control crowding it out. Search is a direct 44px header icon at every width, not folded away below `sm` (the fault Kevin raised twice, 2026-09-14 and 2026-09-16, that made a transaction unfindable from Spend on a phone); the pay-period sheet's own "Search transactions" row is a slower second path to the same place, not a competing one. Only below that range, at widths like a zoomed 320px, does the row fall back to wrapping, the Search icon dropping to its own second line (it is last in the row, so it is always the item pushed down) rather than the title being truncated into unreadable fragments.

**G186 variant A, approved 2026-10-01.** The answer-first summary is one `.glass-hero` instrument, rendered by `SpendPaceHero` in production and its approved preview. Out leads, accompanied by a quiet Above usual, Below usual, In line or No comparison status and one overall pace sentence against the server's usual-by-now figure. Amber belongs only to the above-usual signifier; figures remain ink. Early periods and missing history do not claim a reliable comparison, and the day count uses the actual period length. In and Moved separately support the Out figure, retaining their income disclosure and moved-money destination. Moved stays neutral ink and explicitly outside Out. The collapsed "How Out adds up" ledger reconciles named categories, other categorised spending, anything still to categorise and total Out. On desktop this instrument forms the sticky left rail; the journey runs beside it. Mobile stacks the same information with the journey strip sticky below the hero.

**G186 typography B, approved 2026-10-01.** The same instrument now uses a quiet 11px Out-this-period heading, a fixed 30px Out figure and 16px supporting flows, with the existing font families and controls. The 13px pace verdict is followed by a separate 12px Usual caption, left-aligned with 4px of breathing room. The caption appears only when the existing model provides a reliable comparison; early and missing-history wording is unchanged. Large money amounts remain whole, stepping down within the fixed type scale when needed. The approved `/design/spend-hero-scale` B preview renders `SpendPaceHero`, not its own markup.

A compact jump strip links to Changes, To categorise, Spending and Charts. It follows the answer-first summary and stays sticky on mobile, and sits under the summary on desktop. Its destinations are state-driven: Changes is absent when nothing changed enough to review, and To categorise disappears as soon as no payments remain unplaced. The four-destination mobile layout uses two columns so counts and amounts stay readable. The strip never leaves a dead stop behind after the user completes a task.

The journey line then records pay arrival, explains the pace changes, asks for any unresolved placement, shows quieter spending, separates moved money, shows the pay-shape instrument and ends with the user's charts. **G140 variant A, approved 2026-10-01:** the pace evidence is a single bounded named-category ledger, rendered by `SpendPaceEvidence` in production and its approved preview. "How this compares with usual" introduces the baseline once: the median of up to three 30-day category spending totals before this period, adjusted to elapsed progress. Named positive category excess plus "Other differences", explicitly labelled a calculated balancing amount, reconciles to the signed "Difference from usual pace". A relevant caveat identifies uncategorised payments. The evidence does not repeat the hero's directional verdict, call overspending "ahead", or pair a minus sign with "less". Notable categories keep the existing resolve-in-place lifecycle and use equal two-line One-off and New normal choices, with neither visually recommended over the other.

Charts are evidence at the end of this same page. They are not a second Spend destination. The collection still supports add, remove, one Home pin and a saved order. Each chart has a visible drag handle for mouse and touch-hold reordering, dnd-kit keyboard semantics, and explicit Move up and Move down menu actions as the non-drag alternative. Period comparison joins Category breakdown and Daily spend in the default collection only when no preference has ever been stored; an explicitly emptied or reordered collection is respected. Transaction-heavy chart data loads only as this final stop approaches the viewport, so the verdict remains the first useful paint.

### Card resolve lifecycle (Spend notables)
Notables are ranked, not listed flat: the single highest-`multiple` notable renders as the full card described below; every other notable collapses into one "Also running warm" tile of compact mini-rows (icon, category, figure, badge) directly beneath it. A mini-row is not a dead end, tapping it expands the row in place to reveal the exact same content the hero card shows, pace line, consequence line, biggest-causes line, "See the N payments", the intent pair, and the aim block, via the shared `grid-template-rows` collapse convention below (`inert` on the collapsed region, `aria-expanded` on the toggle). The one-off/new-normal question lives only on this ranked-notable surface (it does not live on `CategorySheet` any more, see the `AimBlock` doctrine), so collapsing a category into the grouped tile must never make that question unreachable.

The pace badge itself is amber only at `multiple >= 2.0`; below that threshold it renders as the same neutral slate chip a resolved card crossfades to. Colour marks genuine pace concern, not every notable equally. Answering One-off or New normal resolves a card in place (hero or an expanded mini-row alike); it never disappears or gets replaced by a different component. The badge crossfades (200ms, opacity only) to a neutral slate chip reading "noted · one-off" or "usual updating". The question and its pace/consequence prose collapse together via a `grid-template-rows` 1fr→0fr transition (200ms, ease-out), never a hard cut. The compressed card keeps its chip, category name, amount, and "See the N payments" link, so Show Your Working survives resolution, the evidence stays one tap away even after the card goes quiet.

Resolving fires a single toast with one Undo action, live for 5 seconds, matching the established toast-with-undo pattern (TeachingSheet.tsx). Undo restores the card to its open, asking state.

New normal is never filed directly from the card. It always opens the Intent Consent Sheet first, which prices the change in plain language before saving, "here's what that changes" narration fetched fresh per category, with filing gated behind an explicit second confirmation ("File it"). The sheet follows the standard solid-surface sheet contract: bottom sheet with a top hairline on mobile, centred modal at the `lg:` breakpoint (the app's standard sheet breakpoint, not `sm:`), never backdrop-filter on the sheet itself.

### Upcoming and Planning (2026-09-04 split)
The 2026-09-04 Codex round split what used to be one Planning surface into two: `/upcoming` (`PlanningPage.tsx`) is this pay period only, a runway hero ("Projected at payday / month end") with its own "Full calculation" ledger, bills, allocations as envelope rows, and one-offs; `/planning` (`LongTermPlanningPage.tsx`) is the long horizon only, the priority ladder described below, debt position buckets, and long-term goals. See "The folded ladder and the jump strip" below for the ladder itself; the current pay period's shortfall, when the period gate is short, is spoken by Planning's own hero line, not by a rung in that ladder.

### The folded ladder and the jump strip (Planning, 2026-09-04)
Planning's priority ladder folds to what is live: completed rungs collapse into one "N done · names" row and locked rungs into one "N more after this · names" row, each expandable in place with the grid-template-rows convention; only the active rung renders in full. The hero is the only place the current pay period's shortfall is spoken, so the ladder carries no period rung. Directly under the hero a three-chip jump strip (Buffer, Debt, Goals) shows one small figure each and scrolls to its section on tap. A chip wears a 6px Watch Amber dot only when its section needs a look: a 0% offer ending this month or within 30 days on a balance of at least £250, or a goal that is behind its pace. Buffer never dots. The dot says look, the section says why. The buffer and the cash-versus-invested split share one card, Cash and investments, directly after the ladder, so Planning carries its position figures in exactly one place.

**G187 variant B, approved 2026-10-01.** The ladder is a checkpoint timeline on the canvas, with small circular state markers outside the cards. The live checkpoint has one standard glass card; opening a completed or later group reveals one shared glass card for that group. Each internal separator sits between 16px of space above and below, never against the preceding paragraph. The unchanged Planning hero remains the only hero. Figures align right and use the matching checkpoint's lens: Essentials is before debt repayments and the full-fund checkpoint is a three-month target, not the separately configurable buffer target. Backend detail, neutral options and links are retained. The approved preview imports `PlanningCheckpointTimeline`, the same component used by production.

### Tips on Spend and the transactions page (2026-09-05)
Savings tips never add rows to the Spend category list. A category that has open tips says so in its own subline, count first and a figure only for the tips that carry one ("2 tips · ~£52/mo from 1"), muted like the rest of the subline. The tip itself waits on the transactions page: when a single category filter is active, one collapsed line sits under the filter chips, above the payments, and unfolds in place to the tip detail, fact line first, then the researched body, the estimate and the research age. Single-tip categories unfold straight to the detail. Nothing about tips is attributed to Penny; they are research, labelled as tips, with their age visible.

### The shape card and Your money's shape (2026-09-05, placement updated by G57)
The money shape stays in the Spend journey as one instrument card, How your pay was split, with the four-segment bar and four figures, Fixed, Moved, Free and Left (Beyond take-home when spend went over). It opens Your money's shape, a drill-in page holding the shape hero with its period and averages control, what works for you, and the reference shapes. It holds nothing else. The configurable chart collection now follows the shape card as the journey's final evidence stop. Tips live in category sublines and on the transactions page. The Insights page is retired.

### Connecting a bank (A155 G, A159 B approved 2026-10-09)

- **Choose, review, hand off (shipped, the default).** "Choose your bank" with a fixed 44px search, then Sorted's own "Review your connection" step carrying the full A4.1 agency sentence, then "Continue to Finexer" (four taps before the bank's page, counting Finexer's Next and Connect).
- **Merged step (A159 B, behind `CONSENT_MERGED_STEP`, default off).** The review step is gone: a bank tap hands off at once with an "Opening Finexer…" status line. One summary line and one pinned 44px line, "AURIQ LTD acts as an agent of Finexer LTD, which is FCA authorised", sit under the list and expand in place (`aria-expanded`, not persisted) to the full A4.1 sentence, rendered from `AGENT_DISCLOSURE`, never retyped. The flag is the build-time `NEXT_PUBLIC_CONSENT_MERGED_STEP=on` in `lib/featureFlags.ts` and stays off until Finexer confirms in writing that a collapsed line meets Client Terms A4.2 and approves the change under 7.5 / A6.2 (`docs/compliance/finexer-merged-step-request.md`). Until then the review step above is the only live flow.

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
