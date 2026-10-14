# G267 plan and set-aside editor

Mode: Operate. A code-led design round inside Sorted's existing visual system.
Audience: someone editing a goal on their phone, often checking it after payday or in the evening. Both themes are required.
Scope: two interactive alternatives, shared goal and set-aside orchestration, fictional data only. Production editors and financial engines keep their current behaviour until Kevin chooses.

## Direction contract

THESIS: Confirm a sensible proposal, then change only the part that needs attention. The money route and the tracking rule are separate, understandable decisions.

OWN-WORLD: Figtree, mono money, slate surfaces, indigo controls, real SheetFrame, bank badges, account picker, rhythm toggle and date field. A quiet plan gap stays in ink.

STORY: Check the contribution and affordability, see where the money comes from and goes, confirm the transfer reference Sorted should recognise. Alternatives are available without a wall of purchases.

FIRST VIEWPORT: A shows the contribution, early affordability reading and editable summary in one sheet. B begins with a short details step, then a paired account route, then tracking and confirmation. A persistent footer carries the next action. The named interaction is editing a part within the same sheet, preserving the draft and returning focus to the changed part.

FORM: The ticket pins these two structures. No seed or identity change. New preview orchestration composes production primitives through fixture props; screenshots are evidence of these proposals only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Boundaries

- Six bank accounts, five receiving pots and forty synthetic transactions exercise real density. Purchases never become suggested funding transfers. Suggestions require the final explicit confirmation.
- A goal tracks a target and pot. A set-aside has no target or progress and can stay in its paying account. A source is required to confirm either; an unassigned draft can still be inspected.
- Current goals fulfil from the outgoing source rule; current allocations fulfil from inbound matching. A source-only set-aside tracker is a framework proposal, not shipped behaviour. Preview copy distinguishes a reservation from progress and does not claim to move money.
- The fixture's contribution and availability estimates explain the design; they are not a replacement financial engine. One matching transfer is counted once in the example. Partial/missed scenarios illustrate the existing framework's decision, without changing live reservations.
- Keep the prototype until the choice is implemented, then delete the preview and index entry under H113.

## Verification

The production build, scoped lint, TypeScript, design index and strict stale-preview check passed. Fifteen validated browser captures cover both variants in both themes at 390px, a set-aside, tight/no-match/partial examples, transfer search, 320px, a 500px-high viewport and desktop. The local browser matrix passed draft edits, source eligibility, transfer filtering, explicit confirmation, date selection, validation focus and Tab/Escape, with unexpected API calls blocked. Screenshots prove the proposals only. A real device keyboard, swipe and device Back remain unverified.

The guidelines audit follows the existing sheet and date controls, with labelled fields, keyboard actions, reduced motion and mono figures. The independent review accepted the visual design and financial boundaries, then found that A cached an unmounted focus target. This was corrected with semantic return keys. The production browser assertions passed for all four edit targets, and the reviewer scored that focus correction resolved.

The Impeccable launcher and detector are unavailable (permission denied); project context and this contract are maintained manually. Specialised skill agents are unavailable, so a fresh independent implementation reviewer and a documentation agent provide the finish handoffs. This is an ordinary extension; DESIGN.md and its sidecar remain the incumbent authority. No shipping raster was created.
