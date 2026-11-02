# G395 bank coverage: approved A

## Direction contract

- **Mode:** Operate. A person is choosing a bank, then checking the scope before a consent hand-off.
- **THESIS:** Coverage is a quiet capability fact attached to a bank, not a warning or a promise.
- **OWN-WORLD:** This extends the established Calm Cockpit sheet: slate surfaces, one indigo action, measured hairlines and no Penny treatment.
- **STORY:** Choose a bank, see the limited scope where it matters, review the same fact before consent, then acknowledge a simulated Finexer hand-off.
- **FIRST VIEWPORT:** A familiar picker sheet leads with search and recognisable local bank marks. Full CSK coverage remains uncluttered. Partial coverage is visible in the initial rows. Unknown coverage is explicitly labelled on its bank row before selection and has a direct review-state link.
- **FORM:** Variant A uses one quiet factual line for partial coverage. Variant B uses compact, labelled Current, Savings and Cards marks with accessible included/not-listed words. Both retain the information in Review.
- **FINISH:** The review explains that unlisted pots and account types may show only a balance without transactions, and that coverage is Finexer’s published listing rather than a guarantee. Existing Finexer agency wording is retained verbatim.

## Preview contract and limits

The original preview used a static map captured in the A186 board note dated 2 November 2026 only. At the time A186 was TODO and no coverage API was merged, so the preview did not invent a provider payload, production model or source-of-truth claim. The fixture includes an explicit unknown example rather than treating it as fully supported. The live public Finexer provider page currently requires login and its accessible response did not independently verify account-type coverage; the dated A186 capture is the preview source.

Routes accept `variant=a|b`, `mode=light|dark`, `state=normal|health|unknown|empty`, and `clean=1`. `state=health` opens a selected bank with one existing-style provider-health notice; it is not duplicated with coverage content. The Continue action only opens a local simulated hand-off. No network call, real consent or navigation occurs.

The client root sets `data-g395-ready` from a ref callback after hydration for capture tooling.

## Verification, 2 November 2026

Root inspected 18 actual Next-page captures: both variants in light/dark at 390px, search results, selected-bank review and Monzo partial coverage with the health notice; unknown coverage at 320px and empty recovery at 1280px. Browser checks covered filtering, selection, heading focus, Escape and return focus, search-clear focus, retry and simulated hand-off focus. No horizontal overflow, runtime exceptions or API requests occurred. Evidence is retained in the worktree at `.impeccable/review/g395/`.

Independent review used a fresh implementation reviewer because the dedicated skill reviewer role was unavailable. Its initial wording/focus findings were corrected and its source plus screenshot re-review passed. The root also checked the current Web Interface Guidelines. These are preview results only; production wiring was not part of that preview round.

## Approved implementation, 2 November 2026

Kevin chose A. The production provider response now exposes A186's merged coverage map and capture date. The picker and review use these API fields, including explicit unknown coverage and a dated, hedged source note. Full coverage has no extra row line. Consent actions, live health overlays and the agency disclosure are retained. The temporary bank-coverage preview and index entry were removed under H113; no external imports or approval-pack dependencies were found.

Independent production source review passed after correcting the advisory date and row markup. Verification evidence uses actual production components with synthetic providers under `.impeccable/review/g395-foldin`; it does not claim a real bank consent or live provider guarantee.

Production-component checks passed at 320, 390 and 1280px in light and dark. Root inspected all six screenshots at original resolution. Checks covered partial/full/unknown coverage, health notice, dated source, search-clear focus, Escape/Change focus restoration, explicit one-time hand-off, loading/error/retry, 44px targets and no external API requests. Focused backend suite: 17 passed. TypeScript, design index/stale gates and the coverage semantic gate passed.
