# G274: keep money where it is

Mode: Operate. Design round only, extending the shipped G267 editor. No production editor, reservation calculation or fulfilment rule changes before Kevin chooses.

The user knows what the money is for and how much, not a receiving account. An account-context entry supplies the current account; a global entry may suggest the paying account, visibly confirmed on the final action. With one eligible current account there is no source picker. A reserve in that account has no receiving account, target, progress bar or transfer matcher. Existing transfer-linked edits retain their destination and rule until the user explicitly changes them.

## Direction contract

THESIS: reserve first, move only by choice. Account selection must not gate the explanation that money can stay put.

OWN-WORLD: inherit Sorted's Figtree, mono money, slate surfaces, neutral bank identities and indigo actions. Real SheetFrame, account picker, rhythm and bank badges; the proposed flow body is preview-only.

STORY: name the purpose and amount, see where it stays, optionally choose a transfer, then explicitly confirm the displayed account. Nothing moves money.

FIRST VIEWPORT: A, Reserve here, shows purpose and amount first, cadence, a quiet paying-account identity and Keep it here selected. B, Details then review, keeps the first screen to purpose and amount; its second screen is a compact editable confirmation. Source, destination and rule editing replace the same sheet body.

FORM: two code-led extensions of G267's approved compact editor, not a new visual identity. The Impeccable helper is unavailable; no seed key was produced. The repository's coded-variant review protocol applies.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Product boundaries and acceptance

- The final confirmation records the displayed source, including a suggestion. Opening or changing a draft never writes anything.
- Keeping money here maps to the existing manual reservation semantics: the full applicable amount stays reserved; no automatic fulfilment is implied. The timing and pooled/account calculations are untouched.
- The optional transfer path keeps today's receiving-account incoming-match semantics for set-asides, not a fictional future outgoing-release framework. It needs a distinct receiving account and a confirmed rule. Changing either account clears a stale rule.
- If source information is unavailable, the flow offers a local loading retry and blocks confirmation until an eligible source is known. It never invents a source or silently falls back to a transfer.
- No unconfigured financial verdict is invented. Upcoming remains the place to inspect affordability. A reserve is not a payment, and the app does not move money.
- Fixtures: one current account, several accounts/pots, global entry needing a source, no eligible source; new/transfer-linked edit, load failure, save failure and local success. All effects are inert fixtures.
- Verify both variants at 390px in both themes, 320px and desktop, sticky actions, keyboard focus/back/close, source-less blocking, one-account no-picker path, optional transfer/rule, preserved edit and local saving/error/retry. Remove this round's preview at fold-in under H113.

Skills: Impeccable and Web Design Guidelines, with an independent finish review. Incumbent DESIGN.md is preserved.

## Scoped incumbent evidence and review disposition

The round extends the shipped G267 editor using its existing `SheetFrame`, account identity and bank-badge language, Figtree/slate/indigo tokens and mono/tabular money treatment. A keeps purpose and amount first; with one eligible current account it omits a source picker. The optional transfer path preserves the editable receiving account and rule, and the final action confirms the displayed source. All interactions are fixture-local and no API contract changes are proposed.

The unavailable-helper fallback was rechecked: the Impeccable launcher was refused, so the permitted existing-world path used PRODUCT.md and DESIGN.md directly without inventing a seed key. Independent review disposition: ship at prototype scope. Root verification passed TypeScript, scoped ESLint, the design registry, a production build and the local browser matrix. All 17 captures were opened for validity; they cover both themes, 320px/390px phones and desktop. Physical-device keyboard and bank operations are not claimed. Kevin has not selected a variant.
