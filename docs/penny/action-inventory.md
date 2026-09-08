# Penny action inventory: what the UI can do vs what Penny can propose

Captured 2026-09-08 from the live components and backend. Sibling of the question inventory in docs/penny/question-inventory/ (read side); this is the write side. Status per row: covered (a propose tool does the same write with the same fields), partial (Penny can read the object but not change it, or proposes only a subset of the UI's fields), gap (no Penny tool).

Caveat: caller surfaces were located by grep, so a UI action mounted through an indirection (context provider, hook) is attributed to the file that issues the call.

Files: frontend/lib/api.ts, PENNY_TOOLS.md, backend/app/services/penny_tools.py, backend/app/services/penny_agent.py, backend/app/routers/can_i.py

Doctrine that constrains the gap list (see PENNY_TOOLS.md and BEHAVIOURS.md): Penny proposes, never executes; every write goes through a proposal row that the user confirms in the sheet, and the server re-checks agent-mode consent at execute time. Some UI actions should stay UI-only on purpose: file uploads and receipt scans (need a picker), account deletion, granting or revoking Penny consent, and the miscategorised guardrail queue (explicitly excluded from propose_recategorise_transaction). Those are marked in section 7.

## 1. Penny tool list

### Read tools, 19, all in `TOOL_SCHEMAS` (`penny_tools.py` L130-604)

| Tool | Kind | Backend action it maps to |
|---|---|---|
| `get_safe_to_spend` | read | `app.services.analytics.compute_safe_to_spend` |
| `get_upcoming_bills` | read | cashflow engine / `_compute_cashflow_patterns` (mirrors `GET /cashflow`) |
| `search_transactions(q, category, merchants, date_from, date_to, txn_type)` | read | same query builder as `GET /transactions/search` |
| `get_accounts` | read | account service + `accountKind.ts` twin + `preferences.home_pinned_accounts` |
| `get_spend_verdict(period_offset)` | read | spend-verdict service (`GET /spend/verdict`) |
| `get_savings_position` | read | savings cashflow + `savings_goals_col` + `compute_safe_to_spend` period gate |
| `get_debt_position` | read | debt plan engine + card terms |
| `get_goals` | read | `app.routers.commitments.list_commitments` |
| `check_affordability(amount, timeframe?)` | read | `app.services.affordability` |
| `get_category_spend(category?, months?)` | read | `compute_spend_verdict` + raw txn rows |
| `get_insights` | read | `savings_insights_col` ranked as `GET /savings-insights` + `GET /value-delivered` |
| `explain(topic)` | read | flat copy registry in `penny_tools.py` + `app.content.money_basics.MONEY_BASICS` (63 keys) |
| `get_tax_position` | read | `app.routers.chat.build_tax_fact_pack` |
| `get_today_brief` | read | `app.services.companion.compute_today_items` (`GET /today`) |
| `get_recurring_payments` | read | cashflow-cache `recurring_spend` patterns |
| `get_account_activity(account_id_or_name?, days?)` | read | server-side aggregation over the 5-collection txn union |
| `get_mirror` | read | `app.services.behaviour.compute_portrait` + `app.services.checkpoints.list_active` |
| `get_fill_candidates(account_id_or_name?)` | read | `GET /allocations/fill-candidates` |
| `calculate(expression)` | read | `app.services.safe_calc.evaluate` (AST whitelist, never `eval`) |

### Propose/write tools, 26, in `PROPOSE_TOOL_SCHEMAS` (`penny_tools.py` L611-891)

B14 (2026-09-08, B12 stage 1 shipped) added the ten edit/delete twins below
the original eight, for the covered creates only (planned, allocation,
commitment, checkpoint delete, recurring skip/edit/clear-override). B15
(2026-09-08, B12 stage 2 shipped) added the eight preferences twins below
that, for the money-maths preferences (pay period, income, pension, Child
Benefit, debt target/tracking-start, cover-plan exclusions, hide balances)
— see section 2's per-row status changes and section 3's revised counts.

| Tool | Kind | Backend action it maps to |
|---|---|---|
| `propose_mirror_choice(trait_id, choice)` | propose | `app.routers.behaviour.set_mirror_choice` (`POST /mirror/choice`) |
| `propose_dismiss_recurring(key)` | propose | `app.routers.analytics.dismiss_recurring` (`POST /cashflow/dismiss-recurring`) |
| `propose_restore_recurring(key)` | propose | `app.routers.analytics.restore_recurring` (`POST /cashflow/restore-recurring`) |
| `propose_add_planned(name, amount, date, account_id?)` | propose | `app.routers.planned.create_planned_expense` (`POST /planned`) |
| `propose_create_allocation(name, amount_per_period, fill_account_id, match_type, match_value, recurrence, effective_from?)` | propose | `app.routers.allocations.create_allocation` (`POST /allocations`) |
| `propose_create_commitment(name, amount, target_date, funding_pots?)` | propose | `app.routers.commitments.create_commitment` (`POST /commitments`) |
| `propose_recategorise_transaction(transaction_id or merchant+date+amount, new_category, scope)` | propose | `app.routers.transactions.update_transaction` (`scope="just_once"`), + `app.routers.categories.add_rule` (`scope="always"`) |
| `propose_set_card_apr(card_ref, apr_pct)` | propose | `app.routers.card_terms.save_card_terms` (read-modify-write, only `apr_pct` changes) |
| `propose_update_planned(planned_ref, name?, amount?, date?)` | propose (B14) | `app.routers.planned.update_planned_expense` (`PATCH /planned/{id}`, name/amount/date only, not `account_id`) |
| `propose_delete_planned(planned_ref)` | propose (B14) | `app.routers.planned.delete_planned_expense` (`DELETE /planned/{id}`) |
| `propose_update_allocation(allocation_ref, name?, amount_per_period?, recurrence?, paused?)` | propose (B14) | `app.routers.allocations.update_allocation` (`PATCH /allocations/{id}`, name/amount_per_period/recurrence/active only, not `fill_account_id`/match rule/`effective_from`) |
| `propose_delete_allocation(allocation_ref)` | propose (B14) | `app.routers.allocations.delete_allocation` (`DELETE /allocations/{id}`) |
| `propose_update_commitment(commitment_ref, name?, amount?, target_date?)` | propose (B14) | `app.routers.commitments.update_commitment` (`PATCH /commitments/{id}`, name/amount/target_date only, not `funding_pots`/`status`/`contribute_delta`) |
| `propose_delete_commitment(commitment_ref)` | propose (B14) | `app.routers.commitments.delete_commitment` (`DELETE /commitments/{id}`, a soft cancel — sets `status: "cancelled"`) |
| `propose_delete_checkpoint(checkpoint_ref)` | propose (B14) | `app.routers.checkpoints.delete_checkpoint` (`DELETE /checkpoints/{id}`; no PATCH exists on this object, delete is the only twin) |
| `propose_skip_occurrence(key_or_name, date)` | propose (B14) | `app.routers.analytics.skip_occurrence` (`POST /cashflow/skip-occurrence`) |
| `propose_edit_occurrence(key_or_name, date, new_date?, new_amount?, scope)` | propose (B14) | `app.routers.analytics.edit_upcoming` (`POST /cashflow/edit-upcoming`; `scope` is `one`\|`future`, matching the router exactly) |
| `propose_clear_override(key_or_name, date)` | propose (B14) | `app.routers.analytics.clear_override` (`POST /cashflow/clear-override`) |
| `propose_set_pay_period(config)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {pay_period_config}`, scoped to the 4 types Settings' own Pay Period sheet offers) |
| `propose_set_income(amount_annual?, bracket?)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {income_value}`, `income_bracket` auto-derived same as the router; `bracket` alone asks for a number rather than guessing one) |
| `propose_set_pension_contributions(amount_annual)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {pension_annual}`) |
| `propose_set_child_benefit(receiving)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {has_child_benefit}`) |
| `propose_set_debt_target(months)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {debt_target_months}`) |
| `propose_set_debt_tracking_start(date)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {debt_tracking_start}`) |
| `propose_set_cover_plan_exclusions(account_refs)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {cover_plan_excluded_accounts}`, whole-list replace, empty list clears) |
| `propose_set_hide_balances(hidden)` | propose (B15) | `app.routers.preferences.update_preferences` (`PATCH /preferences {hide_net_worth}`) |

