/**
 * BurndownChart — mobile version of BurndownBackground.
 * Uses react-native-svg to render the history + projection curves.
 * Only renders when projection?.length >= 1.
 */

import React from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Path, Line } from "react-native-svg";
// Note: SVG filter elements (FeGaussianBlur, FeMerge, FeMergeNode, Filter) are not
// exported as components in react-native-svg 15 — they appear only as type exports.
// The glow effect is omitted on mobile; opacity achieves a similar soft look.
import type { DebtPlanProjectionPoint, DebtPlanHistory } from "../../lib/api/debt";
import { tw } from "../../lib/tw";

interface Props {
  history?: DebtPlanHistory;
  projection: DebtPlanProjectionPoint[];
  dark?: boolean;
}

// Monotone cubic interpolation (Fritsch-Carlson).
// Returns an SVG path string or null for < 2 points.
function monotoneCubicPath(pts: Array<{ x: number; y: number }>): string | null {
  const n = pts.length;
  if (n < 2) return null;
  if (n === 2) {
    return `M ${pts[0].x} ${pts[0].y} C ${pts[0].x} ${pts[0].y} ${pts[1].x} ${pts[1].y} ${pts[1].x} ${pts[1].y}`;
  }

  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = new Array(n).fill(0);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
  }

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      m[i] = dy[0] / dx[0];
    } else if (i === n - 1) {
      m[i] = dy[n - 2] / dx[n - 2];
    } else {
      const s0 = dy[i - 1] / dx[i - 1];
      const s1 = dy[i] / dx[i];
      if (s0 * s1 <= 0) {
        m[i] = 0;
      } else {
        const w0 = 2 * dx[i] + dx[i - 1];
        const w1 = dx[i] + 2 * dx[i - 1];
        m[i] = (w0 + w1) / (w0 / s0 + w1 / s1);
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const s = dy[i] / dx[i];
    if (Math.abs(s) < 1e-10) { m[i] = 0; m[i + 1] = 0; continue; }
    const alpha = m[i] / s;
    const beta = m[i + 1] / s;
    const tau = alpha * alpha + beta * beta;
    if (tau > 9) {
      const factor = 3 / Math.sqrt(tau);
      m[i] = factor * alpha * s;
      m[i + 1] = factor * beta * s;
    }
  }

  const fmt = (v: number) => v.toFixed(3);
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = pts[i].x + dx[i] / 3;
    const cp1y = pts[i].y + (m[i] * dx[i]) / 3;
    const cp2x = pts[i + 1].x - dx[i] / 3;
    const cp2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(pts[i + 1].x)} ${fmt(pts[i + 1].y)}`;
  }
  return d;
}

export function BurndownChart({ history, projection, dark }: Props) {
  const { width: winW } = useWindowDimensions();

  const historyPts = history?.points ?? [];
  const totalPts = historyPts.length + projection.length;
  if (totalPts < 2 || projection.length === 0) return null;

  const allTotals = [
    ...historyPts.map(p => p.total),
    ...projection.map(p => p.total),
  ];
  const max = Math.max(...allTotals);
  if (max <= 0) return null;

  const toY = (total: number) => 18 + 82 * (1 - total / max);
  const hasHistory = historyPts.length >= 1;
  const seamX = hasHistory ? 30 : 0;

  const historyPtsXY = historyPts.map((p, i) => ({
    x: historyPts.length === 1 ? 0 : (i / (historyPts.length - 1)) * seamX,
    y: toY(p.total),
  }));

  const projPtsXY = projection.map((p, i) => ({
    x:
      projection.length === 1
        ? seamX
        : seamX + (i / (projection.length - 1)) * (100 - seamX),
    y: toY(p.total),
  }));

  const solidMerged = [...historyPtsXY, projPtsXY[0]];
  const solidPtsXY = solidMerged.filter(
    (p, i) =>
      i === solidMerged.length - 1 || solidMerged[i + 1].x - p.x > 1e-6
  );
  const hasSolid = solidPtsXY.length >= 2;

  const forecastPath = monotoneCubicPath(projPtsXY);
  const solidPath = hasSolid ? monotoneCubicPath(solidPtsXY) : null;

  const strokeColor = dark ? tw.color.indigo400 : tw.color.indigo600;
  const seamColor = dark ? tw.color.slate700 : tw.color.slate200;
  const chartHeight = 180;

  return (
    <View style={[styles.container, { height: chartHeight, width: winW }]} pointerEvents="none">
      <Svg
        width={winW}
        height={chartHeight}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        {forecastPath && (
          <Path
            d={forecastPath}
            stroke={strokeColor}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="16,10"
            fill="none"
            opacity={0.5}
          />
        )}

        {solidPath && (
          <Path
            d={solidPath}
            stroke={strokeColor}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={0.7}
          />
        )}

        {hasHistory && (
          <Line
            x1={seamX}
            y1={12}
            x2={seamX}
            y2={100}
            stroke={seamColor}
            strokeWidth={1}
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    marginBottom: 8,
  },
});
