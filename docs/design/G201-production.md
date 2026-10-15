# G201: approved D production fold-in

Kevin chose D, Task directory, on 2026-10-15. This is the existing Calm Cockpit Operate surface, not a new design round. The approved reference is the D implementation in `app/design/settings-overhaul` at `1fafb25d`; its fixtures are not production logic.

## Direction contract

THESIS: Settings becomes a task directory, with deep configuration one level down and no long mixed stack.

OWN-WORLD: preserve D's Figtree/slate/indigo canvas, quiet identity header, 16px section headings, 14px task rows and standard control cards. No hero or new identity.

STORY: identify the account, search or choose a job, edit real settings, return to the directory. Settings navigation never itself changes a preference.

FIRST VIEWPORT: identity, linked-provider facts and plan/accounts/security links precede search. The six D groups retain their approved order. Phones show hub or detail; desktop keeps a 400px directory beside the active detail. Sign out and deletion remain isolated after the directory.

FORM: Kevin's approved D is pinned. No concept roll is needed. Use real data, guards, handlers and components, not preview stand-ins. Preserve capability gates, preference rollback, native notification behaviour, consent revocation only and type-DELETE deletion. Pay period uses the existing preference saver and sheet.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Acceptance and boundaries

- Stable, history-aware detail links and Back; search uses complete job keywords and has an honest empty result. Dynamic summary values never use fixture names, counts or prices.
- Existing authentication, finance, notification, cover-source and profile operations retain their semantics and failure handling. G200 owns the cover-card design, so only its placement changes here.
- All capabilities in `G201-settings-inventory.md` stay reachable, subject to their real gates. Account deletion has its own page and requires `DELETE`; sign out is outside routine cards.
- Verify both themes, narrow phones and desktop, search/back/focus, pending/error/empty states and real callback wiring. Independent production diff review must compare the approved D structure with the shipped components.
- Remove the temporary `settings-overhaul` preview and index entry under H113 only after checking other open references/importers. No production code imports previews.
- The helper was unavailable (permission denied); the skill's permitted existing-context fallback is used. Preserve incumbent DESIGN.md and tokens. No new raster assets or external model calls.

## Production handoff and evidence

This document records the production fold-in, not a design preview. Kevin approved direction D on 2026-10-15. The implemented structure is a six-group task directory with real detail URLs, a searchable directory, a 400px desktop directory rail beside detail, isolated sign-out and deletion exits, and a dedicated deletion page guarded by typed `DELETE`. The original Settings handlers remain structurally intact; the deletion error state now belongs to the deletion page. Existing effects remain unchanged except for the retryable account loader.

### Source and system comparison

- Source direction: `frontend/app/design/settings-overhaul` at `1fafb25d`, used only as the approved D reference. The preview and its `app/design` index entry were removed under H113 after checking for imports and open-item references. No production code imports the preview.
- Production implementation: `frontend/app/settings/SettingsPage.tsx`, `frontend/components/settings/SettingsDirectory.tsx`, and `frontend/lib/settingsNavigation.ts`. These preserve the incumbent Calm Cockpit system: Figtree, slate surfaces, indigo actions, quiet identity header, 16px section headings, 14px task rows, standard control cards, and the existing capability gates and handlers.
- The directory owns wayfinding only. Detail links use `/settings?section=...`; pay period keeps the existing preference saver and sheet. Search matches complete task keywords and reports an honest empty result. Account deletion is a separate route state and requires the exact `DELETE` confirmation.
- The existing `DESIGN.md` remains authoritative. This worktree has no `.impeccable/design.json` sidecar; an ordinary extension does not invent or refresh one. No global tokens or product identity were changed.

### Verification record

Real production JSX was exercised with inert-context browser checks at 390px and 320px, and at 1440px, in light and dark themes. The final 27 captures and checks cover search, history-aware links, failed profile save and deletion, the typed `DELETE` guard and its reset on leaving, relay-primary sign-in, and native granted/blocked notification permission. Loading, empty and account-retry wiring were reviewed in source. These are component-level checks, not authenticated production or UAT proof. The final production build and TypeScript check passed. Focused G201, privacy, tips, design-index and design-stale checks also passed.

The independent production review requested one relay-primary identity correction. After the fix and recapture, its verdict scored that fix resolved, retained the normal Google-primary case and native notification gate, and returned `disposition: ship` at the scored-fix scope. The shared `settingsIdentityState` helper and regression cases now keep the hub, method count and detailed provider rows consistent. The specialist reviewer/documenter roles were unavailable; fresh independent available-model agents used their fallback contracts. The skill launcher and detector were not executable, so the existing-context and manual audit fallbacks were used. No external model call or raster generation was needed.

The final source-only comparison found the local `DeleteConfirmation` mount and typed-value reset confined to the deletion page, and retry reset flags limited to the retry action. The structural audit preserves the original named operation bodies except deletion error presentation, and the original effects except the retryable account loader. Typography, palette and DOM presentation remain aligned with the incumbent `DESIGN.md`; no global design files or tokens were changed. Focused lint comparison found six pre-existing errors unchanged, with no lint errors in the new files. Lint is not claimed green.

### Handoff status

The UI fold-in and independent review are complete. Delivery uses normal `scripts/session.sh finish G201`, not `--uat-review`: it must pass the disposable per-run database backend suite, TypeScript and every registered `check:*` gate before pushing and moving the board item to review. The board records that delivery result. Only the coordinator may merge and rebuild UAT; this work does not deploy or restart services.

Five-line system summary:

1. Palette: Calm Cockpit slate canvas and surfaces, with indigo for actions and neutral or amber status states.
2. Type: Figtree for interface copy, with the incumbent mono and tabular treatment for money and figures.
3. Layout: task-first directory, six compact groups, 400px desktop rail, and hub-to-detail navigation on phones.
4. Surfaces: standard rounded control cards and canvas-led orientation, with no new hero or identity treatment.
5. Rules: navigation changes no preference; gates and rollback stay real; deletion is isolated and requires typed `DELETE`.

Defects and drift not canonised: the removed preview's stand-ins, corrected relay identity defect and six inherited lint errors are not design-system rules. No unrelated financial, notification or authentication refactor was introduced to clear existing lint debt.

## Rejection correction, 2026-10-15

The legacy Accounts resubscribe URL, `/settings?plans=1`, now resolves to the visible Penny and plan detail. The existing plan card mounts only in that section and resets its mount when the resubscribe marker changes, so its unchanged auto-open effect also works when arriving from another detail or an already-open plan section. Billing success and cancellation returns open the same detail without automatically opening the picker. Valid explicit sections retain precedence, and unavailable assistant links still return to the directory. No billing action, preference handler or approved D presentation changed.

Impeccable's hardening checks guided the URL and hidden-state regression audit. The focused regression gate and TypeScript passed. An independent production diff review found no blockers. Actual Settings, plan card and picker JSX passed inert-context browser checks for cold and warm links, delayed plan information, close/back/history, billing returns and invalid or gated queries in both themes, with 320px/390px/1440px bounds and keyboard dismissal. Six new captures were visually inspected. This is component-level evidence, not authenticated UAT or physical-device proof; all API and billing writes were inert or blocked. The existing URL resolver regression cases are permanent; the component browser harness is local verification evidence.
