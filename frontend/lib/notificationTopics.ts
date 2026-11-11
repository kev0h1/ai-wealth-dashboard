import type { NotificationPrefs } from "@/lib/api";

export const NOTIFICATION_TOPICS: readonly { key: keyof NotificationPrefs; title: string; description: string }[] = [
  { key: "bill_alerts", title: "Bill alerts", description: "When an upcoming bill may not clear, or an account looks short for its plans" },
  { key: "classification_attention", title: "Payments needing a look", description: "Unplaced or possibly miscategorised payments" },
  { key: "transactions", title: "New transactions", description: "Each time new transactions arrive" },
  { key: "category_pace", title: "Category running hot", description: "When a category is well above your usual pace" },
  { key: "goal_milestones", title: "Goal milestones", description: "When a goal reaches a milestone" },
  { key: "period_digest", title: "Pay-period digest", description: "A fresh-start goals summary each new pay period" },
  { key: "insights", title: "Tips and insights notifications", description: "New tips about your spending" },
];

export function notificationTopics(tipsEnabled: boolean) {
  return NOTIFICATION_TOPICS.filter(topic => topic.key !== "insights" || tipsEnabled);
}
