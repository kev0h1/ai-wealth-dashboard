# Checkpoint: Web Source Tracking

This document establishes the baseline for all future web-to-mobile diffs. When web code changes, use the commands below to find what's new and needs porting.

---

## Baseline: Commit 5ad21c0 (2026-08-06)

All porting docs (00–12) reflect the web app at this exact commit. When you land a new batch of ports, bump this baseline to the new commit SHA.

---

## How to Find Web Changes Since Baseline

### **1. Foundation (Tokens, Navigation, Providers)**

**Changes to design tokens, global chrome, or shell:**

```bash
cd /root/ai-wealth-dashboard
git log 5ad21c0..HEAD --oneline -- \
  frontend/app/layout.tsx \
  frontend/components/BottomNav.tsx \
  frontend/components/Sidebar.tsx \
  frontend/app/globals.css \
  DESIGN.md
```

**See the full diff:**

```bash
git diff 5ad21c0..HEAD -- \
  frontend/app/layout.tsx \
  frontend/components/BottomNav.tsx \
  frontend/components/Sidebar.tsx \
  frontend/app/globals.css \
  DESIGN.md
```

**Apply to mobile:**
- Design.md changes → same file
- Tokens (radii, spacing, colours) → mobile/lib/tw.ts
- Layout structure → mobile/app/_layout.tsx, mobile/app/(tabs)/_layout.tsx
- Navigation → mobile/app/(tabs)/_layout.tsx

---

### **2. Individual Screens (01–12)**

Each screen doc lists its own primary web source. Use this table to find screen-specific changes:

| Screen Doc | Web Primary Source | Secondary Sources |
|------------|---|---|
| 00-foundation.md | frontend/app/layout.tsx, frontend/app/globals.css, frontend/components/BottomNav.tsx, frontend/components/Sidebar.tsx, frontend/components/CompanionStack.tsx, frontend/components/ColourProvider.tsx, frontend/components/ThemeColor.tsx, frontend/components/IconProvider.tsx, frontend/components/CategoriesContext.tsx, frontend/components/PreferencesContext.tsx, frontend/components/TutorialContext.tsx, frontend/components/AuthProvider.tsx, DESIGN.md | Design tokens, providers, contexts |
| 01-home.md | frontend/app/components/HomePage.tsx | frontend/components/HomeBrief.tsx, frontend/components/SafeToSpendCard.tsx, frontend/components/UpcomingBillsStrip.tsx, frontend/components/ThisMonthStrip.tsx, frontend/components/HomeInsightSpotlight.tsx, frontend/components/AccountMiniCard.tsx, frontend/components/InvestmentMiniCard.tsx, frontend/components/TransactionRow.tsx |
| 02-spend.md | frontend/app/components/SpendPage.tsx | frontend/components/SpendTrends.tsx, frontend/components/CategorySheet.tsx, frontend/components/TransactionSheet.tsx, frontend/components/TransactionRow.tsx, frontend/components/SegmentedControl.tsx |
| 03-planning.md | frontend/app/planning/PlanningPage.tsx | frontend/components/UpcomingBillsStrip.tsx, frontend/components/PlanOneOffSheet.tsx, frontend/components/PlannedEditSheet.tsx, frontend/components/UpcomingEditSheet.tsx, frontend/components/PayPeriodSettingsSheet.tsx |
| 04-insights.md | frontend/app/insights/InsightsPage.tsx | frontend/app/insights/receipts/ReceiptsPage.tsx, frontend/app/insights/tax/TaxPage.tsx, frontend/components/TaxChat.tsx, frontend/components/ChatMarkdown.tsx, frontend/components/MoneyBasicCard.tsx |
| 05-settings.md | frontend/app/settings/SettingsPage.tsx | frontend/components/Toggle.tsx, frontend/components/AccountMiniCard.tsx, frontend/components/ConfirmDialog.tsx |
| 06-accounts.md | frontend/app/components/AccountsPage.tsx | frontend/components/AccountMiniCard.tsx, frontend/components/InvestmentMiniCard.tsx, frontend/components/InvestmentUpload.tsx, frontend/components/StatementUpload.tsx, frontend/components/BankPickerSheet.tsx, frontend/components/TransactionSheet.tsx |
| 07-month.md | frontend/app/month/MonthPage.tsx | frontend/app/month/story/StoryPlayer.tsx |
| 08-cards.md | frontend/app/cards/CardsPage.tsx | — |
| 09-budget.md | frontend/app/budget/BudgetPage.tsx | — |
| 10-mirror.md | frontend/app/mirror/MirrorPage.tsx | — |
| 11-debt-plan.md | frontend/app/debt-plan/DebtPlanPage.tsx | frontend/components/CardTermsSheet.tsx |
| 12-login.md | frontend/app/login/page.tsx | frontend/components/LoginScreen.tsx, frontend/components/Onboarding.tsx, frontend/components/AuthProvider.tsx |

**To check if a screen has changed:**

```bash
git log 5ad21c0..HEAD --oneline -- frontend/app/components/SpendPage.tsx
# If results: Spend screen is outdated; check docs/porting/02-spend.md for full source paths
```

