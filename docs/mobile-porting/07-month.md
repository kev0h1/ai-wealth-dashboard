# Screen: MONTH & MONTH STORY

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 0815264 2026-07-31 12:50:32 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/month/`
- **Apply diffs:** `git diff 5ad21c0..HEAD -- frontend/app/month/MonthPage.tsx frontend/app/month/story/StoryPlayer.tsx`

---

## Purpose & Emotional Job

**MONTH** is the monthly verdict screen — a comprehensive narrative recap of the pay cycle told in six chapters (Opening, Spending, Moves, Keeping, Close, Self). This is where "Calm Cockpit" sharpens into a story; the user learns not just numbers but *what happened to their money and how they behaved*.

**MONTH STORY** is the Instagram-stories player: a 5–6 frame swipeable recap in dark mode with progress bars, tappable navigation, and swipe gestures. It exists to give the user a mobile-friendly "glance moment" — the Close slide alone (month-end cash + streak) often tells the whole story in under 10 seconds.

Both screens sit behind open-banking data; no historical data here — every figure recalculates server-side each cycle. The narrative text is LLM-generated and personalised to the user's behaviour.

---

## Source Files (Web)

| File | Role |
|------|------|
| `frontend/app/month/MonthPage.tsx` | Main MONTH scroll; 6 chapters, narrative cards, controls |
| `frontend/app/month/story/StoryPlayer.tsx` | Full-screen dark STORY PLAYER; 5–6 slides, progress bars, gestures |
| `frontend/lib/api.ts` | Type definitions: `CycleStory`, `CycleStoryChapters`, `CycleStoryNarrative`, `CycleStoryTomorrow` |
| `frontend/components/SegmentedControl.tsx` | Tab control; "This cycle" ↔ "Last cycle" |
| `frontend/components/BottomNav.tsx` | Footer navigation (mobile-only; hidden on desktop) |
| `frontend/app/globals.css` | Animations: `.rise-in`, `.story-slide-in`, `.glass-card`, `.glass-sheet` |
| `frontend/lib/goBack.ts` | Router back-button utility |
| `frontend/lib/categories.ts` | `CATEGORY_COLOURS`: category → hex colour map (18 categories) |

---

## Layout Anatomy

### MONTH Page (Scroll View)

**Structure (top → bottom):**

```
┌─────────────────────────────────────────────┐
│  [← Back]  DEMO · persona (if present)      │ ← Rise-in (0ms)
│  YOUR MONTH (label)                         │
│  1 Jul – 31 Jul (period)                    │
│  ┌────────────────────────────────────────┐ │
│  │ This cycle  | Last cycle (seg control) │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │ ← Rise-in (50ms) [if preview]
│  │ HOW TOMORROW ARRIVES (label)           │ │
│  │ ┌──────────────────────────────────────┤ │
│  │ │ [🔔] Push notification mock         │ │
│  │ │      Title + body (2 lines)         │ │
│  │ ├──────────────────────────────────────┤ │
│  │ │ [✨] Brief companion mock           │ │
│  │ │      Headline + body (2 lines)      │ │
│  │ └──────────────────────────────────────┘ │
│  │ Purely illustrative — based on today…   │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │ ← Rise-in (100ms)
│  │ THE OPENING (label)                    │ │
│  │ Narrative paragraph (personalised)     │ │
│  ├────────────────────────────────────────┤ │
│  │ INCOME IN           DEPOSITS            │ │
│  │ £3,200    (num)     12       (num)     │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  [EARLY_DAYS gate: if story.early_days]    │ ← Rise-in (150ms)
│  ┌────────────────────────────────────────┐ │
│  │ EARLY DAYS (label)                     │ │
│  │ The story builds as the month happens… │ │
│  │ [Read last month ›] (link)             │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  [OR: 5 full chapters below (if NOT early)] │
│                                              │
│  CHAPTER 2: THE SPENDING ← Rise-in (150ms) │
│  ┌────────────────────────────────────────┐ │
│  │ Narrative + top 5 categories list      │ │
│  │ Cards intel (delta, switch day) + link │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  CHAPTER 3: THE MOVES ← Rise-in (200ms)   │
│  ┌────────────────────────────────────────┐ │
│  │ Narrative + 5 move types (if count > 0) │
│  └────────────────────────────────────────┘ │
│                                              │
│  CHAPTER 4: THE KEEPING ← Rise-in (250ms) │
│  ┌────────────────────────────────────────┐ │
│  │ Set aside / Drawn back / To investments │
│  └────────────────────────────────────────┘ │
│                                              │
│  CHAPTER 5: THE CLOSE ← Rise-in (300ms)   │
│  ┌────────────────────────────────────────┐ │
│  │ Month-end cash | Card movement | Streak │
│  └────────────────────────────────────────┘ │
│                                              │
│  CHAPTER 6: THE SELF ← Rise-in (350ms)    │
│  │ Narrative paragraph (personalised)     │
│  └────────────────────────────────────────┘ │
│                                              │
│  [BottomNav] (sticky, 5 tabs)               │
└─────────────────────────────────────────────┘
```

**Key Measurements (Web):**

| Element | Token | Value |
|---------|-------|-------|
| **Container max-width** | max-w-2xl | 672px |
| **Padding (x-axis)** | px-4 | 16px each side |
| **Section spacing** | space-y-8 | 32px between major blocks |
| **Card radius** | rounded-2xl | 16px |
| **Card padding** | p-4 | 16px |
| **Card grid cols** | grid-cols-2 sm:grid-cols-3 | 2-col mobile; 3-col desktop |
| **Grid gap** | gap-4 | 16px |

**Typography (Web):**

| Element | Class | Size | Weight | Colour (Light/Dark) |
|---------|-------|------|--------|---------------------|
| Section label ("YOUR MONTH") | Whisper | 11px | 600 | #94a3b8 / #64748b (slate-400/500) |
| Period range ("1 Jul – 31 Jul") | text-sm | 14px | 400 | #94a3b8 / #64748b (slate-400/500) |
| Chapter narrative | text-[15px] leading-relaxed | 15px | 400 | #495057 / #e2e8f0 (slate-700/slate-200) |
| Metric label ("INCOME IN") | Label | 10px | 600 | #94a3b8 / #64748b (slate-400/500) +0.05em |
| Metric value (money) | text-base font-semibold | 16px | 600 | #0f172a / #f1f5f9 (ink / paper-ink) |
| Category row label | text-sm font-medium | 14px | 500 | #495057 / #e2e8f0 (slate-700/200) |
| Category row value | text-sm font-semibold | 14px | 600 | #0f172a / #f1f5f9 (ink / paper-ink) |

**Cards (Glass):**

- **Background (light/dark):** `#ffffff` / `#1e293b` (white / slate-800)
- **Border (light/dark):** `#f1f5f9` / `#334155` (hairline, always present in dark, shadow-replaced in light)
- **Shadow (light only):** 0 1px 2px rgba(0,0,0,0.05) (shadow-sm)

