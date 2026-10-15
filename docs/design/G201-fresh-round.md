# G201 fresh Settings round

## Factual brief, pending direction

The external Astra request was waived by Kevin on 2026-10-15. The helper and launcher were unavailable (permission denied), so these directions are a local code-led review against the incumbent system. This is a navigation round inside the Calm Cockpit world, not a visual-identity reset.

## Chosen direction contract

All variants retain the same product truth and fixture-only boundary, but organise the work differently.

- **D, Task directory** is the default. A quiet identity header, search and meaningful trailing states lead into task rows: Manage your money, Make the app yours, Notifications, Your account, Penny and your plan, Help and information. Phones move hub to drill-in and back; desktop keeps the directory alongside active detail.
- **E, Quick preferences and deeper tasks** gives the three safe, immediately reversible Display/privacy controls a compact, real-control block at the top. Stateful, financial, permission and authentication tasks remain in the directory. Desktop makes the preference rail and directory deliberately distinct, without a card wall.
- **F, Expandable task chapters** keeps the hub in place and opens one task chapter inline. Deep editors still use dedicated pages. Back preserves the open chapter and search keeps matching chapters and rows visible.

Every direction includes a distinct **Cover-plan safeguards** destination under Manage your money, named as the hand-off to G200 rather than a redesign of that surface. Sign out is outside routine groups. Deletion has an isolated type-DELETE local confirmation and a fixture-only outcome.

The scoped preview was compared with the incumbent `Toggle`, `ConfirmDialog`, `SheetFrame`, `PayPeriodSettingsSheet`, `YourPlanCard`, `CoverPlanSourcesCard`, `ConnectedAssistantsCard` and `TUTORIAL_FLOWS` contracts. Production pieces are imported where their prop contracts support fixtures; inline rows remain labelled stand-ins for JSX owned by `SettingsPage`. This is component evidence, not a QA pass.

### Scope

- Work only in the existing `frontend/app/design/settings-overhaul/` preview and this round's documentation.
- Retain A/B/C as earlier reference directions. The fresh work, if approved, is D/E/F and defaults to D.
- Do not change production Settings, the design index, package metadata, board state, services or external data.
- Settings is an **Operate** surface in the existing Calm Cockpit visual world. The round may change information architecture and page structure, not global product identity.

### Product contract

The complete present capability map is in [G201-settings-inventory.md](G201-settings-inventory.md). No preview may omit a capability merely because it is gated or conditional. It must instead show the gate, omission rule or honest local fixture state.

In particular:

- Deep configuration has a drill-in, including a distinct G200 cover-plan destination.
- Pay period may use the real, fixture-driven `PayPeriodSettingsSheet`, but production does not yet expose it from Settings.
- The preview must never assert an unsupported Google-link flow, a Settings-based Penny opt-in, or a live connected-assistant connection.
- Permission, registration and preference are separate for notifications. The native recovery path needs an attention state.
- Sign out and deletion are separate endpoints at the end of the journey. Deletion is destructive and type-DELETE confirmed in production, so both preview actions are inert.

### Implementation and QA contract

- Use only local fixture state and inert callbacks. No API call, navigation to an account-changing action, preference save, notification, provider link/unlink, sign out or deletion is permitted.
- Prefer real production components where their prop contracts support fixtures: `Toggle`, `ConfirmDialog`, `SheetFrame`, `PayPeriodSettingsSheet`, `YourPlanCard`, `CoverPlanSourcesCard`, `ConnectedAssistantsCard` and `TUTORIAL_FLOWS`. Inline production blocks remain clearly labelled stand-ins.
- The query contract supports default D, light/dark, 320px and 390px phone layouts, intentional desktop, and ready/blocked/attention/relay/empty states.
- Review controls belong in document flow and cannot cover task controls. The preview needs keyboard-reachable navigation and an honest static-preview notice.
- Before hand-off, root will run the preview through its chosen checks. This workstream does not run browser, build, service or Git actions.

### Preview query contract

`/design/settings-overhaul?variant=d|e|f&page=hub|money|financial|cover|display|notifications|account|penny-plan|assistants|help|delete&state=ready|blocked|attention|relay|empty&mode=light|dark&sheet=pay-period|financial&chrome=0`.

- Missing `variant` resolves to D. A/B/C remain available as earlier reference directions.
- `state=blocked` demonstrates blocked notification permission; `attention` demonstrates delivery retry and local registration recovery; `relay` demonstrates the Apple relay identity; `empty` removes conditional accounts, assistants and native capability.
- Search, quick preferences, chapter expansion, sheet save and fixture outcomes are client-local. F preserves the open chapter and captured scroll position when returning to the hub; this is preview behaviour, not a claim about production persistence.

F now preserves the open chapter and captured scroll position locally when returning to the hub, and shared `Toggle` controls update local preferences. That is preview evidence only, not production persistence.

## Six-block direction contract

**THESIS:** Turn a long settings stack into calm, job-based wayfinding while keeping every real capability and gate visible.

**OWN-WORLD:** Extend the incumbent Calm Cockpit: Figtree body, mono/tabular money, slate surfaces, neutral states and indigo actions. Do not promote local composition into a global identity.

**STORY:** Orient in the hub, choose a job, inspect detail, and return without losing local chapter or scroll context.

**FIRST VIEWPORT:** D is the default task directory; E puts safe display/privacy preferences first; F opens one task chapter in place. A to C remain references only.

**FORM:** Preserve the complete capability inventory, including gated states, separate notification permission/registration/preferences, distinct sign-out and deletion, and the G200 hand-off. Effects remain fixture-local.

**FINISH:** Reviewer disposition is **SHIP**, scoped to the listed fixes. Final TypeScript, lint, production build and local browser matrix passed, with all 19 captures opened and valid through the full top of each page. Permission, delivery and topic states remain explicit, and local device registration returns the fixture to Ready. This does not claim deployment, full finish or a user choice.

### Prior evidence

G94 supports task-first grouping, orientation copy, removal of empty groups and trailing status values. It does not support a flattened card grid or a combined sign-out/delete treatment. The incumbent `settings-overhaul` A/B/C code is reference material only until a fresh direction is agreed.