### Agent-mode consent gate

`PROPOSE_TOOL_SCHEMAS` are always offered to the model regardless of consent (`penny_agent.py` L413, rationale at L386-397: gating the schemas made the consent moment itself unreachable). The only real gate is at dispatch time: `penny_agent.py` L531-536 checks `name in PROPOSE_TOOL_NAMES and not consented` against a live `preferences_col` read of `penny_agent_consent` (L400-404, never cached) and returns `{"consent_required": True}` without calling `execute_tool`. Even with a proposal, Penny never executes it: `_create_proposal` (`penny_tools.py` L2818) writes a 15-minute-TTL row in `penny_proposals_col`, and `POST /penny/proposals/{id}/execute` (`can_i.py` L846), never reachable by the LLM, replays the stored params through the same router function the app's own confirm sheet calls, re-checking consent at execute time so a revocation (`DELETE /penny/agent-consent`, `can_i.py` L825) kills an unactioned proposal with a 403.

## 2. Cross-reference table

### Accounts and connections

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Sync all connected accounts | `app/components/HomePage.tsx:457` | `POST /accounts/sync` (`syncAll`) | none | gap |
| Pull older transaction history | `app/settings/SettingsPage.tsx:545` | `POST /accounts/sync-history` (`syncHistory`) | none | gap |
| Disconnect / delete a bank account | `app/components/AccountsPage.tsx:920` | `DELETE /accounts/{id}` (`deleteAccount`) | none | gap |
| Complete a Mono (Kenya) connection | `components/MonoConnect.tsx:60` | `POST /auth/mono/exchange` (`monoExchange`) | none | gap |
| Pin / unpin an account on Home | `app/components/AccountsPage.tsx:758` | `PATCH /preferences {home_pinned_accounts}` (`updatePreferences`) | `get_accounts` exposes `pinned` | partial |
| Create an offline (manual) account | `app/components/AccountsPage.tsx:962` | `POST /manual-accounts` (`createManualAccount`) | none | gap |
| Edit an offline account (name/balance/type) | `app/components/AccountsPage.tsx:959` | `PATCH /manual-accounts/{id}` (`updateManualAccount`) | `get_accounts` / `get_account_activity` read only | partial |
| Delete an offline account | `app/components/AccountsPage.tsx:978, 2058` | `DELETE /manual-accounts/{id}` (`deleteManualAccount`) | `get_accounts` read only | partial |
| Add an offline-ledger entry | `app/components/AccountsPage.tsx:1039` | `POST /manual-accounts/{id}/transactions` (`addManualTransaction`) | none | gap |
| Edit an offline-ledger entry | `app/components/AccountsPage.tsx:1037` | `PATCH /manual-accounts/{id}/transactions/{txId}` (`updateManualTransaction`) | `search_transactions` reads it | partial |
| Delete an offline-ledger entry | `app/components/AccountsPage.tsx:1056` | `DELETE /manual-accounts/{id}/transactions/{txId}` (`deleteManualTransaction`) | `search_transactions` reads it | partial |
| Create a transaction-mirror rule | `app/components/AccountsPage.tsx:1112` | `POST /manual-account-rules` (`createManualAccountRule`) | none | gap |
| Edit / pause a mirror rule | `app/components/AccountsPage.tsx:1106, 1135` | `PATCH /manual-account-rules/{id}` (`updateManualAccountRule`) | none | gap |
| Delete a mirror rule | `app/components/AccountsPage.tsx:1148` | `DELETE /manual-account-rules/{id}` (`deleteManualAccountRule`) | none | gap |
| Refresh investment prices | `app/components/AccountsPage.tsx:1187` | `POST /investment/accounts/{id}/refresh` (`refreshInvestmentPrices`) | none | gap |
| Delete an investment account | `app/components/AccountsPage.tsx:1205` | `DELETE /investment/accounts/{id}` (`deleteInvestmentAccount`) | none | gap |

