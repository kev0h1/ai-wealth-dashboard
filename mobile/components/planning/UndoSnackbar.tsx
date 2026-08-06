import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tw } from "@/lib/tw";

interface UndoSnackbarProps {
  visible: boolean;
  kind: "recurring" | "planned";
  onUndo: () => void;
}

export function UndoSnackbar({ visible, kind, onUndo }: UndoSnackbarProps) {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const progress = useRef(new Animated.Value(1)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      progress.setValue(1);
      anim.current = Animated.timing(progress, {
        toValue: 0,
        duration: 6000,
        useNativeDriver: false,
      });
      anim.current.start();
    } else {
      anim.current?.stop();
      progress.setValue(1);
    }
  }, [visible, progress]);

  if (!visible) return null;

  const bottomPos = 96 + insets.bottom;
  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, winW - 32],
  });

  const message =
    kind === "planned" ? "Planned payment deleted" : "Prediction removed";

  return (
    <View
      style={[
        styles.container,
        { bottom: bottomPos, left: tw.space[4], right: tw.space[4] },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.snackbar}>
        <View style={styles.row}>
          <Text style={styles.message}>{message}</Text>
          <Pressable onPress={onUndo} style={styles.undoBtn}>
            <Text style={styles.undoText}>Undo</Text>
          </Pressable>
        </View>
        <Animated.View style={[styles.progressBar, { width: barWidth }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 70,
  },
  snackbar: {
    backgroundColor: "rgba(15,23,42,0.95)",
    borderRadius: tw.radius.xl,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: tw.space[4],
    paddingRight: tw.space[2],
    minHeight: 48,
  },
  message: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.white,
  },
  undoBtn: {
    paddingHorizontal: tw.space[4],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  undoText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.bold,
    color: "#a5b4fc",
  },
  progressBar: {
    height: 3,
    backgroundColor: "rgba(129,140,248,0.9)",
  },
});
