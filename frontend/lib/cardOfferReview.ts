import type {
  CardPromo,
  CardOfferType,
  CardOffersConfirmBody,
  ExistingCardOffer,
  ExtractedCardOffer,
} from "./api";

/** Preserve extended facts when the older card-terms walk edits its three fields. */
export function preserveCardPromo(original: CardPromo | undefined, changes: Pick<CardPromo, "kind" | "apr_pct" | "until">): CardPromo {
  const result = { ...original, ...changes };
  if (result.offer_type) {
    const kind = result.offer_type === "purchase" ? "purchases" : "balance_transfer";
    if (kind !== result.kind) delete result.offer_type;
  }
  return result;
}

export type CardOfferDraft = {
  key: string;
  include: boolean;
  offerType: CardOfferType;
  rate: string;
  balance: string;
  ends: string;
  revertRate: string;
  updateId: string | null;
  original: ExtractedCardOffer;
};

export function makeOfferDrafts(rows: ExtractedCardOffer[], matchIds?: (string | null)[]): CardOfferDraft[] {
  return rows.map((original, index) => ({
    key: `offer-${index}`,
    include: true,
    offerType: original.offer_type,
    rate: String(original.apr_pct),
    balance: original.balance == null ? "" : String(original.balance),
    ends: original.ends ?? "",
    revertRate: original.revert_apr_pct == null ? "" : String(original.revert_apr_pct),
    updateId: matchIds ? matchIds[index] ?? null : original.match ?? null,
    original,
  }));
}

type ReviewInput = {
  drafts: CardOfferDraft[];
  existing: ExistingCardOffer[];
  removeIds: string[];
  statementDate: string;
  purchaseApr: string;
  cashApr: string;
  cardId: string;
  ackRequired: boolean;
  acknowledged: boolean;
  unknownAcknowledged: boolean;
  today: string;
};

export type CardOfferReviewValidation = {
  body: CardOffersConfirmBody | null;
  errors: Record<string, string>;
};

function isoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

function decimal(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function optionalRate(value: string, field: string, errors: Record<string, string>): number | undefined {
  if (!value.trim()) return undefined;
  const rate = decimal(value, 0, 100);
  if (rate == null) errors[field] = "Enter a rate from 0 to 100%, with up to 2 decimal places.";
  return rate ?? undefined;
}

export function validateCardOfferReview(input: ReviewInput): CardOfferReviewValidation {
  const errors: Record<string, string> = {};
  const today = isoDate(input.today);
  if (!input.cardId) errors.card = "Choose the card these offers belong to.";
  if (input.ackRequired && !input.acknowledged) errors.cardAck = "Confirm that this is the right card before saving.";
  if (!today) errors.statementDate = "The review date is not valid. Refresh and try again.";

  const statementDate = input.statementDate.trim();
  let normalisedStatementDate: string | undefined;
  if (statementDate) {
    normalisedStatementDate = isoDate(statementDate) ?? undefined;
    if (!normalisedStatementDate || (today && normalisedStatementDate > today)) {
      errors.statementDate = "Enter a statement date on or before today.";
    }
  }
  const purchaseApr = optionalRate(input.purchaseApr, "purchaseApr", errors);
  const cashApr = optionalRate(input.cashApr, "cashApr", errors);

  const existingIds = new Set(input.existing.map((offer) => offer.id).filter((id): id is string => Boolean(id)));
  const removeIds = [...new Set(input.removeIds)];
  for (const id of removeIds) {
    if (!existingIds.has(id)) errors.offers = "One of the offers you selected is no longer on this card. Refresh and review again.";
  }
  if (removeIds.length !== input.removeIds.length) errors.offers = "An offer can only be removed once.";

  const updateUse = new Map<string, CardOfferDraft>();
  const offers: NonNullable<CardOffersConfirmBody["offers"]> = [];
  let hasUnknown = false;
  for (const draft of input.drafts) {
    if (!draft.include) continue;
    const prefix = `${draft.key}-`;
    const rate = decimal(draft.rate, 0, 100);
    if (rate == null) errors[`${prefix}rate`] = "Enter a rate from 0 to 100%, with up to 2 decimal places.";
    const end = isoDate(draft.ends.trim());
    if (!end || (today && end < today)) errors[`${prefix}ends`] = "Enter an end date on or after today.";

    const balanceText = draft.balance.trim();
    const balance = balanceText ? decimal(balanceText, 0, 10_000_000) : null;
    if (balanceText && balance == null) errors[`${prefix}balance`] = "Enter a balance from £0 to £10,000,000, with up to 2 decimal places.";
    const revertText = draft.revertRate.trim();
    const revertRate = revertText ? decimal(revertText, 0, 100) : null;
    if (revertText && revertRate == null) errors[`${prefix}revertRate`] = "Enter a rate from 0 to 100%, with up to 2 decimal places.";
    if (!balanceText || !revertText) hasUnknown = true;

    if (draft.updateId) {
      if (!existingIds.has(draft.updateId)) errors[`${prefix}updateId`] = "This offer is no longer on this card. Refresh and review again.";
      if (removeIds.includes(draft.updateId)) errors[`${prefix}updateId`] = "An offer cannot be updated and removed together.";
      const first = updateUse.get(draft.updateId);
      if (first) {
        errors[`${prefix}updateId`] = "Choose each existing offer only once.";
        errors[`${first.key}-updateId`] = "Choose each existing offer only once.";
      } else updateUse.set(draft.updateId, draft);
    }

    if (rate != null && end && (!balanceText || balance != null) && (!revertText || revertRate != null)) {
      offers.push({
        ...(draft.updateId ? { id: draft.updateId } : {}),
        offer_type: draft.offerType,
        apr_pct: rate,
        balance,
        ends: end,
        revert_apr_pct: revertRate,
      });
    }
  }

  if (hasUnknown && !input.unknownAcknowledged) errors.unknown = "Confirm that the blank balance or revert rate is not shown in the source.";
  const additions = input.drafts.filter((draft) => draft.include && !draft.updateId).length;
  if (input.existing.length - removeIds.length + additions > 4) {
    errors.offers = "A card can hold 4 offers. Remove one or update an existing offer instead.";
  }
  if (!input.drafts.some((draft) => draft.include) && !removeIds.length && purchaseApr === undefined && cashApr === undefined && !normalisedStatementDate) {
    errors.offers = "Choose an offer or change a rate before saving.";
  }
  if (Object.keys(errors).length) return { body: null, errors };

  const body: CardOffersConfirmBody = {
    ...(normalisedStatementDate ? { statement_date: normalisedStatementDate } : {}),
    ...(purchaseApr !== undefined ? { purchase_apr_pct: purchaseApr } : {}),
    ...(cashApr !== undefined ? { cash_apr_pct: cashApr } : {}),
    ...(offers.length ? { offers } : {}),
    ...(removeIds.length ? { remove_ids: removeIds } : {}),
  };
  return { body, errors };
}
