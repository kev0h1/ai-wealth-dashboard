export type ScenarioId = "single" | "several" | "shared" | "partial" | "clear" | "checking" | "many";
export type Variant = "c" | "d";
export type AccountState = "short" | "move" | "funding" | "covered" | "checking" | "plans";

export interface PreviewAccount {
  id: string;
  bank: string;
  name: string;
  kind: "Current account" | "Savings" | "Credit card";
  purpose: "paying" | "source" | "card";
  canPayPlan?: boolean;
  status: AccountState;
  statusLabel: string;
  availabilityPence: number | null;
  availabilityLabel: "Available to spend" | "Available after suggested move" | null;
  requiresMove: boolean;
  cashNowPence: number | null;
  afterPaymentsPence: number | null;
  paymentLowPence: number | null;
  firstNeedDate: string | null;
  note: string;
  planGapPence?: number;
  earmarkedPence?: number;
  sourceProof?: string;
}

export interface PreviewPayment {
  id: string;
  accountId: string;
  date: string;
  name: string;
  category: string;
  amountPence: number;
  kind: "payment" | "income" | "transfer" | "card-charge" | "settling";
  afterPence: number | null;
  firstGapPence?: number;
  credited?: boolean;
}

export interface PreviewMove {
  id: string;
  fromId: string;
  toId: string;
  amountPence: number;
  byDate: string | null;
  savings: boolean;
  remainingGapPence: number;
  sourceProof: string;
}

export interface PreviewPlan {
  id: string;
  name: string;
  kind: "goal" | "set-aside";
  amountPence: number;
  sourceId: string | null;
  uncertain?: boolean;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  headline: string;
  reading: string;
  periodLabel: string;
  accounts: PreviewAccount[];
  payments: PreviewPayment[];
  moves: PreviewMove[];
  plans: PreviewPlan[];
}

export interface VariantProps {
  scenario: Scenario;
  hidden: boolean;
}
