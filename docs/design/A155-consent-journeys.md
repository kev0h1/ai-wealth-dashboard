# A155: new consent journeys

## Approved G production fold-in (8 October 2026)

Kevin chose G and requested the search move up under the title, with no bank
rows showing above or behind it. This supersedes the design-only delivery
instructions recorded for the earlier round below.

- Skill: impeccable, layout and polish, preserving the approved Calm Cockpit
  structure. Web Interface Guidelines supplies the final accessibility check.
- Finexer `BankPickerSheet` now renders `BankConnectionFlow`. Selecting a bank
  only opens its review. The existing native, React Native and web transport
  starts solely from **Continue to Finexer**. Legacy provider behaviour is
  retained. No Finexer template, regulatory constant or backend change.
- `BankSearch` lives in an optional fixed `SheetFrame.bodyHeader` slot, passed
  through `UpcomingFlowSheet`. It is not a sticky descendant of the results.
  Title, opaque search strip, and results have contiguous boundaries; only
  results scroll. The input remains 44px tall with 16px text. Other sheets omit
  the new slot and retain their existing structure and focus/history contract.
- G's preview renders that same production flow with fixture banks and inert
  callbacks, including loading, empty-list, retry and pending states. There is
  no copied G screen markup. Its provider illustration appears as a separate
  fixture page after handoff, not a second sheet. H/I remain unapproved
  alternatives. Earlier A-C fixture selections cannot start live connections.
- The full `AGENT_DISCLOSURE`, its 13px type and 22px leading, the selected-bank
  summary and the reading/action hierarchy are preserved. The disclosure check
  now pins the new production notice as well as the legacy consumers.
- Regression coverage verifies the search is outside the scroll body, its
  edges meet the header/results exactly, its background paint is fully opaque,
  and hit-testing at both edges never exposes a bank row. Tests exercise initial,
  partial-scroll, deep-scroll, filtered, cleared and returned-to-list states.
  The repeatable runner supports `A155_QA_VARIANTS=g` for the approved surface.
- The independent code and screenshot review returned **ship**. Phone and
  desktop light/dark screenshots are under `.impeccable/review/a155-g/` locally.
  A claimed capture anomaly was rechecked against each original file and
  withdrawn by the reviewer: the fixed heading and search are visible.
- The completed approved-G browser run passed all 41 captures at 390 x 844
  and 1280 x 900 in both themes, 320 x 640 light, plus a 390 x 450 short
  viewport. Filtering, clear, query/focus restoration, browser Back/Escape,
  full notice, inert handoff, load/retry/empty/pending states and zero live
  connection requests passed. Earlier H/I checks also passed in the wider
  comparison matrix; an interrupted rerun was replaced with the shorter
  complete approved-G batch rather than reported as a successful run.
- Production build, TypeScript, new-file ESLint and focused disclosure,
  bank-return and sheet-anatomy checks pass. Broader ESLint reports the same
  six pre-existing React hook diagnostics in `BankPickerSheet`/`SheetFrame`
  as their pre-change sources; no unrelated hook refactor is bundled here.
- The skill's interactive browser runner is unavailable, so verification uses
  the repository's installed headless Chrome/Playwright runner instead. No
  physical iPhone keyboard, Safari engine or live bank authorisation is claimed.
  The context/detector launcher was unavailable; manual source and visual
  checks are used rather than bypassing host restrictions.
- Delivery is a normal `session.sh finish A155`, not another choice round.
  The coordinator remains responsible for merging and updating UAT.

## Original round 3 proposal record

## Brief and boundaries

Kevin rejected A to F and asked for more designs, not implementation: the
required agency wording now needs to belong to a consent journey that flows.
This round adds G, H and I at `/design/bank-consent-journeys`. Earlier previews
and every production connection component and Finexer template stay unchanged.

Mode: Operate, with impeccable for the journey and emil-design-eng for
same-frame interaction. PRODUCT.md and DESIGN.md override skill defaults.
The repository requires coded previews, so these are functional fixtures, not
image compositions. The impeccable context launcher was not executable;
project context was read directly. The optional OpenRouter draft was not sent:
external brief disclosure and credential use were refused pending permission.

## Direction contract

- **Thesis:** make the required wording a considered part of connecting, not
  small print competing with the bank list.
- **Own-world:** Sorted's Calm Cockpit, existing type, solid sheet surfaces,
  neutral information and one indigo action. No invented trust badges.
- **Story:** choose a bank, understand the connection, review Finexer
  permissions, then approve at the bank. Show who owns each boundary.
- **First viewport:** a clear next action and useful context, not the entire
  legal and permission journey at once. The full notice remains readable and
  uncollapsed in its designated step.
- **Form:** G separates selection and review inside one persistent sheet;
  H folds the chooser into an inline connection summary on the same page;
  I places the notice in the existing provider step, conditional on approval.
- **Finish:** true phone widths and desktop, both themes, back/change/search,
  error recovery, provider boundary and keyboard/focus checks. No live APIs.

## Options and decisions

G, **Bank first**: choose, review a bank-specific summary with the full notice,
then continue to Finexer. One extra reading step, but each screen has one task.

H, **One continuous page**: choosing a bank folds the list into a selected row;
the notice and action stay in that same surface. Fewer view changes, with more
content on one page. Changing bank preserves the query and selected bank.

I, **Notice at consent**: choose a bank in Sorted, then show the full notice in
the Sorted intro of the already-required Finexer consent page. This removes a
Sorted interstitial but explicitly needs Finexer approval before production.
The hosted screen is an illustration, not a claim of provider implementation.