**Dividers within cards:**

- **Light:** `border-slate-100` (#f1f5f9)
- **Dark:** `border-slate-700/60` (rgb(51, 65, 85) @ 60% = #334155 @ 60%)

**Interactive buttons:**

- **"Play your month" button (light/dark):** `glass-card` (white/slate-800) with rounded-full, px-4 py-2, text-sm font-semibold, active:scale-95
- **"Read last month" / "The cards chapter" links:** text-indigo-600 (dark: text-indigo-400), active:opacity-70

---

### MONTH STORY Player (Full-Screen Dark Immersive)

**Structure:**

```
Fixed full-screen overlay (position: fixed, inset 0, z-50, h-dvh, bg-[#0f172a])

┌─────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────┐ │ ← Progress bars (z-30)
│ │ [████░░░░░░░░░░░░] 1/6 slides               │ │   6 segments, h-[3px], rounded-full
│ │ gap-1.5 px-4 mb-3                           │ │   filled: rgba(255,255,255,0.90)
│ │                                             │ │   unfilled: rgba(255,255,255,0.25)
│ │                             [✕] (close X)  │ │
│ └─────────────────────────────────────────────┘ │
│                                                   │
│ ┌─────────────────────────────────────────────┐ │ ← Left tap zone (z-10, 50% width)
│ │                   SLIDE CONTENT               │ │
│ │              (animated in place)              │ │
│ │                                             │ │
│ │ [key={index}]                              │ │
│ │ .story-slide-in (200ms ease-out)           │ │
│ │ max-w-md mx-auto w-full px-6               │ │
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │ ← Right tap zone (z-10, 50% width)
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
│                                                   │
│ ┌─ Ambient glow (aria-hidden, z-0) ─────────┐  │
│ │ Radial gradients (indigo + violet)         │  │
│ │ top-[4vh] h-[560px] w-[135vw] max-w-[780] │  │
│ │ backdrop blur effect                       │  │
│ └─────────────────────────────────────────────┘  │
│                                                   │
│ <TouchStart + TouchEnd handlers>                 │
│ dx < 0 → advance | dx > 0 → rewind              │
└─────────────────────────────────────────────────┘
```

**Background (Ambient Glow):**

Two layered radial gradients:

1. **Top glow (indigo):** `radial-gradient(ellipse 50% 44% at 50% 42%, rgba(99,102,241,0.32), rgba(99,102,241,0.16) 45%, transparent 72%)`
   - Color: #6366f1 (indigo-500)
   - Outer alpha: 0.16 (16%)

2. **Bottom glow (violet):** `radial-gradient(ellipse 52% 54% at 50% 58%, rgba(139,92,246,0.13), rgba(139,92,246,0.065) 45%, transparent 70%)`
   - Color: #8b5cf6 (violet-500)
   - Outer alpha: 0.065 (6.5%)

---

### Slide Types & Layouts

Each slide is a self-contained card within `max-w-md mx-auto w-full px-6`:

#### 1. **Title Slide**

```
[DEMO · persona badge] (if present, violet tint)
YOUR MONTH (label, 11px slate-400)
Your month, closed. (h1, 30px font-bold slate-100)
1 Jul – 31 Jul (text-sm slate-400)
```

- **Dark-mode variant:** All text `text-slate-100` / `text-slate-400`, badge `bg-violet-500/10 border-violet-500/30 text-violet-300`

#### 2. **Spending Slide**

```
YOUR SPENDING (label)
£5,847 (<p>, 48px font-bold, num class, slate-100)
You spent £5,847 this cycle. (text-[15px] leading-relaxed slate-300)
£3,200 came in. (text-sm slate-400, conditional)
```

#### 3. **Where It Went Slide**

```
WHERE IT WENT (label)
┌─────────────────────────┐
│ [●] Groceries  £1,204   │ ← Category colour tint chip (${colour}26)
│ [●] Eating Out   £456   │   + full-strength icon dot
│ [●] Transport    £203   │   Full category name + amount (num class)
│ [●] Entertainment £156  │
│ [●] Bills        £384   │
└─────────────────────────┘
Nearly half of it went in the first week. (conditional, text-sm slate-400)
```

- **Category chip:** 36px square, 8px radius, category colour at 15% alpha background, 8×8px dot at full colour
- **Row layout:** flex gap-3, category label flex-1 left, amount right

#### 4. **Cards Slide**

```
YOUR CARDS (label)
£1,240 of it rode on your cards. (text-2xl font-bold slate-100)
Balances closed £567 lower. (text-[15px] leading-relaxed, emerald-400 if delta < 0)
Your cards took over from cash on 15 Jul. (text-sm slate-400, conditional)
```

#### 5. **Win Slide** (Conditional)

Three variants; show the first true fact:

**A) Streak ≥ 4 weeks:**
```
✦ 8 weeks of saving, unbroken. (2xl font-bold slate-100; ✦ in amber-300 #fcd34d)
Still going. That habit is yours. (text-[15px] slate-300)
```

**B) Kept > 0:**
```
✦ You kept £423 of what you set aside. (2xl font-bold slate-100; ✦ in amber-300 #fcd34d)
Set aside £600, drew back £177 — the rest stayed put. (text-[15px] slate-300)
```

