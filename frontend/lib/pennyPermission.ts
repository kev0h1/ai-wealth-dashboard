export type PermissionSnapshot = Record<string, unknown> | null;
export type PermissionSaveResult =
  | { kind: "confirmed"; checked: boolean }
  | { kind: "rejected"; checked: boolean }
  | { kind: "unknown" };

/** A response can be lost after a write. Reconcile both success and failure
 * against the server; never equate a failed refresh with permission off. */
export async function savePennyPermission(desired: boolean, actions: {
  grant: () => Promise<unknown>;
  revoke: () => Promise<unknown>;
  refresh: () => Promise<PermissionSnapshot>;
}): Promise<PermissionSaveResult> {
  try { await (desired ? actions.grant() : actions.revoke()); } catch { /* Reconcile an ambiguous result. */ }
  let snapshot: PermissionSnapshot;
  try { snapshot = await actions.refresh(); } catch { return { kind: "unknown" }; }
  if (!snapshot) return { kind: "unknown" };
  const checked = Boolean(snapshot.penny_agent_consent);
  return { kind: checked === desired ? "confirmed" : "rejected", checked };
}
