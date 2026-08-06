# Foundation: Design System & Shell

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to shell/design source:** da88880 2026-08-05 18:38:02 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/layout.tsx frontend/components/BottomNav.tsx frontend/components/Sidebar.tsx DESIGN.md`
- **Apply diffs:** `git diff 5ad21c0..HEAD -- <paths>`

---

## Design Tokens

### Neutral Palette (Slate)

| Role | Light | Dark | Notes |
|------|-------|------|-------|
| **Canvas** | #f0f2f7 | #0f172a | Page background; mist-to-midnight |
| **Card Surface** | #ffffff | #1e293b | White to slate-800 card bodies |
| **Border / Hairline** | #f1f5f9 | #334155 | Separators; shadows replaced by borders in dark |
| **Ink / Text** | #0f172a | #f1f5f9 | Primary text; slate-900 to slate-100 |
| **Muted / Secondary** | #94a3b8 | #94a3b8 | Labels, icons at rest; slate-400 (unchanged) |
| **Muted Deep** | #64748b | #64748b | Secondary text body; slate-500 (unchanged) |

### Brand & Status Colours

| Token | Hex | Role |
|-------|-----|------|
| **Primary / Adviser Indigo** | #4f46e5 | Brand, active nav, buttons, links, active spend line |
| **Penny Violet** | #7c3aed | Gradient end (indigo→violet 135°); AI adviser only |
| **Verified Emerald** | #10b981 | Income, under-budget, verified, "connected" |
| **Watch Amber** | #f59e0b | Pace warnings, target line, "due tomorrow" |
| **Risk Red** | #ef4444 | Genuine liability only; over-budget, at-risk bills, debt |
| **Rose** | #fb7185 | Bills category; rose-500 badge on planning tab |

### Category Palette

All 18 categories sit at Tailwind 400-row saturation (one tonal family):

| Category | Hex | Hue |
|----------|-----|-----|
| Groceries | #34d399 | Emerald (food) |
| Eating Out | #fb923c | Orange (warm food) |
| Transport | #60a5fa | Blue (movement) |
| Entertainment | #c084fc | Purple (fun) |
| Shopping | #f472b6 | Pink (retail) |
| Bills | #fb7185 | Rose (recurring) |
| Subscriptions | #22d3ee | Cyan (digital) |
| Health | #2dd4bf | Teal (medical) |
| Beauty | #e879f9 | Fuchsia (personal care) |
| Travel | #818cf8 | Indigo (far) |
| Software | #a3e635 | Lime (tech) |
| Savings | #fbbf24 | Amber (wealth) |
| Debt | #f87171 | Red (liability) |
| Transfer | #cbd5e1 | Slate (neutral) |
| Income | #4ade80 | Green (positive cash in) |
| Cash | #facc15 | Yellow (physical) |
| Charity | #f9a8d4 | Soft pink (giving) |
| Other | #94a3b8 | Slate (misc) |

**Key Named Rule: The Category Voice Rule.** A category's colour appears as a ~15% tinted chip background (`${colour}26` hex) with the icon at full strength, as bar/dot accents, and in charts — never as a flooded surface or full-bleed background.

### Radii (border-radius)

| Token | px | Usage |
|-------|----|----|
| Chip | 8 | Category badges |
| Control | 12 | Buttons, inputs, basic controls |
| Card | 16 | Standard card & container surfaces |
| Hero | 24 | Page-header hero cards, bottom sheets (top radius) |
| Pill | 9999 | Fully rounded; nav active state pills |

**Numeric unit conversion rule:** Tailwind spacing/width/height units = value × 4px. Example: w-9 = 36px, h-1.5 = 6px, h-1 = 4px.

### Spacing Scale

Tailwind units × 4px:

| Token | px | Tailwind |
|-------|----|----|
| xs | 4 | 1 |
| sm | 8 | 2 |
| md | 12 | 3 |
| lg | 16 | 4 |
| xl | 20 | 5 |
| 2xl | 24 | 6 |
| 3xl | 28 | 7 |
| 4xl | 32 | 8 |

### Typography

System fonts only (SF Pro / Segoe UI / Roboto). Hierarchy by weight + size + colour.

| Level | Weight | Size | Line-Height | Notes |
|-------|--------|------|-------------|-------|
| Display | 700 | 30px | 1.2 | −0.025em letter-spacing; hero figure (net worth, total debt) |
| Headline | 700 | 20px | 1.3 | Page titles, account names |
| Card/Section Title | 700 | 16px | 1.4 | Card headers, section titles (e.g. Savings/Tax tab content) |
| Title | 600 | 14px | 1.4 | Row primaries, button labels |
| Body | 400–500 | 13–14px | 1.5 | Descriptions, chat, copy |
| Label | 600 | 10–11px | 1.3 | +0.05em (tracking-wide); section markers ("PAY PERIOD"), captions; always muted (#94a3b8) |

**Key Named Rule: The Numbers Lead Rule.** Money figure is visually heaviest; label sits above/beside in whisper style. If label outweighs number, hierarchy is wrong.

### Shadows & Elevation

**Light mode:** One soft ambient shadow only (`shadow-sm`: 0 1px 2px rgba(0,0,0,0.05)).  
**Dark mode:** No shadows; separate with tone (#1e293b on #0f172a) and hairline borders.  
**Floating elements** (FAB, toasts): May use one larger soft shadow (`shadow-xl`).

**Key Named Rule: The One Shadow Rule.** Resting cards get `shadow-sm` or nothing. If a design needs heavier shadow, fix tone contrast instead.

### Liquid Glass (Web Only)

Four tiers in `frontend/app/globals.css`:
- `.glass-hero`: Screen anchor, backdrop-filter blur
- `.glass-card`: Standard panel
- `.glass-tile`: Nested stat (translucent fill only)
- `.glass-sheet`: Bottom sheets/modals (solid, no blur)

Page layer blurs when sheet opens (`#app-shell.sheet-open`). Sheets themselves are SOLID (white in light mode / **#0f172a** in dark mode) with top hairline. Native OS pickers never appear; lists render as in-sheet rows.

