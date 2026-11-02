# G389: Accounts refresh placement

Kevin approved Home option A on 2 November 2026: a labelled Accounts action beside the greeting. This round resolves where the displaced visible refresh action lives on Accounts. It is a local extension of the current Accounts header, not the broader G391 page redesign. The supplied phone image establishes the current title, Net worth card, Add corner, search and grouped account list. Fixtures are synthetic and do not reproduce the customer's names or balances.

## Direction contract

**THESIS:** Accounts is the named place to inspect accounts and request fresh bank data. Refresh and Add are distinct actions, with the result visible beside the data they concern.

**OWN-WORLD:** Inherit the Calm Cockpit, Figtree, mono money, slate light/dark surfaces, neutral errors and 44px controls. No new visual identity or financial colour meaning.

**STORY:** Enter through approved Home A, recognise Accounts, request a bank refresh, see what is still updating, and retain the last-known figures when it fails. Add uses clear action names.

**FIRST VIEWPORT:** Keep Accounts above its existing Net worth instrument. A pairs a refresh icon with the Add plus in the upper-right corner. B keeps Add there and puts a labelled Refresh banks action beside freshness in the instrument footer. Search and existing grouped rows follow.

**FORM:** Two coded refinements of the established surface. No concept seed: this is a precisely scoped extension. Both themes serve people checking their phone in bright daylight or a dim room.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

The existing DESIGN.md remains the authority. This round introduces no durable system changes or shipping rasters.

## Behaviour contract

- Refresh means connected banks. Investment prices, uploaded statements and manually maintained accounts have separate update paths.
- The Home action currently calls `api.syncAll()`, the same `/accounts/sync` endpoint as `api.syncAccounts()`. Finexer work may continue after its response, so request acceptance must not be shown as every bank having finished.
- Preserve last-known figures and bank-data times during work and failure. A bank refresh time is not the Net worth calculation time. Never stamp a new time solely because a request returned successfully.
- Show updating, partial completion, failure, cooldown, a paused subscription and no connected banks. Allow a safe retry and keep Add available. Error messages stay neutral. Refresh has an accessible action name even in icon form.
- Keep the existing per-account refresh and its bank-data time. The overview action does not replace it.
- The current aggregate response does not supply per-bank completion results. The prototype's partial-result state is an acceptance requirement for fold-in, not a claim that this data already exists. Fold-in must either derive verified states from account data or add a bounded response contract before promising aggregate completion.
- Account-add copy follows audit F6: Connect a bank, Upload a statement, Add an investment, Add an offline account. Explain a subscription restriction where bank connection is sought, with a route to subscription management.
- Local interactions only. Neither prototype reads customer data, calls banking APIs, changes preferences nor adds accounts.

## Audit follow-through

| Finding | Work item and next step |
| --- | --- |
| F1 Accounts discovery | G389: Home A approved; settle refresh placement here, then fold in the complete journey. |
| F2 Undo failures | G392: persistent truthful rollback feedback, retry unfinished work and retain correct invalidation. |
| F3 Transfer-review deep links | G392: open review even when the preliminary count fails or is zero. |
| F4 Search accessibility | G392: durable label, clear target and results feedback. |
| F5 Search continuity | G392: query/page/filter navigation and an explicit cold-entry return. |
| F6 Add actions | G389: preview verb labels and the subscription explanation alongside refresh. Coordinate any broader layout changes with G391. |
| F7 Subscription vocabulary | G392: billing/cancel/subscription/plan discovery. |
| F8 Planning discovery | G393: validate with task evidence before changing routes. |

## G393 task protocol

Use a new one-bank member and a returning member, starting each task on Home without naming a tab. Ask them to set aside groceries, save for a holiday, see the plan for next payday, and find the account paying a bill. Record the first tap, wrong turns, whether they finish without hints, and where they expect the feature to live. Evaluate the existing Planning-to-Upcoming link and permanent Penny payday hub before proposing another route. The task wording is ready; no participant outcome is claimed.

## Verification

Root and an independent reviewer inspected ten Chrome captures: A/B in light/dark at 390px, A light/B dark at 320px, A dark/B light at 1280px, the masked partial state and the paused-plan Add menu. The verdict is **READY**. No clipping or horizontal overflow was found; money signs survive masking, bank-data time stays unchanged and primary targets measure at least 44px. Captures are local review evidence under `.impeccable/review/accounts-refresh/`, not shipping assets. Two interaction captures include the local Next development indicator.

`node app/design/accounts-refresh/preview.browser.mjs` passed against the isolated worktree server. It checks all six states for both placements, request acceptance without a fabricated new timestamp, partial/failure outcomes, Statements eligibility, keyboard menu navigation and focus return, account-search clear/focus, masked negative amounts, and the labelled Home A entry. No API request or runtime exception occurred. The page exposes its ready marker after hydration so browser interactions cannot run against the server-rendered shell. Targeted ESLint and the initial production build passed; the repository finish gate checks the final type state and full suites before handoff.

Independent source review also checked the behaviour contract against `DESIGN.md` and the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Its timestamp and continuous-motion findings were fixed before visual sign-off. This was a standard independent review because no dedicated Impeccable finish-reviewer role was available. This local extension requires no new DESIGN.md rule and creates no raster assets for shipping.

Preview routes after coordinator integration: `/design/accounts-refresh?variant=a` and `?variant=b`. The original Accounts-entry preview remains as the approval record until the complete chosen journey is folded in, when H113 cleanup applies to both rounds. The approved Home A and production Accounts components are deliberately not folded in during this choice round.
