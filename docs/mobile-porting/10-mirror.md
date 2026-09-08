# Mirror Screen — Behavioural Identity Portrait

## Checkpoint

- **Web source reflected at commit:** 5ad21c0 (2026-08-06)
- **Last change to this screen's source:** 2d7c184 2026-08-02 16:46:46 +0200
- **Find future changes:** `git log 5ad21c0..HEAD -- frontend/app/mirror/MirrorPage.tsx`

---

## Purpose & Emotional Job

**The Mirror is the identity reflection surface.** It computes deterministic behavioural signatures from 60+ days of transaction history and shows them back to the user as a portrait without judgment. Per BEHAVIOURS.md Layer 2, it serves the emotional job: _"Am I okay? Am I a mess?"_ — answered with an honest, evidence-backed portrait.

Each trait displayed carries:
- A title ("You're a payday spender")
- Narrative explaining what it means
- Evidence bullets (transaction facts)
- One choice per trait: **Keep this** (celebrate, never nag) or **I'd like to change this** (unlock coaching)

The consent state is persistent and durable; it survives auth, recomputes, and app restarts.

### Navigation

- **Web route:** `/mirror`
- **Trigger:** From Home → heart icon or "See your portrait" → Mirror tab (future: Insights tab or Settings tab gateway)
- **Mobile location:** Tab 4 (Insights) or dedicated "Behaviours" tab (pending IA decision; initially accessible from Home or Insights)
- **Desktop:** Via sidebar "Behaviours" or fifth nav tab

---

## Source Files

**Web (React/Next.js):**
- `/root/ai-wealth-dashboard/frontend/app/mirror/MirrorPage.tsx` — Main screen, state, layout
- `/root/ai-wealth-dashboard/frontend/lib/api.ts` — Types: `MirrorPortrait`, `MirrorTrait`, `ActiveAim`, `Checkpoint`
- `/root/ai-wealth-dashboard/frontend/components/BottomNav.tsx` — Navigation chrome
- `/root/ai-wealth-dashboard/BEHAVIOURS.md` — Consent rules, layers, emotional jobs (ESSENTIAL READ)
- `/root/ai-wealth-dashboard/DESIGN.md` — Design system, tokens

**Mobile (React Native/Expo) — to be created:**
- `mobile/app/(tabs)/mirror.tsx` — Screen root (Expo Router)
- `mobile/components/MirrorTraitCard.tsx` — Individual trait card with Keep/Change buttons
- `mobile/components/MirrorPortraitLoader.tsx` — Loading skeleton
- `mobile/components/MirrorEmptyState.tsx` — Insufficient data or no traits
- `mobile/lib/api.ts` — Mirror API methods (already imports types from backend)

---

## Layout Anatomy (Top → Bottom)

### Header Block

**Padding:** 16px horizontal (`pt-6 pb-2` = 24px top, 8px bottom)  
**Max width:** 2xl = 672px (mobile: full-width, desktop: 672px centered)  
**Layout:** Flex column, gap-based stacking

#### Back Navigation
- **Button:** Icon + "Back" label
- **Icon:** ChevronLeft, 15px
- **Text:** 14px, 500 weight, muted slate-500 / dark:slate-400
- **Interaction:** `active:opacity-70`, no scale (nav button)
- **Margin:** mb-5 (20px)

#### Title Block
- **Flex layout:** `items-start justify-between`
- **Label:** "THE MIRROR" (uppercase, 11px, semibold, tracking-widest, slate-400 / dark:slate-500, mb-1)
- **Headline:** "How your money behaves" (28px, font-bold, tight tracking, slate-900 / dark:slate-100, leading-tight)
- **Icon badge (right):** 
  - Sparkles icon (lucide-react), 16px, indigo-500
  - Container: 9×9 (w-9/h-9 = 36px) rounded-xl, bg-indigo-50 / dark:bg-indigo-900/30
  - Margin: mt-1 (4px above baseline)

