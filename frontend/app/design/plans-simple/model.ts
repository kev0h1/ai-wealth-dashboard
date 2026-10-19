import type { Account } from "@/lib/api";
export type Variant = "a" | "b";
export type Scenario = "matched" | "no-history" | "one-account" | "many-accounts" | "short" | "offline" | "no-source";
export type Kind = "goal" | "set-aside";
export type Step = "purpose" | "kind" | "target" | "amount" | "source" | "destination" | "tracking" | "review" | "edit" | "view" | "pause" | "delete" | "result";
export type Action = "next-purpose" | "choose-goal" | "choose-aside" | "next-details" | "confirm-source" | "confirm-destination" | "confirm-transfer" | "skip-transfer" | "confirm-custom-match" | "save" | "edit" | "pause" | "delete" | "confirm-pause" | "confirm-delete" | "resume" | "back" | "close" | "view-result" | "edit-name" | "edit-target" | "edit-source" | "edit-destination" | "edit-tracking" | "lower-target" | "later-date";
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
    { id: "holiday", name: "Holiday pot", provider: "Monzo", type: "bank", subtype: "SAVINGS", currency: "GBP", balance: 300, status: "AUTHORIZED", include_in_safe_to_spend: false },
    { id: "offline-pot", name: "Holiday savings", provider: "Offline", type: "savings", subtype: "SAVINGS", currency: "GBP", balance: 300, status: "AUTHORIZED", manual: true, include_in_safe_to_spend: false },
];
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
    return { name: aside ? "Next month's bills" : scenario === "no-history" ? "New sofa" : "Holiday", kind: aside ? "set-aside" : "goal", targetPence: 120000, amountPence: 10000, month: "2027-07", sourceId: scenario === "no-source" ? "" : "natwest", sourceConfirmed: scenario !== "no-source", destinationId: aside ? "" : scenario === "offline" ? "offline-pot" : "holiday", transferConfirmed: !aside && scenario !== "no-history" && scenario !== "offline", customMatch: "", cadence: "every_period", progressPence: aside || scenario === "no-history" ? 0 : 30000, status: "active" };
}
export function newDraft(scenario: Scenario): Draft {
    return { ...initialPlan(scenario), name: "", sourceConfirmed: false, transferConfirmed: false, progressPence: 0 };
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
    const progressPence = draft.kind === "goal" ? Math.max(0, draft.progressPence) : 0;
    const remainingPence = Math.max(0, draft.targetPence - progressPence);
    // A synthetic quote for July's nine remaining pay periods only. Never
    // turn an arbitrary new month into the same nine-period forecast.
    const slicePence = draft.kind === "set-aside" ? draft.amountPence : draft.month === "2027-07" && Number.isFinite(remainingPence) ? Math.ceil(remainingPence / 9 / 500) * 500 : null;
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
    const validGoal = draft.kind !== "goal" || positive(draft.targetPence) && validMonth(draft.month) && Boolean(destination);
    const canSave = draft.name.trim().length > 0 && draft.name.trim().length <= 80 && Boolean(source) && draft.sourceConfirmed && positive(draft.kind === "goal" ? draft.targetPence : draft.amountPence) && validGoal;
    const shortfallPence = scenario === "short" && draft.targetPence === 120000 && draft.month === "2027-07" && progressPence === 30000 ? 143700 : null;
    const hasCandidate = source?.id === "natwest" && (draft.kind === "goal" && destination?.id === "holiday" && scenario !== "no-history" && scenario !== "offline" || draft.kind === "set-aside" && destination?.id === "monzo" && scenario === "many-accounts");
    return { source, destination, progressPence, remainingPence, slicePence, canSave, hasCandidate, shortfallPence, reservePence: paused ? 0 : source ? slicePence : null };
}
export function applyDraft(draft: Draft, patch: Partial<Draft>): Draft {
    const routeChanged = patch.sourceId !== undefined && patch.sourceId !== draft.sourceId || patch.destinationId !== undefined && patch.destinationId !== draft.destinationId;
    return { ...draft, ...patch, ...(patch.sourceId !== undefined && patch.sourceId !== draft.sourceId ? { sourceConfirmed: false, destinationId: patch.sourceId === draft.destinationId ? "" : patch.destinationId ?? draft.destinationId } : {}), ...(patch.destinationId !== undefined && patch.destinationId !== draft.destinationId && draft.kind === "goal" ? { progressPence: 0 } : {}), ...(routeChanged ? { transferConfirmed: false, customMatch: "" } : {}) };
}
export const COPY = {
    purpose: "What is this money for?", purposeHelp: "Give it a short name, like Holiday.",
    kind: "Do you have a target?", goal: "Yes, save up to an amount", aside: "No, keep some money aside",
    target: "How much do you want to save?", targetHelp: "Choose an amount and a month.",
    amount: "How much will you keep aside?", source: "Which account will it come from?",
    destination: "Where will you save it?", here: "Keep the money here", another: "Use another account",
    tracking: "Is this the payment you use?", noHistory: "No payment is linked yet.",
    held: "The full amount stays held back until we see a matching payment.",
    noMove: "This is a plan. You move the money in your bank.",
    standingOrder: "Any standing order will keep running.",
    pause: "Pause this plan?", pauseHelp: "Your money stays where it is. You can start the plan again later.",
    remove: "Delete this plan?", deleteHelp: "This removes the plan from Sorted, not money from your bank.",
    sourceHint: "Suggested account. Please check it.",
} as const;
export const PRIMARY_COPY = Object.values(COPY);
