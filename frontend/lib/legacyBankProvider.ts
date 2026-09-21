// A67: the legacy, UAT-only bank-connect provider (TrueLayer).
//
// Finexer is the default and the only provider production uses. TrueLayer
// stays reachable on UAT so it can still be exercised against real
// connections, but it must be ABSENT from a production build, not merely
// hidden behind a false boolean — Kevin's constraint was "behind a flag is
// not enough if the flag could be switched on in production, so enforce
// absence rather than rely on configuration".
//
// Everything below is derived from two values that `next.config.ts` inlines
// at build time (see its LEGACY_BANK_PROVIDER_ON comment for the measured
// evidence that a component-level boolean did NOT achieve absence). In a
// production build both inline to "", so this module's own constants are
// empty strings, the endpoint paths are never formed, and the name
// "TrueLayer" appears nowhere in the bundle. This file is the ONLY place in
// the web client that knows the provider's identifier or display name; every
// other module imports from here and speaks of "legacy", so no caller has to
// hardcode the name back in.
//
// Deliberately importing nothing: `lib/api.ts` imports LEGACY_BANK_ID from
// here to build its two request paths, so an import in the other direction
// would be a cycle.

/** The provider's API identifier ("truelayer" on UAT, "" in production). */
export const LEGACY_BANK_ID = process.env.NEXT_PUBLIC_LEGACY_BANK_ID || "";

/** The provider's display name ("TrueLayer" on UAT, "" in production). */
export const LEGACY_BANK_NAME = process.env.NEXT_PUBLIC_LEGACY_BANK_NAME || "";

/** Whether this build has a legacy provider at all. Every call site must
 *  gate on this; `lib/api.ts`'s two legacy request helpers also refuse on
 *  their own, so a missed guard fails closed rather than requesting
 *  `/auth//link`. */
export const LEGACY_BANK_AVAILABLE = LEGACY_BANK_ID !== "" && LEGACY_BANK_NAME !== "";

/** The Accounts "Add" menu entry, e.g. "Add Bank via TrueLayer". */
export const LEGACY_BANK_MENU_LABEL = LEGACY_BANK_AVAILABLE ? `Add Bank via ${LEGACY_BANK_NAME}` : "";

/** The bank-picker sheet subtitle, e.g. "Secure open banking · Powered by
 *  TrueLayer". Mirrors the Finexer wording in BankPickerSheet.tsx. */
export const LEGACY_BANK_SUBTITLE = LEGACY_BANK_AVAILABLE
  ? `Secure open banking · Powered by ${LEGACY_BANK_NAME}`
  : "";

/** True when `source` (an Account's own `source` field, as the API reports
 *  it) names the legacy provider. Always false in a production build, where
 *  LEGACY_BANK_ID is "" and no account's source can be the empty string —
 *  so a production reconnect always routes to Finexer. */
export function isLegacyBankSource(source: string | undefined | null): boolean {
  return LEGACY_BANK_AVAILABLE && source === LEGACY_BANK_ID;
}