### Transactions and categories

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Recategorise one transaction | `components/TeachingSheet.tsx:163,250`, `components/TransactionSheet.tsx:109` | `PATCH /transactions/{id}` (`patchTransaction`) | `propose_recategorise_transaction` (`scope="just_once"`) | covered |
| "Always file X as Y" rule | `components/TeachingSheet.tsx:275` | `POST /rules` (`addRule`) | `propose_recategorise_transaction` (`scope="always"`) | covered |
| Undo a just-created rule | `components/TeachingSheet.tsx:278` | `DELETE /rules/{id}` (`deleteRule`) | none | gap |
| Resolve a movement (mine-here / mine-goal / mine-offline / someone-else / spending) | `components/TeachingSheet.tsx:158,181,215` | `POST /transactions/{id}/resolve-movement` (`resolveMovement`) | none | gap |
| Create a custom category | `components/CategoriesContext.tsx:39` (from `TeachingSheet.tsx:198`) | `POST /categories` (`addCategory`) | none | gap |
| Delete a custom category | `components/CategoriesContext.tsx:46` | `DELETE /categories/{name}` (`deleteCategory`) | none | gap |
| Dismiss a flagged own-transfer series | `components/MiscategorisedReviewSheet.tsx:320` | `POST /transactions/dismiss-miscategorised-series` (`dismissMiscategorisedSeries`) | none, tool description forbids touching this queue | gap (deliberate) |
| Confirm a transfer pair | `components/MiscategorisedReviewSheet.tsx:211` | `POST /transactions/confirm-transfer-pair` (`confirmTransferPair`) | none, explicitly out of scope | gap (deliberate) |
| Dismiss a transfer-pair suggestion | `components/MiscategorisedReviewSheet.tsx:222` | `POST /transactions/dismiss-transfer-pair` (`dismissTransferPair`) | none | gap (deliberate) |
| Dismiss the "not yet placed" ask card | `components/SpendVerdictView.tsx:1181` | `POST /spend/verdict/dismiss-unresolved` (`dismissUnresolvedAsk`) | `get_spend_verdict` returns `unresolved` | partial |

