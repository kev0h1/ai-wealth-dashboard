import { View } from "react-native";

interface Props {
  value: number; // 0–1
  color?: string;
  height?: number;
  paceMarker?: number; // 0–1 position for a tick mark
  dark?: boolean;
}

export function ProgressBar({
  value,
  color = "#4f46e5",
  height = 6,
  paceMarker,
  dark = false,
}: Props) {
  const clamped = Math.min(1, Math.max(0, value));
  const fillPct = `${(clamped * 100).toFixed(1)}%`;
  const markerPct =
    paceMarker !== undefined
      ? `${(Math.min(1, Math.max(0, paceMarker)) * 100).toFixed(1)}%`
      : undefined;

  return (
    <View
      style={{
        height,
        backgroundColor: dark ? "#334155" : "#f1f5f9",
        borderRadius: height / 2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          // percentage width works in RN when the parent has a defined width
          width: fillPct as unknown as number,
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
      {markerPct !== undefined && (
        <View
          style={{
            position: "absolute",
            left: markerPct as unknown as number,
            top: 0,
            bottom: 0,
            width: 2,
            backgroundColor: "#94a3b8",
          }}
        />
      )}
    </View>
  );
}
