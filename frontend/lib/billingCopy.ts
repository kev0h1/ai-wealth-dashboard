// B45: the plan, trial and paused-accounts wording in one pure module, so
// the copy rules (British English, no em dashes, no exclamation marks, red
// only for genuine financial risk) can be tested without rendering React.
// DRAFT wording: the trial and terms copy awaits Kevin's approval, see
// docs/pricing/trial-copy-b45.md. Change the sentences there first.

export function money(value: number): string {
  return `£${value.toFixed(2)}`;
}

/** "14-day free trial" */
export function trialHeadline(days: number): string {
  return `${days}-day free trial`;
}

/** Next to the trial control: what happens, when, and that a card is needed. */
export function trialTermsLine(total: number, renewalWords: string): string {
  return `Then ${money(total)} ${renewalWords}. Card required, cancel any time.`;
}

/** The full disclosure under the control (B22): amount, charge date, renewal. */
export function trialDisclosureLine(days: number, total: number, chargeTiming: string, renewalWords: string): string {
  return `${days} days free, then ${money(total)} ${chargeTiming}, then ${money(total)} ${renewalWords} unless you cancel.`;
}

export function trialCancelLine(cancelByText: string): string {
  return `Cancel any time ${cancelByText} from Settings, Your plan, and you will not be charged. You keep your plan until the free days end.`;
}

export function endsOnLine(isoDate: string, formatDate: (iso: string) => string): string {
  return `Ends on ${formatDate(isoDate)}`;
}

export const PAYMENT_FAILED_TITLE = "Payment didn't go through";
export function paymentFailedBody(graceDays?: number): string {
  const access = graceDays ? `You keep access for the next ${graceDays} days while we try again.` : "You should keep access for a few days while we try again.";
  return `We couldn't take your latest payment. Update your card to keep your plan. ${access}`;
}
export const FIX_PAYMENT_LABEL = "Fix payment";

export const PAUSED_BANKS_TITLE = "Bank sync is paused";
export function pausedBanksBody(count: number): string {
  const what = count === 1 ? "Your connected account is" : `Your ${count} connected accounts are`;
  return `${what} no longer updating on the Statements plan. Everything already synced stays here to read. Resubscribe to start syncing again.`;
}
export const RESUBSCRIBE_LABEL = "Resubscribe";
export const RESUBSCRIBE_HREF = "/settings?plans=1";

export function pausedAccountCount(accounts: ReadonlyArray<{ paused?: boolean }>): number {
  return accounts.filter((account) => account.paused === true).length;
}