### Bills, upcoming, allocations

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Dismiss a recurring series ("not a bill") | `app/planning/PlanningPage.tsx:791`, `app/planning/dismissed/SetAsideClient.tsx:125` | `POST /cashflow/dismiss-recurring` (`dismissRecurring`) | `propose_dismiss_recurring` | covered |
| Restore a dismissed series | `app/planning/PlanningPage.tsx:848`, `app/planning/dismissed/SetAsideClient.tsx:120` | `POST /cashflow/restore-recurring` (`restoreRecurring`) | `propose_restore_recurring` | covered |
| Skip one upcoming occurrence | `app/planning/PlanningPage.tsx:817`, `components/UpcomingEditSheet.tsx:128`, `components/HomeBrief.tsx:553` | `POST /cashflow/skip-occurrence` (`skipUpcomingOccurrence`) | `propose_skip_occurrence` (B14) | covered |
| Edit an upcoming bill's date/amount (one / future) | `components/UpcomingEditSheet.tsx:103` | `POST /cashflow/edit-upcoming` (`editUpcoming`) | `propose_edit_occurrence` (B14) | covered |
| Clear an upcoming override | `components/UpcomingEditSheet.tsx:117` | `POST /cashflow/clear-override` (`clearUpcomingOverride`) | `propose_clear_override` (B14) | covered |
| Preview a natural-language schedule rule | `components/UpcomingEditSheet.tsx:143` | `POST /cashflow/preview-rule` (`previewUpcomingRule`) | `get_recurring_payments` reads cadence | partial |
| Apply a schedule rule to a series | `components/UpcomingEditSheet.tsx:169` | `POST /cashflow/apply-rule` (`applyUpcomingRule`) | `get_upcoming_bills` reads `rule_label` | partial |
| Clear a schedule rule | `components/UpcomingEditSheet.tsx:183` | `POST /cashflow/clear-rule` (`clearUpcomingRule`) | `get_upcoming_bills` reads `rule_label` | partial |
| Hide / unhide a "set aside" row | `app/planning/dismissed/SetAsideClient.tsx:140,143` | `POST /dismissed-series/hide` (`hideDismissedSeries`) | none | gap |
| Bring back an engine-vetoed series | `app/planning/dismissed/SetAsideClient.tsx:132` | `POST /dismissed-series/override` (`overrideDismissedSeries`) | none | gap |
| Create a set-aside allocation | `components/SetAsideSheet.tsx:124` | `POST /allocations` (`createAllocation`) | `propose_create_allocation`, no `fill_display_name` param | partial |
| Edit / pause an allocation | `components/AllocationSheet.tsx:110,137` | `PATCH /allocations/{id}` (`updateAllocation`) | `propose_update_allocation` (B14; name/amount_per_period/recurrence/paused only, not the fill account or match rule) | partial |
| Delete an allocation | `components/AllocationSheet.tsx:153` | `DELETE /allocations/{id}` (`deleteAllocation`) | `propose_delete_allocation` (B14) | covered |
| Add a planned one-off payment | `components/PlanOneOffSheet.tsx:86` | `POST /planned` (`addPlanned`) | `propose_add_planned` | covered |
| Edit a planned one-off | `components/PlannedEditSheet.tsx:95` | `PATCH /planned/{id}` (`updatePlanned`) | `propose_update_planned` (B14; name/amount/date only, not `account_id`) | partial |
| Delete a planned one-off | `app/planning/PlanningPage.tsx:744,757` | `DELETE /planned/{id}` (`deletePlanned`) | `propose_delete_planned` (B14) | covered |

