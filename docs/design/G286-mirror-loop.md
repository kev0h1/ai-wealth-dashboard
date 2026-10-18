# G286: a Mirror that closes the loop

**Approved A, folded in 18 October 2026.** This is an ordinary extension of the existing Calm Cockpit, not a new product world. The temporary 17 October design round is retained below as historical evidence. Its two alternatives have been superseded by the approved production loop. The temporary preview and its index entry have been removed under H113; the original remains in Git history.

## Direction contract

THESIS: keep consent, the chosen next step, transaction evidence and calm reflection with one trait, rather than a detached list of aims.

OWN-WORLD: inherit the slate canvas, Figtree, mono currency, category identity and restrained indigo actions. No warning treatment for a trait or an aim result.

STORY: notice a pattern, choose keep or change, check the current pace, review a completed result, then choose whether to keep that pace, adjust or leave the check complete. Kept and unchosen traits receive no coaching.

FIRST VIEWPORT: the approved A trait card leads, with its current or completed check attached. Evidence sits alongside on desktop and follows below on phones. Other patterns remain available but quiet.

FORM: Kevin's coded A, chosen 18 October 2026, extends the existing Mirror. No new identity or concept roll. Use the shared AimSheet, owned transaction evidence and original recorded benchmarks, not the prototype's local fixture state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Chosen direction and current contract

**A: Trait in motion** attaches one active, consented trait to its own evidence and one pace check. The Mirror remains descriptive first: a trait is never a warning, score, diagnosis or instruction. The user explicitly chooses keep or change for that trait. Keep leaves coaching off. Change permits one next step only, with no goal dashboard, checklist or self-reported completion.

For a category-backed trait, that step is an aim: a neutral pace check, not a budget or moral limit. It appears in the approved `MirrorFeedbackCard`, alongside cited trait evidence, and uses the shared `AimSheet` for create and adjust actions. Choosing change does **not** open the editor automatically. The user takes the explicit edit or set-aim action, and masked figures prevent setting or adjusting an aim until figures are shown. A stopped aim leaves the trait choice untouched; stopping is confirmed and can be cancelled. A save failure is visible and retryable.

The card separates the current pay-period check from a completed check. A current check uses the server-provided period and pace data. A completed check retains its original aim benchmark and result, with a checked date; selecting a new current-period pace never rewrites that completed record. With both present, the completed check is available behind an explicit disclosure. With a completed check but no active aim, the user may keep that pace for the current pay period or open the shared editor. A closed check has no stop control.

The owned history endpoint returns at most 12 completed aims; the card uses the latest completed record for its category. Evidence shows spending net of refunds for that aim's period, with up to five named records and a reconciled remainder. Separately, four completed seven-day windows show payment counts, excluding refunds; these windows can predate the aim. They are not four aim outcomes or a projection. Payment-keyword records are bounded to the user's own TrueLayer transaction evidence, with a maximum of six shown, and are available only in the hygiene trait's evidence context. A matching description does not prove a missed payment. The A165 profiling and DPIA work remains pending specialist review; G286 makes no legal conclusion, introduces no LLM work and adds no retention regime.

## Boundaries

- `BEHAVIOURS.md` remains authoritative: explicit trait-level consent; one next step; no goal dashboard; no self-report completion; no invented causal attribution, peer comparison or scoring. Checkpoint and aim outcomes rest on transaction evidence.
- The established Mirror calls remain the source for portrait and consent. Aim feedback comes from stored checkpoint history and current checkpoint records, resolved by the backend. The client does not rebuild a finished benchmark from a browser date or a later aim.
- Currency retains grouping, meaningful pence and the real minus sign. Masked amounts do not leak through accessible names. User-facing copy uses British English and no em dashes.
- Red remains for genuine financial risk only. A trait, a choice to change, a pace result and a payment-hygiene observation are not financial risk, so they use existing slate, indigo and category identity rather than warning treatment. Penny's indigo-to-violet gradient remains Penny-only.
- This implementation adds no new retention, automated inference, personal-data source or external model call. Thin, unavailable and failed feedback is stated as such rather than filled with a claim.

## Production review, 18 October 2026

- Production components reviewed: `frontend/app/mirror/MirrorPage.tsx`, `frontend/components/MirrorFeedbackCard.tsx`, `MirrorEvidence.tsx`, `AimSheet.tsx`, `mirrorFeedback.module.css`, and `frontend/lib/mirrorFeedback.ts`. The feedback view is attached to the focused trait and uses existing stored checkpoint-feedback records.
- Fresh independent UI review found two initial issues. Both were corrected and the reviewer’s final disposition was **ship**. The separate financial review confirmed the DST and trait-context fixes; strict source-failure handling was added. This disposition covers the reviewed implementation, not a claim that the full delivery gate has finished.
- Twenty-six targeted backend tests passed, together with the current TypeScript check, G242 checks, new G286 render checks and production build. The full `session.sh finish` gate remains pending and its result belongs on the board.
- Real production components were rendered temporarily through `/design/mirror-loop?production=1`, with all financial API requests intercepted. Evidence is fixture-only: it is not a capture of a customer-authenticated page. The review covered nine matrix cases and two expanded screenshots, including light and dark views, compact width, long or masked figures, active, completed, thin and error feedback. Kept consent is checked in the interactions; late-data reconciliation is checked in backend tests, not claimed as a captured state.
- Synthetic interaction checks covered pence editing, negative-value validation, consent failure, stop confirmation and cancellation, focus return, closed checks retaining their original benchmark, and masked figures without horizontal overflow. Local QA evidence sits in the ignored `frontend/.impeccable/review/g286/` directory and is not a shipped asset.
- The Impeccable launcher/detector was unavailable because of a permission denial. No automated detector pass is claimed. Manual Web Interface Guidelines and fresh-fallback reviews were used; the specialised documenter role was unavailable. No raster asset was introduced.

## Historical design-round evidence, 17 October 2026

The original round proposed two local, fixture-only alternatives: A, Trait in motion, and B, Period review. It explored an undecided trait, kept trait, active change with an aim, completed result below, near and past the aim, thin and unavailable history, long money, and dated fee/payment evidence. It used local choices and intercepted requests, so it made no customer write and no production claim. Kevin chose A on 18 October; B is retained here only as the design-round comparison, not as a current option.

The round’s initial review corrected the shell-hidden evidence panel and then recorded the preview matrix. The earlier preview checks, preview build, lint, fixture checks, design-index and strict design-stale result are historical preview evidence only. They do not substitute for the current implementation review or for the still-pending full finish gate.
