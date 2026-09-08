# Screen: CARDS (Card Terms & Movement Tracking)

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 5824f59 2026-07-31 12:53:20 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/cards/CardsPage.tsx`
- **Apply diffs:** `git diff 5ad21c0..HEAD -- frontend/app/cards/CardsPage.tsx`

---

## Purpose

The CARDS screen surfaces credit card balance movement across the current pay cycle, broken down by card and spending category. It is the mobile-companion to the card-terms intake flow and the monthly card-strategy view.

**Context:** User's credit cards are 0% — card intent (clear monthly, balance-transfer candidate) and terms (APR, 0% end date, balance-transfer notice, credit limit) must be ASKED, never assumed. This screen reads the terms after intake and surfaces movement narrative.

**Page layout:**
- Header: "Back" nav + "CARDS · THIS CYCLE" whisper label + period range
- Movement headline: Verdict (↓ £X when paid down, ↑ £X when grew, "Held steady") + breakdown (new spend + payments)
- WHERE IT MOVED: Per-card rows (brand badge, name, APR pill, delta + balance owed)
- WHAT DROVE IT: Category breakdown + pattern insight line
- THE TRAJECTORY: 6-cycle bar chart (neutral slate when balance grew, emerald when shrunk)

---

## Source Files

### Web (frontend)

| File | Purpose |
|------|---------|
| `/root/ai-wealth-dashboard/frontend/app/cards/CardsPage.tsx` | Screen entry; data fetch + layout |
| `/root/ai-wealth-dashboard/frontend/lib/api.ts` | Type defs: `CardsStory`, `CardsStoryCard`, `CardTerms`, `CardPromo`, `BtOffer` |
| `/root/ai-wealth-dashboard/frontend/components/AccountMiniCard.tsx` | `BankBadge`, `accountBrand()` brand logic; used for per-card rows |
| `/root/ai-wealth-dashboard/frontend/components/ColourProvider.tsx` | Colour context (used for category chip backgrounds) |
| `/root/ai-wealth-dashboard/frontend/components/PreferencesContext.tsx` | `hideNetWorth` preference masking |
| `/root/ai-wealth-dashboard/frontend/components/BottomNav.tsx` | Tab navigation footer |
| `/root/ai-wealth-dashboard/frontend/lib/categories.ts` | `CATEGORY_COLOURS` palette (18 categories × hex) |
| `/root/ai-wealth-dashboard/frontend/app/globals.css` | Glass surfaces, glow, tokens |
| `/root/ai-wealth-dashboard/DESIGN.md` | Design system (read for context) |

**Note:** `CardTermsSheet` and `ConfirmDialog` are NOT imported in CardsPage.tsx; terms sheet is planned but not yet on this screen.

### Mobile (target)

| File | Purpose |
|------|---------|
| `/root/ai-wealth-dashboard/mobile/lib/tw.ts` | Tailwind→RN token map (colour, space, radius, text, tracking) |
| `/root/ai-wealth-dashboard/mobile/app/(app)/cards/index.tsx` | Screen component (to be created) |

---

## Layout Anatomy: Top → Bottom

All spacing + sizing via `tw` token map. Colours are exact hex light + dark.

### 1. Safe Area + Viewport

| Aspect | Value | Notes |
|--------|-------|-------|
| **Safe area insets** | Respect `useSafeAreaInsets()` (Expo) | iOS notch + Android system bar; top + bottom |
| **Horizontal padding** | `tw.space[4]` (16px) | Gutters; consistent with web |
| **Background** | Light: `tw.color.canvasLight` (#f0f2f7) · Dark: `tw.color.canvasDark` (#0f172a) | Full viewport bleed |
| **Bottom inset** | `tw.space[9]` (36px) above BottomNav | Replicates web pb-36 |

### 2. Header Section

```
┌─────────────────────────────────────────────────────┐
│ < Back                                              │
│ CARDS · THIS CYCLE                     [whisper]    │
│ 1 Jul – 31 Aug                         [muted sm]   │
└─────────────────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Section container** | `rise-in` anim | — | — | Stagger index 0 (web: `--rise-index: 0`) |
| **Back button** | — | — | — | Text: slate-500 · Dark: slate-400; gap 6px; 44px hit target |
| Back icon | `Chevron left` size 15 | — | — | lucide-react-native |
| Back label | `text-sm font-medium` | slate-500 | slate-400 | Tap feedback: active:opacity-70 active:scale-[0.98] |
| **Whisper label** | `text-[11px] font-semibold tracking-wide` | #94a3b8 | #64748b | UPPERCASE; upper line |
| **Period range** | `text-sm` | #94a3b8 | #64748b | Format: "1 Jul – 31 Aug" (no year) |
| **Vertical spacing** | mb: `tw.space[5]` between back + label; mt-3 for whisper to card | — | — | 20px + 12px gaps |

