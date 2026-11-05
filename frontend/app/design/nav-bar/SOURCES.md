# Navigation icon sources

The four tab icons are from [Phosphor Icons](https://phosphoricons.com/), by Helena Zhang and Tobias Fried. Penny keeps the existing approved Sorted mark.

Retrieved on 5 November 2026 through the [Better Icons skill and CLI](https://github.com/better-auth/better-icons), CLI version 1.0.4, which returns the original Iconify Phosphor SVG payloads. The `d` attributes and opacities are preserved in `phosphor-icons.json`. The only adaptation is to flatten inherited `currentColor` groups and render the original 256px viewBox at 24px. No paths have been drawn or edited for this preview.

| Tab | Phosphor icon | Iconify ID |
| --- | --- | --- |
| Home | House Simple | `ph:house-simple` |
| Spend | Wallet | `ph:wallet` |
| Upcoming | Calendar Dots | `ph:calendar-dots` |
| Planning | Flag Pennant | `ph:flag-pennant` |

Each icon includes the regular version, the `-fill` version and the `-duotone` version. Idle tabs use regular; the current tab uses fill for Ink, regular for Outline and duotone for Original. While Penny's appearance is unresolved, every tab uses regular.

The Phosphor assets retain their MIT licence in [PHOSPHOR-LICENSE.txt](./PHOSPHOR-LICENSE.txt). The licence was copied from [Phosphor's source repository](https://github.com/phosphor-icons/core/blob/2b75f3ad12b420c9504ef05df8d2564a28f8500e/LICENSE); that revision records the licence source, not an assertion that Iconify's payloads match that repository revision byte for byte.

The preview uses bundled vectors and makes no icon catalogue requests at runtime. No new application dependency is required.
