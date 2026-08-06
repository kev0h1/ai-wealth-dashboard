import React, { useRef } from "react";
import {
  View,
  Text,
  PanResponder,
  Animated,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { X } from "lucide-react-native";
import { tw } from "@/lib/tw";

interface SwipeDismissRowProps {
  onDismiss: () => void;
  label?: string;
  children: React.ReactNode;
}

export function SwipeDismissRow({
  onDismiss,
  label = "Not recurring",
  children,
}: SwipeDismissRowProps) {
  const { width: winW } = useWindowDimensions();
  const dx = useRef(new Animated.Value(0)).current;
  const startTime = useRef(0);
  const axis = useRef<"none" | "h" | "v">("none");

  const revealOpacity = dx.interpolate({
    inputRange: [-80, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => {
      if (axis.current === "v") return false;
      const absX = Math.abs(g.dx);
      const absY = Math.abs(g.dy);
      if (absX < 4 && absY < 4) return false;
      if (axis.current === "none") {
        axis.current = absX > absY * 1.5 ? "h" : "v";
      }
      return axis.current === "h";
    },
    onPanResponderGrant: () => {
      startTime.current = Date.now();
      axis.current = "none";
      dx.stopAnimation();
    },
    onPanResponderMove: (_, g) => {
      if (axis.current === "v") return;
      dx.setValue(Math.min(0, g.dx));
    },
    onPanResponderRelease: (_, g) => {
      axis.current = "none";
      const currentDx = g.dx;
      const elapsed = Date.now() - startTime.current;
      const flick = elapsed < 250 && currentDx < -60;
      const threshold = winW * 0.4;

      if (currentDx < -threshold || flick) {
        Animated.timing(dx, {
          toValue: -(winW + 24),
          duration: 180,
          useNativeDriver: true,
        }).start(() => {
          onDismiss();
          dx.setValue(0);
        });
      } else {
        Animated.timing(dx, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }).start();
      }
    },
    onPanResponderTerminate: () => {
      axis.current = "none";
      Animated.timing(dx, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.revealBg, { opacity: revealOpacity }]}>
        <X size={14} color={tw.color.white} />
        <Text style={styles.revealLabel}>{label}</Text>
      </Animated.View>
      <Animated.View
        style={{ transform: [{ translateX: dx }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: tw.radius["2xl"],
  },
  revealBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: tw.color.rose500,
    borderRadius: tw.radius["2xl"],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    paddingRight: tw.space[4],
  },
  revealLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
});
