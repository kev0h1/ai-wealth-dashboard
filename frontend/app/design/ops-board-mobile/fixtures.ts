// TEMPORARY PREVIEW — H56 (backlog item H56), design round only.
//
// Fixture data for the three "Focus first" phone-board variants. Every id,
// title, owner, priority, state, reason, link, branch and note below is
// read verbatim (title/reason/link/branch/note text copied, only the
// leading "<ID>. " stripped from the title the same way the real parser
// in backend/app/services/backlog.py does) out of the repo's own TODO.md
// as it stood on 2026-09-16/17, the same day this item was briefed. This
// is a real, if partial, snapshot of the actual board, not invented
// placeholder copy — including its hardest layout case, several titles
// that run to full paragraphs (A38, F19, G41, G105, G111), because that
// is what this board's titles are actually like.
//
// ONE ITEM IS A DELIBERATE EXCEPTION: A37 is shown in the `review` state
// below to demonstrate that card, even though the live board has zero
// items in review right now (a state can empty out at any moment, and
// the Focus-first layout has to hold up when it is not). A37's id, title,
// owner and priority are all real and unmodified; only its state and
// branch are illustrative. Every other item's state matches TODO.md
// exactly as of this snapshot.
//
// IN_FLIGHT is every item TODO.md currently has in in-progress, blocked,
// review, rejected or uat (a fair sample of the uat run, which numbers
// eleven on its own — trimmed to seven so the list reads like Kevin's
// actual dozen rather than reproducing the whole Canvas Before Cards
// sweep). G94 (rejected) is included in full, not trimmed: it is the
// board's only rejected item right now, and its absence from this fixture
// set is exactly what let a real regression (rejected items rendering in
// no section of the ribbon board, HIGH 2 of the 2026-09-17 independent
// audit) ship past both the preview and a first reviewer — the gate can
// only catch a class of bug it has a fixture for. TODO_SAMPLE
// and DONE_SAMPLE are a representative slice of the remaining items, used
// to populate the collapsed "To do" / "Done" sections when a variant
// expands them; TODO_TOTAL_COUNT and DONE_TOTAL_COUNT are the real counts
// read straight off TODO.md (`grep -c "^- \[ \]"` / `"^- \[x\]"`) on the
// same day, so the collapsed counts on every variant are the real scale
// of the board (300 items across 8 sections), not a rounded guess.

import type { GoLiveItem } from "@/lib/goLive";

