export const SETTINGS_GROUP_ORDER = [
  "Account access",
  "Security and connected accounts",
  "How Sorted behaves",
  "Data and help",
  "Leave or delete",
] as const;

export type SettingsGroup = typeof SETTINGS_GROUP_ORDER[number];
