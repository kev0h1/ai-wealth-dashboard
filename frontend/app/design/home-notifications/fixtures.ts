import type { NotificationIconName } from "@/components/notifications/NotificationIcon";

// G458: invented phone states only. Never mount the permission provider here.
export const STATES = {
  off: {
    label: "Off",
    title: "Notifications are off",
    summary: "Get bill alerts and updates about your money.",
    action: "Turn on notifications",
    disclosure: "Set up notifications",
    explanation: "Your phone will ask you to allow notifications. You can choose which alerts you receive in Sorted’s Settings.",
    next: "In the app, your phone would now ask you to allow notifications. This preview does not request permission.",
    icon: "bell",
  },
  denied: {
    label: "Denied",
    title: "Notifications are blocked",
    summary: "Allow alerts for Sorted in your phone’s Settings.",
    action: "Open phone Settings",
    disclosure: "See how to allow alerts",
    explanation: "Your phone is blocking alerts for Sorted. Open its notification settings and allow notifications, then return to Sorted.",
    next: "In the app, this opens Sorted’s notification settings on your phone. Allow notifications there, then return to Sorted. This preview leaves your settings unchanged.",
    icon: "bell-slash",
  },
  "old-app": {
    label: "Older app",
    title: "Update to check notifications",
    summary: "This version of Sorted cannot check your notification settings.",
    action: "Update Sorted",
    disclosure: "See how to update Sorted",
    explanation: "Your notification permission is unknown here. Update Sorted, then return to check whether alerts are allowed.",
    next: "Open the App Store or Google Play, find Sorted and choose Update. Then reopen Sorted to check notifications. If no update is offered yet, check again later.",
    icon: "arrow-clockwise",
  },
} satisfies Record<string, {
  label: string;
  title: string;
  summary: string;
  action: string;
  disclosure: string;
  explanation: string;
  next: string;
  icon: NotificationIconName;
}>;

export type StateId = keyof typeof STATES;

export const VARIANTS = {
  a: {
    name: "Quiet row",
    description: "One tappable row on the canvas, with the next action written out.",
    benefit: "Keeps the reconnect banner in charge and leaves more room for your money.",
    tradeoff: "The explanation is brief. Tapping the row takes the next step.",
  },
  b: {
    name: "Action card",
    description: "A small neutral card with a separate, clearly labelled action.",
    benefit: "Makes the reason and the action easiest to spot without another warning colour.",
    tradeoff: "Adds a second card before Penny’s line and takes more vertical space.",
  },
  c: {
    name: "Explain in place",
    description: "A quiet disclosure opens the explanation and its action on Home.",
    benefit: "Keeps the first view short and gives phone-specific help only when wanted.",
    tradeoff: "Turning alerts on takes an extra tap to open the explanation.",
  },
} as const;

export type VariantId = keyof typeof VARIANTS;