### 3. Movement Headline Hero Card

```
┌──────────────────────────────────────────────────────────┐
│ CARD MOVEMENT · 15 DAYS                  [whisper]       │
│                                                           │
│ ↓ £342                                   [text-3xl bold] │
│                                                           │
│ New spend £890 · Payments £548           [text-sm muted] │
│                                                           │
│ Your balances shrank by £342 — you put   [text-xs muted] │
│ on £890 and paid off £548.                               │
└──────────────────────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Container** | `.glass-hero` class equiv | `rgba(255,255,255,0.55)` blur 12px | `rgba(255,255,255,0.08)` blur 12px | Border: rgba(255,255,255,0.6 \| 0.08); radius `tw.radius["3xl"]` (24px); space-y-8 on parent container |
| **Padding** | `p-5` | 20px all sides | — | |
| **Whisper label** | Std whisper | — | — | "CARD MOVEMENT · {days_elapsed} DAYS" |
| **Verdict figure** | `text-3xl font-bold num tracking-tight` | | | △ £342 (emerald when delta ≤ -20), ↑ £X (slate when > 20), "Held steady" (slate) |
| Verdict colour | Emerald on ↓ | #10b981 (emerald-500) | #34d399 (emerald-400) | Paid down **[Note: emerald-500 = #10b981, NOT emerald-600; use emerald-500 for paid-down deltas across all screens for consistency]** |
| Verdict colour | Slate on ↑ | slate-900 | slate-100 | Balance grew (neutral) |
| **Breakdown line** | `text-sm num` | slate-500 | slate-400 | "New spend £890 · Payments £548" |
| **Clarification** | `text-xs leading-snug` | slate-500 | slate-400 | "Your balances shrank by £342…" (personalised narrative) |
| **Vertical spacing** | Space between label + verdict; verdict + breakdown; breakdown + clarify | `mt-2 mb-1`, `mt-3` | — | Tight vertical rhythm |
| **Margin top (section)** | space-y-8 on parent container | — | — | Sections do NOT each have mt-8; parent handles spacing |

### 4. WHERE IT MOVED (Per-Card Rows)

```
┌─────────────────────────────────────────────────────┐
│ WHERE IT MOVED                  [whisper label]     │
├─────────────────────────────────────────────────────┤
│ [NW badge]  NatWest Card Pay     +£124    [delta]   │
│                                  £2,450 owed        │
│             6.9% APR             [pill]             │
├─────────────────────────────────────────────────────┤
│ [AX badge]  Amex Rewards         −£89     [emerald] │
│                                  £890 owed          │
│             (no APR on file)                        │
└─────────────────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Container** | `.glass-card` equiv | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.06)` | Radius `tw.radius["2xl"]` (16px); mb `tw.space[8]` (32px) |
| **Padding** | p-0 (list rows handle it) | — | — | |
| **Row** | Flex row, px-4 py-3 | 16px h, 12px v | — | Border-bottom: hairline light (#f1f5f9) / dark (#334155 @ 60% opacity = divide-slate-700/60) |
| Last row | No bottom border | — | — | Use `divide-y` CSS |
| **Badge** | `BankBadge` component | w-9 h-9 rounded-xl | — | Reuse web logic; fallback to initials if logo fails |
| Logo | img | — | — | `object-contain`; bg-white p-0.5 ring-1; 36×36px |
| **Middle (flex-1)** | Name + pill stack | — | — | min-w-0 (truncation) |
| Name | `text-sm font-medium` | slate-700 | slate-200 | Truncate; card name |
| APR pill | `text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full` | bg-slate-100 text-slate-500 | bg-slate-700 text-slate-400 | Only if c.apr != null; "6.9% APR" |
| **Right (text-right flex-shrink-0)** | Delta + balance | — | — | min-width preserves number width |
| Delta (↑) | `text-sm font-semibold num` | slate-900 (or #000 if 0) | slate-100 | "+£124" (slate neutral) |
| Delta (↓) | `text-sm font-semibold num` | #10b981 emerald-600 | #34d399 emerald-400 | "−£89" (proper minus U+2212); emerald |
| Balance | `text-[11px] num` | slate-400 | slate-500 | "£2,450 owed" |
| **hideNetWorth** | Mask logic | "£••••" | — | If hideNetWorth pref is true, show £•••• instead of amounts |
| **Whisper label** | Std whisper, mt-3 relative to card | — | — | "WHERE IT MOVED" |
| Section spacing | Handled by parent space-y-8 | — | — | Do NOT add mt-8 to section; parent controls gaps |

### 5. WHAT DROVE IT (Category Breakdown)

```
┌─────────────────────────────────────────────────────┐
│ WHAT DROVE IT                   [whisper label]     │
├─────────────────────────────────────────────────────┤
│ [🟢 chip]  Groceries           £240    [category]   │
├─────────────────────────────────────────────────────┤
│ [🟠 chip]  Eating Out          £180    [category]   │
├─────────────────────────────────────────────────────┤
│ [🔵 chip]  Transport           £90     [category]   │
├─────────────────────────────────────────────────────┤
│ Pattern: You're buying more from convenience       │
│ stores in the first week of your cycle.  [insight] │
└─────────────────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|--------|-------|-------|------|-------|
| **Container** | `.glass-card` equiv | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.06)` | Radius 16px; mb 32px |
| **Row** | Flex row px-4 py-3 | 12px v + 16px h | — | divide-y hairline (light #f1f5f9 / dark #334155 @ 60% opacity) |
| **Category chip** | w-8 h-8 rounded-lg | — | — | Background: `${colour}26` (15% tint); inner dot 8px full colour |
| Chip colour | Eg. Groceries | #34d39926 (bg) · #34d399 (dot) | — | Use CATEGORY_COLOURS[d.category] |
| **Category name** | `text-sm font-medium` | slate-700 | slate-200 | Flex-1; truncate |
| **Total** | `text-sm font-semibold num` | slate-900 | slate-100 | "£240"; right-aligned |
| **Pattern insight** | Optional row at bottom | — | — | If pattern_line is set |
| Insight row | px-4 py-3 border-t | hairline | — | Border-top light: #f1f5f9 · dark: #334155 @ 60% opacity (divide-slate-700/60) |
| Insight text | `text-[13px] leading-snug` | slate-500 | slate-400 | "You're buying more from convenience stores…" |
| **Whisper label** | Std whisper, mt-3 relative to card | — | — | "WHAT DROVE IT" |
| Section spacing | Handled by parent space-y-8 | — | — | Do NOT add mt-8 to section; parent controls gaps |

### 6. THE TRAJECTORY (6-Cycle Bar Chart)

```
┌──────────────────────────────────────────┐
│ THE TRAJECTORY        [whisper label]    │
├──────────────────────────────────────────┤
│                                          │
│   █  █  █  █  █  █    [bars, 48px h]   │
│   █  █  █  █  █  █                      │
│   Jul Aug Sep Oct Nov Dec  [month labels]│
│                                          │
└──────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Container** | `.glass-card` equiv | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.06)` | Radius 16px; p-4; mb-safe (bottom inset) |
| **Chart area** | Flex row gap-2 h-12 | 48px height | — | Items-end alignment; flex-1 per bar |
| **Bar** | Flex column items-stretch flex-1 | — | — | Height computed; min 4px |
| Bar height formula | `maxAbsDelta === 0 ? 4 : Math.max(4, (48 * Math.abs(delta)) / maxAbsDelta)` | — | — | Guard against divide-by-zero when no movement; 4px minimum |
| Bar colour (↑) | `bg-slate-400` light | #94a3b8 | — | Balance grew = neutral slate |
| Bar colour (↑) | `dark:bg-slate-500` dark | — | #64748b | |
| Bar colour (↓) | `bg-emerald-500` | #10b981 | — | Balance shrank = emerald **[NOTE: emerald-500 = #10b981, NOT emerald-600 which is #059669]** |
| Bar radius | `rounded-t` | — | — | Top corners only |
| **Labels** | Flex row gap-2 mt-1 | — | — | 6 month names below bars |
| Label text | `text-[10px] text-center` | slate-400 | slate-500 | "Jul", "Aug", etc. (short month) |
| **Empty state** | When trajSlice.length === 0 | — | — | "No closed cycles yet." (text-sm muted) |
| **Whisper label** | Std whisper, mt-3 relative to card | — | — | "THE TRAJECTORY" |
| Section spacing | Handled by parent space-y-8 | — | — | Do NOT add mt-8 to section; parent controls gaps |

---

## States

### Loading State

Full-height skeleton; same layout as populated:

```
┌──────────────────────┐
│ [████] (32px)       │  ← Header skeleton
│                      │
│ ┌────────────────┐  │
│ │ ████ ████ ████ │  │  ← Hero skeleton (SkeletonCard)
│ └────────────────┘  │
│                      │
│ ┌────────────────┐  │
│ │ ████ ████ ████ │  │  ← More cards…
│ └────────────────┘  │
└──────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Container** | min-h-dvh pb-36 (safe area) | — | — | FlatList or ScrollView; parallax safe |
| **Skeleton card** | `.rounded-2xl .glass-card .animate-pulse` | — | — | 3 stacked; space-y-2 internally |
| Skeleton line | h-3 / h-6 w-[32/40]px | bg-slate-200 | bg-slate-700 | Tailwind defaults |

