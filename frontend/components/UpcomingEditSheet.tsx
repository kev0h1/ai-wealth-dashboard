"use client";

import UpcomingFlowSheet, { UpcomingFlowFooter } from "./UpcomingFlowSheet";
import { UpcomingEditForm, type UpcomingEditItem } from "./UpcomingEditForm";
import { upcomingDisplayName } from "@/lib/upcomingDisplayName";

type Props = {
  item: UpcomingEditItem & { display_name?: string | null; category?: string | null };
  onClose(): void; onDismiss(): void; onSaved(): void | Promise<void>;
};

/** Other entry points share the exact body used by Upcoming's continuous flow. */
export default function UpcomingEditSheet({ item, onClose, onDismiss, onSaved }: Props) {
  return <UpcomingFlowSheet initialView="edit" onClose={onClose} renderView={(_, navigation) => ({
    title: "Edit prediction", subtitle: upcomingDisplayName(item),
    body: <UpcomingEditForm item={item} onCancel={navigation.close} onDismiss={() => { onDismiss(); navigation.close(); }} onSaved={onSaved} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />,
  })} />;
}
