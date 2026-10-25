// B59: a stored proposal turn restores as its card, with its live status, and
// a bare consequence line is never shown as a whole answer.
import type { PennyConversationTurn, PennyProposal } from "@/lib/api";
import type { ProposalMsg } from "@/components/PennyConversation";

/** Shown instead of a legacy stored turn whose whole text is a consequence
 * sentence with no card behind it (stored before the card was kept). */
export const LEGACY_PROPOSAL_NOTE = "I suggested a change here. Ask me again if you would still like it.";
export const EXPIRED_PROPOSAL_NOTE = "Expired, ask again";

// The opening words of every deterministic consequence sentence the proposal
// builders write (penny_tools.py). A reply that is only one of these has lost
// its summary.
const BARE_CONSEQUENCE = [
  /^Changes only this transaction\.?$/,
  /^Sets a rule for this merchant\b/,
  /^Frees up its unfilled remainder\b/,
  /^Reserves its unfilled remainder\b/,
  /^Changes how much this allocation reserves\b/,
  /^This changes how much it needs each pay period\b/,
  /^This occurrence stops counting\b/,
];

export function isBareConsequence(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && BARE_CONSEQUENCE.some((re) => re.test(t));
}

/** The text of an answer bubble: never a bare consequence. Falls back to the
 * headline when there is one, else to the legacy note. */
export function answerText(reply: string | null | undefined, headline?: string | null): string {
  if (!isBareConsequence(reply)) return reply ?? "";
  return headline && !isBareConsequence(headline) ? headline : LEGACY_PROPOSAL_NOTE;
}

/** The card for a stored assistant turn that carries a proposal block, or
 * null. Pending stays live (Confirm and Cancel); the rest show a status line. */
export function proposalMsgFromTurn(t: PennyConversationTurn, id: number): ProposalMsg | null {
  const p = t.role === "assistant" ? t.proposal : null;
  if (!p) return null;
  const proposal: PennyProposal = {
    proposal_id: p.proposal_id, kind: p.kind, summary: p.summary, consequence: p.consequence,
    params: {}, before: p.before, after: p.after, entity: p.entity, destructive: p.destructive,
  };
  const base = { id, role: "assistant" as const, kind: "proposal" as const, proposal, restored: true };
  if (p.status === "executed") return { ...base, status: "done" };
  if (p.status === "cancelled") return { ...base, status: "cancelled" };
  if (p.status === "expired") return { ...base, status: "error", errorDetail: EXPIRED_PROPOSAL_NOTE };
  return { ...base, status: "pending" };
}
