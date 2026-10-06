"use client";

import type { Account, Allocation } from "@/lib/api";
import UpcomingFlowSheet, { UpcomingFlowFooter } from "./UpcomingFlowSheet";
import { AllocationEditForm, type AllocationEditServices } from "./AllocationEditForm";

type Props = {
  allocation: Allocation; accounts: Account[]; periodStart: Date; onClose(): void;
  onSaved(item: Allocation): void | Promise<void>; onDeleted?(): void | Promise<void>;
  /** G217: injected by design previews. */ services?: AllocationEditServices; suggestedSourceId?: string | null;
};

export default function AllocationSheet({ allocation, accounts, periodStart, onClose, onSaved, onDeleted, services, suggestedSourceId }: Props) {
  return <UpcomingFlowSheet initialView="edit" onClose={onClose} renderView={(_, navigation) => ({
    title: "Edit allocation", subtitle: allocation.name,
    body: <AllocationEditForm allocation={allocation} accounts={accounts} periodStart={periodStart} services={services} suggestedSourceId={suggestedSourceId} onCancel={navigation.close} onSaved={onSaved} onDeleted={() => onDeleted?.()} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />,
  })} />;
}
