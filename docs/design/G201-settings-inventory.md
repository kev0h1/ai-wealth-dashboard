# G201 Settings inventory

Source: `frontend/app/settings/SettingsPage.tsx` at `6ad3cb5b`, read end to end on 2026-10-15. The `/settings` route renders that client component. This is the full current-product capability contract, not an IA proposal.

## Every reachable Settings capability

| Job / current surface | Control or destination | Real route, operation or gate | Preview boundary |
|---|---|---|---|
| Identity summary | Full name, email, number of connected accounts and biometric status; tiles only jump to the relevant in-page anchors | Profile state, eligible cover accounts and native biometric availability | Stand-in summary, no account fetch |
| Sign-in methods | Google primary row; Apple can be checking, unavailable, linked, linked through Hide My Email, linkable, or unlinkable | `GET /auth/identities`; Apple link is iOS-native only; unlink requires confirmation; relay accounts receive an account-merge warning | Stand-in, preserving states and confirmation. Google-link work remains pending D6/D10, so do not invent it as live |
| Display and privacy | Dark mode, **Hide balances** and **Show tips on Spend and Transactions** | `PreferencesContext`, which reconciles failed `PATCH /preferences` saves. Hide balances writes `hide_net_worth` and masks balances globally. Tips writes `show_tips`, separate from push insights | Real `Toggle`; no saving in preview |
| Plan | Current plan, billing/plan picker entry, Penny usage | `YourPlanCard` plus shared Penny usage fetch | Render production `YourPlanCard` with fixture props |
| Penny permission | Status only when off; when on, confirm-gated **Turn off** revokes consent and cancels unconfirmed proposals | `rawPrefs.penny_agent_consent`, `DELETE /penny/agent-consent`, then preferences refresh | Stand-in state. Never offer a direct Settings opt-in or imply Penny executes without confirmation |
| Connected assistants | Connected OAuth clients, disconnect confirmation, allowance, activity route and contextual plan state | Entirely absent unless build-time `MCP_CONNECTOR` is enabled. Current production keeps it off and does not fetch connections | Render only as a clearly labelled gated stand-in; no pretend connection or API call |
| Notifications | Browser support, browser permission, web master switch, native granted/prompt/denied/checking status; blocked permission, delivery retry and local Register this device recovery; seven topic preferences | Push permission and subscribe/unsubscribe APIs; Capacitor permissions and token registration; serialised `notification_prefs` saves | Stand-in all platform states and topics. Preserve the difference between OS permission, delivery registration and topic preference |
| Cover-plan sources | Eligible source accounts, current cover route, per-account inclusion, skipped-short accounts, failure caveat | Cached accounts, `GET /today/cover-plan`, serialised `cover_plan_excluded_accounts` updates. Only appears with eligible accounts | Render production `CoverPlanSourcesCard` with fixtures when useful. G200 owns its detailed design; G201 only provides a labelled drill-in boundary |
| Financial profile | Income; at £100k+ pension and Child Benefit; tax breakdown route after a bracket exists | `income_value`, `pension_annual`, `has_child_benefit` through preferences; `/tax` | Stand-in fields and conditional state, no writes |
| Native security | Biometric unlock | Native Capacitor biometric store or React Native bridge; absent on ordinary web | Stand-in only in native fixture state |
| Data | Re-sync 90 days of history; review payments/bills set aside from projections | `api.syncHistory`; `/upcoming/dismissed` | Stand-in, mark the sync action inert |
| Profile | Save full name and home postcode | `GET/PATCH /profile`; name helps identify own-account transfers, postcode supports local fuel prices | Stand-in, no save |
| Guidance | Replay Getting started, Accounts, Spend, Upcoming or Planning tours | `TUTORIAL_FLOWS`, `startFlow` | Use real `TUTORIAL_FLOWS` labels through inert handlers |
| Legal | Terms and Privacy | `/terms`, `/privacy`; native-shell path remains a known C17 concern | Inert labelled links |
| Leave / deletion | Sign out; delete account and all data | Sign out has no confirmation. Deletion is isolated, destructive and requires typing `DELETE`; clears onboarding and local session after server deletion | Both must be isolated from routine settings. No destructive action in preview |

## Cross-page configuration that belongs in navigation

Pay period is a real settings-shaped job but has no Settings row yet. The same `PayPeriodSettingsSheet` is currently opened from Spend and Planning. Its public contract is `current: PayPeriodConfig`, `onClose`, and `onSave(config)`; production callers persist through `PreferencesContext.setPayPeriodConfig`. A G201 preview may render the real sheet against fixture state but must not claim that the production route already exposes it.

## Current gates and states that navigation cannot flatten

- Connected assistants is build-flag gated and invisible when `MCP_CONNECTOR` is off.
- Cover sources disappears with no eligible accounts. Its loaded, failed and skipped-short states change the meaning of a source row.
- Apple linking exists only in native iOS; a relay identity is not an ordinary linked Apple identity.
- Biometrics exists only when the native shell reports support.
- Financial profile reveals pension and Child Benefit only at the relevant income bracket.
- Notification topics remain meaningful even when browser or OS permission is blocked: permission, registration and preferences are separate facts.
- Penny consent can only be revoked here. It is not a generic on/off control.

## Current count and placement problem

The page has 15 rendered groups, three confirmation dialogs, and a plan-picker sheet owned by `YourPlanCard`. The typical web path is a long stack of around 13 groups before deletion. Sign out is embedded in Account, while deletion is several sections later. The fresh round must use job-based wayfinding, put deep configuration on drill-ins, and keep sign out and delete apart at the end.

## Changes since the 3 October inventory

- G189 added `show_tips`, an in-app visibility preference. It is not the existing push topic `notification_prefs.insights`.
- G236 added the one global Hide balances control (`hide_net_worth`), which masks balances across the app and starts masked until preferences are known.
- A138 added native push resync/retry recovery and the conditional **Register this device** action after a failed test notification. A preview needs a native recovery/attention state, not merely an on/off toggle.

## G94 prior art, read-only

The rejected `feature-G94-fold-in-approved-variant-c` remains useful only as evidence. Reuse the task-first grouping, one-line group orientation, omission of empty groups and trailing status values. Do not reuse its stale production component claims, fabricated flattened rows, same-width card grid, or its combined sign-out/delete treatment. The previous preview lives at `app/design/g94-settings-canvas`; it is reference material, not production truth.

## Preview reuse boundary

Safe production imports are `Toggle`, `ConfirmDialog`, `SheetFrame`, `PayPeriodSettingsSheet`, `YourPlanCard`, `CoverPlanSourcesCard`, `ConnectedAssistantsCard` and `TUTORIAL_FLOWS`, all driven only by local fixtures or inert callbacks. Notifications, sign-in methods, profile, financial profile, biometrics, data, legal and deletion are inline in `SettingsPage`; represent them as visibly labelled stand-ins. Previews must make no API calls, save no preference, link/unlink no provider, trigger no notification, sign out nobody and delete nothing.

The fresh D/E/F implementation was checked against this inventory: D keeps all jobs in the directory, E separates the three reversible display/privacy preferences from deeper work, and F retains the same destinations while opening one chapter inline. The G200 destination, pay-period sheet boundary, notification recovery path, Apple relay state, connector gate and type-DELETE boundary are explicit inventory items, not invented capabilities. Final TypeScript, lint, production build and local browser matrix passed, with all 19 captures opened and valid through the full top of each page. This is scoped preview evidence only, not deployment or a user choice.
