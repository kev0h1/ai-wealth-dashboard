// Fixtures for the FULL-PAGE Insights redesign wireframe (/design/insights-full),
// built on Variant A ("One bar", Kevin's pick 2026-09-02 from /design/insights-shape).
// Fictional numbers, NOT real user data. Reuses the money-shape fixtures from
// ../insights-shape/fixtures and the real SavingsInsight fixtures from
// ../insights-live/fixtures rather than redefining either — this file only
// adds the copy and grouping that are new to the full-page assembly.

import { TAKE_HOME } from "../insights-shape/fixtures";
import type { FixtureKey } from "../insights-live/fixtures";

export const TAP_HINT = "Tap a job to see it where it lives.";

export const JOB_HREF: Record<"fixed" | "moved" | "free" | "left", string> = {
  fixed: "/planning#commitments",
  moved: "/penny#payday-plan",
  free: "/spend?kind=discretionary",
  left: "/",
};

// ── "What works for you" extensions ─────────────────────────────────────

export const MIRROR_CITATION = "From your Mirror: you save in bursts.";

export const CONSENT_CHANGE_TITLE = "Move your payday transfer to the first week?";
export const CONSENT_CHANGE_BODY =
  "Your last two early periods ended with cash left over. Penny can set this up in Planning, you approve before anything moves.";
export const CONSENT_CHANGE_BUTTON = "Propose in Planning";
export const CONSENT_CHANGE_WHISPER = "Proposals never move money without you.";

export const CONSENT_KEEP_TITLE = "You chose to keep this.";
export const CONSENT_KEEP_BODY = "Saving in bursts is working for you. Nothing to change here.";
export const CONSENT_KEEP_CHIP = "Kept";

// ── "Where the shape can move" ──────────────────────────────────────────

export const SHAPE_MOVES_LABEL = "WHERE THE SHAPE CAN MOVE · YOUR OPEN IDEAS";
export const SHAPE_MOVES_FOOTER =
  "When an idea verifies, the next pay period's shape moves on its own. Nothing to log.";

// Group membership, by insights-live FixtureKey (real SavingsInsight shapes,
// imported not copied — see ../insights-live/fixtures.ts).
export const FIXED_GROUP_KEYS: FixtureKey[] = ["fresh_weekly", "fresh_claim", "quiet_never_researched"];
export const FREE_GROUP_KEYS: FixtureKey[] = ["quiet_expired", "substituted"];

/** "≈N points of fixed share back" / "less than 1 point of free spending,
 *  but every pound moves it" — the shape-anchor strip under a full card
 *  that has a costed estimate. N is the estimate's share of take-home,
 *  rounded to the nearest whole point (matches the hero's own job-share
 *  maths, see insights-shape/fixtures.ts's JOBS pct values). */
export function moveStripText(estimateMonthly: number, kind: "fixed share" | "free spending"): string {
  const n = Math.round((estimateMonthly / TAKE_HOME) * 100);
  if (n < 1) {
    return `less than 1 point of ${kind}, but every pound moves it`;
  }
  return `≈${n} point${n === 1 ? "" : "s"} of ${kind} back`;
}

// ── Appendix: "Where this shows up elsewhere" ───────────────────────────

export const ELSEWHERE_LABEL = "ELSEWHERE · WIREFRAME NOTES";

export const SPEND_MOCK_LINE = "Free spending · £816 so far · 24% of take-home";
export const SPEND_MOCK_ANNOTATION = "Sits under Spend's instrument header. Same figure as the hero, one source.";

export const HOME_MOCK_WHISPER = "YOUR SHAPE MOVED";
export const HOME_MOCK_HEADLINE = "Fixed share crept up 4 points over six pay periods.";
export const HOME_MOCK_LINK = "See your shape";
export const HOME_MOCK_ANNOTATION = "Home only, only when the fixed share moves 3+ points. Never the bar.";

export const PLANNING_MOCK_WHISPER = "PROPOSED BY PENNY";
export const PLANNING_MOCK_HEADLINE = "Move the payday transfer to the first week";
export const PLANNING_MOCK_BODY =
  "From your Insights: early transfers ended 4 of 5 periods with cash left over.";
export const PLANNING_MOCK_PRIMARY = "Set it up";
export const PLANNING_MOCK_SECONDARY = "Not now";
export const PLANNING_MOCK_ANNOTATION = "Consent-gated, propose-only. Verified from the feed once the transfer lands.";

// Thin-history state: the Home change-moment and Planning proposal mocks
// both cite a six-period fact this user doesn't have yet, so both retire
// behind one whisper note instead of showing mocks the user's own data
// can't back up (impeccable critique, thin-history contradiction). The
// Spend header line mock stays, it doesn't depend on any period history.
export const THIN_ELSEWHERE_NOTE =
  "Home change moment and Planning proposal are gated on the same four-period minimum.";
