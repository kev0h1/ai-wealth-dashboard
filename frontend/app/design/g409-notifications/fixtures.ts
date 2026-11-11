// G409 design round. All state is synthetic and belongs to this preview.
export const PLATFORMS = [
  { value: "ios", label: "iPhone app" },
  { value: "android", label: "Android 13+ app" },
  { value: "android-legacy", label: "Android 12 app" },
  { value: "web", label: "Desktop browser" },
  { value: "ios-web", label: "iPhone Safari, not installed" },
  { value: "old-app", label: "App needs an update" },
  { value: "unsupported", label: "Unsupported browser" },
] as const;
export type Platform = typeof PLATFORMS[number]["value"];

export const SCENARIOS = [
  { value: "first-launch", label: "First launch" },
  { value: "home-off", label: "Home, permission off" },
  { value: "home-on", label: "Home, permission on" },
  { value: "settings-off", label: "Settings, permission off" },
  { value: "settings-on", label: "Settings, permission on" },
  { value: "saved-choices", label: "Existing choices kept" },
  { value: "setup-error", label: "Permission on, setup incomplete" },
  { value: "status-error", label: "Cannot read permission" },
  { value: "settings-error", label: "Cannot open phone settings" },
  { value: "checking", label: "Checking permission" },
] as const;
export type Scenario = typeof SCENARIOS[number]["value"];
export type Surface = "intro" | "home" | "settings";
export type Permission = "prompt" | "denied" | "granted" | "unavailable" | "unknown" | "checking";

export const TOPICS = [
  { key: "bill_alerts", title: "Bill alerts", description: "When an upcoming bill may not clear, or an account looks short for its plans" },
  { key: "classification_attention", title: "Payments needing a look", description: "Unplaced or possibly miscategorised payments" },
  { key: "transactions", title: "New transactions", description: "Each time new transactions arrive" },
  { key: "category_pace", title: "Category running hot", description: "When a category is well above your usual pace" },
  { key: "goal_milestones", title: "Goal milestones", description: "When a goal reaches a milestone" },
  { key: "period_digest", title: "Pay-period digest", description: "A fresh-start goals summary each new pay period" },
  { key: "insights", title: "Tips and insights notifications", description: "New tips about your spending" },
] as const;
export type Topic = typeof TOPICS[number]["key"];

export function initialState(scenario: Scenario, platform: Platform) {
  const available = !["ios-web", "old-app", "unsupported"].includes(platform);
  const granted = ["home-on", "settings-on", "saved-choices", "setup-error"].includes(scenario);
  const permission: Permission = !available ? "unavailable" : scenario === "checking" ? "checking" : scenario === "status-error" ? "unknown" : granted ? "granted" : scenario === "first-launch" ? platform === "android-legacy" ? "granted" : "prompt" : "denied";
  const surface: Surface = scenario === "first-launch" && available && platform !== "android-legacy" ? "intro" : ["settings-off", "settings-on", "saved-choices"].includes(scenario) ? "settings" : "home";
  return { permission, surface, registered: permission === "granted" && scenario !== "setup-error" };
}

export function defaultTopics(savedChoices: boolean): Record<Topic, boolean> {
  return Object.fromEntries(TOPICS.map(({ key }) => [key, !(savedChoices && ["transactions", "bill_alerts"].includes(key))])) as Record<Topic, boolean>;
}
