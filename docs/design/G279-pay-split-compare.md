# G279: compare the pay split

Mode: Operate. Code-led design round extending G269, not a new visual identity. Kevin wants to locate the parts above a chosen reference and inspect their payments. Production calculations, components and preferences are unchanged in this round.

## Direction contract

THESIS: make the difference inspectable, without disguising a reference as a budget or a diagnosis of which payment caused a cash gap.

OWN-WORLD: inherit the Calm Cockpit, Figtree, mono money, G269's shared bar, slate surfaces, section colours and small amber signifiers. Figures and prose stay ink. No new hero, score, warning-coloured money or Penny gradient.

STORY: see the existing pay split, choose a remembered reference, identify the largest cost difference, then open reconciled section evidence. The reference is information, not a coaching instruction.

FIRST VIEWPORT: the real Spend card or money-shape hero remains the anchor. A, Paired comparison, adds an income-scaled reference bar and three actual/reference rows on the drill-in. B, Follow the difference, starts with the largest cost difference, keeps every section's comparison visible and opens the same evidence. The Spend card gets a compact comparison reading. On the desktop drill-in, the instrument and comparison share a deliberate two-column layout; phones stack them with 12px separation.

FORM: two coded extensions within the established surface, following the repository's preview protocol. No concept roll applies to this local addition. The Impeccable launcher refused execution; existing-context fallback used, no seed key invented. Signature interaction: select a reference once, inspect a section in the shared sheet, return to the same comparison. Changes are immediate; no chart entrance animation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Financial contract

- The original G269 bar uses shares of all outgoings when beyond income. New reference arithmetic uses exact section amounts against **income**. It never compares the existing rounded percentages with income percentages. Currency comparisons state their income base; reference bars use the same pound axis as the actual bar.
- 50/30/20 is explicitly **adapted** to Fixed/Free/Moved. Sorted does not classify necessity, and Moved can include own-account transfers. Fixed is not exactly needs, Free is not exactly wants, and Moved is not a verified saving rate. Loan repayments are not silently moved between groups.
- The Conscious Spending Plan option is labelled one **60/20/20 example**, combining 10% investment and 10% savings in Moved. Its broader ranges are disclosed, so a difference from this example is not claimed to breach the entire framework.
- Pay yourself first has no universal percentage split. It is offered as an explanation, with no invented numeric benchmark or over/under markers.
- Moving more than a reference share is not overspending and never receives an amber cost warning. Lower movement is a neutral difference, not a nudge to save more.
- For complete numeric reference splits, Fixed + Free + Moved differences reconcile to total outgoings minus income. This is a comparison ledger, **not causal attribution of Beyond**. The funding sentence remains G269's own fact and is not inferred from which group is above the reference.
- Driver totals in this preview are explicitly illustrative. Current production payloads provide category names but not per-category amounts or merchant amounts. Fold-in needs a server-derived, period-matched evidence payload or the existing category-filtered transactions link; it must not fabricate driver values or reverse-engineer them from rounded shares.
- No trait coaching, budget-setting, aim mutation, bank action, live Penny turn or customer preference write. Reference choice is stored only under the design preview's local key. Production persistence will use the authenticated preference flow after approval.

## Sources checked

- [CFPB, spending rule worksheet](https://files.consumerfinance.gov/f/201603_cfpb_rules-to-live-by_my-spending-rule-to-live-by.pdf): the reference is a share of take-home income, with needs, wants, savings and debt payments, not Sorted's taxonomy.
- [Conscious Spending Basics](https://www.iwillteachyoutoberich.com/conscious-spending-basics/): Fixed 50–60%, investment 10%, savings 5–10%, discretionary 20–35%; its 60/10/10/20 example supports the labelled illustration, not a universal limit.

## Acceptance and delivery

Two variants, both Spend card and drill-in, under-reference, Fixed-above, Free-above, beyond-income and thin-history fixtures. Both themes at 390px, narrow phones and desktop, source/denominator explanation, reconciled drivers, reference persistence, keyboard and sheet close/back/focus. No customer API writes. Independent finish review and Web Design Guidelines gate before `finish G279 --uat-review`. The winning fold-in deliberately amends the reference-only doctrine in DESIGN.md and the ShapePage reference copy, then removes the whole temporary preview and index entry under H113. This design round preserves DESIGN.md unchanged until Kevin selects a direction.

## Verified design handoff, 16 October 2026

- Local production build, TypeScript, scoped ESLint, comparison unit tests, design index and strict stale-preview checks passed. The delivery command additionally runs the repository's backend suite and registered frontend gates before pushing; its result is recorded on the board, not assumed here.
- The final local Chromium run captured 56 views: both variants, both surfaces, both themes, four financial cases and thin history, evidence and reference sheets, alternative references, 320px and 1440px layouts, load failure and blocked storage. All captures were inspected in contact sheets, with representative originals inspected at native detail. Automated assertions covered penny reconciliation, all three evidence totals, reference persistence, safe preview links, sheet keyboard focus/return and responsive bounds. Customer API requests were inert. This is not physical iOS testing or evidence of a published UAT build.
- Evidence is local under `frontend/.impeccable/review/g279/`. The fresh independent reviewer directly inspected the 17 required originals and six contact sheets, the product/design authorities, contract, craft floor and primary sources. Final disposition: **ship**, with no material fixes. Keep the income-based comparison ledger, neutral Moved treatment, illustrative evidence and principle-without-numeric-benchmark path.
- The Impeccable context and detector launcher each refused execution with permission denied. Existing-context and manual Web Design Guidelines review were used; no automated detector result is claimed. Specialised finish-reviewer and documenter roles were unavailable, so fresh independent read-only fallback agents applied their supplied contracts. No raster assets ship with this code-led extension.
- Post-review documentation audit found no drift. The inherited slate surfaces, Figtree/mono hierarchy and responsive layout remain; financial units and semantic colour are explicit; adapted mappings and synthetic drivers remain labelled; no coaching, budget, bank or customer-preference action is introduced. Existing production components and DESIGN.md are unchanged pending Kevin's choice.