### Plans, commitments, goals

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Create a commitment / goal | `components/CommitmentSheet.tsx:293` | `POST /commitments` (`createCommitment`) | `propose_create_commitment` | covered |
| Preview commitment feasibility | `components/CommitmentSheet.tsx:205` | `POST /commitments/preview` (`previewCommitment`) | `get_goals` + `check_affordability` adjacent, no per-commitment preview | partial |
| Edit a commitment / contribute / mark done | `components/CommitmentSheet.tsx:276-291` | `PATCH /commitments/{id}` (`updateCommitment`) | `propose_update_commitment` (B14; name/amount/target_date only, not `funding_pots`/`contribute_delta`/`status`) | partial |
| Cancel a commitment | `components/CommitmentSheet.tsx:331` | `DELETE /commitments/{id}` (`cancelCommitment`) | `propose_delete_commitment` (B14) | covered |
| Save / replace the savings goal | `components/SavingsGoalSheet.tsx:87` | `PUT /savings/goal` (`saveSavingsGoal`) | `get_savings_position` returns `configured`/`target_amount` | partial |
| Add an offline savings pot | `components/SavingsGoalSheet.tsx:60` | `POST /savings/manual-account` (`addSavingsManualAccount`) | none | gap |
| Edit an offline savings pot | `components/SavingsGoalSheet.tsx:57` | `PATCH /savings/manual-account/{id}` (`updateSavingsManualAccount`) | none | gap |
| Delete an offline savings pot | `components/SavingsGoalSheet.tsx:74` | `DELETE /savings/manual-account/{id}` (`deleteSavingsManualAccount`) | none | gap |
| Tick / untick a savings-plan step | `app/planning/GrowPanel.tsx:827` | `PATCH /savings/plan/step/{id}` (`toggleSavingsPlanStep`) | none | gap |
| Delete a savings-plan step | `app/planning/GrowPanel.tsx:834` | `DELETE /savings/plan/step/{id}` (`deleteSavingsPlanStep`) | none | gap |
| Delete the whole savings plan | `app/planning/GrowPanel.tsx:841` | `DELETE /savings/plan` (`deleteSavingsPlan`) | none | gap |
| Set an aim / checkpoint on a category | `components/AimSheet.tsx:80`, `components/SpendVerdictView.tsx:195` | `POST /checkpoints` (`createCheckpoint`) | `get_mirror` returns active aims | partial |
| Cancel an aim / checkpoint | `components/SpendVerdictView.tsx:154`, `app/mirror/MirrorPage.tsx:272` | `DELETE /checkpoints/{id}` (`cancelCheckpoint`) | `propose_delete_checkpoint` (B14) | covered |

### Cards and terms

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Save a card's terms (status, APR, promos, BT offers, min-payment note, product key, usage) | `components/CardTermsSheet.tsx:266` | `POST /card-terms/{accountId}` (`saveCardTerms`) | `propose_set_card_apr`, `apr_pct` only | partial |
| Look up a representative rate to prefill | `components/CardTermsSheet.tsx:226` | `POST /card-terms/{accountId}/lookup` (`lookupCardTerms`) | none | gap |

