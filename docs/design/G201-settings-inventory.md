# G201 Settings inventory

Source: `frontend/app/settings/SettingsPage.tsx` on main at ec72388f (1,832 lines). Read end to end on 2026-10-03.
Lines 1 to 1038 are state, effects and handlers. The rendered page is lines 1061 to 1830, about 770 lines of JSX, 15 blocks plus 3 dialogs.

Route shape: `/settings` (`app/settings/page.tsx`, 10 lines) renders `SettingsPage`. Reached from the Home top-left avatar (DESIGN.md settings placement rule: no nav tab; the avatar opens the Account hub, which is `/settings` itself) and from the desktop sidebar Settings row.

## Block-by-block

| # | Block (current heading) | Lines | Controls inside | Opens / navigates | Reads / writes | Gating |
|---|---|---|---|---|---|---|
| 1 | Identity hero (no heading, `glass-hero`) | 1077-1128 | avatar, full name, email; "Accounts N connected" tile; "Security Face ID on/off" tile | both tiles `jumpTo` an anchor on the same page (`settings-accounts`, `settings-security`) | `profileLoaded.name`, `user`, `coverAccounts.length`, `bioState` | Accounts tile once accounts load; Security tile native shell only |
| 2 | Sign-in methods | 1130-1205 | Google row (always shown, "Primary" chip), Apple row with 5 states (checking, error, linked + Unlink, iOS native + Link Apple ID, "Link from the iPhone app"), link/unlink message | Unlink opens ConfirmDialog (dialog 2, `destructive`, SettingsPage.tsx:1812) | `GET /auth/identities` (`api.getIdentities`), `linkAppleIdentity`, `api.unlinkAppleIdentity` | Link Apple iOS native only. D6/D10 will change this block |
| 3 | Display | 1207-1243 | Dark mode toggle, save-error line | none | `PreferencesContext.darkMode` / `setDarkMode` (`PATCH /preferences dark_mode`) | always |
| 4 | Your plan | 1245-1253 | `YourPlanCard`: plan subtitle, Penny usage row, "See plans" | opens the plan picker sheet inside the card | `GET /subscription` via `usePennyUsage` | always (component, B5) |
| 5 | Penny | 1255-1327 | consent state row (on or off copy), "Turn off" | Turn off opens ConfirmDialog (dialog 3) | `rawPrefs.penny_agent_consent`, `api.revokePennyAgentConsent`, `refreshPreferences` | always |
| 6 | Connected assistants | 1329-1341 | `ConnectedAssistantsCard`: connections list, disconnect, MCP allowance | card links to `/mcp-activity` | `api.listOAuthConnections`, `api.revokeOAuthConnection`, `pennyUsage.info.mcp*` | `MCP_CONNECTOR` build flag, off in production |
| 7 | Notifications | 1343-1496 | master push state (native: granted / denied / prompt / checking; web: unsupported / denied / toggle), "Send a test notification" (native granted), 7 "Notify me about" toggles: Tips & insights, Category running hot, Payments needing a look, Bill alerts, Goal milestones, Pay-period digest, New transactions | none | `api.subscribePush` / `unsubscribePush` / `getVapidPublicKey` / `sendTestPush`, Capacitor push permission, `notification_prefs` via `PATCH /preferences` (serial queue) | master state by platform; list once `notifPrefs` loads |
| 8 | Where money can come from | 1498-1526 | `CoverPlanSourcesCard` (live recommendation, two-step strip, account search/browse, Turned off group, skipped list, per-account toggles) plus two amber-dot status lines | none | `getAccountsCached`, `GET /today/cover-plan`, `cover_plan_excluded_accounts` via `PATCH /preferences` (`coverSaveQueue`) | at least one eligible account. Redesigned separately in G200 |
| 9 | Financial profile | 1528-1626 | Approximate income (£/yr) input; Pension contributions input; Receiving Child Benefit toggle; "View tax breakdown" | `router.push("/tax")` | `income_value`, `pension_annual`, `has_child_benefit` via `PATCH /preferences`; `incomeBracket` | pension and child benefit only when income bracket is 100k+; tax link once a bracket exists |
| 10 | Security | 1628-1644 | Biometric unlock toggle | none | `lib/biometrics` (Capacitor) or RN bridge | native shell only |
| 11 | Data | 1646-1675 | "Sync history (90 days)" button and result line; "Set aside" row | `router.push("/upcoming/dismissed")` | `api.syncHistory` | always |
| 12 | Account | 1677-1732 | Full name input, Home postcode input, Save profile (when dirty), Sign out | Sign out calls `logout()` directly, no confirm | `api.getProfile` / `api.updateProfile` | always |
| 13 | How Sorted works | 1734-1753 | 5 tour rows (`TUTORIAL_FLOWS`: Getting started, Accounts, Spend, Upcoming, Planning) | `startFlow(id)` navigates and starts the tour | `TutorialContext` | always |
| 14 | Help | 1755-1774 | Terms & Conditions, Privacy Policy | `router.push("/terms")`, `router.push("/privacy")` | none | always. C17: both links are broken in the native shells |
| 15 | Danger zone | 1776-1793 | "Delete account & all data..." | opens ConfirmDialog (dialog 1) with a type-DELETE input | `api.deleteUserAccount`, `clearLocalSession` | always |
| D1 | Dialog: delete | 1795-1805 | type DELETE to confirm | | | |
| D2 | Dialog: unlink Apple | 1807-1819 | | | | |
| D3 | Dialog: turn off Penny setup | 1821-1830 | | | | |

