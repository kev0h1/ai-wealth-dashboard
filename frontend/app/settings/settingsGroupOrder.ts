export const SETTINGS_GROUP_ORDER = [
  { id: "account-access", title: "Account access", copy: "Your sign-in, plan and financial details." },
  { id: "security-connected", title: "Security and connected accounts", copy: "Control access to Sorted and the accounts it can use." },
  { id: "how-sorted-behaves", title: "How Sorted behaves", copy: "Set display, Penny and notification preferences." },
  { id: "data-help", title: "Data and help", copy: "Manage history, replay guidance and find policy details." },
  { id: "leave-delete", title: "Leave or delete", copy: "These actions are separate from everyday settings." },
] as const;

export type SettingsGroup = typeof SETTINGS_GROUP_ORDER[number]["id"];