---

## Global Chrome & Navigation

### Web Navigation Model

**Mobile:** Fixed bottom bar, five icon+label tabs (10px labels, exactly). Active item in Adviser Indigo with soft indigo-50 pill background. Respects `env(safe-area-inset-bottom)`.

**Desktop (≥1024px):** Fixed 256px left sidebar, white/slate-900, icon+label rows. Active state: indigo-50 pill + trailing indigo dot (6×6px circle, w-1.5 h-1.5).

**Tabs (both web & mobile):**
1. **Home** (icon: Home)
2. **Spend** (icon: PieChart)
3. **Planning** (icon: CalendarClock) ← **MOBILE CURRENT: "Budget" with Target icon — NEEDS RENAME**
4. **Insights** (icon: Lightbulb)
5. **Settings** (icon: Settings)

**Badges:**
- Insights: violet-500 (#8b5cf6) circular badge with count (new insights)
- Planning: rose-500 (#f43f5e) circular badge with count (at-risk bills)

**Pill Animation:** Nav-pill-in, smooth scale/opacity on active transition (180ms cubic-bezier(0.23, 1, 0.32, 1)). This is distinct from the bottom-sheet slide-up animation (280ms cubic-bezier(0.32, 0.72, 0, 1); see globals.css:89).

### Desktop-Only Sidebar Chrome

- **Logo area:** 36×36px (w-9 h-9) indigo-600 rounded box with white Wallet icon (18px), label "Wealth Dashboard"
- **Border:** Slate-200 / slate-700 right edge
- **Hover state:** bg-slate-50 / bg-slate-800, text slate-700 / slate-300
- **Active state:** bg-indigo-50 / bg-indigo-900/30, text-indigo-600, trailing 6×6px (w-1.5 h-1.5) indigo-500 dot

---

## Providers & Context Map

### Web Providers (frontend/app/Providers.tsx)

Stack order (parent → child):
1. **AuthProvider** — User session, login state, onboarding gate
2. **PreferencesProvider** — Dark mode, net-worth visibility, pay-period config, region (UK/Kenya), debt tracking, widget layout
3. **CategoriesProvider** — Category list, custom categories, category API ops
4. **ColourProvider** — Category colour overrides (localStorage-backed)
5. **IconProvider** — Category icon overrides (localStorage-backed)

Plus (layout.tsx wrapping order):
- **TutorialProvider** — Onboarding walkthrough, context-sensitive tooltips; sits as a sibling wrapper OUTSIDE <Providers>
- **TutorialOverlay** — Tooltip UI; pairs with TutorialProvider; NOT YET on mobile
- **ThemeColor** (component) — Drives PWA theme-color meta tag
- **ScrollReset** (component) — Scroll to top on route change
- **ServiceWorkerRegistrar** (component) — PWA installation

### Mobile Context Map

**Root layout** wraps:
1. **SafeAreaProvider** — react-native-safe-area-context for notches/home indicators
2. **AuthProvider** (mobile/lib/AuthContext.tsx) — Token management via expo-secure-store
3. **ThemeProvider** (mobile/lib/ThemeContext.tsx) — Dark mode state, SecureStore-backed

**Tab layout** adds:
- Biometric lock gate (LocalAuthentication)
- Dynamic StatusBar style

**Migration note:** Mobile lacks dedicated CategoriesProvider, ColourProvider, IconProvider, PreferencesProvider, TutorialProvider. These should be ported incrementally as screens require them; or centralized in a single "AppProvider" stack.

---

## Shared UI Primitives Inventory

### Mobile UI Components (mobile/components/ui/)

| Component | Purpose | Web Equivalent |
|-----------|---------|---|
| **Button.tsx** | Primary/secondary/destructive variants | `<button>` + Tailwind (primary: indigo-600, secondary: hairline, destructive: red) |
| **Card.tsx** | Surface container, shadow-sm, 16px radius | `.card`, `rounded-2xl`, `shadow-sm` |
| **MoneyFigure.tsx** | Formatted currency display with label | Display/headline-weight figure + label combo |
| **WhisperLabel.tsx** | Uppercase muted secondary text | `.label`, 11px semibold, tracking-wide, slate-400 |
| **ProgressBar.tsx** | Rounded track + fill bar, optional pace marker | Budget/goal progress bars (emerald on-pace, amber above, red over) |
| **CategoryChip.tsx** | ~15% tinted bg + emoji icon | Category chip with lucide icon (web uses lucide-react; mobile uses emoji as fallback) |
| **Screen.tsx** | SafeAreaView wrapper, responsive gutter | Main layout container with 430px shell centering |

### Web UI Primitives (frontend/components/)

Additional elements not yet ported to mobile:
- **BottomNav.tsx** — Fixed bottom tab bar (mobile-only; web uses Sidebar)
- **Sidebar.tsx** — Fixed left navigation (desktop-only)
- **CompanionStack.tsx** — Chat FAB + Penny AI interface
- **TutorialOverlay.tsx** — Onboarding tooltips
- **Modals/Sheets** — Bottom sheets for mobile, centred modals for desktop (Radix UI Dialog or native RN Modal)

**Web primitives in Tailwind not yet mirrored in mobile:**
- Button focus rings (`focus:ring-2`)
- Hover state animations
- Backdrop blur (Glass CSS)
- Detailed transition easing (cubic-bezier curves)
- **TutorialOverlay** (tooltip UI paired with TutorialProvider)

**Colour token gaps in mobile/lib/tw.ts to add when needed:**
- `violet500`: #8b5cf6 (Insights badge)
- `rose500`: #f43f5e (Planning badge)
- Shades: indigo/violet/emerald 200/300/800/50 (for future UI density)

---

## React Native Port Mapping Rules

### Reference: How to Port Web → Mobile

**Tailwind className → NativeWind className or mobile/lib/tw.ts token:**

```
Tailwind Class        →  Mobile Equivalent
─────────────────────────────────────────
text-sm               →  tw.text.sm ({ fontSize: 14, lineHeight: 20 })
text-base             →  tw.text.base ({ fontSize: 16, lineHeight: 24 })
text-lg               →  tw.text.lg ({ fontSize: 18, lineHeight: 28 })
font-bold             →  tw.weight.bold ("700")
font-semibold         →  tw.weight.semibold ("600")
gap-4                 →  gap: tw.space[4] (16)
p-4                   →  paddingHorizontal/Vertical: tw.space[4]
rounded-2xl           →  borderRadius: tw.radius["2xl"] (16)
rounded-3xl           →  borderRadius: tw.radius["3xl"] (24)
rounded-full          →  borderRadius: tw.radius.full (9999)
bg-white              →  backgroundColor: tw.color.white
dark:bg-slate-900    →  backgroundColor: dark ? tw.color.slate900 : tw.color.white
text-indigo-600      →  color: tw.color.indigo600
text-slate-400       →  color: tw.color.slate400
```

**Lucide Icon Mapping:**

```
Web (lucide-react)           →  Mobile (lucide-react-native)
─────────────────────────────────────────────────
<Home size={22} />           →  <Home color={color} size={22} />
<PieChart />                 →  <PieChart />
<CalendarClock />            →  <CalendarClock />
<Lightbulb />                →  <Lightbulb />
<Settings />                 →  <Settings />
```

Icon names are identical; only import path changes. Both use `strokeWidth` for weight.

**Local Storage & Persistence:**

```
Web (localStorage)              →  Mobile (expo-secure-store or AsyncStorage)
─────────────────────────────────────────────────────
localStorage.setItem("wd_dark") →  SecureStore.setItemAsync("theme_dark")
localStorage.getItem(key)       →  SecureStore.getItemAsync(key)
JSON.parse/stringify            →  Same; SecureStore handles string serialization
```

**Routing:**

```
Web (next/link + useRouter)     →  Mobile (expo-router)
─────────────────────────────────────────────────────
<Link href="/spend">Spend</Link> →  <Link href="/spend">Spend</Link> (expo-router Link also exists)
useRouter().push("/spend")      →  router.push("/spend") (expo-router useRouter)
usePathname()                   →  useSegments() or useRouter().pathname (expo-router)
```

**HTML Elements → React Native:**

```
Web (HTML)                  →  Mobile (React Native)
─────────────────────────────────────────────────
<div>                       →  <View>
<span>                      →  <Text> (if text content) or <View> (if container)
<button>                    →  <Pressable> + custom onPress handler
<input>                     →  <TextInput>
<modal>                     →  <Modal> (react-native) or Expo-managed sheet
<div style={{...}}>         →  <View style={StyleSheet.create({...})}>
onMouseEnter/Leave          →  onMouseEnter not supported; use Pressable state
hover / active:scale        →  use pressed state in Pressable: [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]
```

**Safe Area & Notch Handling:**

```
Web (CSS env())             →  Mobile (react-native-safe-area-context)
─────────────────────────────────────────────────────
env(safe-area-inset-bottom) →  <SafeAreaView edges={["bottom"]} />
padding: env(safe-area...)  →  useSafeAreaInsets() hook + apply padding
```

**Charts & Complex UI:**

```
Web (recharts/SVG)          →  Mobile (react-native-svg or react-native-chart-kit)
─────────────────────────────────────────────────────
<LineChart>                 →  react-native-svg <Svg> + <Path> or chart library
<BarChart>                  →  Chart library or custom react-native-svg
CSS gradients               →  expo-linear-gradient <LinearGradient>
```

**Penny Gradient (indigo→violet):**

```
Web: linear-gradient(135deg, #4f46e5, #7c3aed)
Mobile: <LinearGradient colors={["#4f46e5", "#7c3aed"]} start={[0, 0]} end={[1, 1]} />
```

**Animations & Motion:**

```
Web (CSS/Framer Motion)     →  Mobile (Reanimated or React Native Animated API)
─────────────────────────────────────────────────────
cubic-bezier(0.32, 0.72, 0, 1)  →  Animated.timing with easing module
280ms transition            →  duration: 280
prefers-reduced-motion      →  useReducedMotionSettings() from Reanimated
```

---

## Key Design Principles for Porting

1. **The Calm Cockpit.** Verdicts lead; colour is information; red = genuine risk only.
2. **The Red Is Risk Rule.** Red/rose only for financial risk. Never for emphasis or non-financial errors.
3. **The Penny Gradient Rule.** Indigo→violet gradient belongs to AI adviser alone.
4. **The One Shadow Rule.** Resting cards get one soft shadow or none. Fix tone/border contrast instead of stacking shadows.
5. **The Category Voice Rule.** ~15% tint background + full-strength icon; never flood a surface.
6. **The Numbers Lead Rule.** Money figure is visually heaviest; label whispers above/beside.
7. **Flows vs Positions.** Home speaks in flows (what's moving); Position totals (net worth) live in Accounts, visited by choice.

---

## Mobile Architecture Notes

- **No WebView fallback:** Mobile is native React Native (Expo), not a wrapper. Screens must be rebuilt screen-by-screen.
- **430px shell width:** Responsive gutter in Screen.tsx centers content on wider devices.
- **Dark mode first-class:** Every surface ships with `dark:` variant.
- **Touch targets:** Minimum 44×44pt (iOS) / 48×48dp (Android) for thumbs.
- **Biometric lock gate:** Already implemented in (tabs)/_layout.tsx; preserves session across app restarts.
- **No manual logging:** Behaviours mirror web deterministic signatures; verify checkpoints from transaction data only.

---

## Next Steps for Porting

See CHECKPOINT.md for how to track future web changes to this foundation. Once merged, each screen doc (01–12) records its own source paths so future runs can diff just that screen.