**C) Deliberate saves > 0:**
```
✦ 5 deliberate transfers to savings. (2xl font-bold slate-100; ✦ in amber-300 #fcd34d)
You moved £1,240 on purpose. (text-[15px] slate-300)
```

#### 6. **Close Slide**

```
THE CLOSE (label)
You reached payday with £2,156 in your current accounts. (2xl font-bold slate-100)
[Optional narrative text from story.narrative.self] (text-[15px] slate-300)
[Read the full story ›] (button: routes to /month?which=last for non-persona/non-preview; bg-white/10 border-white/15 rounded-xl px-5 py-3, text-sm font-semibold white, active:scale-95)
```

**All slides:**

- **Flex layout:** `flex flex-col justify-center min-h-0` (vertical centering, safe for all screen heights)
- **Animation:** `.story-slide-in` on key change (fade + translateX in 200ms ease-out)
- **Text alignment:** Left-aligned, except numbers (monospace `num` class)

---

## States

### MONTH Page

**1. Loading**

- 3–4 skeleton cards (rounded-2xl glass-card p-4, animate-pulse)
- Space-y-4 layout
- BottomNav present

**2. Error / No Data**

- Glass card: "Nothing to tell yet" (slate-500/dark:slate-400)
- Subtext: "Come back once a few days of the cycle have passed." (slate-400/dark:slate-500, text-xs)
- SegmentedControl + "Read last month" link always shown

