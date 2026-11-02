# G391 Accounts layout: original list restored

> **Current decision, 2026-11-02:** Kevin explicitly kept the current header and asked to restore everything below search: account-type filters, grouping, subtotals and Available. The compact-directory body described below is historical and superseded. The current search, refresh/add controls, privacy, last-known-data handling and account-detail improvements remain. The restoration reuses the original ledger and group components; no new art-direction round is needed.

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

## Current production decision, 2 November 2026

The first interpretation of A shipped a compact directory and moved Available into account detail. Kevin corrected that scope: keep the current header and search, and restore everything below search. The compact body is superseded.

Accounts again uses the original All, Current, Savings, Credit, Investment and Owed filters, rounded group cards with counts and bank-balance subtotals, the Pinned band, collapsed Inactive accounts and the separate Offline section. The original ledger rows show Available and its existing warning beneath eligible current-account balances. Credit rates remain reachable from their rows. Offline accounts also appear in matching search/filter results. Names never determine account kind.

The Accounts title, Find an account context, adjacent Refresh/Add, bank-time feedback and privacy rail are unchanged. The old Console net-worth card and KPI fetch stay removed. Detail retains Available, projected shortfall, stored projections under Working and the shortfall eligibility safeguards. Transactions, manual rules and investments remain accessible. G389 refresh eligibility and last-known-data behaviour are unchanged, including the A186 balance-only exception.

Restoration reuses the production estate controls, group cards and ledger rows. Negative masks retain their sign, unavailable balances/subtotals stay Pending, collapsed rows leave keyboard navigation, and returning from detail targets the exact original row even where a pinned account appears twice. The Accounts tour describes the restored filters and Available lines. No preview is added or retained for this authorised restoration.

Root verified the actual list/header/detail components with synthetic fixtures at 320, 390 and 1280px in both themes. Checks cover type filters, bank-balance subtotals, Available warnings, signed masks, pinned/inactive groups, collapse, card-rate keyboard activation, source-row focus restoration and header callbacks. Screenshots were inspected at original resolution; the narrow-phone subtotal was corrected to keep its sign and amount together. Evidence is under `.impeccable/review/g391-restore`; these are component fixtures, not authenticated live-account screenshots. Focused G214/G236/G339/pinned tests, TypeScript and design-index/stale checks pass.

Independent source review passed after replacing the superseded compact-layout decision record and separating the account opener from sibling card-rate actions. Both are native buttons with independent keyboard and assistive-technology semantics. The original visual layout is retained.
