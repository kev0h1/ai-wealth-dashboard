import { View, Text, Pressable, StyleSheet } from "react-native";
import { Target } from "lucide-react-native";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { GoalSummary } from "@/lib/shared";

interface Props {
  goals: GoalSummary[];
  loading: boolean;
  dark: boolean;
  onNavigate: (url: string) => void;
}

function goalBarColor(goal: GoalSummary): string {
  if (goal.done) return "#10b981";
  if (goal.at_risk) return "#f59e0b";
  if (goal.pillar === "savings") return "#10b981";
  return "#4f46e5";
}

function goalDetailColor(goal: GoalSummary, dark: boolean): string {
  if (goal.done) return "#10b981";
  if (goal.at_risk) return "#f59e0b";
  return dark ? "#94a3b8" : "#64748b";
}

function humanizeBudgetDetail(goal: GoalSummary): string {
  if (goal.pillar === "budget" && goal.at_risk) {
    const match = goal.detail.match(/(\d+)/);
    if (match) return `${match[1]} categories over budget`;
  }
  return goal.detail;
}

export function GoalsCard({ goals, loading, dark, onNavigate }: Props) {
  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";
  const inkColor = dark ? "#f1f5f9" : "#0f172a";

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={[styles.skeleton, { backgroundColor: dark ? "#334155" : "#e2e8f0" }]} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor, shadowOpacity: dark ? 0 : 0.06 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconChip}>
          <Target size={16} color="#4f46e5" />
        </View>
        <Text style={[styles.headerLabel, { color: inkColor }]}>Your goals</Text>
      </View>

      {goals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: "#94a3b8" }]}>No goals set yet...</Text>
          <Pressable
            onPress={() => onNavigate("/debt")}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={styles.link}>Start with debt payoff →</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.goalsList}>
          {goals.map((goal, i) => (
            <Pressable
              key={`${goal.pillar}-${i}`}
              onPress={() => onNavigate(goal.url)}
              style={({ pressed }) => [
                styles.goalRow,
                { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
              ]}
            >
              <View style={styles.goalHeader}>
                <Text style={[styles.goalLabel, { color: inkColor }]}>{goal.label}</Text>
                <Text style={[styles.goalPct, { color: dark ? "#94a3b8" : "#64748b" }]}>
                  {Math.round(goal.pct)}%
                </Text>
              </View>
              <ProgressBar value={goal.pct / 100} color={goalBarColor(goal)} height={5} />
              <Text style={[styles.goalDetail, { color: goalDetailColor(goal, dark) }]}>
                {humanizeBudgetDetail(goal)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#eef2ff",
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  skeleton: {
    height: 80,
    borderRadius: 8,
  },
  emptyState: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  emptyText: {
    fontSize: 14,
  },
  link: {
    color: "#4f46e5",
    fontSize: 14,
    fontWeight: "600",
  },
  goalsList: {
    gap: 14,
  },
  goalRow: {
    gap: 6,
  },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  goalLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  goalPct: {
    fontSize: 12,
    fontWeight: "500",
  },
  goalDetail: {
    fontSize: 12,
  },
});
