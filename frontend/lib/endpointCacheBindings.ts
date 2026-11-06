// G425: wires the client endpoint caches to the app's existing change events.
// Imported once from AuthProvider so the listeners exist for the whole session.
//   - TRANSACTIONS_CHANGED_EVENT (transaction or category edit, transfer review
//     done): drops every money endpoint and the miscategorised count; identity
//     payloads (profile, subscription) stay.
//   - Preferences saves that feed money (PreferencesContext) call
//     invalidateEndpoint directly; sync, account mutations, sign-out and user
//     change go through lib/accountMutations.ts's invalidateAllAccountData(),
//     which calls invalidateAllEndpoints() and invalidateMiscategorisedCount().
import { TRANSACTIONS_CHANGED_EVENT } from "@/lib/cacheInvalidation";
import { bindEndpointInvalidation, TRANSACTIONS_CHANGED_KEYS } from "@/lib/endpointCache";
import { bindMiscategorisedInvalidation } from "@/lib/miscategorisedCount";

let bound = false;

export function installEndpointCacheBindings(target: EventTarget | null = typeof window === "undefined" ? null : window): void {
  if (bound || !target) return;
  bound = true;
  bindEndpointInvalidation(target, {
    [TRANSACTIONS_CHANGED_EVENT]: TRANSACTIONS_CHANGED_KEYS,
  });
  bindMiscategorisedInvalidation(target, [TRANSACTIONS_CHANGED_EVENT]);
}

if (typeof window !== "undefined") installEndpointCacheBindings();
