// Attention resolver — decides which single card on the Home screen, if any,
// GLOWS to signal "this needs you". At most one card glows per screen; the
// priority order below is the product decision (owner-approved 2026-08-14):
// reconnect > sync error > actionable payday plan > verdict hero tight/short.
// A "NEW feature" promo never glows — it simply has no entry in this resolver.
//
// Structural rule (2026-08-18): a candidate never gets the glow if its own
// visual language already carries urgency. The upcoming-bills strip turns
// its "due today/tomorrow" text amber for exactly the same condition that
// used to earn it the indigo glow, so the two attention systems collided on
// one element (halo around amber words). There's no non-urgent path for that
// signal, so "bill" was removed outright rather than gated per-instance —
// the amber text is that element's one attention voice.
export type AttentionTarget = "reconnect" | "sync" | "payday" | "hero" | null;

export interface AttentionInputs {
  hasExpiredProvider: boolean;
  syncError: boolean;
  hasLivePlan: boolean;
  heroNeedsAttention: boolean;
}

export function resolveAttention(i: AttentionInputs): AttentionTarget {
  if (i.hasExpiredProvider) return "reconnect";
  if (i.syncError) return "sync";
  if (i.hasLivePlan) return "payday";
  if (i.heroNeedsAttention) return "hero";
  return null;
}