#### Intro Paragraph
- **Text:** "Computed from your last [duration] of transactions. No judgement — just what the data says."
- **Duration:** Calculated from `portrait.window_days / 30` (rounded, e.g. "6 months")
- **Fallback:** "6 months" if no data yet
- **Typography:** 15px, slate-700 / dark:slate-200, leading-relaxed, mt-3 mb-6

#### Refresh Button (conditional; only if loaded and status="ok")
- **Visibility:** Shown only after initial load and portrait is valid
- **Style:** Flex, gap-1.5, text-xs, font-semibold, text-indigo-500 / dark:text-indigo-400
- **Icon:** RefreshCw, 12px (rotates via `animate-spin` when refreshing)
- **Label:** "Recompute" (normal) or "Recomputing…" (loading)
- **State:** `disabled={refreshing}`
- **Interaction:** `active:opacity-70`
- **Margin:** mb-5

---

### Active Aims Section (conditional; only if aims.length > 0)

**Visibility:** Appears only when user has chosen "change" on at least one trait (or checkpoints exist)

#### Section Label
- **Text:** "WHAT YOU'RE WORKING ON"
- **Typography:** 11px, semibold, uppercase, tracking-widest, slate-400 / dark:slate-500, mb-2

#### Aim Cards (grid of rows)
- **Spacing:** space-y-2 (8px between rows)
- **Card per aim:**
  - **Container:** glass-card, rounded-2xl, px-4 py-3
  - **First line:** 
    - Text: `aim.ref` (category or checkpoint label, e.g. "Transport", "Save for holiday")
    - Typography: 14px, font-semibold, slate-800 / dark:slate-100, truncate
  - **Second line (subtext):**
    - Format: `£{Math.round(aim.spent_so_far).toLocaleString("en-GB")} of your £{Math.round(aim.aim_amount).toLocaleString("en-GB")} aim · {days_left_text}`
    - `days_left_text`:
      - ≤ 0: "last day"
      - = 1: "1 day left"
      - > 1: `{aim.days_left} days left`
    - Typography: 13px, slate-500 / dark:slate-400, mt-0.5
  - **Cancel button:**
    - Text: "Cancel this aim"
    - Typography: 12px, slate-500 / dark:slate-400
    - Interaction: `active:opacity-60`, transition-opacity
    - Margin: mt-1.5
    - Behaviour: Calls `api.cancelCheckpoint(aim.id)`, removes from list optimistically

---

### Content Section

Rendered based on loading and portrait state.

#### Loading State
- **Three skeleton cards** (SkeletonCard component)
- **Spacing:** space-y-4 (16px gaps)
- **SkeletonCard anatomy:**
  - Container: rounded-2xl, glass-card, p-4, `animate-pulse`
  - Title line: h-4, w-48 (192px), bg-slate-200 / dark:bg-slate-700, rounded
  - Narrative lines (×2): h-3, w-full + w-3/4, bg-slate-100 / dark:bg-slate-700/60, rounded, space-y-2
  - Evidence group: mt-3
    - Chip 1: h-6, w-28 (112px), bg-slate-100 / dark:bg-slate-700/60, rounded-full
    - Chip 2: h-6, w-36 (144px), bg-slate-100 / dark:bg-slate-700/60, rounded-full
    - gap-1.5
  - Button row: mt-3, flex gap-2
    - Button 1: flex-1, h-9, bg-slate-100 / dark:bg-slate-700/60, rounded-xl
    - Button 2: flex-1, h-9, bg-slate-100 / dark:bg-slate-700/60, rounded-xl

#### Insufficient Data State
- **Visibility:** `portrait === null || portrait.status === "insufficient_data"`
- **Container:** rounded-2xl, glass-card, p-6, text-center
- **Icon:** Sparkles, 22px, slate-400, centered in 12×12 (48px) rounded-2xl container with bg-slate-100 / dark:bg-slate-700, mb-4
- **Headline:** "Not enough data yet" (16px, bold, slate-900 / dark:slate-100, mb-2)
- **Body:** "The Mirror needs at least 60 days of transactions to compute your behavioural portrait. Check back after a couple of months of connected banking." (14px, slate-500 / dark:slate-400, leading-relaxed)

