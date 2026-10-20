import type { Account } from "@/lib/api";
export type Variant = "a" | "b";
export type Scenario = "matched" | "no-history" | "one-account" | "many-accounts" | "short" | "offline" | "no-source";
export type Kind = "goal" | "set-aside";
export type Step = "purpose" | "kind" | "target" | "amount" | "source" | "destination" | "tracking" | "review" | "edit" | "view" | "pause" | "delete" | "result";
export type Action = "next-purpose" | "choose-goal" | "choose-aside" | "next-details" | "confirm-source" | "confirm-destination" | "confirm-transfer" | "skip-transfer" | "confirm-custom-match" | "confirm-tracking" | "save" | "edit" | "pause" | "delete" | "confirm-pause" | "confirm-delete" | "resume" | "back" | "close" | "view-result" | "edit-name" | "edit-target" | "edit-source" | "edit-destination" | "edit-tracking" | "lower-target" | "later-date";
export type Draft = {
    name: string;
    kind: Kind;
    targetPence: number;
    amountPence: number;
    month: string;
    sourceId: string;
    sourceConfirmed: boolean;
    destinationId: string;
    transferConfirmed: boolean;
    customMatch: string;
    cadence: "every_period" | "once";
    progressPence: number;
    includeExisting: boolean;
    trackingMode: "none" | "payment" | "category";
    categoryId: string;
    trackingConfirmed: boolean;
};
export type Saved = Draft & {
    status: "active" | "paused" | "deleted";
};
export type ViewFacts = {
    slicePence: number | null;
    remainingPence: number;
    progressPence: number;
    source?: Account;
    destination?: Account;
    canSave: boolean;
    hasCandidate: boolean;
    shortfallPence: number | null;
    reservePence: number | null;
    periodsLeft: number;
    availablePotPence: number;
    categoryCount: number;
    categoryPence: number;
    categoryGrossPence: number;
    categoryRefundPence: number;
    categoryPurchaseCount: number;
    categoryLabel: string;
};
export const SCENARIOS: {
    id: Scenario;
    label: string;
}[] = [
    { id: "matched", label: "Known transfer" }, { id: "no-history", label: "No transfer yet" },
    { id: "one-account", label: "One account" }, { id: "many-accounts", label: "Several accounts" },
    { id: "short", label: "Month is short" }, { id: "offline", label: "Offline pot" }, { id: "no-source", label: "No paying account" },
];
export const ACCOUNTS: Account[] = [
    { id: "natwest", name: "Everyday account", provider: "NatWest", type: "bank", subtype: "TRANSACTION", currency: "GBP", balance: 2485, status: "AUTHORIZED", include_in_safe_to_spend: true },
    { id: "monzo", name: "Bills account", provider: "Monzo", type: "bank", subtype: "TRANSACTION", currency: "GBP", balance: 924, status: "AUTHORIZED", include_in_safe_to_spend: true },
    { id: "holiday", name: "Holiday pot", provider: "Monzo", type: "bank", subtype: "SAVINGS", currency: "GBP", balance: 600, status: "AUTHORIZED", include_in_safe_to_spend: false },
    { id: "offline-pot", name: "Holiday savings", provider: "Offline", type: "savings", subtype: "SAVINGS", currency: "GBP", balance: 300, status: "AUTHORIZED", manual: true, include_in_safe_to_spend: false },
];
export const CATEGORIES = [{ id: "groceries", label: "Groceries" }, { id: "savings", label: "Savings" }];
// Synthetic monthly calendar: today is 19 October 2026, and the next pay
// period starts on 1 November. The production engine supplies the real calendar.
export function periodsLeft(month: string): number {
    if (!validMonth(month)) return 0;
    const [year, value] = month.split("-").map(Number);
    return (year - 2026) * 12 + value - 10;
}
export type CategoryTransaction = {
    id: string; date: string; accountId: string; categoryId: string;
    customCategoryId?: string; amountPence: number;
    kind: "spend" | "refund" | "transfer" | "card-repayment";
    destinationId?: string; claimedBy?: string;
};
export const CATEGORY_TRANSACTIONS: CategoryTransaction[] = [
    { id: "shop-1", date: "2026-10-03", accountId: "natwest", categoryId: "groceries", amountPence: 4200, kind: "spend" },
    { id: "shop-2", date: "2026-10-08", accountId: "natwest", categoryId: "shopping", customCategoryId: "groceries", amountPence: 3800, kind: "spend" },
    { id: "shop-3", date: "2026-10-15", accountId: "natwest", categoryId: "groceries", amountPence: 2500, kind: "spend" },
    { id: "refund-1", date: "2026-10-16", accountId: "natwest", categoryId: "groceries", amountPence: -500, kind: "refund" },
    { id: "saving-1", date: "2026-10-05", accountId: "natwest", categoryId: "savings", amountPence: 10000, kind: "transfer", destinationId: "holiday" },
    { id: "saving-2", date: "2026-10-12", accountId: "natwest", categoryId: "savings", amountPence: 5000, kind: "transfer", destinationId: "holiday" },
    { id: "bills-1", date: "2026-10-05", accountId: "natwest", categoryId: "savings", amountPence: 10000, kind: "transfer", destinationId: "monzo" },
];
// Proposed category evidence only. This does not advance a goal's pot ledger,
// fulfil a live reservation, or claim a transaction already used by another plan.
export function categoryEvidence(draft: Draft, transactions = CATEGORY_TRANSACTIONS) {
    const seen = new Set<string>();
    let count = 0, pence = 0, grossPence = 0, refundPence = 0, purchaseCount = 0;
    for (const tx of transactions) {
        if (seen.has(tx.id)) continue;
        seen.add(tx.id);
        if (tx.claimedBy || tx.accountId !== draft.sourceId || tx.date < "2026-10-01" || tx.date > "2026-10-31" || (tx.customCategoryId ?? tx.categoryId) !== draft.categoryId) continue;
        const movingToPot = draft.kind === "goal" || Boolean(draft.destinationId);
        if (movingToPot ? tx.kind !== "transfer" || tx.destinationId !== draft.destinationId || tx.amountPence <= 0 : !["spend", "refund"].includes(tx.kind)) continue;
        if (tx.kind === "spend" && tx.amountPence <= 0 || tx.kind === "refund" && tx.amountPence >= 0) continue;
        pence += tx.amountPence;
        count++;
        if (tx.amountPence > 0) { grossPence += tx.amountPence; purchaseCount++; }
        else refundPence -= tx.amountPence;
    }
    return { count, pence, grossPence, refundPence, purchaseCount };
}
export function sourceChoices(scenario: Scenario): Account[] {
    return scenario === "no-source" ? [] : ACCOUNTS.filter(a => !a.manual && a.include_in_safe_to_spend !== false && a.subtype === "TRANSACTION" && a.currency === "GBP" && (scenario !== "one-account" || a.id === "natwest"));
}
export function destinationChoices(scenario: Scenario, draft: Draft): Account[] {
    if (scenario === "one-account")
        return [];
    return ACCOUNTS.filter(a => a.id !== draft.sourceId && (draft.kind !== "goal" || a.include_in_safe_to_spend === false) && (scenario === "offline" ? a.manual : !a.manual));
}
export function initialPlan(scenario: Scenario): Saved {
    const aside = ["one-account", "many-accounts", "no-source"].includes(scenario);
    const confirmed = !aside && scenario !== "no-history" && scenario !== "offline";
    return { name: aside ? "Next month's bills" : scenario === "no-history" ? "New sofa" : "Holiday", kind: aside ? "set-aside" : "goal", targetPence: 120000, amountPence: 10000, month: "2027-07", sourceId: scenario === "no-source" ? "" : "natwest", sourceConfirmed: scenario !== "no-source", destinationId: aside ? "" : scenario === "offline" ? "offline-pot" : "holiday", transferConfirmed: confirmed, customMatch: "", cadence: "every_period", progressPence: aside || scenario === "no-history" ? 0 : 30000, includeExisting: false, trackingMode: confirmed ? "payment" : "none", categoryId: aside ? "groceries" : "savings", trackingConfirmed: confirmed, status: "active" };
}
export function newDraft(scenario: Scenario): Draft {
    return { ...initialPlan(scenario), name: "", sourceConfirmed: false, transferConfirmed: false, trackingMode: "none", trackingConfirmed: false, progressPence: 0, includeExisting: false };
}
export function money(pence: number): string {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(pence / 100) ? 0 : 2, maximumFractionDigits: 2 }).format(pence / 100);
}
export function parseMoney(value: string): number {
    if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim()))
        return Number.NaN;
    return Math.round(Number(value) * 100);
}
export function validMonth(value: string): boolean { return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) && value >= "2026-11"; }
export function monthLabel(value: string): string { return validMonth(value) ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value + "-01T12:00:00Z")) : "Choose a month"; }
export function facts(scenario: Scenario, draft: Draft, paused = false): ViewFacts {
    const source = sourceChoices(scenario).find(a => a.id === draft.sourceId);
    const destination = destinationChoices(scenario, draft).find(a => a.id === draft.destinationId);
    // £200 of this synthetic shared pot is free to include. The rest belongs
    // to saved goals already. Never give this goal the entire £600 balance.
    const availablePotPence = draft.kind === "goal" && destination?.id === "holiday" ? 20000 : 0;
    const progressPence = draft.kind === "goal" ? Math.min(Number.isFinite(draft.targetPence) ? Math.max(0, draft.targetPence) : 0, Math.max(0, draft.progressPence) + (draft.includeExisting ? availablePotPence : 0)) : 0;
    const remainingPence = Math.max(0, draft.targetPence - progressPence);
    const periods = periodsLeft(draft.month);
    const slicePence = draft.kind === "set-aside" ? draft.amountPence : periods > 0 && Number.isFinite(remainingPence) ? Math.ceil(remainingPence / periods / 500) * 500 : null;
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
    const validGoal = draft.kind !== "goal" || positive(draft.targetPence) && validMonth(draft.month) && Boolean(destination);
    const validTracking = draft.trackingMode === "none" || draft.trackingConfirmed && (draft.trackingMode !== "category" || CATEGORIES.some(c => c.id === draft.categoryId));
    const canSave = draft.name.trim().length > 0 && draft.name.trim().length <= 80 && Boolean(source) && draft.sourceConfirmed && positive(draft.kind === "goal" ? draft.targetPence : draft.amountPence) && validGoal && validTracking;
    const shortfallPence = scenario === "short" && draft.targetPence === 120000 && draft.month === "2027-07" && progressPence === 30000 ? 143700 : null;
    const hasCandidate = source?.id === "natwest" && (draft.kind === "goal" && destination?.id === "holiday" && scenario !== "no-history" && scenario !== "offline" || draft.kind === "set-aside" && destination?.id === "monzo" && scenario === "many-accounts");
    const category = categoryEvidence(draft);
    return { source, destination, progressPence, remainingPence, slicePence, canSave, hasCandidate, shortfallPence, reservePence: paused ? 0 : source ? slicePence : null, periodsLeft: periods, availablePotPence, categoryCount: category.count, categoryPence: category.pence, categoryGrossPence: category.grossPence, categoryRefundPence: category.refundPence, categoryPurchaseCount: category.purchaseCount, categoryLabel: CATEGORIES.find(c => c.id === draft.categoryId)?.label ?? "Choose a category" };
}
export function applyDraft(draft: Draft, patch: Partial<Draft>): Draft {
    const routeChanged = patch.sourceId !== undefined && patch.sourceId !== draft.sourceId || patch.destinationId !== undefined && patch.destinationId !== draft.destinationId;
    const trackingChanged = patch.trackingMode !== undefined && patch.trackingMode !== draft.trackingMode || patch.categoryId !== undefined && patch.categoryId !== draft.categoryId || patch.customMatch !== undefined && patch.customMatch !== draft.customMatch;
    return { ...draft, ...patch, ...(patch.sourceId !== undefined && patch.sourceId !== draft.sourceId ? { sourceConfirmed: false, destinationId: patch.sourceId === draft.destinationId ? "" : patch.destinationId ?? draft.destinationId } : {}), ...(patch.destinationId !== undefined && patch.destinationId !== draft.destinationId && draft.kind === "goal" ? { progressPence: 0, includeExisting: false } : {}), ...(routeChanged ? { transferConfirmed: false, customMatch: "", trackingConfirmed: false } : {}), ...(trackingChanged ? { transferConfirmed: false, trackingConfirmed: false } : {}) };
}
export const COPY = {
    purpose: "What is this money for?", purposeHelp: "Give it a short name, like Japan trip or Groceries.",
    kind: "What would you like to do?", goal: "Goal", aside: "Set-aside",
    goalExample: "For example, save £2,000 for a trip to Japan by December 2028.",
    asideExample: "For example, set aside £300 for groceries each pay period.",
    target: "How much do you want to save?", targetHelp: "Choose an amount and a month.",
    amount: "How much will you keep aside?", source: "Which account will it come from?",
    destination: "Where will you save it?", here: "Keep the money here", another: "Use another account",
    tracking: "How should we track this?", noHistory: "No payment is linked yet.",
    held: "The full amount stays held back until we see a matching payment.",
    noMove: "This is a plan. You move the money in your bank.",
    standingOrder: "Any standing order will keep running.",
    pause: "Pause this plan?", pauseHelp: "Your money stays where it is. You can start the plan again later.",
    remove: "Delete this plan?", deleteHelp: "This removes the plan from Sorted, not money from your bank.",
    sourceHint: "Suggested account. Please check it.",
} as const;
export const PRIMARY_COPY = Object.values(COPY);
