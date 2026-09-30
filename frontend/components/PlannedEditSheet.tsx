"use client";

import type { Account } from "@/lib/api";
import UpcomingFlowSheet, { UpcomingFlowFooter } from "./UpcomingFlowSheet";
import { PlannedEditForm, type PlannedEditItem } from "./PlannedEditForm";

type Props = { item: PlannedEditItem; accounts: Account[]; onClose(): void; onDelete(): void; onSaved(): void | Promise<void> };

export default function PlannedEditSheet({ item, accounts, onClose, onDelete, onSaved }: Props) {
  return <UpcomingFlowSheet initialView="edit" onClose={onClose} renderView={(_, navigation) => ({
    title: "Edit planned payment", subtitle: item.name,
    body: <PlannedEditForm item={item} accounts={accounts} onCancel={navigation.close} onDelete={() => { onDelete(); navigation.close(); }} onSaved={onSaved} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />,
  })} />;
}
