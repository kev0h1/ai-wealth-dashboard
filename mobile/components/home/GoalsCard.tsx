import { View, Text, Pressable, StyleSheet } from "react-native";
import { Target } from "lucide-react-native";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { GoalSummary } from "@/lib/shared";
import { tw } from "@/lib/tw";

interface Props {
  goals: GoalSummary[];
  loading: boolean;
  dark: boolean;
  onNavigate: (url: string) => void;
}

function goalBarColor(goal: GoalSummary): string {
  if (goal.done) return tw.color.emerald500;
  if (goal.at_risk) return tw.color.amber500;
  if (goal.pillar === "savings") return tw.color.emerald500;
  return tw.color.indigo600;
}

function goalDetailColor(goal: GoalSummary, dark: boolean): string {
  if (goal.done) return tw.color.emerald500;
  if (goal.at_risk) return tw.color.amber500;
  return dark ? tw.color.slate400 : tw.color.slate500;
}

function humanizeBudgetDetail(goal: GoalSummary): string {
  if (goal.pillar === "budget" && goal.at_risk) {
    const match = goal.detail.match(/^(\d+)\s+over$/);
    if (match) return `${match[1]} categories over budget`;
  }
  return goal.detail;
}

export function GoalsCard({ goals, loading, dark, onNavigate }: Props) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
        <View style={[styles.skeleton, { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate200 }]} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor, shadowOpacity: dark ? 0 : 0.06 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconChip}>
          <Target size={13} color={tw.color.indigo500} />
        </View>
        <Text style={[styles.headerLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>Your goals</Text>
      </View>

      {goals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: tw.color.slate400 }]}>No goals set yet...</Text>
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
                <Text style={[styles.goalPct, { color: goalDetailColor(goal, dark) }]}>
                  {humanizeBudgetDetail(goal)}
                </Text>
              </View>
              <ProgressBar value={goal.pct / 100} color={goalBarColor(goal)} height={8} dark={dark} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginBottom: tw.space[2.5],
  },
  iconChip: {
    width: 24,
    height: 24,
    borderRadius: tw.radius.lg,
    backgroundColor: tw.color.indigo50,
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  skeleton: {
    height: 80,
    borderRadius: tw.radius.lg,
  },
  emptyState: {
    alignItems: "center",
    gap: tw.space[2],
    paddingVertical: tw.space[2],
  },
  emptyText: {
    ...tw.text.sm,
  },
  link: {
    color: tw.color.indigo600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  goalsList: {
    gap: tw.space[3],
  },
  goalRow: {
    gap: tw.space[1.5],
  },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tw.space[1.5],
  },
  goalLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  goalPct: {
    ...tw.text["11"],
    fontWeight: tw.weight.medium,
  },
});
