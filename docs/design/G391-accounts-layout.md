# G391 Accounts layout: approved A

Mode: Operate.

## Direction contract

### A: Find an account

**Thesis:** Accounts is a compact directory when the job is locating and opening a particular account, not interpreting a second net-worth dashboard.

**Own world:** A calm ledger desk. Search, an All/Pinned filter and collapsible account-type bands make a 21-account estate navigable without repeating pinned rows or page totals.

**Story:** Find an account, orient by its type, read its one primary bank balance, then open it for the spend-from and working evidence.

**First viewport:** Header controls keep Add and Refresh together but make no refresh-placement decision for G389. Search and the directory begin immediately below.

**Form:** A compact directory with hairlines, local badges and bank marks, not a card gallery. Each row leads with the bank balance. Available sits only in opened eligible current-account detail.

**Finish:** The detail view preserves list/filter/search context and focus on Back, and uses a local Count towards Left to spend toggle for eligible bank accounts.

### B: Where your money is

**Thesis:** Accounts can answer a position question when the account landscape feels too fragmented, as long as Assets and Owed visibly reconcile to the net position.

**Own world:** A short financial statement above a bank-organised field book. It groups accounts by bank, labels each bank's net balance and leaves detailed work one tap away.

**Story:** Read the net position, check its Assets minus Owed reconciliation, then use a familiar bank heading to find an account.

**First viewport:** The net figure and three-line reconciliation are the opening decision instrument. The list begins by bank, rather than a recoloured form of A.

**Form:** Plain canvas, rules and grouped ledger rows. One primary balance per row prevents Available or a forecast being mistaken for a balance.

**Finish:** Detail contains the same Working disclosure and local account control as A, without pretending the detail is a new calculation engine.

## Shared financial and interaction contract

- Fixtures are synthetic, precomputed and local only: 21 accounts across six UK bank brands plus one offline account, including pots, cards, pinned, dormant, not-counted, syncing and unknown examples. The complete position fixture reconciles £18,549 Assets less £1,486 Owed to £17,063 net position.
- A short current account demonstrates G385's contract: bank balance £259 less scheduled payments £548.00 reaches a lowest balance of −£289.00; Available is £0 and the short estimate is stated in detail. It is not a payday closing projection.
- List amounts use whole pounds under G339. Working evidence uses exact pence and distinguishes bank balance, payments, plans, lowest projected balance and buffer. Current-account fixtures reconcile the displayed Available amount through that working; unsupported accounts explicitly say Working is unavailable.
- Signed balances retain U+2212. No Available figure is summed into a balance, asset total or net position.
- Refresh feedback is a neutral request acknowledgement. It deliberately does not alter the last known bank-data time or claim a completed sync.
- Header placement is intentionally consistent in both variants, but does not select G389's still-open refresh-placement choice. G385 is respected as a semantic contract, not presented as an approved visual decision.
- Detail has simple Transactions/Categories controls, Escape and Back restoration to the source row and scroll position. Add choices acknowledge locally with explicit verbs. Buttons and inputs use 44px targets and the search input is 16px. The Count towards Left to spend control is local-fixture-only and is offered for eligible current and savings accounts, never the short bills account.

## States and verification

The preview exposes normal, empty, loading, error, syncing and unknown states, plus light/dark, hidden-balance and clean review controls through URL parameters. Empty, loading and error withhold figures rather than leaving normal data behind. Unknown withholds totals that include the pending account and scrubs its detail values. B totals follow the shown search/filter results and label that scope. `data-g391-ready` is set after hydration. Root verified both variants in light and dark at 390px, hidden values at 320px, and layouts at 1280px, with original-resolution screenshots inspected. Browser checks passed search and filtered totals, All/Pinned, dormant toggling, short Working, hidden signs, Add keyboard controls, Back/Escape focus restoration, loading/error/empty, retry, syncing and unknown detail. No horizontal overflow, runtime exceptions or API requests occurred. Evidence is retained at `.impeccable/review/g391/`.

Independent review used a fresh implementation reviewer because the dedicated skill reviewer role was unavailable. Its money-font, unknown-detail and filtered-total findings were fixed; source and screenshot re-review passed. Root also checked the current Web Interface Guidelines. Those results describe the preview round only.

## Approved production implementation, 2 November 2026

Kevin chose A. Accounts now uses a compact canonical-type directory with one balance per row, hairline collapsible groups, search, All/Pinned and the additive Dormant filter. Manual accounts are Offline. The server does not supply a reliable distinct Pots kind, so production never infers one from names or explanatory text. G389's approved Home entry and adjacent Refresh/Add were brought in as an explicit dependency. The old Console KPI fetch and duplicated pinned rows are removed.

Account detail displays the existing Available estimate and shortfall, with stored projections and low points under Working. It does not reconstruct a forecast from incomplete payment/buffer inputs. The exact bank balance is immediately above this evidence. Non-finite values stay unavailable; signed masks apply throughout. The shortfall case does not offer Count towards Left to spend. Existing manual rules, card rates and investment holdings remain accessible. Bank-detail Back/Escape restore the directory's query, filters, scroll and source-row focus, and the Accounts tour now describes the directory.

The temporary accounts-layout preview and index entry were removed under H113 after checking external imports and approval-pack dependencies. G385's shared financial semantics are respected; no separate G385 visual choice is implied. Evidence for this fold-in uses real production components with synthetic data and is stored under `.impeccable/review/g391-foldin`; it is not a screenshot of an authenticated live account.

A186 compatibility: balance-only accounts do not participate in the overview refresh completion baseline or cooldown. The backend deliberately skips their bank setter, so awaiting their bank timestamp would falsely leave a mixed account refresh partial until timeout. Their saved balances and timestamps stay visible; the refresh hook uses the same eligibility predicate and explains when only balance-only accounts remain.

Independent source review passed after fixing the shortfall control gate, tutorial, pending-detail money and focus restoration. Root browser checks passed with 21 synthetic accounts at 320/390/1280px in both themes, filtering, collapse, signed masking, Working, focus return and header callbacks. Root inspected original screenshots, corrected the mobile search minimum height, and inspected confirmation captures. New components passed focused lint and TypeScript; retained feature gates were updated only where the approved directory supersedes old source layout assertions.