### Settings and preferences

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Save name / postcode (and finish onboarding) | `app/settings/SettingsPage.tsx:319`, `components/Onboarding.tsx:139,153` | `PUT /profile` (`updateProfile`) | none | gap |
| Delete my account and all data | `app/settings/SettingsPage.tsx:335` | `DELETE /account` (`deleteUserAccount`) | none | gap (deliberate) |
| Toggle "hide net worth" | `components/PreferencesContext.tsx:117` | `PATCH /preferences` (`updatePreferences`) | `propose_set_hide_balances` (B15) | covered |
| Toggle dark mode | `components/PreferencesContext.tsx:123` | `PATCH /preferences` | none | gap (deliberate) |
| Set the pay-period boundary | `components/PreferencesContext.tsx:128`, `components/Onboarding.tsx:165` | `PATCH /preferences {pay_period_config}` | `propose_set_pay_period` (B15) | covered |
| Set region | `components/PreferencesContext.tsx:133` | `PATCH /preferences {region}` | none | gap |
| Set debt target months | `components/PreferencesContext.tsx:138` | `PATCH /preferences {debt_target_months}` | `propose_set_debt_target` (B15) | covered |
| Set debt tracking start | `components/PreferencesContext.tsx:143` | `PATCH /preferences {debt_tracking_start}` | `propose_set_debt_tracking_start` (B15) | covered |
| Set income value | `app/settings/SettingsPage.tsx:354`, `components/Onboarding.tsx:179` | `PATCH /preferences {income_value}` | `get_tax_position` reads it, `propose_set_income` (B15) writes it | covered |
| Set annual pension | `app/settings/SettingsPage.tsx:367` | `PATCH /preferences {pension_annual}` | `get_tax_position` reads it, `propose_set_pension_contributions` (B15) writes it | covered |
| Toggle Child Benefit | `app/settings/SettingsPage.tsx:378` | `PATCH /preferences {has_child_benefit}` | `get_tax_position` reads it, `propose_set_child_benefit` (B15) writes it | covered |
| Exclude accounts from the cover plan | `app/settings/SettingsPage.tsx:389` | `PATCH /preferences {cover_plan_excluded_accounts}` | `propose_set_cover_plan_exclusions` (B15) | covered |
| Change notification preferences | `app/settings/SettingsPage.tsx:398` | `PATCH /preferences {notification_prefs}` | none | gap |
| Reorder Spend "over time" widgets | `components/SpendTrends.tsx:1030` | `PATCH /preferences {spend_widgets}` | none | gap (deliberate) |
| Pin a widget to Home | `components/SpendTrends.tsx:1036` | `PATCH /preferences {home_pinned_widget}` | none | gap (deliberate) |
| Pin cards to Home | `lib/useHomePinnedCards.ts:60` | `PATCH /preferences {home_pinned_cards}` | none | gap (deliberate) |
| Send a test push | `app/settings/SettingsPage.tsx:511` | `POST /push/test` (`sendTestPush`) | none | gap (deliberate) |

### Penny, Mirror, behaviour

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Record a Mirror trait keep/change choice | `app/mirror/MirrorPage.tsx:45` | `POST /mirror/choice` (`setMirrorChoice`) | `propose_mirror_choice` | covered |
| Run a "what if" scenario | `app/scenario/ScenarioPage.tsx:420` | `POST /scenario/run` (`scenarioRun`) | `check_affordability` + `calculate`, no multi-item simulate | partial |
| Grant Penny agent-mode consent | `components/PennyConversation.tsx:1604` | `POST /penny/agent-consent` (`grantPennyAgentConsent`) | n/a, this is the gate | n/a |
| Confirm a Penny proposal | `components/PennyConversation.tsx:1552` | `POST /penny/proposals/{id}/execute` (`executePennyProposal`) | n/a, Penny's own confirm loop | n/a |
| Cancel a Penny proposal | `components/PennyConversation.tsx:1594` | `POST /penny/proposals/{id}/cancel` (`cancelPennyProposal`) | n/a | n/a |

### Income and payday

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Confirm payday landed | `components/HomeBrief.tsx:195` | `POST /income/confirm-payday` (`confirmPayday`) | `get_today_brief` returns the payday_plan item | partial |
| Dismiss a Today / companion item | `components/HomeBrief.tsx:209,302,385,457`, `components/PaydayPlanCard.tsx:76` | `POST /today/dismiss` (`dismissTodayItem`) | `get_today_brief` returns the items | partial |

