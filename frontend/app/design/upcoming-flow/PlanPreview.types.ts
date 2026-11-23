import type { PreviewAccount } from "./types";

export type PlanVariant = "e" | "f";
export type PlanCaseId = "current" | "populated" | "several" | "shared" | "empty" | "checking" | "error" | "long";

/** Display fields from a preloaded plan record; every money value is pence. */
export interface PlanPreviewItem {
  id: string;
  kind: "set-aside" | "goal";
  name: string;
  sourceId: string | null;
  sourceBasis: "chosen" | "recent-transfers" | "unknown";
  periodPence: number | null;
  filledPence: number | null;
  remainingPence: number | null;
  state: "active" | "complete" | "pending";
  startsLabel?: string;
  feedLabel?: string;
}

export interface PlansPanelProps {
  variant: PlanVariant;
  items: PlanPreviewItem[];
  accounts: PreviewAccount[];
  status: "ready" | "loading" | "error";
  onOpen: (id: string) => void;
  onAdd: () => void;
  onRetry: () => void;
}
