// Attention resolver — decides which single card on the Home screen, if any,
// GLOWS to signal "this needs you". At most one card glows per screen; the
// priority order below started life as the product decision
// (owner-approved 2026-08-14): reconnect > sync error > actionable payday
// plan. The reconnect rung was later removed outright (see 2026-08-28
// entry below), and the payday rung was removed the same way the next day
// (see 2026-08-29 entry below), so the order now reads: sync error only.
// A "NEW feature" promo never glows — it simply has no entry in this resolver.
//
// Structural rule (2026-08-18): a candidate never gets the glow if its own
// visual language already carries urgency. The upcoming-bills strip turns
// its "due today/tomorrow" text amber for exactly the same condition that
// used to earn it the indigo glow, so the two attention systems collided on
// one element (halo around amber words). There's no non-urgent path for that
// signal, so "bill" was removed outright rather than gated per-instance —
// the amber text is that element's one attention voice.
//
// No fallback rung (2026-08-18): Safe-to-Spend used to glow whenever its own
// verdict was tight/short ("hero"), as the resolver's catch-all when nothing
// else qualified. That made it glow on most visits — a permanent halo reads
// as decoration, not attention, and it collided with the card's own amber
// tight/short colouring (the same amber-vs-glow clash the bills strip was
// fixed for above). There is no substitute rung: when reconnect, sync, and
// payday are all clear, NOTHING glows. A quiet Home is itself the signal
// that nothing needs the user right now.
//
// Reconnect rung removed (2026-08-28): the reconnect banner was rebuilt
// onto the glass-card lit-panel family and now carries an amber icon chip
// as its own attention voice, the exact same amber-vs-glow collision the
// bills strip was fixed for on 2026-08-18. Per that precedent, the rung is
// removed outright rather than special-cased at the render site, matching
// how "bill" was handled. There is no replacement rung; "reconnect" is no
// longer a valid AttentionTarget. Consequence: when a provider is expired,
// the glow now falls through to sync error, then to the payday plan, same
// as any other visit where reconnect isn't in play — the banner itself
// (amber chip, indigo button) still tells the user it needs them, it just
// no longer also halos.
//
// Payday rung removed (2026-08-29): owner, verbatim, from phone review —
// "the payday plan design is off, we shouldn't have any glow or ring glow
// so look into this and fix." The payday plan card is a large, full-bleed
// Penny-branded card (gradient chip, hero £ figure, its own dest tiles) —
// it is already its own attention on the screen; a halo on top of that is
// pure decoration, the same "collision" reasoning the bills strip and
// Safe-to-Spend rungs were removed for above. Per the reconnect-rung
// precedent (2026-08-28), the rung is removed outright rather than gated
// per-instance, and there is no replacement rung. Consequence: the resolver
// now has exactly one live rung. When there's no sync error, NOTHING on
// Home glows, ever, including on the day the plan goes live — a quiet
// Home with a normal (unglowed) payday plan card is the intended, final
// state, not a fallback.
export type AttentionTarget = "sync" | null;

export interface AttentionInputs {
  syncError: boolean;
}

export function resolveAttention(i: AttentionInputs): AttentionTarget {
  if (i.syncError) return "sync";
  return null;
}