#### No Traits State
- **Visibility:** `portrait.traits.length === 0`
- **Container:** rounded-2xl, glass-card, p-6, text-center
- **Message:** "No distinct patterns detected yet — check back after more transactions have been synced." (14px, slate-500 / dark:slate-400)

#### Traits List (populated state)
- **Container:** space-y-4 (16px gaps)
- **Per trait:** Wrapped in `rise-in` animation div with `--rise-index` (sequential stagger)
- **Child:** TraitCard component (see below)

---

## States

### 1. **Loading** (`loading === true`)
- Three SkeletonCard placeholders
- UI ready but data not yet fetched
- Animation: gentle pulse

### 2. **Insufficient Data** (`portrait.status === "insufficient_data"` or `portrait === null`)
- Card with Sparkles icon, "Not enough data yet" headline
- Message directs to reconnect or wait 60 days
- Refresh button absent; no traits shown

### 3. **No Traits** (`portrait.traits.length === 0`)
- Single card: "No distinct patterns detected yet"
- User has enough data but no signature traits fired
- Refresh button available for manual recompute

### 4. **Populated** (`portrait.status === "ok"` && `traits.length > 0`)
- Header + intro + refresh button
- (Optional) Active aims section if aims exist
- Grid of TraitCard components

### 5. **Refreshing** (`refreshing === true`)
- Refresh button disabled, spinner animates
- Text: "Recomputing…"
- Portrait data remains visible in background

### 6. **Empty with Active Aims** (rare)
- Active aims section shown
- "No traits" message below
- Context: user is working toward a goal but no new signatures fired

---

## Interactions

### Trait Card (`TraitCard` component)

**Container:**
- rounded-2xl, glass-card, overflow-hidden
- No shadow (glass card handles it)

**Header Band:**
- **Padding:** px-4 pt-4 pb-3 (16px horizontal, 16px top, 12px bottom)
- **Title:** `trait.title` — 16px, bold, slate-900 / dark:slate-100, leading-snug
- **Narrative:** `trait.narrative` — 14px, slate-600 / dark:slate-300, mt-1, leading-relaxed
- **Purpose:** Explain what this trait means in plain language

**Evidence Block (conditional; if `trait.evidence.length > 0`):**
- **Padding:** px-4 pb-3
- **Layout:** space-y-1 (4px gaps between lines)
- **Per line:** 13px, slate-500 / dark:slate-400, leading-snug
- **Purpose:** Transaction-derived facts backing each trait (e.g. "£427 spent in first 3 days of July", "Transfers to savings 3 times per week")

**Choice Buttons:**
- **Padding:** px-4 pb-4
- **Layout:** flex, gap-2 (8px)
- **Two buttons:** flex-1 each, `text-xs font-semibold`, py-2 px-3, rounded-xl, border
- **Transition:** all 150ms (transform, opacity, bg-color, text-color, border-color)
- **Active press:** `active:scale-[0.98]`
- **Hover:** `opacity-80`
- **Focus:** `focus-visible:outline-none`, `focus-visible:ring-2 focus-visible:ring-indigo-500`

#### Button 1: "This is me — keep it"
- **Unselected:** border-slate-200 / dark:border-slate-600, text-slate-600 / dark:text-slate-300
- **Selected (`trait.choice === "keep"`):** 
  - bg-indigo-50 / dark:bg-indigo-900/30
  - text-indigo-700 / dark:text-indigo-300
  - border-indigo-200 / dark:border-indigo-800 (requires indigo-200/800 tokens in mobile tw.ts)
- **Disabled:** `disabled={saving}`
- **Behaviour:** Call `handleChoice("keep")`, update state, post to API

