// Attention resolver — decides which single card on the Home screen, if any,
// GLOWS to signal "this needs you". At most one card glows per screen; the
// priority order below is the product decision (owner-approved 2026-08-14):
// reconnect > sync error > bill due today/tomorrow > actionable payday plan
// > verdict hero tight/short. A "NEW feature" promo never glows — it simply
// has no entry in this resolver.
export type AttentionTarget = "reconnect" | "sync" | "bill" | "payday" | "hero" | null;

export interface AttentionInputs {
  hasExpiredProvider: boolean;
  syncError: boolean;
  hasUrgentBill: boolean;
  hasLivePlan: boolean;
  heroNeedsAttention: boolean;
}

export function resolveAttention(i: AttentionInputs): AttentionTarget {
  if (i.hasExpiredProvider) return "reconnect";
  if (i.syncError) return "sync";
  if (i.hasUrgentBill) return "bill";
  if (i.hasLivePlan) return "payday";
  if (i.heroNeedsAttention) return "hero";
  return null;
}