**3. Populated (Full Render)**

- 6 chapters shown OR 1 "Early days" card + "Read last month" link (if `story.early_days === true`)
- All interactive elements enabled (links, button clicks)
- Scroll-to-bottom enabled (BottomNav follows)

**4. Preview Mode** (when `preview=1` and NOT `persona`)

- Amber badge: "PREVIEW · your month closes tonight"
- Extra "HOW TOMORROW ARRIVES" section + demo persona links (if present)
- All Whisper labels, full narrative, all chapters

**5. Demo/Persona Mode** (when `persona` param set)

- Violet badge: "DEMO · ${persona}" (e.g., "DEMO · comfortable")
- SegmentedControl hidden (no "Last cycle" in demo mode)
- Cycle toggle **forced to "current"**
- Full chapter render (not early-days gated)

### MONTH STORY Player

**1. Loading**

- Fixed overlay, dark bg #0f172a
- Center text: "Reading your month…" (text-sm slate-400, animate-pulse)

**2. Error / No Data**

- Fixed overlay, dark bg #0f172a
- Centered: "Nothing to tell yet" (text-lg slate-300)
- [✕] Close button below

**3. Early Days (Current Cycle Only)**

- Auto-redirect to `/month` (no story player rendered)

**4. Slides Rendered (1–6 slides)**

- Progress bars at top (filled/unfilled segments)
- Current slide in viewport center
- Tap zones left/right (50% width each, z-10)
- Close button (✕, top-right, p-2)

**5. Slide Transitions**

- Key prop on slide container triggers `.story-slide-in` animation (fade + translateX)
- Previous slide unmounts, new slide mounts in 200ms ease-out

---

## Interactions

### MONTH Page

| Action | Trigger | Response |
|--------|---------|----------|
| **Back** | Click [← Back] button | `goBack(router)` (or navigate to /) |
| **Switch cycle** | Click "This cycle" / "Last cycle" in SegmentedControl | `setWhich(value)`, re-fetch if not cached |
| **Open story** | Click [Play your month] button | Navigate to `/month/story?which=last` (or `?preview=1` / `?persona=...`) |
| **Open cards chapter** | Click [The cards chapter ›] link | Navigate to `/cards` |
| **Read last month** | Click [Read last month ›] link | `setWhich("last")`, scroll to top, re-fetch |
| **Category row click** | (No action on web; TBD for mobile) | — |
| **Scroll** | User scrolls down | BottomNav stays sticky at bottom (pb-36 lg:pb-8 for padding) |

### MONTH STORY Player

