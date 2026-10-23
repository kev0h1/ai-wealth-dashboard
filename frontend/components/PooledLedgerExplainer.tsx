import Link from "next/link";
import MoneyText from "@/components/MoneyText";

// G304: the plain-words footer of a "Full calculation" ledger. It says the
// figure is shared across every account and names the reservations that hold
// cash back, each with an inline link to the surface where it is edited.
// Wording is recommendation-only: it never says money is saved or freed, and
// nothing here moves money. Shared by Home's Safe to Spend card and
// Upcoming's runway card so the two ledgers cannot drift apart.

export const ENVELOPE_EDIT_HREF = "/upcoming#pay-period-plans";
export const PLAN_EDIT_HREF = "/planning#commitments";

export const POOLED_SENTENCE = "This figure is shared by all your accounts. It is not a separate amount for each one.";
export const POOLED_PROJECTION_SENTENCE = "This is the total across all your accounts together, not a figure for each one.";

export type LedgerReservation = { amount: number; count?: number };

const linkClass =
  "font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:decoration-indigo-400/40 dark:hover:text-indigo-300";

export default function PooledLedgerExplainer({
  pooled,
  poolingSentence = POOLED_SENTENCE,
  envelope,
  plan,
  format,
}: {
  /** Show the pooling sentence. */
  pooled: boolean;
  poolingSentence?: string;
  envelope?: LedgerReservation | null;
  plan?: LedgerReservation | null;
  /** Money formatter, so hidden balances stay hidden and each ledger keeps its own precision. */
  format: (value: number) => string;
}) {
  const showEnvelope = !!envelope && envelope.amount > 0;
  const showPlan = !!plan && plan.amount > 0;
  if (!pooled && !showEnvelope && !showPlan) return null;
  const many = (r?: LedgerReservation | null) => (r?.count ?? 1) > 1;
  return (
    <div data-g304-ledger-explainer className="mt-3 space-y-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
      {pooled && <p data-g304-pooled>{poolingSentence}</p>}
      {showEnvelope && (
        <p data-g304-envelope>
          <MoneyText text={`${many(envelope) ? "Your envelopes hold" : "Your envelope holds"} back ${format(envelope!.amount)} until payday.`} />{" "}
          <Link href={ENVELOPE_EDIT_HREF} className={linkClass}>{many(envelope) ? "You can edit them" : "You can edit it"}</Link>
          {` on Upcoming.`}
        </p>
      )}
      {showPlan && (
        <p data-g304-plan>
          <MoneyText text={`${many(plan) ? "Your plans hold" : "Your plan holds"} back ${format(plan!.amount)}.`} />{" "}
          <Link href={PLAN_EDIT_HREF} className={linkClass}>{many(plan) ? "You can edit them" : "You can edit it"}</Link>
          {` on Planning.`}
        </p>
      )}
    </div>
  );
}