function item(partial: Partial<GoLiveItem> & Pick<GoLiveItem, "id" | "section" | "title" | "owner" | "state">): GoLiveItem {
  return {
    text: "",
    reason: null,
    branch: null,
    link: null,
    uat_review: false,
    done_at: null,
    commit: null,
    notes: [],
    priority: "p3",
    unblocks: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------
// In flight — in-progress, blocked, review, uat. The whole point of the
// Focus-first screen.
// ---------------------------------------------------------------------

export const IN_FLIGHT: GoLiveItem[] = [
  item({
    id: "H55",
    section: "H",
    title:
      "The /ops/go-live board is unusable on a phone: every scroll that starts on a card either does nothing or turns into a drag, because BoardView.tsx puts touch-none (touch-action: none) on every card while the dnd-kit TouchSensor activates after only 200ms, so the browser can never scroll from a card and an ordinary scroll gesture becomes an accidental state change (Kevin, 2026-09-16); make vertical scrolling always win, make a drag deliberate, and add an explicit Move to state picker to ItemDetailSheet covering every state so an accidental move can be set back by hand, which is the recovery Kevin asked for",
    owner: "claude",
    priority: "p1",
    state: "in-progress",
    branch: "feature-H55-the-ops-go-live",
  }),
  item({
    id: "G98",
    section: "G",
    title:
      "Canvas Before Cards review 13 of 16, Month: produce two or three coded variants that lead with the monthly verdict and explanation on the canvas, keep charts and reconciled evidence in earned containers, and preserve the path into the month story; verify all responsive states before production changes",
    owner: "codex",
    state: "in-progress",
  }),
  item({
    id: "A37",
    section: "A",
    title: "A31's exception-leak guard misses any handler that stores the exception in a variable first",
    owner: "claude",
    // Illustrative only — see the file header. TODO.md has no item in
    // review right now; this demonstrates the card that state needs.
    state: "review",
    branch: "feature-A37-exception-leak-guard",
  }),
  item({
    id: "A38",
    section: "A",
    title:
      "Bundle real bank logos from a licensed source, replacing the brand-coloured initials chips A34 left in place (2026-09-15): A34 removed the Google favicon fallback because it disclosed which banks a user holds to a third party on every page load, and fell back to BankBadge initials for the eleven affected institutions (HSBC, Monzo, Revolut, Santander, Halifax, Nationwide, Chase, first direct, TSB, plus MONO and MPESA), four of which Kevin himself holds; the A34 agent tried scraping each bank's own apple-touch-icon and got 404s, an HTML redirect page mislabelled as a PNG, and inconsistent sizes, so it deliberately shipped no scraped assets; the backend already has Logo.dev wired with a LOGODEV_TOKEN slot, so use that or each bank's official brand kit; note the licensing position it established: nominative fair use covers the trademark question under TMA 1994 s.11(2) and is standard fintech practice, but copyright is separate, simple wordmarks are likely below the originality threshold while graphic marks like the HSBC hexagon and Nationwide arrow are not, and Wikipedia fair-use tags do not transfer to commercial use; the five already-bundled logos carry no provenance documentation, so add a NOTICE file recording the source and basis for every logo shipped",
    owner: "claude",
    state: "blocked",
    reason: "superseded by G107, same work with a sharper brief",
    notes: [
      {
        date: "2026-09-16",
        actor: "claude",
        text: "Superseded by G107, which covers the same work with a sharper brief: it names the 22 unbundled providers, restates the privacy constraint from A34 and A27 that must hold (no CSP widening, no third-party favicon fetch), and adds the test that would have caught this. Working G107 instead.",
      },
    ],
  }),
  item({
    id: "F19",
    section: "F",
    title:
      "The activity log shows a decorative time filter and a non-assistant in the assistant filter (both surfaced shipping G101 variant A, 2026-09-16): the 'All time' control renders with a filter icon next to the working assistant chips but is a static label in both the approved preview and now the live page, so it reads as an interactive control that does nothing, which is worse than having no filter at all; and the per-assistant chips are driven correctly by the endpoint's clients list, which on real data returns Claude and 'session', so an internal client identifier is presented to the user as though it were a connected assistant. Either wire the time filter to the month parameter the endpoint already supports, including month=all, or remove the control; and either give non-assistant client identifiers a human label or exclude them from the filter, deciding first what a 'session' row even represents to a user reading their own audit log",
    owner: "claude",
    state: "blocked",
    reason: "superseded by F20, which covers these two faults and two more",
    notes: [
      {
        date: "2026-09-16",
        actor: "claude",
        text: "Superseded by F20, which Kevin raised from first use and which covers both faults in this item plus two more: identical rows stacking with no way to tell them apart, and the page opening scrolled to the bottom. Working F20 instead so the problem has one owner.",
      },
    ],
  }),
  item({
    id: "G41",
    section: "G",
    title:
      "Establish whether a predicted bill matching a PENDING debit should leave Safe-to-Spend's bills_total before it settles (leading hypothesis from the G35 investigation, which ruled out both code suspects with evidence): pending_transactions.py excludes a predicted bill from upcoming_bills/bills_total once it matches a freshly-observed pending debit, and task_reconcile_truelayer resyncs every four hours, so a bill going pending raises the headline figure with no settled transaction and nothing the user can see moved; confirm whether the pending debit has already reduced the account's available balance at that point (in which case the exclusion is correct and the figure is right) or has not (in which case the money is counted as free while still owed, and the bill should stay reserved until it settles); use the B18 daily snapshots once they have accumulated to name the exact field and bill that moved",
    owner: "claude",
    state: "blocked",
    reason: "awaiting Kevin's decision: (b) bill should stay reserved until it settles",
    notes: [
      {
        date: "2026-09-11",
        actor: "claude",
        text: "(b): bill should stay reserved until settled. Sorted's Safe-to-Spend pools only accounts_col.balance, never the pending-netted available figure, so excluding a matched bill once it goes pending overstates spendable cash with nothing actually moved.",
      },
      { date: "2026-09-11", actor: "claude", text: "session abandoned, branch feature-G41-pending-bill-reserve discarded" },
      {
        date: "2026-09-11",
        actor: "claude",
        text: "Coordinator review: the (b) conclusion rests on TrueLayer's documented formula plus how Sorted stores balance, but found no live example in Kevin's data yet and directly contradicts the pending_transactions.py docstring's own earlier finding. Banks differ on when the ledger moves. Do not act on documentation alone.",
      },
    ],
  }),
  item({
    id: "G88",
    section: "G",
    title:
      "Canvas Before Cards review 3 of 16, Home: produce two or three coded variants that keep Safe to Spend as the sole earned hero, make the daily brief and orientation quieter, and reserve supporting cards for bounded actions or evidence; verify fresh, normal, caution, error and hidden-balance states before production changes",
    owner: "codex",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/g88-home-canvas?mode=dark&state=calm",
    branch: "feature-G88-home-card-permutations",
  }),
  item({
    id: "G90",
    section: "G",
    title:
      "Canvas Before Cards review 5 of 16, Upcoming: produce two or three coded variants that retain the runway verdict as the primary instrument, move orientation and explanatory copy to the canvas, and reserve cards for calculations, plans and bounded bill groups; include the hidden-predictions companion before production changes",
    owner: "codex",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/upcoming-canvas-before-cards?mode=dark&state=short",
    branch: "feature-G90-upcoming-data-envelope-redesign",
  }),
  item({
    id: "G92",
    section: "G",
    title:
      "Canvas Before Cards review 7 of 16, Transactions: produce two or three coded variants that put search context, filters and summary orientation on the canvas while keeping dense transaction groups, teaching actions and expandable evidence in earned containers; verify long lists and all data states before production changes",
    owner: "codex",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/transactions-canvas-before-cards?variant=a&state=populated&mode=light",
    branch: "feature-G92-story-first-reset",
  }),
  item({
    id: "G96",
    section: "G",
    title:
      "Canvas Before Cards review 11 of 16, Receipts: produce two or three coded variants that lead with scan status and next action on the canvas, reserving cards for receipt groups, review tasks and upload actions; verify empty, loading, error and populated states before production changes",
    owner: "codex",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/g96-receipts-canvas?mode=dark&state=ready",
    branch: "feature-G96-canvas-before-cards-review",
  }),
  item({
    id: "G105",
    section: "G",
    title:
      "Accounts variant A needs the pinned-accounts treatment decided before it ships (Kevin 2026-09-16, reviewing G87): he picked variant A Quiet position as closest to the design alignment he wanted, and asked that nothing drastic be lost. Reconnect survives intact with its own Reconnect needed state, but the live page's Pinned group does not appear in variant A, which keeps only the Pin to Home action on the account detail; that matters because home_pinned_accounts is a real shared store, AccountsPage writes it through and HomePage reads it at line 198, ordering pinned accounts first in the Home estate list at line 525 and marking each row via bankToRow, so a user can pin and see no change at all on the surface that offered the action. Add two sub-variants to the existing preview so Kevin can pick on his phone: A1 restores the pinned group at the top of the list as the live page has it, A2 marks the pinned row in place with no separate group and lets the ordering effect live on Home. Do not touch the production AccountsPage in this item",
    owner: "claude",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/accounts-canvas-before-cards?mode=dark&state=estate",
    branch: "feature-G105-accounts-pinned-variants",
    notes: [
      {
        date: "2026-09-16",
        actor: "claude",
        text: "Coordinator 2026-09-18: merged and landed in uat. It was flagged to land in done, which was wrong for a round that exists so Kevin can choose a pinned-accounts treatment, so it was re-marked as a design round before merging. It extends the existing Accounts preview rather than adding a new one, so the variant list is now a, a1, a2, b and c.",
      },
    ],
  }),
  item({
    id: "G111",
    section: "G",
    title:
      "Design round for the spend-from line on Home, after Kevin saw G110 live (2026-09-16): the line reads 'In Main G: £25 spare right now. This account only, not your full Safe to Spend.' and he raised two things. First he cannot tell which bank holds that cash at a glance, because Main G is an account name and nothing on the line identifies Chase; G107 has just bundled logos for the nine major UK providers so a bank mark is now available locally with no third-party request. Second he asked whether the account with the most runway should lead, which conflicts with the shipped rule of current accounts before savings then headroom, and the conflict is real precisely when a savings pot holds the most, which is the case where the honest answer is to move it first rather than to spend from it. Produce two or three coded variants covering both questions, keeping the scope qualifier that G110 was rejected for missing, keeping credit cards structurally out of the ranking under the cash-led rule, and keeping the line quiet since the hero card is already dense; land in uat with preview links so Kevin picks on his phone. Note his word was 'card' and it is ambiguous between an account and a credit card, so the variants should make the account identity unmistakable either way",
    owner: "claude",
    state: "uat",
    link: "https://uat.wealth.auriqltd.co.uk/design/g111-spend-from-bank?mode=dark&state=leads",
    branch: "feature-G111-spend-from-design",
    notes: [
      {
        date: "2026-09-16",
        actor: "claude",
        text: "Coordinator 2026-09-16: merged as baa6196 and landed in uat correctly, preview-only, four files all under frontend/app/design/, uat-review flag present so it did not land in done. Verified by rendering, not by a 200: all four variants were screenshotted from UAT with headless Chrome and read, in both modes and across the conflict and unbundled states.",
      },
      {
        date: "2026-09-16",
        actor: "claude",
        text: "Completing the note above which hit the character cap: the second observation for Kevin's choice is that variant B puts a second bold mono figure on the card, the most scannable of the four but it competes with the hero.",
      },
    ],
  }),
  item({
    id: "G94",
    section: "G",
    title:
      "Canvas Before Cards review 9 of 16, Settings: produce two or three coded variants that remove any unearned profile hero and improve canvas orientation while retaining card boundaries for related controls, permissions and destructive actions; verify long-page navigation and all responsive themes before production changes",
    owner: "codex",
    state: "rejected",
    reason:
      "Independent re-review 2026-09-17, built from the real components with production card counts and screenshotted at phone and desktop widths. The two named fixes ARE in: a group with zero cards now r...",
    branch: "feature-G94-fold-in-approved-variant-c",
  }),
];

// ---------------------------------------------------------------------
// To do — a representative slice, real ids/titles/owners/priorities,
// shown when a variant's collapsed "To do" section is expanded.
// TODO_TOTAL_COUNT is the true count (65 items currently carry no
// explicit [state: ...] tag, i.e. plain to-do); this sample is 8 of them.
// ---------------------------------------------------------------------

export const TODO_TOTAL_COUNT = 65;

export const TODO_SAMPLE: GoLiveItem[] = [
  item({
    id: "A5",
    section: "A",
    title: "FRN wording on the legal pages.",
    text: "Until the FCA register shows AURIQ LTD, frontend/content/terms.md section 2 and privacy.md section 1 say \"registered agent\" in the present tense. Kevin confirms with Finexer which wording to publish.",
    owner: "kevin",
    priority: "p1",
    state: "todo",
    unblocks: ["Q6", "Q7"],
  }),
  item({
    id: "A44",
    section: "A",
    title:
      "Pentest rules of engagement, the parts only Kevin can do, which gate the execution items: create the dedicated test account described under Test account in docs/security/pentest-scope-2026-09.md, connect at least one bank to that account so the account and transaction dependent surfaces have data to exercise, pick a UAT testing window and tell the other UAT testers it is coming, and decide whether production gets passive read-only checks only or whether active testing against it is signed off",
    owner: "kevin",
    priority: "p1",
    state: "todo",
    unblocks: ["Q11"],
  }),
  item({
    id: "G103",
    section: "G",
    title:
      "Debt trajectory card leads with the full carried balance, which is demoralising and is the wrong measure (Kevin 2026-09-16): lead on the movement instead, the rate at which the balance is rising or falling, and keep the total as quiet supporting context rather than the headline",
    owner: "claude",
    priority: "p2",
    state: "todo",
  }),
  item({
    id: "G104",
    section: "G",
    title:
      "Remove the redundant Priority, Debt and Goals jump strip from Planning (Kevin 2026-09-16, reverting part of G89): the nav duplicates sections that sit immediately below on the same folded page",
    owner: "claude",
    priority: "p2",
    state: "todo",
  }),
  item({
    id: "G106",
    section: "G",
    title:
      "Pinning an investment account does nothing on Home (surfaced by the G105 pinned-variant fixture, 2026-09-16): HomePage.tsx always shows the first investment regardless of pin state, while bank accounts honour the pin",
    owner: "claude",
    state: "todo",
  }),
  item({
    id: "G112",
    section: "G",
    title:
      "MoneyText swallows a comma that follows a figure, so any sentence writing a money amount followed by a comma renders the comma inside the mono token (found while building G111, 2026-09-16): tighten the regex so a separator is only consumed when followed by digits",
    owner: "claude",
    state: "todo",
  }),
  item({
    id: "H1",
    section: "H",
    title: "Firebase config history.",
    text: "capacitor-spike/google-services.json was tracked until 2026-09-05 and an old copy with the Android API key remains in git history. Decision: restrict the key to the Android package in Google Cloud console rather than rewrite history.",
    owner: "kevin",
    state: "todo",
  }),
  item({
    id: "H3",
    section: "H",
    title: "docs/compliance and docs/pricing are committed; keep [KEVIN] markers until answered, then remove them before the questionnaire is submitted.",
    owner: "claude",
    state: "todo",
  }),
];

// ---------------------------------------------------------------------
// Done — a representative slice. DONE_TOTAL_COUNT is the true count
// (219 checked items in this TODO.md snapshot).
// ---------------------------------------------------------------------

export const DONE_TOTAL_COUNT = 219;

export const DONE_SAMPLE: GoLiveItem[] = [
  item({
    id: "G107",
    section: "G",
    title:
      "Most bank icons now render as initials because only five brand logos are bundled (Kevin 2026-09-16): bundle the remaining logos as local optimised assets so the privacy property from A34 is kept and the icons come back",
    owner: "claude",
    priority: "p2",
    state: "done",
    done_at: "2026-09-16",
    commit: "1586e1e2bd208ec0e0d14c5d9ad28a7fe5788d42",
  }),
  item({
    id: "G108",
    section: "G",
    title:
      "Tapping a nav icon jumps to the bottom of the page because push-versus-back detection uses window.history.length (Kevin 2026-09-16): replace the length heuristic with a monotonic index stamped into history.state",
    owner: "claude",
    priority: "p1",
    state: "done",
    done_at: "2026-09-16",
    commit: "57715ec18229f643c84cf5ee8301010d7b4ead11",
  }),
  item({
    id: "G109",
    section: "G",
    title:
      "A bill charged to a credit card is counted against cash twice, once when it hits the card and again when the card is repaid (Kevin 2026-09-16): apply the cash-led rule to the bills walk so a charge on a card does not reduce cash, a payment to a card does",
    owner: "claude",
    priority: "p1",
    state: "done",
    done_at: "2026-09-16",
    commit: "10032f447be1e3290e4ad35049ca2399005f66ef",
  }),
  item({
    id: "G110",
    section: "G",
    title:
      "Safe to Spend says how much is safe but not where to spend it from (Kevin's idea 2026-09-16): add one quiet line under the hero naming the best account to spend from and how much is spare there",
    owner: "claude",
    priority: "p2",
    state: "done",
    done_at: "2026-09-16",
    commit: "bbcf7cfa56fbdd13f676cd1c7280dc9206ccc039",
  }),
  item({
    id: "F20",
    section: "F",
    title:
      "Connected assistants activity log has four faults Kevin found on first use (2026-09-16): the All time chip does nothing, the user's own session is listed as a connected assistant, identical rows stack with no way to tell them apart, and the page opens scrolled to the bottom",
    owner: "claude",
    priority: "p2",
    state: "done",
    done_at: "2026-09-16",
    commit: "6f86289c901b01dea42bdfd4e214680438ad5a7b",
  }),
  item({
    id: "H2",
    section: "H",
    title: "Retired Expo project mobile/.",
    text: "sync-shared.sh still writes into mobile/lib/shared/; either delete the directory or stop syncing to it.",
    owner: "claude",
    state: "done",
    done_at: "2026-09-07",
    commit: "3637b867982d153d57fbb3f5ef0f35376b453b71",
  }),
];

export const ALL_FIXTURE_ITEMS: GoLiveItem[] = [...IN_FLIGHT, ...TODO_SAMPLE, ...DONE_SAMPLE];

// Real count of in-flight items in TODO.md on this snapshot: 2 in-progress
// + 3 blocked + 0 review + 1 rejected + 11 uat = 17. IN_FLIGHT above trims
// the uat slice to 7 so this preview's "Live now" reads like Kevin's
// actual dozen rather than reproducing the entire eleven-item Canvas
// Before Cards sweep, but TOTAL_ITEM_COUNT below uses the real total so
// the collapsed counts stay honest about the board's real scale.
export const IN_FLIGHT_TOTAL_COUNT = 17;

export const TOTAL_ITEM_COUNT = TODO_TOTAL_COUNT + DONE_TOTAL_COUNT + IN_FLIGHT_TOTAL_COUNT;