| Action | Trigger | Response |
|--------|---------|----------|
| **Tap right half** | Click/tap right 50% of screen | `setIndex(i + 1)` (clamped to max) |
| **Tap left half** | Click/tap left 50% of screen | `setIndex(i - 1)` (clamped to 0) |
| **Swipe left** | Swipe from right (dx < −48px, horizontal) | `advance()` (go forward one slide) |
| **Swipe right** | Swipe from left (dx > 48px, horizontal) | `rewind()` (go back one slide) |
| **Swipe down** | (Not implemented on web) | — |
| **Close** | Click [✕] button (top-right) | Navigate back to `/month` / `/month?preview=1` / `/month?persona=...` |
| **Progress bar click** | (No direct click; visual indicator only) | — |

**Touch handling:**

```typescript
const touchStartRef = useRef<{ x: number; y: number } | null>(null);

handleTouchStart: record { x, y }
handleTouchEnd: 
  dx = changedTouches[0].clientX - touchStartRef.x
  dy = changedTouches[0].clientY - touchStartRef.y
  if (|dx| > 48 && |dx| > |dy|) {
    if (dx < 0) advance() else rewind()
  }
```

**Keyboard navigation (future):** Not implemented on web; mobile should support arrow keys.

---

## Data & API

### Endpoints (via `frontend/lib/api.ts`)

**GET `/cycle/story`** (via `api.getCycleStory(which, preview?, persona?)` with params `?which=...&preview_close=1`)

```typescript
interface CycleStory {
  status: "ok" | "no_data";
  early_days?: boolean;
  period?: CycleStoryPeriod;
  chapters?: CycleStoryChapters;
  narrative?: CycleStoryNarrative;
  cards_link?: boolean;
  tomorrow?: CycleStoryTomorrow;
  is_preview?: boolean;
  persona?: string;
  is_demo?: boolean;
}

interface CycleStoryPeriod {
  start: string;              // "YYYY-MM-DD"
  end: string;                // "YYYY-MM-DD"
  closed: boolean;            // Is the cycle fully closed?
  days_elapsed: number;       // Days since period.start
  days_to_payday: number;     // Days until payday (if open)
}

interface CycleStoryChapters {
  opening: { income_in: number; count: number };
  cliff: { week1_spend: number; period_spend: number; week1_pct: number; commitments: Array } | null;
  switch?: { week1_card_pct: number; rest_card_pct: number; switch_day: string | null };
  spending?: {
    total_spend: number;
    income_in: number;
    top_categories: Array<{ category: string; total: number }>;
  };
  cards?: {
    present: boolean;
    material: boolean;        // Relevant to the story?
    new_spend: number;        // Amount spent on cards
    payments: number;         // Card payments made
    delta: number;            // Balance change (positive = up, negative = down)
    share_of_spend: number;   // Cards as % of total spend
  };
  moves: Record<"ritual_saving" | "deliberate_saving" | "card_feeding" | "buffer_draws" | "other_shuffles", { count: number; total: number }>;
  keeping: { set_aside: number; drawn_back: number; external: number; kept: number };
  close: { month_end_cash: number; card_delta: number; streak_weeks: number | null } | null;
  self_facts: { traits: Array; fired: Record<string, boolean> };
}

interface CycleStoryNarrative {
  opening: string;            // LLM narrative: opening chapter
  month: string;              // LLM narrative: spending chapter
  moves: string;              // LLM narrative: moves chapter
  keeping: string;            // LLM narrative: keeping chapter
  close: string;              // LLM narrative: close chapter
  self: string;               // LLM narrative: self chapter (personalised trait reflection)
  source: string;             // e.g., "backend-narrative-engine-v2"
}

interface CycleStoryTomorrow {
  push_title: string;         // Push notification title (illustrative)
  push_body: string;          // Push notification body
  brief_headline: string;     // Brief (Penny) headline
  brief_body: string;         // Brief body
}
```

**Key fields consumed by the screens:**

