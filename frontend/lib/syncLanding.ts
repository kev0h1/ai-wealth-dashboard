// A108: which account has landed after a bank consent. With a connection id
// (native flow, and the web redirect since A108) we wait for an account on
// THAT connection; without one (legacy flow) any account will do.
export function findLandedAccount<T extends { connection_id?: string }>(
  accounts: readonly T[],
  connection?: string | null,
): T | undefined {
  if (!connection) return accounts[0];
  return accounts.find((a) => a.connection_id === connection);
}

/** Give up polling after this long and show the "still syncing" notice. */
export const SYNC_POLL_TIMEOUT_MS = 3 * 60 * 1000;