### Error State

Same as empty (no data returned, error flag, or status ≠ "ok"):

```
┌─────────────────────────────────────────┐
│ < Back                                  │
│                                         │
│ ┌─────────────────────────────────────┐│
│ │ Nothing to read yet                 ││
│ │                                     ││
│ │ Connect a credit card and check back││
│ │ after a few days of spending.       ││
│ └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

| Element | Token | Light | Dark | Notes |
|---------|-------|-------|------|-------|
| **Card** | `.rounded-2xl .glass-card` p-6 | — | — | Centred in viewport |
| **Title** | `text-base font-bold` | slate-900 | slate-100 | "Nothing to read yet" |
| **Body** | `text-sm leading-relaxed` | slate-500 | slate-400 | "Connect a credit card…" |

### Populated State (Nominal)

All sections rendered as per anatomy above.

| Condition | Behaviour |
|-----------|-----------|
| `story.status !== "ok"` | Show error card (see Error State) |
| `per_card.length === 0` | Hide "WHERE IT MOVED" section |
| `drivers.length === 0` | Hide "WHAT DROVE IT" section |
| `trajectory.length === 0` | Show "No closed cycles yet." in hero; no bars |
| `hideNetWorth === true` | Replace all currency with "£••••" |

---

## Interactions

### 1. Back Navigation

- **Trigger:** Tap "Back" button (top-left)
- **Action:** Call `goBack(router)` (or RN equiv: `navigation.goBack()`)
- **Visual:** `active:opacity-70 active:scale-95` press feedback
- **Accessibility:** 44px minimum touch target

### 2. (Future) Card Terms Sheet

**Not yet on this screen** but will be added:
- Tap APR pill or category badge → open bottom sheet
- Sheet height: ~60% viewport (draggable)
- Fields:
  - APR (editable percentage)
  - Credit limit (editable)
  - 0% promo end date (date picker)
  - Balance-transfer notice (free text)
  - Usage intent ("clear monthly" / "carry")
  - Minimum payment note (read-only info)
- Confirm button saves to backend; updates pill colour if terms confirmed

---

## Data & API

### Fetch Endpoint

```typescript
GET /cards/story?which=current
```

### Response Type: `CardsStory`

```typescript
{
  status: string;  // "ok" or other value (check !== "ok", not a narrow union)
  period: {
    start: string;           // ISO "YYYY-MM-DD"
    end: string;             // ISO "YYYY-MM-DD"
    days_elapsed: number;
  };
  movement: {
    delta: number;           // +ve: grew, -ve: shrank (pence)
    new_spend: number;       // Total new charges (pence)
    payments: number;        // Total paid down (pence)
  };
  per_card: [
    {
      account_id: string;
      name: string;          // "Natwest Card Pay" etc.
      provider: string;      // "natwest", "amex" etc.
      balance: number;       // Current owed (pence)
      delta: number;         // Change this cycle (pence)
      apr: number | null;    // Annual % rate, if known
    }
  ];
  drivers: [
    {
      category: string;      // "Groceries", "Eating Out" etc.
      total: number;         // Spend in this category (pence)
    }
  ];
  pattern_line: string | null;  // AI insight ("You're buying more…")
  trajectory: [
    {
      period_end: string;    // ISO "YYYY-MM-DD"
      delta: number;         // Balance change for that cycle (pence)
    }
  ];
}
```

### Transform Notes

- **Currency:** All amounts in pence; display as £X.XX or £X (rounded whole if web does)
- **Dates:** ISO parse → Intl.DateTimeFormat or date-fns
- **Categories:** Lookup `CATEGORY_COLOURS[category]` to get hex; tint at 15% for chip bg
- **Account brand:** Use `accountBrand(account)` logic from AccountMiniCard for badge styling

---

## Current Mobile State

**No native version exists.** This is a 1:1 port from web.

### To Build 1:1

1. **Screen component** at `mobile/app/(app)/cards/index.tsx`
   - Fetch `CardsStory` on mount
   - Manage loading/error/populated states
   - Render sections in order

2. **Subcomponents** (suggested structure):
   - `CardMovementHero` — movement verdict + breakdown
   - `CardRow` — per-card item (badge, name, apr pill, delta, balance)
   - `CategoryRow` — per-category item (chip, name, total)
   - `TrajectoryChart` — bar chart render

3. **Reusable components:**
   - `Whisper` — 11px uppercase muted label
   - `GlassCard` — container with glass surface treatment
   - `BankBadge` — logo or initials (port from web AccountMiniCard)

4. **Dependencies:**
   - `react-native-svg` for bar chart
   - `@react-navigation/native` for back nav
   - `expo-blur` for glass surface (optional; use conditional opacity + gradient fallback)

---

## React Native Porting Notes

### Glass Surface Treatment

**Web:** `.glass-hero`, `.glass-card` use `backdrop-filter: blur(12px)` on `rgba(255,255,255,0.55)`.

**RN equivalents:**

| Tier | Light | Dark | Pattern |
|------|-------|------|---------|
| **Hero** | `rgba(255,255,255,0.55)` blur 12px (via `expo-blur` or opacity fallback) | `rgba(255,255,255,0.08)` | Large section anchor cards |
| **Card** | Same as hero | Same | Standard panels |
| **Fallback** | `bg-white/60 opacity 0.6` | `bg-slate-800/60 opacity 0.6` | If no blur available |

Use `expo-blur` component if available; otherwise use semi-transparent solid with border.

### Date & Currency Formatting

```typescript
// Date: "YYYY-MM-DD" → "1 Jul"
new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