| Field | MONTH | STORY |
|-------|-------|-------|
| `status` | ✓ | ✓ |
| `early_days` | ✓ (gates chapters 2–6) | ✓ (redirect if true) |
| `period` | ✓ (date range) | ✓ (title slide) |
| `chapters.opening` | ✓ | — |
| `chapters.spending` | ✓ | ✓ (slide 2 & 3) |
| `chapters.cards` | ✓ | ✓ (slide 4) |
| `chapters.moves` | ✓ | — |
| `chapters.keeping` | ✓ | ✓ (win condition) |
| `chapters.close` | ✓ | ✓ (slide 6) |
| `narrative.*` | ✓ (all chapters) | ✓ (self only) |
| `tomorrow.*` | ✓ (preview mode) | — |
| `persona` | ✓ (demo badge) | ✓ (persist to close button) |
| `is_preview` | ✓ (preview badge) | ✓ (persist to close button) |

---

## Current Mobile State

**NO NATIVE VERSION EXISTS.** Everything below must be built 1:1.

### What to Build

1. **MONTH screen** (scroll view)
   - Header: back button, persona/preview badges, "YOUR MONTH" label, period, SegmentedControl
   - HOW TOMORROW ARRIVES section (if preview)
   - 6 chapters OR "Early days" gate:
     - THE OPENING: narrative + income/deposits card
     - THE SPENDING: narrative + top 5 categories + cards intel
     - THE MOVES: narrative + 5 move types (if count > 0)
     - THE KEEPING: narrative + set aside/drawn back/external
     - THE CLOSE: narrative + month-end cash / card movement / streak
     - THE SELF: narrative paragraph
   - BottomNav (sticky)

2. **MONTH STORY screen** (full-screen overlay)
   - Progress bars (top, 6 segments)
   - Close button (top-right)
   - Slide content (centered, padded)
   - Ambient gradient glow (behind slides)
   - Tap zones (left/right)
   - Swipe gesture detection (dx > 48px)
   - 5–6 slide types (Title, Spending, Where It Went, Cards, Win, Close)
   - Slide transitions (fade + horizontal slide, 200ms)

3. **Shared Components**
   - "Whisper" label (11px, 600 weight, muted, all-caps, tracking-wide)
   - Glass card (rounded-2xl, padding, border, light/dark)
   - Segmented control (2 options: "This cycle" / "Last cycle")
   - "Play your month" button (glass-card, rounded-full, icon + text)
   - "Read the full story" button (Close slide, white/10 glass, border white/15)
   - Category chip (circle dot, tint background, row layout)
   - Monetary formatter (£X,XXX, with masking support for `hideNetWorth` preference)

---

## React Native Porting Notes

### Animation & Gestures

**Progress bars (Story):**
- Use `FlatList` or `ScrollView` horizontal for the 6 segments
- Each segment: `height: 3px`, flex: 1, borderRadius: 4
- Conditional backgroundColor: index <= currentIndex ? `rgba(255,255,255,0.9)` : `rgba(255,255,255,0.25)`

**Slide transitions:**
- Use `Animated.FadeIn` + `Animated.SlideInFromRight` (entering) or `Animated.SlideOutToLeft` (exiting)
- Duration: 200ms
- Config: `useNativeDriver: true` for performance

**Swipe gesture:**
- Use `react-native-gesture-handler` `PanGestureHandler`
- On `onGestureEvent`, track `translationX`; threshold `|translationX| > 48`
- Trigger `advance()` / `rewind()` in `onHandlerStateChange`
- Or: simpler `onTouchStart` / `onTouchEnd` (same as web logic, map to RN coordinates)

**Tap zones (left/right):**
- Two overlays: `<Pressable>` at left 50%, right 50%, full height
- `onPress` → `rewind()` / `advance()`

### Chart & Category Visualization

**Category chips (Where It Went slide):**
- Square view (36×36 dp), borderRadius: 8 dp
- Background: category colour at 15% alpha (use `hexToRgba(colour, 0.15)`)
- Inner dot: 8×8 dp circle, full-strength colour, centered
- Row layout: `flexDirection: "row"`, gap: 12 dp, align items center

**Top 5 categories list:**
- FlatList or ScrollView (if scrollable needed)
- Each row: category name (flex: 1, left) + amount (right)
- Dividers: 1px hairline between rows

### Dark Mode & Gradients

