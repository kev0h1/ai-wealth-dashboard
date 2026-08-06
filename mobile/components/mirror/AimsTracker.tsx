import { View, Text, Pressable, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";
import type { ActiveAim } from "@/lib/api";

interface Props {
  aims: ActiveAim[];
  dark: boolean;
  onCancel: (id: string) => void;
}

function daysLeftText(days: number): string {
  if (days <= 0) return "last day";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function formatGBP(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

export function AimsTracker({ aims, dark, onCancel }: Props) {
  if (aims.length === 0) return null;

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  return (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionLabel,
          { color: dark ? tw.color.slate500 : tw.color.slate400 },
        ]}
      >
        WHAT YOU'RE WORKING ON
      </Text>
      <View style={styles.list}>
        {aims.map((aim) => (
          <View
            key={aim.id}
            style={[styles.aimCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
          >
            <Text
              style={[styles.aimRef, { color: dark ? tw.color.slate100 : tw.color.slate800 }]}
              numberOfLines={1}
            >
              {aim.ref}
            </Text>
            <Text style={[styles.aimSubtext, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
              {`£${formatGBP(aim.spent_so_far)} of your £${formatGBP(aim.aim_amount)} aim · ${daysLeftText(aim.days_left)}`}
            </Text>
            <Pressable
              onPress={() => onCancel(aim.id)}
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`Cancel aim: ${aim.ref}`}
            >
              <Text style={[styles.cancelText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
                Cancel this aim
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: tw.space[6],
  },
  sectionLabel: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
    marginBottom: tw.space[2],
  },
  list: {
    gap: tw.space[2],
  },
  aimCard: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  aimRef: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  aimSubtext: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: tw.space[0.5],
  },
  cancelBtn: {
    marginTop: tw.space[1] + tw.space[0.5], // mt-1.5 = 6px
    alignSelf: "flex-start",
  },
  cancelText: {
    ...tw.text.xs,
  },
});
