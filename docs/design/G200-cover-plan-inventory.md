# G200 cover plan safeguards: element inventory

Source: `frontend/components/CoverPlanSourcesCard.tsx` (639 lines), mounted once in
`frontend/app/settings/SettingsPage.tsx` (section `SECTION_ACCOUNTS`). Existing preview that renders
the production card with fixtures: `frontend/app/design/cover-plan-sources-scale/`.

## Props (the data the card is given)

| Prop | Shape | Source |
|---|---|---|
| `accounts` | `Account[]` (non-credit, `cover_source_eligible !== false`) | `getAccountsCached`, flag computed backend-side (G55) |
| `excludedIds` | `Set<string>` | `rawPrefs.cover_plan_excluded_accounts`, written by `PATCH /preferences` via a serial queue; Penny's `set_cover_plan_exclusions` is a second writer |
| `liveRoute` | `{headline, detail, legs[{accountId,name,provider,amount}], risk}` or null | first `move` item of `GET /today/cover-plan`; `risk = covered === false || no legs` |
| `shortAccountIds` | `Set<string>` | `GET /today/cover-plan` `account_eligibility[id].short` (engine's `_account_usable_by_finder`); `headroom` is also supplied but not passed to the card |
| `hideAmounts` | boolean | `!preferencesReady || hideNetWorth` |
| `onToggle` | `(id) => void` | `toggleCoverAccount` (optimistic, serialised) |

Not user-controllable today: class order (current then savings), within-class ranking (highest headroom,
fewest legs), the 10 pound buffer. Only the allow-list (exclusions) is a real user choice.
Derived inside the card: `sourceClass` (current or savings, `lib/coverPlanSourceClass.ts`), `skipReason`
(short from the engine set, empty when balance <= 0).

## Elements, top to bottom

| # | Element | Data | Nature | Problem |
|---|---|---|---|---|
| 1 | ShieldCheck tile + label "Cover plan safeguards" | static | label | fine |
| 2 | Heading "Where cover money can come from" | static | label | fine |
| 3 | "Current accounts go first, then savings, every source keeps a 10 pound buffer" + "How this works" | static | the rule (CHOICE context) | ok, but the buffer is a fixed number, not a setting |
| 4 | How-this-works panel (SOURCE_GROUPS rules) | static | explanation | engine prose ("headroom", "legs") |
| 5a | CoverRouteSummary "Cover plan right now" + headline, dense body, leg chips | `liveRoute` | engine ANSWER | duplicates Home and Upcoming move cards; red tint when `risk` |
| 5b | CoverOutcome "With these safeguards" (when no live route): 6 headings | `excludedIds`, `shortAccountIds`, balances | derived consequence of the CHOICE | red tint only when nothing is allowed (the one genuine uncovered-gap case) |
| 6 | RankingStrip "1 CURRENT ACCOUNTS, 0/0 -> 2 SAVINGS, 2/3" | allowed / eligible counts | derived | counters mean nothing; upper case; 0/0 when every current account is short |
| 7 | Search field + "Browse all N accounts" | `accounts` | navigation | needed at 17 accounts |
| 8 | "Turned off (n)" rows or "n accounts turned off" fold (cap 5) | `excludedIds` | CHOICE | the only real settings rows |
| 9 | "n skipped (a short, b empty)" fold, rows with red dot + SKIPPED pill, no toggle | `shortAccountIds`, balance | engine state | jargon; red dot on a non-risk; the user cannot change it; toggle is removed so the user's own choice for that account is hidden |
| 10 | SourceAccountRow: BankBadge (initials fallback, "OF" for Offline provider), raw account name, provider or class, "Manual transfer" pill, Toggle | `Account` | row | raw upper-case names; initials avatar for manual accounts |
| 11 | Settings-level amber note "Could not confirm which accounts the cover plan would skip" | `coverEligibilityStatus === "error"` | degraded state | sits outside the card |

## Copy that lives elsewhere

Penny's `set_cover_plan_exclusions` proposal and Home/Upcoming move cards (`services/companion.py`,
`HomeBrief.tsx`) carry the same move as an action; the card duplicates it at 5a.

## Design constraint for G201 (Settings overhaul)

The redesigned card must be a self-contained block that renders the same inline in Settings and as the
body of a drill-in page: no assumptions about surrounding chrome, one `h2`, and no sticky elements.