**To see the specific changes:**

```bash
git diff 5ad21c0..HEAD -- frontend/app/components/SpendPage.tsx
```

---

## Screen-by-Screen Diff Strategy

### **For a single screen:**

1. Check docs/porting/NN-screen.md for all source file paths
2. Run:
   ```bash
   git diff 5ad21c0..HEAD -- <all paths from step 1>
   ```
3. Read the diff; apply changes to corresponding mobile/app/(tabs)/screen/ files

### **For all screens at once:**

```bash
# List all web screen files changed since baseline
git log 5ad21c0..HEAD --name-only --format="" -- frontend/app/components/ | sort -u

# For each file, find its porting doc number (check README.md index)
# Then diff that screen as above
```

---

## Re-baseline After Porting

After you've successfully ported Home + Spend (for example):

```bash
# 1. Record the new baseline (usually HEAD, or a tagged release)
git log -1 --format="%h %ai" -- frontend/app/layout.tsx
# Example output: a1b2c3d 2026-08-20 10:30:00 +0200

# 2. Update THIS file (CHECKPOINT.md)
# Replace all occurrences of 5ad21c0 with a1b2c3d

# 3. Update 00-foundation.md checkpoint block
# Replace "5ad21c0" with "a1b2c3d"

# 4. Update each ported screen doc (01-home.md, 02-spend.md, etc.)
# Update their checkpoint blocks with new SHAs
```

Example re-baseline commit message:
```
chore(mobile): rebaseline web source to a1b2c3d (2026-08-20)

Ported Home, Spend, and Planning screens. Docs now track changes from this commit onward.
```

---

## Porting State Tracker

Update this table as each screen is completed:

| Screen | Status | Mobile Commit | Notes |
|--------|--------|---|---|
| Foundation | In progress | — | 00-foundation.md complete |
| Home | — | — | awaiting 01-home.md |
| Spend | — | — | awaiting 02-spend.md |
| Planning | — | — | rename "Budget" to "Planning" before start |
| Insights | — | — | awaiting 04-insights.md |
| Settings | — | — | awaiting 05-settings.md |
| Accounts | — | — | awaiting 06-accounts.md |
| Auth | — | — | awaiting 07-auth.md |
| Penny AI | — | — | awaiting 08-penny-ai.md |
| Tx Detail | — | — | awaiting 09-transactions-detail.md |
| Bill Detail | — | — | awaiting 10-bills-detail.md |
| Category Manager | — | — | awaiting 11-category-manager.md |
| Behaviours | — | — | awaiting 12-behaviours.md |

---

## Quick Commands Reference

```bash
# See all commits touching foundation since 5ad21c0
git log 5ad21c0..HEAD --oneline -- DESIGN.md frontend/app/layout.tsx frontend/components/BottomNav.tsx

# See detailed diff of foundation
git diff 5ad21c0..HEAD -- DESIGN.md frontend/app/layout.tsx

# See all web files changed since baseline (useful for planning next batch)
git diff 5ad21c0..HEAD --name-only

# Grep for a specific component or hook in all changes
git diff 5ad21c0..HEAD -- frontend | grep -i "usePreferences"

# Cherry-pick a specific commit into mobile branch (if applicable)
git cherry-pick <commit-sha>
```

---

## Design System Policy

**Token changes in DESIGN.md** → Update mobile/lib/tw.ts and re-test all screens.  
**Navigation changes in BottomNav.tsx / Sidebar.tsx** → Update mobile/app/(tabs)/_layout.tsx.  
**New colour, radius, or spacing rule** → Update DESIGN.md frontmatter; mobile/lib/tw.ts will follow.  
**Glass surface changes** → Evaluate if mobile needs glass effect or solid fallback.

No mobile-specific visual hacks. All design changes flow through DESIGN.md first; mobile and web both implement from the same spec.

---

## Known Issues & Deferred Work

- **CategoryChip in mobile uses emoji fallback** — Web uses lucide-react icons; migration to lucide-react-native pending
- **Glass morphism effects** — Deferred for v2; mobile currently uses solid surfaces
- **Reanimated animations** — Deferred; basic Pressable state scaling in use for now
- **Behaviours screens** — Identity mirror, paradox, rhythm checkpoints not yet designed; placeholder in 12-behaviours.md
- **Badge colour tokens missing in mobile/lib/tw.ts** — violet500 (#8b5cf6) and rose500 (#f43f5e) must be added before Insights/Planning badges are ported
- **emerald600 token error in mobile/lib/tw.ts:74** — Currently #065f46 (emerald-900), should be #059669 (emerald-600); fix when auditing tokens for UI density work
- **TutorialOverlay not yet ported** — Pairs with TutorialProvider; currently web-only

---

## Questions?

- **Is my change in foundation or screen-specific?** Check README.md index or run `git log 5ad21c0..HEAD -- <file>`
- **Do I need to rebaseline?** Only after porting a batch of screens (typically 3–4 at once)
- **Should mobile deviate from web design?** No. All drift is tracked here and reconciled on next rebaseline.