// Month short: "Jul"
new Date(iso).toLocaleDateString("en-GB", { month: "short" })

// Currency: pence → £X format
const fmtGBP = (n: number) => `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
```

### Bottom Sheet Modal

The Card Terms sheet (future) will use:
- `@react-native-modal/bottom-sheet` or `@gorhom/bottom-sheet`
- Height: ~60% viewport
- Draggable handle at top
- ScrollView inside for field list

### Icon Library

- Use `lucide-react-native` (same icons as web)
- Sizes: 15px (chevron), 11px (percent), 12px (pin), 10px (refresh)
- Colours: Inherit from text colour or explicit hex

### Color Contrast (Accessibility)

- All text on glass surfaces must maintain ≥4.5:1 WCAG AA contrast
- Slate-500 muted text on white/slate-100 bg = 4.4:1 ✓
- Use `tw.color` tokens directly; never compute colours at runtime

### Touch Targets & Press Feedback

- All interactive elements: minimum 44×44 pt
- Press feedback: `active:opacity-70` or `active:scale-[0.98]` (React Native: use `PressableOpacity` or `Animated`)
- Ripple effect (Android native) is optional; match iOS 44pt hit area

### Safe Area Insets

```typescript
import { useSafeAreaInsets } from "react-native-safe-area-context";

const insets = useSafeAreaInsets();
return (
  <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
    {/* content */}
  </View>
);
```

