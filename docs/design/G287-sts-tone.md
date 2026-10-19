# G287: complete Safe to Spend proposal

Revised design round, 19 October 2026. Kevin requested the whole intended production card after the earlier preview omitted footer actions and showed a sticky purple calculation row. This is not a variant approval or permission to fold into production. G218 remains the production colour doctrine until a choice is approved.

## Direction and delivery contract

- Use the actual unchanged `SafeToSpendCard` in every option, with synthetic fixture props. No copied financial ledger, replacement caveats, invented CTA or extra production prop.
- **A, Calmer full card:** 30px cash figure, 16px hero corners and a neutral calculation disclosure. Only genuine cash-shortfall hero money changes from red to ink; the existing Short risk chip and signed calculation stay. All other financial-state colours remain as they are.
- **B, Original layout:** original figure size, geometry and content, with only genuine cash-shortfall hero money changed to ink. The original indigo disclosure text remains, without a filled touch-hover state.
- **Current production:** the same real component and fixture without proposed presentation overrides. Mount one card at a time to avoid duplicate heading IDs and make comparison like-for-like.
- All presentation changes live in this temporary preview's CSS module. Production components, financial helpers, API behaviour and `DESIGN.md` are untouched.
- The real card includes the calculation, date-order caveat, card-activity panel, spend-from scope, footer freshness/estimate caveats, Your accounts and conditional See your cards, Review card bill or See what’s due action. No unavailable history feature appears as shippable UI.
- On desktop, review notes sit beside the card; they are not proposed production content. On phones they follow the card.

## Financial and interaction boundaries

- Repeated and one-off cash gaps have the same risk verdict. Familiarity does not make a payment safe. Keep the genuine cash gap, exact pence and meaningful signs in the actual production calculation.
- Plans-only remains amber. Card-check keeps its existing £0 available headline with the signed safety shortfall in the separate card calculation. Do not claim a negative card safety position is negative cash.
- The later-income fixture intentionally has a date-ordered low point that differs from cash now plus whole-window income minus bills. The actual component withholds unreconciled rows and explains the dated minimum.
- A positive pooled forecast is not proof that every paying account is funded. The account-gap fixture does not invent a completed move or a replacement account-risk card.
- Preview capture prevents the real Accounts/Cards/Upcoming controls from navigating and reports their actual destination in a labelled local status. Disclosures work inline, keyboard activation uses native controls, and Retry changes synthetic state only. No bank action, customer API request, account mutation, automatic Penny turn or external model call.
- Legacy `masked=1` links gate the entire unmasked card and amount-bearing scenario note. This is a privacy gate, not a demonstration of production's masked layout. Production hide-balances behaviour is unchanged.
- Relative fixture dates mount after preview hydration, with the actual loading card before them. This prevents a cached server fixture's as-of minute disagreeing with a fresh browser bundle. No production date logic is changed.
- Scope a content-aside restore to this card only: the design shell's sidebar-hiding rule must not hide Card balance activity. Do not loosen the global navigation rule.
- British English, no em dashes, established tokens and Figtree/mono typography. Solid indigo actions are not the Penny-only gradient.

## Verification and review record

`fixtures.test.mjs` passes for all 16 fixtures in A, B and Current production against the direct production component's exact server-rendered content. It also checks forecast/reserve invariants, the real actions, caveats, chronology and privacy guard.

- The final Chromium confirmation against the production bundle passes 56 layouts, using actual 320px, 375px, 390px and 1280px viewport overrides in light and dark themes. Required card panels are visible, cards fit the shell, long figures do not overflow and rendered controls meet 44px targets.
- Real touch events leave the A/B disclosure unfilled when open. Native keyboard Enter opens/closes it with a visible focus ring; Tab reaches the payment button and Your accounts. Accounts, both Cards actions and Upcoming are intercepted locally with correct destinations. Retry/Check again recover four synthetic states. Legacy masking mounts no figure and leaks no amount-bearing note. There were zero page exceptions and zero customer API attempts.
- Root inspected the phone, narrow, desktop and open-ledger captures at original detail. Final evidence is local at `/tmp/g287-production-confirmation-20261019/`, with `results.json` and captures, not shipped as app assets. Persistent CDP uses explicit fresh-document, hydration, fonts and two-frame waits rather than a CLI virtual-time budget that would terminate the target.
- A fresh Web Interface Guidelines review found and resolved the preview's missing skip link. Final new UI files pass the native-control, label, focus, touch, reduced-motion, theme and overflow checks. This is Chromium touch emulation, not a claim of physical iOS Safari testing.
- The independent reviewer first found the hidden content-aside and stale documentation/index descriptions. Both were corrected, and the final audit is PASS with no remaining substantive issue. Prior 17 October captures belonged to the removed handmade design and are not evidence for this revision.
- Production build, scoped ESLint, fixture tests, design-index, strict design-stale, design-no-live-data, no-raw-fetch and diff checks pass. The full disposable-database suite, typecheck and remaining registered checks are the normal `session.sh finish --uat-review` gate; their result is recorded on the board.

Impeccable polish is the design approach, within the existing Calm Cockpit. Its context launcher returned permission denied, so the existing product/design documentation was read directly and the craft floor checked manually; no launcher or detector success is claimed. The coordinator publishes this design round for Kevin's choice. After an approved fold-in, remove the preview under H113 unless another open dependency requires it.
