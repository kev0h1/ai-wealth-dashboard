import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Trash2 } from "lucide-react-native";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { insightsApi } from "@/lib/api/insights";
import type { SavingsPlan, SavingsPlanMilestone } from "@/lib/api/insights";

interface Props {
  plan: SavingsPlan;
  onUpdate: (plan: SavingsPlan | null) => void;
}

const RING_SIZE = 52;
const RING_R = 20;
const RING_STROKE = 5;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function ProgressRing({
  done,
  total,
  dark,
}: {
  done: number;
  total: number;
  dark: boolean;
}) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * pct) / 100;
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        stroke={dark ? tw.color.slate700 : tw.color.emerald100}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        stroke={tw.color.emerald500}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        rotation="-90"
        origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
      />
    </Svg>
  );
}

function MilestoneRow({
  milestone,
  dark,
  onToggle,
  onDelete,
}: {
  milestone: SavingsPlanMilestone;
  dark: boolean;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  const handleToggle = useCallback(async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await onToggle(milestone.id, !milestone.done);
    } finally {
      setToggling(false);
    }
  }, [toggling, milestone.id, milestone.done, onToggle]);

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(milestone.id);
    } finally {
      setDeleting(false);
    }
  }, [deleting, milestone.id, onDelete]);

  return (
    <View style={rowStyles.row}>
      <Pressable onPress={handleToggle} style={rowStyles.checkArea} disabled={toggling}>
        <View
          style={[
            rowStyles.checkbox,
            {
              backgroundColor: milestone.done ? tw.color.emerald500 : "transparent",
              borderColor: milestone.done
                ? tw.color.emerald500
                : dark
                ? tw.color.slate600
                : tw.color.slate300,
            },
          ]}
        >
          {toggling ? (
            <ActivityIndicator size="small" color={tw.color.white} />
          ) : milestone.done ? (
            <View style={rowStyles.checkDot} />
          ) : null}
        </View>
        <View style={rowStyles.textBlock}>
          <Text
            style={[
              rowStyles.milestoneText,
              {
                color: milestone.done ? textSecondary : textPrimary,
                textDecorationLine: milestone.done ? "line-through" : "none",
              },
            ]}
          >
            {milestone.text}
          </Text>
          {milestone.target_balance != null && (
            <Text style={[rowStyles.targetBalance, { color: textSecondary }]}>
              Target: {fmtGBP(milestone.target_balance)}
            </Text>
          )}
          {milestone.live_category != null && milestone.live_spend != null && (
            <Text style={[rowStyles.liveHint, { color: textSecondary }]}>
              {milestone.live_category}: {fmtGBP(milestone.live_spend)}
              {milestone.live_target != null
                ? ` / ${fmtGBP(milestone.live_target)}`
                : ""}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable onPress={handleDelete} hitSlop={8} disabled={deleting}>
        {deleting ? (
          <ActivityIndicator size="small" color={tw.color.rose500} />
        ) : (
          <Trash2 size={16} color={tw.color.rose500} />
        )}
      </Pressable>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
    paddingVertical: tw.space[2],
  },
  checkArea: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tw.space[3],
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: tw.radius.full,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tw.color.white,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  milestoneText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  targetBalance: {
    ...tw.text.xs,
  },
  liveHint: {
    ...tw.text.xs,
  },
});

export function SavingsPlanCard({ plan, onUpdate }: Props) {
  const { dark } = useTheme();
  const [deletingPlan, setDeletingPlan] = useState(false);

  const isComplete =
    plan.total_count > 0 && plan.done_count === plan.total_count;

  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const divider = dark ? tw.color.slate700 : tw.color.slate100;

  const handleToggle = useCallback(
    async (stepId: string, done: boolean) => {
      const res = await insightsApi.toggleSavingsPlanStep(stepId, done);
      onUpdate(res.plan);
    },
    [onUpdate]
  );

  const handleDelete = useCallback(
    async (stepId: string) => {
      const res = await insightsApi.deleteSavingsPlanStep(stepId);
      onUpdate(res.plan);
    },
    [onUpdate]
  );

  const handleDeletePlan = useCallback(async () => {
    if (deletingPlan) return;
    setDeletingPlan(true);
    try {
      const res = await insightsApi.deleteSavingsPlan();
      onUpdate(res.plan);
    } finally {
      setDeletingPlan(false);
    }
  }, [deletingPlan, onUpdate]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.ringWrapper}>
          <ProgressRing
            done={plan.done_count}
            total={plan.total_count}
            dark={dark}
          />
          <View style={styles.ringLabel}>
            <Text style={[styles.ringText, { color: textPrimary }]}>
              {plan.done_count}/{plan.total_count}
            </Text>
          </View>
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: textPrimary }]}>
            {isComplete ? "Plan complete! 🎉" : "Your savings plan"}
          </Text>
          <Text style={[styles.subtitle, { color: textSecondary }]}>
            {plan.done_count} of {plan.total_count} steps done
          </Text>
          {plan.target_amount != null && (
            <Text style={[styles.targetLabel, { color: textSecondary }]}>
              Goal: {fmtGBP(plan.target_amount)}
            </Text>
          )}
        </View>
      </View>

      {/* Current savings callout */}
      <View style={[styles.savingsRow, { borderColor: divider }]}>
        <Text style={[styles.savingsLabel, { color: textSecondary }]}>
          Current savings
        </Text>
        <Text style={[styles.savingsAmount, { color: textPrimary }]}>
          {fmtGBP(plan.current_savings)}
        </Text>
      </View>

      {/* Milestones */}
      {plan.milestones.map((m, i) => (
        <React.Fragment key={m.id}>
          {i > 0 && (
            <View style={[styles.divider, { backgroundColor: divider }]} />
          )}
          <MilestoneRow
            milestone={m}
            dark={dark}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        </React.Fragment>
      ))}

      {/* Delete plan */}
      <Pressable
        onPress={handleDeletePlan}
        disabled={deletingPlan}
        style={[styles.deletePlanBtn, { borderColor: dark ? tw.color.slate700 : tw.color.slate200 }]}
      >
        {deletingPlan ? (
          <ActivityIndicator size="small" color={tw.color.rose500} />
        ) : (
          <Text style={styles.deletePlanText}>Delete plan</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: tw.space[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  ringLabel: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: {
    fontSize: 11,
    fontWeight: tw.weight.bold,
    lineHeight: 14,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  subtitle: {
    ...tw.text.xs,
  },
  targetLabel: {
    ...tw.text.xs,
  },
  savingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: tw.space[2],
    marginTop: tw.space[1],
  },
  savingsLabel: {
    ...tw.text.sm,
  },
  savingsAmount: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
  divider: {
    height: 1,
  },
  deletePlanBtn: {
    marginTop: tw.space[2],
    borderWidth: 1,
    borderRadius: tw.radius.xl,
    paddingVertical: tw.space[2],
    alignItems: "center",
  },
  deletePlanText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.rose500,
  },
});