**Background (Story Player):**
- Base: `#0f172a` (canvasDark)
- Gradient: Use `expo-linear-gradient` for ambient glow
  - Gradient 1: `radial-gradient(ellipse 50% 44% at 50% 42%, rgba(99,102,241,0.32), rgba(99,102,241,0.16) 45%, transparent 72%)`
  - Gradient 2: `radial-gradient(ellipse 52% 54% at 50% 58%, rgba(139,92,246,0.13), rgba(139,92,246,0.065) 45%, transparent 70%)`
  - RN workaround: Use `LinearGradient` from `expo-linear-gradient` with `start: { x: 0.5, y: 0.42 }` and layer 2 overlays; or pre-render as image asset.

**Light/Dark text:**
- Use `useColorScheme()` hook
- Light mode: slate-900 text (#0f172a), slate-50/100 backgrounds
- Dark mode: slate-100 text (#f1f5f9), slate-800/900 backgrounds

**Category colours:**
- Import from `mobile/lib/categories.ts` (or port from `frontend/lib/categories.ts`)
- Use `colours[category] ?? CATEGORY_COLOURS[category]` (allow user overrides)

### Currency Formatting & Net Worth Masking

**Formatter:**
```typescript
const fmt = (n: number) => {
  if (hideNetWorth) return "£••••";
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
};
```

Use native `Intl.NumberFormat("en-GB", { ... })` for platform-consistent formatting.

**Mask amounts in narrative:**
```typescript
function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}
```

Apply to narrative text when `hideNetWorth === true`.

### Date Formatting

```typescript
function fmtDate(iso: string): string {
  // "2026-07-15" → "15 Jul"
  return new Date(iso).toLocaleDateString("en-GB", { 
    day: "numeric", 
    month: "short" 
  });
}
```

### Modal / Sheet Navigation

**Story Player (full-screen overlay):**
- Modal stack: `expo-router` `<Stack.Screen options={{ presentation: "modal", animation: "slide_from_bottom" }}>` or simpler full-screen replace navigation
- On close: `router.back()` or conditional nav based on `persona` / `preview` params

**Slide Content:**
- ScrollView with `scrollEnabled={false}` (tap zones + swipe handle all nav)
- Or: FlatList in horizontal mode with `scrollEnabled={false}`, managed index changes

### Token Mapping (mobile/lib/tw.ts)

Use the canonical token file:

```typescript
tw.text["11"]  // 11px label → { fontSize: 11, lineHeight: 16 }
tw.text["2xl"] // 24px → { fontSize: 24, lineHeight: 32 }
tw.text["3xl"] // 30px → { fontSize: 30, lineHeight: 36 }
tw.weight.bold      // 700
tw.weight.semibold  // 600
tw.space[4]         // 16px (p-4, gap-4)
tw.space[5]         // 20px (p-5)
tw.space[6]         // 24px (p-6)
tw.radius["2xl"]    // 16px (rounded-2xl)
tw.radius["3xl"]    // 24px (rounded-3xl)
tw.radius.full      // 9999 (rounded-full)
tw.color.slate50    // #f8fafc
tw.color.slate100   // #f1f5f9
tw.color.slate400   // #94a3b8
tw.color.slate700   // #334155
tw.color.slate100   // #f1f5f9
tw.color.slate200   // #e2e8f0
tw.color.slate300   // #cbd5e1
tw.color.indigo600  // #4f46e5 (Adviser Indigo, primary)
tw.color.violet600  // #7c3aed (Penny Violet, gradient)
tw.color.emerald600 // #059669 (Verified Emerald)
tw.color.amber300   // #fcd34d (Win slide ✦)
tw.color.white      // #ffffff
tw.color.canvasDark // #0f172a (Story Player bg)
tw.color.cardDark   // #1e293b (dark card surface)
```

---

## Open Questions & Risks

### Design Fidelity

1. **Ambient glow on Story Player:** The web uses CSS `radial-gradient()` overlays. RN has no native equivalent; need to either:
   - Pre-render as PNG/SVG background images
   - Use `expo-linear-gradient` with creative layering (limited; no ellipse support)
   - Generate dynamically at each scale (CPU overhead)
   - **Decision pending:** Simplify to solid canvas + subtle overlay gradient, or invest in shader-based approach?

2. **Keyboard navigation:** Web uses tab/arrow keys within SegmentedControl. Mobile should support arrow keys (if keyboard present) but may not be critical for MVP.

3. **Swipe-to-close Story Player:** Web has no swipe-down gesture; mobile should add `PanGestureHandler` with vertical threshold (e.g., 60dp down = close). **Risk:** Conflict with vertical scroll inside slide content (if added later).

### Data & State

4. **Category overrides:** Web allows users to override category colours via `useColours()` hook. Mobile must respect the same overrides from the preferences API.

5. **Early-days gate:** Current logic: if `early_days === true` on current cycle, show placeholder on MONTH page; if user navigates to STORY on early-days current cycle, redirect to MONTH. **Risk:** Edge case where "last" cycle is also early-days (very new user) — story should handle gracefully.

6. **Persona mode:** Demo personas (comfortable, breakeven, partial) must persist through navigation (story → full story back link). Use URL params consistently: `?persona=${persona}`.

7. **Preview mode:** Should only appear on current cycle when `is_preview === true` (cycle closes tonight). **Risk:** Stale data if user keeps app open past midnight.

### Mobile-Specific Risks

8. **Safe area insets:** Story Player progress bars should respect `safeAreaInsets.top`. Padding: `paddingTop: Platform.select({ ios: safeAreaInsets.top + 12, android: 12 })`.

9. **Bottom sheet vs full-screen modal:** Current web is full-screen (`position: fixed`). Mobile native impulse might be to use bottom sheet (like settings modals). **Decision:** Stay full-screen to match web 1:1; sheets are for embedded actions only.

10. **Gesture conflicts:** If slides become scrollable (to show full narrative), horizontal swipe + vertical scroll must not conflict. Use `simultaneousHandlers` / event prioritization in `react-native-gesture-handler`.

11. **Memory & re-renders:** Story slides with heavy text (narratives) + gradients may cause frame drops on low-end devices. Consider memoization (`React.memo(SlideComponent)`) and lazy loading if slides grow.

### Accessibility

12. **Screen reader labels:** Every interactive element (tap zones, progress bars, close button) needs `accessible={true}` + `accessibilityLabel`. Progress bars should announce "Slide N of M" on focus.

13. **Masking net worth:** The `hideNetWorth` toggle should apply consistently to all narratives, chapter values, and money figures — **no unmask leaks**.

14. **Colour contrast:** Dark-mode slide text (slate-100) on #0f172a canvas meets WCAG AA (6.5:1+); category chip dots should be tested for colour-blind readability (18 hues must remain distinguishable).

### Testing

15. **Offline resilience:** API fetch failure should show error state ("Nothing to tell yet"). Cached data (from last successful fetch) might be shown instead — **confirm caching strategy** (React Query / SWR / localStorage).

16. **Demo personas:** Test all three (comfortable, breakeven, partial) for narrative quality and data integrity.

17. **Landscape mode:** Story Player on landscape might have odd aspect ratios. **Decision:** Lock to portrait or handle responsive breakpoints for wide screens (similar to web `sm:`).

---

## Implementation Checklist

- [ ] Create MONTH screen (scroll view, 6 chapters)
- [ ] Create MONTH STORY screen (modal/full-screen)
- [ ] Implement SegmentedControl (mobile version, NativeWind styled)
- [ ] Implement "Whisper" label component
- [ ] Implement glass-card component (dark mode default)
- [ ] Implement category chip row (icon + tint + amount)
- [ ] Implement progress bars (6 segments, filled/unfilled)
- [ ] Implement slide components (Title, Spending, WhereItWent, Cards, Win, Close)
- [ ] Implement swipe gesture (48px threshold)
- [ ] Implement monetary formatter + masking
- [ ] Integrate API fetch (getCycleStory)
- [ ] Handle early-days gate + redirect
- [ ] Handle persona/preview mode navigation
- [ ] Test light/dark mode (prefer dark on Story Player)
- [ ] Test accessibility (labels, contrast, screen readers)
- [ ] Performance audit (gradients, re-renders, lazy load slides)

---