### Bar Chart Rendering

Use `react-native-svg` to draw bars:

```typescript
<Svg height={48} width="100%">
  {trajSlice.map((t, i) => {
    const barH = Math.max(4, (48 * Math.abs(t.delta)) / maxAbsDelta);
    const barColour = t.delta > 0 ? "#94a3b8" : "#10b981";
    return (
      <Rect
        key={i}
        x={i * (width / 6)}
        y={48 - barH}
        width={width / 6 - 8}
        height={barH}
        fill={barColour}
        rx={4}
      />
    );
  })}
</Svg>
```

### hideNetWorth Masking

Access from preferences context:

```typescript
const { hideNetWorth } = usePreferences();
const mask = (s: string) => hideNetWorth ? "£••••" : s;
```

Apply to all currency fields: balance, delta, totals.

---

## Open Questions & Risks

1. **Card Terms Sheet Integration**
   - When does the user access card-terms intake flow? Via "Add rates" button on card rows?
   - Confirm sheet height, field order, validation rules with Kevin before building.

2. **Trajectory Chart Rendering**
   - If viewport width varies, how do we scale bar width? Use `Dimensions.get('window').width`?
   - Test on small phones (iPhone SE, 375px) — bars may get cramped.

3. **Glass Surface Fallback**
   - `expo-blur` is not always available on all devices. Confirm fallback strategy:
     - Option A: Solid semi-transparent surface (current fallback)
     - Option B: Use `@react-native-community/blur-view`
     - Option C: Gradient overlay on white/dark card

