# G389: finding your way around Sorted

Accounts is reachable in one tap when you recognise the right Home control, but it is not a recognisable destination in the main navigation. The failure reported by Kevin is a discoverability problem, not simply a tap-count problem. Give it a stable, visibly labelled door that survives loading, missing forecasts and empty accounts.

## Scope and method

Audited 1 November 2026 against worktree base `88dcd1d7`, using Impeccable, PRODUCT.md's Calm Cockpit principles and DESIGN.md. Two independent source reviews covered entry/accounts/settings and planning/Penny; the root reviewed Home, Spend, transactions and transfers and checked their findings. The deliverables are this audit, the ranked proposals below and three coded options at `/design/ux-accounts-entry/`. No production component is changed.

This is a source-led cognitive walkthrough, not a claim that we signed in as a customer and completed every flow. The only observed customer failure supplied to this audit is the tester's inability to find Accounts. The other findings distinguish verified implementation behaviour from usability hypotheses. Authenticated product screens, real bank authorisation, purchases, biometrics, real-device screen readers and production response times were not exercised. Synthetic preview browser checks are recorded separately below and prove the prototype only.

The Impeccable context and detector executables both returned permission denied. Existing project context was read directly; no automated Impeccable score or detector pass is claimed. The [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were fetched on 1 November for the final code review. Project rules take precedence on sentence case, financial language, colour and app-style pickers.

Two personas were used throughout:

- **New member:** one current account at one bank, little history, no saved goal, no learnt app vocabulary. Includes the preceding no-account and first-sync states.
- **Returning member:** several accounts, a card, saved plans, masked balances, possible stale data; wants to complete a known task and get back to where they were.

The questions at every step were: can I name the destination, see how to get there, recognise that I arrived, understand what will change, and leave or recover without losing context? Accounts must be within two navigation taps of each primary page, with a plainly named entry. A tap count excludes neither the need to discover the link nor the cost of scrolling.

Severity: **P1** significantly obstructs a task or truthful feedback; **P2** adds avoidable discovery or recovery work; **P3** polish. There is no demonstrated P0 outage in this audit. Proposed fixes are not approvals to change financial rules or create new banking actions.

## The Accounts path, precisely

| Starting state | Actual path | Cost and uncertainty |
| --- | --- | --- |
| Home, figure available | `Your accounts` in the Left to spend card → `/accounts` | One tap, after the estimate, scope and account guidance. It is a secondary action inside a financial instrument, not page navigation. |
| Home, account rows loaded | `Your estate` → account row → `/accounts?id=…`, or `See your account` / `All N accounts` → `/accounts` | One tap after finding the section below Your money. The singular footer is not named Accounts. |
| Home, no accounts | `Other ways to add accounts` on the first-bank card → `/accounts` | One tap, framed as an alternative setup method. The estate section is suppressed. |
| Home, cold load | Home skeleton; estate rows become placeholders | The ordinary Home doors are not a persistent navigation contract. Do not confuse a last-known figure, which keeps its link, with no-figure/error branches, which return earlier. |
| Spend, Upcoming or Planning | Home tab → an Accounts entry on Home | Nominally two taps once learnt, but requires recognising and locating the Home entry. |
| Mobile Settings route | Home avatar (`Account and settings`) → hub's `N accounts connected` link → `/accounts` | Two taps from Home. The hub link becomes Checking or Could not load accounts in those states; it is separate from the task directory. |
| Desktop | Home's links or Settings account hub | Sidebar has Home, Spend, Upcoming, Planning and Settings, but no Accounts. |

**Correction to the original ticket description:** the `Spend from` bank rows are plain list items. They do not open Accounts. The footer sentence points to the separate `Your accounts` link. Adding a click handler to those rows alone would neither give the destination a stable name nor fix the no-figure states.

Source: [BottomNav.tsx:117](../../frontend/components/BottomNav.tsx#L117), [Sidebar.tsx:13](../../frontend/components/Sidebar.tsx#L13), [HomePage.tsx:1034](../../frontend/app/components/HomePage.tsx#L1034), [HomePage.tsx:1214](../../frontend/app/components/HomePage.tsx#L1214), [HomeEstateSection.tsx:60](../../frontend/components/HomeEstateSection.tsx#L60), [SafeToSpendCard.tsx:648](../../frontend/components/SafeToSpendCard.tsx#L648), [SpendFromAccountList.tsx:49](../../frontend/components/SpendFromAccountList.tsx#L49), [HomeBrief.tsx:2418](../../frontend/components/HomeBrief.tsx#L2418).

## Journey walkthroughs

### 1. Sign-up, sign-in and onboarding

**Goal:** get into Sorted, understand what is needed and reach useful money information.

**New:** sign-in screen → supported Google/Apple action → welcome → name → payday → subscription choice → income → bank → optional device security. Skips and plan-load recovery exist; a member can continue without choosing a plan or connecting immediately. The bank step explains read-only access. **Returning:** sign-in/device lock returns to the app; setup is gated by onboarding completion, not repeated deliberately.

**Friction:** the two-minute setup promise precedes provider hand-offs and financial choices, so duration should be observed before treated as fact. This is a research question, not a demonstrated fault. Calling both a subscription and a savings arrangement a “plan” is the first appearance of a vocabulary problem continued in Settings. No provider-cancellation failure was reproduced. Preserve explicit sign-in errors, “Try another account”, skips and retries.

Evidence: [LoginScreen.tsx:146](../../frontend/components/LoginScreen.tsx#L146), [LoginScreen.tsx:186](../../frontend/components/LoginScreen.tsx#L186), [Onboarding.tsx:363](../../frontend/components/Onboarding.tsx#L363), [Onboarding.tsx:481](../../frontend/components/Onboarding.tsx#L481), [Onboarding.tsx:517](../../frontend/components/Onboarding.tsx#L517), [Onboarding.tsx:625](../../frontend/components/Onboarding.tsx#L625). Severity: **P2 vocabulary hypothesis**, no proven sign-up blocker.

### 2. Connect or reconnect a bank

**Goal:** bring accounts into Sorted and know when the data is ready.

**New:** Home's first-bank action, or Accounts Add → bank picker → search/select → Review your connection → Continue to Finexer → bank authorisation → sync. **Returning:** Add another bank uses the same flow; Reconnect opens the affected provider. Several expired providers are grouped under a Review disclosure. First sync says Pending/No figure yet; later refreshes retain explicitly last-known amounts. The external bank and callback were not exercised here.

**Friction:** Accounts' add menu uses `Add Bank`, `Statement`, `Investment`, `Offline`; these describe different kinds of action with inconsistent grammar. Statements-tier members do not get the bank item. The menu itself does not explain the missing option. This is a local discovery gap, not a claim the product has no subscription guidance anywhere. Replace the labels with verbs and explain eligibility where the task is sought. Do not classify the multi-bank Review disclosure as a defect merely because it takes a second tap.

Evidence: [FirstAccountCard.tsx:29](../../frontend/components/FirstAccountCard.tsx#L29), [BankConnectionFlow.tsx:55](../../frontend/components/bank-connect/BankConnectionFlow.tsx#L55), [BankConnectionParts.tsx:33](../../frontend/components/bank-connect/BankConnectionParts.tsx#L33), [AccountsPage.tsx:2861](../../frontend/app/components/AccountsPage.tsx#L2861), [ReconnectStrip.tsx:65](../../frontend/components/ReconnectStrip.tsx#L65). Severity: **P2**, F6.

### 3. Home → Accounts → Home

**Goal:** see the connected bank, balance and connection controls without asking Penny.

**New:** notice `Your accounts`, or infer that `Your estate` contains the bank and tap `See your account`. **Returning:** use a remembered row, footer or avatar route. Accounts has the global Home tab to return; opening a particular row can arrive directly in account detail, making the overview less apparent.

**Friction:** the route exists but has no constant, named place. It competes with forecast advice, changes labels with account count, and disappears from the hero when no figure can render. “Estate” is not the term the tester was looking for. The report's leading **P1**, F1, combines the supplied failure with these verified conditions. The three prototypes address this finding only.

### 4. Accounts overview and account detail

**Goal:** identify a bank account, distinguish its balance from availability, and inspect or repair it.

**New:** Accounts → net-worth instrument and Add → sole account row → detail → close to Accounts or use Home. **Returning:** search/filter/group rows → account → transactions, counted-account setting or connection action. The `?id=` deep link is synchronised, and privacy masking is global. Pending balances are not fabricated as zero; an unlinked or empty bank account has explanatory states.

**Friction:** the plus icon has the accessible name `Add account`, but a new user must discover its meaning visually and then decode noun-only menu choices. Net worth, bank balance and Available are different quantities; retain the existing headings and explanations rather than making a navigation proposal merge them. There is a specific return-label mismatch: the detail control says Accounts, but handleBack can return a visitor who entered through Home directly to Home. An honest Back label or deterministic Accounts link belongs in F1's round-trip acceptance. Preserve system Back. See [AccountsPage.tsx:1144](../../frontend/app/components/AccountsPage.tsx#L1144) and [AccountsPage.tsx:2383](../../frontend/app/components/AccountsPage.tsx#L2383). No blanket claim that account details lack exits is warranted.

Evidence: [AccountsHeader.tsx:62](../../frontend/components/AccountsHeader.tsx#L62), [AccountsPage.tsx:2889](../../frontend/app/components/AccountsPage.tsx#L2889), [AccountBankEmpty.tsx:8](../../frontend/components/AccountBankEmpty.tsx#L8), [AccountLedgerRow.tsx](../../frontend/components/AccountLedgerRow.tsx). Severity: **P2**, F6; financial figure comprehension is a usability-test task, with G385 already covering availability presentation.

### 5. Find a transaction and return to the same search

**Goal:** find a payment across history, inspect it and keep the search context.

**New:** Home recent payment → teaching sheet, or Spend's Search icon → Search → query/filter → payment. **Returning:** combine merchant, category, dates and direction, use page controls, then open a result. Filter chips describe and clear scope; pending and booked payments are separate; a failed load has Try again, and an empty date range offers Widen to all history.

**Fiction to avoid:** transactions are not hidden exclusively behind a period-picker sheet; Spend has a direct 44px Search button. **Verified friction:** the search input has only placeholder guidance, no persistent label/explicit accessible name, and its clear button is styled around a 14px icon without a minimum hit area. Query text and page are local state, while filters are in the URL, so refresh or a remount cannot faithfully restore the search. Back uses browser history, not a guaranteed in-app parent on a cold direct entry.

Evidence: [SpendHeader.tsx:278](../../frontend/components/SpendHeader.tsx#L278), [TransactionsPage.tsx:88](../../frontend/app/transactions/TransactionsPage.tsx#L88), [TransactionsPage.tsx:355](../../frontend/app/transactions/TransactionsPage.tsx#L355), [TransactionsPage.tsx:595](../../frontend/app/transactions/TransactionsPage.tsx#L595), [TransactionsPage.tsx:619](../../frontend/app/transactions/TransactionsPage.tsx#L619), [TransactionsPage.tsx:715](../../frontend/app/transactions/TransactionsPage.tsx#L715). Severity: **P1 accessibility**, F4; **P2 continuity**, F5. Placeholder fallback naming in some browsers is not a substitute for a durable label.

### 6. “Tell me what this was”

**Goal:** correct one payment and understand whether the choice affects other payments.

**New:** Spend's To categorise/ask card → Tell me what this was → spending category or a movement destination → confirmation. **Returning:** open a payment from Home, Accounts, Search or Spend → the same TeachingSheet; a matching-history offer can extend a correction to a rule. Movement choices distinguish own accounts, savings/investments, a goal and an account Sorted cannot see. Creating a goal returns to the teaching flow. The primary save reports failure inline and preserves retry.

**Verified friction:** successful changes offer Undo for five seconds. The undo functions swallow request failures; the button then closes the sheet. Rule rollback also treats deletion/sibling failures as best effort. A person can ask to reverse a correction and be returned to the list without knowing that some or all of it remains saved. This is a truthful-feedback issue, not a request to change categorisation arithmetic. The non-financial save error is also red, contrary to the project's Red Is Risk rule; fix that in the same bounded recovery pass.

Evidence: [SpendVerdictView.tsx:755](../../frontend/components/SpendVerdictView.tsx#L755), [TeachingSheet.tsx:166](../../frontend/components/TeachingSheet.tsx#L166), [TeachingSheet.tsx:238](../../frontend/components/TeachingSheet.tsx#L238), [TeachingSheet.tsx:289](../../frontend/components/TeachingSheet.tsx#L289), [TeachingSheet.tsx:361](../../frontend/components/TeachingSheet.tsx#L361), [TeachingSheet.tsx:938](../../frontend/components/TeachingSheet.tsx#L938). Severity: **P1**, F2. The older unused TransactionSheet is not evidence for the live journey.

### 7. Transfer review

**Goal:** distinguish money moved from money spent, finish a batch and see updated totals.

**New:** when candidates exist, Home → Review transfers opens the sheet directly. **Returning:** Home, Spend's review control or Penny's review deep link → grouped candidates → choices or nested teaching → Done. Each choice saves; pending-copy explains that the overview updates when finishing. Load and finish failures offer recovery. With zero candidates, Home deliberately shows nothing, per G387.

**Verified friction remaining:** the `/spend?review=1` route waits for a count request whose catch is empty. On a cold failure, default zero counts are treated as no candidates and the route replaces itself with `/transactions`. The user asked to review transfers but sees Search with no explanation. True zero also redirects silently. Home's direct entry already avoids this; do not reopen the fixed Home flicker/batching work.

Evidence: [HomeTransfersCheck.tsx:22](../../frontend/components/HomeTransfersCheck.tsx#L22), [MiscategorisedReviewSheet.tsx:238](../../frontend/components/MiscategorisedReviewSheet.tsx#L238), [SpendPage.tsx:688](../../frontend/app/components/SpendPage.tsx#L688), [SpendPage.tsx:748](../../frontend/app/components/SpendPage.tsx#L748). Severity: **P1**, F3.

### 8. Spend and pay-period browsing

**Goal:** understand spending this period, compare it and inspect the evidence.

**New:** Spend tab → dated period, Out verdict, In/Moved support → Changes/To categorise/Spending/Charts as applicable → evidence. **Returning:** date picker or previous/next period → review period → Back to this period; Search stays directly available. Moved is explicitly separate from Out. State-driven jump links disappear when there is nothing left to do.

**Friction:** a newcomer must learn `Out`, `Moved`, `To categorise` and the distinction between a pay period and a calendar month. Existing reconciliations and dates mitigate that. Test comprehension before redesigning the instrument; removing the distinction would misstate money. Missing-history and no-comparison wording are strengths. Search continuity and transfer deep-link recovery are the concrete fixes here, F3–F5.

Evidence: [SpendHeader.tsx](../../frontend/components/SpendHeader.tsx), [SpendJourneyNav.tsx](../../frontend/components/SpendJourneyNav.tsx), [SpendVerdictView.tsx](../../frontend/components/SpendVerdictView.tsx), [SpendPage.tsx:1148](../../frontend/app/components/SpendPage.tsx#L1148). Severity: **P2 comprehension hypothesis**, not an additional confirmed calculation defect.

### 9. Upcoming and its account sheet

**Goal:** see which payments are due and whether the paying account can cover them.

**New:** Upcoming tab → `Before payday` forecast → By account row → account detail → payment evidence → close back. **Returning:** inspect a particular account's low point, assigned payments/plans and corrections. Rows are large labelled controls; uncertainty about plans can be described as payments only. Home's Left to spend and Upcoming's payday balance are deliberately different, not inconsistent duplicates.

**Friction:** Upcoming and Before payday are compatible but different orientation labels. By account requires discovering content below the forecast. This is a **P2 hypothesis**, F8, not a proven P1 obstacle. Test whether users identify the destination and locate account coverage before adding persistent sub-navigation, which could consume scarce phone space.

Evidence: [PlanningPage.tsx:1100](../../frontend/app/planning/PlanningPage.tsx#L1100) (this file renders `/upcoming`), [UpcomingAccountsCard.tsx:41](../../frontend/components/upcoming/UpcomingAccountsCard.tsx#L41), [UpcomingAccountDetails.tsx:60](../../frontend/components/upcoming/UpcomingAccountDetails.tsx#L60).

### 10. Create, view and edit a set-aside or one-off payment

**Goal:** reserve money for this period or record a future payment without believing Sorted moved money.

**New:** Upcoming → Add → Set aside or One-off payment, each with an example → Continue. Set-asides follow Purpose, Details, Source, Destination, Tracking and Review → final create action. A one-off uses its own payment form. **Returning:** existing record → saved View plan → Edit → prefilled guided steps → Review → Save changes; this-period adjustment is distinct from changing the recurring plan. Back from the first creation question can return to the chooser with the draft.

**Friction:** the global tab `Planning` suggests it might own this task, yet recurring set-asides start in Upcoming. Planning already explains that one-off payments and this period's set-asides live in Upcoming and provides a link below its content ([LongTermPlanningPage.tsx:236](../../frontend/app/planning/LongTermPlanningPage.tsx#L236)). Test whether that existing link is noticed before proposing relocation or duplication. Existing editors already explain sources, destinations and matching; do not infer visible jargon from an implementation filename. Preserve the saved read-only view, one final save, source-only behaviour and no-money-moved explanation.

Evidence: [PlanningPage.tsx:156](../../frontend/app/planning/PlanningPage.tsx#L156), [PlanningPage.tsx:1186](../../frontend/app/planning/PlanningPage.tsx#L1186), [SetAsideSheet.tsx:71](../../frontend/components/SetAsideSheet.tsx#L71), [UpcomingDetailFlow.tsx](../../frontend/components/upcoming/UpcomingDetailFlow.tsx). Severity: **P2**, F8.

### 11. Create, view and edit a goal

**Goal:** save towards a named target and understand the scheduled contribution.

**New:** Planning → Long-term goals → Set a goal → guided purpose/details/source/destination/tracking/review → Create goal. **Returning:** goal row → View plan with progress → Edit → prefilled steps → Review → Save changes. Full schedules are disclosed; changing just this period is distinct from changing the whole plan. Empty, loading, failed goal loads and obsolete deep links have explicit states.

**Friction:** someone arriving at Planning to earmark groceries has chosen the wrong kind of plan, although they have not made an unreasonable navigation choice. Explain a future target versus a repeating allowance at the entry point, F8. Keep saved progress, scheduled contributions and matching payments distinct; do not make an account balance masquerade as goal progress. Source-level evidence does not prove the keyboard or bank-matching experience on a real device.

Evidence: [LongTermPlanningPage.tsx:217](../../frontend/app/planning/LongTermPlanningPage.tsx#L217), [CommitmentSheet.tsx](../../frontend/components/CommitmentSheet.tsx), [PlanEditorSummary.tsx](../../frontend/components/plans/PlanEditorSummary.tsx), [g351-goal-schedules.md](g351-goal-schedules.md). Severity: **P2**, F8.

### 12. Payday plan

**Goal:** find the suggested distribution for the next payday, including when Home no longer shows it.

**New:** raised Penny control → `Your plan and updates` → Penny hub → Payday plan → preview/entry. **Returning:** timely Home card or the same permanent Penny hub → current recommendation or minimised plan. The hub deliberately omits Home's payday-window gate, so it remains available year-round. The plan describes recommended moves and does not execute bank transfers.

**Correction:** there is already a permanent home; proposing a new one on the assumption the plan disappears would duplicate it. **Friction:** reaching that home requires opening a conversation surface to find a page link. A failed preview says to try again after a sync but does not by itself explain which prerequisite is missing. Treat a clearly named Planning-to-Penny payday link, distinct from the existing Planning-to-Upcoming set-aside link, as a testable **P2** improvement, F8, not a new cash engine or always-generated plan.

Evidence: [PennyPage.tsx:240](../../frontend/app/penny/PennyPage.tsx#L240), [HomeBrief.tsx:2512](../../frontend/components/HomeBrief.tsx#L2512), [HomeBrief.tsx:2611](../../frontend/components/HomeBrief.tsx#L2611), [PaydayPlanCard.tsx:217](../../frontend/components/PaydayPlanCard.tsx#L217).

### 13. Cover plan

**Goal:** understand a genuine account shortfall and the safe next action.

**New:** when an eligible payment gap exists, Home/Penny recommendation → suggested source and destination → payment evidence / See what's due → Upcoming. **Returning:** inspect the same evidence; safeguards are in Settings. A single-bank member may have no other suitable source, so absence of a suggested move must not be replaced with invented spare money.

**Friction:** the recommendation, dated obligations and policy settings span Home, Upcoming and Settings. That can be appropriate progressive disclosure; test whether the next action and return path are understood. Do not add a persistent risk-looking card when no problem exists. G383 already covers the move-card explanation, and G385 covers account availability; use those rounds rather than duplicate them.

Evidence: [HomeBrief.tsx:1260](../../frontend/components/HomeBrief.tsx#L1260), [CoverPlanSourcesCard.tsx:112](../../frontend/components/CoverPlanSourcesCard.tsx#L112), [SettingsDirectory.tsx:50](../../frontend/components/settings/SettingsDirectory.tsx#L50). Severity: **P2 hypothesis**, F8 follow-up research; no new financial recommendation in this audit.

### 14. Penny conversation, history and hub

**Goal:** ask about the current screen, resume an answer or find the saved plan/updates.

**New:** Penny navigation control → full-screen mobile chat → starter chip or question → reply. **Returning:** New chat / History, optional resume preference, or `Your plan and updates` to the hub. Closing chat returns to the underlying screen. Errors offer Retry and a full thread offers New chat. The page and the chat serve distinct jobs; their coexistence is not itself a defect.

**Friction:** a newcomer cannot infer which non-chat tasks are inside the hub from the raised adviser icon. Improve cross-links and naming only if the task test confirms it, F8. Penny must remain optional for basic navigation. G388 owns the current icon/art-direction work; G389 does not prejudge or replace it.

Evidence: [PennySheet.tsx:406](../../frontend/components/PennySheet.tsx#L406), [PennyChatActions.tsx:12](../../frontend/components/PennyChatActions.tsx#L12), [PennyConversation.tsx:2202](../../frontend/components/PennyConversation.tsx#L2202), [PennyPage.tsx:271](../../frontend/app/penny/PennyPage.tsx#L271). Severity: **P2 hypothesis**, F8.

### 15. Settings and subscription picker

**Goal:** change a preference, find the subscription and manage payment through the correct channel.

**New:** Home avatar → Settings task directory → section; subscription is under `Penny and your plan`. **Returning:** searchable tasks and section deep links → plan picker → tier/billing period → relevant web/store purchase or management route. Settings has named tasks, real links and useful summaries. The picker identifies purchase channel rather than pretending every subscription can be changed everywhere.

**Verified friction:** the directory matches `plan` and `subscription`, but its search corpus excludes `billing` and `cancel`. Those searches show No settings match even though subscription management is a real task. “Penny and your plan” also competes with financial plans in the product vocabulary. Add search synonyms and a clear subscription label without hiding Penny consent/allowance or changing cancellation policy.

Evidence: [SettingsDirectory.tsx:61](../../frontend/components/settings/SettingsDirectory.tsx#L61), [SettingsDirectory.tsx:79](../../frontend/components/settings/SettingsDirectory.tsx#L79), [PlanPicker.tsx:187](../../frontend/components/PlanPicker.tsx#L187), [SettingsPage.tsx](../../frontend/app/settings/SettingsPage.tsx). Severity: **P2**, F7. No real purchase, renewal or cancellation was attempted.

## Secondary destinations and scope boundary

The named G389 journeys above received the detailed walkthrough. A route inventory also checked where the surrounding customer destinations sit; it is not a claim of exhaustive financial or compliance testing of those features.

| Destination | Entry / return orientation | Audit disposition |
| --- | --- | --- |
| Cards `/cards` | Planning debt position or Home Goals strip; global navigation remains | Secondary debt detail, retain named entry and Home escape. |
| Pay split `/spend/shape` | Spend money-shape card; primary navigation remains | Different from Accounts and net worth; no new redesign proposed. |
| Patterns `/mirror` | Penny hub's How your money behaves; back to Spend when entered from Spend | Keep origin-aware back behaviour. |
| Month `/month`, story `/month/story` | Month review and story entry; story has its own close to Month | Story is a documented full-screen nav exception. |
| Tax `/tax` | Financial settings; primary navigation remains | Not audited for legal/financial accuracy in this UX task. |
| Receipts `/receipts` | Grocery basket action; primary navigation remains | Upload/submission correctness not exercised. |
| Connected assistants and `/mcp-activity` | Settings when enabled → activity link | External consent and permissions are outside the bank-navigation prototype. |
| `/privacy`, `/terms`, `/oauth/consent` | Legal/help or external consent entry | Intentional shell exceptions; no production edits here. |
| `/grow`, `/insights` | Legacy redirects to Planning / Spend shape / Tax | Not extra primary destinations to add back. |
| Ops/admin/design | Owner operations or temporary previews | Not consumer money journeys; excluded from UX findings. |

Evidence: [navExemptRoutes.ts](../../frontend/lib/navExemptRoutes.ts), [LongTermPlanningPage.tsx:212](../../frontend/app/planning/LongTermPlanningPage.tsx#L212), [GoalsStrip.tsx:84](../../frontend/components/GoalsStrip.tsx#L84), [SpendPage.tsx:1309](../../frontend/app/components/SpendPage.tsx#L1309), [MirrorPage.tsx:325](../../frontend/app/mirror/MirrorPage.tsx#L325), [StoryPlayer.tsx:674](../../frontend/app/month/story/StoryPlayer.tsx#L674), [SettingsPage.tsx:1588](../../frontend/app/settings/SettingsPage.tsx#L1588), [ConnectedAssistantsCard.tsx:414](../../frontend/components/ConnectedAssistantsCard.tsx#L414).

## Ranked, board-ready proposals

### Quality observations across the journeys

| Dimension | Evidence and limit |
| --- | --- |
| Accessibility | Named links and shared sheets are established strengths. Transaction search's label and clear target need attention. Keyboard and focus were assessed in source for authenticated flows; the prototype receives browser checks below. |
| Performance | Search is debounced and paginated; transfer decisions save immediately with one finish refresh. Preserve those behaviours. No production latency, network or CPU benchmark was run. |
| Responsive behaviour | Shared navigation, 44px sheet controls, safe-area handling and a deliberate desktop layout exist. Their source presence is not proof that every authenticated layout fits with real data. |
| Themes and meaning | The app has explicit light/dark tokens, privacy masking and financial colour rules. TeachingSheet's red save-error text conflicts with Red Is Risk. No all-screen contrast certification is claimed. |
| Implementation integrity | The system expresses real financial distinctions and has mature recovery paths. The key confirmed gaps are navigation recognition and truthful failure feedback, not a need to replace the overall visual system. |

An aggregate product health score would overstate this source-led inspection. The findings, exact conditions and follow-up acceptance criteria are more useful than a fabricated all-screen score. Preserve the clear consent hand-off, period scope, masked financial figures, neutral Moved figures, guided plan review, labelled Penny history and zero-candidate quiet Home state.

These are proposed work items, not silently started implementation tasks. Suggested owners distinguish design decisions from bounded corrections. G389 already owns F1's design round; do not create a duplicate Accounts ticket before Kevin's choice. Remaining titles and acceptance criteria can be copied into the board.

| Rank / ID | Priority and proposed title | Suggested owner | Acceptance criteria |
| --- | --- | --- | --- |
| 1 / F1 | **P1: Make Accounts a stable, named destination from Home in every data state.** | Kevin chooses G389 direction; Codex folds in approved choice | One obvious Accounts entry, one tap from Home and at most two from Spend/Upcoming/Planning. Survives empty, loading, error, stale and hidden states. Desktop equivalent, meaningful active state, keyboard focus and Back. Update tutorial target. Preserve the financial hero and agreed Penny styling. |
| 2 / F2 | **P1: Keep failed transaction Undo visible and retryable.** | Codex | Fail each single correction, movement and rule/sibling rollback request in isolation; keep sheet open or give persistent truthful feedback, retain unfinished rollback work and offer Retry/Done. Never announce a full rollback when only part succeeded. Retain successful saves, accurate cache invalidation and G387's deferred batch behaviour. Neutral non-financial errors. |
| 3 / F3 | **P1: Honour transfer-review deep links when counts fail or the queue is empty.** | Codex | `/spend?review=1` opens the review's own loading/error/empty surface. A count failure must not redirect to Search. True zero says Nothing needs review and offers a clear return. Test cold, warm and Penny-link entry; preserve direct Home entry and one finish recompute. |
| 4 / F4 | **P1: Give transaction search a durable label and usable clear target.** | Codex | Visible or programmatic Search transactions label, meaningful input name, 44px clear target without reducing text space, keyboard focus and announced loading/results. Check 320px, zoom and both themes. No search-logic change. |
| 5 / F5 | **P2: Restore the transaction query and page when reopening a search.** | Codex | Query, filters and pagination round-trip through URL or a defined session contract. Refresh and back/forward restore the same search; changing criteria resets page once; no request loops or stale responses. Cold direct entry has a clear in-app return path. |
| 6 / F6 | **P2: Name account-add actions and explain unavailable bank connection.** | Claude design owner, or Codex after explicit assignment | Choices read Connect a bank, Upload a statement, Add an investment, Add an offline account, with concise distinctions where needed. A plan limitation is explained where bank connection is sought and links to subscription settings. Keep menu focus/Escape and existing consent flow. |
| 7 / F7 | **P2: Make subscription management findable by billing and cancellation language.** | Codex | Searching billing, cancel, subscription or plan reaches the right Settings section. Give the entry a subscription-specific label; preserve Penny consent/allowance and correct Apple/Google/web management paths. No new billing behaviour. |
| 8 / F8 | **P2: Test and clarify the routes to set-asides, goals and payday plans.** | Kevin validates tasks; Claude design owner, or assigned Codex | Test “set aside groceries”, “save for a holiday”, “see next payday's plan”, “find the account paying my bill” without giving tab names. Evaluate the existing Planning-to-Upcoming link first. If confusion occurs, prototype better placement or reciprocal links and examples. Reuse the permanent Penny payday hub and existing six-step editors; do not introduce a new plan engine or duplicate G383/G385/G388. |

Four P1 and four P2 proposals; no P3 padding. F1 has a supplied user failure and source evidence. F2–F7 have specific source-level conditions; F8 is explicitly a research/design hypothesis. No fresh live incident or frequency is claimed for the conditional failures.

## Accounts design round

Mode: **Operate**. The user should see an Accounts destination without understanding forecasts or the word estate. Financial status remains the main Home content; total balances and net worth stay on Accounts.

| Option | Interaction | Benefit | Cost / decision |
| --- | --- | --- | --- |
| **A: A named door, recommended** | Labelled Accounts action in the Home greeting; existing primary tabs remain | Visible before data arrives; one tap; minimal navigation relearning | Adds a header control. Confirm it fits names and enlarged text without displacing the Settings avatar. |
| **B: In the journey** | Full-width Accounts row immediately after the verdict; account section gets a plain name | A clear destination with explanatory copy and a generous target | More vertical space; a long Home brief can still push it below the first viewport. |
| **C: A primary destination** | Accounts replaces mobile Planning; explicit Goals and plans entry on Home; desktop adds Accounts and retains Planning | Accounts remains available from every primary page | Planning takes an extra step on mobile. Kevin must approve that trade-off; it cannot be treated as a free extra tab. |

All options use the same synthetic states and local Home → Accounts → selected account → Accounts/Home journey. Fixture controls cover one bank, several accounts, no accounts, loading, failed refresh, light/dark and hidden figures. Other destination shells exist only to test navigation, not to claim redesign of Spend or the account sheet. These are temporary hand-authored proposals, not screenshots of the live authenticated product. After a choice, fold in the selected entry and remove the round under H113 unless another open item or approval pack still requires it.

## Validation and handoff

The preview passed a production Webpack build, TypeScript, focused ESLint, and the design index, stale-preview and no-live-data gates. Independent source review checked the report's claims and the prototype against the design rules. It found no remaining blocking prototype defect after corrections.

The production browser pass covered 42 layout cases across A/B/C, both themes, five account states and true 320px, 390px and 1280px viewports. It checked entry availability, horizontal overflow, phone control heights and desktop content width. Six interaction sets verified selected account identity, signed masking, route focus, browser Back, explicit Accounts/Home returns and Penny's modal focus/Escape behaviour. Keyboard activation and the local add-account acknowledgement also passed. There were no JavaScript exceptions or customer API attempts. The final pass generated 19 screenshots; visual inspection covered every direction at phone, narrow-phone and desktop sizes, both themes across the set, and the expanded review controls. The inspection caught a desktop shell conflict and the interaction checks caught early focus restoration after the Penny dialog; both were corrected before the final pass. Selected text/token contrast pairs measured at least 4.90:1.

Reproduce the browser pass against a local production server with `node frontend/app/design/ux-accounts-entry/preview.browser.mjs <output-directory>` from the repository root; set `G389_TEST_ORIGIN` if the server is not at `http://127.0.0.1:3189`. Local evidence is in `.impeccable/review/g389-final-pass/` in this worktree. The mandatory full-suite delivery result is recorded on G389's board notes by the session handoff. These results cover the synthetic preview, not authenticated product rendering, physical-device screen readers or observed participant success. The Impeccable detector remains unavailable; manual review and repository gates are separate evidence.

Kevin's short task test after the coordinator publishes the round. Add `clean=1` to the preview URL to hide the review explanation, which otherwise tells the participant where the new entry lives. Keep the same variant and state for each participant in a comparison; do not teach them with the other options first.

1. Start on Home with one bank and ask “Show me the bank accounts connected to Sorted.” Give no location hint. Record first tap, wrong turns, scrolling and time.
2. Repeat from Spend, Upcoming and Planning, including loading/error. Target: Accounts within two navigation taps, with the destination recognised before tapping.
3. Ask for a particular account, then a return to Home. Confirm bank balance is not mistaken for Left to spend.
4. For C, ask for an existing goal without naming Home. Compare the cost of moving Planning with the benefit to Accounts.
5. Use five unfamiliar participants if available; a practical acceptance target is at least four finding Accounts unaided within ten seconds, with no participant blocked by loading or a missing forecast. This is a proposed test threshold, not a result already observed.

Questions are deferred until the variants have a working UAT link, as required by the repository design workflow. G389 is handed off with `--uat-review`, not marked done or blocked on an unpublished choice.

## G389 implementation update, 2 November 2026

Kevin approved Home A and Accounts refresh A. The labelled Home entry, Refresh beside Add and clearer Add actions are folded into production. Both G389 preview routes and their browser scripts are retired; the earlier verification and route references above describe the historical design round. Current production verification is `frontend/scripts/g389-accounts.browser.mjs`. F2–F5 and F7 were implemented in G392. F8 remains the observed-task study G393; no participant outcome is claimed.
