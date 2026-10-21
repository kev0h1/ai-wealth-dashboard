"use client";

import type { Account, Allocation } from "@/lib/api";
import UpcomingFlowSheet, { UpcomingFlowFooter } from "./UpcomingFlowSheet";
import { AllocationEditForm, type AllocationEditServices } from "./AllocationEditForm";

type Props = {
  allocation: Allocation; accounts: Account[]; periodStart: Date; onClose(): void;
  onSaved(item: Allocation): void | Promise<void>; onDeleted?(): void | Promise<void>;
  /** G217: injected by design previews. */ services?: AllocationEditServices; suggestedSourceId?: string | null;
  initialMode?: "view" | "edit";
};

export default function AllocationSheet({ allocation, accounts, periodStart, onClose, onSaved, onDeleted, services, suggestedSourceId, initialMode = "view" }: Props) {
  return <UpcomingFlowSheet initialView={initialMode} onClose={onClose} renderView={(mode, navigation) => ({
    title: mode === "view" ? allocation.name : "Edit plan", subtitle: mode === "view" ? "Your set-aside" : allocation.name,
    body: <AllocationEditForm key={mode} allocation={allocation} accounts={accounts} periodStart={periodStart} services={services} suggestedSourceId={suggestedSourceId} initialMode={mode} onEdit={() => navigation.goTo("edit")} onCancel={mode === "edit" && initialMode === "view" ? navigation.back : navigation.close} onSaved={onSaved} onDeleted={() => onDeleted?.()} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />,
  })} />;
}
