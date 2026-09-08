# Penny action inventory: what the UI can do vs what Penny can propose

Captured 2026-09-08 from the live components and backend. Sibling of the question inventory in docs/penny/question-inventory/ (read side); this is the write side. Status per row: covered (a propose tool does the same write with the same fields), partial (Penny can read the object but not change it, or proposes only a subset of the UI's fields), gap (no Penny tool).

Caveat: caller surfaces were located by grep, so a UI action mounted through an indirection (context provider, hook) is attributed to the file that issues the call.

Files: frontend/lib/api.ts, PENNY_TOOLS.md, backend/app/services/penny_tools.py, backend/app/services/penny_agent.py, backend/app/routers/can_i.py

Doctrine that constrains the gap list (see PENNY_TOOLS.md and BEHAVIOURS.md): Penny proposes, never executes; every write goes through a proposal row that the user confirms in the sheet, and the server re-checks agent-mode consent at execute time. Some UI actions should stay UI-only on purpose: file uploads and receipt scans (need a picker), account deletion, granting or revoking Penny consent, and the miscategorised guardrail queue (explicitly excluded from propose_recategorise_transaction). Those are marked in section 7.

## 1. Penny tool list

### Read tools, 20, all in `TOOL_SCHEMAS` (`penny_tools.py` L131-642)

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
| `preview_trend_intent(category, answer)` | read (B17) | `app.services.spend_impact.compute_intent_preview` (`POST /spend/intent-preview`), `answer='one_off'` short-circuits without an engine call |

### Propose/write tools, 46, in `PROPOSE_TOOL_SCHEMAS` (`penny_tools.py` L643-1876)

B14 (2026-09-08, B12 stage 1 shipped) added the ten edit/delete twins below
the original eight, for the covered creates only (planned, allocation,
commitment, checkpoint delete, recurring skip/edit/clear-override). B15
(2026-09-08, B12 stage 2 shipped) added the eight preferences twins below
that, for the money-maths preferences (pay period, income, pension, Child
Benefit, debt target/tracking-start, cover-plan exclusions, hide balances)
— see section 2's per-row status changes and section 3's revised counts.
B16 (2026-09-08, B12 stage 3 shipped) added the eleven tools below that,
for offline accounts, ledger entries, mirror rules, disconnecting a bank
connection, and syncing now — see section 2's per-row status changes and
section 3's revised counts. Correction to this doc's own prior estimate:
an earlier draft of this item predicted "9 new tools, 35 total"; the
fully-specified build actually shipped eleven tools (both
`propose_update_offline_account`/`propose_delete_offline_account` and
their ledger-entry and mirror-rule twins were always in scope, the "9"
figure simply undercounted them), so the catalog is 26 + 11 = 37 after
B16. B17 (2026-09-08, B12 stages 4-5 shipped) added the nine tools below
that: full card terms (status/promos/BT offers/minimum-payment note/
product key/usage, not just APR) and the intent/insight/merchant-label
actions — see section 2's per-row status changes and section 3's revised
counts. The catalog is 37 + 9 = 46 after B17, and every count below is
reconciled against that real total.

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
| `propose_create_offline_account(name, account_type, balance)` | propose (B16) | `app.routers.manual_accounts.create_manual_account` (`POST /manual-accounts`) |
| `propose_update_offline_account(account_ref, name?, account_type?, balance?)` | propose (B16) | `app.routers.manual_accounts.update_manual_account` (`PATCH /manual-accounts/{id}`) |
| `propose_delete_offline_account(account_ref)` | propose (B16) | `app.routers.manual_accounts.delete_manual_account` (`DELETE /manual-accounts/{id}`; cascades ledger entries + mirror rules) |
| `propose_add_ledger_entry(account_ref, amount, description, date, direction)` | propose (B16) | `app.routers.manual_accounts.add_manual_transaction` (`POST /manual-accounts/{id}/transactions`) |
| `propose_update_ledger_entry(account_ref, entry_ref, amount?, description?, date?, direction?)` | propose (B16) | `app.routers.manual_accounts.update_manual_transaction` (`PATCH /manual-accounts/{id}/transactions/{txId}`; real entries only, never a `mirror:` id) |
| `propose_delete_ledger_entry(account_ref, entry_ref)` | propose (B16) | `app.routers.manual_accounts.delete_manual_transaction` (`DELETE /manual-accounts/{id}/transactions/{txId}`; real entries only) |
| `propose_create_account_rule(name, target_account_ref, match_type, match_value, sign, match_field?, source_account_ref?, backfill)` | propose (B16) | `app.routers.manual_accounts.create_rule` (`POST /manual-account-rules`) |
| `propose_update_account_rule(rule_ref, name?, match_type?, match_value?, sign?, match_field?, source_account_ref?, active?, backfill?)` | propose (B16) | `app.routers.manual_accounts.update_rule` (`PATCH /manual-account-rules/{id}`) |
| `propose_delete_account_rule(rule_ref)` | propose (B16) | `app.routers.manual_accounts.delete_rule` (`DELETE /manual-account-rules/{id}`) |
| `propose_disconnect_bank(connection_or_account_ref)` | propose (B16) | `app.services.retention.disconnect_connection` (the function `DELETE /connections/{id}` itself defers to; no api.ts method calls that route directly today, see section 6) |
| `propose_sync_now()` | propose (B16) | `app.routers.accounts.sync_all` (`POST /accounts/sync`) |
| `propose_set_card_terms(card_ref, status?, apr_pct?, promos?, bt_offers?, min_payment_note?, product_key?, usage?)` | propose (B17) | `app.routers.card_terms.save_card_terms` (read-modify-write, only the supplied fields change; `status='skipped'` replays the router's own skip branch directly) |
| `propose_record_trend_intent(category, answer)` | propose (B17) | `app.routers.checkpoints.post_intent` (`POST /trends/intent`) |
| `propose_undo_trend_intent(category)` | propose (B17) | `app.routers.spend_verdict.delete_intent_answer` (`DELETE /spend/intent/{category}`) |
| `propose_mark_insight_opened(insight_ref)` | propose (B17) | `app.routers.savings_insights.mark_insight_opened` (`POST /savings-insights/{id}/opened`) |
| `propose_save_insight_context(insight_ref, answers)` | propose (B17) | `app.routers.savings_insights.save_insight_context` (`POST /savings-insights/{id}/context`; `answers` keys validated against that insight's own `CATEGORY_WORKFLOWS` field ids) |
| `propose_dismiss_insight(insight_ref)` | propose (B17) | `app.routers.savings_insights.dismiss_spotlight_insight` (`POST /savings-insights/{id}/dismiss`) |
| `propose_pin_insight(insight_ref, pinned)` | propose (B17) | `app.routers.savings_insights.toggle_pin_insight` (`PATCH /savings-insights/{id}/pin`; a toggle — the executor only calls it when current state differs from `pinned`) |
| `propose_label_merchant(merchant, label)` | propose (B17) | `app.routers.savings_insights.label_bill` (`POST /savings-insights/label`) |
| `propose_remove_merchant_label(merchant_key)` | propose (B17) | `app.routers.savings_insights.delete_bill_label` (`DELETE /savings-insights/labels/{merchant_key}`) |

### Agent-mode consent gate

`PROPOSE_TOOL_SCHEMAS` are always offered to the model regardless of consent (`penny_agent.py` L413, rationale at L386-397: gating the schemas made the consent moment itself unreachable). The only real gate is at dispatch time: `penny_agent.py` L531-536 checks `name in PROPOSE_TOOL_NAMES and not consented` against a live `preferences_col` read of `penny_agent_consent` (L400-404, never cached) and returns `{"consent_required": True}` without calling `execute_tool`. Even with a proposal, Penny never executes it: `_create_proposal` (`penny_tools.py` L3832, shifted from L3537 by B17's additions) writes a 15-minute-TTL row in `penny_proposals_col`, and `POST /penny/proposals/{id}/execute` (`can_i.py` L1196, shifted from L1057 by B17's new executors), never reachable by the LLM, replays the stored params through the same router function the app's own confirm sheet calls, re-checking consent at execute time so a revocation (`DELETE /penny/agent-consent`, `can_i.py` L1166, shifted from L1027) kills an unactioned proposal with a 403.

## 2. Cross-reference table

### Accounts and connections

| UI action | Surface | Endpoint (api.ts method) | Penny tool | Status |
|---|---|---|---|---|
| Sync all connected accounts | `app/components/HomePage.tsx:457` | `POST /accounts/sync` (`syncAll`) | `propose_sync_now` (B16) | covered |
| Pull older transaction history | `app/settings/SettingsPage.tsx:545` | `POST /accounts/sync-history` (`syncHistory`) | none | gap |
| Disconnect / delete a bank account | `app/components/AccountsPage.tsx:920` | `DELETE /accounts/{id}` (`deleteAccount`) | none | gap |
| **Disconnect a whole bank connection** *(new row, B16)* | no UI surface found (see section 6) | `DELETE /connections/{id}` (`delete_connection`; no api.ts method exists for this route today) | `propose_disconnect_bank` (B16) | covered, not counted in section 3's UI-write totals (no api.ts caller exists) |
| Complete a Mono (Kenya) connection | `components/MonoConnect.tsx:60` | `POST /auth/mono/exchange` (`monoExchange`) | none | gap |
| Pin / unpin an account on Home | `app/components/AccountsPage.tsx:758` | `PATCH /preferences {home_pinned_accounts}` (`updatePreferences`) | `get_accounts` exposes `pinned` | partial |
| Create an offline (manual) account | `app/components/AccountsPage.tsx:962` | `POST /manual-accounts` (`createManualAccount`) | `propose_create_offline_account` (B16) | covered |
| Edit an offline account (name/balance/type) | `app/components/AccountsPage.tsx:959` | `PATCH /manual-accounts/{id}` (`updateManualAccount`) | `propose_update_offline_account` (B16) | covered |
| Delete an offline account | `app/components/AccountsPage.tsx:978, 2058` | `DELETE /manual-accounts/{id}` (`deleteManualAccount`) | `propose_delete_offline_account` (B16) | covered |
| Add an offline-ledger entry | `app/components/AccountsPage.tsx:1039` | `POST /manual-accounts/{id}/transactions` (`addManualTransaction`) | `propose_add_ledger_entry` (B16) | covered |
| Edit an offline-ledger entry | `app/components/AccountsPage.tsx:1037` | `PATCH /manual-accounts/{id}/transactions/{txId}` (`updateManualTransaction`) | `propose_update_ledger_entry` (B16; real entries only, never a `mirror:`-prefixed one) | covered |
| Delete an offline-ledger entry | `app/components/AccountsPage.tsx:1056` | `DELETE /manual-accounts/{id}/transactions/{txId}` (`deleteManualTransaction`) | `propose_delete_ledger_entry` (B16; real entries only) | covered |
| Create a transaction-mirror rule | `app/components/AccountsPage.tsx:1112` | `POST /manual-account-rules` (`createManualAccountRule`) | `propose_create_account_rule` (B16) | covered |
| Edit / pause a mirror rule | `app/components/AccountsPage.tsx:1106, 1135` | `PATCH /manual-account-rules/{id}` (`updateManualAccountRule`) | `propose_update_account_rule` (B16) | covered |
| Delete a mirror rule | `app/components/AccountsPage.tsx:1148` | `DELETE /manual-account-rules/{id}` (`deleteManualAccountRule`) | `propose_delete_account_rule` (B16) | covered |
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
| Save a card's terms (status, APR, promos, BT offers, min-payment note, product key, usage) | `components/CardTermsSheet.tsx:266` | `POST /card-terms/{accountId}` (`saveCardTerms`) | `propose_set_card_terms` (B17, every field) or `propose_set_card_apr` (APR only) | covered |
| Look up a representative rate to prefill | `components/CardTermsSheet.tsx:226` | `POST /card-terms/{accountId}/lookup` (`lookupCardTerms`) | none, deliberately excluded (B17): not side-effect-free, a stale-cache miss triggers a real Tavily call and writes the shared product-rate cache | gap (deliberate) |

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
| Dismiss the Home spotlight insight | `components/HomeInsightSpotlight.tsx:138` | `POST /savings-insights/{id}/dismiss` (`dismissSpotlightInsight`) | `propose_dismiss_insight` (B17) | covered |
| Mark an insight opened (engagement signal) | `components/InsightCard.tsx:563`, `app/transactions/TransactionsPage.tsx:424` | `POST /savings-insights/{id}/opened` (`markInsightOpened`) | `propose_mark_insight_opened` (B17) | covered |
| Save an insight workflow's context answers | `components/InsightCard.tsx:285` | `POST /savings-insights/{id}/context` (`saveInsightContext`) | `propose_save_insight_context` (B17) | covered |
| Answer "one-off / new normal" on a trend | `app/components/SpendPage.tsx:490,1055` | `POST /trends/intent` (`recordTrendIntent`) | `propose_record_trend_intent` (B17) | covered |
| Preview what filing "new normal" changes | `components/IntentConsentSheet.tsx:57` | `POST /spend/intent-preview` (`intentPreview`) | `preview_trend_intent` (B17, read tool) | covered |
| Undo a filed intent | `app/components/SpendPage.tsx:464` | `DELETE /spend/intent/{category}` (`deleteIntent`) | `propose_undo_trend_intent` (B17) | covered |
| **Pin / unpin an insight** *(new row, B17)* | no UI surface found (`pinSavingsInsight` in api.ts has no caller, see section 5) | `PATCH /savings-insights/{id}/pin` (`pinSavingsInsight`) | `propose_pin_insight` (B17) | covered, not counted in section 3's UI-write totals (no api.ts caller exists) |
| **Label a merchant as a bill type** *(new row, B17)* | no UI surface found (`labelBill` in api.ts has no caller, see section 5) | `POST /savings-insights/label` (`labelBill`) | `propose_label_merchant` (B17) | covered, not counted in section 3's UI-write totals (no api.ts caller exists) |
| **Remove a merchant's bill-type label** *(new row, B17)* | no UI surface found (`deleteBillLabel` in api.ts has no caller, see section 5) | `DELETE /savings-insights/labels/{merchantKey}` (`deleteBillLabel`) | `propose_remove_merchant_label` (B17) | covered, not counted in section 3's UI-write totals (no api.ts caller exists) |

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

Revised again 2026-09-08 (B16, B12 stage 3 shipped): eleven accounts/
ledger/rules/connections propose tools moved 6 rows from gap to covered
(sync all accounts, create an offline account, add an offline-ledger
entry, create/edit-pause/delete a mirror rule) and 4 rows from partial to
covered (edit an offline account, delete an offline account, edit an
offline-ledger entry, delete an offline-ledger entry — all four were
already partial, readable via `get_accounts`/`get_account_activity`/
`search_transactions`, now also writable). `propose_disconnect_bank` adds
one further covered capability with no existing UI-action row to flip (no
api.ts method calls `DELETE /connections/{id}` today, see the new row
above and section 6), so it is listed as covered in the cross-reference
table but deliberately excluded from the Total UI write actions count
below, consistent with how this doc already excludes `DELETE
/penny/agent-consent` for the identical reason. The Accounts and
connections gap group of 11 (section 4) therefore drops by exactly the 6
gap rows above, not by all 11 (the item's own brief, cross-checked here,
undercounted this): sync history, delete a single bank account (a
narrower, per-account capability `propose_disconnect_bank` deliberately
does not replicate), Mono exchange, refresh investment prices, and delete
an investment account were never in this stage's scope and remain gaps.

Revised again 2026-09-08 (B17, B12 stages 4-5 shipped): `propose_set_card_terms`
moved 1 row from partial to covered (card terms — every field now, not
just APR); the eight trend-intent/insight propose tools plus the new
`preview_trend_intent` read tool moved 1 further row from partial to
covered (dismiss the Home spotlight insight) and 5 rows from gap to
covered (mark insight opened, save insight context, answer one-off/new
normal, preview what filing new normal changes, undo a filed intent) — the
whole "Other" gap group from B16's count. `propose_pin_insight`/
`propose_label_merchant`/`propose_remove_merchant_label` add three further
covered capabilities with no existing UI-action row to flip (`pinSavings
Insight`/`labelBill`/`deleteBillLabel` all have no api.ts caller today, see
section 5), so all three are listed as covered in the cross-reference table
but deliberately excluded from the Total UI write actions count below,
consistent with `propose_disconnect_bank`'s own precedent. The card-terms
lookup row stays a gap, now explicitly marked deliberate (B17): the
representative-rate lookup is not side-effect-free (a stale-cache miss
triggers a real Tavily call and writes the shared product-rate cache), the
same cost-control reasoning PENNY_TOOLS.md's B17 paragraph gives.

| | Count |
|---|---|
| Total UI write actions (api.ts write methods with at least one caller, excluding auth/push/admin plumbing) | 93 |
| Covered | 39 |
| Partial | 15 |
| Gap | 38 |
| n/a (Penny's own consent and proposal plumbing) | 1 counted (grant consent); execute/cancel excluded |

The 39 covered: `patchTransaction`, `addRule`, `dismissRecurring`, `restoreRecurring`, `addPlanned`, `createCommitment`, `setMirrorChoice`, `skipUpcomingOccurrence`, `editUpcoming`, `clearUpcomingOverride`, `deleteAllocation`, `deletePlanned`, `cancelCommitment`, `cancelCheckpoint`, `updatePreferences` used for `hide_net_worth`, `pay_period_config`, `debt_target_months`, `debt_tracking_start`, `income_value`, `pension_annual`, `has_child_benefit`, `cover_plan_excluded_accounts`, `syncAll`, `createManualAccount`, `updateManualAccount`, `deleteManualAccount`, `addManualTransaction`, `updateManualTransaction`, `deleteManualTransaction`, `createManualAccountRule`, `updateManualAccountRule`, `deleteManualAccountRule`, `saveCardTerms`, `dismissSpotlightInsight`, `markInsightOpened`, `saveInsightContext`, `recordTrendIntent`, `intentPreview`, `deleteIntent`. (`propose_disconnect_bank`/`propose_pin_insight`/`propose_label_merchant`/`propose_remove_merchant_label` are four further covered capabilities on top of these 39 — see the paragraphs above for why they aren't counted here.)

## 4. Gaps grouped (38)

Accounts and connections (5): sync history, delete a single bank account, Mono exchange, refresh investment prices, delete investment account.

Transactions and categories (7): undo a rule, resolve a movement, add custom category, delete custom category, dismiss miscategorised series, confirm transfer pair, dismiss transfer pair (the last three deliberate).

Bills, upcoming, allocations (2): hide/unhide a set-aside row, bring back an engine-vetoed series.

Plans, commitments, goals (6): add/edit/delete an offline savings pot, tick a savings-plan step, delete a savings-plan step, delete the savings plan.

Cards and terms (1): card-terms lookup (deliberate, B17 — see above).

Settings and preferences (9): profile save, delete account, dark mode, region, notification prefs, spend-widget order, home widget pin, home card pins, test push. (Hide net worth, pay-period config, debt target months, debt tracking start and cover-plan exclusions moved to covered under B15; region stays a gap, it was never in B15's scope — see PENNY_TOOLS.md's B15 note.)

Receipts, statements, uploads (8): scan receipt, delete basket, upload statement, upload M-Pesa CSV, upload investment statement, upload contract note, upload contract note cold-start, delete contract note.

Other (0): every row in this group (mark insight opened, save insight context, record trend intent, intent preview, undo intent) moved to covered under B17.

## 5. Excluded from the table

Auth, push and device plumbing: `validateSession`, `subscribePush`/`unsubscribePush`, `registerApnsToken`/`unregisterApnsToken`, `registerFcmToken`/`unregisterFcmToken`, `reportPushDiagnostic`, `linkAppleIdentity`/`unlinkAppleIdentity`. Login/logout/refresh live in `components/LoginScreen.tsx`, `components/AuthProvider.tsx` and `lib/nativeAuth.ts`, not in api.ts.

Owner/admin-only: `goLiveItemAction`, `goLiveQuestionStatus` (surface `app/ops/go-live/page.tsx`).

Penny transport, not a user action: `canI` (`POST /can-i`), `pennyChip` (`POST /penny/chip`).

Unwired write methods exported from api.ts with no caller in frontend/ (dead or awaiting a UI, excluded from counts): `syncAccounts`, `autoCategorise`, `dismissMiscategorised`, `deleteSavingsGoal`, `saveSavingsPlan`, `addSavingsPlanMilestones`, `newChatSession`, `yapilySync`, `deleteYapilyConnection`, `monoSync`, `deleteMonoConnection`, `setAccountRate`, `parseRule`, `setTransactionPlanned`, `labelBill`, `deleteBillLabel`, `pinSavingsInsight`, `refreshSavingsInsights`, `markInsightsViewed`, `confirmIncomeStream`, `rejectIncomeStream`, `setManualIncome`, `deleteIncomeStream`; `yapilyRequisition`'s caller `components/YapilyConnect.tsx` is not imported by any page.

## 6. Side findings

- `DELETE /penny/agent-consent` exists on the backend (`can_i.py:825`) but there is no api.ts method for it; `app/settings/SettingsPage.tsx:735-764` renders consent state read-only and its own comment says there is no revoke. Consent is one-way in the UI today.
- `updateProfile`, `updateCommitment`, `updatePlanned` and `deleteUserAccount` bypass `toJson`/`apiErrorFromResponse` and throw generic errors, unlike every other write in the file.
- `DELETE /connections/{id}` (`delete_connection`, `accounts.py`) exists on the backend and is what `propose_disconnect_bank` (B16) replays, but there is no api.ts method for it (checked: no `/connections` write or read caller of any kind in `lib/api.ts`, `GET /connections` itself has no frontend caller either) and no UI surface calls it today. The Accounts page's own disconnect action, `deleteAccount`, calls the narrower per-account `DELETE /accounts/{id}` instead, which can incidentally tear down a whole TrueLayer connection only when it was the account's last one — a side effect, not the same deliberate whole-connection action. Penny's own propose/confirm path is, today, the only way to explicitly disconnect a whole bank connection in one step; this is honestly reported as a covered row in section 2 rather than overclaiming a UI caller that doesn't exist.

## 7. Deliberately UI-only (proposed exclusions, for Kevin to confirm)

Still awaiting Kevin's confirmation as of B17 (2026-09-08) — none of this list's rows are changed by B17's stage 4/5 build; none of the actions B17 covers (full card terms, trend intents, insight/merchant-label actions) belong on this list, they are all real propose tools now, see section 2.

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
