# G423 A: Quiet mobile navigation

Kevin approved A, Quiet rail, on 5 November 2026 after the Phosphor icon revision. The production bar follows the saved Penny appearance; no second navigation setting is introduced. The temporary comparison is retired at fold-in.

The four tab icons are from [Phosphor Icons](https://phosphoricons.com/), by Helena Zhang and Tobias Fried. Penny keeps the canonical Sorted mark.

Retrieved on 5 November 2026 through the [Better Icons skill and CLI](https://github.com/better-auth/better-icons), CLI version 1.0.4. All twelve regular, filled and duotone variants preserve the retrieved `d` attributes and opacities in [phosphorIcons.ts](../../frontend/lib/navigation/phosphorIcons.ts). The only adaptation flattens inherited `currentColor` groups and renders the original 256px viewBox at 24px. No icon paths were drawn or edited for this change.

| Tab | Phosphor icon | Iconify ID |
| --- | --- | --- |
| Home | House Simple | `ph:house-simple` |
| Spend | Wallet | `ph:wallet` |
| Upcoming | Calendar Dots | `ph:calendar-dots` |
| Planning | Flag Pennant | `ph:flag-pennant` |

Idle icons are regular. The current tab uses fill for Ink, regular for Outline and duotone for Original. Unknown appearance keeps every tab regular and Penny markless. The door retains its accessible name, pressed/current states and independent payday indicator. Only the Upcoming destination receives the payment-attention dot.

The assets retain their [MIT licence](../../frontend/components/navigation/PHOSPHOR-LICENSE.txt), copied from [Phosphor's source repository](https://github.com/phosphor-icons/core/blob/2b75f3ad12b420c9504ef05df8d2564a28f8500e/LICENSE). That revision identifies the licence source; it does not assert that Iconify's payloads match the repository revision byte for byte. Bundled vectors require no runtime catalogue request or new application dependency.

`BottomNav` retains its original preference, route, payment-count, payday-cache and Penny conversation context wiring. `BottomNavRail` owns the approved presentation. Its stable navigation markers preserve app-wide software-keyboard hiding; the 56px launcher remains 4px inside the 64px rail, so its target cannot intercept a card action above it. Links retain their real destinations, including `/spend?view=period`, and the DOM order follows the five visual slots.