### Receipts, statements, uploads

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Scan a grocery receipt | `app/receipts/ReceiptsPage.tsx:75`, `components/GroceryBasketCard.tsx:75` | `POST /baskets/scan-receipt` (`scanReceipt`) | none | gap (deliberate) |
| Delete a scanned basket | `app/receipts/ReceiptsPage.tsx:67`, `components/GroceryBasketCard.tsx:119` | `DELETE /baskets/{id}` (`deleteBasket`) | none | gap (deliberate) |
| Upload a bank statement | `components/StatementUpload.tsx:49` | `POST /statement/upload` (`uploadStatement`) | none | gap (deliberate) |
| Upload an M-Pesa CSV | `components/MpesaUpload.tsx:28` | `POST /mpesa/upload` (`uploadMpesa`) | none | gap (deliberate) |
| Upload an investment statement | `components/InvestmentUpload.tsx:38` | `POST /investment/upload` (`uploadInvestmentStatement`) | none | gap (deliberate) |
| Upload a contract note to an account | `app/components/AccountsPage.tsx:1218` | `POST /investment/accounts/{id}/notes/upload` (`uploadInvestmentNote`) | none | gap (deliberate) |
| Upload a contract note (cold start) | `app/components/AccountsPage.tsx:1254` | `POST /investment/notes/upload` (`uploadInvestmentNoteColdStart`) | none | gap (deliberate) |
| Delete a contract note | `app/components/AccountsPage.tsx:1235` | `DELETE /investment/notes/{id}` (`deleteInvestmentNote`) | none | gap (deliberate) |

### Other (insights and spend behaviour)

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Dismiss the Home spotlight insight | `components/HomeInsightSpotlight.tsx:138` | `POST /savings-insights/{id}/dismiss` (`dismissSpotlightInsight`) | `get_insights` reads it | partial |
| Mark an insight opened (engagement signal) | `components/InsightCard.tsx:563`, `app/transactions/TransactionsPage.tsx:424` | `POST /savings-insights/{id}/opened` (`markInsightOpened`) | none | gap |
| Save an insight workflow's context answers | `components/InsightCard.tsx:285` | `POST /savings-insights/{id}/context` (`saveInsightContext`) | none | gap |
| Answer "one-off / new normal" on a trend | `app/components/SpendPage.tsx:490,1055` | `POST /trends/intent` (`recordTrendIntent`) | none | gap |
| Preview what filing "new normal" changes | `components/IntentConsentSheet.tsx:57` | `POST /spend/intent-preview` (`intentPreview`) | none | gap |
| Undo a filed intent | `app/components/SpendPage.tsx:464` | `DELETE /spend/intent/{category}` (`deleteIntent`) | none | gap |

## 3. Counts