#### Button 2: "I'd like to change this"
- **Unselected:** border-slate-200 / dark:border-slate-600, text-slate-600 / dark:text-slate-300
- **Selected (`trait.choice === "change"`):**
  - bg-amber-50 / dark:bg-amber-900/30
  - text-amber-700 / dark:text-amber-300
  - border-amber-200 / dark:border-amber-800 (requires amber-200/800 tokens in mobile tw.ts)
- **Disabled:** `disabled={saving}`
- **Behaviour:** Call `handleChoice("change")`, update state, post to API; unlock Paradox or Checkpoint UI downstream

**Confirmation Line (conditional; if `trait.choice` is set):**
- **Padding:** px-4 pb-4, -mt-1
- **Text:**
  - Keep: "Noted — we'll never nag you about this."
  - Change: "Noted — Penny will start working on this with you."
- **Typography:** 13px, slate-500 / dark:slate-400
- **Purpose:** Reassure user choice is recorded

### Refresh Action
- **Trigger:** Click "Recompute" button
- **State:** Set `refreshing = true`, disable button
- **API call:** `await api.getMirror(true)` (refresh=1 parameter forces recompute)
- **Outcome:** Reload portrait, update traits, clear aims if unchanged
- **Fallback:** Silent on error; refreshing flag resets to false

### Cancel Aim Action (per aim card)
- **Trigger:** Click "Cancel this aim" link
- **API call:** `await api.cancelCheckpoint(aim.id)`
- **Optimistic:** Remove from aims array immediately
- **Fallback:** Row stays visible on error (user can retry)

---

## Data

### API Endpoints

**Web base:** `/api/` (NEXT_PUBLIC_API_URL or `/api`)

#### GET /mirror [?refresh=1]
- **Return type:** `MirrorPortrait`
- **States:**
  - `{ status: "insufficient_data" }` — < 60 days history
  - `{ status: "ok", computed_at: ISO string, window_days: number, traits: MirrorTrait[] }`
- **Traits array:** Empty if no signatures fired; non-empty if patterns detected
- **Caching:** Computed post-sync, cached; refresh=1 forces recompute on worker
- **Called on:** Page mount; manual refresh action

#### POST /mirror/choice
- **Body:** `{ trait_id: string, choice: "keep" | "change" }`
- **Return:** Updated trait state or 200 OK
- **Idempotent:** Re-posting same choice is safe
- **Persistence:** Stored per-user, survives reauth and recomputes

#### GET /checkpoints
- **Return type:** `{ checkpoints: ActiveAim[] }`
- **ActiveAim extends Checkpoint:**
  - `id: string`
  - `aim_amount: number` (pounds)
  - `spent_so_far: number` (pounds)
  - `days_left: number` (integer; 0 or negative = "last day")
  - `on_track: boolean`
  - `ref: string` (category label or checkpoint name)
- **Displayed:** As "WHAT YOU'RE WORKING ON" section
- **Called on:** Page mount

#### DELETE /checkpoints/:id
- **Effect:** Cancel/resolve checkpoint
- **Return:** 200 OK
- **Called by:** "Cancel this aim" button per row

### Types (from `/frontend/lib/api.ts`)

```typescript
export type MirrorTrait = {
  id: string;
  title: string;                    // e.g. "You're a payday spender"
  narrative: string;                // Explanation paragraph
  evidence: string[];               // Array of fact bullets
  kind: "structure" | "habit" | "pleasure" | "hygiene";  // Trait category (affects chip accent)
  choice: "keep" | "change" | null; // Consent state
};

export type MirrorPortrait =
  | { status: "insufficient_data" }
  | {
      status: "ok";
      computed_at: string;          // ISO timestamp of last compute
      window_days: number;          // Days of history analyzed
      traits: MirrorTrait[];
    };

export type ActiveAim = Checkpoint & { ref: string };

export type Checkpoint = {
  id: string;
  aim_amount: number;               // Target (e.g. £150)
  spent_so_far: number;             // Cumulative spend this period
  days_left: number;                // Days until deadline
  on_track: boolean;                // T/F against pace
};
```

