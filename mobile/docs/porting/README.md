# Mobile Porting Documentation

Complete specification for rebuilding the web app in React Native (Expo). Each doc is a canonical reference; read them before coding.

## Stack Summary

- **Frontend (source of truth):** Next.js 16 + Tailwind CSS + lucide-react
- **Mobile (target):** Expo 56+ + React Native 0.85 + NativeWind 4 + lucide-react-native
- **Design system:** Shared (DESIGN.md, PRODUCT.md, BEHAVIOURS.md apply 1:1)
- **API:** Shared backend (FastAPI; same auth & endpoints)
- **Mobile Tailwind config:** tailwind.config.js (not nativewind.config.js)

---

## Porting Document Index

| Doc | Scope | Primary Web Source(s) |
|-----|-------|---|
| **00-foundation.md** | Design tokens, global chrome, navigation model, providers, UI primitives, RN port mapping rules | frontend/app/layout.tsx, frontend/components/BottomNav.tsx, frontend/components/Sidebar.tsx, frontend/app/globals.css, DESIGN.md |
| **01-home.md** | *Planned* | frontend/app/(main)/page.tsx, home card components |
| **02-spend.md** | *Planned* | frontend/app/(main)/spend/page.tsx, transaction list, category breakdown |
| **03-planning.md** | *Planned* | frontend/app/(main)/planning/page.tsx (currently "Budget" in mobile) |
| **04-insights.md** | *Planned* | frontend/app/(main)/insights/page.tsx |
| **05-settings.md** | *Planned* | frontend/app/(main)/settings/page.tsx |
| **06-accounts.md** | *Planned* | frontend/app/(main)/accounts/page.tsx (estate tab, open banking) |
| **07-auth.md** | *Planned* | frontend/components/AuthProvider.tsx, LoginScreen.tsx |
| **08-penny-ai.md** | *Planned* | frontend/components/CompanionStack.tsx, chat interface |
| **09-transactions-detail.md** | *Planned* | Transaction edit/categorise modal |
| **10-bills-detail.md** | *Planned* | Bill detail & edit bottom sheet |
| **11-category-manager.md** | *Planned* | Category colour/icon customisation |
| **12-behaviours.md** | *Planned* | Identity mirror, paradoxes, rhythm checkpoints (BEHAVIOURS.md) |

---

## Porting Workflow

### 1. **Author**
Read the web source doc + web code. Build a single screen in React Native (not WebView).

### 2. **Verify**
- Pixel-perfect layout match (use Run Skill)
- All interactive states (press, hover, disabled, dark mode)
- Badges, animations, transitions
- Colour parity (compare hex values)
- Touch target sizes (≥44pt iOS, ≥48dp Android)

### 3. **Build Native**
```bash
cd mobile
npm run eas-build  # or npx expo build
```

Verify on device (iOS + Android emulator/device at minimum).

---

## How to Use the Checkpoint

### **On Baseline (This Run)**
- Checkpoint is set to commit 5ad21c0 (2026-08-06)
- This entire doc set reflects web state at that commit
- Each screen doc will also record its own last-changed SHA

### **When a New Web Change Lands**

**Option 1: Check if it affects a ported screen**
```bash
cd /root/ai-wealth-dashboard
git log 5ad21c0..HEAD -- frontend/app/(main)/spend/page.tsx
# If results: Spend screen has changed; see docs/porting/02-spend.md for source paths to diff
```

**Option 2: See all changes to foundation since baseline**
```bash
git diff 5ad21c0..HEAD -- frontend/app/layout.tsx frontend/components/BottomNav.tsx frontend/components/Sidebar.tsx DESIGN.md
# Apply changes to mobile/app/_layout.tsx, mobile/app/(tabs)/_layout.tsx, mobile/lib/tw.ts, DESIGN.md
```

**Option 3: Batch-port multiple screens**
```bash
# List all web screens changed since baseline
git log 5ad21c0..HEAD --name-only --format="%h" -- frontend/app/(main)/ | grep -E "page\.tsx"

# For each affected screen, read its porting doc (01–12) to find source paths
# Then: git diff 5ad21c0..HEAD -- <paths>
```

### **Re-baseline After Porting a Batch**

After you've ported (e.g.) Home and Spend screens to match current web state, update CHECKPOINT.md:

```bash
# Get new baseline commit SHA (usually HEAD)
git log -1 --format="%h" -p # e.g., a1b2c3d

# Update CHECKPOINT.md: replace 5ad21c0 with a1b2c3d everywhere
# Update 00-foundation.md and each screen doc with new last-changed SHAs
```