Rejected approaches are not re-presented as choices: repeated footers, a
disclosure expander, shrinking the legal text, another introductory modal,
invented consent checkboxes and a new security promise.

## Copy and permission invariants

- Import `AGENT_DISCLOSURE` unchanged, including firm reference 925695.
- This is read-only account information, not authorisation of a payment.
- Continue to Finexer describes a handoff, not granted consent.
- Preserve the provider permissions, NEXT/CANCEL controls and regulated
  footer in the mock. Local preview controls never invoke them.
- G/H show the full notice before the provider handoff. I is explicitly
  conditional on Finexer approval, not a compliance recommendation.
- No access duration, credential-sharing guarantee, account support claim,
  fake connected state, balance or actual authorisation.

## QA inventory

| Claim or control | Functional check | Visual evidence |
| --- | --- | --- |
| Three distinct journeys | G review, H inline fold, I provider notice | Each selection and notice step |
| Disclosure unchanged and readable | Static exact-copy check, no collapsed carrier | Phone and desktop, both themes |
| Search stays stable | Type, clear, empty results, list scroll | Empty and typed input 44px, 16px text |
| Choice is reversible | Change bank and Back retain query | Selected row and restored list |
| No stacked popups | One dialog across internal steps | Same frame and persistent close |
| Provider boundary is honest | Mock permissions inert, local continue | Illustration and approval labels |
| Error recovery | Simulated failure, retry, back | Error state and restored provider |
| No real connection | No connection requests; sandboxed static iframe | End says no bank connected |
| Accessible controls | Focus, Escape, browser Back, tap targets | Focus ring, 320px fit, short viewport |
| Landing and theme | Open each journey, close, change theme | Comparison page, light/dark |

Explore rapid Back/re-entry and changing a bank after a filtered search.
Software-keyboard behaviour on a physical iPhone cannot be proven by desktop
emulation; use the shared production sheet's measured viewport handling and
report that limitation rather than claiming an on-device test.

## Incumbent system check

- The previews use the incumbent `UpcomingFlowSheet`, which in turn renders
  the production `SheetFrame`: one portalled dialog, solid glass-sheet surface,
  persistent title and close control, independently scrolling body, persistent
  footer, safe-area padding, Back/Escape/history handling and focus restoration.
  G, H and I therefore preserve the existing multi-step sheet boundary rather
  than introducing a second modal or a new consent shell.
- Existing vocabulary is Figtree for interface copy and JetBrains Mono for
  tabular figures, with the shared slate canvas/card surfaces (`#f0f2f7`,
  `#ffffff`, dark `#0f172a`/`#1e293b`), 16px-or-larger rounded surfaces,
  hairline borders and one Adviser Indigo action (`#4f46e5`/`indigo-600`).
  The route uses indigo for actions, links and focus rings, neutral slate for
  explanation, and no Penny indigo-to-violet gradient.
- The controls match the incumbent grammar: 44px-or-larger close, Back,
  search, bank-row and primary-action targets; 16px search input text; visible
  indigo focus rings; bank marks from the existing fixture shape; and dark
  variants using slate surfaces and borders. `AGENT_DISCLOSURE` is imported
  unchanged, including firm reference 925695.
- The only deliberate boundary extension is the provider illustration in I:
  `HostedConsentPreview` places the unchanged notice in a mock Finexer intro.
  It is labelled preview-only and requires Finexer approval before any
  production change. No production connection component, provider request,
  `BankPickerSheet` behaviour or disclosure source is changed by this round.
- Pre-existing drift remains outside this round: the incumbent `BankPickerSheet`
  still owns live provider loading and handoff behaviour, while these previews
  use `fixtureBanks` and local navigation; the mock hosted screen uses its own
  illustrative provider styling. This documentation records that separation,
  and does not treat either surface as a production implementation.

## Verification and handoff

- Production-mode build and TypeScript pass. Existing A155 production golden,
  new journey/render checks, design index and no-live-data checks pass. The
  no-live-data check reports only its eight pre-existing warnings outside this
  route; these previews make no provider or connection requests.
- New-route ESLint also passes. A post-review origin-initialisation change uses
  the same hydration-safe snapshot pattern as the shared sheet. The independent
  reviewer checked that exact non-visual delta and retained the ship disposition.
- Browser matrix passed at 390 x 844 and 1280 x 900 in both themes, plus
  320 x 640 light. Sixty captures cover selection, reading, provider illustration,
  its bottom controls, empty search, end boundary, landing and simulated error.
  The repeatable runner is `scripts/design_a155_qa.py`; local evidence is under
  `.impeccable/review/a155/` (ignored review artefacts, not shipped assets).
- Verified stable 44px search with 16px text, sticky search after scrolling,
  case-insensitive filtering and clear, preserved query on changing banks,
  a single dialog, Back/Escape/browser Back, opener focus restoration, theme
  switching, inert provider NEXT, retry and an honest end-of-preview state.
  Visible sheet bounds and document horizontal overflow are checked separately.
- Independent fresh-context review returned **ship**, with no material fixes,
  for these design previews, not regulatory approval or production sign-off.
  The skill-specific reviewer role was unavailable, so an independent
  implementation reviewer covered the same review contract. A separate
  documentation check preserved the incumbent system files.
- The impeccable detector could not execute (permission denied). Web Interface
  Guidelines and manual code/screenshot review covered the available checks.
  No claim is made about a physical iPhone keyboard or real provider handoff.
- Finish this as `--uat-review`. Kevin compares G/H/I after the coordinator
  publishes the route. A choice requires a separate production fold-in round,
  and I additionally requires Finexer approval for the notice placement.
