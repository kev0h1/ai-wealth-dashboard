# G351 approved schedule layout

Kevin chose B, Compact overview, on 28 October 2026, with equal space above and below “See full schedule”. Impeccable guided the fold-in, with PRODUCT.md and DESIGN.md authoritative.

## Production implementation

Penny confirms a scheduled goal with its total, deadline, contribution rule, current pay period, full schedule disclosure and explicit source/destination. Create goal and Cancel precede Edit schedule. Conversion explains that the existing set-aside is paused and past transfers are not imported. Sorted tracks the plan; existing bank transfers continue until the user changes them.

The disclosure uses a single border on each side and a centred 48px row with equal vertical padding. The source block starts below it with one 16px gap. Amounts stay in ink and use money typography. Hidden figures mask the goal name, rule and values; editing asks the user to show figures first.

View plan separates saved progress, planned-to-date and the scheduled period amount. A custom current-period contribution is identified separately. Existing source, destination, tracking and matched-payment details remain under Plan details. Metadata editing stays available; totals and deadlines are controlled by Edit schedule.

The editor supports daily, weekly and pay-period steps, a fixed list, and a percentage of expected pay. It uses the server preview and the user's actual pay-period configuration. First period-based contributions fall on the chosen start date; later ones fall on pay-period starts. Percentage figures are estimates. When both count and end date are present, the earlier limit applies. Stale replies cannot enable saving a different draft.

Changing a pending Penny proposal supersedes the old envelope and creates a new ID. A simultaneous confirmation can claim the old ID or the revision can supersede it, but neither can execute unseen changed parameters. Source ownership and source/destination separation are checked before supersession. Restored chat carries only the whitelisted schedule display fields. Execution still uses the existing consent gate.

## Verification

Focused backend coverage exercises the schedule preview, pay-period boundaries, source ownership, destination exclusion, immutable revision, execution races, expiry, failed replacement and restored proposal metadata. The frontend gate renders the production confirmation and checks financial distinctions, estimates, masking and restoration.

The optional browser fixture in frontend/scripts/fixtures/g351-goal-flow.tsx mounts production components with synthetic responses. It covers 320px, 390px and desktop layouts, both themes, measured disclosure spacing, source changes, out-of-order previews, explicit confirmation, failed writes and refresh-only retries. Evidence is stored outside the repository at /tmp/g351-fold-evidence. The temporary QA route is removed before delivery.

Independent production diff review passed. The old design-round directory and index entry are removed under H113. No permanent preview or user data is shipped.
