"use client";

import { useState } from "react";
import type { Account, Allocation } from "@/lib/api";
import UpcomingFlowSheet, { UpcomingFlowFooter } from "./UpcomingFlowSheet";
import { AllocationPlanEditor, type AllocationEditServices } from "./AllocationPlanEditor";

type Props = {
  allocation: Allocation; accounts: Account[]; periodStart: Date; onClose(): void;
  onSaved(item: Allocation): void | Promise<void>; onDeleted?(): void | Promise<void>;
  /** G217: injected by design previews. */ services?: AllocationEditServices; suggestedSourceId?: string | null;
};

export default function AllocationSheet({ allocation, accounts, periodStart, onClose, onSaved, onDeleted, services, suggestedSourceId }: Props) {
  const [savedRecord, setSavedRecord] = useState<Allocation | null>(null);
  const record = savedRecord ?? allocation;
  return <UpcomingFlowSheet<"view" | "edit" | "contribution"> initialView="view" onClose={onClose} renderView={(mode, navigation) => ({
    title: mode === "view" ? record.name : mode === "contribution" ? "Change this period" : "Edit plan", subtitle: mode === "view" ? "Your set-aside" : record.name,
    body: <AllocationPlanEditor key={mode} allocation={record} accounts={accounts} periodStart={periodStart} services={services} suggestedSourceId={suggestedSourceId} initialMode={mode} onEdit={() => navigation.goTo("edit")} onChangeContribution={() => navigation.goTo("contribution")} onCancel={mode === "view" ? navigation.close : () => { if (!navigation.returnTo(view => view === "view")) navigation.back(); }} onSaved={async item => { setSavedRecord(item); await onSaved(item); }} onDeleted={() => onDeleted?.()} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />,
  })} />;
}
