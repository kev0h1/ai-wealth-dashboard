import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { tw } from "@/lib/tw";

interface Props {
  trajectory: { period_end: string; delta: number }[];
  dark: boolean;
}

const CHART_HEIGHT = 48;
const BAR_GAP = 8;
const MIN_BAR_H = 4;

export function TrajectoryChart({ trajectory, dark }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  const trajSlice = trajectory.slice(-6);

  if (trajSlice.length === 0) {
    return (
      <Text style={[styles.empty, { color: textSecondary }]}>
        No closed cycles yet.
      </Text>
    );
  }

  // Chart width: container minus px=16 on each side
  const chartWidth = windowWidth - 32;
  const n = trajSlice.length;
  const barWidth = (chartWidth - (n - 1) * BAR_GAP) / n;

  const maxAbsDelta = trajSlice.reduce(
    (m, t) => Math.max(m, Math.abs(t.delta)),
    0
  );

  function barHeight(delta: number): number {
    if (maxAbsDelta === 0) return MIN_BAR_H;
    return Math.max(MIN_BAR_H, Math.round((CHART_HEIGHT * Math.abs(delta)) / maxAbsDelta));
  }

  function barColor(delta: number): string {
    // Spec: emerald only when balance strictly shrank (delta < 0); slate when grew or held (delta >= 0)
    if (delta < 0) return tw.color.emerald500;
    return dark ? tw.color.slate500 : tw.color.slate400;
  }

  function monthLabel(isoDate: string): string {
    try {
      return new Date(isoDate).toLocaleDateString("en-GB", { month: "short" });
    } catch {
      return "";
    }
  }

  return (
    <View style={styles.container}>
      <Svg width={chartWidth} height={CHART_HEIGHT}>
        {trajSlice.map((t, i) => {
          const h = barHeight(t.delta);
          const x = i * (barWidth + BAR_GAP);
          const y = CHART_HEIGHT - h;
          return (
            <Rect
              key={t.period_end}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx={4}
              fill={barColor(t.delta)}
            />
          );
        })}
      </Svg>

      {/* Month labels */}
      <View style={[styles.labels, { width: chartWidth }]}>
        {trajSlice.map((t, i) => (
          <View
            key={t.period_end}
            style={[styles.labelCell, { width: barWidth }]}
          >
            <Text style={[styles.monthLabel, { color: textSecondary }]}>
              {monthLabel(t.period_end)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tw.space[2],
  },
  labels: {
    flexDirection: "row",
    gap: BAR_GAP,
  },
  labelCell: {
    alignItems: "center",
  },
  monthLabel: {
    ...tw.text["10"],
    fontWeight: tw.weight.medium,
  },
  empty: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
});
