# G376: money moved teaching sheet

## Direction

This is a small extension of the existing teaching sheet, not a new surface.
It keeps the familiar bottom-sheet hierarchy: one payment at the top, one
plain question, then full-width choices that are easy to scan and tap.

Design skill: impeccable. The context runner was unavailable, so PRODUCT.md
and DESIGN.md were read directly. This is an Operate flow in the Calm Cockpit.

## Review variants

`/design/movement-teaching` contains synthetic, local-only proposals.

- **A, Direct choice:** presents Savings or investments as a direct destination
  beside accounts, goals and spending. The next screen chooses Savings or
  Investment, then asks for the destination name.
- **B, Destination first:** groups savings, investments and goals under Put
  money aside before choosing its specific destination. It reduces the first
  decision to the reason for the movement, at the cost of one extra step.

Both retain Another of my accounts in Sorted, An account Sorted can’t see and
Spending. They demonstrate saved goals, a true empty-goal state, loading and
failure. The empty-goal path offers Create a goal, not a misleading unnamed-pot
input. Back actions are on their own 44px rows, never compressed beside a
second action.

## Contract for production fold-in

1. Add a movement resolution for a named savings or investment destination.
   The user provides the destination name, then the engine assigns Savings or
   Investment and learns the payee. No free-form movement category is offered.
2. A named crypto platform, pension, fund or broker is Investment. A named
   cash saving account or government saving product is Savings. The UI should
   use plain labels only.
3. Existing goals can receive an allocation only after a successful goals
   read. Empty is different from a failed read: empty offers the normal goal
   creation path, while failure only offers retry and back.
4. The sheet must not write transaction corrections, create goals or save
   merchant rules until the production operations have completed successfully.
5. Keep all current movement resolutions and the spend escape hatch. The
   user-facing copy stays at an approximately 9 to 11 reading age.

## Verification target

Review at 320px, 390px and desktop in light and dark themes. Check amount
masking, input focus, keyboard flow, loading, error, empty goals, long names,
and that all controls remain 44px or larger. The preview has no network calls
or writes.

## Verification and delivery

The design round passed 40 browser interaction checks across both variants,
390px light/dark, 320px inputs, desktop, hidden amounts, goal loading/retry,
local goal creation and spending selection. Seven backend tests verify private
debit-only resolution, future learning, decision precedence and undo. The
independent code and screenshot reviews passed. Full repository gates run
through `session.sh finish G376 --uat-review`.

The API foundation is implemented; the production TeachingSheet still awaits
Kevin's selected layout. The preview creates only local synthetic goals. The
fold-in must connect Create a goal to the real existing goal setup and return
to this transaction without inventing a goal balance or an offline pot.