### Key Fields Mapped to UI

| Data | Usage | Format |
|------|-------|--------|
| `portrait.window_days` | Intro text duration | `Math.round(/ 30) + " months"` |
| `trait.title` | Card headline | Plain text, ~50 chars |
| `trait.narrative` | Card body | Plain text paragraph |
| `trait.evidence[]` | Bullet points | Array of 1–5 lines, each ~60 chars |
| `trait.kind` | Chip accent colour | Maps to KIND_ACCENT object |
| `trait.choice` | Button state (keep/change/null) | Enum; null = undecided |
| `aim.ref` | Aim label | Category name or checkpoint ref |
| `aim.spent_so_far` | Progress amount | Pounds, formatted with commas |
| `aim.aim_amount` | Target amount | Pounds, formatted with commas |
| `aim.days_left` | Time remaining | Integer; ≤0 = "last day" |

---

## Current Mobile State

**No native Mirror screen exists.** Mobile app lacks:
1. Mirror page/screen component
2. Trait card UI and consent flow
3. Active aims display
4. API client methods for `getMirror()`, `setMirrorChoice()`, `listCheckpoints()`, `cancelCheckpoint()`
5. Kind-to-accent color mapping (KIND_ACCENT object)
6. Loading skeleton
7. Empty states

**To build 1:1:**
- Port layout, token values, and all states
- Implement choice persistence (optimistic + API sync)
- Use Penny indigo→violet gradient nowhere; Mirror is identity reflection, not AI advice
- Honour BEHAVIOURS.md consent rules: no coaching on "keep" traits
- Verify checkpoints from transaction data only (see BEHAVIOURS.md Layer 4)

---

## Traits and Kind Mapping

**Kind** determines accent colour (Category Voice Rule: ~15% tint background + full-strength icon).

| Kind | Light BG | Dark BG | Dot | Light Text | Dark Text | Usage |
|------|----------|---------|-----|------------|-----------|-------|
| `structure` | bg-indigo-50 | dark:bg-indigo-900/20 | bg-indigo-500 | text-indigo-800 | dark:text-indigo-200 | Structural behaviours (account routing, multi-account orchestration); **requires indigo-50/200/800 tokens** |
| `habit` | bg-emerald-50 | dark:bg-emerald-900/20 | bg-emerald-500 | text-emerald-800 | dark:text-emerald-200 | Behavioural patterns (saving frequency, spending rhythm); **requires emerald-50/200/800 tokens** |
| `pleasure` | bg-violet-50 | dark:bg-violet-900/20 | bg-violet-500 | text-violet-800 | dark:text-violet-200 | Discretionary or signature categories (e.g. entertainment spike); **requires violet-50/200/500/800 tokens** |
| `hygiene` | bg-slate-100 | dark:bg-slate-700/40 | bg-slate-400 | text-slate-700 | dark:text-slate-200 | Neutral or system traits (payment reliability, cash presence) |

---

## React Native Port Notes

### Token Gaps in tw.ts
Mirror screen requires additional colour tokens for KIND_ACCENT tints and choice button states:
- **indigo:** indigo-50, indigo-200, indigo-300, indigo-800 (structure kind + "keep" button selected state)
- **emerald:** emerald-50, emerald-200, emerald-800 (habit kind)
- **violet:** violet-50, violet-200, violet-500, violet-800 (pleasure kind)
- **amber:** amber-200, amber-800 (change button selected state; already has amber-50/900 for bg)

Add these hex values to `/mobile/lib/tw.ts` colour object before porting Mirror screen.

### Gradients
- **Web:** CSS `linear-gradient(135deg, #4f46e5, #7c3aed)` on Penny surfaces (not used in Mirror)
- **Mobile:** Would use `expo-linear-gradient`, but Mirror is identity only — no gradient needed

