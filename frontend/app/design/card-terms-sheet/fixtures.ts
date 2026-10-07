import type { CardTerms, CardTermsCard, CardTermsLookup } from "@/lib/api";

// Fixture cards for the G225 preview and check:g225-card-terms. Invented data.
// Promo end dates are fixed far ahead so the preview never shows a lapsed deal.

export type CardCase = "balance" | "lookup" | "zero" | "promos";

export const CASES: { id: CardCase; label: string; note: string }[] = [
  { id: "balance", label: "Balance", note: "A card with a balance and a confirmed 24.9% rate: the typed value renders in ink." },
  { id: "lookup", label: "Rate found", note: "A card with a balance and a representative rate found by the lookup, before the user answers." },
  { id: "zero", label: "£0", note: "A card with nothing on it and no rate found: the 0% question is about the card, not the balance." },
  { id: "promos", label: "Deals", note: "A card with existing 0% deals and an unused offer, to check the per-deal rows." },
];

const base = { provider: "Barclaycard", currency: "GBP", source: "fixture", ask_eligible: true } as const;

const NO_TERMS: CardTerms = { apr_pct: null, promos: [], min_payment_note: null, bt_offers: [], status: null, confirmed_at: null, product_key: null, usage: null };

export const CARDS: Record<CardCase, CardTermsCard> = {
  balance: {
    ...base, account_id: "fx-balance", name: "Barclaycard Platinum", balance: 1240,
    terms: { ...NO_TERMS, apr_pct: 24.9, status: "confirmed", confirmed_at: "2026-10-01T09:00:00Z" },
  },
  lookup: { ...base, account_id: "fx-lookup", name: "Barclaycard Platinum", balance: 1240, terms: null },
  zero: { ...base, account_id: "fx-zero", name: "Everyday Rewards Card", balance: 0, terms: null },
  promos: {
    ...base, account_id: "fx-promos", name: "Platinum Balance Transfer", balance: 3180,
    terms: {
      ...NO_TERMS, apr_pct: 22.9, status: "confirmed", confirmed_at: "2026-10-01T09:00:00Z", usage: "carry",
      promos: [
        { kind: "balance_transfer", apr_pct: 0, until: "2027-08-31" },
        { kind: "purchases", apr_pct: 0, until: "2027-03-31" },
      ],
      bt_offers: [{ ends: "2027-05-31", fee_pct: 3, note: "0% for 12 months" }],
    },
  },
};

/** What POST /card-terms/<id>/lookup answers in the preview. */
export function lookupFor(accountId: string): CardTermsLookup {
  const found = accountId === CARDS.lookup.account_id;
  return {
    status: "ok", product_key: found ? "barclaycard-platinum" : null, display_name: found ? "Barclaycard Platinum" : null,
    representative_apr: found ? 24.9 : null, stale: false, candidates: [], lookup_status: found ? "found" : "not_found",
    source_url: null, ambiguous: false, rate_basis: "representative", rate_note: "A representative rate is not your own rate.",
  };
}
