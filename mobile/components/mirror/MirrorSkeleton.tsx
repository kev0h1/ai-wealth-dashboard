import { View, StyleSheet } from "react-native";
import { Skeleton } from "@/components/ui";
import { tw } from "@/lib/tw";

interface SkeletonCardProps {
  dark: boolean;
}

function SkeletonCard({ dark }: SkeletonCardProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  // Skeleton shades per spec: title = slate200/slate700, lines/chips/btns = slate100/slate700-60%
  const titleColor = dark ? tw.color.slate700 : tw.color.slate200;
  const lineColor  = dark ? "#334155" + "99" : tw.color.slate100; // slate700/60

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      {/* Title line */}
      <Skeleton width={192} height={16} borderRadius={tw.radius.lg} style={{ backgroundColor: titleColor }} />

      {/* Narrative lines */}
      <View style={styles.narrativeLines}>
        <Skeleton width="100%" height={12} borderRadius={tw.radius.lg} style={{ backgroundColor: lineColor }} />
        <Skeleton width="75%" height={12} borderRadius={tw.radius.lg} style={{ backgroundColor: lineColor }} />
      </View>

      {/* Evidence chips */}
      <View style={styles.chipRow}>
        <Skeleton width={112} height={24} borderRadius={tw.radius.full} style={{ backgroundColor: lineColor }} />
        <Skeleton width={144} height={24} borderRadius={tw.radius.full} style={{ backgroundColor: lineColor }} />
      </View>

      {/* Button row */}
      <View style={styles.btnRow}>
        <Skeleton width="49%" height={36} borderRadius={tw.radius.xl} style={{ backgroundColor: lineColor }} />
        <Skeleton width="49%" height={36} borderRadius={tw.radius.xl} style={{ backgroundColor: lineColor }} />
      </View>
    </View>
  );
}

interface Props {
  dark: boolean;
}

export function MirrorSkeleton({ dark }: Props) {
  return (
    <View style={styles.stack}>
      <SkeletonCard dark={dark} />
      <SkeletonCard dark={dark} />
      <SkeletonCard dark={dark} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: tw.space[4],
  },
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    padding: tw.space[4],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  narrativeLines: {
    marginTop: tw.space[2],
    gap: tw.space[2],
  },
  chipRow: {
    flexDirection: "row",
    gap: tw.space[1] + tw.space[0.5], // gap-1.5 = 6px
    marginTop: tw.space[3],
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: tw.space[3],
  },
});