### Animations
- **Web:** CSS `animate-pulse` (loading skeleton), `nav-pill-in` (nav transitions)
- **Mobile:** 
  - Pulse: Reanimated loop or React Native Animated API
  - rise-in stagger: Reanimated or sequential mount animations
  - Press feedback: `active:scale-95` → Pressable with pressed state and transform

### Typography
- **Display-equivalent:** 28px, bold, tight tracking (−0.025em where supported)
- **Headline:** 20px, bold
- **Title:** 14px/16px, 600–700 weight
- **Body:** 13–14px, 400–500 weight, line-height 1.5
- **Label:** 11px, 600 weight, uppercase, letter-spacing +0.05em

### Icons
- **Web:** lucide-react (ChevronLeft, RefreshCw, Sparkles)
- **Mobile:** lucide-react-native (same names, same sizes)
  - ChevronLeft: 15px
  - RefreshCw: 12px (rotates on refresh)
  - Sparkles: 16px (header badge), 22px (empty state)

### Safe Area
- **Web:** CSS `env(safe-area-inset-bottom)` on nav bar (not applicable to Mirror)
- **Mobile:** SafeAreaView around screen, ScrollView for long trait lists

### Glass / Backdrop Blur
- **Web:** `.glass-card` class (Tailwind + backdrop-filter blur; flattens on unsupported browsers)
- **Mobile:** 
  - No native backdrop-filter equivalent
  - Use semi-transparent bg with opacity
  - Consider `expo-blur` for more sophisticated glass effect (optional)
  - Simpler approach: solid card bg (white / #1e293b) with border + shadow

### Choice Button Transitions
- **Web:** `transition-[transform,opacity,background-color,color,border-color] duration-150`
- **Mobile:** Pressable with StyleSheet.create, conditional styles on pressed state
  ```typescript
  <Pressable style={({ pressed }) => [{
    transform: [{ scale: pressed ? 0.98 : 1 }],
    opacity: pressed ? 0.8 : 1,
  }]} />
  ```

### Markdown & Rich Text
- Mirror traits use plain text only (no markdown, no links in evidence)
- Future: If Penny surfaces paradox or checkpoint guidance inline, use `react-native-markdown-display` for formatted advice

### LocalStorage → AsyncStorage / SecureStore
- **Web:** `localStorage.getItem/setItem("wd_insight_badge")`, etc. (BottomNav uses this)
- **Mobile:** Use `expo-secure-store` for preferences; AsyncStorage for non-sensitive caches
- **Mirror-specific:** No local caching needed; API calls are fast enough

### Form Submission & API Error Handling
- **Web:** Try/catch in `handleChoice`, silent on error (UI reflects optimistic state)
- **Mobile:** 
  - Same pattern: optimistic update, API post, silent fallback
  - Optional: Toast notification on error
  - Disabled state prevents double-submit

### Mobile-Specific UX Additions
- Long-press on trait card to preview actions (optional, iOS native pattern)
- Haptic feedback on choice selection (optional, `react-native-haptic-feedback`)
- Swipe-to-cancel on aim card (optional, gesture handler)
- Keep animations < 300ms, respect `prefers-reduced-motion` (BEHAVIOURS.md design language)

---

## Open Questions & Risks

### Behavioural Consent & Coaching Downstream
1. **Paradox flow:** When user marks a trait "change", what surface shows paradox feedback? Is it inline on this screen, a separate bottom sheet, or redirects to a Coaching tab?
   - **Risk:** If paradox is deferred, user sees no immediate feedback; must clarify downstream screens (11-paradox.md?)

2. **Checkpoint verification:** BEHAVIOURS.md Layer 4 requires checkpoint events be verified from transaction data only. The `aims` array here shows progress — what APIs verify completion? Is it the worker post-sync?
   - **Risk:** If verification is manual or UI-based, it violates verified-checkpoint rule

3. **Rhythm notifications:** BEHAVIOURS.md Layer 5 (proactive Penny) mentions rhythm-timed alerts. Mirror doesn't surface these — are they push notifications, a separate "Rhythm" section, or a dedicated coaching tab?
   - **Risk:** Incomplete if rhythm initiation lives elsewhere

### Traits Recompute Frequency
1. **Cadence:** BEHAVIOURS.md says signatures recompute monthly. What happens if user force-refreshes mid-month? Does backend queue a fresh compute or return cached result?
   - **Risk:** Web refresh button may confuse UX if recompute is throttled

### Consent State Persistence
1. **Reset on reauth:** If user logs out and back in, does mirror consent survive? The spec says "persistent and revisable" but doesn't mandate local cache.
   - **Risk:** If consent lives backend-only, network failure could lose state

### Empty Aims After Checkpoint Completion
1. **Visibility of completed aims:** Once `days_left ≤ 0`, does the aim stay visible, fade, or move to a separate "completed" section?
   - **Risk:** Current code filters out; may need a "recent completions" celebratory card

### Navigation & Deep Linking
1. **Mobile entry point:** Which tab or nav item goes to Mirror? Currently unclear if it's Insights, Settings, or a dedicated tab.
   - **Risk:** IA decision required before implementing navigation

2. **Deep link from notification:** If Penny sends a rhythm alert, does it deep-link to `/mirror` or to a specific trait card? Does React Navigation need a query param?
   - **Risk:** Defer to 11-rhythm-notifications.md

### Glance Feature (Optional)
1. **Penny presence:** BEHAVIOURS.md gradient rule says "if gradient is present, advice is available." Mirror has no gradient (identity, not advice). Should there be a "Chat with Penny about this" floating button or does Penny chat live elsewhere?
   - **Risk:** If Penny is integrated, needs separate doc (12-penny-chat.md)

---

## Testing Checklist

- [ ] **Load states:** Loading skeleton → data loaded → traits render
- [ ] **Empty states:** Insufficient data (< 60 days), no traits fired, network error
- [ ] **Consent flow:** Keep/Change buttons save state, confirmation message appears, next action (if any) becomes available
- [ ] **Refresh:** Recompute button disables, spins, updates traits
- [ ] **Active aims:** Aims list appears if checkpoints exist, cancel button works, list clears on successful delete
- [ ] **Evidence rendering:** Multi-line evidence text wraps correctly
- [ ] **Dark mode:** All tokens correctly inverted (card bg, text, button states, accent colours)
- [ ] **Responsive:** Fits 430px mobile shell, reflow on tablet/desktop without overflow
- [ ] **Focus/a11y:** Buttons focusable, text contrast ≥ 4.5:1, touch targets ≥ 44×44pt
- [ ] **Offline:** Graceful fallback if API unreachable (spinner eventually clears, no hard crash)
- [ ] **Trait kinds:** All four kind colours (structure/habit/pleasure/hygiene) render correctly
- [ ] **Duration label:** Window days calculated correctly (e.g. 180 days → "6 months", 45 days → "1 month")
- [ ] **Button transitions:** Press scale 0.98, opacity hover 0.8, focus ring visible
- [ ] **Permission/consent:** "Keep" trait never reappears with coaching; "Change" trait unlocks downstream features

---

## Summary

The Mirror screen is a non-judgmental identity portrait anchored to BEHAVIOURS.md consent model. It has two main surfaces: a trait portrait (identity findings) and an active aims tracker (behavioural checkpoints the user is working on). State management is optimistic + API-backed; all persistence is durable across app sessions. No Penny gradient (advice lives elsewhere); all colour is semantic (kind-to-accent mapping). Port is straightforward—layout tokens are directly transferable to mobile via NativeWind + Expo Router.

Next screen: 11-paradox.md (if user marks trait "change", what feedback follows?).
