import type { CompanionItem } from "@/lib/api";

/**
 * Actionable vs informational classification for every CompanionItem the
 * companion spine (backend/app/services/companion.py) emits. Shared by
 * every surface that renders the /today feed (Home, the Penny hub, and any
 * future one) so none of them can drift from another's definition — owner
 * rule, 2026-09-01 (verbatim): "the dismissed items staying on the penny
 * hub, they should only be there if there is an action to do, saying an
 * account is covered or saying a certain amount stays in my pocket isn't
 * really actionable but the movement above is actionable."
 *
 * Classified by RENDERED AFFORDANCE — whether the card carries a decision/
 * CTA beyond dismissal — not by type name alone: two types (`ask`,
 * `rhythm`) render structurally different card families depending on
 * payload, so the type string by itself can't answer this for them.
 *
 *   move            ACTIONABLE    a concrete money-move recommendation
 *                                  (MoveCard's source ledger + "Moving £X"
 *                                  total + route button).
 *   payday_plan     ACTIONABLE    the payday split — live card or preview,
 *                                  always a plan the user can act on
 *                                  (PaydayPlanCard).
 *   unfunded_move   ACTIONABLE    a due-but-unfunded own transfer; each row
 *                                  carries a real "Skip this month" decision
 *                                  (UnfundedMoveCard).
 *   ask             ACTIONABLE    every `ask:*` id is a live question
 *                                  awaiting an answer — the payday
 *                                  confirm/decline pair (AskPaydayCard) or a
 *                                  generic route-push ask like
 *                                  `ask:card_terms` (AskGenericCard).
 *   rhythm          ACTIONABLE    ONLY the interactive checkpoint variant —
 *     (payload.multiple               real anomaly payload, multiple >= 1.5
 *      >= 1.5)                        — which carries the "A one-off" / "My
 *                                  new normal" intent decision (RhythmCard).
 *                                  Mirrors HomeBrief's own
 *                                  rhythmItems/rhythmInfoItems split so the
 *                                  two definitions can never disagree.
 *   celebration     INFORMATIONAL a resolution statement ("Sorted: X is
 *                                  covered", "£49/mo is staying in your
 *                                  pocket") — dismiss only, nothing to
 *                                  decide (CelebrationCard).
 *   cliff           INFORMATIONAL a standing fact about a promo rate ending;
 *                                  its "See the card ›" is a look-at-this
 *                                  link, not a decision (CliffCard).
 *   trajectory      INFORMATIONAL same shape as cliff, for debt payoff pace
 *                                  (CliffCard).
 *   needle          INFORMATIONAL an invitation to review a closed pay
 *                                  period; navigational, nothing to decide.
 *   intent_pace     INFORMATIONAL a quiet pace note against a self-chosen
 *                                  aim — body literally says "no action
 *                                  needed" (IntentPaceCard).
 *   rhythm          INFORMATIONAL the payload-less variant (no
 *     (no qualifying                  category/multiple/spent to anchor to)
 *      payload)                       — renders as a plain fact card with no
 *                                  intent buttons (CliffCard, reused).
 *   info            INFORMATIONAL declared in the type union but not
 *                                  currently emitted by companion.py; falls
 *                                  through to informational like every other
 *                                  narration type if it ever is.
 */
export function isActionableCompanionItem(item: CompanionItem): boolean {
  switch (item.type) {
    case "move":
    case "payday_plan":
    case "unfunded_move":
    case "ask":
      return true;
    case "rhythm":
      return item.payload?.multiple != null && item.payload.multiple >= 1.5;
    case "celebration":
    case "cliff":
    case "trajectory":
    case "needle":
    case "intent_pace":
    case "info":
    default:
      return false;
  }
}