---

## Key Drift: Mobile "Budget" → Web "Planning"

**Current state:**  
- Web nav: Home, **Spend**, **Planning** (CalendarClock), Insights, Settings
- Mobile nav: Home, Spend, **Budget** (Target), Insights, Settings

**Action required:**  
Before porting screen 03, rename mobile tab from "Budget" to "Planning" and icon from Target to CalendarClock.

This is a **screen rename only** — the underlying component and logic remain the same.

---

## Mobile-Specific Features (No Web Equivalent)

- **Biometric lock gate** — Fingerprint/Face ID unlock on app launch (mobile/app/(tabs)/_layout.tsx)
- **Secure token storage** — expo-secure-store instead of localStorage
- **StatusBar style** — auto-darkens with theme

These do not require porting; they are mobile-native enhancements.

---

## Testing Checklist Per Screen

- [ ] Layout matches web at 430px width
- [ ] Light + dark modes work
- [ ] All buttons/presses scale down (active:scale-95)
- [ ] Text hierarchy correct (Display, Headline, Body, Label sizes)
- [ ] Colours match DESIGN.md token table exactly
- [ ] Category badges use ~15% tint + icon
- [ ] Badges (Insights count, Planning at-risk) render and animate
- [ ] Safe area padding respected (top + bottom)
- [ ] No hardcoded hex values (use tw.color.*)
- [ ] No Tailwind classes (use StyleSheet.create)
- [ ] Lucide icon names match web exactly

---

## Common Port Patterns

### Money Figure with Label
```tsx
// Web
<div className="text-center">
  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Available to spend</p>
  <p className="text-3xl font-bold text-indigo-600">£1,234</p>
</div>

// Mobile
<MoneyFigure
  amount={1234}
  currency="GBP"
  size="display"
  tone="default"
  label="Available to spend"
/>
```

### Category Chip with Icon
```tsx
// Web
<div className="w-8 h-8 rounded-lg bg-emerald-400/15 flex items-center justify-center">
  <ShoppingCart className="text-emerald-500" size={16} />
</div>

// Mobile
<CategoryChip category="Groceries" size={32} />
```

### Progress Bar with Pace Marker
```tsx
// Web
<div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
  <div className="h-full w-3/5 bg-emerald-500 rounded-full" />
  <div className="absolute left-1/2 h-1.5 w-0.5 bg-slate-400" />
</div>

// Mobile
<ProgressBar value={0.6} color={tw.color.emerald500} height={6} paceMarker={0.5} />
```

### Bottom Sheet / Modal
```tsx
// Web (Radix Dialog with backdrop + slide-up)
<DialogContent className="slide-up rounded-t-3xl">...</DialogContent>

// Mobile (React Native Modal)
<Modal visible={open} transparent animationType="slide">
  <View style={styles.backdrop} />
  <View style={styles.sheet}>...</View>
</Modal>
```

---

## Styling Best Practices

1. **Never use inline styles for production.** Use `StyleSheet.create()` for performance.
2. **Import tokens from tw.** Never hardcode hex values.
3. **Theme-aware by default.** Every surface should respond to dark mode.
4. **Linear gradients via expo-linear-gradient.** Never use CSS gradients.
5. **Animations via Reanimated.** Never use web-style setTimeout for timing-critical UI.

---

## References

- **Design system:** /root/ai-wealth-dashboard/DESIGN.md
- **Product positioning:** /root/ai-wealth-dashboard/PRODUCT.md
- **Behaviour spec:** /root/ai-wealth-dashboard/BEHAVIOURS.md
- **Web Tailwind config:** /root/ai-wealth-dashboard/frontend/tailwind.config.ts
- **Mobile Tailwind config:** /root/ai-wealth-dashboard/mobile/tailwind.config.js
- **Mobile tokens:** /root/ai-wealth-dashboard/mobile/lib/tw.ts
- **Expo docs (v56):** https://docs.expo.dev/versions/v56.0.0/

---

## Questions Before You Start

1. **Is this a new screen?** Read the web source (frontend/app/(main)/[screen]/page.tsx), then the porting doc.
2. **Did the web change?** Check CHECKPOINT.md and git diff to see what changed since baseline.
3. **Dark mode confusion?** Use `const { dark } = useTheme()` and apply `dark ? tw.color.cardDark : tw.color.cardLight`.
4. **Icon names?** Lucide names are identical between web & mobile; only import path differs.
5. **Button not scaling?** Check Pressable has `style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}`.