## Counts

- 15 rendered blocks, 3 confirm dialogs, 1 sheet owned by a child component (the plan picker inside `YourPlanCard`).
- Toggles: 11 (dark mode, 1 web push master, 7 notification prefs, child benefit, biometrics; cover plan adds one per account).
- Text inputs: 4 (income, pension, name, postcode).
- Rows that navigate away: 9 (tax, set aside, terms, privacy, 5 tours go through `startFlow`).
- Unconditional blocks: 12 (1, 2, 3, 4, 5, 7, 9, 11, 12, 13, 14, 15; the hero's two tiles are conditional inside it). Conditional blocks: 3 (6 build flag, 8 needs an eligible account, 10 native shell). A typical web user therefore scrolls 13 or 14 stacked cards.
- Sign out sits inside the Account card (block 12), 3 blocks above Delete, with Help and tours between.

## Things that are not where the brief assumed

- **Pay period is not on Settings today.** `PayPeriodSettingsSheet` opens from the Spend header and the Upcoming page only (`SpendPage.tsx` ~1320, `PlanningPage.tsx` ~1139). It is a pure props component (`current`, `onClose`, `onSave`) so a Settings row could open it without a refactor. It saves through `PreferencesContext.setPayPeriodConfig`. The variants add a Pay period row because it is a settings-shaped job, and say so.
- **No tips switch yet.** G189 adds `show_tips`. The existing "Tips & insights" push switch (`notification_prefs.insights`) gates a push fed by `analytics.compute_insights`, a different system. G189's planner note says relabel it. The variants show both: an on-screen "Tips" switch under display, and the push switch relabelled "Tip alerts" (placeholder copy, with the in-app switch named "Saving tips"; both pending G189, Kevin to confirm).
- **Identity and linking are Apple only.** D6 says the Google row is hardcoded and wrong for a Hide My Email account; D10 adds link-Google. The variants design the sign-in methods as a drill-in list that can hold one, two or zero known providers, with exactly one Primary.
- **Profile header** falls back to the email local part today for relay accounts (D6). The variants show the "no name yet" state with an Add your name prompt.

## G94 prior art (branch `feature-G94-fold-in-approved-variant-c`, rejected, 1,323 commits stale)

Read from `origin/feature-G94-fold-in-approved-variant-c`; not merged.

Reuse (idea, not code):
- Group by task with a heading and a one-line orientation sentence on the canvas, cards kept for controls. Kevin approved this as variant C "Intent groups". Reviewers called the grouping "a genuine improvement" on both rejections.
- Order Account access, Security and connected accounts, How Sorted behaves, Data and help, Leave or delete. Sign out and delete together at the end in their own group.
- `SettingsGroupSection` behaviour worth keeping: drop a group whose children render nothing (`Children.toArray`), never leave a heading over an empty body.
- Shared `SettingsCard` / `SettingsCardHeader` (icon chip, uppercase label) so the preview and production draw one boundary.

Stale or wrong, do not carry over:
- `SettingsGroupSection` / `SettingsCard` / `SettingsSupportCards` / `settingsGroupOrder.ts` do not exist on main. Only the earlier `app/design/g94-settings-canvas` preview does, and it is a fabricated mock, so it proves nothing about production.
- The `lg:grid-cols-2` per-group grid was the rejection cause: odd card counts leave dead cells, unequal heights leave gaps. Not reused. This round keeps one column at all widths inside the 430px shell, and a deliberate desktop two-pane (list and detail) rather than a card grid.
- Sign out merged with Delete in one undifferentiated card, red wrapper dropped. Reviewers rejected that. This round isolates delete on its own screen, with sign out as a plain row above it.
- The G94 fold-in dropped the status-at-a-glance (accounts connected, Face ID on) with nothing in its place. This round keeps status as the trailing value on each hub row instead.
- Its three-state Ready/Alert/Empty fabricated rows, every group one flattened card. Not reused.
- The Apple-only sign-in card and the Penny/consent copy predate D6, D10, B13 and G189.

G94 should be cancelled as superseded once Kevin picks (his call; not done here).

## Pending additions to plan for

| Item | What it adds to Settings | Where the variants put it |
|---|---|---|
| G189 | `show_tips` switch (Spend and Transactions tips, Home spotlight); relabel push "Tips & insights" | Tips switch in the Display drill-in or hub row; push switch relabelled "Tip alerts" |
| D6, D10 | Sign-in methods listing only real providers, one Primary; link Google as well as Apple; claim-from-account decision at link time | Sign-in methods drill-in with a provider list and a Link action per missing provider |
| C17 | Privacy and Terms links that work in the native shells (they will need an in-app browser or a hard navigation, not `router.push`) | Legal rows at the foot of Help, marked as external-style links |
| G200 | Cover plan safeguards card redesign | Own drill-in, placeholder here that links to G200's preview |