4. **Pattern Insight Line Overflow**
   - Pattern text can be long; confirm max-width or line-clamp behaviour.
   - Web uses no clipping — RN may need explicit `numberOfLines` prop.

5. **Account Brand Logo Fetching**
   - Logo URLs are remote (Google Favicon, Finexer dynamic). How do we handle failures on poor network?
   - Confirm fallback to initials + timeout strategy.

6. **Performance: CardsStory on Slow Network**
   - Trajectory array can be up to 24 items; only last 6 rendered. Confirm pagination or memoization?
   - Pre-load on Home tab or defer until Cards tab focused?

7. **Verification State**
   - Card terms have a `status: "confirmed" | "skipped" | null` field. How does this affect the APR pill?
   - Should an unconfirmed card show "Add rates" instead of APR? Confirm with Kevin.

8. **Date Formatting Edge Cases**
   - If cycle spans year boundary (Dec 25 – Jan 10), how does date range render?
   - Test `fmtDate()` with dates in different years.

9. **Category Colour Customisation**
   - Users can override category colours (stored in preferences). Confirm whether Cards screen respects overrides.
   - If yes, fetch from ColourProvider + fallback to CATEGORY_COLOURS.

10. **Bottom Nav Sizing**
    - Web: `pb-36` for mobile, `pb-8` for desktop. RN: always mobile size or context-aware?
    - Confirm with Kevin; assume mobile-first for now.

---

## Implementation Checklist

- [ ] Create `mobile/app/(app)/cards/index.tsx`
- [ ] Import `CardsStory` type and `api.getCardsStory()`
- [ ] Render loading state (SkeletonCard × 3)
- [ ] Render error state ("Nothing to read yet")
- [ ] Parse ISO dates → locale format
- [ ] Format pence → £X currency
- [ ] Implement back nav with press feedback
- [ ] Render header (whisper label + period range)
- [ ] Build movement verdict hero (colour + sign logic)
- [ ] Build per-card rows (BankBadge + APR pill logic)
- [ ] Build category breakdown (chip bg tinting @ 15%)
- [ ] Build trajectory bar chart (SVG bars, height formula)
- [ ] Implement hideNetWorth masking on all currency
- [ ] Test on light + dark themes
- [ ] Verify touch targets ≥44pt
- [ ] Confirm glass surface rendering (or fallback)
- [ ] Integration test with real CardsStory data