Revised 2026-09-08 (B14, B12 stage 1 shipped): edit/delete twins for the
seven originally-covered creates (planned, allocation, commitment,
checkpoint delete, recurring skip/edit/clear-override) moved 7 rows from
partial/gap to covered and 1 row from gap to partial (allocation edit,
scoped narrower than the UI's own sheet — see its row above).

Revised again 2026-09-08 (B15, B12 stage 2 shipped): eight preferences
propose tools moved 5 rows from gap to covered (hide net worth, pay-period
config, debt target months, debt tracking start, cover-plan exclusions) and
3 rows from partial to covered (income value, annual pension, Child
Benefit — all three were already readable via `get_tax_position`, now also
writable).

| | Count |
|---|---|
| Total UI write actions (api.ts write methods with at least one caller, excluding auth/push/admin plumbing) | 93 |
| Covered | 22 |
| Partial | 21 |
| Gap | 49 |
| n/a (Penny's own consent and proposal plumbing) | 1 counted (grant consent); execute/cancel excluded |

The 22 covered: `patchTransaction`, `addRule`, `dismissRecurring`, `restoreRecurring`, `addPlanned`, `createCommitment`, `setMirrorChoice`, `skipUpcomingOccurrence`, `editUpcoming`, `clearUpcomingOverride`, `deleteAllocation`, `deletePlanned`, `cancelCommitment`, `cancelCheckpoint`, `updatePreferences` used for `hide_net_worth`, `pay_period_config`, `debt_target_months`, `debt_tracking_start`, `income_value`, `pension_annual`, `has_child_benefit`, `cover_plan_excluded_accounts`.

## 4. Gaps grouped (49)

Accounts and connections (11): sync accounts, sync history, delete bank account, Mono exchange, create offline account, add offline-ledger entry, create mirror rule, edit/pause mirror rule, delete mirror rule, refresh investment prices, delete investment account.

Transactions and categories (7): undo a rule, resolve a movement, add custom category, delete custom category, dismiss miscategorised series, confirm transfer pair, dismiss transfer pair (the last three deliberate).

Bills, upcoming, allocations (2): hide/unhide a set-aside row, bring back an engine-vetoed series.

Plans, commitments, goals (6): add/edit/delete an offline savings pot, tick a savings-plan step, delete a savings-plan step, delete the savings plan.

Cards and terms (1): card-terms lookup.

Settings and preferences (9): profile save, delete account, dark mode, region, notification prefs, spend-widget order, home widget pin, home card pins, test push. (Hide net worth, pay-period config, debt target months, debt tracking start and cover-plan exclusions moved to covered under B15; region stays a gap, it was never in B15's scope — see PENNY_TOOLS.md's B15 note.)

Receipts, statements, uploads (8): scan receipt, delete basket, upload statement, upload M-Pesa CSV, upload investment statement, upload contract note, upload contract note cold-start, delete contract note.

Other (5): mark insight opened, save insight context, record trend intent, intent preview, undo intent.

## 5. Excluded from the table

Auth, push and device plumbing: `validateSession`, `subscribePush`/`unsubscribePush`, `registerApnsToken`/`unregisterApnsToken`, `registerFcmToken`/`unregisterFcmToken`, `reportPushDiagnostic`, `linkAppleIdentity`/`unlinkAppleIdentity`. Login/logout/refresh live in `components/LoginScreen.tsx`, `components/AuthProvider.tsx` and `lib/nativeAuth.ts`, not in api.ts.

Owner/admin-only: `goLiveItemAction`, `goLiveQuestionStatus` (surface `app/ops/go-live/page.tsx`).

Penny transport, not a user action: `canI` (`POST /can-i`), `pennyChip` (`POST /penny/chip`).

Unwired write methods exported from api.ts with no caller in frontend/ (dead or awaiting a UI, excluded from counts): `syncAccounts`, `autoCategorise`, `dismissMiscategorised`, `deleteSavingsGoal`, `saveSavingsPlan`, `addSavingsPlanMilestones`, `newChatSession`, `yapilySync`, `deleteYapilyConnection`, `monoSync`, `deleteMonoConnection`, `setAccountRate`, `parseRule`, `setTransactionPlanned`, `labelBill`, `deleteBillLabel`, `pinSavingsInsight`, `refreshSavingsInsights`, `markInsightsViewed`, `confirmIncomeStream`, `rejectIncomeStream`, `setManualIncome`, `deleteIncomeStream`; `yapilyRequisition`'s caller `components/YapilyConnect.tsx` is not imported by any page.

## 6. Side findings

- `DELETE /penny/agent-consent` exists on the backend (`can_i.py:825`) but there is no api.ts method for it; `app/settings/SettingsPage.tsx:735-764` renders consent state read-only and its own comment says there is no revoke. Consent is one-way in the UI today.
- `updateProfile`, `updateCommitment`, `updatePlanned` and `deleteUserAccount` bypass `toJson`/`apiErrorFromResponse` and throw generic errors, unlike every other write in the file.

## 7. Deliberately UI-only (proposed exclusions, for Kevin to confirm)

These need a native picker, touch account existence or consent itself, or are pure layout preference with no financial meaning. Proposed to stay out of Penny's propose surface:

- Scan a grocery receipt (`POST /baskets/scan-receipt`)
- Delete a scanned basket (`DELETE /baskets/{id}`)
- Upload a bank statement (`POST /statement/upload`)
- Upload an M-Pesa CSV (`POST /mpesa/upload`)
- Upload an investment statement (`POST /investment/upload`)
- Upload a contract note to an account (`POST /investment/accounts/{id}/notes/upload`)
- Upload a contract note (cold start) (`POST /investment/notes/upload`)
- Delete a contract note (`DELETE /investment/notes/{id}`)
- Delete my account and all data (`DELETE /account`)
- Grant Penny agent-mode consent (`POST /penny/agent-consent`)
- Confirm a Penny proposal (`POST /penny/proposals/{id}/execute`)
- Cancel a Penny proposal (`POST /penny/proposals/{id}/cancel`)
- Dismiss a flagged own-transfer series (`POST /transactions/dismiss-miscategorised-series`)
- Confirm a transfer pair (`POST /transactions/confirm-transfer-pair`)
- Dismiss a transfer-pair suggestion (`POST /transactions/dismiss-transfer-pair`)
- Complete a Mono (Kenya) connection (`POST /auth/mono/exchange`)
- Send a test push (`POST /push/test`)
- Toggle dark mode (`PATCH /preferences`, dark mode field)
- Reorder Spend "over time" widgets (`PATCH /preferences {spend_widgets}`)
- Pin a widget to Home (`PATCH /preferences {home_pinned_widget}`)
- Pin cards to Home (`PATCH /preferences {home_pinned_cards}`)
